import React from "react";
import { HeaderBox } from "./HeaderBox";
import Button, { ButtonColor, ButtonBorder } from "./Button";

import "./NodeInfo.css";

export interface NodeInfoProps {
  logoImage: string;
  name: string;
  securityLevel: number;
  onProceed: () => void;
}

const PostVictory: React.FunctionComponent<NodeInfoProps> = (props: NodeInfoProps) => {
  const { logoImage, name, securityLevel, onProceed } = props;

  const logoStyle = {
    backgroundImage: `url(${logoImage})`,
  };

  return (
    <div className="node-info-container">
      <HeaderBox title="node.info">
        <div className="node-info-logo" style={logoStyle} />
        <div className="node-info-text">
          <div className="node-info-stats">
            <div className="node-info-stats-left">
              <span className="node-info-name">{name}</span>
              <span className="node-info-level">Security Level: {securityLevel}</span>
            </div>
          </div>
          <h3 className="node-info-missioninfo">Mission Successful</h3>
          <p className="node-info-description">
            You have acquired control over this node and have access to its links.
          </p>
        </div>
        <div className="node-info-buttons">
          <Button
            onClick={onProceed}
            bgColor={ButtonColor.LightBlueGradient}
            border={ButtonBorder.Gradient}
            isBold
            playSound
          >
            Proceed
          </Button>
        </div>
      </HeaderBox>
    </div>
  );
};

export default PostVictory;
