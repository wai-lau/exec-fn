import { Coordinate, CoordinateArray, IGridEntity, IGridActiveEntity } from ".";
import { IAudioSource } from "./Audio";

export interface IActionCoordinator {
  damageTarget: (id: string | null, value: number) => Promise<void>;
  growTarget: (id: string | null, value: number) => Promise<void>;
  changeTargetMoves: (id: string | null, value: number) => Promise<void>;
  changeTargetMaxSize: (id: string | null, value: number) => Promise<void>;
  bitFlipCoordinate: (c: Coordinate, isFilled?: boolean) => Promise<void>;
}

export enum ValidTarget {
  Unfilled = 1,
  EmptyFilled = 2,
  Self = 4,
  SameTeam = 8,
  OtherTeam = 16,
  // Default targeting: empty filled tiles or other team
  Default = EmptyFilled | OtherTeam,
  // Helper targeting: empty filled tiles or same team (but not self)
  Helper = EmptyFilled | SameTeam,
}

export enum TargetColor {
  Red,
  Blue,
  Green,
}

export interface ProgramAction {
  name: string;
  description: string;
  range: number;
  validTargetScheme?: ValidTarget;
  targetColor?: TargetColor.Red | TargetColor.Blue | TargetColor.Green;
  sizeReq?: number;
  audioSource?: IAudioSource;
  alwaysPlayAudio?: boolean;
  run: (
    ac: IActionCoordinator,
    targetCoordinate: Coordinate,
    selfID: string,
    targetID: string | null
  ) => Promise<void>[];
}

export interface IProgram {
  id: string;
  name: string;
  color: string;
  iconImageFile: string;
  description: string;
  actions: ProgramAction[];
  defaultActionIndex?: number;
  maxSize: number;
  numMoves: number;
}

export interface IGridInitialProgram extends IProgram, IGridEntity {}

export interface IGridActiveProgram extends IProgram, IGridActiveEntity {}
