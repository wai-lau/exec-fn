import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ph-proprietary";
const map = `
12A.-B---..E-#
3C-.-----..-F-
D--.-----..G-H
....-----.....
---------.....
------IJ-----K
.....--------L
.....-----....
@-@..-----.--M
---..-----.-N4
@-@..---O-.P56
`;
const enemies = [
  Programs.Radar,
  Programs.AttackDog,
  Programs.Radar,
  Programs.Radar,
  Programs.Radar,
  Programs.Radar,
  Programs.Radar,
  Programs.Radar,
  Programs.Sensor,
  Programs.Sensor,
  Programs.WatchmanX,
  Programs.WatchmanX,
  Programs.Radar,
  Programs.Radar,
  Programs.AttackDog,
  Programs.Radar,
];
const creditValues: number[] = [750, 800, 790, 840, 760, 830]; // TODO: Made up 4, 5, 6

const level = processMap(id, map, enemies, creditValues);

export default level;

// 34#1:14
