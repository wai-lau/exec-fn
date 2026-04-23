import * as P from "../../programs";
import { IWarezData } from "../../types";

const warez: IWarezData = {
  id: "warez-1",
  name: "warez 1",
  prices: {
    [P.Hack.id]: 500,
    [P.Bug.id]: 750,
    [P.Slingshot.id]: 750,
    [P.DataDoctor.id]: 500,
    [P.BitMan.id]: 250,
  },
  programs: [P.Hack, P.Bug, P.Slingshot, P.DataDoctor, P.BitMan],
};

export default warez;
