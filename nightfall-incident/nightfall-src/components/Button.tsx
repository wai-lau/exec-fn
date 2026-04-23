import React from "react";
import CSS from "csstype";
import cn from "classnames";
import { AudioContext, IAudioContext } from "../util/AudioContext";
import * as AudioSources from "../audio/audioSources";

import "./Button.css";

export enum ButtonColor {
  LightBlueGradient,
  DarkBlueGradient,
  GreenGradient,
  RedGradient,
}

export enum ButtonBorder {
  Solid,
  Gradient,
}

interface ButtonProps {
  className?: React.HTMLAttributes<HTMLButtonElement>["className"];
  style?: CSS.Properties;
  onClick: React.DOMAttributes<HTMLButtonElement>["onClick"];
  isBold?: boolean;
  unclickable?: boolean;
  bgColor?: CSS.BackgroundProperty<any>; // TODO: What is TLength???
  border?: ButtonBorder;
  playSound?: boolean;
}

class Button extends React.Component<ButtonProps> {
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
    if (this.props.unclickable) {
      return false;
    }
    if (this.props.playSound !== false) {
      await this.audioContext.player.playAudio(AudioSources.ButtonNormal);
    }
    if (!this.props.onClick) {
      return;
    }
    this.props.onClick(evt);
  };

  render() {
    const {
      children,
      style,
      className: propsClassName,
      bgColor = ButtonColor.DarkBlueGradient,
      border = ButtonBorder.Gradient,
      isBold = false,
      unclickable = false,
    } = this.props;

    const className = cn([
      "Button",
      propsClassName,
      isBold && "bold",
      unclickable && "unclickable",
      bgColor === ButtonColor.DarkBlueGradient && "bg-gradient-dark-blue",
      bgColor === ButtonColor.LightBlueGradient && "bg-gradient-light-blue",
      bgColor === ButtonColor.GreenGradient && "bg-gradient-green",
      bgColor === ButtonColor.RedGradient && "bg-gradient-red",
      border === ButtonBorder.Solid && "border-solid",
      border === ButtonBorder.Gradient && "border-gradient",
    ]);

    const onClick = this.getOnClick();

    return (
      <button className={className} onClick={onClick} style={style}>
        <span className="button-text">{children}</span>
      </button>
    );
  }
}

export default Button;
