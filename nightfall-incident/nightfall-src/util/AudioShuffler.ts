import { IAudioSource, IAudioPlayer } from "../types";

interface IAudioShuffleEntry {
  id: string;
  canStart?: boolean;
  minPlay: number;
  maxPlay: number;
  source: IAudioSource;
  transitions: { [toID: string]: number };
}

export interface IAudioShufflerConfig {
  entries: IAudioShuffleEntry[];
}

class AudioShuffler {
  player: IAudioPlayer;
  config: IAudioShufflerConfig;
  currentEntry: IAudioShuffleEntry | null = null;
  playCount: number | null = null;

  constructor(player: IAudioPlayer, config: IAudioShufflerConfig) {
    this.player = player;
    this.config = config;
  }

  next = () => {
    if (!this.currentEntry) {
      throw new Error("Cannot go to next entry if current entry is null");
    }
    let random = Math.random();
    for (let [id, probability] of Object.entries(this.currentEntry.transitions)) {
      random -= probability;
      if (random < 0) {
        const nextEntry = this.config.entries.find((e) => e.id === id);
        if (!nextEntry) {
          throw new Error("No entry found with id " + id);
        }
        this.currentEntry = nextEntry;
        break;
      }
    }
    if (random > 0) {
      throw new Error("Error: Probabilities did not total to 1");
    }

    this.playCount = 0;
  };

  private startLoop = () => {
    if (this.playCount) {
      return;
    }
    (async () => {
      let success;
      this.playCount = 0;
      if (!this.currentEntry) {
        throw new Error("Cannot play if current entry is null");
      }
      while (
        (success = await this.player.playAudio(this.currentEntry.source, { waitForEnd: true }))
      ) {
        this.playCount++;
        if (
          this.playCount >= this.currentEntry.minPlay &&
          Math.random() < 1 / (this.currentEntry.maxPlay - this.playCount + 1)
        ) {
          this.next();
        }
        if (!success) {
          break;
        }
      }
    })();
  };

  play = () => {
    const canStartEntries = this.config.entries.filter((e) => e.canStart);
    if (!canStartEntries.length) {
      throw new Error("Error: No entries were allowed to start");
    }

    const startEntry = canStartEntries[Math.floor(Math.random() * canStartEntries.length)];
    this.currentEntry = startEntry;

    this.startLoop();
  };
}

export default AudioShuffler;
