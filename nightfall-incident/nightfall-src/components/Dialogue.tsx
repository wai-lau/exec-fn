import React from "react";
import cn from "classnames";
import { IDialogue } from "../types";
import { HeaderBox } from "./HeaderBox";
import Button, { ButtonColor } from "./Button";

import "./Dialogue.css";

interface DialogueProps extends IDialogue {
  onEnd: (didComplete: boolean) => void;
  noBleep?: boolean;
  passthrough?: boolean;
}

interface DialogueState {
  current: number;
}

class Dialogue extends React.Component<DialogueProps, DialogueState> {
  bleepRegex = /(\~+)/g;

  constructor(props: DialogueProps) {
    super(props);

    this.state = {
      current: props.startStage,
    };
  }

  forceNextStage = () => {
    this.setState((state) => ({
      current: state.current + 100 - (state.current % 100),
    }));
  };

  getCurrentEntry = () => {
    const { entries } = this.props;
    const { current } = this.state;
    const currentEntry = entries.find((e) => e.stage === current);
    if (!currentEntry) {
      throw new Error("No entry found with stage number " + current);
    }
    return currentEntry;
  };

  createSetStage = (current: number) => async () => {
    if (current === this.props.endStage || current === 0) {
      this.props.onEnd(current !== 0);
      return;
    }
    this.setState(() => ({ current }));
  };

  renderButtons() {
    const currentEntry = this.getCurrentEntry();
    const { buttons } = currentEntry;
    return buttons.map((b, i) => {
      const onClick = this.createSetStage(b.to);
      return (
        <Button isBold={false} key={i} bgColor={ButtonColor.LightBlueGradient} onClick={onClick}>
          {b.text}
        </Button>
      );
    });
  }

  renderText() {
    const { text } = this.getCurrentEntry();
    if (this.props.noBleep) {
      return text;
    }
    const splits = text.split(this.bleepRegex);
    return splits.map((x, i) => {
      return x.match(this.bleepRegex) ? (
        <span key={i} className="dialogue-text-bleep">
          {x}
        </span>
      ) : (
        <span key={i} className="dialogue-text-nobleep">
          {x}
        </span>
      );
    });
  }

  render() {
    const { name, image } = this.props.character;
    const buttonEls = this.renderButtons();

    const characterStyle = {
      backgroundImage: `url(${image})`,
    };

    const containerClassName = cn([
      "dialogue-container",
      { passthrough: !!this.props.passthrough },
    ]);

    return (
      <div className={containerClassName}>
        <HeaderBox title="message">
          <div className="dialogue-content">
            <div className="dialogue-header">
              <div className="dialogue-image" style={characterStyle} />
              <div className="dialogue-header-name">{name}</div>
            </div>
            <div className="dialogue-text">
              {name}: {this.renderText()}
            </div>
            <div className="dialogue-buttons">{buttonEls}</div>
          </div>
        </HeaderBox>
      </div>
    );
  }
}

export default Dialogue;
