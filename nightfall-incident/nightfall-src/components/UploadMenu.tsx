import React from "react";
import cn from "classnames";

import { AudioContext, IAudioContext } from "../util/AudioContext";
import * as AudioSources from "../audio/audioSources";
import { IProgram } from "../types";

import "./UploadMenu.css";

interface UploadMenuProps {
  programs: IProgram[];
  selectedIndexes?: number[];
  onSelectProgram: (i: number) => void;
}

interface UploadMenuState {
  // TODO: counts?
}

export default class UploadMenu extends React.Component<UploadMenuProps, UploadMenuState> {
  static contextType = AudioContext;
  static scrollSpeed = 6;

  audioContext: IAudioContext;
  menuItemsRef: React.RefObject<HTMLDivElement>;
  scrollDirection: "UP" | "DOWN" | null;

  constructor(props: UploadMenuProps) {
    super(props);
    this.menuItemsRef = React.createRef<HTMLDivElement>();
    this.scrollDirection = null;
    this.audioContext = this.context;
  }

  componentDidMount = () => {
    this.audioContext = this.context;
  };

  getCounts = () => {
    const { programs } = this.props;
    // TODO rename
    const filteredPrograms = programs.map((p, i) => ({ program: p, i }));
    let counts: { [id: string]: number[] } = {};
    filteredPrograms.forEach((entry) => {
      const { program, i } = entry;
      const { id } = program;
      if (counts[id]) {
        counts[id].push(i);
      } else {
        counts[id] = [i];
      }
    });
    return counts;
  };

  renderProgramEntries = () => {
    const { programs, onSelectProgram, selectedIndexes = [] } = this.props;
    const counts = this.getCounts();
    return Object.entries(counts).map(([id, indexes]) => {
      const program = programs.find((p) => p.id === id);
      if (!program) {
        throw new Error("Invalid program ID " + id);
      }
      if (!indexes) {
        throw new Error("ID " + id + " was listed with no indexes");
      }
      const filteredIndexes = indexes.filter((i) => !selectedIndexes.includes(i));
      const onClick = filteredIndexes.length
        ? async () => {
            await this.audioContext.player.playAudio(AudioSources.UploadProgram);
            onSelectProgram(filteredIndexes[0]);
          }
        : () => {};
      const className = cn([
        "ul-item",
        {
          clickable: !!filteredIndexes.length,
        },
      ]);
      return (
        <div className={className} onClick={onClick} key={id} data-name={program.name}>
          {program.name} x{filteredIndexes.length}
        </div>
      );
    });
  };

  createOnScroll = (direction: "UP" | "DOWN") => () => {
    window.addEventListener("mouseup", this.endScroll);
    window.addEventListener("touchend", this.endScroll);
    this.scrollDirection = direction;
    this.updateScroll();
  };

  endScroll = () => {
    this.scrollDirection = null;
  };

  updateScroll = async () => {
    if (this.scrollDirection === null) {
      return;
    }
    const itemsEl = this.menuItemsRef.current;
    if (!itemsEl) {
      throw new Error("No ref");
    }
    if (this.scrollDirection === "UP") {
      itemsEl.scrollBy({ top: -1 * UploadMenu.scrollSpeed });
    } else if (this.scrollDirection === "DOWN") {
      itemsEl.scrollBy({ top: UploadMenu.scrollSpeed });
    }
    requestAnimationFrame(this.updateScroll);
  };

  render() {
    // TODO: UI
    return (
      <div className="ul-menu">
        <div className="ul-menu-items" ref={this.menuItemsRef}>
          {this.renderProgramEntries()}
        </div>
        <div className="ul-menu-scroll">
          <div className="ul-menu-scroll-up" onMouseDown={this.createOnScroll("UP")}></div>
          <div className="ul-menu-scroll-down" onMouseDown={this.createOnScroll("DOWN")}></div>
        </div>
      </div>
    );
  }
}
