import * as AudioSources from "../audio/audioSources";
import { IAudioShufflerConfig } from "../util/AudioShuffler";

export const DatabattleConfig: IAudioShufflerConfig = {
  entries: [
    {
      canStart: true,
      id: "loop1",
      minPlay: 2,
      maxPlay: 4,
      source: AudioSources.Loop1,
      transitions: {
        loop2: 0.6,
        loop3: 0.2,
        loop4: 0.2,
      },
    },
    {
      canStart: true,
      id: "loop2",
      minPlay: 2,
      maxPlay: 4,
      source: AudioSources.Loop2,
      transitions: {
        loop3: 0.5,
        loop1: 0.2,
        loop4: 0.3,
      },
    },
    {
      canStart: true,
      id: "loop3",
      minPlay: 2,
      maxPlay: 4,
      source: AudioSources.Loop3,
      transitions: {
        loop4: 0.8,
        loop1: 0.1,
        loop2: 0.1,
      },
    },
    {
      id: "loop4",
      minPlay: 2,
      maxPlay: 4,
      source: AudioSources.Loop4,
      transitions: {
        loop1: 0.7,
        loop2: 0.2,
        loop3: 0.1,
      },
    },
  ],
};
