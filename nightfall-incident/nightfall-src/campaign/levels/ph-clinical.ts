import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ph-clinical";
const map = `
...........--#
.A--B...----C-
.-..-...*..---
.-..-...-.....
.*..-...-.....
.-..-D..E-....
.-...-...-.F12
.-...-...-.-34
@--..-...-.-56
---..-*---.-78
--@........-90
`;
const enemies = [
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.Sensor,
  Programs.WardenPP,
];
const creditValues: number[] = [440, 450, 500, 470, 450, 370, 370, 380, 420, 470];

const level = processMap(id, map, enemies, creditValues);

level.credits &&
  level.credits.push(
    {
      id: "ph-clinical-x1",
      position: [1, 4],
      amount: 480,
    },
    {
      id: "ph-clinical-x2",
      position: [6, 9],
      amount: 400,
    },
    {
      id: "ph-clinical-x3",
      position: [8, 2],
      amount: 490,
    }
  );

export default level;

// 7#0:24
