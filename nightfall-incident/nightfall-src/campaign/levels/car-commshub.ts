import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "car-commshub";
const map = `
.----......---
-A-B----------
-----C------@-
-D-E----------
-------------.
--F---------..
..------------
..----------@-
.1------------
.2---@----@--@
...-------.--
`;
const enemies = [
  Programs.WatchmanX,
  Programs.Watchman,
  Programs.GuardDog,
  Programs.Watchman,
  Programs.Warden,
  Programs.GuardDog,
];
const creditValues: number[] = [460, 380];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 8#0:24
