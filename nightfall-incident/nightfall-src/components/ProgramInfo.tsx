import React from "react";

import "./ProgramMenu.css";
import { ProgramAction, IProgram } from "../types";

interface ProgramInfoProps {
  program: IProgram | null;
  actionIndex: number | null;
  onSelectAction: (index: number) => void;
}

class ProgramInfo extends React.Component<ProgramInfoProps> {
  constructor(props: ProgramInfoProps) {
    super(props);
  }
  renderAction = (action: ProgramAction, i: number) => {
    const { sizeReq } = action;
    const actionText = sizeReq ? `${action.name} (${action.sizeReq})` : action.name;
    const onClick = () => {
      this.props.onSelectAction(i);
    };
    return (
      <div key={"action-" + action.name + "-" + i} className="pm-info-action" onClick={onClick}>
        {actionText}
      </div>
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

    return (
      <div className="pm-container">
        <div className="pm-header">
          <div className="pm-icon">
            <img alt={program.name} src={program.iconImageFile} />
            {shadowEl}
          </div>
          <div className="pm-stats">
            <div>Moves: {program.numMoves}</div>
            <div>Max Size: {program.maxSize}</div>
          </div>
        </div>
        <h3 className="pm-title">{program.name}</h3>
        <h3 className="pm-commands">Commands</h3>
        <div className="pm-actions">{program.actions.map(this.renderAction)}</div>
        {descriptionEl}
      </div>
    );
  }
}

export default ProgramInfo;
