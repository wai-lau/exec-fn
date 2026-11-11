## 17. Memory is the scarce resource on this box

Current design: [ARCHITECTURE.md §17](../architecture/17-memory.md).

**The graphify post-commit rebuild was the repeat offender.** `graphify.watch._apply_resource_limits()` renices to 10 and then RETURNS WITHOUT CAPPING unless `GRAPHIFY_REBUILD_MEMORY_LIMIT_MB` is set, so it ran unbounded at ~780MB and invoked the global OOM killer — which took out `dbus-daemon` (2026-09-10) and uvicorn-side `python` three times (2026-08-31, 09-01, 09-02).

Two fixes, both applied 2026-09-10:

1. **`graphify-out/GRAPH_REPORT.md` + `graph.html` had been root-owned since Aug 22**, so every rebuild did the full work and then died at the write — never recording state, so the next run redid it all. `chown wai-root` turned a ~780MB full rebuild into a **125MB no-op**. *Check ownership first when a rebuild looks expensive.*
2. `export GRAPHIFY_REBUILD_MEMORY_LIMIT_MB=600` in `~/.zshenv` (git hooks inherit it from the invoking shell) so the rebuild dies of `MemoryError` and logs it instead of taking the site down. A failed graph is cheap; a 502 is not.

**Ad-hoc WebKit/playwright runs are the other hazard** — MiniBrowser triggered the 2026-09-10 21:09 OOM. Wrap heavy one-offs in `systemd-run --user --scope -p MemoryMax=...` and check for strays afterwards with `pgrep -f '[M]iniBrowser'` (the bracket keeps the pattern from matching its own command line).

Found 2026-09-16 while chasing "the box feels slow and laggy". It was not the cause of the lag (that was swap thrashing — below), but it was a permanent tax nobody had measured.

The cost came from what was in the tree, not the tree's purpose:

| Subtree | Entries walked | Reason it was there |
|---|---|---|
| `/app/nightfall/nightfall-src` | **29,010** | rode along inside the `./nightfall-incident` bind mount |
| `/app/graphify-out` | 1,398 | `:ro` mount, served by `/graph` |
| `/app/data` | 742 | the data volume |
| `/app/static` | 205 | `./web` |
| everything else | ~2,800 | actual Python source |
| **total** | **34,187** | to find **66 `.py` files** |

Measured: **0.209s per pass on a 0.25s interval** — an ~84% duty cycle on one thread of a 2-core box, reported by `top` as 44-47% and by `ps` as 82 CPU-hours over the container's 8-day life.

`nightfall-src/` is the game's SOURCE (354MB with `node_modules`). **Nothing at runtime reads it** — `routes_nightfall._NF_DIR` reads only `wai-head.js`, `wai-body.html`, `wai-save-sync.js`, `index.html` and `static/`, and `main.py` mounts `/app/nightfall` as `StaticFiles`; webpack runs on the host. It was pure walk cost.


**The rebuild used to be expensive for a vestigial reason, so it was made cheap first.** `api/Dockerfile` opened with `FROM golang:1.24-alpine`, which `git clone`d and `go build`s **rmapi**; `rmscene` came from git alongside it. Neither had a single reference in any `.py`, `.sh`, `.js` or cron file. On a 2-core/1967MB box a cold `go build` is a real OOM risk, so the `watchfiles` rebuild was blocked behind a decision that had nothing to do with `watchfiles`. Both were removed 2026-09-17 (see §1, *Image*) — the build is now one `python:3.12-slim` stage and a `pip install`, which is why `watchfiles` could land without waiting on a memory cleanup first.

**It did neither until 2026-09-22, and this section described a script that did not exist.** `DAY_LOG` was computed, `CRON_DIR` was created, and then nothing wrote to that path except the `API_KEY not set` branch: the POST and its status line were redirected straight to `/var/log/exec-fn.log`, inside the container, where `/debug` cannot reach them. So **no `__morning.log` was ever produced** — of the five nightly jobs, the one whose silent failure matters most was the only one invisible on the page built to catch exactly that, and the gap showed up only because the other four jobs' logs were sitting there next to it. Fixed by piping both lines through `tee -a "$DAY_LOG"`, which is also what makes the `${PIPESTATUS[0]}` rule above load-bearing rather than theoretical (measured in the rebuilt container against a 404: `PIPESTATUS[0]` = 22, `$?` = 0).

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

