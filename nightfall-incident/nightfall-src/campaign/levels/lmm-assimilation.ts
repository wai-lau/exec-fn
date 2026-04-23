import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-assimilation";
const map = `
@--------1
----------
---aaaA---
---aaaa---
---aaaa---
----------
2--------@
`;
const enemies = [Programs.Sumo];
const creditValues: number[] = [860, 790]; // TODO, made up 790

const level = processMap(id, map, enemies, creditValues);

export default level;

// 24#0:57
