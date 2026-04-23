import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "donut-supply";
const map = `
-@-----------@
@------aA-----
----B---------
----b-----C---
--Dd-E----c---
-----eef------
---g---fF-hH--
---G-----i----
---------I----
-----Jj------@
@-----------@-
`;
const enemies = [
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel2,
  Programs.Sentinel2,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
];

const level = processMap(id, map, enemies);

export default level;

// 8#3:29
