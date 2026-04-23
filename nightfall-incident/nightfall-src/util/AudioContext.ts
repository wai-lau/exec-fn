import React from "react"; // TODO DONT DO THIS
import { IAudioPlayer } from "../types";
export interface IAudioContext {
  player: IAudioPlayer;
}
const NOOP_PLAYER = {
  loadAudio: () => Promise.resolve(true),
  // loopAudio: () => Promise.resolve(),
  playAudio: () => Promise.resolve(true),
} as IAudioPlayer;
export const AudioContext = React.createContext<IAudioContext>({
  player: NOOP_PLAYER,
});
