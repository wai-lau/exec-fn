// SIXTEEN PERSONALITIES THAT REASON (owner, 2026-10-08: "change them to be players that reason
// with that personality type, not binary choices"; the 2026-10-07 version flipped one switch per letter).
// Each type is its COGNITIVE-FUNCTION STACK (INTJ = Ni > Te > Fi > Se), weighted STACK_W. At every
// wave's send each function READS THE BOARD and argues - which kinds to lean on, which axes to raise,
// whether to save - and the stack's weights settle the argument (sim.mjs `mind`). The eight voices:
//   Se  the present: counter what JUST leaked, feed what is hitting now, spend now
//   Si  precedent: keep what has dealt damage so far, build evenly, save steadily
//   Ne  possibilities: try kinds and axes not tried yet
//   Ni  one vision: a core pair chosen at the start, one axis deep, ready before each boss
//   Te  results: damage per credit decides; bank the interest
//   Ti  a model: the counter table against everything that has leaked, best axes first, deep
//   Fe  harmony: every kind present, synergy pairs, lift the weakest
//   Fi  values: a favourite kind, loyally - until the lives say otherwise
// Everyone takes every boss pick and uses both core powers. Full games to wave 100.
// Prints each type's results and the THOUGHTS that steered it (the winning voice's reason, by wave).
// usage: node mbti.mjs [seeds=4] [out.jsonl]
import { isMainThread } from "node:worker_threads";
import { makePlayer } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const KINDS = ["arc", "frz", "sol", "acd"];
const AXES = { arc: ["conductivity", "voltage", "capacitance"], frz: ["temp", "rime", "moons"], sol: ["focus", "refraction", "breach"], acd: ["corrosion", "spray", "contagion"] };
// which kind (and axis) answers each enemy - the game's counter table (owner, 2026-10-08)
const COUNTER = { swarm: { arc: ["conductivity", "capacitance"], acd: ["contagion"] }, fast: { frz: ["temp"], arc: ["capacitance"] },
  armor: { sol: ["breach"], acd: ["corrosion"] }, shield: { acd: ["spray"], frz: ["temp"], arc: ["conductivity"] } };
const DAMAGE_AXES = { arc: "voltage", frz: "temp", sol: "focus", acd: "corrosion" }; // Te: the raw-damage axis
const MODEL_ORDER = { arc: ["voltage", "conductivity", "capacitance"], frz: ["temp", "moons", "rime"], sol: ["focus", "breach", "refraction"], acd: ["corrosion", "spray", "contagion"] }; // Ti
export const STACKS = {
  ISTJ: ["Si", "Te", "Fi", "Ne"], ISFJ: ["Si", "Fe", "Ti", "Ne"], INFJ: ["Ni", "Fe", "Ti", "Se"], INTJ: ["Ni", "Te", "Fi", "Se"],
  ISTP: ["Ti", "Se", "Ni", "Fe"], ISFP: ["Fi", "Se", "Ni", "Te"], INFP: ["Fi", "Ne", "Si", "Te"], INTP: ["Ti", "Ne", "Si", "Fe"],
  ESTP: ["Se", "Ti", "Fe", "Ni"], ESFP: ["Se", "Fi", "Te", "Ni"], ENFP: ["Ne", "Fi", "Te", "Si"], ENTP: ["Ne", "Ti", "Fe", "Si"],
  ESTJ: ["Te", "Si", "Ne", "Fi"], ESFJ: ["Fe", "Si", "Ne", "Ti"], ENFJ: ["Fe", "Ni", "Se", "Ti"], ENTJ: ["Te", "Ni", "Se", "Fi"],
};
export const TYPES = Object.keys(STACKS);
const STACK_W = [1, 0.6, 0.3, 0.1]; // dominant, auxiliary, tertiary, inferior
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
const norm = o => { const t = Object.values(o).reduce((a, b) => a + Math.max(0, b), 0); const r = {}; for (const k of Object.keys(o)) r[k] = t ? Math.max(0, o[k]) / t : 0; return r; };
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0];

