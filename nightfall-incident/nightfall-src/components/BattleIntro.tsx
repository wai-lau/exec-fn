import React, { CSSProperties } from "react";
import { IBattleStyle } from "../types";

import "./BattleIntro.css";
import Button, { ButtonColor } from "./Button";
import { AudioContext, IAudioContext } from "../util/AudioContext";
import * as AudioSources from "../audio/audioSources";

interface BattleIntroProps {
  battleStyle: IBattleStyle;
  dismissIntro: () => void;
}

interface BattleIntroState {
  buttonReady: boolean;
}

class BattleIntro extends React.Component<BattleIntroProps, BattleIntroState> {
  static contextType = AudioContext;

  audioContext: IAudioContext;

  animDuration = 1000;
  animDelay = 250;

  constructor(props: BattleIntroProps) {
    super(props);

    this.state = {
      buttonReady: false,
    };

    this.audioContext = this.context;
  }

  async componentDidMount() {
    this.audioContext = this.context;
    await this.audioContext.player.playAudio(this.props.battleStyle.introAudio, {
      waitForEnd: false,
    });
    await this.audioContext.player.playAudio(AudioSources.IntroNoise);
    setTimeout(() => {
      this.setState({ buttonReady: true });
    }, this.animDuration + this.animDelay);
  }

  render() {
    const { battleStyle, dismissIntro } = this.props;
    const { warningHeader, warningText, battleLogoImage: logoImage } = battleStyle;
    const logoStyle = {
      backgroundImage: `url(${logoImage})`,
    };

    const loadingStyle: CSSProperties = {
      animationDelay: this.animDelay + "ms",
      animationDuration: this.animDuration + "ms",
    };
    return (
      <div className="battle-intro">
        <div className="battle-intro-container">
          <div className="battle-intro-block">
            <div className="battle-intro-logo" style={logoStyle} />
            <h3 className="battle-intro-header">{warningHeader}</h3>
            <h3 className="battle-warning">Warning</h3>
            {warningText.map((x, i) => (
              <p className="battle-intro-text" children={x} key={i} />
            ))}
          </div>
          <div className="battle-intro-bottom">
            <div className="battle-intro-bar">
              <div className="battle-intro-loading" style={loadingStyle} />
            </div>
            <Button
              isBold
              bgColor={ButtonColor.GreenGradient}
              onClick={dismissIntro}
              playSound={false}
              style={{ opacity: this.state.buttonReady ? 1 : 0 }}
            >
              Proceed
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default BattleIntro;
