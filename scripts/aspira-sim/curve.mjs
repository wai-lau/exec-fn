// The difficulty curve (owner, 2026-10-07: "where does a sane player die?"):
// a ladder of scripted players - four styles x four openings, all buying and
// using the core powers - over many seeds, full games. Prints the death-wave
// distribution, lives lost by wave band, the first wave to take a life, leaks
// by type and the waves that took the most lives.
// usage: node curve.mjs [seeds=20] [out.jsonl]   env CURVE_CORE=all (default, every
// player buys all nine points) | none (nobody touches the core)
import { isMainThread } from "node:worker_threads";
import { play } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL_T3 } from "./corepower.mjs";

export const STYLES = { greedy: { up: 0.8 }, balanced: { up: 0.5 }, saver: { up: 0.3, reserve: 10 }, threat: { up: 0.5, threat: 150 } };
export const OPENINGS = { "arc arc": ["arc", "arc"], "sol sol": ["sol", "sol"], "arc frz": ["arc", "frz"], "acd acd": ["acd", "acd"] };
const MIX = { arc: 1, frz: 1, sol: 1, acd: 1 };
const CORE = process.env.CURVE_CORE === "none" ? null : ALL_T3;

export default async function task({ style, opening, seed }) {
  const r = play({ ...STYLES[style], maxTowers: 9, opening: OPENINGS[opening], mix: MIX, core: CORE, useCore: !!CORE }, seed, 100);
  return { wave: r.wave, lives: r.lives, won: r.won, leaks: r.leaks, leakWave: r.leakWave, towers: Object.fromEntries(Object.entries(r.towers).map(([k, v]) => [k, v.n])) };
}

const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

if (isMainThread && process.argv[1] && process.argv[1].endsWith("curve.mjs")) {
  const SEEDS = Number(process.argv[2] || 20), OUT = process.argv[3] || null;
  const jobs = [];
  for (const style of Object.keys(STYLES)) for (const opening of Object.keys(OPENINGS)) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ style, opening, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  console.log(`${Object.keys(STYLES).length} styles x ${Object.keys(OPENINGS).length} openings x ${SEEDS} seeds, core ${CORE ? "all III" : "none"}\n`);
  console.log("player".padEnd(22) + "  p10  p50  p90  won   first leak p50");
  const firstLeak = r => { const ws = Object.keys(r.leakWave).map(Number); return ws.length ? Math.min(...ws) : 101; };
  for (const style of Object.keys(STYLES)) for (const opening of Object.keys(OPENINGS)) {
    const rs = jobs.map((j, i) => j.style === style && j.opening === opening ? res[i] : null).filter(Boolean);
    const w = rs.map(r => r.wave);
    console.log((style + " / " + opening).padEnd(22) + String(pct(w, 0.1)).padStart(5) + String(pct(w, 0.5)).padStart(5) + String(pct(w, 0.9)).padStart(5) + String(rs.filter(r => r.won).length).padStart(5) + String(pct(rs.map(firstLeak), 0.5)).padStart(10));
  }
  const all = res.map(r => r.wave);
  console.log("\nALL".padEnd(22) + String(pct(all, 0.1)).padStart(5) + String(pct(all, 0.5)).padStart(5) + String(pct(all, 0.9)).padStart(5) + String(res.filter(r => r.won).length).padStart(5) + String(pct(res.map(firstLeak), 0.5)).padStart(10));
  const band = {}, byWave = {}, byType = {};
  for (const r of res) {
    for (const [w, n] of Object.entries(r.leakWave)) { const b = Math.ceil(w / 10) * 10; band[b] = (band[b] || 0) + n; byWave[w] = (byWave[w] || 0) + n; }
    for (const [t, n] of Object.entries(r.leaks)) byType[t] = (byType[t] || 0) + n;
  }
  console.log("\nlives lost per game by wave band: " + Object.keys(band).map(Number).sort((a, b) => a - b).map(b => (b - 9) + "-" + b + " " + (band[b] / res.length).toFixed(2)).join("  "));
  console.log("leaks by type (per game): " + Object.entries(byType).map(([t, n]) => t + " " + (n / res.length).toFixed(1)).join("  "));
  console.log("waves that took the most lives (per game): " + Object.entries(byWave).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w, n]) => "w" + w + " " + (n / res.length).toFixed(2)).join("  "));
  const deaths = {}; for (const r of res) if (!r.won) deaths[r.wave] = (deaths[r.wave] || 0) + 1;
  console.log("death waves: " + Object.entries(deaths).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => "w" + w + " x" + n).join("  "));
}
