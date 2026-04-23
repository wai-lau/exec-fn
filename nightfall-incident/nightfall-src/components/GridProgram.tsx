// TODO: convert to stateless
// TODO: make isHead, isSelectable, isActive, isInTurn, hasActed less repetitive.

import React, { CSSProperties } from "react";
import cn from "classnames";
import "./GridProgram.css";

import { Coordinate, IGridActiveProgram } from "../types";
import {
  coordinatesEqual,
  coordinateKey,
  resolveImage,
  coordinateInArray,
  coordinateArrayUniq,
} from "../util/util";

interface GridProgramProps extends IGridActiveProgram {
  onClickHead: () => void;
  hasSelectedAction?: boolean;
  isActive: boolean;
  isInTurn: boolean;
}

interface GridProgramState {
  fadingTiles: FadingTile[];
}

type FadingTile = {
  at: Coordinate;
  id: number;
};

class GridProgram extends React.Component<GridProgramProps, GridProgramState> {
  static fadeDuration = 100;

  ID_MONOTONIC: number;

  constructor(props: GridProgramProps) {
    super(props);
    this.ID_MONOTONIC = 0;
    this.state = {
      fadingTiles: [],
    };
  }

  getFadeID = () => this.ID_MONOTONIC++;

  componentDidUpdate = (props: GridProgramProps, _: GridProgramState) => {
    const { body } = this.props;
    const { body: prevBody } = props;

    const missingTiles = prevBody.filter((c) => !coordinateInArray(c, body));
    const newTiles = body.filter((c) => !coordinateInArray(c, prevBody));
    if (newTiles.length !== 0 || missingTiles.length === 0) {
      return;
    }

    missingTiles.forEach((c) => {
      const id = this.getFadeID();
      const newTile = { at: c, id };
      this.setState((state) => ({
        fadingTiles: [...state.fadingTiles, newTile],
      }));

      setTimeout(() => {
        this.deleteFadingTile(id);
      }, GridProgram.fadeDuration);
    });
  };

  deleteFadingTile = (id: number) => {
    this.setState((state) => {
      const { fadingTiles } = state;
      const delIndex = fadingTiles.findIndex((f) => f.id === id);
      if (delIndex === -1) {
        throw new Error("No fade with id found: " + id);
      }
      return {
        fadingTiles: [...fadingTiles.slice(0, delIndex), ...fadingTiles.slice(delIndex + 1)],
      };
    });
  };

  renderFadingTiles = () => {
    const { color } = this.props;
    const fadeStyle: CSSProperties = { animationDuration: GridProgram.fadeDuration + "ms" };
    return this.state.fadingTiles.map((f) => {
      const { at, id } = f;
      const [x, y] = at;
      const style: CSSProperties = {
        backgroundColor: color,
        gridRow: y + 1,
        gridColumn: x + 1,
        ...fadeStyle,
      };
      return <div className="grid-program fading" style={style} key={id} />;
    });
  };

  renderTiles() {
    const {
      head,
      name,
      iconImageFile,
      isSelectable,
      isActive,
      hasActed,
      maxSize,
      body,
      isInTurn,
      color,
      hasSelectedAction,
      team,
    } = this.props;
    return body.map((c, i) => {
      const [x, y] = c;

      const colorStyle = {
        backgroundColor: color,
      };
      const style = {
        ...colorStyle,
        gridRow: y + 1,
        gridColumn: x + 1,
      };

      const key = coordinateKey(c);
      const isHead = coordinatesEqual(c, head);

      const className = cn([
        "grid-program",
        { head: isHead },
        { selectable: isSelectable },
        { active: isInTurn && isActive && isHead },
        { done: isInTurn && isHead && hasActed },
        {
          flickering:
            !isHead && i === maxSize - 1 && !hasSelectedAction && isActive && team === "P1",
        },
      ]);
      const onClick = isSelectable && isHead ? this.props.onClickHead : () => {};

      const iconStyle = {
        backgroundImage: `url(${iconImageFile})`,
      };

      const iconEl = isHead && <div style={iconStyle} className="icon" />;

      const upperCoordinate = [c[0], c[1] - 1] as Coordinate,
        rightCoordinate = [c[0] + 1, c[1]] as Coordinate;
      const upperLinkEl = coordinateInArray(upperCoordinate, body) && (
        <div style={colorStyle} className="link upper-link"></div>
      );
      const rightLinkEl = coordinateInArray(rightCoordinate, body) && (
        <div style={colorStyle} className="link right-link"></div>
      );

      const shadowEl = <div className="shadow" style={colorStyle} />;

      const dataProp = {
        "data-name": name,
        "data-coord": x + "," + y,
      };

      return (
        <div {...dataProp} onClick={onClick} className={className} style={style} key={key}>
          {iconEl}
          {upperLinkEl}
          {rightLinkEl}
          {shadowEl}
        </div>
      );
    });
  }

  render() {
    const tileElements = this.renderTiles();
    const fadeElements = this.renderFadingTiles();
    return (
      <>
        {tileElements}
        {fadeElements}
      </>
    );
  }
}

export default GridProgram;
