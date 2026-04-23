import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ph-govaffairs";
const map = `
.-A-......-B-.
--------------
C------------D
--------------
.-----@@-----.
.-1--------2-.
.-----@@-----.
--------------
E------------F
--------------
.-G-......-H-.
`;
const enemies = [
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
  Programs.GuardPup,
];
const creditValues: number[] = [250, 320];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 3#2:37
