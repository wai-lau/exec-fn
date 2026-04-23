import React from "react";
import cn from "classnames";
import PComponent from "../util/PComponent";
import clone from "clone";
import "./Battle.css";

import GridProgram from "./GridProgram";

import {
  ILevel,
  Coordinate,
  CoordinateMap,
  IGridInitialProgram,
  IGridActiveProgram,
  CoordinateArray,
  IActionCoordinator,
  ValidTarget as VT,
  TargetColor as TC,
  IGridActiveUploadZone,
  IProgram,
  CoordinateFill,
  IGridActiveCredit,
  IBattleStyle,
} from "../types";
import {
  coordinateKey,
  create2DArray,
  getAdjacent,
  coordinateInArray,
  deleteFromArray,
  cloneCoordinateMap,
  matchFlag,
  coordinateArrayUniq,
  coordinatesEqual,
  isInBounds,
  delay,
} from "../util/util";
import * as AudioSources from "../audio/audioSources";
import { AudioContext, IAudioContext } from "../util/AudioContext";
import ProgramMenu from "./ProgramMenu";
import BattleIntro from "./BattleIntro";
import UploadZone from "./UploadZone";
import UploadMenu from "./UploadMenu";
import { ISelection, SelectionType } from "../types/Selection";
import StaticMenu, { StaticMenuType } from "./StaticMenu";
import Button, { ButtonColor } from "./Button";

import { getRangeFromArea, sortBodyFromHead } from "../util/path";
import Modal, { ModalConfig } from "./Modal";
import Credit from "./Credit";
import DataPack from "./DataPack";
import { IBattleResult } from "../types/Battle";
import { HeaderBox } from "./HeaderBox";
import Hackerman from "./Hackerman";
import ProgramInfo from "./ProgramInfo";
import AttackAnimation from "./AttackAnimation";
import AudioShuffler from "../util/AudioShuffler";
import { DatabattleConfig as DatabattleAudioShufflerConfig } from "../campaign/databattleAudioShuffleConfig";
import GuideText from "./GuideText";

import { createTurnModal, createCreditsModal } from "../util/modal";
import AIController from "../util/AIController";
import IGameAI from "../types/GameAI";

export interface BattleProps extends ILevel {
  firstClearCredits: number | null;
  battleStyle: IBattleStyle;
  availablePrograms: IProgram[];
  onFinishBattle: (result: IBattleResult) => void;
  noModals?: boolean;
}

export interface BattleState {
  filledCoordinates: CoordinateFill;
  uploadZones: IGridActiveUploadZone[];
  programs: IGridActiveProgram[];
  credits: IGridActiveCredit[];
  selection: ISelection | null;
  teamIndex: number;
  actionIndex: number | null;
  modal: ModalConfig | null;
  showIntro: boolean;
  attackAnimation: Coordinate | null;
  hasSelectedUploadZone: boolean;
  hasUploadedProgram: boolean;
}

class Battle extends PComponent<BattleProps, BattleState> implements IActionCoordinator {
  static contextType = AudioContext;

  ID_MONOTONIC: number;
  autoAdvanceTimeout: ReturnType<typeof setTimeout> | null;
  autoAdvanceDelay: number;
  audioContext: IAudioContext;
  modalWaitCallbacks: (() => void)[];
  undoState: BattleState | null = null;

  guideTextCheckTimeout: ReturnType<typeof setTimeout> | null = null;

  uzRect: DOMRect | null = null;
  uploadRect: DOMRect | null = null;

  aiController: AIController;
  actionDelay: number = 250;

  constructor(props: BattleProps) {
    super(props);
    this.ID_MONOTONIC = 1;

    const programs = this.props.programs.map(this.initializeProgram);

    const uploadZones = this.props.uploadZones.map((z) => ({
      ...z,
      id: "upload-zone-" + this.getNextID(),
      programIndex: null,
    }));

    const credits = (this.props.credits || []).map((c) => ({
      ...c,
      collected: false,
    }));

    this.state = {
      filledCoordinates: this.props.filledCoordinates,
      selection: null,
      teamIndex: 0,
      actionIndex: null,
      modal: null,
      showIntro: true,
      attackAnimation: null,
      hasSelectedUploadZone: false,
      hasUploadedProgram: false,
      programs,
      uploadZones,
      credits,
    };

    this.autoAdvanceTimeout = null;
    this.autoAdvanceDelay = 400;
    this.audioContext = this.context;
    this.modalWaitCallbacks = [];
    this.aiController = new AIController(this as IGameAI, this.actionDelay);
  }

  componentDidMount() {
    this.audioContext = this.context;
  }

  // Clone state if selection changed; check for guide text if battle is not yet begun
  componentDidUpdate = (_: BattleProps, prevState: BattleState) => {
    if (
      !(
        (this.state.selection ? this.state.selection.id : null) ===
        (prevState.selection ? prevState.selection.id : null)
      )
    ) {
      this.undoState = clone(this.state);
    }

    if (!this.isDatabattleStarted()) {
      this.checkForGuideText();
    }

    this.validate();
  };

  // Render guide text pointing to upload zone and program upload menu
  checkForGuideText = () => {
    if (this.guideTextCheckTimeout !== null) {
      clearTimeout(this.guideTextCheckTimeout);
      this.guideTextCheckTimeout = null;
    }
    if (!this.state.showIntro) {
      if (!this.state.hasSelectedUploadZone && !this.uzRect) {
        const uploadZoneEl = document.querySelector('.grid-program[data-name="Upload Zone"]');
        if (!uploadZoneEl) {
          this.guideTextCheckTimeout = setTimeout(this.checkForGuideText, 100);
          return;
        }
        this.uzRect = uploadZoneEl.getBoundingClientRect();
        this.forceUpdate(); // Ugly, but clone doesn't like having a DOMRect in state.
      } else if (!this.state.hasUploadedProgram && !this.uploadRect) {
        const programEl = document.querySelector(".upload-list");
        if (!programEl) {
          this.guideTextCheckTimeout = setTimeout(this.checkForGuideText, 100);
          return;
        }
        this.uploadRect = programEl.getBoundingClientRect();
        this.forceUpdate();
      }
    }
  };

