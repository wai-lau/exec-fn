// pool task: one play() - eval / combos / modes fan their games out over this
import { play } from "./sim.mjs";
export default async ({ strategy, seed, maxWave, dt = 0.02, patch = "" }) => play(strategy, seed, maxWave, dt, patch);
