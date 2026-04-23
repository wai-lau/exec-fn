import React from "react";
import "./App.css";

import PComponent from "../util/PComponent";
import Battle from "./Battle";
import Netmap from "./Netmap";
import WarezMenu from "./WarezMenu";
import Dialogue from "./Dialogue";
import Popup, { PopupConfig } from "./Popup";

import * as Programs from "../programs";

import {
  IAudioPlayer,
  IProgram,
  NodeType,
  ILevel,
  NetmapPosition,
  NodeStatus,
  IWarezData,
  IBattleStyle,
  IDialogue,
  INetmapNode,
  INetmapBattleNode,
  INetmapNonBattleNode,
  ISMARTData,
  INetmap,
} from "../types";
import { AudioContext, IAudioContext } from "../util/AudioContext";

import { IBattleResult } from "../types/Battle";
import { IGameStatus, IGameStatusCoordinator } from "../types/GameStatus";

import { delay, addCoordinates, matchFlag } from "../util/util";
import NodeInfo from "./NodeInfo";
import PostVictory from "./PostVictory";

import { SuperphreakIntro } from "../campaign/dialogues";
import Tutorial from "./Tutorial";
import SMART from "./SMART";
import { Received } from "../audio/audioSources";

enum CurrentUI {
  NETMAP,
  BATTLE,
  LOADING,
  WAREZ,
  TUTORIAL,
  SMARTHQ,
}

interface AppProps {
  netmap: INetmap;
  loadedSave: IGameStatus;
  onSave: (save: IGameStatus) => void;
  onMenu: () => void;
}
interface AppState extends IGameStatus {
  currentUI: CurrentUI;
  level: ILevel | null;
  scrollPosition: NetmapPosition;
  warez: IWarezData | null;
  smartHQ: ISMARTData | null;
  firstClearCredits: number | null;
  battleStyle: IBattleStyle | null;
  dialogue: IDialogue | null;
  popup: PopupConfig | null;
  selection: (INetmapBattleNode | INetmapNonBattleNode) | null;
  onProceedAfterVictory: (() => void) | null;
  firstClearNode: { id: INetmapNode["id"]; result: "clear" | "lose" } | null;
}
class App extends PComponent<AppProps, AppState> implements IGameStatusCoordinator {
  static contextType = AudioContext;

  audioContext: IAudioContext;
  endDialogueCB: ((didComplete: boolean) => void) | null;
  netmapScrollFunction: Netmap["scrollToPosition"] | null;
  onFirstClearLock: boolean = false;
  popupWaitCallbacks: (() => void)[];

