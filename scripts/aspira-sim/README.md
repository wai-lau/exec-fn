# aspira-sim — headless balance simulator for /aspira

Runs the REAL game code (`web/aspira-{defs,upgrades,game,towers}.js`) in a Node VM
with drawing, sound and input stubbed out and every tick run as fast as it can,
then plays it with a scripted player (opening, build mix, upgrade appetite,
interest reserve, chosen path/form per tower). Built for the 2026-10-02
overnight balance pass; ARCHITECTURE.md §22 has the findings.

Run one at a time with `nice -n 19` on the droplet (2 cores, serves the site).
On a big box the pool scripts below use every core but two (`POOL_WORKERS=n`
caps it) and the single-threaded ones can run side by side.

| script | what |
|---|---|
| `wave1.mjs [patch] [seeds]` | every 2-tower opening (100 credits) vs wave 1 — must lose no life |
| `eval.mjs [patch] [seeds] [maxWave]` | mono builds + all-four with each tower left out |
| `combos.mjs [patch] [seeds]` | all 15 tower subsets, ranked |
| `forms.mjs [patch] [seeds] [kind]` | each tower's 6 forms inside the all-four build |
| `style.mjs` | upgrade appetite x interest reserve x tower cap |
| `sim.mjs '<strategy json>' [seed] [maxWave]` | one game, JSON result (waves, leaks by type, damage by tower). `core: [power ids]` + `useCore: true` make the player pick (at the boss picks) and fire the core powers (`corepower.mjs`) |
| `curve.mjs [seeds] [out.jsonl]` | the difficulty curve: 4 styles x 4 openings, full games with the core -> death-wave p10/p50/p90, lives lost by wave band, first leak, leaks by type |
| `rand.mjs [games] [out.jsonl]` | RANDOM players (2026-10-08, "too easy to win randomly"): each game rolls its own mix, opening, appetite, axis per point, saver or not, core used or not; win rate split by kinds / economy / core / appetite (`BV_PATCH` patches the game) |
| `countermx.mjs [seeds]` | the COUNTER MATRIX: every ordinary wave forced to one enemy type, N towers of one kind (spread, or one axis at V) - % of that type leaked (env N, POINTS, WINDOWS, KINDS, BV_PATCH) |
| `chartvalue.mjs [seeds] [out.jsonl]` | each kind's 10 ways to spend its 6 chart points vs 2/2/2 (team damage + leaks over waves FROM..TO) and the value of every axis tier |
| `corevalue.mjs [seeds] [out.jsonl]` | each core power (and all three) vs none, picked at the boss picks and used in a real game |
| `late.mjs [evals] [seeds] [out.jsonl]` | late game from wave START, every open slot maxed, every core power: ten parallel hill-climbs; the mono starts show where each kind walls |
| `wavebal.mjs` / `typebal.mjs` / `bossbal.mjs` / `arcfit.mjs` | the fits (wave counts, type counts, boss HP, ARC tiers) - headers say how |
| `buildsearch.mjs` | hill-climb the build plan that banks the most by wave 30 |

`ASPIRA_WEB=<dir>` pins a run to a snapshot of the game files (`cp web/aspira-*.js`
somewhere first): every game re-reads them, so a balance commit landing mid-run
would otherwise mix two versions.
`pool.mjs` runs a task module over a job list on a worker pool (`pool-worker.mjs`
is the entry); with an `out.jsonl` a run resumes where it stopped.
`formvalue.mjs` and `latesearch.mjs` are the pre-chart versions (path/form
tree, `buyCore`) and no longer run - kept for the record.

A `patch` is a JS file run inside the game's context after it loads — change
`TOWERS` / `ENEMIES` / `UPGRADES` numbers (or redefine a function) to try a
balance change without touching the live game. A full `forms` or `combos` run
takes 25-40 min.
