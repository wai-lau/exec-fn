import React from "react";
import { HeaderBox } from "./HeaderBox";
import Button, { ButtonColor, ButtonBorder } from "./Button";

import "./NodeInfo.css";
import { NodeType } from "../types";

export interface NodeInfoProps {
  logoImage: string;
  name: string;
  securityLevel: number;
  credits?: number;
  description: string;
  type: NodeType;
  isConnected: boolean;
  isAuthorized: boolean;
  onCancel: () => void;
  onEnter: () => void;
}

const NodeInfo: React.FunctionComponent<NodeInfoProps> = (props: NodeInfoProps) => {
  const {
    type,
    logoImage,
    name,
    securityLevel,
    credits,
    description,
    isConnected,
    isAuthorized,
  } = props;

  const creditsEl =
    credits && credits > 0 ? <span className="node-info-credits">{credits}</span> : null;

  const logoStyle = {
    backgroundImage: `url(${logoImage})`,
  };

  let enterString = "";
  let title = "";
  if (type === NodeType.Battle) {
    enterString = "Databattle";
    title = "Mission Info";
  } else if (type === NodeType.WarezNode) {
    enterString = "Warez Node";
    title = "Warez Node";
  } else if (type === NodeType.SmartHQ) {
    enterString = "S.M.A.R.T HQ";
    title = "SMART Node";
  }

  const securityEl = type === NodeType.Battle && (
    <span className="node-info-level">Security Level: {securityLevel}</span>
  );

  const descriptionEl = isAuthorized ? (
    <p className="node-info-description">{description}</p>
  ) : (
    <p className="node-info-description">Insufficient Clearance - Access Denied</p>
  );

  const buttonsEl =
    isAuthorized && isConnected ? (
      <>
        <Button
          onClick={props.onCancel}
          bgColor={ButtonColor.RedGradient}
          border={ButtonBorder.Gradient}
          isBold
          playSound
        >
          Cancel
        </Button>
        <Button
          onClick={props.onEnter}
          bgColor={ButtonColor.LightBlueGradient}
          border={ButtonBorder.Gradient}
          isBold
          playSound
        >
          Enter {enterString}
        </Button>
      </>
    ) : (
      <Button
        onClick={props.onCancel}
        bgColor={ButtonColor.LightBlueGradient}
        border={ButtonBorder.Gradient}
        isBold
        playSound
      >
        Cancel
      </Button>
    );

  return (
    <>
      <div className="cursor-blocker" />
      <div className="node-info-container">
        <HeaderBox title="node.info">
          <div className="node-info-logo" style={logoStyle} />
          <div className="node-info-text">
            <div className="node-info-stats">
              <div className="node-info-stats-left">
                <span className="node-info-name">{name}</span>
                {securityEl}
              </div>
              {creditsEl}
            </div>
            <h3 className="node-info-missioninfo">{title}</h3>
            {descriptionEl}
          </div>
          <div className="node-info-buttons">{buttonsEl}</div>
        </HeaderBox>
      </div>
    </>
  );
};

export default NodeInfo;
