import React, { CSSProperties } from "react";
import { Coordinate } from "../types";

import "./AttackAnimation.css";
import { delay } from "../util/util";

interface AttackAnimationProps {
  position: Coordinate;
  onCompleteCallback: () => {};
}

type Offset = { position: number; angle: number };

export default class AttackAnimation extends React.Component<AttackAnimationProps> {
  static duration = 400;

  offsets: Offset[];
  durationStyle: CSSProperties;

  numSquares = 30;
  maxPositionOffset = 100;

  constructor(props: AttackAnimationProps) {
    super(props);

    this.offsets = [];

    this.populateOffsets();
    this.durationStyle = {
      animationDuration: AttackAnimation.duration + "ms",
    };
  }

  componentDidMount = async () => {
    await delay(AttackAnimation.duration + 100);
    this.props.onCompleteCallback();
  };

  populateOffsets = () => {
    for (let i = 0; i < this.numSquares; i++) {
      this.offsets.push({
        position: Math.random() ** 2 * this.maxPositionOffset,
        angle: (360 / this.numSquares) * (i + Math.random() * 3),
      } as Offset);
    }
  };

  renderSquare = (o: Offset, i: number) => {
    const { position, angle } = o;
    const startStyle = {
      transform: `rotate(${angle}deg) translateX(${position}px)`,
    };
    return (
      <div className="attack-animation-start" style={startStyle} key={i}>
        <div className="attack-animation-square" style={this.durationStyle} />
      </div>
    );
  };

  render() {
    const [x, y] = this.props.position;

    const containerStyle = {
      gridRow: y + 1,
      gridColumn: x + 1,
      ...this.durationStyle,
    };

    return (
      <div className="attack-animation-container" style={containerStyle}>
        {this.offsets.map(this.renderSquare)}
      </div>
    );
  }
}
