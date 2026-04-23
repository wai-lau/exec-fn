import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ph-hmo";
const map = `
--------------
-----ABCDE----
K#---12345----
-----FGHIJ----
--------------
............--
............--
............--
.@--........--
.@------------
.@------------
`;
const enemies = [
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sonar,
];
const creditValues: number[] = [680, 650, 670, 680, 620];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 23#0:12
