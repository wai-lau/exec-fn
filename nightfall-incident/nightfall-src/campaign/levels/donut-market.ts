import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "donut-market";
const map = `
--@--------a
---@------Aa
@---------Bb
-@---------C
------------
------------
------------
-----------D
-----------d
-EF-------Gg
eefH-----Iig
`;
const enemies = [
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
];

const level = processMap(id, map, enemies);

export default level;

// 16#2:58
