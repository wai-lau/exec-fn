## 1. Deployment

Current design: [ARCHITECTURE.md §1](../architecture/01-deployment.md).

**The reMarkable feature is gone (2026-09-17), and the build got cheap because of
it.** The image used to open with `FROM golang:1.24-alpine AS rmapi-builder`,
which `git clone`d and `go build`s [rmapi](https://github.com/ddvk/rmapi); pip
then installed `rmscene` from git and the Dockerfile `sed -i`-patched one line of
its site-package source. All of it was dead: **neither `rmapi` nor `rmscene` had a
single reference in any `.py`, `.sh`, `.js` or cron file.** On a 2-core/1967MB box
a cold `go build` is a genuine OOM risk, which made every rebuild something to
schedule rather than just run — and the `sed` patch matched an upstream line by
exact string, so an upstream edit would have broken the build silently. Removing
the stage drops ~18MB of binary, the whole golang pull, the git clone, and that
patch.

The lock exists because of a specific outage. Nothing was pinned, so every
rebuild re-resolved the whole tree from scratch. On 2026-09-17 a rebuild resolved
`anthropic` and `mcp` to versions requiring **`httpx2`** rather than `httpx` — and
`api/auth.py` imports `httpx` **by name**, having only ever received it as a
transitive. It vanished, `main.py` died at import, and every route 502'd. Both
`httpx` and `httpx2` sit in the lock on purpose now: `httpx2` is what anthropic
and mcp want, `httpx` is what `auth.py` imports.

Measured live: **20 of 220 requests to `/` across two reloads came back 502**, while the same probe straight at `127.0.0.1:8080` saw none. That is what pinned it on the proxy rather than the app.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

(Removed from ARCHITECTURE.md §1 / §1d / §1e / 1-notes during the 2026-10-15 revision.)

### Python deps, the httpx2 502 (2026-09-17)
Unpinned, every rebuild re-resolved the whole tree; on 2026-09-17 that moved `anthropic` + `mcp` onto `httpx2`, evaporating the transitive `httpx` that `api/auth.py` imports by name -> `ModuleNotFoundError` at import -> 502 on every route. An audit of every direct import against the declared set at the time found three gaps — `httpx`, `pydantic` and `starlette`. (`fontTools` also showed as missing, but it belongs to `api/scripts/subset_cv_fonts.py`, a one-off font-subsetting script the app never imports — not a runtime dep.) The lock was the fix: `api/requirements.in` (direct deps) + generated `requirements.txt`; the lock script resolves in a throwaway `python:3.12-slim` so pins match the image rather than the host.

### rmapi-auth
Holds a real authenticated reMarkable device token (`rmapi.conf`, 1.5KB, last written 2026-04-28); re-pairing is a manual physical act. The binary was removed 2026-09-17. `RMAPI_FORCE_SCHEMA_VERSION` survives in `.env` as a no-op; it was dropped from the Dockerfile `ENV` and `entrypoint.sh`'s `cron_env` filter. (The cron_env grep today is `^(API_KEY|ANTHROPIC_API_KEY)=`.)

### nginx 502 on `--reload` (the double upstream)
The reloader holds the listen socket in the parent and swaps the worker underneath, so a new connection is never refused — but a request landing on the OLD worker while it drains gets its connection closed with no response, which nginx reports as 502. Measured before the fix: 20 of 220 requests 502'd. After the two-peer upstream: **220/220 200s**, worst request ~7s (the swap is slow, not broken).

### 413 on pasted screenshots (2026-09-13)
`client_max_body_size 25m` added to the 443 block. nginx's default is 1m, and a screenshot pasted into `/cc` arrives as base64 in a JSON body, so a normal phone screenshot was rejected with nginx's own HTML 413 before the app saw it (`[ request failed (413) ] when uploading image`). Verified live: a 2MB body reached the app (401 unauthenticated, not 413), and an over-cap 7MB image returned the app's `{"error":"image too large"}` 413.

### Access-log masking (2026-10-14, security audit)
A poll's slug opens its sealed file and a draft token mints its poll, so neither may sit in a 14-day log. Logs written before the change age out (nginx keeps 14 days); the uncapped docker log went with the container recreate that applied the 3 x 10MB cap.

### Submodule migration (2026-10-14)
Phase 0 built the parent side first (`app_paths`, static mount, `_tmpl_path`). Then:
- **nightfall-incident** was already its own repo (`wai-lau/nightfall`, public); `git submodule add` adopted the existing checkout so the `./nightfall-incident:/app/nightfall` bind (and its tmpfs mask) never moved. `.gitmodules` `ignore = dirty` because 31k files under `nightfall-src/` would slow every `git status`. Its `graphify-out/` was untracked in the same change. The deploy gained `git submodule update --init` — without it the parent's pointer moves and the served game does not. That update leaves a DETACHED HEAD; `session-context.sh` re-attaches. `bootstrap.sh` rewrites the ssh submodule URL to https for its one clone command (a fresh box has no GitHub key).
- **claude-box** (`wai-lau/cc-sidecar`, public) was split with `git subtree split -P claude-box` (34 commits of history) and re-added at the SAME path, so `setup.sh`'s `/exec-fn/claude-box/...` install list and `scripts/cc-probe-daily.sh` needed no change. One discovering wrapper, `tests/test_cc_node_suites.py`, replaced two per-file wrappers (`uploads.test.mjs` had none and never ran). The live sidecar runs from `/srv/cc-agent/`, so swapping the directory touched nothing running.
- **spire** (`wai-lau/spire` -> `apps/spire`, 110 files, 1,172 commits via `git filter-repo --path`, every file byte-identical). Done live with no restart: submodule added -> `touch api/app_paths.py` (a reload, so the static mount's `all_directories` picked up `apps/spire/web` while parent copies still won) -> originals `git rm`'d (second reload; `routes_aspira` imports from `/app/apps/spire/api`). `tests/conftest.py` became the root `conftest.py` (+ `pytest.ini`), putting `api/` + `apps/*/api` on `sys.path`.
- **noodle** (`wai-lau/noodle`, 87 files, 163 commits), same day: its templates' hard-coded `?v=` on parent assets stopped mattering once cache-busting moved to serve time (§13c); `test_noodle_isolation.py` derives its forbidden-module list from this repo (it would otherwise FAIL on an empty list); `tests/test_app_paths.py` compares served FILE paths (both repos have `fonts/` and `vendor/`). `tests/test_admin_only.py` enumerated owner routes from `api/` only, so spire's `GET /api/spire/perflog` and noodle's `/api/noodle-polls`, `/created` silently left the guard — caught by diffing collected test ids before/after (fixed `8f7fd456`). A stale `api/noodle/` holding only the container's root-owned `__pycache__` needed `sudo rm` (Python already ignored it: a regular package later on `sys.path` beats a namespace dir earlier).
- Do the reload swap ON the droplet tree: a local deploy would `reset` the originals away a moment BEFORE `submodule update` clones the app in, and a reload in that gap fails its import (the next reload, triggered by the clone's `.py` files, recovers).

### `--reload-exclude` (2026-10-14)
`./apps` sits inside `/app`, which `--reload` watches, so saving an app's test (or aspira-sim's `applyfit.py`) restarted production. The first attempt, `apps/*/tests`, matched nothing (uvicorn 0.53 `FileFilter` treats a non-directory exclude as a per-file pattern) and cost a wasted rebuild (~6s of nginx's loading page).

### Traps hit during the swap (2026-10-14)
- The `claude-box` swap commit was rejected on push (a spire commit from another clone landed), and `push-after-commit.sh`'s `pull --rebase` aborted with `untracked working tree files would be overwritten by checkout: claude-box/...` / `could not detach HEAD`: the rebase first checks out origin/master, where those paths are plain files. No rebase was left in progress. The `.git` FILE inside the checkout points at `.git/modules/<name>`, so the moved dir stays valid.
- The commit-hook `if` filter `Bash(git commit*)` is a prefix match, so the docs guard never saw `git -C <dir> commit`. The filter is gone; the script's own regex narrows.
- `api/apps` appears on the host as an empty dir (mount point for the nested `./apps` bind); pre-created as `wai-root` so docker would not make it root-owned.

### deploy.sh (2026-10-14)
The old one-liner ended in `docker compose up -d --force-recreate api` on EVERY deploy — a container restart and the nginx loading page each time — though `api/` hot-reloads and `web/` + templates are read per request. It was unconditional because an untracked `nightfall-incident` could be REPLACED by a pull and stale its bind; a submodule is updated in place, so that is now the exception the bind probe catches.

### Local-claude deploy: no pull / no stash
`/exec-fn` carried local drift (regenerated `graphify-out`) and a rebase-pull config; with bind-mounted dirs, `pull`/`stash` were fragile — a mangled stash-pop or a staled mount could wedge a request that reads the mount. Both `stash -u` and plain `stash` caused outages, hence the PreToolUse hook (read-only `stash list`/`show` allowed). `routes_nightfall` USED to read `nightfall-incident/wai-head.js` at import, so a staled `/app/nightfall` killed startup -> 502 across every route; it now reads lazily in `build_nightfall_html()`.

### sudo on the git half
`sudo git reset --hard` rewrote every file the push changed AS ROOT, which then needed `sudo` to edit — how the tree accumulated root-owned sources over weeks (`tests/*.py`, `docker-compose.yml`, `bootstrap.sh`, `printer-box/*`, `scripts/pre-commit`, `api/*.py`, `web/mtg.js`). The auth log showed twelve `git reset --hard origin/master` under sudo plus a couple of `sudo tee web/printer.js` forced by it. The whole tree and `.git` were chowned back to `wai-root` on 2026-09-12. `reset --hard` discards the droplet's `graphify-out` drift (re-run `/graphify` after).



---

