import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-eastern";
const map = `
.---......---.
---A-....--@@-
-#B--....-----
C----.....----
-D---..-------
-1E-----------
-------..-----
-F--.....-----
-2---....-----
---G-....--@@-
.---......---.
`;
const enemies = [
  Programs.GuardDog,
  Programs.GuardDog,
  Programs.GuardDog,
  Programs.GuardDog,
  Programs.GuardDog,
  Programs.GuardDog,
  Programs.GuardDog,
];
const creditValues: number[] = [360, 450];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 6#0:16
