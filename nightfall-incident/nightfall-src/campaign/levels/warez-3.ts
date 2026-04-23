import * as P from "../../programs";
import { IWarezData } from "../../types";

const warez: IWarezData = {
  id: "warez-2",
  name: "warez 2",
  prices: {
    [P.Hack3.id]: 3500,
    [P.GolemClay.id]: 3000,
    [P.BlackWidow.id]: 2000,
    [P.Mandelbug.id]: 3000,
    [P.Buzzbomb.id]: 3500,
    [P.Fiddle.id]: 2400,
    [P.Seeker2.id]: 2500,
    [P.MobileTower.id]: 1800,
    [P.Satellite.id]: 3500,
    [P.Ballista.id]: 3000,
    [P.DataDoctorPro.id]: 1500,
    [P.Clog2.id]: 2000,
    [P.TurboDX.id]: 1750,
  },
  programs: [
    P.Hack3,
    P.GolemClay,
    P.BlackWidow,
    P.Mandelbug,
    P.Buzzbomb,
    P.Fiddle,
    P.Seeker2,
    P.MobileTower,
    P.Satellite,
    P.Ballista,
    P.DataDoctorPro,
    P.Clog2,
    P.TurboDX,
  ],
};

export default warez;
