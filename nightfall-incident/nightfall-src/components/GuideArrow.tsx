import React from "react";

import "./GuideArrow.css";

interface GuideArrowProps {
  rect: DOMRect;
}

const GuideArrow: React.FunctionComponent<GuideArrowProps> = (props) => {
  const { top, right, height } = props.rect;
  const arrowHeight = 80;
  const arrowTop = top - (arrowHeight - height) / 2;
  const style = {
    top: arrowTop,
    left: right,
    height: arrowHeight,
    width: arrowHeight,
  };

  return <div className="highlight-rect" style={style} />;
};

export default GuideArrow;