  constructor(props: AppProps) {
    super(props);
    this.state = {
      currentUI: CurrentUI.NETMAP,
      level: null,
      warez: null,
      smartHQ: null,
      firstClearCredits: null,
      battleStyle: null,
      dialogue: null,
      popup: null,
      selection: null,
      onProceedAfterVictory: null,
      ...props.loadedSave,
    };
    this.endDialogueCB = null;
    this.netmapScrollFunction = null;
    this.popupWaitCallbacks = [];
    this.audioContext = this.context;
  }
  revealAll = async () => {
    await this.setStateP(() => ({
      numCredits: 99999,
      netmapStatus: this.props.netmap.nodes
        .map((x) => ({ [x.id]: NodeStatus.CLEARED }))
        .reduce((val, next) => ({ ...val, ...next }), {}),
      securityLevel: 5,
      availablePrograms: [...this.state.availablePrograms, ...Object.values(Programs)],
    }));
  };
  async componentDidMount() {
    this.audioContext = this.context;
    if (!this.state.completedTutorial) {
      await this.startDialogue(SuperphreakIntro);
      this.setStateP(() => ({
        currentUI: CurrentUI.TUTORIAL,
      }));
    }
    if (this.state.firstClearNode) {
      const node = this.props.netmap.nodes.find((n) => n.id === this.state.firstClearNode?.id);
      if (!node) {
        throw new Error(
          "Cannot resume firstClear from nonexistent node " + this.state.firstClearNode
        );
      }
      const firstFn =
        this.state.firstClearNode.result === "clear" ? node.onFirstClear : node.onFirstLose;
      if (firstFn) {
        this.onFirstClearLock = true;
        await firstFn(this as IGameStatusCoordinator);
        await this.setStateP(() => ({
          firstClearNode: null,
        }));
        await this.save();
        this.onFirstClearLock = false;
      }
    }
  }
  async componentDidUpdate() {
    if (!this.onFirstClearLock) {
      this.save();
    }
  }
  async save() {
    await this.props.onSave(this.state as IGameStatus);
  }
  onMenu = async () => {
    await this.save();
    this.props.onMenu();
  };
  getNetmap = () => (
    <>
      <Netmap
        nightfallAvailableNodes={this.state.nightfallAvailableNodes}
        programs={this.state.availablePrograms}
        securityLevel={this.state.securityLevel}
        credits={this.state.numCredits}
        initialScrollX={this.state.scrollPosition[0]}
        initialScrollY={this.state.scrollPosition[1]}
        viewWidth={1200}
        viewHeight={800}
        onSelectNode={this.onSelectNode}
        netmapStatus={this.state.netmapStatus}
        showArrows={
          this.state.currentUI === CurrentUI.NETMAP // || this.state.currentUI === CurrentUI.DIALOGUE
        }
        forceShowPrograms={this.state.currentUI === CurrentUI.WAREZ}
        {...this.props.netmap}
        bindScrollFunction={this.bindNetmapScrollFunction}
        selectedID={this.state.selection?.id}
        onMenu={this.onMenu}
      />
      {this.state.popup && <Popup {...this.state.popup} dismiss={this.dismissPopup} />}
    </>
  );
  bindNetmapScrollFunction = (fn: Netmap["scrollToPosition"]) => {
    this.netmapScrollFunction = fn;
  };
  onCloseWarez = () => {
    this.setStateP(() => ({
      warez: null,
      currentUI: CurrentUI.NETMAP,
    }));
  };
  onBuyProgram = async (p: IProgram, price: number) => {
    await this.audioContext.player?.playAudio(Received);
    const { numCredits } = this.state;
    if (price > numCredits) {
      throw new Error("Cannot afford");
    }
    await this.setStateP(() => ({
      numCredits: numCredits - price,
    }));
    await this.setStateP((state) => ({
      availablePrograms: [...state.availablePrograms, p],
    }));
  };
  onSelectNode = async (id: string) => {
    const node = this.props.netmap.nodes.find((n) => n.id === id);
    if (!node) {
      throw new Error("No node with id " + id);
    }
    const level = (await import("../campaign/levels/" + id)).default;
    const offsetPosition = addCoordinates(this.props.netmap.positions[node.id], [40, 40]);
    const endPosition = this.netmapScrollFunction
      ? await this.netmapScrollFunction(offsetPosition)
      : this.props.netmap.initialSave.scrollPosition;
    await this.setStateP((state) => ({
      level,
      selection: node,
      scrollPosition: endPosition,
    }));
  };
  onNodeInfoCancel = () => {
    this.setStateP((state) => ({ selection: null, level: null }));
  };
  onNodeInfoEnter = async () => {
    const { selection } = this.state;
    if (!selection) {
      throw new Error("Cannot enter node without selection");
    }

    if (selection.preOpen) {
      const didComplete = await selection.preOpen(this as IGameStatusCoordinator);
      if (!didComplete) {
        this.onNodeInfoCancel();
        return;
      }
    }

    this.enterNode();
  };

  enterNode = async () => {
    const { selection } = this.state;
    if (!selection) {
      throw new Error("Cannot enter node without selection");
    }
    if (selection.type === NodeType.Battle) {
      await delay(750);
    }
    await this.setStateP(() => ({
      selection: null,
    }));
    const { id } = selection;
    if (selection.type === NodeType.Battle) {
      await this.setStateP(() => ({
        currentUI: CurrentUI.BATTLE,
        firstClearCredits:
          this.state.netmapStatus[id] === NodeStatus.CLEARED
            ? null
            : selection.firstClearCredits || null,
        battleStyle: selection.battleStyle,
      }));
    } else if (selection.type === NodeType.WarezNode) {
      const warez = (await import("../campaign/levels/" + id)).default;
      await this.setStateP((state) => ({
        warez,
        currentUI: CurrentUI.WAREZ,
        netmapStatus: { ...state.netmapStatus, [id]: NodeStatus.CLEARED },
      }));
    } else if (selection.type === NodeType.SmartHQ) {
      const smartHQ = (await import("../campaign/levels/" + id)).default;
      await this.setStateP((state) => ({
        smartHQ,
        currentUI: CurrentUI.SMARTHQ,
      }));
    }
  };

