import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "car-substation";
const map = `
...--A-....---
-----------B-C
--1.----------
@------.-----D
-------.-@----
----@-...-----
------..---.--
-----..--2-.-@
..E--.--------
..-F---G----..
..---H---.....
`;
const enemies = [
  Programs.AttackDog,
  Programs.Sentinel3,
  Programs.Sentinel3,
  Programs.Sentinel3,
  Programs.Sentinel3,
  Programs.Sentinel3,
  Programs.AttackDog,
  Programs.Sentinel3,
];
const creditValues: number[] = [670, 670];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 15#1:01
