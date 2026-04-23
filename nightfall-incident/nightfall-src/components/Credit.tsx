import React from "react";
import { IGridCredit } from "../types";

import "./Credit.css";

interface CreditProps extends IGridCredit {
  onClick: () => void;
}

export default function Credit(props: CreditProps) {
  const { position, onClick } = props;
  const style = {
    gridRow: position[1] + 1,
    gridColumn: position[0] + 1,
  };
  return (
    <div className="credit" style={style} onClick={onClick}>
      <div className="credit-icon"></div>
    </div>
  );
}
