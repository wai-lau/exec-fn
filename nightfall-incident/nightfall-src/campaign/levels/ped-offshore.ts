import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ped-offshore";
const map = `
----@..--.....
-@----.----.-.
------.--A----
@-----.-------
.------B------
---------C----
...--..------.
.--D----------
.-----E---F1--
----G--H--23--
.--.--------..
`;
const enemies = [
  Programs.Watchman,
  Programs.Sensor,
  Programs.Watchman,
  Programs.Sensor,
  Programs.Watchman,
  Programs.Sensor,
  Programs.Watchman,
  Programs.Sensor,
];
const creditValues: number[] = [570, 630, 550];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 21#3:31
