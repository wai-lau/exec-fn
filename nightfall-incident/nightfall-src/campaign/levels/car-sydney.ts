import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "car-sydney";
const map = `
-------.....
-------...1.
-------..---
--@---A..---
-------..C#-
--@---B..---
-------..---
-------...2.
-------.....
`;
const enemies = [Programs.Sentinel, Programs.Sentinel, Programs.Sentinel];
const creditValues: number[] = [270, 340];

const level = processMap(id, map, enemies, creditValues);

level.programs.push({
  ...Programs.BitMan,
  team: "P1",
  head: [0, 4],
  body: [[0, 4]],
});

export default level;

// 4#0:14
