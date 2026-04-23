import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-banane";
const map = `
-------@-----@
A-B---@--@-@--
-C------@-----
---D------@-@-
.-E----------@
..-F--------@-
..-G-H--------
.-I-J-K--L----
M-------N-O---
-#PQ...----R-S
T--.....-U----
`;
const enemies = [
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Watchman,
  Programs.GuardPup,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Watchman,
  Programs.Sentinel,
  Programs.GuardPup,
  Programs.Sentinel,
  Programs.GuardPup,
  Programs.Watchman,
  Programs.Sentinel,
  Programs.GuardPup,
  Programs.Watchman,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
];

const level = processMap(id, map, enemies);

export default level;

// 10#0:11
