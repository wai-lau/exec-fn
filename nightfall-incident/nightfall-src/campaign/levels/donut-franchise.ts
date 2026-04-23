import * as Programs from "../../programs";
import processMap from "../../util/processMap";

const id = "donut-franchise";
const map = `
--------------
-aa-b-------@-
--aAB---------
-c----------@-
-ccCdd--------
-eE--D-----@--
-efF----------
-ff---------@-
--ggG---------
------------@-
--------------
`;
const enemies = [
  Programs.Warden,
  Programs.Sentinel,
  Programs.Warden,
  Programs.Sentinel,
  Programs.Sentinel,
  Programs.Warden,
  Programs.Sentinel,
];

const level = processMap(id, map, enemies);

export default level;

// 13#1:33