// the eight voices: (obs | null at the start, the mind's memory, its rng) -> a proposal
// { kinds: {kind: score}, axes: {kind: {axis: score}}, save: -1..1, depth: 0..1, why: "..." }
const VOICES = {
  Se(o) {
    const kinds = { arc: 0.5 }, axes = {}; let why = "hit what is in front of me";
    if (o) {
      for (const [type, n] of Object.entries(o.lostBy)) for (const [k, ax] of Object.entries(COUNTER[type] || {})) { add(kinds, k, 3 * n); for (const a of ax) add(axes[k] ||= {}, a, 2 * n); }
      const hot = top(o.share); if (hot) add(kinds, hot, 1);
      const leak = top(o.lostBy); if (leak && o.lostBy[leak] > 0) why = leak + " just got through: answer it now";
    }
    return { kinds, axes, save: -0.8, depth: 0.3, why };
  },
  Si(o) {
    const kinds = { arc: 1, frz: 1 }; let why = "the build that has worked, kept even";
    if (o) { for (const [k, d] of Object.entries(norm(o.dealtAll))) add(kinds, k, 2 * d); for (const [k, n] of Object.entries(o.towers)) add(kinds, k, 0.5 * n); }
    return { kinds, axes: {}, save: 0.5, depth: 0, why };
  },
  Ne(o, m, rnd) {
    const kinds = {}, axes = {};
    for (const k of KINDS) kinds[k] = 1 / (1 + ((o && o.towers[k]) || 0)) + 0.5 * rnd();
    for (const k of KINDS) { axes[k] = {}; for (const a of AXES[k]) axes[k][a] = (m.tried[k + a] ? 0 : 1.5) + rnd(); }
    return { kinds, axes, save: -0.3, depth: 0.2, why: "what haven't I tried yet?" };
  },
  Ni(o, m) {
    const kinds = { [m.vision[0]]: 2, [m.vision[1]]: 2 }, axes = {}; let why = "the plan: " + m.vision.join(" + ") + ", one axis deep";
    for (const k of m.vision) axes[k] = { [MODEL_ORDER[k][0]]: 1 };
    if (o && o.wave % 10 >= 7) { add(kinds, "sol", 1.5); (axes.sol ||= {}).breach = 2; why = "a boss is coming: ready SOL's Breach"; }
    return { kinds, axes, save: 0.3, depth: 1, why };
  },
  Te(o) {
    const kinds = { arc: 1, sol: 1 }, axes = {}; let why = "raw damage first";
    if (o) { const eff = {}; for (const k of Object.keys(o.towers)) eff[k] = (o.dealtAll[k] || 0) / Math.max(1, o.spentBy[k] || 0); const e = norm(eff); for (const [k, v] of Object.entries(e)) add(kinds, k, 3 * v);
      const best = top(e); if (best) why = best.toUpperCase() + " returns the most per credit: feed it"; }
    for (const k of KINDS) axes[k] = { [DAMAGE_AXES[k]]: 1 };
    return { kinds, axes, save: 0.6, depth: 0.7, why };
  },
  Ti(o) {
    const kinds = { arc: 0.5, frz: 0.5, sol: 0.5, acd: 0.5 }, axes = {}; let why = "the model says: cover every threat";
    const seen = o ? o.leaksAll : {};
    for (const [type, n] of Object.entries(seen)) for (const [k, ax] of Object.entries(COUNTER[type] || {})) { add(kinds, k, Math.sqrt(n)); for (const a of ax) add(axes[k] ||= {}, a, 0.5 * Math.sqrt(n)); }
    for (const k of KINDS) { axes[k] ||= {}; MODEL_ORDER[k].forEach((a, i) => add(axes[k], a, 1 - i / 3)); }
    const worst = top(seen); if (worst) why = "by the model, " + worst + " is the threat: counter it";
    return { kinds, axes, save: 0.2, depth: 1, why };
  },
  Fe(o) {
    const kinds = {}, axes = {}; let why = "everyone on the team";
    for (const k of KINDS) kinds[k] = 1 + (o && !o.towers[k] ? 2 : 0) - 0.3 * ((o && o.towers[k]) || 0);
    if (o && o.towers.frz) { add(kinds, "acd", 0.7); add(kinds, "arc", 0.4); why = "FRZ holds them; ACD and ARC work best beside it"; }
    if (o) { const weak = Object.keys(o.towers).sort((a, b) => (o.dealtAll[a] || 0) - (o.dealtAll[b] || 0))[0]; if (weak) add(kinds, weak, 0.8); }
    return { kinds, axes, save: 0, depth: 0, why };
  },
  Fi(o, m) {
    const kinds = { [m.fav]: 3 }, axes = { [m.fav]: { [MODEL_ORDER[m.fav][0]]: 1 } }; let why = "I believe in " + m.fav.toUpperCase();
    if (o && o.lost5 >= 3) { for (const [type, n] of Object.entries(o.lostBy)) for (const k of Object.keys(COUNTER[type] || {})) add(kinds, k, n); why = "it's costing lives; I'll bend, for now"; }
    return { kinds, axes, save: 0.1, depth: 0.8, why };
  },
};

