// WAVE REPORT (owner, 2026-10-11: "an enemy balance test", "a boss balance test (bosses harder than regular waves,
// but not too much)", "a difficulty test"): real three-tower games - every trio x three styles x seeds, core powers
// used - with a record per ORIGIN wave (each enemy knows the wave it came from; sim.mjs's waveStats): its types, the
// lives it cost, how close it came. Three readings of the same games:
//   ENEMIES  ordinary waves by type and wave band: lives lost per wave, closest approach
//   BOSSES   each boss wave against the four ordinary waves round it: lives, closest approach (a boss should come
//            somewhat closer and cost somewhat more - not nothing, not a wipe)
//   CURVE    where games end, lives lost by band, wins
// usage: node waverep.mjs [seeds=3]   (ASPIRA_PATCH / ASPIRA_WEB as everywhere)
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

const K = ["arc", "frz", "sol", "acd"], STYLES = { greedy: { up: 0.8 }, balanced: { up: 0.5 }, saver: { up: 0.3, reserve: 10 } };
export default async function task({ trio, style, seed }) {
  const r = play({ ...STYLES[style], maxTowers: 3, opening: trio, mix: Object.fromEntries(trio.map(k => [k, 1])), core: ALL, useCore: true }, seed, 100);
  const ws = {};
  for (const [n, w] of Object.entries(r.waveStats)) ws[n] = { types: w.types, lost: w.lost, near: Number.isFinite(w.near) ? Math.round(w.near) : null, boss: w.boss };
  return { wave: r.wave, won: r.won, lives: r.lives, ws };
}
const BANDS = [[1, 20], [21, 40], [41, 60], [61, 80], [81, 100]];
const band = n => BANDS.findIndex(([a, b]) => n >= a && n <= b);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const f1 = v => Number.isFinite(v) ? v.toFixed(1) : "  -";
if (isMainThread && process.argv[1] && process.argv[1].endsWith("waverep.mjs")) {
  const SEEDS = Number(process.argv[2] || 3), trios = [], jobs = [];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 4; c++) trios.push([K[a], K[b], K[c]]);
  for (const trio of trios) for (const style of Object.keys(STYLES)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ trio, style, seed });
  const res = await runPool(new URL(import.meta.url), jobs, {});
  // a wave counts only in games that reached past it (a dead game's later waves never came)
  const rows = []; // { n, type, boss, lost, near }
  for (const r of res) for (const [n, w] of Object.entries(r.ws)) {
    if (+n >= r.wave && !r.won) continue;
    const type = w.boss ? "boss" : Object.entries(w.types).sort((x, y) => y[1] - x[1])[0][0];
    rows.push({ n: +n, type, lost: w.lost, near: w.near ?? 400 });
  }
  console.log("== ENEMIES: ordinary waves by type - lives lost per wave / closest approach (core units) by band");
  console.log("".padEnd(8) + BANDS.map(([a, b]) => `${a}-${b}`.padStart(16)).join(""));
  for (const t of ["swarm", "fast", "shield", "armor"]) {
    console.log(t.padEnd(8) + BANDS.map((_, i) => { const m = rows.filter(r => r.type === t && band(r.n) === i); return (f1(mean(m.map(r => r.lost))) + " / " + Math.round(mean(m.map(r => r.near)))).padStart(16); }).join(""));
  }
  console.log("== BOSSES: boss wave vs the 4 ordinary waves round it - lives lost, closest approach");
  for (let n = 10; n <= 100; n += 10) {
    const bw = rows.filter(r => r.n === n && r.type === "boss"), nb = rows.filter(r => r.type !== "boss" && Math.abs(r.n - n) <= 2 && r.n !== n);
    if (!bw.length) continue;
    const bl = mean(bw.map(r => r.lost)), nl = mean(nb.map(r => r.lost)), bn = mean(bw.map(r => r.near)), nn = mean(nb.map(r => r.near));
    console.log(String(n).padStart(3), `boss lost ${f1(bl).padStart(5)} near ${String(Math.round(bn)).padStart(4)}  |  neighbours lost ${f1(nl).padStart(5)} near ${String(Math.round(nn)).padStart(4)}  |  breached ${bw.filter(r => r.lost > 0).length}/${bw.length}`);
  }
  console.log("== CURVE");
  const ends = res.map(r => r.won ? 101 : r.wave).sort((a, b) => a - b), pct = p => ends[Math.floor(p * (ends.length - 1))];
  console.log(`won ${res.filter(r => r.won).length}/${res.length}  end wave p10 ${pct(0.1)} p50 ${pct(0.5)} p90 ${pct(0.9)} (101 = won)`);
  console.log("lives lost per game by band: " + BANDS.map(([a, b], i) => `${a}-${b} ${f1(rows.filter(r => band(r.n) === i).reduce((s, r) => s + r.lost, 0) / res.length)}`).join("  "));
  for (const trio of trios) { const m = res.filter((r, i) => jobs[i].trio === trio); console.log("  " + trio.join("+").toUpperCase().padEnd(12), `won ${m.filter(r => r.won).length}/${m.length}`, "ends", m.map(r => r.won ? "W" : r.wave).join(" ")); }
}
