import { Coordinate, CoordinateArray, CoordinateMap, CoordinateFill } from "../types";

export const addCoordinates = (c1: Coordinate, c2: Coordinate) =>
  [c1[0] + c2[0], c1[1] + c2[1]] as Coordinate;
export const coordinatesEqual = (c1: Coordinate, c2: Coordinate) =>
  c1[0] === c2[0] && c1[1] === c2[1];
export const coordinateInArray = (c: Coordinate, arr: CoordinateArray) =>
  arr.some((x) => coordinatesEqual(c, x));
export const coordinateArrayUniq = (arr: CoordinateArray) =>
  arr
    .map((x) => x.join(",")) // TODO: Coordinate without going through string
    .filter((x, i, a) => a.indexOf(x) === i)
    .map((x) => x.split(",").map(Number)) as CoordinateArray;
export const deleteFromArray = (c: Coordinate, arr: CoordinateArray) =>
  arr.filter((x) => !coordinatesEqual(x, c));
export const coordinateKey = (c: Coordinate, name: string = "coord") => `${name}:${c[0]},${c[1]}`;
export const create2DArray = (d1: number, d2: number, getValue: (i: number, j: number) => any) => {
  const arr = [];
  for (let i = 0; i < d1; i++) {
    const row = [];
    for (let j = 0; j < d2; j++) {
      row.push(getValue(i, j));
    }
    arr.push(row);
  }
  return arr;
};
export const isInBounds = (c: Coordinate, width: number, height: number) => {
  return c[0] >= 0 && c[0] < width && c[1] >= 0 && c[1] < height;
};
export const getAdjacent = (c: Coordinate) => {
  const possible: CoordinateArray = [
    [c[0] + 1, c[1]],
    [c[0] - 1, c[1]],
    [c[0], c[1] + 1],
    [c[0], c[1] - 1],
  ];
  return possible.sort(() => Math.random() - 0.5);
};
export const resolveImage = (fname: string) => {
  return require(`../img/${fname}`);
};
export function cloneCoordinateMap<T>(map: CoordinateMap<T>) {
  const height = map.length;
  const width = map[0].length;
  return create2DArray(height, width, (i, j) => map[i][j]);
}
// TODO: matchFlag type is a mess...
export function matchFlag<T>(value: T, flag: T) {
  return (
    (((((value as unknown) as number) & ((flag as unknown) as number)) as unknown) as T) === flag
  );
}
export function asciiMapToCoordinateFill(map: string): CoordinateFill {
  return map
    .trim()
    .split("\n")
    .map((x) => x.trim().split(""))
    .map((row) => row.map((x) => x === "1"));
}
export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(ms, 0));
  });
}

export function getDistance(dims: number, c1: Coordinate, c2: Coordinate) {
  if (dims === 0) {
    throw new Error("Cannot use dimension 0");
  }
  return (Math.abs(c1[0] - c2[0]) ** dims + Math.abs(c1[1] - c2[1]) ** dims) ** (1 / dims);
}
export const manhattanDistance = getDistance.bind(null, 1);
export const birdDistance = getDistance.bind(null, 2);

export const tailDebounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<F>) => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    timeout = setTimeout(() => func(...args), waitFor);
  };

  return debounced as (...args: Parameters<F>) => ReturnType<F>;
};

export const leadDebounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
  let canRun: boolean = true;
  const debounced = (...args: Parameters<F>) => {
    if (canRun) {
      func(...args);
      setTimeout(() => {
        canRun = true;
      }, waitFor);
      canRun = false;
    }
  };

  return debounced as (...args: Parameters<F>) => ReturnType<F>;
};

export const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