// the MIND: weigh the stack's voices into the live knobs (mix, upPrio, skills, economy), and keep a log
function think(stack, s, o, m) {
  const kindsW = {}, axesW = {}; let save = 0, depth = 0, wsum = 0, lead = null;
  stack.forEach((f, i) => {
    const w = STACK_W[i], p = VOICES[f](o, m, m.rnd);
    for (const [k, v] of Object.entries(norm(p.kinds))) add(kindsW, k, w * v);
    for (const [k, ax] of Object.entries(p.axes)) for (const [a, v] of Object.entries(norm(ax))) add(axesW[k] ||= {}, a, w * v);
    save += w * p.save; depth += w * p.depth; wsum += w;
    // the voice that moved the plan most this wave is the one quoted
    const pull = w * Math.max(...Object.values(norm(p.kinds)), 0);
    if (!lead || pull > lead.pull) lead = { f, why: p.why, pull };
  });
  save /= wsum; depth /= wsum;
  const mix = {}; for (const k of KINDS) mix[k] = kindsW[k] || 0;
  const mx = Math.max(...Object.values(mix)); for (const k of KINDS) if (mix[k] < 0.15 * mx) mix[k] = 0; // a kind the mind barely wants is left out
  s.mix = mix; s.upPrio = KINDS.filter(k => mix[k] > 0).sort((a, b) => mix[b] - mix[a]);
  s.skills = {};
  for (const k of KINDS) {
    const order = AXES[k].slice().sort((a, b) => ((axesW[k] || {})[b] || 0) - ((axesW[k] || {})[a] || 0));
    for (const a of order) m.tried[k + a] = 1;
    s.skills[k] = depth > 0.5 ? order.flatMap(a => Array(5).fill(a)) : Array(5).fill(order).flat();
  }
  if (save > 0.25) { s.econ = "smart"; s.threat = 220; } else { delete s.econ; s.threat = save < -0.25 ? 0 : 150; }
  s.up = Math.min(0.8, Math.max(0.3, 0.5 - 0.3 * save));
  s.relayKind = s.upPrio[0] || "arc";
  if (o) { const thought = lead.f + ": " + lead.why; if (m.log[m.log.length - 1]?.t !== thought) m.log.push({ wave: o.wave, t: thought }); }
  return kindsW;
}