  // Get next numerical id (shared among grid entities)
  getNextID = () => this.ID_MONOTONIC++;

  // Returns whether a coordinate is filled
  isFilled = (c: Coordinate) => this.state.filledCoordinates[c[1]][c[0]];

  // Returns grid dimensions as Coordinate
  getDimensions = () => [this.props.width, this.props.height] as Coordinate;

  // Returns all programs
  getPrograms = () => this.state.programs;

  // Get an upload zone by its id
  getUploadZoneByID = (id: string | null) => {
    if (id === null) {
      throw new Error("Attempted to search for null ID");
    }
    const match = this.state.uploadZones.find((p) => p.id === id);
    if (!match) {
      throw new Error("No upload zone found with id " + id);
    }
    return match;
  };

  // Get a program by its id
  getProgramByID = (id: string | null) => {
    if (id === null) {
      throw new Error("Attempted to search for null ID");
    }
    const match = this.state.programs.find((p) => p.id === id);
    if (!match) {
      throw new Error("No program found with id " + id);
    }
    return match;
  };

  // Get a credit by its id
  getCreditByID = (id: string | null) => {
    if (id === null) {
      throw new Error("Attempted to search for null ID");
    }
    const match = this.state.credits.find((p) => p.id === id);
    if (!match) {
      throw new Error("No credit found with id " + id);
    }
    return match;
  };

  // Get the id of the program at a coordinate, or null if no program is there
  getProgramIDAtCoordinate = (c: Coordinate) => {
    const [x, y] = c;
    const programsAt = this.getProgramMap();
    const programAtCoordinate = programsAt[y][x];
    if (programAtCoordinate.length > 1) {
      console.error(
        "Tile",
        `(${x},${y})`,
        "contained multiple programs:",
        programAtCoordinate.join(", ")
      );
    }
    return programAtCoordinate[0] || null;
  };

  // Get the id of the credit at a coordinate, or null if no credit is there
  getCreditIDAtCoordinate = (c: Coordinate) => {
    const matchedCredit = this.state.credits.find((credit) => coordinatesEqual(credit.position, c));
    if (!matchedCredit) {
      return null;
    }
    return matchedCredit.id;
  };

  // Convert an IGridInitialProram to an IGridActiveProgram
  initializeProgram = (p: IGridInitialProgram) => ({
    ...p,
    id: p.id + "-" + this.getNextID(),
    movesRemaining: p.numMoves,
    hasActed: false,
  });

  // Update a program, replacing the program with the same id with the given program
  updateProgram = async (program: IGridActiveProgram) => {
    return this.setStateP((state) => {
      const { programs } = state;
      const { id } = program;
      const index = programs.findIndex((p) => p.id === id);
      if (index === -1) {
        throw new Error("No program found with id " + id);
      }
      return {
        ...state,
        programs: [...programs.slice(0, index), program, ...programs.slice(index + 1)],
      };
    });
  };

  // Update a credit, replacing the credit with the same id with the given credit
  updateCredit = async (credit: IGridActiveCredit) => {
    return this.setStateP((state) => {
      const { credits } = state;
      const { id } = credit;
      const index = credits.findIndex((c) => c.id === id);
      if (index === -1) {
        throw new Error("No credit found with id " + id);
      }
      return {
        ...state,
        credits: [...credits.slice(0, index), credit, ...credits.slice(index + 1)],
      };
    });
  };

  // Delete a program by its id
  deleteProgramByID = async (id: IGridActiveProgram["id"]) => {
    await this.setStateP((state) => {
      const { programs } = state;
      const index = programs.findIndex((p) => p.id === id);
      if (index === -1) {
        throw new Error("No program found with id " + id);
      }
      return {
        ...state,
        programs: [...programs.slice(0, index), ...programs.slice(index + 1)],
        selection: null,
      };
    });
    await this.checkForVictory();
  };

  // Get a 2D array by coordinate containing a list of programs at that coordinate
  getProgramMap = () => {
    const { width, height } = this.props;
    const { programs } = this.state;

    // 2D array containing list of all programs that think they're at that location
    const programsAt: CoordinateMap<IGridActiveProgram["id"][]> = create2DArray(
      height,
      width,
      () => []
    );
    programs.forEach((program) => {
      const { body, id } = program;

      body.forEach((c) => {
        const [x, y] = c;
        programsAt[y][x].push(id);
      });
    });

    return programsAt;
  };

  // Returns whether the databattle is in progress (currently, if there are no remaining upload zones)
  isDatabattleStarted = () => this.state.uploadZones.length === 0;

