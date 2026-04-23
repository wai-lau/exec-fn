import { CoordinateArray, Coordinate } from "../types";
import CoordinatePUQueue from "./CoordinatePUQueue";
import {
  getAdjacent,
  coordinateInArray,
  manhattanDistance,
  coordinatesEqual,
  birdDistance,
} from "./util";

// TODO: Use WeakMap to use objects as key
const { cts, stc } = CoordinatePUQueue;

export function getNearest(from: Coordinate, to: CoordinateArray) {
  return to.sort((a, b) => manhattanDistance(from, a) - manhattanDistance(from, b))[0];
}

export function getGreedyPath(
  from: Coordinate,
  to: Coordinate,
  passable: CoordinateArray,
  maxLength: number
): CoordinateArray {
  if (coordinatesEqual(from, to)) {
    return [from];
  }

  let path: CoordinateArray = [from];
  while (path.length < maxLength + 1) {
    const current = path[path.length - 1];
    const adjacent = getAdjacent(current);
    for (let adj of adjacent) {
      if (!coordinateInArray(adj, passable)) {
        continue;
      }
      if (manhattanDistance(adj, to) < manhattanDistance(current, to)) {
        path.push(adj);
        break;
      }
    }
    if (current === path[path.length - 1]) {
      break;
    }
  }
  return path;
}

export function getPathToClosest(
  from: Coordinate,
  to: Coordinate,
  passable: CoordinateArray,
  maxLength: number
): CoordinateArray | null {
  const possibleDestinations = getRangeFromArea([from], maxLength, passable);
  const bestDestination = possibleDestinations.sort(
    (a, b) => birdDistance(a, to) - birdDistance(b, to)
  )[0];
  //  const bestDestination = possibleDestinations.sort((a, b) => manhattanDistance(a, to) - manhattanDistance(b, to))[0];
  return getPathToArea(from, [bestDestination], passable);
}

export function getPathToArea(
  from: Coordinate,
  to: CoordinateArray,
  passable: CoordinateArray
): CoordinateArray | null {
  // BFS from From to To, disallowing Impassable coordinates
  if (coordinateInArray(from, to)) {
    return [from];
  }

  const queue = new CoordinatePUQueue();
  queue.push(from, 0);
  const prevCoordinate = new Map<string, string>(); // <Coordinate, Coordinate> as strings
  const END = "END";
  prevCoordinate.set(cts(from), END);

  let next;
  while ((next = queue.pop())) {
    const [c, level] = next;
    const adjacent = getAdjacent(c);
    for (let adj of adjacent) {
      if (!coordinateInArray(adj, passable)) {
        continue;
      }
      if (coordinateInArray(adj, to)) {
        let cursor: string | undefined = cts(c);
        const path: CoordinateArray = [adj];
        while (cursor && cursor !== END) {
          path.unshift(stc(cursor));
          cursor = prevCoordinate.get(cursor);
        }
        return path;
      }
      if (queue.push(adj, level + 1)) {
        if (prevCoordinate.has(cts(adj))) {
        }
        prevCoordinate.set(cts(adj), cts(c));
      }
    }
  }

  return null;
}

export function getRangeFromArea(
  area: CoordinateArray,
  range: number,
  passable?: CoordinateArray
): CoordinateArray {
  const queue = new CoordinatePUQueue();
  area.forEach((c) => {
    queue.push(c, 0);
  });

  const inRangeSet = new Set<string>();
  let next;
  while ((next = queue.pop())) {
    const [c, level] = next;
    if (level > range) {
      continue;
    }
    inRangeSet.add(cts(c));

    const adjacent = getAdjacent(c);
    for (let adj of adjacent) {
      if (inRangeSet.has(cts(adj))) {
        continue;
      }
      if (passable && !coordinateInArray(adj, passable)) {
        continue;
      }
      queue.push(adj, level + 1);
    }
  }

  const inRangeArr = Array.from(inRangeSet.values()).map(stc);
  return inRangeArr;
}

export function sortBodyFromHead(head: Coordinate, body: CoordinateArray) {
  const queue = new CoordinatePUQueue();
  queue.push(head, 0);

  const foundBody = new Set<string>();
  let next;
  while ((next = queue.pop())) {
    const [c, level] = next;
    if (!coordinateInArray(c, body)) {
      continue;
    }
    foundBody.add(cts(c));
    const adjacent = getAdjacent(c);
    for (let adj of adjacent) {
      if (foundBody.has(cts(adj))) {
        continue;
      }
      queue.push(adj, level + 1);
    }
  }
  const foundBodyArray = Array.from(foundBody.values()).map(stc);
  return foundBodyArray;
}
