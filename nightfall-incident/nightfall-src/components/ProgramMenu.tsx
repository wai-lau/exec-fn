import React from "react";

import "./ProgramMenu.css";
import { IGridActiveProgram, ProgramAction } from "../types";
import { resolveImage } from "../util/util";
import Button, { ButtonColor } from "./Button";

interface ProgramMenuProps {
  program: IGridActiveProgram | null;
  actionIndex: number | null;
  onSelectAction: (index: number) => void;
  onSelectNoAction: () => void;
}

class ProgramMenu extends React.Component<ProgramMenuProps> {
  constructor(props: ProgramMenuProps) {
    super(props);
  }
  renderAction = (action: ProgramAction, i: number) => {
    const { sizeReq } = action;
    const meetsSizeReq =
      !sizeReq || (this.props.program && sizeReq <= this.props.program.body.length);
    const onClick = meetsSizeReq
      ? () => {
          this.props.onSelectAction(i);
        }
      : () => {};
    const actionText = sizeReq ? `${action.name} (${action.sizeReq})` : action.name;
    return (
      <Button
        key={"action-" + action.name + "-" + i}
        bgColor={ButtonColor.LightBlueGradient}
        onClick={onClick}
      >
        {actionText}
      </Button>
    );
  };
  render() {
    const { program, actionIndex } = this.props;
    if (!program) {
      return null;
    }

    const action = actionIndex === null ? null : program.actions[actionIndex];
    const descriptionEl = action ? (
      <div className="pm-action-info">
        <div className="pm-action-title">{action.name}</div>
        <div className="pm-description">
          {action.range > 1 && <span className="pm-action-req">Range: {action.range}</span>}
          {action.sizeReq && <span className="pm-action-req">Size Required: {action.sizeReq}</span>}
          {action.description}
        </div>
      </div>
    ) : (
      <p className="pm-description">{program.description}</p>
    );

    const colorStyle = { backgroundColor: program.color };

    const shadowEl = <div className="pm-icon-shadow" style={colorStyle} />;

    const numMovesText = program.numMoves + (program.numMoves === 10 ? " (Max)" : "");

    return (
      <div className="pm-container">
        <div className="pm-header">
          <div className="pm-icon">
            <img alt={program.name} src={program.iconImageFile} />
            {shadowEl}
          </div>
          <div className="pm-stats">
            <div>Move: {numMovesText}</div>
            <div>Max Size: {program.maxSize}</div>
            <div>Current Size: {program.body.length}</div>
          </div>
        </div>
        <h3 className="pm-title">{program.name}</h3>
        <h3 className="pm-commands">Commands</h3>
        <div className="pm-actions">
          {program.actions.map(this.renderAction)}
          <Button onClick={this.props.onSelectNoAction} bgColor={ButtonColor.DarkBlueGradient}>
            No Action
          </Button>
        </div>
        {descriptionEl}
      </div>
    );
  }
}

export default ProgramMenu;