  // TODO: Check for upload zones overlapping with programs
  // Ensure 5 things:
  // 1. No two programs have the same ID
  // 2. No program occupies more tiles than it's allowed to
  // 3. No program occupies a non-contiguous area
  // 4. No program occupies a non-filled tile
  // 5. No two programs occupy the same tile
  validate = () => {
    let hasError = false;
    const { width, height } = this.props;
    const { programs } = this.state;

    // Check for duplicate IDs
    const ids = programs.map((program) => program.id);
    const duplicates = ids.filter((x, i, a) => a.indexOf(x) !== i);
    if (duplicates.length) {
      console.error("Error: Duplicate IDs detected in");
    }

    programs.forEach((program) => {
      const { head, body, id, maxSize } = program;

      if (body.length > maxSize) {
        console.error(
          "Program",
          id,
          "exceeds its max size of",
          maxSize,
          `(currently ${body.length})`
        );
      }

      const foundBody = sortBodyFromHead(head, body);
      if (foundBody.length !== body.length) {
        console.error("Program", id, "is non-contiguous");
      }
    });

    const filledAt = this.getProgramMap();
    filledAt.forEach((row, y) => {
      row.forEach((val, x) => {
        if (!this.isFilled([x, y]) && val.length) {
          // Is an occupied tile empty?
          console.error("Empty tile", `(${x},${y})`, "contained program(s):", val.join(", "));
          hasError = true;
        } else if (val.length > 1) {
          // Is a tile multi-occupied?
          console.error("Tile", `(${x},${y})`, "contained multiple programs:", val.join(", "));
          hasError = true;
        }
      });
    });
    return !hasError;
  };

  // Get valid coordinates for where the selected program can move
  getValidMoves = () => {
    const { width, height } = this.props;
    const { selection } = this.state;
    if (selection?.type !== SelectionType.PROGRAM) {
      throw new Error("Cannot get valid moves if a program is not selected");
    }
    const selectedProgram = this.getProgramByID(selection.id);
    const { head, id, movesRemaining } = selectedProgram;
    if (movesRemaining === 0) {
      return null;
    }

    // Find adjacent coordinates in the grid that are either empty or occupied by same program
    const adjacentCoordinates = getAdjacent(head).filter((c) => isInBounds(c, width, height));
    const adjacentFilled = adjacentCoordinates.filter(this.isFilled);
    const validMoves = adjacentFilled.filter((c) => {
      const programID = this.getProgramIDAtCoordinate(c);
      return programID === null || programID === id;
    });
    return validMoves;
  };

  // Get valid destinations for where the selected program can end the turn
  getValidDestinations = () => {
    const { selection } = this.state;
    if (selection?.type !== SelectionType.PROGRAM) {
      throw new Error("Cannot get valid moves if a program is not selected");
    }
    const program = this.getProgramByID(selection.id);
    const { head, id, movesRemaining } = program;
    if (movesRemaining === 0) {
      return null;
    }

    const passable = this.getPassable(id);
    return getRangeFromArea([head], movesRemaining, passable);
  };

  // Get valid coordinates for where the selected program and action can act
  getValidTargets = () => {
    const { width, height } = this.props;
    const { selection, actionIndex } = this.state;

    if (!selection || actionIndex === null) {
      return null;
    }

    const selectedProgram = this.getProgramByID(selection.id);
    // TODO: move check for not rendering targets after action to render()
    if (selectedProgram.hasActed) {
      return null;
    }

    const { name, head, actions } = selectedProgram;
    const action = actions[actionIndex];
    if (!action) {
      console.error("Action #", actionIndex, "was not found in program", name);
      return null;
    }
    const { range, validTargetScheme = VT.Default } = action;

    const inRange = getRangeFromArea([head], range).filter((c) => isInBounds(c, width, height));
    let validTargets = inRange.filter((c) => {
      // If target is unfilled and unfilled tiles are disallowed, return false
      if (!this.isFilled(c)) {
        return matchFlag(validTargetScheme, VT.Unfilled);
      }
      const id = this.getProgramIDAtCoordinate(c);
      // If target is filled but unoccupied and unoccupied tiles are disallowed, return false
      if (!id) {
        return matchFlag(validTargetScheme, VT.EmptyFilled);
      }

      const targetProgram = this.getProgramByID(id);
      // Check for target is occupied by self, same team, or other team
      if (targetProgram.id === selection.id) {
        return matchFlag(validTargetScheme, VT.Self);
      } else if (targetProgram.team === selectedProgram.team) {
        return matchFlag(validTargetScheme, VT.SameTeam);
      } else {
        return matchFlag(validTargetScheme, VT.OtherTeam);
      }
    });
    return validTargets;
  };

  // Create callback for selecting a program
  createOnSelectProgram = (id: string) => async () => {
    this.cancelAutoAdvance();

    await this.audioContext.player.playAudio(AudioSources.ProgramReady);
    const selectedProgram = this.getProgramByID(id);
    const actionIndex =
      selectedProgram.movesRemaining === 0 ? selectedProgram.defaultActionIndex || 0 : null;
    await this.setStateP(() => ({
      selection: { type: SelectionType.PROGRAM, id },
      actionIndex,
    }));
  };

  // Create callback for selecting an upload zone
  createOnSelectUploadZone = (id: string) => async () => {
    this.cancelAutoAdvance();

    // TODO: play sound
    await this.setStateP(() => ({
      selection: { type: SelectionType.UPLOAD_ZONE, id },
      hasSelectedUploadZone: true,
      // TODO: actionIndex?
    }));
  };

  createOnSelectCredit = (id: string) => async () => {
    this.cancelAutoAdvance();
    await this.setStateP(() => ({
      selection: { type: SelectionType.CREDIT, id },
    }));
  };

  createOnSelectDataPack = (id: string) => async () => {
    this.cancelAutoAdvance();
    await this.setStateP(() => ({
      selection: { type: SelectionType.DATA_PACK, id },
    }));
  };

  // Callback after uploading program by index in props.availablePrograms
  onUploadProgram = (availableProgramIndex: number) => {
    const { selection } = this.state;
    // TODO: Allow selecting program with no upload zone to preview it
    if (selection?.type !== SelectionType.UPLOAD_ZONE) {
      return;
      // throw new Error('Cannot upload program without an upload zone selected')
    }

    const selectedUploadZone = this.getUploadZoneByID(selection.id);
    // TODO: build fn to replace uploadZone in state
    const { id } = selectedUploadZone;
    this.setStateP((state) => {
      const { uploadZones } = state;
      const index = uploadZones.findIndex((z) => z.id === id);
      return {
        hasUploadedProgram: true,
        uploadZones: [
          ...uploadZones.slice(0, index),
          { ...selectedUploadZone, programIndex: availableProgramIndex },
          ...uploadZones.slice(index + 1),
        ],
      };
    });
  };

