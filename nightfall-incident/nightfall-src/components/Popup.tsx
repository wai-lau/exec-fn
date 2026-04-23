import React from "react";

import "./Popup.css";
import { HeaderBox } from "./HeaderBox";

export type PopupConfig = {
  headerBoxTitle: string;
  text: string;
  duration?: number;
};

export interface PopupProps extends PopupConfig {
  dismiss: () => void;
}

interface ModalState {}

export default class Modal extends React.Component<PopupProps, ModalState> {
  selfDismissTimeout: ReturnType<typeof setTimeout> | null;

  constructor(props: PopupProps) {
    super(props);
    this.selfDismissTimeout = null;
  }

  componentDidMount() {
    const { duration = 2000 } = this.props;
    if (duration) {
      this.selfDismissTimeout = setTimeout(this.props.dismiss, duration);
    }
  }

  render() {
    const { headerBoxTitle, text } = this.props;

    return (
      <div className="popup">
        <HeaderBox title={headerBoxTitle}>
          <div className="popup-contents">
            <h3>{text}</h3>
          </div>
        </HeaderBox>
      </div>
    );
  }
}
