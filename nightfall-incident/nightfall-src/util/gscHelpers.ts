import { IGameStatusCoordinator, IProgram, IDialogue } from "../types";

export const revealNode = (ids: string | string[]) => async (gsc: IGameStatusCoordinator) => {
  const idList = Array.isArray(ids) ? ids : [ids];
  await Promise.all(idList.map((id) => gsc.revealNode(id)));
  return;
};

export const addProgram = (p: IProgram) => async (gsc: IGameStatusCoordinator) => {
  await gsc.addProgram(p);
  return;
};

export const setLevel = (l: number) => async (gsc: IGameStatusCoordinator) => {
  await gsc.setLevel(l);
  return;
};

export const startDialogue = (dialogue: IDialogue) => async (gsc: IGameStatusCoordinator) => {
  await gsc.startDialogue(dialogue);
  return;
};

export const addCredits = (numCredits: number) => async (gsc: IGameStatusCoordinator) => {
  await gsc.addCredits(numCredits);
  return;
};

export const displayMessage = (header: string, message: string) => async (
  gsc: IGameStatusCoordinator
) => {
  await gsc.displayMessage(header, message);
  return;
};

export const setNightfallNodes = (ids?: string[]) => async (gsc: IGameStatusCoordinator) => {
  await gsc.setNightfallNodes(ids);
  return;
};

export const chain = (...funcs: Function[]) => async (gsc: IGameStatusCoordinator) => {
  for (let f of funcs) {
    await f(gsc);
  }
  return;
};
