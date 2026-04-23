import db from ".";
import { IGameStatus, NodeStatus, NetmapPosition, INetmapNode } from "../types";
import * as Programs from "../programs";

const DEFAULT_KEY = "save";

interface ISerializableGameStatus extends Omit<IGameStatus, "availablePrograms"> {
  programIDs: string[];
}

class SerializableGameStatus implements ISerializableGameStatus {
  numCredits: number;
  collectedCreditIDs: string[];
  netmapStatus: { [id: string]: NodeStatus };
  securityLevel: number;
  programIDs: string[];
  completedTutorial: boolean;
  scrollPosition: NetmapPosition;
  firstClearNode: { id: INetmapNode["id"]; result: "clear" | "lose" } | null;
  nightfallAvailableNodes?: INetmapNode["id"][];

  constructor(props: ISerializableGameStatus) {
    this.numCredits = props.numCredits;
    this.collectedCreditIDs = props.collectedCreditIDs;
    this.netmapStatus = props.netmapStatus;
    this.securityLevel = props.securityLevel;
    this.programIDs = props.programIDs;
    this.completedTutorial = props.completedTutorial;
    this.scrollPosition = props.scrollPosition;
    this.firstClearNode = props.firstClearNode;
    this.nightfallAvailableNodes = props.nightfallAvailableNodes;
  }

  static fromIGameStatus = (gs: IGameStatus) => {
    const { availablePrograms, ...rest } = gs;
    const programIDs = availablePrograms.map((p) => p.id);
    return new SerializableGameStatus({
      programIDs,
      ...rest,
    });
  };

  static fromJSON = (json: string) => {
    const obj = JSON.parse(json);
    const {
      numCredits,
      collectedCreditIDs,
      netmapStatus,
      securityLevel,
      programIDs,
      completedTutorial,
      scrollPosition,
      firstClearNode,
      nightfallAvailableNodes,
    } = obj;
    if (
      numCredits === undefined ||
      !collectedCreditIDs ||
      !netmapStatus ||
      !securityLevel ||
      !programIDs ||
      !scrollPosition
    ) {
      console.error("Malformed save:", json);
      throw new Error("Could not load malformed save");
    }
    return new SerializableGameStatus({
      numCredits,
      collectedCreditIDs,
      netmapStatus,
      securityLevel,
      programIDs,
      completedTutorial,
      scrollPosition,
      firstClearNode,
      nightfallAvailableNodes,
    });
  };

  toJSON = () => {
    const {
      numCredits,
      collectedCreditIDs,
      netmapStatus,
      securityLevel,
      programIDs,
      completedTutorial,
      scrollPosition,
      firstClearNode,
      nightfallAvailableNodes,
    } = this;
    return JSON.stringify({
      numCredits,
      collectedCreditIDs,
      netmapStatus,
      securityLevel,
      programIDs,
      completedTutorial,
      scrollPosition,
      firstClearNode,
      nightfallAvailableNodes,
    });
  };

  toIGameStatus = () => {
    const availablePrograms = this.programIDs
      .map((id) => Object.values(Programs).find((p) => p.id === id))
      .filter((x) => x !== undefined);
    const withPrograms = {
      ...this,
      availablePrograms,
    };
    const { programIDs, ...asIGameStatus } = withPrograms;
    return asIGameStatus as IGameStatus;
  };
}

export async function saveGameStatus(status: IGameStatus, key: string = DEFAULT_KEY) {
  const json = SerializableGameStatus.fromIGameStatus(status).toJSON();
  return db.setItem(key, json);
}

export async function deleteGameStatus(key: string) {
  return db.removeItem(key);
}

export async function loadGameStatus(key: string = DEFAULT_KEY, failValue: IGameStatus) {
  try {
    const json = (await db.getItem(key)) as string;
    const status = SerializableGameStatus.fromJSON(json).toIGameStatus();
    return status;
  } catch (e) {
    console.error("Could not load save file: " + e.toString());
    return failValue;
  }
}
