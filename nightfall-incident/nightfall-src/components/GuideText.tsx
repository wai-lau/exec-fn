import React, { CSSProperties } from "react";

import "./GuideArrow.css";
import { HeaderBox } from "./HeaderBox";

interface GuideArrowProps {
  rect: DOMRect;
  text: string;
}

const GuideText: React.FunctionComponent<GuideArrowProps> = (props) => {
  const { rect, text } = props;
  const { top, right, height } = rect;
  const style: CSSProperties = {
    top: top + height / 2,
    left: right,
    position: "fixed",
    zIndex: 999,
    marginLeft: "1em",
    transform: "translateY(-50%)",
  };

  return (
    <div className="guide-text" style={style}>
      <HeaderBox title={text} showArrow />
    </div>
  );
};

export default GuideText;
