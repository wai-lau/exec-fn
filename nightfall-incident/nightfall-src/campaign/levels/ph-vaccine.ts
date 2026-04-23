import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ph-vaccine";
const map = `
a-b-c....-----
a1b2c....-@-@-
A-B-C....-----
-----....-----
-----....-----
-----....-----
-----....-----
-----....-----
-----....-D-E-
-@-@-....dd3ee
-----....dd-ee
`;
const enemies = [
  Programs.Sentinel3,
  Programs.Sentinel3,
  Programs.Sentinel3,
  Programs.WardenP,
  Programs.WardenP,
];
const creditValues: number[] = [650, 590, 680]; // TODO - I made these up

const level = processMap(id, map, enemies, creditValues);

export default level;

// 22#2:33
