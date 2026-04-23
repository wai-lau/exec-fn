import React from "react";
import "./Hackerman.css";
import { HeaderBox } from "./HeaderBox";

interface HackermanProps {
  text: string;
}

interface HackermanState {
  text: string;
  index: number;
}

export default class Hackerman extends React.Component<HackermanProps, HackermanState> {
  updateInterval: ReturnType<typeof setInterval> | null;
  divRef: React.RefObject<HTMLDivElement>;
  updateDelay = 100;
  maxLength = 2000;

  constructor(props: HackermanProps) {
    super(props);

    const shufText = props.text
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");

    this.state = {
      index: 0,
      text: shufText,
    };

    this.updateInterval = null;
    this.divRef = React.createRef();
  }

  componentDidMount() {
    this.updateInterval = setInterval(() => {
      this.setState((state) => ({
        index: (state.index + 1) % this.state.text.length,
      }));
      requestAnimationFrame(() => {
        this.divRef.current && (this.divRef.current.scrollTop = 99999999);
      });
    }, this.updateDelay);
  }

  componentWillUnmount() {
    this.updateInterval && clearInterval(this.updateInterval);
  }

  render() {
    return (
      <HeaderBox title="connection.log">
        <div ref={this.divRef} className="hackerman-container">
          <div className="hackerman">{this.state.text.slice(0, this.state.index)}</div>
        </div>
      </HeaderBox>
    );
  }
}
