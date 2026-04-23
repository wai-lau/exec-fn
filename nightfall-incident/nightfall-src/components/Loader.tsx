import React from "react";
import { loadGameStatus, saveGameStatus, deleteGameStatus } from "../db/gameStatus";
import { IGameStatus, IAudioPlayer } from "../types";
import PComponent from "../util/PComponent";
import App from "./App";
import Modal, { ModalConfig } from "./Modal";

import AudioLoader from "./AudioLoader";
import { AudioContext } from "../util/AudioContext";

import netmap from "../campaign/netmap";
import AudioPlayer from "./AudioPlayer";
import { delay } from "../util/util";
import ImageLoader from "./ImageLoader";
import ImageList from "../bin/image-list";
import Landing from "./Landing";
import SaveSelector from "./SaveSelector";

import * as AudioSources from "../audio/audioSources";

import "./Loader.css";
import Button from "./Button";
import GameCredits from "./GameCredits";

const saveFileNames = ["save1", "save2", "save3"] as const;
type SaveFileName = typeof saveFileNames[number];

interface LoaderProps {}

interface LoaderState {
  saves: Partial<Record<SaveFileName, IGameStatus>>;
  selectedSave: SaveFileName | null;
  muted: boolean;
  player: IAudioPlayer | null;
  allAudioLoaded: boolean;
  showLanding: boolean;
  deleteModal: ModalConfig | null;
  showCredits: boolean;
}

export default class Loader extends PComponent<LoaderProps, LoaderState> {
  landingDuration = 500;

  constructor(props: LoaderProps) {
    super(props);
    this.state = {
      saves: {},
      selectedSave: null,
      allAudioLoaded: false,
      player: null,
      muted: false,
      showLanding: true,
      deleteModal: null,
      showCredits: false,
    };
  }

  componentDidMount = () => {
    this.load();
  };

  onCloseLanding = async () => {
    await delay(this.landingDuration);
    this.setStateP(() => ({
      showLanding: false,
    }));
  };

  load = async () => {
    let saves: LoaderState["saves"] = {};
    for (let name of saveFileNames) {
      saves[name as SaveFileName] =
        (await loadGameStatus(name as string, netmap.initialSave)) || netmap.initialSave;
    }
    await this.setStateP(() => ({ saves }));
  };

  getSaveFn = (name: SaveFileName) => async (save: IGameStatus) => {
    await saveGameStatus(save, name);
  };

  getCurrentSave = () => {
    const { saves, selectedSave } = this.state;
    if (selectedSave) {
      const saveFile = saves[selectedSave];
      if (saveFile) {
        return saveFile;
      }
    }
    return null;
  };

  createOnSelectSave = (selectedSave: SaveFileName) => async () => {
    await delay(1000);
    this.setStateP(() => ({ selectedSave }));
  };

  createOnDeleteSave = (selectedSave: SaveFileName) => async () => {
    await this.setStateP(() => ({
      deleteModal: {
        headerBoxTitle: "save.game",
        header: "Delete Save?",
        textLines: ["Are you sure you want to delete this save forever?"],
        buttons: [
          {
            text: "Yes",
            onClick: async () => {
              await deleteGameStatus(selectedSave);
              // await this.setStateP((state) => ({
              //   saves: { ...state.saves, [selectedSave]: undefined },
              // }));
              await this.load();
              await this.dismissModal();
            },
          },
          {
            text: "No",
            onClick: async () => {
              await this.dismissModal();
            },
          },
        ],
      } as ModalConfig,
    }));
  };

  onPlayerReady = (player: IAudioPlayer) => {
    this.setStateP(() => ({ player }));
  };

  onLoadAudio = () => {
    this.setStateP(() => ({ allAudioLoaded: true }));
    this.state.player?.playAudio(AudioSources.Theme, { loop: true });
  };

  onToggleMute = () => {
    this.setStateP(() => ({ muted: !this.state.muted }));
  };

  isReady = () => {
    return this.state.player !== null && this.state.allAudioLoaded;
  };

  onLoadedImages = () => {
    // TODO
  };

  dismissModal = async () => {
    await this.setStateP(() => ({
      deleteModal: null,
    }));
  };

  onReturnToMenu = async () => {
    await this.load();
    await this.setStateP(() => ({
      selectedSave: null,
    }));
  };

  toggleCredits = () => {
    this.setStateP((state) => ({
      showCredits: !state.showCredits,
    }));
  };

  getContents = () => {
    const { saves, selectedSave, allAudioLoaded, showLanding, showCredits } = this.state;
    if (saves === null || !allAudioLoaded) {
      return null;
    }
    if (showLanding) {
      return <Landing duration={this.landingDuration} onClose={this.onCloseLanding} />;
    }

    const save = this.getCurrentSave();
    if (selectedSave && save) {
      return (
        <App
          onMenu={this.onReturnToMenu}
          netmap={netmap}
          loadedSave={save}
          onSave={this.getSaveFn(selectedSave)}
        />
      );
    }
    const topEl = !this.state.showCredits ? (
      <div className="saves-container">
        {saveFileNames.map((x, i) => (
          <SaveSelector
            key={i}
            onDelete={this.createOnDeleteSave(x)}
            onSelect={this.createOnSelectSave(x)}
            save={saves[x]}
            saveName={x}
          />
        ))}
      </div>
    ) : (
      <GameCredits />
    );
    return (
      <>
        {topEl}
        <div className="credits-container">
          <Button onClick={this.toggleCredits} isBold>
            {this.state.showCredits ? "Menu" : "Credits"}
          </Button>
        </div>
      </>
    );
  };

  render() {
    const contents = this.getContents();

    return (
      <>
        {this.state.deleteModal && (
          <Modal
            dismiss={this.dismissModal}
            {...this.state.deleteModal}
            buttonsOrientation="VERTICAL"
          />
        )}
        <ImageLoader imgs={ImageList} onDone={this.onLoadedImages} />
        <AudioPlayer muted={this.state.muted} onReady={this.onPlayerReady}></AudioPlayer>
        <div className="App">
          <div className="container">
            {this.state.player && (
              <AudioContext.Provider value={{ player: this.state.player }}>
                <AudioLoader onLoad={this.onLoadAudio} />
                {contents}
              </AudioContext.Provider>
            )}
          </div>
        </div>
      </>
    );
  }
}
