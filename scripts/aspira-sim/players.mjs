// Ten PLAYERS who reason about the chart differently (owner, 2026-10-07: "10
// unique players that reason with the upgrades in different ways ... play
// optimally, save money when they can, use powers ... based on their
// intuition, they should pivot and try different things at different points in
// the snapshot to get to their optimized play").
// Each player is a THEORY - an opening, a build mix, a per-kind axis spend
// order, targeting, which kind to upgrade first, which kind to Relay - plus
// its IDEAS: the pivots its intuition suggests when the board shows something
// (leaks of a type, a boss that got close, a kind pulling no weight).
// Everyone plays the interest-aware saver (sim.mjs econ "smart"), takes every
// boss pick and USES both core powers (corepower.mjs).
// MODE=search (default): at CHECKS waves the player snapshots the game, plays
//   each idea it has not yet used (and staying the course) LOOK waves ahead,
//   keeps the best and goes on - the player's optimized play for that seed.
//   An idea's trigger (`when`) only marks the log: whether its intuition had
//   flagged the pick. (Gating the trials on the triggers left nofrz dying at 37
//   with every idea untried: the burst of fast leaks came after the checkpoint.)
// MODE=instinct: each idea fires on its trigger, no lookahead.
// MODE=static: the theory as written, never a pivot.
// usage: node players.mjs [seeds=3] [out.jsonl]   env PLAYERS=capacitor,nofrz  MODE=search|instinct|static  LOOK=10
import { isMainThread } from "node:worker_threads";
import { makePlayer } from "./sim.mjs";
import { runPool } from "./pool.mjs";

const MODE = process.env.MODE || "search", LOOK = Number(process.env.LOOK || 10);
const CHECKS = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95]; // each LOOK-wave window holds one boss
const r3 = (a, b, c) => [a, a, a, b, b, b, c, c, c].filter(Boolean);

// ---- the vocabulary of ideas ----
const leak = (o, t, n) => (o.lostBy[t] || 0) >= n;
const anyLeak = o => Object.values(o.lostBy).some(v => v > 0);
const bossClose = (o, d = 200) => o.nearBoss < d;
const after = w => o => o.wave >= w;
const addKind = (k, w) => (s, o) => { s.mix = { ...s.mix, [k]: w }; s.upPrio = [k, ...(s.upPrio || []).filter(x => x !== k)]; (s.queue ||= []).push(k); };
const weight = (k, w) => s => { s.mix = { ...s.mix, [k]: w }; };
const order = (k, ...axes) => s => { s.skills = { ...s.skills, [k]: axes }; };
const mode = (k, m) => (s, o, g) => g.setMode(k, m);
const relay = k => s => { s.relayKind = k; };
const prio = (...ks) => s => { s.upPrio = ks; };
const idea = (name, when, ...dos) => ({ name, when, do: (s, o, g) => dos.forEach(d => d(s, o, g)) });

