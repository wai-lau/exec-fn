import * as P from "../../programs";
import { IWarezData } from "../../types";

const warez: IWarezData = {
  id: "warez-2",
  name: "warez 2",
  prices: {
    [P.GolemStone.id]: 5000,
    [P.Tarantula.id]: 3500,
    [P.Heisenbug.id]: 4000,
    [P.LogicBomb.id]: 3500,
    [P.Sumo.id]: 4500,
    [P.Seeker3.id]: 4500,
    [P.LaserSatellite.id]: 5000,
    [P.Catapult.id]: 4000,
    [P.Clog3.id]: 3500,
    [P.Guru.id]: 4500,
  },
  programs: [
    P.GolemStone,
    P.Tarantula,
    P.Heisenbug,
    P.LogicBomb,
    P.Sumo,
    P.Seeker3,
    P.LaserSatellite,
    P.Catapult,
    P.Clog3,
    P.Guru,
  ],
};

export default warez;
