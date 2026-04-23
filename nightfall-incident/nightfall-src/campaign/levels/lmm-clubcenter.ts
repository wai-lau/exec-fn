import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-clubcenter";
const map = `
a-..@-@.
aabb----
cA-B--@-
ccC-----
.ddD..-@
`;
const enemies = [Programs.Sentinel2, Programs.Sentinel2, Programs.Sentinel2, Programs.Sentinel2];

const level = processMap(id, map, enemies);

export default level;

// 4#2:24
