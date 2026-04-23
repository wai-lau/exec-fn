import React from "react";
import { HeaderBox } from "./HeaderBox";
import { ISMARTData } from "../types";

import "./SMART.css";
import Button, { ButtonBorder, ButtonColor } from "./Button";

interface SMARTProps {
  onClose: () => void;
  data: ISMARTData;
}

const SMART: React.FunctionComponent<SMARTProps> = (props) => {
  return (
    <div className="SMART-container">
      <div className="SMART">
        <HeaderBox title="S.M.A.R.T HQ">
          <div className="SMART-body">
            {props.data.text.map((x, i) => (
              <p key={i}>{x}</p>
            ))}
            <Button
              isBold
              playSound
              onClick={props.onClose}
              border={ButtonBorder.Gradient}
              bgColor={ButtonColor.LightBlueGradient}
            >
              Done
            </Button>
          </div>
        </HeaderBox>
      </div>
    </div>
  );
};

export default SMART;
