import IGame from "../types/GameAI";
import { CoordinateArray, Coordinate } from "../types";
import {
  getPathToArea,
  getRangeFromArea,
  getGreedyPath,
  getNearest,
  getPathToClosest,
} from "./path";
import {
  coordinateArrayUniq,
  isInBounds,
  delay,
  coordinatesEqual,
  getAdjacent,
  coordinateInArray,
} from "./util";

export default class AIController {
  game: IGame;
  actionDelay: number;

  constructor(game: IGame, actionDelay: number) {
    this.game = game;
    this.actionDelay = actionDelay;
  }

  private getProgramPathToArea = (programID: string, to: CoordinateArray) => {
    const program = this.game.getProgramByID(programID);
    const passable = this.game.getPassable(programID);
    return getPathToArea(program.head, to, passable);
  };

  private bodyAfterPath = (body: CoordinateArray, path: CoordinateArray, maxSize: number) =>
    coordinateArrayUniq([...[...path].reverse(), ...body]).slice(0, maxSize);

  // Path to area, then check if the path can be continued for more growth
  private getProgramPathToAreaWithGrowth = (programID: string, to: CoordinateArray) => {
    const program = this.game.getProgramByID(programID);
    const passable = this.game.getPassable(programID);
    const start = program.head;
    const initialPath = getPathToArea(start, to, passable);
    if (!initialPath) {
      return initialPath;
    }

    let path = initialPath.slice(0, program.movesRemaining + 1);
    let movesAfterPath;
    while ((movesAfterPath = program.movesRemaining - (path.length - 1))) {
      let didChangePath = false;
      const resultingBody = this.bodyAfterPath(program.body, path, program.maxSize);
      const end = path[path.length - 1];
      // The path is non-optimal if the resulting body is shorter than both the maxSize and
      // the sum of the current body length and the number of remaining moves
      if (
        resultingBody.length <
          Math.min(program.maxSize, program.body.length + program.movesRemaining) ||
        !coordinateInArray(end, to)
      ) {
        // If the current path could be longer
        // Check if we can path to the target area from an adjacent coordinate
        // Then add that coordinate to the path
        const adjacent = getAdjacent(end).filter((c) => coordinateInArray(c, passable));
        const adjNotInBody = adjacent.filter((c) => !coordinateInArray(c, program.body));
        const adjInBody = adjacent.filter((c) => coordinateInArray(c, program.body));
        for (let adj of [...adjNotInBody, ...adjInBody]) {
          const pathFromAdj = getPathToArea(adj, to, passable);
          if (!pathFromAdj) {
            continue;
          }
          if (pathFromAdj.length <= movesAfterPath) {
            // path.push(...pathFromAdj);
            path.push(adj);
            didChangePath = true;
            break;
          }
        }
      }
      if (!didChangePath) {
        return path;
      }
    }
    return path;
  };

  private getRangeFromProgram = (programID: string, range: number) => {
    const [width, height] = this.game.getDimensions();
    const program = this.game.getProgramByID(programID);
    return coordinateArrayUniq(getRangeFromArea(program.body, range)).filter((c) =>
      isInBounds(c, width, height)
    );
  };

  private getOppositeProgramIDs = (programID: string) => {
    const program = this.game.getProgramByID(programID);
    return this.game
      .getPrograms()
      .filter((p) => p.team !== program.team)
      .map((p) => p.id);
  };

  private getProgramPathToPrograms = (fromID: string, toIDs: string[], range: number) => {
    const adjacents = toIDs
      .map((id) => this.getRangeFromProgram(id, range))
      .reduce((val, next) => [...val, ...next], []);
    const adjacentsUniq = coordinateArrayUniq(adjacents);
    // return this.getProgramPathToArea(fromID, adjacentsUniq);
    return this.getProgramPathToAreaWithGrowth(fromID, adjacentsUniq);
  };

  private getGreedyPathToEnemies = (programID: string) => {
    const programs = this.game.getPrograms();
    const program = this.game.getProgramByID(programID);
    const oppositeIDs = this.getOppositeProgramIDs(programID);
    const oppositeHeads = oppositeIDs
      .map((id) => programs.find((x) => x.id === id))
      .filter((x) => !!x)
      .map((x) => x!.head);
    // return getGreedyPath(
    return getPathToClosest(
      program.head,
      getNearest(program.head, oppositeHeads),
      this.game.getPassable(programID),
      program.movesRemaining
    );
  };

  private getProgramPathToEnemies = (programID: string, range: number) => {
    const oppositeIDs = this.getOppositeProgramIDs(programID);
    return (
      this.getProgramPathToPrograms(programID, oppositeIDs, range) ||
      this.getGreedyPathToEnemies(programID)
    );
  };

  programFollowPath = (programID: string, path: CoordinateArray) => {
    const followPromise = new Promise(async (resolve) => {
      let current: Coordinate | undefined;
      this.game.createOnSelectProgram(programID)();
      while ((current = path.shift())) {
        await delay(this.actionDelay);

        const program = this.game.getProgramByID(programID);
        if (!current || program.movesRemaining <= 0) {
          return resolve();
        }
        if (!coordinatesEqual(program.head, current)) {
          throw new Error("Program is not at correct location");
        }

        const next = path[0];
        if (!next) {
          return resolve();
        }

        await this.game.createOnMove(next)();
      }
    });
    return followPromise;
  };

  runTurn = async (programID: string) => {
    const program = this.game.getProgramByID(programID);
    // In the original game, each enemy has only one attack.
    // Thus, we can pathfind using the range from the 1st action.
    const ACTION_INDEX = 0;
    const action = program.actions[ACTION_INDEX];
    const { range } = action;
    const path = this.getProgramPathToEnemies(programID, range);
    if (!path) {
      this.game.onSelectNoAction();
      return;
    }
    await this.programFollowPath(programID, path);
    await this.game.onSelectAction(ACTION_INDEX);
    await delay(this.actionDelay);
    const validTargets = this.game.getValidTargets();
    if (!validTargets) {
      this.game.onSelectNoAction();
      return;
    }

    const enemyIDs = this.getOppositeProgramIDs(programID);
    const validTargetsWithEnemies = validTargets.filter((c) =>
      enemyIDs.includes(this.game.getProgramIDAtCoordinate(c) || "")
    );
    if (validTargetsWithEnemies.length) {
      const randTarget =
        validTargetsWithEnemies[Math.floor(Math.random() * validTargetsWithEnemies.length)];
      this.game.createOnAct(randTarget)();
      return;
    }
    this.game.onSelectNoAction();
    return;
  };
}
