import React, { FunctionComponent } from "react";
import cn from "classnames";

import "./HeaderBox.css";

interface HeaderBoxProps {
  title: string;
  showArrow?: boolean;
  rightButton?: {
    text: string;
    onClick: () => void;
  };
}

export const HeaderBox: FunctionComponent<HeaderBoxProps> = (props) => {
  const { children, title, rightButton, showArrow } = props;

  // TODO: Right button
  const buttonEl = rightButton && (
    <div onClick={rightButton.onClick} className="header-box-button">
      {rightButton.text}
    </div>
  );

  const arrowClassname = cn(["header-box-arrow", { "show-arrow": showArrow }]);

  return (
    <div className="header-box">
      <div className="header-box-header">
        <span className={arrowClassname} />
        <pre className="header-box-title">{title}</pre>
        <span className="header-box-header-spacer" />
        {buttonEl}
      </div>
      {children && (
        <>
          <div className="header-box-contents">{children}</div>
          <div className="header-box-footer"></div>
        </>
      )}
    </div>
  );
};
