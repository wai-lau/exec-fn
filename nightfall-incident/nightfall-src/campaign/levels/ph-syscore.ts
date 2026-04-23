import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ph-syscore";
const map = `
--A-B---C--D--
-E-----F....-G
....-H---I-J--
------....----
---------12--.
--....--------
-34-------..--
------..------
.-----------..
----....------
-@@------@@---
`;
const enemies = [
  Programs.Sentinel3,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.Sentinel3,
  Programs.WatchmanSP,
  Programs.Sentinel3,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
];
const creditValues: number[] = [720, 740, 810, 870];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 28#2:29
