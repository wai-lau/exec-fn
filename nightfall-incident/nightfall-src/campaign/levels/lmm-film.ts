import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "lmm-film";
const map = `
---.aaaaaa.-1-
-#--aaaaaA--23
---.aaaaaa.---
............-.
............-.
............-.
---.bbbbbb.---
-@--Bbbbbb--45
---.bbbbbb.-6-
`;
const enemies = [Programs.FireWall, Programs.FireWall];
const creditValues: number[] = [800, 890, 840, 900, 760, 860]; // TODO - may be inaccurate

const level = processMap(id, map, enemies, creditValues);

export default level;

// 26#3:41
