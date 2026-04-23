import React from "react";
import { Coordinate } from "../types";
import GridProgram from "./GridProgram";
import { resolveImage } from "../util/util";

interface UploadZoneProps {
  isActive: boolean;
  onClick: () => void;
  id: string;
  team: string;
  position: Coordinate;
}

const UZ_IMAGE = resolveImage("grid/upload-zone.png");

export default class UploadZone extends React.Component<UploadZoneProps> {
  constructor(props: UploadZoneProps) {
    super(props);
  }
  render() {
    const { isActive, onClick, id, team, position } = this.props;
    return (
      <GridProgram
        isActive={isActive}
        id={id}
        team={team}
        head={position}
        body={[position]}
        onClickHead={onClick}
        isInTurn={false}
        isSelectable={true}
        name="Upload Zone" // TODO: Figure out which of these can be stripped away
        color="#ffffff"
        iconImageFile={UZ_IMAGE}
        description="Upload Your Programs Here" // TODO: Actual description
        actions={[]}
        maxSize={1}
        numMoves={0}
        hasActed={false}
        movesRemaining={0}
      />
    );
  }
}