  onFinishBattle = async (result: IBattleResult) => {
    const { winner, id, collectedCreditIDs } = result;

    const node = this.props.netmap.nodes.find((n) => n.id === id);
    if (!node) {
      throw new Error("Attempted to finish nonexistent level");
    }

    await this.setStateP(() => ({
      currentUI: CurrentUI.NETMAP,
      selection: node,
    }));

    const prevStatus = this.state.netmapStatus[id] || NodeStatus.UNCLEARED_UNATTEMPTED;
    if (winner !== "P1") {
      await this.setStateP((state) => ({
        selection: null,
        level: null,
        netmapStatus: { ...state.netmapStatus, [id]: prevStatus | NodeStatus.ATTEMPTED },
      }));
      if (!matchFlag(prevStatus, NodeStatus.ATTEMPTED) && node.onFirstLose) {
        this.onFirstClearLock = true;
        await this.setStateP(() => ({
          firstClearNode: { id: node.id, result: "lose" },
        }));
        await node.onFirstLose(this as IGameStatusCoordinator);
        await this.setStateP(() => ({
          firstClearNode: null,
        }));
        await this.save();
        this.onFirstClearLock = false;
      }
      return;
    }
    let newCreditIDs: string[] = [];
    let numNewCredits = 0;
    collectedCreditIDs.forEach((id) => {
      const credit = this.state.level?.credits?.find((c) => c.id === id);
      if (!credit) {
        throw new Error("Attempted to collect nonexistent credit " + id);
      }
      if (this.state.collectedCreditIDs.includes(id)) {
        return;
      }
      numNewCredits += credit.amount;
      newCreditIDs.push(id);
    });
    await this.setStateP((state) => ({
      ...state,
      collectedCreditIDs: [...state.collectedCreditIDs, ...newCreditIDs],
      numCredits: state.numCredits + numNewCredits,
      netmapStatus: { ...state.netmapStatus, [id]: NodeStatus.CLEARED },
      battleStyle: null,
    }));
    await this.showPostVictory();
    await this.setStateP(() => ({
      level: null,
      selection: null,
      onProceedAfterVictory: null,
    }));
    if (prevStatus === NodeStatus.CLEARED) {
      return;
    }
    const children = this.props.netmap.nodes.filter((n) => n.prereq === id);
    const childrenStatus = children
      .map((n) => ({ [n.id]: NodeStatus.UNCLEARED_UNATTEMPTED }))
      .reduce((val, next) => ({ ...val, ...next }), {});
    await this.setStateP((state) => ({
      numCredits: state.numCredits + (state.firstClearCredits || 0),
      firstClearCredits: null,
      netmapStatus: {
        ...childrenStatus,
        ...state.netmapStatus,
      },
    }));
    if (!node.onFirstClear) {
      return;
    }
    const gsCoordinator = this as IGameStatusCoordinator;
    await this.setStateP(() => ({
      firstClearNode: { id: node.id, result: "clear" },
    }));
    this.onFirstClearLock = true;
    await this.save();
    await node.onFirstClear(gsCoordinator);
    await this.setStateP(() => ({
      firstClearNode: null,
    }));
    await this.save();
    this.onFirstClearLock = false;
  };

  showPostVictory = () => {
    return new Promise((resolve) => {
      this.setStateP(() => ({
        onProceedAfterVictory: resolve,
      }));
    });
  };

  addProgram = async (p: IProgram) => {
    await this.waitForPopup();
    await this.audioContext.player?.playAudio(Received);
    await this.setStateP((state) => ({
      availablePrograms: [...state.availablePrograms, p],
    }));
    await this.displayPopup(this.createProgramModal(p));
    return;
  };

  setLevel = async (level: number) => {
    if (level !== this.state.securityLevel + 1) {
      throw new Error("Cannot increment level to " + level);
    }
    await this.waitForPopup();
    await this.setStateP(() => ({
      securityLevel: level,
    }));
    await this.displayPopup(this.createSecurityLevelModal(level));

    return;
  };

  revealNode = async (id: string, status: NodeStatus = NodeStatus.UNCLEARED_UNATTEMPTED) => {
    const currentStatus = this.state.netmapStatus[id];
    if (currentStatus === undefined || currentStatus === NodeStatus.INVISIBLE) {
      await this.setStateP((state) => ({
        netmapStatus: { ...state.netmapStatus, [id]: status },
      }));
    }
    this.scrollToNode(id);
    return;
  };

  setNightfallNodes = async (ids?: string[]) => {
    this.setStateP(() => ({
      nightfallAvailableNodes: ids,
    }));
  };

  scrollToNode = async (id: string) => {
    if (this.netmapScrollFunction) {
      await delay(250);
      await this.netmapScrollFunction(this.props.netmap.positions[id]);
    }
  };

  addCredits = async (numCredits: number) => {
    await this.waitForPopup();
    await this.audioContext.player?.playAudio(Received);
    await this.setStateP((state) => ({
      numCredits: state.numCredits + numCredits,
    }));
    await this.displayPopup(this.createCreditsModal(numCredits));
    return;
  };

  displayMessage = (header: string, message: string) =>
    this.displayPopup({ headerBoxTitle: header, text: message });

