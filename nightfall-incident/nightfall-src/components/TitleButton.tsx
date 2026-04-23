import React from "react";
import CSS from "csstype";
import cn from "classnames";
import { AudioContext, IAudioContext } from "../util/AudioContext";
import * as AudioSources from "../audio/audioSources";

import "./TitleButton.css";

interface ButtonProps {
  className?: React.HTMLAttributes<HTMLButtonElement>["className"];
  style?: CSS.Properties;
  onClick: React.DOMAttributes<HTMLButtonElement>["onClick"];
  playSound?: boolean;
}

export default class TitleButton extends React.Component<ButtonProps> {
  static contextType = AudioContext;
  audioContext: IAudioContext;

  constructor(props: ButtonProps) {
    super(props);
    this.audioContext = this.context;
  }

  componentDidMount() {
    this.audioContext = this.context;
  }

  getOnClick = () => async (evt: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    if (this.props.playSound !== false) {
      await this.audioContext.player.playAudio(AudioSources.ButtonNormal);
    }
    if (!this.props.onClick) {
      return;
    }
    this.props.onClick(evt);
  };

  render() {
    const { children, style, className: propsClassName } = this.props;

    const className = cn(["TitleButton", propsClassName]);

    const onClick = this.getOnClick();

    return (
      <button className={className} onClick={onClick} style={style}>
        <span className="button-text">{children}</span>
      </button>
    );
  }
}
