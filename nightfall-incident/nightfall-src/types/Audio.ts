export enum PlayType {
  Once = 1,
  Loop = 2,
}

export interface IAudioSource {
  solo?: boolean;
  srcBuffer: ArrayBuffer;
  name: string;
  volume?: number;
  offset?: number;
}

export enum AudioStatus {
  Load,
  Ready,
  Play,
  Pause,
}

export interface IPlayingAudio {
  source: IAudioSource;
  node: AudioBufferSourceNode;
  id: string;
}

export interface IAudioPlayer {
  loadAudio: (source: IAudioSource) => Promise<boolean>;
  playAudio: (
    source: IAudioSource,
    options?: { loop?: boolean; waitForEnd?: boolean }
  ) => Promise<boolean>;
}
