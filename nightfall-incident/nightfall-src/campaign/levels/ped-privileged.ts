import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ped-privileged";
const map = `
-AB-CD-12--E--
---.----------
-F---GH..-I--J
-----------K-.
.-3-..-45----.
.------67----L
----------M--N
@--@----.-O---
@-------.-----
@----------P-Q
-@@@..-89----R
`;
const enemies = [
  Programs.WardenPP,
  Programs.WardenPP,
  Programs.WardenPP,
  Programs.WardenPP,
  Programs.WardenPP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WardenPP,
  Programs.WatchmanSP,
  Programs.WardenPP,
  Programs.WatchmanSP,
  Programs.WardenPP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WardenPP,
  Programs.WardenPP,
];
const creditValues: number[] = [800, 730, 760, 880, 700, 860, 860, 830, 870];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 32#1:23
