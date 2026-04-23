import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ped-executive";
const map = `
-----@@@@-----
--------------
--------------
--------------
.-.-.----.-.-.
.A.-.B..C.-.D.
.-.E.----.F.-.
eeeee----fffff
eeeee-12-fffff
-----GIJH-----
gggggg34hhhhhh
`;
const enemies = [
  Programs.GuardDog,
  Programs.GuardDog,
  Programs.GuardDog,
  Programs.GuardDog,
  Programs.FireWall,
  Programs.FireWall,
  Programs.Sumo,
  Programs.Sumo,
  Programs.Radar,
  Programs.Radar,
];
const creditValues: number[] = [700, 700, 790, 720];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 29#0:58
// TODO: Purple sumo
