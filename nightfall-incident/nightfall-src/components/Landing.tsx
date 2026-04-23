import React, { CSSProperties } from "react";
import cn from "classnames";

import "./Landing.css";
import TitleButton from "./TitleButton";

interface LandingProps {
  onClose: () => void;
  duration: number;
}

interface LandingState {
  isClosing: boolean;
}

class Landing extends React.Component<LandingProps, LandingState> {
  constructor(props: LandingProps) {
    super(props);
    this.state = {
      isClosing: false,
    };
  }

  onClose = () => {
    this.setState({
      isClosing: true,
    });
    this.props.onClose();
  };

  render() {
    const landingClassname = cn(["landing", this.state.isClosing ? "fade-out" : "fade-in"]);
    const landingStyle: CSSProperties = {
      animationDuration: this.props.duration + "ms",
    };
    return (
      <div className={landingClassname} style={landingStyle}>
        <div className="landing-text">
          <h1 className="landing-title">The</h1>
          <h1 className="landing-title">Nightfall</h1>
          <h1 className="landing-title">Incident</h1>
        </div>
        <TitleButton className="landing-button" onClick={this.onClose}>
          Start
        </TitleButton>
      </div>
    );
  }
}
export default Landing;