  // Create callback for moving a program
  createOnMove = (c: Coordinate) => async () => {
    const { selection } = this.state;
    if (selection?.type !== SelectionType.PROGRAM) {
      throw new Error("Cannot move selection if upload zone is selected");
    }
    const selectedProgram = this.getProgramByID(selection.id);
    const { body, maxSize } = selectedProgram;
    const movesRemaining = selectedProgram.movesRemaining - 1;

    const updatedSelectedProgram = {
      ...selectedProgram,
      head: c,
      body: [c, ...deleteFromArray(c, body)].slice(0, maxSize),
      movesRemaining: selectedProgram.movesRemaining - 1,
    };
    await this.updateProgram(updatedSelectedProgram);

    const didCollectProgram = await this.checkCollection(c);
    if (didCollectProgram) {
      await this.audioContext.player.playAudio(AudioSources.Credit);
    } else {
      await this.audioContext.player.playAudio(AudioSources.Move);
    }

    // TODO: Should this be in a tick method?
    const actionIndex =
      movesRemaining <= 0 ? selectedProgram.defaultActionIndex || 0 : this.state.actionIndex;
    this.setStateP(() => ({ actionIndex }));
  };

  // Create callback for a program acting on a given coordinate
  createOnAct = (c: Coordinate) => async () => {
    const { selection, actionIndex } = this.state;
    if (selection?.type !== SelectionType.PROGRAM || actionIndex === null) {
      return null;
    }
    const selectedProgram = this.getProgramByID(selection.id);
    const selectedAction = selectedProgram.actions[actionIndex];
    if (!selectedAction) {
      console.error("Invalid action selected");
      return null;
    }
    if (selectedAction.sizeReq && selectedAction.sizeReq > selectedProgram.body.length) {
      throw new Error("Program does not meet size requirement");
    }
    const targetedID = this.getProgramIDAtCoordinate(c);

    const actionCoordinator = this as IActionCoordinator;

    if (targetedID || selectedAction.alwaysPlayAudio) {
      await this.audioContext.player.playAudio(selectedAction.audioSource || AudioSources.Attack);
    }
    await this.setProgramDone(selectedProgram);
    await Promise.all(selectedAction.run(actionCoordinator, c, selection.id, targetedID));
    this.setAutoAdvance();
  };

  // Callback to set program as done (after acting or no-acting)
  setProgramDone = async (program: IGridActiveProgram) => {
    const postActionProgram = {
      ...program,
      hasActed: true,
      movesRemaining: 0,
    };
    await this.updateProgram(postActionProgram);
    await this.setStateP(() => ({
      actionIndex: null,
      selection: null,
    }));
  };