export function persona(type, seed = 1) {
  const stack = STACKS[type], h = hash(type);
  let r = (h + seed * 7919) % 233280;
  const m = { tried: {}, log: [], fav: KINDS[h % 4], vision: [KINDS[h % 4], KINDS[(h >> 3) % 4 === h % 4 ? (h % 4 + 1) % 4 : (h >> 3) % 4]], rnd: () => (r = (r * 9301 + 49297) % 233280) / 233280 };
  const s = { maxTowers: 6, core: ["temporal", "relay"], useCore: true };
  const first = think(stack, s, null, m), ranked = Object.entries(first).sort((a, b) => b[1] - a[1]);
  s.opening = ranked[0][1] > 1.6 * (ranked[1]?.[1] || 0) ? [ranked[0][0], ranked[0][0]] : [ranked[0][0], ranked[1][0]];
  m.log.push({ wave: 0, t: "opens " + s.opening.join(" + ") });
  s.mind = (st, o) => think(stack, st, o, m);
  return { s, m };
}

export default async function task({ type, seed }) {
  const { s, m } = persona(type, seed), p = makePlayer(s, seed, 100);
  p.runTo(101);
  const r = p.result(), dealt = {};
  for (const [k, v] of Object.entries(r.towers)) dealt[k.slice(0, 3)] = (dealt[k.slice(0, 3)] || 0) + v.dealt;
  return { wave: r.wave, won: r.won, lives: r.lives, leaks: r.leaks, dealt, interest: r.interest, log: m.log.slice(0, 40) };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("mbti.mjs")) {
  const SEEDS = Number(process.argv[2] || 4), OUT = process.argv[3] || null;
  const jobs = []; for (const type of TYPES) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ type, seed });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const mean = (a, f) => a.reduce((x, y) => x + f(y), 0) / a.length, of = f => jobs.map((j, i) => (f(j.type) ? res[i] : null)).filter(Boolean);
  console.log(`16 reasoning personalities (cognitive stacks, weights ${STACK_W.join(" / ")}) x ${SEEDS} seeds, full games to 100, both core powers\n`);
  console.log("type  stack         avg wave  won  dmg share                 leaks/game");
  const rows = TYPES.map(type => { const rs = of(t => t === type), d = {}, l = {};
    for (const r of rs) { for (const [k, v] of Object.entries(r.dealt)) add(d, k, v); for (const [k, v] of Object.entries(r.leaks)) add(l, k, v / rs.length); }
    const tot = Object.values(d).reduce((a, b) => a + b, 0) || 1;
    return { type, avg: mean(rs, r => r.wave), line: type + "  " + STACKS[type].join(">").padEnd(13) + mean(rs, r => r.wave).toFixed(1).padStart(7) + String(rs.filter(r => r.won).length).padStart(5) + "  " +
      Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + Math.round(100 * v / tot)).join(" ").padEnd(26) + Object.entries(l).map(([k, v]) => k + " " + v.toFixed(0)).join(" ") }; });
  for (const r of rows.sort((a, b) => b.avg - a.avg)) console.log(r.line);
  console.log("\nBY DOMINANT FUNCTION (avg wave, games won)");
  for (const f of Object.keys(VOICES)) { const A = of(t => STACKS[t][0] === f); console.log(`  ${f}  ${mean(A, r => r.wave).toFixed(1)}  (${A.filter(r => r.won).length}/${A.length})`); }
  console.log("\nEACH LETTER AGAINST ITS OPPOSITE (avg wave, games won)");
  for (const [a, b, i] of [["E", "I", 0], ["S", "N", 1], ["T", "F", 2], ["J", "P", 3]]) { const A = of(t => t[i] === a), B = of(t => t[i] === b); console.log(`  ${a} ${mean(A, r => r.wave).toFixed(1)} (${A.filter(r => r.won).length}/${A.length})   vs   ${b} ${mean(B, r => r.wave).toFixed(1)} (${B.filter(r => r.won).length}/${B.length})`); }
  console.log("\nHOW EACH TYPE THOUGHT (seed 1: the voice that steered, when it changed its mind)");
  for (const type of TYPES) { const r = res[jobs.findIndex(j => j.type === type && j.seed === 1)]; console.log(`  ${type} (${r.won ? "won" : "died w" + r.wave}): ` + r.log.slice(0, 7).map(x => "w" + x.wave + " " + x.t).join(" | ")); }
}
