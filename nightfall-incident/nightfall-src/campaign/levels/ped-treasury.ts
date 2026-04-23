import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ped-treasury";
const map = `
1.AB-CDEF-GH.2
..----------..
I------------J
--------------
K----@--@----L
M-----@@-----N
O----@--@----P
--------------
Q------------R
..----------..
3.ST-UVWX-YZ.4 
`; // Exactly 26 enemies...
const enemies = [
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.Watchman,
  Programs.Watchman,
  Programs.Watchman,
  Programs.Watchman,
  Programs.Watchman,
  Programs.Watchman,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.GuardPup,
  Programs.GuardPup,
];
const creditValues: number[] = [780, 860, 870, 840]; // TODO I totally made these up

const level = processMap(id, map, enemies, creditValues);

export default level;

// 30#1:35
