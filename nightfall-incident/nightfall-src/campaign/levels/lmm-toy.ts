import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-toy";
const map = `
------------
-@--------A-
------------
----bbbB----
----bbbb----
----bbbb----
------------
-C--------@-
------------
`;
const enemies = [Programs.AttackDog, Programs.FireWall, Programs.AttackDog];
const level = processMap(id, map, enemies);

export default level;

// 11#0:44
