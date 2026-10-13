// SOLO (owner, 2026-10-12: "make it so that you can beat up to wave 11 with every tower on their own with no upgrades;
// require 2 towers or an upgrade to beat the star"): no buying at all. Each setup plays waves 1-12 from the best slot
// (every open slot tried, the best kept; towers drag to their best spot as ever - AUTO_POS) and reports lives lost on
// waves 1-11 and whether THE STAR (wave 12) got through. Setups: each tower alone at L1; each tower + ONE upgrade on each
// axis; every PAIR of L1 towers (the second on its best remaining slot).
// usage: node solo.mjs [seeds=3]   (ASPIRA_PATCH / ASPIRA_WEB as everywhere)
import { isMainThread } from "node:worker_threads";
import { makeGame } from "./sim.mjs";
import { runPool } from "./pool.mjs";
import { simBanner } from "./simver.mjs";

const K = ["arc", "frz", "sol", "acd"], LAST = 12;
// one game: towers [[kind, cell, axis?]] placed at the start, nothing bought after
function game(towers, seed) {
  const g = makeGame(seed);
  g.reset();
  const G = g.G;
  G.money = 1e9;
  for (const [kind, ci, axis] of towers) {
    const t = g.place(kind, ci);
    if (!t) return null;
    if (axis) g.upgrade(t, axis);
  }
  G.money = 0;
  G.lives = 1000; // count every leak; the boss still ends it outright (a breach)
  const lost = {};
  let w = G.wave, before = G.lives;
  for (let i = 0; i < 200000 && !G.over && G.wave <= LAST; i++) {
    g.step(0.02);
    if (G.wave !== w) { lost[w] = before - G.lives; w = G.wave; before = G.lives; }
    if (G.wave === LAST + 1) break;
  }
  if (G.wave <= LAST) lost[G.wave] = before - G.lives;
  const pre = Object.entries(lost).filter(([n]) => n < LAST).reduce((a, [, v]) => a + v, 0);
  const worst = Object.entries(lost).filter(([n]) => n < LAST).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
  const byWave = Object.entries(lost).filter(([n, v]) => n < LAST && v).map(([n, v]) => `${n}:${v}`).join(",");
  return { pre, byWave, worst: worst[1] ? `w${worst[0]}:${worst[1]}` : "", star: G.over ? "BREACH" : G.wave > LAST ? (lost[LAST] ? "leaked" : "beaten") : "?", starLost: lost[LAST] || 0, wave: G.wave }; // beaten: NO leak (owner, 2026-10-12: "beat it with no leaks")
}
export default async function task({ towers, seed }) { return game(towers, seed); }

if (isMainThread && process.argv[1] && process.argv[1].endsWith("solo.mjs")) {
  const SEEDS = Number(process.argv[2] || 3);
  console.log(simBanner());
  const g0 = makeGame(1); g0.reset();
  const cells = [...Array(g0.run("CELLS.length")).keys()].filter(i => g0.cellOpen(i));
  const axes = Object.fromEntries(K.map(k => [k, g0.run(`SKILL_TREES.${k}.map(a => a.id)`)]));
  const jobs = [], seeds = [...Array(SEEDS).keys()].map(i => i + 1);
  const add = (label, towers) => { for (const seed of seeds) jobs.push({ label, towers, seed }); };
  for (const k of K) for (const c of cells) {
    add(`${k}|${c}`, [[k, c]]);
    for (const ax of axes[k]) add(`${k}+${ax}|${c}`, [[k, c, ax]]);
  }
  for (let a = 0; a < K.length; a++) for (let b = a; b < K.length; b++) for (const c1 of cells) for (const c2 of cells) if (c1 < c2) add(`${K[a]}+${K[b]}|${c1},${c2}`, [[K[a], c1], [K[b], c2]]);
  const res = await runPool(new URL(import.meta.url), jobs, {});
  // per setup: the BEST slot(s) - fewest breaches, then fewest lives lost before the star
  const by = new Map();
  jobs.forEach((j, i) => { const [setup, slot] = j.label.split("|"); const s = (by.get(setup) || new Map()); const r = s.get(slot) || []; r.push(res[i]); s.set(slot, r); by.set(setup, s); });
  const score = rs => [rs.filter(r => !r || r.star !== "beaten").length, rs.reduce((a, r) => a + (r ? r.pre : 1e9), 0)];
  const line = setup => {
    const [slot, rs] = [...by.get(setup)].sort((x, y) => { const a = score(x[1]), b = score(y[1]); return a[0] - b[0] || a[1] - b[1]; })[0];
    const pre = rs.map(r => r.pre).join("/"), star = rs.map(r => (r.star === "beaten" ? "W" : r.star === "leaked" ? "l" + r.starLost : "X")).join(" "); // W no leak, l<n> n lost to it, X broke through
    return `${setup.toUpperCase().padEnd(18)} slot ${slot.padEnd(5)} lives lost w1-11 ${pre.padEnd(12)} star ${star}  ${process.env.SOLO_WAVES ? rs.map(r => r.byWave || "-").join(" / ") : rs.map(r => r.worst).filter(Boolean).join(" ")}`;
  };
  console.log("\n== ALONE, L1 (target: 0 lost on 1-11, the Star breaks through)");
  for (const k of K) console.log(line(k));
  console.log("\n== ALONE + ONE UPGRADE (target: the Star beaten)");
  for (const k of K) for (const ax of axes[k]) console.log(line(`${k}+${ax}`));
  console.log("\n== TWO L1 TOWERS (target: the Star beaten)");
  for (let a = 0; a < K.length; a++) for (let b = a; b < K.length; b++) console.log(line(`${K[a]}+${K[b]}`));
}
