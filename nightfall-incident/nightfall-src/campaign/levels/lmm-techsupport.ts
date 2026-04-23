import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-techsupport";
const map = `
.----..----.
---A----B---
.----------.
..--------..
...--..--...
..--------..
.----------.
------------
.---@..@---.
`;
const enemies = [Programs.Sentinel, Programs.Sentinel];

const level = processMap(id, map, enemies);

export default level;

// 2#0:16
