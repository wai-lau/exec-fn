// SIXTEEN PERSONALITIES (owner, 2026-10-07 balancing runs: "16 personas based on MBTI").
// Each persona is generated from its four letters, so the report can also set every
// letter against its opposite:
//   E / I  how it spends: E spends whenever it can afford its next buy; I is the
//          interest-aware saver (sim.mjs econ "smart")
//   S / N  how it builds: S plays it concrete - all four kinds, every chart spread
//          evenly; N plays a theory - a two-kind core and one axis maxed before the next
//   T / F  what it values: T raw damage (ARC + SOL; Voltage, Focus, Corrosion first);
//          F synergy and control (FRZ + ACD; Temp, Breach, Capacitance, Contagion first)
//   J / P  how it adapts: J follows its plan to the end; P pivots when the board says
//          so (leaks of a type -> the counter kind; a boss close -> SOL's Breach; and
//          from wave 25 it stops starving the kinds it does not favour)
// Everyone takes every boss pick and uses both core powers. Full games to wave 100.
// usage: node mbti.mjs [seeds=4] [out.jsonl]
import { isMainThread } from "node:worker_threads";
import { makePlayer } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const AX = {
  T: { arc: ["voltage", "conductivity", "capacitance"], frz: ["moons", "temp", "rime"], sol: ["focus", "refraction", "breach"], acd: ["corrosion", "spray", "contagion"] },
  F: { arc: ["capacitance", "conductivity", "voltage"], frz: ["temp", "rime", "moons"], sol: ["breach", "focus", "refraction"], acd: ["contagion", "spray", "corrosion"] },
};
const deep = a => a.flatMap(x => Array(5).fill(x)), wide = a => Array(5).fill(a).flat(); // fifteen points: one axis to V before the next, or round-robin
const leak = (o, t, n) => (o.lostBy[t] || 0) >= n;
// lean on kind k: weight it up, upgrade it first, and build one at once if the mix had none
const bump = (k, w) => s => { const had = (s.mix[k] || 0) > 0; s.mix = { ...s.mix, [k]: Math.max(w, s.mix[k] || 0) }; s.upPrio = [k, ...(s.upPrio || []).filter(x => x !== k)]; if (!had) (s.queue ||= []).push(k); };
const PIVOTS = [
  { name: "swarms leak: more ARC", when: o => leak(o, "swarm", 3), do: bump("arc", 2) },
  { name: "fast leak: more FRZ", when: o => leak(o, "fast", 2), do: bump("frz", 2) },
  { name: "shields leak: more ACD", when: o => leak(o, "shield", 2), do: bump("acd", 2) },
  { name: "armor leaks: more SOL", when: o => leak(o, "armor", 2), do: bump("sol", 2) },
  { name: "a boss came close: SOL breach", when: o => o.nearBoss < 200, do: s => { bump("sol", 2)(s); s.skills = { ...s.skills, sol: deep(["breach", "focus", "refraction"]) }; } },
  { name: "spread the upgrades", when: o => o.wave >= 25, do: s => { s.upPrio = []; } },
];

export function persona(type) {
  const [ei, sn, tf, jp] = type.split("");
  const axes = AX[tf], order = sn === "N" ? deep : wide;
  const mix = sn === "S" ? { arc: 1, frz: 1, sol: 1, acd: 1 } : tf === "T" ? { arc: 2, sol: 2, frz: 1 } : { frz: 2, acd: 2, arc: 1 };
  return {
    up: ei === "E" ? 0.6 : 0.5, maxTowers: 6, mix,
    ...(ei === "I" ? { econ: "smart", threat: 220 } : {}),
    opening: tf === "T" ? ["arc", "sol"] : ["arc", "frz"],
    skills: Object.fromEntries(Object.entries(axes).map(([k, a]) => [k, order(a)])),
    upPrio: sn === "N" ? (tf === "T" ? ["arc", "sol"] : ["frz", "acd"]) : [],
    relayKind: tf === "T" ? "arc" : "frz", core: tf === "T" ? ["relay", "temporal"] : ["temporal", "relay"], useCore: true,
    pivots: jp === "P" ? PIVOTS : [],
  };
}
export const TYPES = [];
for (const a of "EI") for (const b of "SN") for (const c of "TF") for (const d of "JP") TYPES.push(a + b + c + d);

export default async function task({ type, seed }) {
  const p = makePlayer(persona(type), seed, 100);
  p.runTo(101);
  const r = p.result(), dealt = {};
  for (const [k, v] of Object.entries(r.towers)) dealt[k.slice(0, 3)] = (dealt[k.slice(0, 3)] || 0) + v.dealt;
  return { wave: r.wave, won: r.won, lives: r.lives, leaks: r.leaks, dealt, interest: r.interest, money: r.money, spent: r.spent, pivots: r.pivots || [], fires: r.fires, builtAt: r.builtAt, fullAt: r.fullAt };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("mbti.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), OUT = process.argv[3] || null;
  const jobs = []; for (const type of TYPES) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ type, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length, of = f => jobs.map((j, i) => (f(j.type) ? res[i] : null)).filter(Boolean);
  console.log(`16 personalities x ${SEEDS} seeds, full games to wave 100, 6 slots, every boss pick and both powers used\n`);
  console.log("type   avg wave  won  waves              lives  dmg share                leaks/game           interest  pivots");
  const rows = TYPES.map(type => { const rs = of(t => t === type), d = {}; for (const r of rs) for (const [k, v] of Object.entries(r.dealt)) d[k] = (d[k] || 0) + v; const tot = Object.values(d).reduce((a, b) => a + b, 0) || 1, l = {}; for (const r of rs) for (const [k, v] of Object.entries(r.leaks)) l[k] = (l[k] || 0) + v / rs.length;
    const pv = {}; for (const r of rs) for (const p of r.pivots) pv[p.name] = (pv[p.name] || 0) + 1;
    return { type, avg: mean(rs, r => r.wave), line: type + "   " + mean(rs, r => r.wave).toFixed(1).padStart(6) + String(rs.filter(r => r.won).length).padStart(5) + "  " + rs.map(r => r.wave).join(",").padEnd(18) + mean(rs, r => r.lives).toFixed(0).padStart(5) + "  " + Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + Math.round(100 * v / tot)).join(" ").padEnd(24) + " " + Object.entries(l).map(([k, v]) => k + " " + v.toFixed(0)).join(" ").padEnd(20) + String(Math.round(mean(rs, r => r.interest))).padStart(8) + "  " + Object.entries(pv).map(([k, n]) => k.split(":")[0] + " x" + n).join("; ") }; });
  for (const r of rows.sort((a, b) => b.avg - a.avg)) console.log(r.line);
  console.log("\nEACH LETTER AGAINST ITS OPPOSITE (avg wave, games won)");
  for (const [a, b, i] of [["E", "I", 0], ["S", "N", 1], ["T", "F", 2], ["J", "P", 3]]) { const A = of(t => t[i] === a), B = of(t => t[i] === b); console.log(`  ${a} ${mean(A, r => r.wave).toFixed(1)} (${A.filter(r => r.won).length}/${A.length})   vs   ${b} ${mean(B, r => r.wave).toFixed(1)} (${B.filter(r => r.won).length}/${B.length})`); }
}
