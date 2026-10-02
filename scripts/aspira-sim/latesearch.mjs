// Late-game search (owner, 2026-10-02): start at wave START with MONEY credits,
// fill all six slots and max every tower to L4 at once (money is no object),
// then play until the core falls. A build is six (kind, L2 path, L3 form)
// picks plus the CORE's L1 (none, ZEN, NULLIFY or Sinter - bought at once,
// it is open from wave 30); hill-climb them for the furthest wave reached
// on every seed.
//
// usage: node latesearch.mjs [evals=120] [seeds=2] [start=60] [money=300000] [log.jsonl]
import fs from "node:fs";
import { makeGame, cellScores } from "./sim.mjs";

const EVALS = Number(process.argv[2] || 120), SEEDS = Number(process.argv[3] || 2);
const START = Number(process.argv[4] || 60), MONEY = Number(process.argv[5] || 300000);
const LOG = process.argv[6] || "", MAX_WAVE = START + 200, DT = 0.02;
const KINDS = ["chain", "slower", "reaper", "acid"], AB = { chain: "ARC", slower: "FRZ", reaper: "SOL", acid: "ACD" };
let rs = 777;
const rnd = () => (rs = (rs * 1103515245 + 12345) % 2147483648) / 2147483648;
const ri = n => Math.floor(rnd() * n);

const CORE_NAMES = ["none", "ZEN", "NULLIFY", "Sinter"];
function run(build, seed) {
  const g = makeGame(seed); g.reset();
  // reach wave START-1 the way a real game would (the type alternation
  // depends on the waves before), then hand over the money
  g.run(`(() => { let prev = null; for (let n = 1; n < ${START}; n++) { const w = wavePlan(n, prev); if (w.type !== "bonus") prev = w.type; }
    G.lastType = prev; G.wave = ${START - 1}; G.money = ${MONEY}; })()`);
  const order = cellScores(g, "chain").map((v, i) => i);
  build.slots.forEach((b, i) => {
    const t = g.place(b.kind, order[i]);
    for (let l = 1; l < 4; l++) { const need = g.pendingChoice(t); g.upgrade(t, need === "path" ? b.p : b.f); }
  });
  if (build.core > 0) g.run("buyCore(" + (build.core - 1) + ")");
  let t = 0;
  while (!g.G.over && g.G.wave < MAX_WAVE && t < 7200) { g.step(DT); g.clearFx(); t += DT; }
  return { wave: g.G.wave, lives: g.G.lives, secs: Math.round(t) };
}
function score(build) {
  let worst = Infinity; const res = [];
  for (let s = 1; s <= SEEDS; s++) { const r = run(build, s); res.push(r); worst = Math.min(worst, r.wave * 100 + Math.max(0, r.lives)); }
  if (LOG) fs.appendFileSync(LOG, JSON.stringify({ v: worst, build, res }) + "\n");
  return { v: worst, res };
}
const randomPick = () => ({ kind: KINDS[ri(4)], p: ri(2), f: ri(3) });
function mutate(build) {
  const b = { slots: build.slots.map(x => ({ ...x })), core: build.core }, i = ri(6), m = ri(4);
  if (m === 3) b.core = ri(4);
  else if (m === 0) b.slots[i] = randomPick(); else if (m === 1) b.slots[i].p = ri(2); else b.slots[i].f = ri(3);
  return b;
}
const slotName = b => AB[b.kind] + " " + b.p + "/" + b.f;
const nameOf = b => b.slots.map(slotName).join(", ") + " | core " + CORE_NAMES[b.core];

// starts: all-one-kind builds, an even mix, and random ones
const starts = KINDS.map(k => ({ slots: Array(6).fill(0).map(() => ({ kind: k, p: ri(2), f: ri(3) })), core: ri(4) }));
starts.push({ slots: KINDS.concat(KINDS.slice(0, 2)).map(k => ({ kind: k, p: ri(2), f: ri(3) })), core: ri(4) });
for (let i = 0; i < 3; i++) starts.push({ slots: Array(6).fill(0).map(randomPick), core: ri(4) });
let best = null, evals = 0;
// CHECKPOINT (owner): resume from an earlier run's log
if (LOG && fs.existsSync(LOG)) {
  for (const line of fs.readFileSync(LOG, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line); evals++;
    if (r.build.slots && (!best || r.v > best.v)) best = { build: r.build, v: r.v, res: r.res };
  }
  if (best) console.log("resumed", evals, "evals, best", nameOf(best.build));
}
for (const s of best ? [] : starts) {
  const sc = score(s); evals++;
  console.log("start", nameOf(s), "-> wave", sc.res.map(r => r.wave).join("/"));
  if (!best || sc.v > best.v) best = { build: s, ...sc };
}
while (evals < EVALS) {
  const c = mutate(best.build), sc = score(c); evals++;
  if (sc.v >= best.v) { if (sc.v > best.v) console.log("eval", evals, "wave", sc.res.map(r => r.wave).join("/"), nameOf(c)); best = { build: c, ...sc }; }
}
console.log("\nBEST", nameOf(best.build), "-> wave", best.res.map(r => r.wave).join("/"));
