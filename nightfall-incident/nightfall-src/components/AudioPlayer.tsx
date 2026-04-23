import React from "react";
import { IAudioPlayer, IPlayingAudio, IAudioSource } from "../types";
import { IAudioContext } from "../util/AudioContext";
import PComponent from "../util/PComponent";

interface AudioPlayerProps {
  onReady: (player: IAudioPlayer) => void;
  muted?: boolean;
}

interface AudioPlayerState {
  audios: IPlayingAudio[];
}

const AudioContext = window.webkitAudioContext || window.AudioContext;

// Should be the type of AudioBufferSourceNode.buffer
type DecodedBuffer = any;

class AudioPlayer extends PComponent<AudioPlayerProps, AudioPlayerState> implements IAudioPlayer {
  audioCtx = new AudioContext();
  ID_MONOTONIC: number = 0;
  interruptedIDs: IPlayingAudio["id"][] = [];
  buffers: Record<IAudioSource["name"], DecodedBuffer> = {};
  gainNodes: Record<IPlayingAudio["id"], GainNode> = {};

  constructor(props: AudioPlayerProps) {
    super(props);
    this.state = {
      audios: [],
    };
  }

  getID = () => this.ID_MONOTONIC++;

  componentDidMount() {
    this.props.onReady(this as IAudioPlayer);
  }

  loadAudio = async (source: IAudioSource) => {
    const { srcBuffer, name } = source;
    if (this.buffers[name]) {
      return true;
    }
    const data = await new Promise((resolve, reject) => {
      this.audioCtx.decodeAudioData(srcBuffer.slice(0), resolve, reject);
    });
    // Safari doesn't yet support the Promise version of decodeAudioData
    // const data = await this.audioCtx.decodeAudioData(asBuffer);
    this.buffers[name] = data;
    return true;
  };

  playAudio = async (
    source: IAudioSource,
    options: { loop?: boolean; waitForEnd?: boolean } = {}
  ) => {
    // TODO
    const buffer = this.buffers[source.name];
    if (!buffer) {
      throw new Error("Could not play unloaded audio " + source.name);
    }
    if (source.solo) {
      this.state.audios.forEach((audio) => {
        try {
          this.interruptedIDs.push(audio.id);
          if (this.gainNodes[audio.id]) {
            this.gainNodes[audio.id].disconnect();
            delete this.gainNodes[audio.id];
          }
          audio.node.stop();
        } catch (e) {
          // TODO: figure out how to check if stop will actually work - then won't need to catch
        }
      });
    }
    const bufferSource = this.audioCtx.createBufferSource();
    bufferSource.buffer = buffer;

    const id = source.name + "-" + this.getID();

    if (source.volume !== undefined) {
      const gainNode = this.audioCtx.createGain();
      gainNode.gain.setValueAtTime(source.volume, this.audioCtx.currentTime);
      bufferSource.connect(gainNode).connect(this.audioCtx.destination);
      this.gainNodes[id] = gainNode;
    } else {
      bufferSource.connect(this.audioCtx.destination);
    }

    if (options.loop) {
      bufferSource.loop = true;
    }
    await this.setStateP((state) => ({
      audios: [...state.audios, { node: bufferSource, id, source }],
    }));
    const p = new Promise<boolean>((resolve) => {
      bufferSource.addEventListener("ended", this.createOnEnd(id, resolve));
    });
    bufferSource.start(0, source.offset || 0);
    return options.waitForEnd ? p : true;
  };

  createOnEnd = (id: IPlayingAudio["id"], cb: (wasInterrupted: boolean) => void) => async () => {
    cb(!this.interruptedIDs.includes(id));
    await this.setStateP((state) => ({
      audios: [...state.audios.filter((a) => a.id !== id)],
    }));
  };

  render() {
    return null;
  }
}

export default AudioPlayer;
