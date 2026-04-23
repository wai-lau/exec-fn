import React from "react";
import cn from "classnames";

import "./Modal.css";
import Button, { ButtonColor } from "./Button";
import { HeaderBox } from "./HeaderBox";

type ModalButton = {
  text: string;
  onClick: () => void;
};

export type ModalConfig = {
  headerBoxTitle: string;
  header: string;
  textLines?: string[];
  // TODO: make buttons and duration mutually exclusive
  buttons?: ModalButton[];
  duration?: number;
  buttonsOrientation?: "VERTICAL" | "HORIZONTAL";
};

export interface ModalProps extends ModalConfig {
  dismiss: () => void;
}

interface ModalState {}

export default class Modal extends React.Component<ModalProps, ModalState> {
  selfDismissTimeout: ReturnType<typeof setTimeout> | null;

  constructor(props: ModalProps) {
    super(props);
    this.selfDismissTimeout = null;
    if (props.buttons && props.duration) {
      console.error("Both buttons and duration were provided");
    }
  }

  componentDidMount() {
    const { duration } = this.props;
    if (duration) {
      this.selfDismissTimeout = setTimeout(this.props.dismiss, duration);
    }
  }

  renderButton = (button: ModalButton, i: number) => {
    const { text, onClick } = button;
    return (
      <Button
        playSound
        key={i}
        onClick={onClick}
        isBold
        children={text}
        bgColor={ButtonColor.LightBlueGradient}
      />
    );
  };

  render() {
    const { headerBoxTitle, header, textLines = [], buttons } = this.props;

    const linesEl = textLines.map((text, i) => {
      return (
        <p className="modal-text" key={i}>
          {text}
        </p>
      );
    });
    const headerClass = cn(["modal-header", { "modal-header-centered": textLines.length === 0 }]);
    const headerEl = <h3 className={headerClass}>{header}</h3>;

    const buttonsClass = cn([
      "modal-buttons",
      { "modal-buttons-h": this.props.buttonsOrientation === "HORIZONTAL" },
      { "modal-buttons-v": this.props.buttonsOrientation === "VERTICAL" },
    ]);
    const buttonsEl = buttons && (
      <div className={buttonsClass}>{buttons.map(this.renderButton)}</div>
    );

    return (
      <div className="modal-container">
        <div className="modal">
          <HeaderBox title={headerBoxTitle}>
            <div className="modal-contents">
              <div className="modal-text">
                {headerEl}
                {linesEl}
              </div>
            </div>
            {buttonsEl}
          </HeaderBox>
        </div>
      </div>
    );
  }
}