  startDialogue = (dialogue: IDialogue) => {
    this.setStateP(() => ({ dialogue }));
    return new Promise<boolean>((resolve) => {
      this.endDialogueCB = resolve;
    });
  };

  endDialogue = async (didComplete: boolean) => {
    await this.setStateP(() => ({ dialogue: null, currentUI: CurrentUI.NETMAP }));
    if (!this.endDialogueCB) {
      throw new Error("Cannot call endDialogue callback if null");
    }
    this.endDialogueCB(didComplete);
    this.endDialogueCB = null;
  };

  getNodeStatus = (id: string) => this.state.netmapStatus[id] || null;

  displayPopup = async (popup: PopupConfig) => {
    await this.waitForPopup();
    await this.setStateP(() => ({ popup }));
  };

  dismissPopup = async () => {
    await this.setStateP(() => ({ popup: null }));
    this.popupWaitCallbacks.forEach((x) => {
      x();
    });
    this.popupWaitCallbacks = [];
  };

  waitForPopup = () =>
    new Promise((resolve) => {
      if (this.state.popup) {
        this.popupWaitCallbacks.push(resolve);
      } else {
        resolve();
      }
    });

  createProgramModal = (p: IProgram) => {
    return {
      headerBoxTitle: "received",
      text: `Received ${p.name}`,
      duration: 3000,
    } as PopupConfig;
  };

  createSecurityLevelModal = (level: number) => {
    return {
      headerBoxTitle: "received",
      text: `New Security Level ${level}`,
      duration: 3000,
    } as PopupConfig;
  };

  createCreditsModal = (numCredits: number) => {
    return {
      headerBoxTitle: "received",
      text: `Received Credits ${numCredits}`,
      duration: 3000,
    } as PopupConfig;
  };

  render = () => {
    const { currentUI, availablePrograms, level, warez, dialogue } = this.state;
    if (currentUI === CurrentUI.BATTLE) {
      if (!level) {
        throw new Error("Cannot render battle without loaded level");
      }
      return (
        <Battle
          battleStyle={this.state.battleStyle!}
          firstClearCredits={this.state.firstClearCredits}
          availablePrograms={availablePrograms}
          onFinishBattle={this.onFinishBattle}
          {...level}
        />
      );
    } else if (currentUI === CurrentUI.NETMAP) {
      const { selection, onProceedAfterVictory } = this.state;
      return (
        <>
          {this.getNetmap()}
          {!dialogue && selection && level && !onProceedAfterVictory && (
            <NodeInfo
              type={selection.type}
              name={selection.name || selection.id}
              securityLevel={selection.securityLevel}
              description={selection.description || "__TODO__"}
              onCancel={this.onNodeInfoCancel}
              onEnter={this.onNodeInfoEnter}
              logoImage={selection.nodeStyle.infoImage}
              credits={level.credits?.length}
              isAuthorized={selection.securityLevel <= this.state.securityLevel}
              isConnected={
                !selection.prereq ||
                this.state.netmapStatus[selection.prereq] === NodeStatus.CLEARED
              }
            />
          )}
          {!dialogue && selection && onProceedAfterVictory && (
            <PostVictory
              name={selection.name || selection.id}
              securityLevel={selection.securityLevel}
              logoImage={selection.nodeStyle.infoImage}
              onProceed={onProceedAfterVictory}
            />
          )}
          {dialogue && <Dialogue {...dialogue} onEnd={this.endDialogue} />}
        </>
      );
    } else if (currentUI === CurrentUI.WAREZ) {
      if (!warez) {
        throw new Error("Cannot render warez without loaded warez");
      }
      return (
        <>
          {this.getNetmap()}
          <WarezMenu
            numCredits={this.state.numCredits}
            currentPrograms={this.state.availablePrograms}
            onClose={this.onCloseWarez}
            {...warez}
            onBuyProgram={this.onBuyProgram}
          />
        </>
      );
    } else if (currentUI === CurrentUI.TUTORIAL) {
      return (
        <Tutorial
          onEnd={() =>
            this.setStateP(() => ({ currentUI: CurrentUI.NETMAP, completedTutorial: true }))
          }
        />
      );
    } else if (currentUI === CurrentUI.SMARTHQ) {
      if (!this.state.smartHQ) {
        // TODO error
        throw new Error("SMART");
      }
      return (
        <>
          {this.getNetmap()}
          <SMART
            data={this.state.smartHQ}
            onClose={() => this.setStateP(() => ({ currentUI: CurrentUI.NETMAP, smartHQ: null }))}
          />
        </>
      );
    }
    return null;
  };
}

export default App;
