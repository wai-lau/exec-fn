import React from "react";
import { IWarezData, IProgram } from "../types";
import Button, { ButtonColor } from "./Button";

import "./WarezMenu.css";
import { HeaderBox } from "./HeaderBox";
import ProgramInfo from "./ProgramInfo";
import Popup, { PopupConfig } from "./Popup";
import { AudioContext, IAudioContext } from "../util/AudioContext";
import * as AudioSources from "../audio/audioSources";

interface WarezProps extends IWarezData {
  numCredits: number;
  currentPrograms: IProgram[];
  onBuyProgram: (p: IProgram, price: number) => void;
  onClose: () => void;
}

interface WarezState {
  selectedProgram: IProgram["id"] | null;
  selectedAction: number | null;
  popup: PopupConfig | null;
}

export default class WarezMenu extends React.Component<WarezProps, WarezState> {
  static contextType = AudioContext;

  popupWaitCallbacks: (() => void)[];
  audioContext: IAudioContext;

  constructor(props: WarezProps) {
    super(props);
    this.state = {
      selectedProgram: null,
      popup: null,
      selectedAction: null,
    };

    this.popupWaitCallbacks = [];
    this.audioContext = this.context;
  }
  componentDidMount = () => {
    this.audioContext = this.context;
  };
  getWarezByID = (id: string) => {
    const program = this.props.programs.find((p) => p.id === id);
    if (!program) {
      throw new Error("No program with name " + id);
    }
    return program;
  };
  onBuyProgram = () => {
    const { selectedProgram: selection } = this.state;
    if (!selection) {
      return;
    }
    const program = this.getWarezByID(selection);
    if (!program) {
      throw new Error("Cannot buy program " + selection);
    }
    const price = this.props.prices[selection];
    if (!price) {
      throw new Error("Missing price for program " + program.name);
    }
    if (price > this.props.numCredits) {
      this.displayPopup({
        headerBoxTitle: "error",
        text: "Insufficient Credits",
        duration: 1200,
      });
      return;
    }
    this.props.onBuyProgram(program, price);
    this.displayPopup({
      headerBoxTitle: "received",
      text: `${program.name} acquired`,
      duration: 1200,
    });
  };
  displayPopup = async (popup: PopupConfig) => {
    await this.waitForPopup();
    await this.setState(() => ({ popup }));
  };

  dismissPopup = async () => {
    await this.setState(() => ({ popup: null }));
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
  createOnSelectProgram = (id: string) => async () => {
    await this.audioContext.player.playAudio(AudioSources.ButtonNormal);
    this.setState((state) => ({
      selectedProgram: id,
      selectedAction: state.selectedProgram !== id ? null : state.selectedAction,
    }));
  };
  onSelectAction = (i: number) => {
    this.setState({
      selectedAction: i,
    });
  };
  renderItems = () => {
    const { programs, prices } = this.props;
    return programs.map((p) => {
      const { id, name } = p;
      const price = prices[id];
      if (!price) {
        throw new Error("Missing price for program " + name);
      }
      return (
        <div key={id} className="warez-item" onClick={this.createOnSelectProgram(id)}>
          <div className="warez-item-name">{name}</div>
          <div className="warez-item-price">{price}</div>
        </div>
      );
    });
  };
  renderPopup = () =>
    this.state.popup && <Popup {...this.state.popup} dismiss={this.dismissPopup} />;
  render() {
    const { selectedProgram: warezSelection } = this.state;
    const program = warezSelection ? this.getWarezByID(warezSelection) : null;
    return (
      <div className="warez-container overlay-grid">
        {this.renderPopup()}
        <div className="warez-menu">
          <HeaderBox title="warez.node">
            <div className="warez-list">
              <h3 className="warez-header">AVAILABLE PROGRAMS</h3>
              <div className="warez-programs">{this.renderItems()}</div>

              <div className="warez-buttons">
                <Button isBold bgColor={ButtonColor.GreenGradient} onClick={this.onBuyProgram}>
                  Buy
                </Button>
                <Button isBold bgColor={ButtonColor.DarkBlueGradient} onClick={this.props.onClose}>
                  Done
                </Button>
              </div>
            </div>
          </HeaderBox>
        </div>
        <div className="warez-program-info">
          <HeaderBox title="program.info">
            <ProgramInfo
              program={program}
              actionIndex={this.state.selectedAction}
              onSelectAction={this.onSelectAction}
            />
          </HeaderBox>
        </div>
      </div>
    );
  }
}
