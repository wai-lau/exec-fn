// RANDOM PLAYERS (owner, 2026-10-08: "game feels too easy to win randomly"):
// every game rolls its own player from the seed - a random tower mix (any kind
// may be missing), a random opening, random upgrade appetite, every chart point
// on a random axis, smart saver or not, core powers used or not. Placement stays
// the sim's best open cell. Full games to wave 100.
// usage: node rand.mjs [games=200] [out.jsonl]   env BV_PATCH=<file> patches the game
import fs from "node:fs";
import { isMainThread } from "node:worker_threads";
import { makePlayer } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { ALL } from "./corepower.mjs";

const KINDS = ["arc", "frz", "sol", "acd"];
const AXES = { arc: ["conductivity", "voltage", "capacitance"], frz: ["temp", "rime", "moons"], sol: ["focus", "refraction", "breach"], acd: ["corrosion", "spray", "contagion"] };
const PATCH = process.env.BV_PATCH ? fs.readFileSync(process.env.BV_PATCH, "utf8") : "";

export function randomPlayer(seed) {
  let s = (seed * 2654435761) % 4294967296;
  const r = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pickOf = a => a[Math.floor(r() * a.length)];
  const mix = {}; for (const k of KINDS) mix[k] = r() < 0.25 ? 0 : 0.5 + r() * 1.5;
  if (!KINDS.some(k => mix[k] > 0)) mix[pickOf(KINDS)] = 1;
  const have = KINDS.filter(k => mix[k] > 0);
  const skills = {}; for (const k of KINDS) skills[k] = Array.from({ length: 30 }, () => pickOf(AXES[k]));
  const useCore = r() < 0.5;
  return {
    up: 0.3 + r() * 0.5, maxTowers: 6, mix, opening: [pickOf(have), pickOf(have)], skills,
    ...(r() < 0.5 ? { econ: "smart" } : {}),
    relayKind: pickOf(have), core: r() < 0.5 ? [...ALL] : [...ALL].reverse(), useCore,
  };
}

export default async function task({ seed }) {
  const strat = randomPlayer(seed), p = makePlayer(strat, seed, 100, 0.02, PATCH);
  p.runTo(101);
  const r = p.result();
  return { seed, wave: r.wave, won: r.won, lives: r.lives, leaks: r.leaks, kinds: Object.keys(strat.mix).filter(k => strat.mix[k] > 0), econ: strat.econ || "spend", useCore: strat.useCore, up: strat.up };
}

const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

if (isMainThread && process.argv[1] && process.argv[1].endsWith("rand.mjs")) {
  const N = Number(process.argv[2] || 200), OUT = process.argv[3] || null;
  const jobs = Array.from({ length: N }, (_, i) => ({ seed: i + 1 }));
  const res = (await runPool(new URL(import.meta.url), jobs, { out: OUT })).filter(Boolean);
  const w = res.map(x => x.wave), won = res.filter(x => x.won).length;
  console.log(`${res.length} random players, full games to 100${PATCH ? " (patched)" : ""}`);
  console.log(`won ${won}/${res.length} (${Math.round(100 * won / res.length)}%)   death wave p10 ${pct(w, 0.1)} p50 ${pct(w, 0.5)} p90 ${pct(w, 0.9)}`);
  const by = (label, key) => {
    const g = {}; for (const x of res) (g[key(x)] ||= []).push(x);
    console.log("\n" + label);
    for (const [k, xs] of Object.entries(g).sort()) console.log("  " + k.padEnd(18) + `won ${xs.filter(x => x.won).length}/${xs.length}`.padEnd(12) + `p50 wave ${pct(xs.map(x => x.wave), 0.5)}`);
  };
  by("kinds in the mix", x => x.kinds.join("+"));
  by("kind count", x => String(x.kinds.length));
  by("economy", x => x.econ);
  by("core used", x => String(x.useCore));
  by("upgrade appetite", x => (x.up < 0.47 ? "low" : x.up < 0.63 ? "mid" : "high"));
  const lw = {}; for (const x of res) if (!x.won) lw[Math.floor(x.wave / 10) * 10] = (lw[Math.floor(x.wave / 10) * 10] || 0) + 1;
  console.log("\ndeaths by decade: " + Object.entries(lw).map(([k, v]) => k + "s:" + v).join("  "));
}
