import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "donut-flavor";
const map = `
.-.-.---.-.-.
1-----#-----2
.-A-------B-.
-------------
.-----------.
3-C-------D-4
.-----------.
.-E-------F-.
5-----@-----6
.-.-.---.-.-.
`;
const enemies = [
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Sentinel,
];
const creditValues: number[] = [620, 520, 700, 550, 530, 620];

const level = processMap(id, map, enemies, creditValues);

export default level;

// 17#2:25