export const PLAYERS = {
  "acid-freezer": {
    belief: "ACD + FRZ is amazing: nothing outruns a burn it cannot leave, and puddles finish the rest.",
    opening: ["acd", "frz"], mix: { acd: 2, frz: 2 }, upPrio: ["acd", "frz"], relayKind: "acd", core: ["relay", "temporal"],
    skills: { acd: r3("spray", "contagion"), frz: r3("temp", "rime") }, modes: { acd: "biggest", frz: "fresh" },
    ideas: [
      idea("one lightning rod", o => leak(o, "swarm", 3), addKind("arc", 1)),
      idea("a SOL for the bosses", o => bossClose(o), addKind("sol", 1), order("sol", ...r3("breach", "focus"))),
      idea("go colder", o => leak(o, "fast", 2), order("frz", ...r3("temp", "rime")), prio("frz", "acd")),
      idea("pandemic first", after(25), order("acd", ...r3("contagion", "spray"))),
      idea("more acid", o => o.wave >= 15 && !anyLeak(o), weight("acd", 3)),
      idea("relay the freezer", after(45), relay("frz")),
    ],
  },
  capacitor: {
    belief: "Capacitance ARC opens a charge window, SOL on Tagged lands the biggest hit in it, and the window bursts.",
    opening: ["arc", "sol"], mix: { arc: 2, sol: 2, frz: 1 }, upPrio: ["arc", "sol"], relayKind: "sol", core: ["relay", "temporal"],
    skills: { arc: r3("capacitance", "conductivity"), sol: r3("focus", "breach"), frz: r3("temp", "rime") },
    modes: { arc: "close", sol: "tagged" },
    ideas: [
      idea("ARC hunts the tagged too", after(15), mode("arc", "tagged")),
      idea("SOL hits biggest instead", o => (o.share.sol || 0) < 0.35, mode("sol", "biggest")),
      idea("conductivity first", o => (o.share.arc || 0) < 0.3, order("arc", ...r3("conductivity", "capacitance"))),
      idea("a freezer", o => leak(o, "fast", 2), weight("frz", 2), prio("frz", "arc", "sol")),
      idea("breach for the bosses", o => bossClose(o), order("sol", ...r3("breach", "focus"))),
      idea("relay the ARC", after(35), relay("arc")),
    ],
  },
  nofrz: {
    belief: "FRZ is skippable: Overload rings and Pandemic puddles slow enough, and the slot goes to damage.",
    opening: ["arc", "acd"], mix: { arc: 2, sol: 1, acd: 2 }, upPrio: ["acd", "arc"], relayKind: "arc", core: ["temporal", "relay"],
    skills: { arc: r3("capacitance", "conductivity"), acd: r3("contagion", "spray"), sol: r3("focus", "breach") },
    modes: { acd: "close" },
    ideas: [
      idea("more puddles", o => leak(o, "fast", 2), weight("acd", 3), prio("acd", "arc", "sol")),
      idea("ARC on fresh", o => leak(o, "fast", 2), mode("arc", "fresh")),
      idea("fine, ONE freezer", o => leak(o, "fast", 5), addKind("frz", 1), order("frz", ...r3("temp", "rime"))),
      idea("SOL breach", o => bossClose(o), order("sol", ...r3("breach", "focus")), weight("sol", 2)),
      idea("relay the acid", after(35), relay("acd")),
    ],
  },
  voltage: {
    belief: "Raw power: Voltage III keeps every jump at full damage, so a wide ARC tree is a wall of bolts.",
    opening: ["arc", "arc"], mix: { arc: 3, frz: 1 }, upPrio: ["arc"], relayKind: "arc", core: ["relay", "temporal"],
    skills: { arc: r3("voltage", "conductivity"), frz: r3("temp", "moons") },
    ideas: [
      idea("width after all", o => (o.share.arc || 0) < 0.6 || anyLeak(o), order("arc", ...r3("conductivity", "voltage"))),
      idea("a SOL for Chariot", o => bossClose(o), addKind("sol", 1), order("sol", ...r3("breach", "focus"))),
      idea("static too", after(25), order("arc", ...r3("voltage", "capacitance", "conductivity"))),
      idea("more freeze", o => leak(o, "fast", 2), weight("frz", 2)),
      idea("acid for shields", o => leak(o, "shield", 2), addKind("acd", 1)),
    ],
  },
  breacher: {
    belief: "Bosses are the walls, so Breach III strips their armor and every tower crits them; FRZ holds them in the beams.",
    opening: ["sol", "frz"], mix: { sol: 3, frz: 1, arc: 1 }, upPrio: ["sol"], relayKind: "sol", core: ["temporal", "relay"],
    skills: { sol: r3("breach", "focus"), frz: r3("temp", "rime"), arc: r3("conductivity", "capacitance") },
    modes: { sol: "biggest" },
    ideas: [
      idea("lightning for swarms", o => leak(o, "swarm", 3), addKind("arc", 2)),
      idea("focus before breach", o => (o.share.sol || 0) < 0.5, order("sol", ...r3("focus", "breach"))),
      idea("SOL near", o => anyLeak(o), mode("sol", "close")),
      idea("refraction sweeps", o => leak(o, "swarm", 3), order("sol", ...r3("breach", "refraction"))),
      idea("acid", o => leak(o, "shield", 2), addKind("acd", 1)),
    ],
  },
  moonlord: {
    belief: "A moon is a free tower: Moons III turns one FRZ slot into four auras, so FRZ is a damage dealer too.",
    opening: ["arc", "frz"], mix: { frz: 3, arc: 2 }, upPrio: ["frz", "arc"], relayKind: "frz", core: ["relay", "temporal"],
    skills: { frz: r3("moons", "temp"), arc: r3("conductivity", "capacitance") },
    ideas: [
      idea("a SOL for the bosses", o => bossClose(o), addKind("sol", 2), order("sol", ...r3("breach", "focus"))),
      idea("temp before moons", o => leak(o, "fast", 2), order("frz", ...r3("temp", "moons"))),
      idea("relay the ARC", after(25), relay("arc")),
      idea("acid", o => leak(o, "shield", 2), addKind("acd", 1)),
      idea("more ARC", o => leak(o, "swarm", 3), weight("arc", 3), prio("arc", "frz")),
    ],
  },
  rimer: {
    belief: "A permanent slow is free damage for everyone: Rime III stacks forever, and SOL's refraction sweeps the slowed lane.",
    opening: ["sol", "frz"], mix: { frz: 2, sol: 2, acd: 1 }, upPrio: ["frz", "sol"], relayKind: "sol", core: ["temporal", "relay"],
    skills: { frz: r3("rime", "temp"), sol: r3("refraction", "focus"), acd: r3("spray", "contagion") },
    modes: { sol: "close" },
    ideas: [
      idea("go colder", o => leak(o, "fast", 2), order("frz", ...r3("temp", "rime"))),
      idea("breach for the bosses", o => bossClose(o), order("sol", ...r3("breach", "refraction"))),
      idea("focus", o => (o.share.sol || 0) < 0.4, order("sol", ...r3("focus", "refraction"))),
      idea("an ARC", o => leak(o, "swarm", 3), addKind("arc", 1)),
      idea("SOL biggest", o => bossClose(o), mode("sol", "biggest")),
    ],
  },
  even: {
    belief: "Spread everything: one of each kind, every axis 2/2/2, and buy the counter of whatever leaks. The control.",
    opening: ["arc", "frz"], mix: { arc: 1, frz: 1, sol: 1, acd: 1 }, relayKind: null, core: ["temporal", "relay"],
    ideas: [
      idea("counter swarms", o => leak(o, "swarm", 3), weight("arc", 2), prio("arc")),
      idea("counter fast", o => leak(o, "fast", 2), weight("frz", 2), prio("frz")),
      idea("counter bosses", o => bossClose(o), weight("sol", 2), order("sol", ...r3("breach", "focus"))),
      idea("counter shields", o => leak(o, "shield", 2), weight("acd", 2)),
      idea("counter armor", o => leak(o, "armor", 2), weight("sol", 2), order("sol", ...r3("breach", "focus"))),
    ],
  },
  chemist: {
    belief: "Negative armor is a flat bonus on every hit, so Corrosion III makes the whole team hit harder; Spray spreads it.",
    opening: ["acd", "arc"], mix: { acd: 3, arc: 1, frz: 1 }, upPrio: ["acd"], relayKind: "acd", core: ["relay", "temporal"],
    skills: { acd: r3("corrosion", "spray"), arc: r3("conductivity", "voltage"), frz: r3("temp", "rime") },
    ideas: [
      idea("spray first", o => (o.share.acd || 0) < 0.4, order("acd", ...r3("spray", "corrosion"))),
      idea("puddles for fast", o => leak(o, "fast", 2), order("acd", ...r3("corrosion", "contagion"))),
      idea("more freeze", o => leak(o, "fast", 2), weight("frz", 2), prio("frz", "acd")),
      idea("a SOL", o => bossClose(o), addKind("sol", 1), order("sol", ...r3("breach", "focus"))),
      idea("ACD on fresh", o => anyLeak(o), mode("acd", "fresh")),
    ],
  },
  conductor: {
    belief: "Tree width is everything: Conductivity III then Capacitance III on every ARC (the measured best spend), FRZ and SOL in support.",
    opening: ["arc", "frz"], mix: { arc: 2, frz: 1, sol: 1, acd: 1 }, upPrio: ["arc"], relayKind: "arc", core: ["relay", "temporal"],
    skills: { arc: r3("conductivity", "capacitance"), sol: r3("focus", "breach"), frz: r3("temp", "rime"), acd: r3("spray", "contagion") },
    ideas: [
      idea("capacitance first", after(15), order("arc", ...r3("capacitance", "conductivity"))),
      idea("SOL tagged", o => o.wave >= 25 && (o.towers.sol || 0) > 0, mode("sol", "tagged")),
      idea("breach for the bosses", o => bossClose(o), order("sol", ...r3("breach", "focus")), prio("sol", "arc")),
      idea("more freeze", o => leak(o, "fast", 2), weight("frz", 2)),
      idea("more acid", o => leak(o, "shield", 2), weight("acd", 2)),
    ],
  },
};

