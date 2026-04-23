import React from "react";
import { resolveImage } from "../util/util";

import "./DataPack.css";
import { Coordinate } from "../types";

interface DataPack {
  position: Coordinate;
  onClick: () => void;
}

export default function DataPack(props: DataPack) {
  const { position, onClick } = props;
  const style = {
    gridRow: position[1] + 1,
    gridColumn: position[0] + 1,
  };
  return (
    <div className="data-pack" style={style} onClick={props.onClick}>
      <div className="datapack-icon"></div>
    </div>
  );
}
