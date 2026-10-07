// Which upgrades are useless or too good (owner, 2026-10-02)? Start at wave
// START with every tower maxed (L4) and the core bought up to the path being
// tested, then play until the core falls.
//  - each of the 24 tower forms: it REPLACES the reference tower of its kind
//    in the reference team (so team make-up never changes - an earlier
//    version filled two slots with the form and so measured how many FRZ a
//    team had, not how good the form was);
//  - each of the 6 core paths (L1 -> L2 -> L3), on the reference team of six.
// Prints waves reached per seed, best first.
//
// usage: node formvalue.mjs [seeds=2] [start=60] [money=300000] [results.jsonl]
// CHECKPOINT (owner): with a results file, each finished test is appended and
// a rerun skips what is already there.
import fs from "node:fs";
import { makeGame } from "./sim.mjs";

const SEEDS = Number(process.argv[2] || 2), START = Number(process.argv[3] || 60), MONEY = Number(process.argv[4] || 300000);
const MAX_WAVE = START + 150, DT = 0.02, OUT = process.argv[5] || "";
const done = new Map();
if (OUT && fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, "utf8").split("\n")) if (l) { const r = JSON.parse(l); done.set(r.name, r); }
const AB = { arc: "ARC", frz: "FRZ", sol: "SOL", acd: "ACD" };
// the reference team: one sensible form per kind
const REF = { arc: [0, 0], frz: [1, 0], sol: [1, 0], acd: [1, 1] }; // SOL ref: Charge > Grid (2026-10-03 tree)
const ref = k => ({ kind: k, p: REF[k][0], f: REF[k][1] });
const TEAM = ["arc", "frz", "sol", "acd", "arc", "frz"]; // the reference team

function run(slots, core, seed) {
  const g = makeGame(seed); g.reset();
  g.run(`(() => { let prev = null; for (let n = 1; n < ${START}; n++) { const w = wavePlan(n, prev); if (w.type !== "bonus") prev = w.type; }
    G.lastType = prev; G.wave = ${START - 1}; G.money = ${MONEY}; })()`);
  slots.forEach((b, i) => {
    const t = g.place(b.kind, i);
    for (let l = 1; l < 4; l++) { const need = g.pendingChoice(t); g.upgrade(t, need === "path" ? b.p : b.f); }
  });
  for (const c of core) g.run("buyCore(" + c + ")");
  let t = 0;
  while (!g.G.over && g.G.wave < MAX_WAVE && t < 3600) { g.step(DT); g.clearFx(); t += DT; }
  return g.G.wave;
}
const rows = [];
// FV_ONLY=<regex>: run only the tests whose name matches (re-checking a fix)
const ONLY = process.env.FV_ONLY ? new RegExp(process.env.FV_ONLY) : null;
const test = (name, slots, core = []) => {
  if (ONLY && !ONLY.test(name)) return;
  let r = done.get(name);
  if (!r) {
    const w = []; for (let s = 1; s <= SEEDS; s++) w.push(run(slots, core, s));
    r = { name, avg: w.reduce((a, b) => a + b) / w.length, w };
    if (OUT) fs.appendFileSync(OUT, JSON.stringify(r) + "\n");
  }
  rows.push(r);
  console.log(name.padEnd(34), r.w.join("/"));
};
const g0 = makeGame(1);
for (const k of Object.keys(AB)) {
  g0.UPGRADES[k].forEach((p, pi) => p.finals.forEach((f, fi) => {
    const name = AB[k] + " " + p.name + " > " + f.name + (f.super ? " > " + f.super.name : "");
    const slots = TEAM.map(ref), at = TEAM.indexOf(k);
    slots[at] = { kind: k, p: pi, f: fi };
    test(name, slots);
  }));
}
const team = TEAM.map(ref);
test("core: none", team);
const CORE = [["Zen > Stillness > Silence", [0, 0, 0]], ["Zen > Echo > Resonance", [0, 1, 0]],
  ["Space > Expanse > Horizon", [1, 0, 0]], ["Space > Vacuum > Infinity", [1, 1, 0]]];
for (const [name, path] of CORE) test("core: " + name, team, path);
console.log("\nRANKED");
for (const r of rows.sort((a, b) => b.avg - a.avg)) console.log(r.avg.toFixed(1).padStart(6), r.name);