### Swap sizing

`/swapfile2` was retired 2026-09-13. The 2GB swap it replaced was already 1029/2047MB used with 6 OOM kills behind it, so there was no headroom to absorb a spike. OOM-killer shot `dbus-daemon` / uvicorn instead of the cause four times.

### 17b — graphify rebuild ownership

Root-owned `graphify-out` output made every run redo the full work and die at the write (~780MB peak, global OOM killer); `chown wai-root` turned it into a 125MB no-op. A full rebuild measured 4089 nodes in 25s at a 366MB peak (earlier measurement).

### 17c — the `$?` bug

Through the `tee` pipe `$?` was tee's status, so the old `morning_cron.sh` line logged "exit 0" for every failed curl.

### 17d — graphify history

- It used to run on EVERY commit: dozens of runs a day, the wrong trigger for something this heavy on a 1967MB box. A graph a few hours stale costs nothing; a 502 does. Now nightly.
- From 2026-09-13 the nightly committed and pushed `graphify-out` (1.4 MiB of pack a night, 214MB tracked). Gitignored 2026-10-12; the publish step is gone; the failed-rebuild fallback that used `git checkout -- graph.html` now restores `.graph.html.prev`.
- **2026-09-22**: repo crossed the 5000-node default (4151 on 2026-09-11 -> 5057). The rebuild logged one `Skipped graph.html: ... too large for HTML viz` line, reported `Rebuilt: 5057 nodes`, exit 0; `/graph` served `404 graph.html not found` all day. `scripts/graph-layout.py` drove `/graph?relayout=1`, got the 404, and sat on `wait_for_function` for its full 600s timeout (ten minutes of headless WebKit on a 1967MB box). Re-measured after the limit bump: 5062 nodes emitted / 2781 served, 31s rebuild, 54s bake.
- **2026-10-14**: tripped again, not from source growth — graphify was extracting RUNTIME DATA (`api/data/` is gitignored but graphify ignores `.gitignore`); `spire-perflog/` alone was 6,644 nodes, build hit 14,666 > 8,000. The script's guard restored the last `graph.html` and skipped the bake. Nothing leaked (`_GRAPH_DROP_PREFIXES` already cut `api/data/` at serve time). `.graphifyignore` fix -> 5,797 nodes (72% of the ceiling), 32s rebuild, ~110s bake.
- The post-commit hook is untracked and `session-context.sh` reinstalls it, so a deleted hook comes back and an env var does not.

### 17e — the `--reload` poller burning 44% of a core

`watchfiles` was never in `requirements.txt`, so the box polled since `--reload` was added. `StatReload.should_restart()` runs `reload_dir.rglob("*.py")`, `resolve()`s and `stat()`s each hit, sleeps `reload_delay` (0.25s) and repeats. Uvicorn warns that `--reload-include`/`--reload-exclude` "have no effect unless watchfiles is installed" — why an exclude was never the available fix.

Measured: 0.209s per pass on a 0.25s interval (~84% duty on one thread of a 2-core box), walking 34,187 entries to find 66 `.py` files, almost all `nightfall-src/` (354MB, 29,010 entries, node_modules included) riding inside the `./nightfall-incident` bind. 82 CPU-hours over 8 days. tmpfs mask: 34,187 -> 5,184 entries, CPU 44% -> 8-12%, verified `/nightfall-game/index.html` and `bundle.css` still 200. `watchfiles` took the residual to ~0.

### CLAUDE.md "17-notes" dump (moved 2026-09-27)

Residue: the "STALE" annotation on the 5:00 graphify row (it no longer commits/pushes); the `GRAPHIFY_REBUILD_MEMORY_LIMIT_MB=600` in `~/.zshenv`; the OOM history ("four times"); all folded into §17b/§17d above.


---

