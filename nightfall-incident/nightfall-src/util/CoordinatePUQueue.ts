import PUQueue, { IPUQueue } from "./PUQueue";
import { Coordinate } from "../types";

export default class CoordinatePUQueue implements IPUQueue<Coordinate> {
  puq: PUQueue<string>;

  static cts = (c: Coordinate) => c.join(",");
  static stc = (s: string) => s.split(",").map(Number) as Coordinate;

  constructor() {
    this.puq = new PUQueue();
  }

  getLevel = (c: Coordinate) => this.puq.getLevel(CoordinatePUQueue.cts(c));
  push = (c: Coordinate, level: number) => this.puq.push(CoordinatePUQueue.cts(c), level);
  pop = () => {
    const stringPop = this.puq.pop();
    // TODO: ... this is a mess
    return stringPop
      ? ([CoordinatePUQueue.stc(stringPop[0] as string), stringPop[1] as number] as [
          Coordinate,
          number
        ])
      : null;
  };
}
