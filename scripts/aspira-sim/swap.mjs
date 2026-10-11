// SWAP ONE TOWER (owner, 2026-10-11): the one-of-each team (4 towers, a fixed build order) with ONE tower replaced by a
// second copy of another kind - same tower count, same money - so each kind is measured against the others on equal
// terms (teambal.mjs's added fifth tower measured what the team lacked instead). Same styles and seeds for every cell.
// Prints a matrix of mean lives left (and wins): row = the kind taken out, column = the kind doubled.
// usage: node swap.mjs [seeds=4]   (ASPIRA_PATCH / ASPIRA_WEB as everywhere)
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

const K = ["arc", "frz", "sol", "acd"];
const STYLES = { greedy: { up: 0.8 }, balanced: { up: 0.5 }, saver: { up: 0.3, reserve: 10 } };
export default async function task({ out, dbl, style, seed }) {
  const team = out ? [...K.filter(k => k !== out), dbl] : K, mix = {};
  for (const k of team) mix[k] = (mix[k] || 0) + 1;
  const r = play({ ...STYLES[style], maxTowers: 4, towerCap: 4, opening: team, mix, core: ALL, useCore: true }, seed, 100);
  return { wave: r.wave, won: r.won, lives: Math.max(0, r.lives), leaks: r.leaks };
}
if (isMainThread && process.argv[1] && process.argv[1].endsWith("swap.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), cells = [{ out: null, dbl: null }], jobs = [];
  for (const out of K) for (const dbl of K) if (out !== dbl) cells.push({ out, dbl });
  for (const c of cells) for (const style of Object.keys(STYLES)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ ...c, style, seed });
  const res = await runPool(new URL(import.meta.url), jobs, {});
  const stat = (out, dbl) => {
    const mine = res.filter((r, i) => jobs[i].out === out && jobs[i].dbl === dbl);
    return { lives: mine.reduce((a, r) => a + r.lives, 0) / mine.length, wins: mine.filter(r => r.won).length, n: mine.length, wave: mine.reduce((a, r) => a + r.wave, 0) / mine.length };
  };
  const b = stat(null, null);
  console.log(`base (one of each): lives ${b.lives.toFixed(1)}, won ${b.wins}/${b.n}`);
  console.log("lives (wins) - row: taken out, column: doubled");
  console.log("".padEnd(8) + K.map(k => ("+" + k.toUpperCase()).padStart(14)).join(""));
  for (const out of K) console.log(("-" + out.toUpperCase()).padEnd(8) + K.map(dbl => out === dbl ? "—".padStart(14) : (() => { const s = stat(out, dbl); return `${s.lives.toFixed(1)} (${s.wins}/${s.n})`.padStart(14); })()).join(""));
  // each kind's worth: mean lives over the cells that DOUBLE it, minus the cells that take it OUT
  for (const k of K) {
    const add = K.filter(o => o !== k).map(o => stat(o, k).lives), rem = K.filter(o => o !== k).map(o => stat(k, o).lives);
    console.log(k.toUpperCase().padEnd(5), "doubled avg", (add.reduce((a, x) => a + x, 0) / 3).toFixed(1).padStart(5), " taken out avg", (rem.reduce((a, x) => a + x, 0) / 3).toFixed(1).padStart(5));
  }
}
