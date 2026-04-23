import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "ped-fiduciary";
const map = `
aA-----Bb
aa-----bb
----@----
cc-----dd
cC-----Dd
`;
const enemies = [Programs.Sentinel2, Programs.Sentinel2, Programs.Sentinel2, Programs.Sentinel2];
const level = processMap(id, map, enemies);

export default level;

// 14#0:18
