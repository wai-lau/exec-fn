// Which upgrades are useless or too good (owner, 2026-10-02)? Start at wave
// START with every tower maxed (L4) and the core bought up to the path being
// tested, then play until the core falls.
//  - each of the 24 tower forms: TWO slots of it beside one reference tower of
//    each kind (so a form is judged inside a working team, not alone);
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
const AB = { chain: "ARC", slower: "FRZ", reaper: "SOL", acid: "ACD" };
// the reference team: one sensible form per kind
const REF = { chain: [0, 0], slower: [1, 0], reaper: [0, 1], acid: [1, 1] };
const ref = k => ({ kind: k, p: REF[k][0], f: REF[k][1] });

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
const test = (name, slots, core = []) => {
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
    test(name, [{ kind: k, p: pi, f: fi }, { kind: k, p: pi, f: fi }, ref("chain"), ref("slower"), ref("reaper"), ref("acid")]);
  }));
}
const team = ["chain", "slower", "reaper", "acid", "chain", "slower"].map(ref);
test("core: none", team);
const CORE = [["Zen > Stillness > Silence", [0, 0, 0]], ["Zen > Echo > Resonance", [0, 1, 0]], ["Space > Expanse > Horizon", [1, 0, 0]],
  ["Space > Vacuum > Void", [1, 1, 0]], ["Sinter > Temper > Anneal", [2, 0, 0]], ["Sinter > Quench > Brittle Core", [2, 1, 0]]];
for (const [name, path] of CORE) test("core: " + name, team, path);
console.log("\nRANKED");
for (const r of rows.sort((a, b) => b.avg - a.avg)) console.log(r.avg.toFixed(1).padStart(6), r.name);
