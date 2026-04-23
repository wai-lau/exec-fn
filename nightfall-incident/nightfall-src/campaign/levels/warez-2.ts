import * as P from "../../programs";
import { IWarezData } from "../../types";

const warez: IWarezData = {
  id: "warez-2",
  name: "warez 2",
  prices: {
    [P.Hack2.id]: 1500,
    [P.GolemMud.id]: 1200,
    [P.WolfSpider.id]: 750,
    [P.Seeker.id]: 1000,
    [P.Tower.id]: 1000,
    [P.Medic.id]: 1000,
    [P.Turbo.id]: 1000,
  },
  programs: [P.Hack2, P.GolemMud, P.WolfSpider, P.Seeker, P.Tower, P.Medic, P.Turbo],
};

export default warez;
