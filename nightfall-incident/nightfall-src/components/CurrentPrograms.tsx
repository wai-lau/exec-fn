import React from "react";
import { IProgram } from "../types";
import { HeaderBox } from "./HeaderBox";
import UploadMenu from "./UploadMenu";
import ProgramInfo from "./ProgramInfo";
import Button, { ButtonColor } from "./Button";

import "./CurrentPrograms.css";

enum ViewState {
  UserHidden,
  UserVisible,
  PropsVisible,
}

interface CurrentProgramsProps {
  currentPrograms: IProgram[];
  forceOn: boolean;
}

interface CurrentProgramsState {
  selectedProgram: IProgram["id"] | null;
  selectedAction: number | null;
  viewState: ViewState;
}

export default class CurrentPrograms extends React.Component<
  CurrentProgramsProps,
  CurrentProgramsState
> {
  constructor(props: CurrentProgramsProps) {
    super(props);
    this.state = {
      selectedProgram: null,
      viewState: ViewState.UserHidden,
      selectedAction: null,
    };
  }
  componentDidUpdate = (prevProps: CurrentProgramsProps, prevState: CurrentProgramsState) => {
    if (!prevProps.forceOn && this.props.forceOn) {
      this.setState(() => ({
        viewState: ViewState.PropsVisible,
      }));
    } else if (prevProps.forceOn && !this.props.forceOn) {
      this.setState((state) => ({
        viewState:
          state.viewState === ViewState.UserVisible ? ViewState.UserVisible : ViewState.UserHidden,
      }));
    }
  };
  getProgramByID = (id: string) => {
    const program = this.props.currentPrograms.find((p) => p.id === id);
    if (!program) {
      throw new Error("No program with name " + id);
    }
    return program;
  };
  onToggleHide = () => {
    this.setState(() => ({
      viewState: this.isHidden() ? ViewState.UserVisible : ViewState.UserHidden,
    }));
  };
  onSelectProgram = (i: number) => {
    const program = this.props.currentPrograms[i];
    this.setState((state) => ({
      selectedProgram: program.id,
      selectedAction: program.id !== state.selectedProgram ? null : state.selectedAction,
    }));
  };
  onSelectAction = (i: number) => {
    this.setState({
      selectedAction: i,
    });
  };
  isHidden = () => this.state.viewState === ViewState.UserHidden;
  render() {
    const { selectedProgram: selection } = this.state;
    const isHidden = this.isHidden();
    const program = selection ? this.getProgramByID(selection) : null;
    const currentEls = !isHidden && (
      <>
        <div className="current-programs-list">
          <HeaderBox title="program.list">
            <UploadMenu
              onSelectProgram={this.onSelectProgram}
              programs={this.props.currentPrograms}
            />
          </HeaderBox>
        </div>
        <div className="current-programs-info">
          <HeaderBox title="program.info">
            <ProgramInfo
              program={program}
              actionIndex={this.state.selectedAction}
              onSelectAction={this.onSelectAction}
            />
          </HeaderBox>
        </div>
      </>
    );

    return (
      <div className="current-programs-container overlay-grid">
        {currentEls}
        <Button
          bgColor={ButtonColor.DarkBlueGradient}
          onClick={this.onToggleHide}
          className="toggle-hidden"
          isBold
        >
          {isHidden ? "Show" : "Hide"} Programs
        </Button>
      </div>
    );
  }
}
