import React from "react";

import { AudioContext, IAudioContext } from "../util/AudioContext";
import * as AudioSources from "../audio/audioSources";

interface AudioLoaderProps {
  onLoad: () => void;
}
interface AudioLoaderState {
  hasReceivedContext: boolean;
}
export default class AudioLoader extends React.Component<AudioLoaderProps, AudioLoaderState> {
  static contextType = AudioContext;
  constructor(props: AudioLoaderProps) {
    super(props);
    this.state = {
      hasReceivedContext: false,
    };
  }

  componentDidMount() {
    this.loadAudio();
  }

  async loadAudio() {
    const loadPromises = Object.values(AudioSources).map((source) =>
      this.context.player.loadAudio(source)
    );
    await Promise.all(loadPromises);
    this.props.onLoad();
  }

  render() {
    return <div></div>;
  }
}
