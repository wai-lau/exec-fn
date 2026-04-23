import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "disarray-hq";
const map = `
BCDEFGH..aaaaa
IJKLMNO.PAaaaa
-------..-aaaa
-------.Q-aaaa
-------..-aaaa
-------...R.S.
-------.......
---------ttttt
-@@@@@---Ttttt
-@@@@@---Uuuuu
---------uuuuu
`;
const enemies = [
  Programs.Boss,
  Programs.AttackDog,
  Programs.AttackDog,
  Programs.WardenPP,
  Programs.WardenPP,
  Programs.WardenPP,
  Programs.AttackDog,
  Programs.AttackDog,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.WardenP,
  Programs.WardenP,
  Programs.WardenP,
  Programs.WatchmanSP,
  Programs.WatchmanSP,
  Programs.Radar,
  Programs.Radar,
  Programs.Radar,
  Programs.Radar,
  Programs.Sumo,
  Programs.Sumo,
];

const level = processMap(id, map, enemies);

export default level;

// TODO Purple sumo
// 37#0:40
