import React from "react";
import cn from "classnames";
import { IGameStatus, NodeStatus } from "../types";
import { HeaderBox } from "./HeaderBox";

import "./SaveSelector.css";
import TitleButton from "./TitleButton";
import Button from "./Button";

interface SaveSelectorProps {
  save: IGameStatus | undefined;
  saveName: string;
  onSelect: () => void;
  onDelete: () => void;
}

const SaveSelector: React.FunctionComponent<SaveSelectorProps> = (props) => {
  const { save, saveName, onSelect } = props;

  const hasSave = save && save.completedTutorial;

  const contents = (
    <div className="save-info">
      {hasSave ? (
        <>
          <p>Saved Game</p>
          <br />
          <p>Credits: {save!.numCredits}</p>
          <p>Security Level: {save!.securityLevel}</p>
          <p>
            Nodes cleared:{" "}
            {Object.values(save!.netmapStatus).filter((x) => x === NodeStatus.CLEARED).length}
          </p>
        </>
      ) : (
        <p>Empty</p>
      )}
    </div>
  );

  const buttonText = hasSave ? "Continue" : "New Game";
  const buttonClassName = cn(["save-selector-delete", { invisible: !hasSave }]);

  const deleteButton = (
    <Button onClick={props.onDelete} className={buttonClassName}>
      Delete
    </Button>
  );

  return (
    <div className="save-selector">
      <HeaderBox title={saveName}>{contents}</HeaderBox>
      <TitleButton className="save-selector-button" onClick={onSelect}>
        {buttonText}
      </TitleButton>
      {deleteButton}
    </div>
  );
};

export default SaveSelector;
