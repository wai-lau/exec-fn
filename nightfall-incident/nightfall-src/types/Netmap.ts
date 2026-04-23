import { IGameStatus, IGameStatusCoordinator } from "./GameStatus";
import { IAudioSource } from "./Audio";

export enum NodeType {
  SmartHQ,
  WarezNode,
  Battle,
}

export interface INodeStyle {
  unclearedIcon: string;
  clearedIcon: string;
  infoImage: string;
  netmapOrgName: string;
}

export interface IBattleStyle {
  warningHeader: string;
  warningText: string[];
  bgImage: string;
  battleLogoImage: string;
  introAudio: IAudioSource;
}

export interface INetmapNode {
  id: string;
  // TODO: make below two fields mandatory
  name?: string;
  description?: string;
  securityLevel: number;
  prereq?: INetmapNode["id"];
  type: NodeType;
  firstClearCredits?: number;
  nodeStyle: INodeStyle;
  preOpen?: (gameStatus: IGameStatusCoordinator) => Promise<boolean | void>;
  onFirstClear?: (gameStatus: IGameStatusCoordinator) => Promise<boolean | void>;
  onFirstLose?: (gameStatus: IGameStatusCoordinator) => Promise<boolean | void>;
}

export interface INetmapBattleNode extends INetmapNode {
  type: NodeType.Battle;
  battleStyle: IBattleStyle;
}

export interface INetmapNonBattleNode extends INetmapNode {
  type: NodeType.WarezNode | NodeType.SmartHQ; // TODO: use enum arithmetic to automatically exclude battle
}

export type NetmapPosition = [number, number];

export interface INetmap {
  initialSave: IGameStatus;
  nodes: (INetmapBattleNode | INetmapNonBattleNode)[];
  positions: { [id: string]: NetmapPosition };
  dimensions: NetmapPosition;
  image: string;
}

export enum NodeStatus {
  VISIBLE = 1,
  ATTEMPTED = 2,
  WON = 4,
  INVISIBLE = 0,
  UNCLEARED_UNATTEMPTED = VISIBLE & ~ATTEMPTED,
  UNCLEARED_ATTEMPTED = VISIBLE | ATTEMPTED,
  CLEARED = WON | ATTEMPTED | VISIBLE,
}
