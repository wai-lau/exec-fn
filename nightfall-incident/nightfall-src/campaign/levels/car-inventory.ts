import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "car-inventory";
const map = `
..----------..
.------------.
--aA------Bb--
--------------
--------------
--1---@@---2--
--------------
--------------
--cC------Dd--
.------------.
..----------..

`;
const enemies = [Programs.WatchmanX, Programs.WatchmanX, Programs.WatchmanX, Programs.WatchmanX];
const creditValues: number[] = [350, 480];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 5#2:50
