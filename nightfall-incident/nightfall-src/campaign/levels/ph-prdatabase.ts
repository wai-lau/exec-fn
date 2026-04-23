import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ph-prdatabase";
const map = `
........----
----.----2B-
-A1-.--.----
----.--.....
.--.----.---
.-----@---3k-
.----@----C-
....----.---`;
const enemies = [Programs.Watchman, Programs.GuardPup, Programs.Sentinel];
const creditValues: number[] = [300, 340, 320];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 2#2:11