// every player can also think of plain play: upgrade whatever is cheapest (its priority starved the rest)
for (const p of Object.values(PLAYERS)) p.ideas.push(idea("spread the upgrades", o => o.wave >= 15, prio()));

// a lookahead's worth: alive = lives, then wealth (banked + built); dead = the wave it died
const score = r => (r.over ? r.wave * 1000 + r.lives * 10 : 1e6 + r.lives * 1000 + (r.money + r.spent) / 100);

export default async function task({ player, seed, mode = MODE }) {
  const p = PLAYERS[player];
  const s = { up: 0.5, maxTowers: 9, threat: 220, useCore: true, econ: "smart", ...p };
  delete s.belief; delete s.ideas;
  if (mode === "instinct") s.pivots = p.ideas;
  const pl = makePlayer(s, seed, 100);
  const chosen = [], used = new Set();
  if (mode === "search") for (const W of CHECKS) {
    if (!pl.runTo(W)) break;
    const obs = pl.look();
    const ideas = p.ideas.filter(i => !used.has(i.name));
    if (!ideas.length) continue;
    const snap = pl.snapshot(), end = Math.min(W + LOOK, 101);
    const trial = apply => { pl.restore(snap); if (apply) apply(pl.strategy, obs, pl.game); pl.runTo(end); return score(pl.result()); };
    const scores = { stay: trial(null) };
    for (const i of ideas) scores[i.name] = trial(i.do);
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    pl.restore(snap);
    if (best !== "stay") { ideas.find(i => i.name === best).do(pl.strategy, obs, pl.game); used.add(best); }
    // gain over staying: credits of wealth while both live (score counts them /100), else score points
    const hinted = ideas.filter(i => i.when(obs, pl.strategy)).map(i => i.name); // what its intuition flagged
    chosen.push({ wave: W, pick: best, tried: Object.keys(scores).length - 1, hinted, gain: Math.round((scores[best] - scores.stay) * (scores.stay >= 1e6 ? 100 : 1)) });
  }
  pl.runTo(101);
  const r = pl.result();
  const dealt = {};
  for (const [k, v] of Object.entries(r.towers)) dealt[k.slice(0, 3)] = (dealt[k.slice(0, 3)] || 0) + v.dealt;
  const build = r.build.map(t => t.kind + (t.skills ? "·" + ["conductivity", "voltage", "capacitance", "temp", "rime", "moons", "focus", "refraction", "breach", "corrosion", "spray", "contagion"].filter(a => t.skills[a]).map(a => a.slice(0, 3) + t.skills[a]).join("") : "") + "/" + t.mode);
  return { wave: r.wave, lives: r.lives, won: r.won, leaks: r.leaks, fires: r.fires, money: r.money, spent: r.spent, interest: r.interest, econ: r.econ, builtAt: r.builtAt, fullAt: r.fullAt, dealt, build, chosen: mode === "search" ? chosen : r.pivots || [] };
}

