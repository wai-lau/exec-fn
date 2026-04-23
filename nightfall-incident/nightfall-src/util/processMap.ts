import { IProgram, CoordinateArray, Coordinate } from "../types";
import { ILevel } from "../types";
import { sortBodyFromHead } from "./path";

export default function processMap(
  id: string,
  map: string,
  enemies: IProgram[],
  creditValues: number[] = []
) {
  const arr = map
    .trim()
    .split("\n")
    .map((x) => x.trim().split(""));
  const width = arr[0].length;
  const height = arr.length;
  const filledCoordinates = arr.map((row) => row.map((x) => x !== "."));
  const teams = ["P1", "CPU"];

  const lAlphabet = "abcdefghijklmnopqrstuvwxyz";
  const uAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const nums = "1234567890";

  const uploadZoneLocations: CoordinateArray = [];
  const heads: CoordinateArray = [];
  const bodies: CoordinateArray[] = [];
  const creditLocations: CoordinateArray = [];
  let dataPack: Coordinate | undefined = undefined;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const char = arr[y][x];
      const c: Coordinate = [x, y];
      if (char === "@") {
        uploadZoneLocations.push(c);
      } else if (uAlphabet.includes(char)) {
        const index = uAlphabet.indexOf(char);
        heads[index] = c;
        bodies[index] = [c, ...(bodies[index] || [])];
      } else if (lAlphabet.includes(char)) {
        const index = lAlphabet.indexOf(char);
        bodies[index] = [c, ...(bodies[index] || [])];
      } else if (nums.includes(char)) {
        const index = nums.indexOf(char);
        creditLocations[index] = c;
      } else if (char === "#") {
        dataPack = c;
      }
    }
  }

  const uploadZones = uploadZoneLocations.map((c) => ({
    position: c,
    team: "P1",
  }));
  const programs = enemies.map((e, i) => ({
    ...e,
    team: "CPU",
    head: heads[i],
    body: sortBodyFromHead(heads[i], bodies[i]),
  }));
  const credits = creditValues.map((val, i) => ({
    id: `credit-${id}-${i}`,
    amount: val,
    position: creditLocations[i],
  }));

  const level: ILevel = {
    id,
    width,
    height,
    filledCoordinates,
    teams,
    uploadZones,
    programs,
    credits,
    dataPack,
  };

  return level;
}
