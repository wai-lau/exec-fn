import React from "react";

import "./ProgramMenu.css";
import { resolveImage } from "../util/util";

interface IStaticMenuOptions {
  imageSrc: string;
  title: string;
  description: string;
}
const options: Record<StaticMenuType, IStaticMenuOptions> = {
  UploadZone: {
    imageSrc: resolveImage("grid/upload-zone.png"),
    title: "Upload Zone".toUpperCase(),
    description: "Upload your programs here",
  },

  Credit: {
    imageSrc: resolveImage("grid/credit.png"),
    title: "Credits".toUpperCase(),
    description: "Pick this up for extra cash",
  },

  DataItem: {
    imageSrc: resolveImage("grid/data.png"),
    title: "Data Item".toUpperCase(),
    description: "Collect this to win the battle",
  },
};

export enum StaticMenuType {
  UploadZone = "UploadZone",
  Credit = "Credit",
  DataItem = "DataItem",
}

interface StaticMenuProps {
  type: StaticMenuType;
}

const StaticMenu = ({ type }: StaticMenuProps) => (
  <div className="pm-container">
    <div className="pm-header">
      <div className="pm-icon">
        <img alt="Upload Zone" src={options[type].imageSrc}></img>
      </div>
    </div>
    <h3 className="pm-title">{options[type].title}</h3>
    <p className="pm-description">{options[type].description}</p>
  </div>
);

export default StaticMenu;