if (isMainThread && process.argv[1] && process.argv[1].endsWith("players.mjs")) {
  const SEEDS = Number(process.argv[2] || 3), OUT = process.argv[3] || null;
  const names = process.env.PLAYERS ? process.env.PLAYERS.split(",") : Object.keys(PLAYERS);
  const jobs = [];
  for (const player of names) for (let seed = 1; seed <= SEEDS; seed++) jobs.push({ player, seed, mode: MODE });
  const res = await runPool(new URL(import.meta.url), jobs, { out: OUT });
  const mean = (a, f = x => x) => a.reduce((s, x) => s + f(x), 0) / a.length;
  console.log(`${names.length} players x ${SEEDS} seeds, full games to wave 100, mode ${MODE}${MODE === "search" ? " (look " + LOOK + ")" : ""}, smart saver, every boss pick, both powers used\n`);
  console.log("player".padEnd(14) + "  avg  won  waves".padEnd(36) + "lives  dmg share                 leaks/game                fires/game");
  const rows = [];
  for (const player of names) {
    const rs = jobs.map((j, i) => (j.player === player ? res[i] : null)).filter(Boolean);
    const w = rs.map(r => r.wave), won = rs.filter(r => r.won).length;
    const dealt = {}; for (const r of rs) for (const [k, v] of Object.entries(r.dealt)) dealt[k] = (dealt[k] || 0) + v;
    const tot = Object.values(dealt).reduce((a, b) => a + b, 0) || 1;
    const share = Object.entries(dealt).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + Math.round(100 * v / tot)).join(" ");
    const leaks = {}; for (const r of rs) for (const [k, v] of Object.entries(r.leaks)) leaks[k] = (leaks[k] || 0) + v / rs.length;
    const fires = {}; for (const r of rs) for (const [k, v] of Object.entries(r.fires || {})) fires[k] = (fires[k] || 0) + v / rs.length;
    rows.push({ player, avg: mean(w), won, rs, row: player.padEnd(14) + mean(w).toFixed(1).padStart(5) + String(won).padStart(4) + "  " + w.join(",").padEnd(22) + mean(rs, r => r.lives).toFixed(0).padStart(5) + "  " + share.padEnd(26) + Object.entries(leaks).map(([k, v]) => k + " " + v.toFixed(0)).join(" ").padEnd(26) + Object.entries(fires).map(([k, v]) => k + " " + v.toFixed(0)).join(" ") });
  }
  for (const r of rows.sort((a, b) => b.avg - a.avg || b.won - a.won)) console.log(r.row);
  console.log("\nECONOMY (means): wave every slot filled / every tower maxed; interest earned in all; wealth (banked + built) at waves 21 / 51 / 81; banked at the end");
  for (const { player, rs } of rows) {
    const at = w => { const xs = rs.map(r => r.econ.find(e => e.wave === w)).filter(Boolean); return xs.length ? Math.round(mean(xs, e => e.money + e.spent)) + " (" + Math.round(mean(xs, e => e.money)) + " banked)" : "-"; };
    console.log("  " + player.padEnd(14) + " built w" + (mean(rs.filter(r => r.builtAt), r => r.builtAt) || 0).toFixed(0).padEnd(4) + " maxed w" + (rs.some(r => r.fullAt) ? mean(rs.filter(r => r.fullAt), r => r.fullAt).toFixed(0) : "-").padEnd(4) + " interest " + mean(rs, r => r.interest).toFixed(0).padStart(5) + "  w21 " + at(21).padEnd(20) + " w51 " + at(51).padEnd(22) + " w81 " + at(81).padEnd(24) + " end " + mean(rs, r => r.money).toFixed(0));
  }
  console.log("\nBELIEFS, PIVOTS (per seed: wave:pick, +gain over staying; * = the lookahead found it, its intuition had not flagged it) AND THE BUILD IT ENDED WITH");
  for (const { player, rs } of rows) {
    console.log("\n" + player + " - " + PLAYERS[player].belief);
    rs.forEach((r, i) => {
      const pv = r.chosen.filter(c => c.pick !== "stay" || c.name).map(c => "w" + c.wave + ":" + (c.pick || c.name) + (c.gain ? "(+" + c.gain + ")" : "") + (c.hinted && !c.hinted.includes(c.pick) ? "*" : "")).join("  ");
      console.log("  seed " + (i + 1) + "  w" + r.wave + (r.won ? " WON" : " died") + " lives " + r.lives + "  " + (pv || "stayed the course"));
      console.log("         " + r.build.join(" "));
    });
  }
}
