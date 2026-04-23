import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "car-memorytower";
const map = `
.........--.
..-...---A--
.------D--B-
---------C-.
----------E.
-----------.
--@@-------.
.-@@-------.
.----------.
....---.....
`;

const enemies = [
  Programs.Watchman,
  Programs.Watchman,
  Programs.Sentinel,
  Programs.GuardPup,
  Programs.GuardPup,
];

const level = processMap(id, map, enemies);

export default level;

// 2#4:13
