// TIER FIT (owner, 2026-10-08: "tune the rest of these to be closer to target"): each axis
// tier ALONE, as in isolation.mjs (the test tower with one axis at tier k, one L1 helper of
// each other kind, waves FROM..TO, lives refilled), and a bisection on ONE lever per axis -
// the axis's own table entry at tier k - until the TEAM's damage vs the bare tower hits the
// target curve TARGET (default 125 / 150 / 200 / 250 / 300% at I..V; the old +25 / +50 /
// +100% fits, carried on). All the (axis, tier) bisections step together, a pool round each.
// usage: node tierfit.mjs [seeds=3] [rounds=7]   env AXES=voltage,rime  TARGET=1.25,1.5,2,2.5,3  FROM=40 TO=70
import { runPool } from "./pool.mjs";
import { makeGame } from "./sim.mjs";

const LEVERS = {
  conductivity: { kind: "arc", get: k => `ARC_CONDUCTIVITY[${k}].d`, set: (k, v) => `ARC_CONDUCTIVITY[${k}].d = ${v};` },
  voltage: { kind: "arc", get: k => `ARC_VOLTAGE_DMG[${k}]`, set: (k, v) => `ARC_VOLTAGE_DMG[${k}] = ${v};` },
  capacitance: { kind: "arc", get: k => `ARC_CAPACITANCE[${k}].frac`, set: (k, v) => `ARC_CAPACITANCE[${k}].frac = ${v};` },
  rime: { kind: "frz", get: k => `FRZ_RIME[${k}]`, set: (k, v) => `FRZ_RIME[${k}] = ${v};` },
  focus: { kind: "sol", get: k => `SOL_FOCUS_DMG[${k}]`, set: (k, v) => `SOL_FOCUS_DMG[${k}] = ${v};` },
  refraction: { kind: "sol", get: k => `SOL_HOP[${k}]`, set: (k, v) => `SOL_HOP[${k}] = ${v};` },
  breach: { kind: "sol", get: k => `SOL_BREACH_ARMOR[${k}]`, set: (k, v) => `SOL_BREACH_ARMOR[${k}] = ${v};` }, // the strip a hit
};
const AXES = process.env.AXES ? process.env.AXES.split(",") : Object.keys(LEVERS);
const TARGET = (process.env.TARGET || "1.25,1.5,2,2.5,3").split(",").map(Number);
const FROM = Number(process.env.FROM || 40), TO = Number(process.env.TO || 70);
const SEEDS = Number(process.argv[2] || 3), ROUNDS = Number(process.argv[3] || 7);
const task = new URL("./isolation.mjs", import.meta.url);
const g0 = makeGame(1);

const base = {};
{
  const kinds = [...new Set(AXES.map(a => LEVERS[a].kind))], jobs = [];
  for (const kind of kinds) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kind, axis: null, k: 0, seed, from: FROM, to: TO });
  const res = await runPool(task, jobs, { quiet: true });
  for (const kind of kinds) { const rs = res.filter((r, i) => jobs[i].kind === kind); base[kind] = rs.reduce((a, r) => a + r.team, 0) / rs.length; }
}
// each (axis, tier): the current value and a log2 bracket on the multiplier around it
const cells = [];
for (const axis of AXES) for (let k = 1; k <= 5; k++) { const cur = g0.run(LEVERS[axis].get(k)); cells.push({ axis, k, cur, lo: -3, hi: 3, best: null }); }
for (let round = 0; round <= ROUNDS; round++) {
  const jobs = [];
  for (const c of cells) {
    c.m = round === 0 ? 0 : (c.lo + c.hi) / 2; // round 0 measures the CURRENT value
    const v = +(c.cur * 2 ** c.m).toPrecision(4); c.v = v;
    for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ kind: LEVERS[c.axis].kind, axis: c.axis, k: c.k, seed, from: FROM, to: TO, patch: LEVERS[c.axis].set(c.k, v) });
  }
  const res = await runPool(task, jobs, { quiet: true });
  for (const c of cells) {
    const rs = res.filter((r, i) => jobs[i].axis === c.axis && jobs[i].k === c.k), pct = rs.reduce((a, r) => a + r.team, 0) / rs.length / base[LEVERS[c.axis].kind];
    if (round === 0) c.now = pct;
    if (!c.best || Math.abs(pct - TARGET[c.k - 1]) < Math.abs(c.best.pct - TARGET[c.k - 1])) c.best = { v: c.v, pct };
    if (round > 0) { if (pct < TARGET[c.k - 1]) c.lo = c.m; else c.hi = c.m; }
  }
  console.error(`round ${round}/${ROUNDS} done`);
}
console.log(`tier fit, waves ${FROM}-${TO}, ${SEEDS} seeds, ${ROUNDS} rounds; target team damage ${TARGET.map(t => Math.round(t * 100) + "%").join(" / ")}`);
for (const axis of AXES) {
  const cs = cells.filter(c => c.axis === axis);
  console.log(`\n${axis} (${LEVERS[axis].get("k")})`);
  for (const c of cs) console.log(`  ${["I", "II", "III", "IV", "V"][c.k - 1].padEnd(3)} ${String(c.cur).padStart(7)} -> ${String(c.best.v).padStart(7)}   team ${Math.round(c.now * 100)}% -> ${Math.round(c.best.pct * 100)}%  (target ${Math.round(TARGET[c.k - 1] * 100)}%)`);
  console.log(`  table: [${["?", ...cs.map(c => c.best.v)].join(", ")}]`);
}
