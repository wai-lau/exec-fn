import { IAudioSource } from "../types";

export const __TODO__: IAudioSource = {
  solo: true,
  srcBuffer: require("./hover-c.mp3"),
  name: "__TODO__",
};

export const Theme: IAudioSource = {
  solo: true,
  srcBuffer: require("./theme.wav"),
  name: "theme",
  volume: 0.8,
};

export const Netmap: IAudioSource = {
  solo: true,
  srcBuffer: require("./netmap.mp3"),
  name: "netmap",
  volume: 0.4,
};

export const Move: IAudioSource = {
  srcBuffer: require("./move.mp3"),
  name: "move",
};

export const Attack: IAudioSource = {
  srcBuffer: require("./attack.mp3"),
  name: "attack",
};

export const BitFlip: IAudioSource = {
  srcBuffer: require("./bitflip.mp3"),
  name: "bitflip",
};

export const Heal: IAudioSource = {
  srcBuffer: require("./heal.mp3"),
  name: "heal",
};

export const Loop1: IAudioSource = {
  solo: true,
  srcBuffer: require("./loop-1.mp3"),
  name: "loop-1",
  volume: 0.4,
};

export const Loop2: IAudioSource = {
  solo: true,
  srcBuffer: require("./loop-2.mp3"),
  name: "loop-2",
  volume: 0.4,
};

export const Loop3: IAudioSource = {
  solo: true,
  srcBuffer: require("./loop-3.mp3"),
  name: "loop-3",
  volume: 0.4,
};

export const Loop4: IAudioSource = {
  solo: true,
  srcBuffer: require("./loop-4.mp3"),
  name: "loop-4",
  volume: 0.4,
};

export const ProgramReady: IAudioSource = {
  srcBuffer: require("./program-ready.mp3"),
  name: "program-ready",
};

export const SelectAction: IAudioSource = {
  srcBuffer: require("./select-action.mp3"),
  name: "select-action",
};

// TODO: Identical to SelectAction?
export const NoAction: IAudioSource = {
  srcBuffer: require("./select-action.mp3"),
  name: "select-action",
};

// TODO: Identical to SelectAction?
export const ButtonNormal: IAudioSource = {
  srcBuffer: require("./select-action.mp3"),
  name: "select-action",
};

export const Disconnect: IAudioSource = {
  srcBuffer: require("./disconnect.mp3"),
  name: "disconnect",
  solo: true,
  volume: 0.6,
};

export const Success: IAudioSource = {
  srcBuffer: require("./success.mp3"),
  name: "success",
  solo: true,
};

export const Credit: IAudioSource = {
  srcBuffer: require("./credit.mp3"),
  name: "credit",
};

export const HoverC: IAudioSource = {
  srcBuffer: require("./hover-c.mp3"),
  name: "hover-c",
};

export const HoverEb: IAudioSource = {
  srcBuffer: require("./hover-eb.mp3"),
  name: "hover-eb",
};

export const HoverF: IAudioSource = {
  srcBuffer: require("./hover-f.mp3"),
  name: "hover-f",
};

export const LMMIntro: IAudioSource = {
  solo: true,
  srcBuffer: require("./lmm-intro.mp3"),
  name: "lmm-intro",
};

export const PHIntro: IAudioSource = {
  solo: true,
  srcBuffer: require("./ph-intro.mp3"),
  name: "ph-intro",
};

export const CARIntro: IAudioSource = {
  solo: true,
  srcBuffer: require("./car-intro.mp3"),
  name: "car-intro",
};

export const PEDIntro: IAudioSource = {
  solo: true,
  srcBuffer: require("./ped-intro.mp3"),
  name: "ped-intro",
};

export const DonutIntro: IAudioSource = {
  solo: true,
  srcBuffer: require("./donut-intro.mp3"),
  name: "donut-intro",
};

export const DisarrayIntro: IAudioSource = {
  solo: true,
  srcBuffer: require("./disarray-intro.mp3"),
  name: "disarray-intro",
};

export const IntroNoise: IAudioSource = {
  solo: false,
  srcBuffer: require("./intro-noise.mp3"),
  name: "intro-noise",
  volume: 0.6,
};

export const Zap: IAudioSource = {
  srcBuffer: require("./zap.mp3"),
  name: "zap",
};

export const Clog: IAudioSource = {
  srcBuffer: require("./clog.mp3"),
  name: "clog",
};

export const Grow: IAudioSource = {
  srcBuffer: require("./grow.mp3"),
  name: "grow",
};

export const UploadProgram: IAudioSource = {
  srcBuffer: require("./upload-program.mp3"),
  name: "upload-program",
};

export const Received: IAudioSource = {
  srcBuffer: require("./received.mp3"),
  name: "received",
};
