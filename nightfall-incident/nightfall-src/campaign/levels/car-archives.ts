import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "car-archives";
const map = `
-@--.....12
@@--..--.--
----..--...
---Aaa--.B-
...aaaaa.C-
...aaaaa.--
.---aaaa.--
.---aaaD.--
.........--
3-.EF------
4-.-------#
`;
const enemies = [
  Programs.FireWall,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.Sonar,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
];
const creditValues: number[] = [720, 640, 700, 670]; // TODO

const level = processMap(id, map, enemies, creditValues);

export default level;

// 15#3:11
