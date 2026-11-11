## 13. The pre-commit hook suite

Current design: [ARCHITECTURE.md §13](../architecture/13-pre-commit-hooks.md).

Two traps it hit while being written, both worth knowing:

- **`protected` is a SUFFIX of `guest_protected`**, so an unanchored match files every guest route as admin — the same substring trap `cmdscan.py` exists for. The regex uses `(?<![\w_])`.
- **An included router's alias must resolve to its MODULE.** Nearly every route module names its router `router`, so resolving `chat_router` to the bare symbol and scanning every file swept mtg/tarot/nightfall in as admin.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

**Cache-bust lint retired 2026-10-14.** `?v=` on static was bumped by hand per `api/` reference in the same commit, enforced by `scripts/lint-cachebust.py`. Failure case: `/hq`'s row layout shipped to desktop while the phone kept rendering the pre-rows `hq.css?v=17` for weeks (immutable, 1-year cache). Retired once pages and the assets they name could live in different repos (an app submodule's template naming the parent's `/chrome.css` cannot bump both in one commit).

**CSS lint on staged files only.** It used to lint `web/*.css` wholesale from the working tree, the one check that could fail on a file the commit does not touch; this tree is production and two sessions share it, so somebody's half-written rule in a file you never opened blocked every commit.

**Browser suites run capped.** A WebKit launch wants 200-400MB while the box runs ~1.4GB used with swap effectively full; a spike invited the global oom-killer, which picks by badness score rather than culprit and has taken out `dbus-daemon` and uvicorn's python instead of the browser.

**Fixture check rationale.** A rename like `guest_key`->`guest_cookie` that breaks a consumer NOT staged this commit slips through every per-feature gate and explodes later when that gate finally fires; `--setup-plan` closes that hole.

**Hook trap origin.** On 2026-09-08 a heredoc annotating the guard hooks tripped both the nightfall build guard and the deploy healthcheck (the first nightfall-guard cut denied a python heredoc that quoted the correct build command in prose); hence `cmdscan.py`.

**Palette lint.** Originally fed by `/api/color/usage` and the `/color` moodboard (now `/api/ui/usage` and `/UI`). `--cyan-hsl` = `0.12/0.45/0.8/1`, matching `--green-hsl`; neutrals (Silver, Smoked Glass) use fewer steps. Border-width, duration and easing tokens were dropped as unused.

**Swallowed-comment lint** exists because code after a mid-line `//` broke /spire 3 times.

**Admin-guard enumeration traps.** Substring trap: `protected` is a suffix of `guest_protected`. Mutating routes are not fired because the suite runs against the LIVE container (`POST /api/morning` would run the pipeline on real data).

**CLAUDE.md cap.** CLAUDE.md hit 211k chars on 2026-09-27 by accretion (every commit appended measurements to an existing row); Claude Code stops loading memory files past 150k.

**Size-rule splits** (original lists): `main.py`->`pages.py`+`routers.py`+`routes_views.py`+`routes_api.py`+`routes_graph.py`.


---