  // Returns cells that the given program can move through
  getPassable = (programID: string) => {
    const { width, height } = this.props;
    const { filledCoordinates } = this.state;
    const program = this.getProgramByID(programID);
    let passable: CoordinateArray = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!filledCoordinates[y][x]) {
          continue;
        }
        const c = [x, y] as Coordinate;
        if (program.team === "CPU") {
          const { dataPack } = this.props;
          if (dataPack && coordinatesEqual(dataPack, c)) {
            continue;
          }
          const credit = this.getCreditIDAtCoordinate(c);
          if (credit && program.team === "CPU") {
            continue;
          }
        }
        const occupyID = this.getProgramIDAtCoordinate(c);
        if (!occupyID || occupyID === programID) {
          passable.push([x, y]);
        }
      }
    }
    return passable;
  };

  // Collect credit if applicable, and return whether a credit was collected
  // TODO: Convert return type to enum to allow playing datapack sound
  checkCollection = async (c: Coordinate) => {
    const programID = this.getProgramIDAtCoordinate(c);
    if (!programID) {
      return;
    }

    const program = this.getProgramByID(programID);

    const { dataPack } = this.props;
    if (dataPack && coordinatesEqual(dataPack, c)) {
      if (program.team === "CPU") {
        throw new Error("CPU cannot collect datapack");
      }
      this.gameOver(program.team);
      return false;
    }

    const creditID = this.getCreditIDAtCoordinate(c);
    if (!creditID) {
      return false;
    }

    if (program.team === "CPU") {
      throw new Error("CPU cannot collect credits");
    }

    const credit = this.getCreditByID(creditID);
    if (!credit) {
      // TODO error
      throw new Error("credit");
    }

    if (credit.collected) {
      return false;
    }

    const updatedCredit = { ...credit };
    updatedCredit.collected = true;
    await this.updateCredit(updatedCredit);
    this.displayModal(createCreditsModal(updatedCredit.amount));

    return true;
  };

  // Damage a target program by ID
  damageTarget = async (targetID: string | null, value: number) => {
    if (!targetID) {
      return;
    }
    const initialTargetProgram = this.getProgramByID(targetID);
    const { head } = initialTargetProgram;
    await delay(100);
    this.startAttackAnimation(head);
    await delay(AttackAnimation.duration - 100);
    for (let i = 0; i < value; i++) {
      const targetProgram = this.getProgramByID(targetID);
      const { body } = targetProgram;
      const updatedProgram = {
        ...targetProgram,
        body: body.slice(0, -1),
      };
      await this.updateProgram(updatedProgram);
      await delay(GridProgram.fadeDuration);
      if (body.length === 1) {
        await this.deleteProgramByID(targetID);
        return;
      }
    }
  };

  // Grow a target program by ID
  growTarget = async (targetID: string | null, value: number) => {
    if (!targetID) {
      return;
    }
    const { width, height } = this.props;
    const targetProgram = this.getProgramByID(targetID);
    const { body, maxSize } = targetProgram;
    let numAdded = 0;
    // While there are more tiles to add, find furthest empty tiles from the head (by body order)
    // Start the loop over immediately if we manage to add a tile (the added tile will be where we search).
    let updatedBody = [...body];
    while (numAdded < value && updatedBody.length < maxSize) {
      let i = 0;
      while (i < updatedBody.length) {
        const adjacentCoordinates = getAdjacent(updatedBody[i]).filter((c) =>
          isInBounds(c, width, height)
        );
        const adjacentInGrid = adjacentCoordinates.filter(this.isFilled);
        const adjacentAndEmpty = adjacentInGrid.filter(
          (c) => !this.getProgramIDAtCoordinate(c) && !coordinateInArray(c, updatedBody)
        );
        if (adjacentAndEmpty.length) {
          updatedBody.push(adjacentAndEmpty[0]);
          // Below line inserts the new branch at a higher position in the body queue.
          // updatedBody = [...updatedBody.slice(0, i), adjacentAndEmpty[0], ...updatedBody.slice(i)]
          numAdded++;
          break;
        }
        i++;
      }
      if (i === updatedBody.length) {
        break;
      }
    }
    await this.updateProgram({ ...targetProgram, body: updatedBody });
  };

  // Change the number of a target's moves by ID
  changeTargetMoves = async (targetID: string | null, value: number) => {
    if (!targetID) {
      return;
    }
    const targetProgram = this.getProgramByID(targetID);
    const { numMoves, movesRemaining } = targetProgram;
    const newMovesRemaining = Math.min(Math.max(movesRemaining + value, 0), 10);
    const newNumMoves = newMovesRemaining - movesRemaining + numMoves;
    await this.updateProgram({
      ...targetProgram,
      numMoves: newNumMoves,
      movesRemaining: newMovesRemaining,
    });
  };

  // Change a target's max size by ID
  changeTargetMaxSize = async (targetID: string | null, value: number) => {
    if (!targetID) {
      return;
    }
    const targetProgram = this.getProgramByID(targetID);
    const { maxSize } = targetProgram;
    await this.updateProgram({
      ...targetProgram,
      maxSize: Math.max(0, maxSize + value),
    });
  };

  // Make filled squares unfilled and unfilled squares filled
  bitFlipCoordinate = async (c: Coordinate, isFilled?: boolean) => {
    if (this.getProgramIDAtCoordinate(c)) {
      throw new Error(
        `Attempted to bitflip coordinate (${c.reverse().join(",")}), which contained a program`
      );
    }
    await this.setStateP((state) => {
      const newFilledCoordinates = cloneCoordinateMap(state.filledCoordinates);
      const [x, y] = c;
      newFilledCoordinates[y][x] = isFilled != undefined ? isFilled : !newFilledCoordinates[y][x];
      return {
        filledCoordinates: newFilledCoordinates,
      };
    });
  };

  // Start an attack animation (flying squares) at a given coordinate
  startAttackAnimation = (c: Coordinate) => {
    this.setStateP(() => ({
      attackAnimation: c,
    }));
  };

  // End an attack animation (controlled by AttackAnimation's internal timeout)
  endAttackAnimation = async () => {
    this.setStateP((state) => ({
      attackAnimation: null,
    }));
  };

  // Advance selection if more programs remain for current team, or end turn if all programs have acted
  autoAdvance = async () => {
    await this.waitForModal();

    const { teams } = this.props;
    const { selection, programs, teamIndex } = this.state;
    if (selection) {
      return;
    }
    const nextProgram = programs.find((p) => p.team === teams[teamIndex] && !p.hasActed);
    if (!nextProgram) {
      this.nextTurn();
      return;
    }

    await this.createOnSelectProgram(nextProgram.id)();

    if (nextProgram.team === "CPU") {
      this.aiController.runTurn(nextProgram.id);
    }
  };

  // Cancel the timeout for selecitng the next available program for current team
  cancelAutoAdvance = () => {
    if (this.autoAdvanceTimeout) {
      clearTimeout(this.autoAdvanceTimeout);
    }
    this.autoAdvanceTimeout = null;
  };

  // Set a timeout for auto-advancing
  setAutoAdvance = () => {
    this.cancelAutoAdvance();
    this.autoAdvanceTimeout = setTimeout(this.autoAdvance, this.autoAdvanceDelay);
  };

  // Start next team's turn, allowing the next team's programs to act
  nextTurn = async () => {
    const { teams } = this.props;
    await this.setStateP((state) => {
      const { programs, teamIndex } = this.state;
      const nextTeamIndex = (teamIndex + 1) % this.props.teams.length;
      const refreshedPrograms = programs.map((p) => ({
        ...p,
        hasActed: false,
        movesRemaining: p.numMoves,
      }));
      return {
        teamIndex: nextTeamIndex,
        programs: refreshedPrograms,
        selection: null,
        actionIndex: null,
      };
    });
    await this.onStartTurn();
  };

  // Display active turn modal and start auto advance tick, or skip turn
  onStartTurn = async () => {
    const { teams } = this.props;
    const { teamIndex, programs } = this.state;
    const team = teams[teamIndex];

    const teamStillExists = programs.some((p) => p.team === team);
    if (teamStillExists) {
      await this.waitForModal();
      await this.displayModal(createTurnModal(team));
      this.setAutoAdvance();
    } else if (this.props.dataPack) {
      this.nextTurn();
    }
  };

  // Returns whether any upload zone has a program
  hasUploadedProgram = () => {
    return this.state.uploadZones.some((z) => z.programIndex !== null);
  };

  // Convert programs in upload zone to initial programs
  commitUploads = async () => {
    await this.setStateP((state) => {
      const { programs, uploadZones } = state;
      const uploadedPrograms: IGridActiveProgram[] = uploadZones
        .filter((z) => z.programIndex !== null)
        .map(
          (zone) =>
            ({
              ...this.props.availablePrograms[zone.programIndex!],
              head: zone.position,
              body: [zone.position],
              team: zone.team,
            } as IGridInitialProgram)
        )
        .map(this.initializeProgram);
      return {
        uploadZones: [],
        programs: [...programs, ...uploadedPrograms],
        selection: null,
      };
    });
    await this.onStartTurn();
  };

  // Select the given action by index for a currently selected program
  onSelectAction = async (actionIndex: number) => {
    const { selection } = this.state;
    if (selection?.type !== SelectionType.PROGRAM) {
      throw new Error("Cannot select an action without a program selected");
    }
    await this.audioContext.player.playAudio(AudioSources.SelectAction);
    await this.setStateP(() => ({ actionIndex }));
  };

  // Select no action
  onSelectNoAction = async () => {
    const { selection } = this.state;
    if (selection?.type !== SelectionType.PROGRAM) {
      throw new Error("Cannot select No Action without a program selected");
    }

    const selectedProgram = this.getProgramByID(selection.id);
    if (selectedProgram.team === "P1") {
      await this.audioContext.player.playAudio(AudioSources.SelectAction);
    }

    this.setProgramDone(selectedProgram);

    this.setAutoAdvance();
  };

  getTotalCollectedCredits = () =>
    // TODO: Filter by already collected IDs?
    this.state.credits.filter((c) => c.collected).reduce((val, next) => val + next.amount, 0);

  // Check if victory has occurred
  checkForVictory = async () => {
    const remainingTeams = new Set<string>();
    this.state.programs.forEach((program) => {
      remainingTeams.add(program.team);
    });
    if (remainingTeams.size === 1) {
      const lastTeam = Array.from(remainingTeams.values())[0];
      if (lastTeam !== "CPU" && this.props.dataPack) {
        return;
      }
      await this.gameOver(lastTeam);
      return;
    }
    return;
  };

  // Display modal allowing player to quit
  logOut = async () => {
    this.displayModal({
      headerBoxTitle: "databattle.result",
      header: "Log Out?",
      textLines: ["Do you wish to exit this databattle and return to the netmap?"],
      buttons: [
        {
          text: "Continue with Databattle",
          onClick: this.dismissModal,
        },
        {
          text: "Log Out",
          onClick: async () => {
            await delay(500);
            await this.dismissModal();
            await this.onLose();
          },
        },
      ],
      buttonsOrientation: "VERTICAL",
    });
  };

  // Display modal exiting battle after natural win
  gameOver = async (winner: string) => {
    await delay(500);

    const didWin = winner === "P1";
    const source = didWin ? AudioSources.Success : AudioSources.Disconnect;
    await this.audioContext.player.playAudio(source);

    if (winner === "P1") {
      await this.audioContext.player.playAudio(AudioSources.Success);
      this.displayModal({
        headerBoxTitle: "databattle.result",
        header: "DATABATTLE SUCCESSFUL",
        textLines: [
          "MISSION CREDITS AWARDED: " + (this.props.firstClearCredits || 0),
          "EXTRA CREDITS ACQUIRED: " + this.getTotalCollectedCredits(),
        ],
        buttons: [
          {
            text: "Exit",
            onClick: async () => {
              await delay(500);
              this.onWin();
            },
          },
        ],
      });
    } else {
      await this.audioContext.player.playAudio(AudioSources.Disconnect);
      this.displayModal({
        headerBoxTitle: "databattle.result",
        header: "DATABATTLE UNSUCCESSFUL",
        textLines: ["Connection terminated..."],
        buttons: [
          {
            text: "Exit",
            onClick: async () => {
              await delay(500);
              this.onLose();
            },
          },
        ],
      });
    }
  };

  // Finish battle with CPU winner
  onLose = async () => {
    this.props.onFinishBattle({
      id: this.props.id,
      collectedCreditIDs: [],
      winner: "CPU",
    });
  };

  // Finish battle with player winner
  onWin = async () => {
    this.props.onFinishBattle({
      id: this.props.id,
      collectedCreditIDs: this.state.credits.filter((c) => c.collected).map((c) => c.id),
      winner: "P1",
    });
  };

  // Hide the BattleIntro
  dismissIntro = async () => {
    await this.setStateP(() => ({
      showIntro: false,
    }));
    // await this.audioContext.player.loopAudio(AudioSources.Loop1);
    new AudioShuffler(this.audioContext.player, DatabattleAudioShufflerConfig).play();
  };

  // Undo all state changes since the currently selected program was selected
  undo = async () => {
    await this.setStateP(() => this.undoState);
  };

  // Display a given modal
  displayModal = async (modal: ModalConfig) => {
    if (this.props.noModals) {
      return;
    }

    await this.waitForModal();
    await this.setStateP(() => ({ modal }));
  };

  // Dismiss the modal, dispatching waiting callbacks
  dismissModal = async () => {
    await this.setStateP(() => ({ modal: null }));
    this.modalWaitCallbacks.forEach((x) => {
      x();
    });
    this.modalWaitCallbacks = [];
  };

  // Return a promise resolving when the modal (if any) is dismissed.
  waitForModal = () =>
    new Promise((resolve) => {
      if (this.state.modal) {
        this.modalWaitCallbacks.push(resolve);
      } else {
        resolve();
      }
    });

  // Render the background tiles into the grid
  renderBackgroundTiles = () => {
    const { width, height } = this.props;
    const { filledCoordinates } = this.state;
    const backgroundTiles = [];
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (filledCoordinates[y][x] === true) {
          const style = {
            gridRow: y + 1,
            gridColumn: x + 1,
          };
          const key = coordinateKey([y, x]);
          const className = cn(["tile", "delay-" + ((9 * x + 4 * y) % 10)]);
          const tileEl = <div className={className} key={key} style={style}></div>;
          backgroundTiles.push(tileEl);
        }
      }
    }
    return backgroundTiles;
  };

  // Render move targets and possible destination overlays
  renderMoves = () => {
    const { actionIndex, selection } = this.state;

    if (selection?.type !== SelectionType.PROGRAM || actionIndex !== null) {
      return null;
    }
    const { team, head } = this.getProgramByID(selection.id);
    const activeTeam = team === this.props.teams[this.state.teamIndex];
    const playerTeam = team === "P1";
    const begunDatabattle = this.isDatabattleStarted();
    const clickable = playerTeam && activeTeam && begunDatabattle;

    const validDests = this.getValidDestinations();
    if (!validDests) {
      return null;
    }

    const validDestEls = deleteFromArray(head, validDests).map((c) => {
      const [x, y] = c;
      const style = {
        gridRow: y + 1,
        gridColumn: x + 1,
      };
      const key = coordinateKey([y, x], "dest");
      const className = cn(["dest", { "non-player": !playerTeam }]);
      return <div className={className} key={key} style={style} />;
    });

    const validMoves = activeTeam && this.getValidMoves();
    if (!validMoves) {
      return validDestEls;
    }

    const validMoveEls = validMoves.map((c) => {
      const [x, y] = c;
      const style = {
        gridRow: y + 1,
        gridColumn: x + 1,
      };
      const key = coordinateKey([y, x], "move");
      const onClick = clickable ? this.createOnMove(c) : () => {};
      const className = cn([
        "move",
        { "move-up": y < head[1] },
        { "move-left": x < head[0] },
        { "move-right": x > head[0] },
        { "move-down": y > head[1] },
        { "non-player": !playerTeam },
      ]);
      return <div className={className} key={key} onClick={onClick} style={style} />;
    });

    return [...validMoveEls, ...validDestEls];
  };

  // Render action targets
  renderActionTargets = () => {
    const { actionIndex, selection } = this.state;

    if (selection?.type !== SelectionType.PROGRAM) {
      return null;
    }
    const { team, actions } = this.getProgramByID(selection.id);
    const activeTeam = team === this.props.teams[this.state.teamIndex];
    const playerTeam = team === "P1";
    const begunDatabattle = this.isDatabattleStarted();
    const clickable = playerTeam && activeTeam && begunDatabattle;
    if (actionIndex !== null && actions[actionIndex]) {
      const { targetColor = TC.Red } = actions[actionIndex];
      const validTargets = this.getValidTargets();
      if (!validTargets) {
        return null;
      }
      return validTargets.map((c) => {
        const [x, y] = c;
        const style = {
          gridRow: y + 1,
          gridColumn: x + 1,
        };
        const key = coordinateKey([y, x], "action");
        const className = cn([
          "action",
          { clickable },
          { attack: targetColor === TC.Red },
          { helper: targetColor === TC.Blue },
          { neutral: targetColor === TC.Green },
          { "non-player": !playerTeam },
        ]);
        const onClick = clickable ? this.createOnAct(c) : () => {};
        return (
          <div
            data-coord={x + "," + y}
            className={className}
            key={key}
            onClick={onClick}
            style={style}
          />
        );
      });
    }
  };

  // Render credits
  renderCredits = () => {
    const { credits: credits } = this.state;
    return credits
      .filter((credit) => !credit.collected)
      .map((credit) => (
        <Credit key={credit.id} {...credit} onClick={this.createOnSelectCredit(credit.id)} />
      ));
  };

  // Render data pack
  renderDataPack = () => {
    const { dataPack } = this.props;
    if (!dataPack) {
      return null;
    }

    return <DataPack position={dataPack} onClick={this.createOnSelectDataPack("data-pack")} />;
  };

  // Render grid programs
  renderGridPrograms = () => {
    const { teams } = this.props;
    const { programs, selection, teamIndex } = this.state;
    const isPlayerTurn = teams[teamIndex] === "P1";
    return programs.map((program, i) => (
      <GridProgram
        isActive={selection?.type === SelectionType.PROGRAM && selection.id === program.id}
        onClickHead={isPlayerTurn ? this.createOnSelectProgram(program.id) : () => {}}
        {...program}
        key={i}
        isInTurn={teams[teamIndex] === program.team}
        isSelectable={true}
        hasSelectedAction={this.state.actionIndex !== null}
      />
    ));
  };

  // Render upload zones
  renderUploadZones = () => {
    const { selection, uploadZones } = this.state;
    return uploadZones.map((z) => {
      const { id, position, programIndex, team } = z;
      const onClick = this.createOnSelectUploadZone(id);
      const [x, y] = position;
      const key = coordinateKey([y, x], "uz");
      const isActive = selection?.type === SelectionType.UPLOAD_ZONE && selection.id === id;
      if (programIndex !== null) {
        const program = this.props.availablePrograms[programIndex];
        const { id: _, ...programWithoutID } = program;
        return (
          <GridProgram
            hasActed={false}
            movesRemaining={0}
            team={team}
            head={position}
            body={[position]}
            isActive={isActive}
            onClickHead={onClick}
            key={key}
            isInTurn={true} // TODO ???
            isSelectable={true} // TODO ???
            {...programWithoutID}
            id={id}
          />
        );
      } else {
        return (
          <UploadZone
            isActive={isActive}
            onClick={onClick}
            key={key}
            id={id}
            team={team}
            position={position}
          />
        );
      }
    });
  };

  // Render bottom-left menu (selecting actions or viewing information)
  renderMenuElement = () => {
    const { selection } = this.state;
    if (!selection) {
      // HeaderBox skips rendering its body border and footer with an empty children prop
      return <br />;
    }
    if (selection.type === SelectionType.PROGRAM) {
      const program = this.getProgramByID(selection.id);
      // Render ProgramMenu iff it's the user's turn with an ongoing databattle
      if (
        program.team === this.props.teams[this.state.teamIndex] &&
        program.team === "P1" &&
        this.isDatabattleStarted()
      ) {
        return (
          <ProgramMenu
            actionIndex={this.state.actionIndex}
            program={this.getProgramByID(selection.id)}
            onSelectAction={this.onSelectAction}
            onSelectNoAction={this.onSelectNoAction}
          />
        );
      }
      return (
        <ProgramInfo
          program={program}
          actionIndex={this.state.actionIndex}
          onSelectAction={this.onSelectAction}
        />
      );
    } else if (selection.type === SelectionType.UPLOAD_ZONE) {
      const { programIndex } = this.getUploadZoneByID(selection.id);
      if (programIndex !== null) {
        const program = this.props.availablePrograms[programIndex];
        return (
          <ProgramInfo
            program={program}
            actionIndex={this.state.actionIndex}
            onSelectAction={this.onSelectAction}
          />
        );
      }
      return <StaticMenu type={StaticMenuType.UploadZone} />;
    } else if (selection.type === SelectionType.CREDIT) {
      return <StaticMenu type={StaticMenuType.Credit} />;
    } else if (selection.type === SelectionType.DATA_PACK) {
      return <StaticMenu type={StaticMenuType.DataItem} />;
    }
  };

  // Render modal
  renderModalElement = () => {
    const { modal } = this.state;
    if (!modal) {
      return null;
    }
    return <Modal dismiss={this.dismissModal} {...modal} />;
  };

  // Render guide arrow
  renderGuideText = () => {
    const { uzRect, uploadRect } = this;
    const { hasSelectedUploadZone, hasUploadedProgram } = this.state;
    if (!hasSelectedUploadZone && uzRect) {
      return (
        <GuideText
          rect={uzRect}
          text={"Click on an upload spot to begin            ".toUpperCase()}
        />
      );
    }
    if (!hasUploadedProgram && uploadRect) {
      return (
        <GuideText
          rect={uploadRect}
          text={"Select a program to upload to this location            ".toUpperCase()}
        />
      );
    }
  };

  // Render everything
  render() {
    const { width, battleStyle } = this.props;
    const { teamIndex } = this.state;

    const bgStyle = {
      backgroundImage: `url(${battleStyle?.bgImage})`,
    };

    if (this.state.showIntro) {
      return (
        <div className="battle-bg" style={bgStyle}>
          <BattleIntro battleStyle={battleStyle} dismissIntro={this.dismissIntro} />;
        </div>
      );
    }

    const databattleStarted = this.isDatabattleStarted();
    const hasUploadedProgram = this.hasUploadedProgram();

    const gridStyle = {
      gridTemplateColumns: `repeat(${width}, 1fr)`,
    };

    const overlayTiles = this.renderActionTargets() || this.renderMoves();
    const backgroundTiles = this.renderBackgroundTiles();
    const gridPrograms = this.renderGridPrograms();
    const uploadZones = this.renderUploadZones();
    const menuEl = <HeaderBox title="program.info">{this.renderMenuElement()}</HeaderBox>;
    const modalEl = this.renderModalElement();
    const creditEls = this.renderCredits();
    const dataPackEl = this.renderDataPack();
    const guideEl = this.renderGuideText();

    const uploadList = databattleStarted ? (
      <Hackerman text={document.body.innerHTML} />
    ) : (
      <HeaderBox title="program.list">
        <UploadMenu
          programs={this.props.availablePrograms}
          onSelectProgram={this.onUploadProgram}
          selectedIndexes={
            this.state.uploadZones.map((z) => z.programIndex).filter((n) => n !== null) as number[]
          }
        />
      </HeaderBox>
    );

    const commitButton = !databattleStarted && (
      <div className="begin-databattle">
        <Button
          bgColor={ButtonColor.DarkBlueGradient}
          isBold={true}
          onClick={hasUploadedProgram ? this.commitUploads : () => {}}
          unclickable={!hasUploadedProgram}
        >
          Begin Databattle
        </Button>
      </div>
    );

    const undoButton = databattleStarted && this.props.teams[this.state.teamIndex] === "P1" && (
      <div className="undo">
        <Button
          bgColor={ButtonColor.RedGradient}
          isBold={true}
          onClick={this.undo}
          playSound={false}
        >
          Undo
        </Button>
      </div>
    );

    const attackAnimationEl = this.state.attackAnimation && (
      <AttackAnimation
        position={this.state.attackAnimation}
        onCompleteCallback={this.endAttackAnimation}
      />
    );

    const headerButtonProps = {
      text: "LOG OUT",
      onClick: this.logOut,
    };

    return (
      <div className="battle-bg" style={bgStyle}>
        <HeaderBox title="databattle in progress" rightButton={headerButtonProps}>
          <div className="battle-container">
            <div className="upload-list">{uploadList}</div>
            <div className="program-menu">{menuEl}</div>
            {commitButton}
            {undoButton}
            <div className="battle-grid" style={gridStyle}>
              {backgroundTiles}
              {gridPrograms}
              {overlayTiles}
              {uploadZones}
              {modalEl}
              {creditEls}
              {dataPackEl}
              {attackAnimationEl}
              {guideEl}
            </div>
          </div>
        </HeaderBox>
      </div>
    );
  }
}

export default Battle;
