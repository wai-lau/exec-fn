import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "donut-beverage";
const map = `
..-@@@--@@@-..
.------------.
--------------
--------------
--------------
--------------
--------------
--------------
--------------
.ABCD----EFGH.
..IJ------KL..
`;
const enemies = [
  Programs.Sentinel3,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.Sentinel3,
  Programs.Sentinel3,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.Sentinel3,
  Programs.AttackDog,
  Programs.AttackDog,
  Programs.AttackDog,
  Programs.AttackDog,
];

const level = processMap(id, map, enemies);

export default level;
