import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-jungle";
const map = `
---@------@---
--------------
--------------
--aaaAaaaaaa--
--aaaaaaaaaa--
B------------C
bbb--dddd-cccc
bbb-dddDd-cccc
bbb--d#dd--ccc
-1---ddddd--2-
`;
const enemies = [Programs.FireWall, Programs.FireWall, Programs.FireWall, Programs.FireWall];
const creditValues: number[] = [610, 690];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 18#0:15
