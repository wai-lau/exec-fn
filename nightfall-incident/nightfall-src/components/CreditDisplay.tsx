import React, { FunctionComponent } from "react";

import "./HeaderBox.css";
import "./CreditDisplay.css";

interface CreditDisplayProps {
  numCredits: number;
}

export const CreditDisplay: FunctionComponent<CreditDisplayProps> = (props) => {
  const { numCredits } = props;

  return (
    <div className="header-box">
      <div className="header-box-header">
        <span className="header-box-arrow"></span>
        <span className="header-box-title">credits: </span>
        <span className="credits-green">{numCredits}</span>
      </div>
    </div>
  );
};
