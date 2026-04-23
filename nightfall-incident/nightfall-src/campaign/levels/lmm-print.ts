import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-print";
const map = `
a1-Bbb------
a.-----.-cc-
aA.---.--c-.
---.-----C.2
----.--.----
-.----.----.
.----.--.---
-@@.---D-.--
---3.--dd4.-
`;
const enemies = [Programs.Warden, Programs.Warden, Programs.Warden, Programs.Warden];
const creditValues: number[] = [350, 460, 360, 400];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 9#1:32
