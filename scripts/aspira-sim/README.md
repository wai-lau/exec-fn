# aspira-sim — headless balance simulator for /aspira

Runs the REAL game code (`web/aspira-{defs,upgrades,game,towers}.js`) in a Node VM
with drawing, sound and input stubbed out and every tick run as fast as it can,
then plays it with a scripted player (opening, build mix, upgrade appetite,
interest reserve, chosen path/form per tower). Built for the 2026-10-02
overnight balance pass; ARCHITECTURE.md §22 has the findings.

Run one at a time with `nice -n 19` — the droplet has 2 cores and serves the site.

| script | what |
|---|---|
| `wave1.mjs [patch] [seeds]` | every 2-tower opening (100 credits) vs wave 1 — must lose no life |
| `eval.mjs [patch] [seeds] [maxWave]` | mono builds + all-four with each tower left out |
| `combos.mjs [patch] [seeds]` | all 15 tower subsets, ranked |
| `forms.mjs [patch] [seeds] [kind]` | each tower's 6 forms inside the all-four build |
| `style.mjs` | upgrade appetite x interest reserve x tower cap |
| `sim.mjs '<strategy json>' [seed] [maxWave]` | one game, JSON result (waves, leaks by type, damage by tower) |

A `patch` is a JS file run inside the game's context after it loads — change
`TOWERS` / `ENEMIES` / `UPGRADES` numbers (or redefine a function) to try a
balance change without touching the live game. A full `forms` or `combos` run
takes 25-40 min.
