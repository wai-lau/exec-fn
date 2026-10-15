# exec-fn — Archaeology

The past: bugs that have already been fixed, choices made and then reversed,
measurements taken once, and mechanisms that no longer exist.

**Why it is kept.** Every entry here cost somebody a day to find. Knowing that
`/graph`'s "groups of four" was a double quantisation, or that an unpinned
`httpx` once 502'd every route on the box, is what keeps the second occurrence
from taking as long as the first. None of it describes how the system works
today — [`ARCHITECTURE.md`](ARCHITECTURE.md) is for that.

**Sections mirror ARCHITECTURE.md**, so §11 is `/graph` in both files. A section
absent here has no recorded history yet.

**The split is by a paragraph's primary claim.** A standing rule lives in
ARCHITECTURE.md even where it names the incident that produced it; the incident
itself lives here. Text is moved verbatim.

---

## 1. Deployment

Current design: [ARCHITECTURE.md §1](ARCHITECTURE.md).

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

## 2. Module graph

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

The graph was regenerated 2026-10-14 from an `ast` walk (script lived in a session scratchpad; the old doc claimed 37 nodes / 86 edges and "helpers 25 inbound"). The 2026-10-15 recount of `helpers.py` inbound edges is 23 (21 top-level + `gcal` and `nudge_loop` late).


## 3. Morning pipeline + scheduling

Current design: [ARCHITECTURE.md §3](ARCHITECTURE.md).

  A save landing in the same millisecond as the read that seeded the `_load_json` mtime cache left the stale PRE-save board being handed to the next load. Two quick cycles — a
  chat tool archiving a card, then re-reading it — saw the card back in the
  column it started in (found 2026-09-15 by `test_archive_card.py`, where a
  second archive of the same card re-cloned its recurrence).

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **2026-10-06**: before `_post_morning_errors`, a failing morning step (gcal `invalid_grant`) was visible only in `/debug`'s cron log.
- **2026-09-27**: CLAUDE.md was thinned to an index; its card-schema notes (`dir_start_min`, `prep_time`, rd.json concurrency) were moved into ARCHITECTURE.md §3 as "3-notes" and are now folded into §3b and the concurrency section. The `prep_time` UI box once labelled "event" was renamed "duration" (field UI only). `prep_time = 0` became "fully decomposed, no event block" (the protected event block exists only for a card reached through prep).
- Earlier text in the Exec call chain mentioned only `schedule_to_day` from "HQ drag"; the drag path is actually `PATCH /api/hq` with `clamp_to_window=True`.


---

## 4. TTS (text-to-speech)

Current design: [ARCHITECTURE.md §4](ARCHITECTURE.md).

Both `/hosaka` and `/emet` render the same `emo | idle | homo` segmented
control (shared `web/gpu-mode.{js,css}`, keyed on `#gpu-mode`) for owners only.
If the proxy call to the home service fails (tunnel down, service not running),
the mode is reported as `gone` (an exec-fn label; the home service itself never
returns `gone`).

`GET /api/hosaka/mode/stream` is an owner-only SSE fan-out (`_mode_subscribers`
in `routes_tts.py`): a successful `POST` broadcasts the new mode to every
subscriber, so the control **live-syncs across pages** — flipping it on
`/hosaka` updates the strip on an open `/emet` (and vice-versa) with no reload.
The stream pushes only on an actual switch; each page seeds its initial state
from `GET /api/hosaka/mode` on load.

**The star is a CHARACTER in the bracket's own font, and a transform is the only
thing that sizes it** (fixed 2026-09-21). It was a `--font-ui` star at
`font-size: 1.3em` with `0.12em` side margins, and that cost this control both of
a composer's published dimensions. **Height**: an inline-block's own line-height
IS its box height, so a 20.18px box on an 18.62px line grew every composer
carrying the star by 1.56px — `/cc`'s input bar measured 26.17 against `/mtg`'s
24.61, and `/cc` publishes that bar as `--input-h` for `#terminal` to sit above,
so the star was quietly eating a row of transcript on the page that has the
least of it. **Width**: a 0.84em advance plus 0.24em of margin made `[✦]` nine
pixels wider than the `[x]` beside it (38.28 against 29.28), on a one-line
composer where the two read as a pair.

**OFF means off.** Before 2026-09-20 `/tarot`'s button was a volume mute that
kept synthesizing and kept pacing the reveal to audio nobody could hear. Now
`speak()` returns a DEAD controller when the narrator is off — nothing
synthesized, no socket — and every caller reads that as "reveal at your own
pace, now". One flag; no second state to keep in sync.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Pre-fix premise removed**: §4 opened with "Every voice streams from a single home GPU box... No TTS models run on the droplet; the container only proxies." Wrong since glados moved to the `hosaka-piper` container on the droplet.
- **GPU-mode drift** (`gpu-mode.js`): its recheck-on-load and refresh-on-refocus only covered pages that got touched; its own comment said "No interval -- a long-open foreground tab drifts until touched". The 15s poll in `/mode/stream` fixed pages already open. Before the 90s homo grace, the next poll read "homo but no TTS" and flipped the strip idle→homo.
- **Terminal-frame guarantee**: before `_pump_to_client`'s synthesized error, a silently-dead upstream left `/tarot`'s reveal spinning forever with text stuck part-revealed. The stall watchdog originally used raw `el + dur` for progress, which never stopped rising (the ctx clock keeps running after the buffer drains), so it could never fire.
- **`/hosaka` button rename 2026-09-10**: the middle GPU-mode button was renamed `down`; `data-mode` stayed `idle`.
- **Star glyph (`[✦]`) geometry**: Iosevka has the glyph and its advance IS the mono cell, so in `--font-mono` the star occupies one character: three cells for `[✦]`, three for `[x]`, 29.28px each, line box a character's. `transform: scale(1.25)` sets how much of the cell the star fills (ink 6.67px → 8.67px; gap to each bracket down to 1px vs the `[x]`'s 2.33px). Layout is untouched at any factor, which is why the size lives in a transform. Both bars measure 24.61, both controls 29.28. The nav's glyph label is sized the same way (§12). `/tarot` overrides in `tarot.css`: its column has `[↺]` at 1.7em and `[♪]` at 1.3em with real side margins, so the cell-sized star read tiny (ink 5.67px vs the note's 10.67, 1px gaps vs 4px); it takes the reset glyph's metrics plus the factor that brings ink to a note's: 10.33px, 3.33px gaps, same button height as `[↺]`.
- **Mic send arm**: a pause used to send half a thought and let the rest arrive as a second message, hence the 1s `SEND_DELAY_MS` arm. Finalized text is held on the session (`pending`), not read back off the composer, because iOS ends the recognizer on silence and the rebuild resets `base` to 0; an EMPTY result event never cancels the arm; tapping the mic off mid-window deliberately does not send. `cc-mic.js` went with the `/cc` page.
- **Moved from CLAUDE.md 2026-09-27** ("4-notes"): voice-both-ways, `/hosaka` page, `/api/hosaka/mode`, `/mode/stream`, `WS /ws/hosaka`, `WS /ws/hosaka/presence` blocks; now folded into 4a–4e.


---

## 5. LLM call sites + prompt caching

Current design: [ARCHITECTURE.md §5](ARCHITECTURE.md).

  **TODAY moved from the top into the volatile tail — it was the silent invalidator.** The restructure was required because the tools alone (~3.5K) sit under opus's 4096 minimum.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Earlier token figures (~8.7K/13.4K tarot, ~6.6K, ~5.9K, ~5.2K) had drifted as prompts grew; remeasured 2026-10-14 (tools alone for Exec = 3,749, static text 2,745).
- `TODAY` sat at the top of the old single-string Exec prompt and silently invalidated the cache every request; moved to the volatile tail.
- **Two-pass Exec turn (2026-09-24):** replaced a single pass that acted and talked in one response, and learned to talk INSTEAD of acting: history reaches the model flattened, so it read dozens of its own turns saying "Added X" with no tool call beside them. Observed: "hang out with Nick" / "hang out with Jesse" answered "Added ... to the ideas pool", no tool called, and an invented `card=` id in the answer row — past a static-prefix rule already saying, in capitals, never to describe an action without the tool.
- **Cost measured live (2026-09-24, one-off, not re-run):** 8.6-9.3s to first text on a create, 2.3s on a question.
- **Follow-up action diff:** after a tool round the follow-up turn rebuilt the system prompt, so board lists included a card the turn just created and the model reported a phantom duplicate; fixed by the ACTIONS YOU JUST TOOK block.
- **Card id on log entries:** one `create_card` WITH a due_date emits both `created` and `updated`; by title alone that read as two cards, producing the phantom "there was already one in the pool from earlier this turn".
- CLAUDE.md's old paragraph: "TODAY was the silent invalidator until it moved into Exec's volatile tail, and the follow-up turn's ACTIONS YOU JUST TOOK block appends to that tail for the same reason."


---

## 6. Printer (ELEGOO Centauri Carbon)

Current design: [ARCHITECTURE.md §6](ARCHITECTURE.md).

Verified end-to-end against the live printer with the real app under
uvicorn (auth tiers, rewrites, etag→304, un-gzipped MJPEG, WS relay + the
cmd-386 rewrite, reconnect splice against a fake upstream that drops every
few frames).

Nav label is `3DP`, icon `printer.png` — the bitman smiley tile with rounded corners, baked from the untracked `bitman.png`. Its tile was recoloured lime→blue `#0090fc` on 2026-08-30: the lime read as the phosphor `.active` green, so the nav item looked permanently lit on every page. The route, icon key and internal name all stay `printer`; on the landing page it sits between nightfall and UI (its hue slot moved with the recolour).

**That interval was 0.5s (~2fps) until 2026-09-19 and read as broken rather than thrifty.** A print head moves far enough in half a second that consecutive frames look like unrelated stills, and a camera pointed at a machine exists to show the machine moving. 5fps is where motion reads as motion; the bandwidth is bounded twice over — ~34KB a frame, and `MAX_VIEWERS` caps the whole page at 16 streams however many people find it. Verified live: 5 concurrent viewers = 1 upstream socket, every part a valid JPEG.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Guest tier added 2026-08-30. Guest page cut down 2026-09-19: strip mirrors the vendor SPA's print-job row minus pause/stop (decoration over a 401); dropped page chrome (`.printer-head`: lede + online chip talked about a machine the guest does not drive), and nozzle/bed/chamber temps (telemetry, not "what is it printing"). Filename/thumbnail never sent by `public_status`.
- Job strip as a CARD (2026-09-19): it was a full-width grid with state chip hard left and percent hard right, a whole phone-width apart. As a card sized to its content the eye travels down. Same surface as `.doc-card` (green 0.12 over the page, matching border), one step down on radius/padding because it holds four values. `.pj-rows` stacks one pair per line because side by side elapsed + remaining + layer are wider than the feed and the card reads as a caption bar. Idle: state chip alone, no card around one word.
- Guest frame rate history: 0.5s (~2fps; a moving print head read as a slideshow of unrelated stills), then 0.2s (5fps), now 0.1s ceiling.
- **Lag fix 2026-09-26** ("the printer page is super laggy"), measured causes: (1) a strict `gap < interval` throttle against a ~100ms upstream skipped the frame landing at 199ms, so "5fps" was 3.3fps of 300ms gaps; both throttles now accept from `_SLACK` 0.75. (2) A pushed MJPEG body queues in uvicorn's transport, nginx and two kernel socket buffers, none dropping: client reading at 100KB/s saw 3.5s median, 7s and climbing after 25s. Pull model: same client ~380ms flat; a fast one 4.99fps at ~7ms. Still laggy on iPhone (Safari and Chrome): guests were capped at 5fps against the owner's 10; and one pull at a time capped a phone at 1/(RTT+transfer) — 150ms added RTT gave 6.4fps with one in flight, 9.9fps with `PULL_DEPTH` 2; real guest page in WebKit with 150ms injected measured 9.5fps, max gap 168ms. Guest costs ~340KB/s droplet egress only (home uplink carries one stream). Test: live 5s pull AS A GUEST with 150ms added RTT asserting >=8fps with no hole.
- Scrollbar (2026-09-19): the vendor document painted the browser's grey system bar, a bright strip down an otherwise green page. Verified by pixel: thumb reads phosphor green at the gutter, 4px of fill in a 12px bar. Two hammers needed: `html ::-webkit-scrollbar` (SPA's styles.<hash>.css wins on specificity otherwise) and `!important` (Angular-injected inline copy lands after our `<link>`, wins on source order).
- Gzip: newer starlette binds the exclusion list as a constructor-kwarg default at import time, so the module-global patch was silently ignored and MJPEG frames (and the fonts/images already listed) were gzipped after all; tuple now carries prefix and `type/*` spellings.
- Verified end-to-end against the live printer under uvicorn: auth tiers, rewrites, etag→304, un-gzipped MJPEG, WS relay + cmd 386 rewrite, reconnect splice.
- Hub reconnect: upstream closes 10s after last viewer leaves, releasing one of the printer's 4 streams; viewer bodies are the hub's own re-mux so an upstream boundary change no longer matters.


---

## 7. `/cc` — the Exec panel's agent

Current design: [ARCHITECTURE.md §7](ARCHITECTURE.md). **The sidecar-side history** (full-agent decision, the connector finding, denylist → allowlist, `/etc` binds, the hangup listener on `req`, titler scratch sessions, the session pointer) moved to `claude-box/ARCHAEOLOGY.md` on 2026-10-14. What stays here is the page / panel side.

**A tool call is ONE line, and its output folds under it** (2026-09-13; `web/cc-toolout.js`, now `web/exec-toolout.js`). The line clips with an ellipsis (`white-space: nowrap`) — a url or a bash command routinely wrapped to three rows, and a turn with four fetches was a wall of addresses with the answer somewhere past it. The result renders collapsed (`hidden`); tapping the line reveals it and flips the gutter marker `+` → `-`. **The whole row is the hit target, not the marker glyph** — a 1ch pseudo-element is not a thumb, and this page is driven from a phone. Open, the block is capped at `max-height: 20lh` and scrolls inside itself: `lh` is 20 of the block's OWN lines, which is what the cap is about, where the `12rem` it replaced was a different number of lines at every font size.

**Every tool line expands to something** (fixed 2026-09-15). An empty result used to render nothing at all, which left the line without its fold class or click handler: tapping it did nothing, and nothing distinguished an empty result from a broken page — how WebFetch got reported as unexpandable. Empty now folds as `[ no output ]`, and the end-of-turn pass (and the interrupt path) folds `[ no result returned ]` under any call still waiting. (The sidecar half — `resultText()` handling the web tools' structured blocks — is in `claude-box/ARCHAEOLOGY.md`.)

**Text that resumes after a tool call opens its OWN bubble.** `dropIfEmpty` used to drop the assistant bubble only when it was still empty; a bubble that already held prose stayed open, so the model's next message was appended to the same `fullText` with nothing between them and rendered ABOVE the tool line it came after. The join is invisible in the output — it reads as a missing space after a period (`…real numbers.**HG group coaching:**`, reported 2026-09-15). The bubble is now settled (markdown pass + SVG swap) and closed, the reveal state replaced with a fresh object (a cancelled typer never calls `onDone`, so leaving the old `typing` promise would hang the settle pass), and the receipt hangs on the last settled body when a turn ends on a tool. Pinned in `tests/test_exec_panel_stream_browser.py` (was `test_cc_stream_browser.py`, removed with the page).

**`dropIfEmpty()` must be idempotent** (fix landed in `0de197a`, whose message covers only the CRT work). It nulls `div`, and a turn routinely fires several drops in a row — the archive tools list then read, so `tool`, `tool_result`, `tool` — at which point the second call ran `div.remove()` on null and the whole turn died with `null is not an object (evaluating 'div.remove')`, taking the reply that was still streaming behind it. It now returns early when `div` is already gone. Pinned by driving a real two-tool turn in WebKit: 2 tool lines, 1 assistant reply, zero console errors.

**The status bar's rows** (2026-09-11): the two rows were merged onto one and split back the same day — on a phone the metrics are a fixed ~330px of the 430 available, so a single row truncated the title to almost nothing. On its own line the band got the full width and the metric colours survived (white, mint and cyan are illegible on a bright band). The band itself was dropped 2026-09-30 and the bar moved into the panel (ARCHITECTURE §7h). The model is no longer shown at all — it is still tracked, since it decides which context window `ctx%` is measured against.

**The SDK's own `summary` was tried first for titles and is NOT enough**: on a live conversation it is usually just the opening prompt, so the bar showed the first thing typed back, verbatim. The good titles in Wai's terminal come from her own recap hook (`~/.claude/hooks/session-recap-gen.js`), which asks haiku for a 3-6 word rolling title every few prompts — `cc_title.py` mirrors it.

**`dropIfEmpty`-adjacent stale claim, corrected 2026-10-14:** older docs said `[x]` in the panel "ends the conversation". It never did in the panel — `#exec-ph-close` closes the panel; `/new` ends a conversation.

**"No voice OUTPUT on /cc yet"** was true until 2026-09-20; voice now narrates replies in Exec's glados voice over the shared narrator stack (CLAUDE.md § The voice). Kept only as a note that the line no longer applies.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Busy wait (2026-09-29).** Measured: two sends 1s apart → first done in 14.1s, second `waiting` then done at 20.0s. Before this a busy sidecar answered `busy` at once and Wai had to notice and resend.
- **Board cost (measured 2026-09-28).** The `<exec-context>` block is ~17.2K chars (~4.3K tokens); board 8.2K (80 ideas = 6.2K), the rest mostly KNOWN CONTEXT; re-sent every user turn, accumulates until the 4:30 new-chat or compaction.
- **`LENGTH` rule (2026-09-29).** Measured: a yes/no in 41 words, "what should I focus on" in 66. Exec's prompt is one source so the panel and the old `/cc` could never drift.
- **Two-pass guard off the panel path (probed 2026-09-28).** It existed because chat.json flattened tool calls out of history and a single pass learned to say "Added X" without calling anything. The SDK transcript keeps real tool_use/tool_result pairs; two action turns made 1 and 3 real `mcp__exec__*` calls and the board matched. `chat_passes.py` stays for Discord inbound until phase 4. Gone from the panel: the client-held `messages`/`stage`, and `?exec=open` re-sending a trailing user message.
- **§7c idempotence.** A second drop on an already-gone bubble once killed the turn with `null.remove()`.
- **§7e history.** The agent became Exec in phase 2 (2026-09-28); the panel moved onto the sidecar in phase 3 (2026-09-28).
- **§7g folded 2026-09-29.** Once the panel ran on the sidecar the two were one agent behind two doors and Wai asked for one door. `/cc` (page, template, nav `✦`, `web/cc*.{js,css}`, `tests/test_cc_stream_browser.py`) removed; the code was renamed into the panel's `exec-*` family. Dropped files (was `exec-images`) verified live 2026-10-01. The `[ N turns ]` footnote was dropped 2026-10-07. Sidecar files probed: `/context /cost /usage /compact /model` 2026-09-11.
- **§7h.** Metrics-only since 2026-09-30 (title band dropped).
- **§7j.** Before 2026-10-14 the page's interrupt WAS the hangup; interrupting became an explicit request when runs began to outlive their caller. A few hundred ms of round trips with the user's text appearing nowhere read as a dropped keystroke, hence the user line lands first.
- **§7k (2026-10-14).** Wai: "don't stop generating responses when I minimize or close the exec chat" — "audio can stop". The route was probed live (anonymous 401, owner `{ok, stopped:false}`); end-to-end against a live subscription run needs a message in Wai's real thread and was not done.
- **§7k-bis first-cut bugs.** `onresult` iterated `e.results` with `for...of` but Safari's `SpeechRecognitionResultList` is array-LIKE with no iterator; the `.mic` span was eaten by the first-gesture keyboard arm's `preventDefault`; a pulsing prompt under `.cyber-blur`/`.cyber-crt` re-fired both backdrop readbacks every frame (shipped once; reported as the page freezing; the old `/cc` page froze in voice mode the same way). Pinned by `test_a_pause_mid_sentence_does_not_send_half_of_it`. `/cc`'s binding `cc-mic.js` went with the page.


## 8. `/rd` — the board and its month calendar

Current design: [ARCHITECTURE.md §8](ARCHITECTURE.md).

**The last column's missing right rule is keyed off a `.cal-eow` class the builder sets from the day, never `:nth-child(7n)`.** nth-child counts every child of `#rd-calendar`, so adding the `.cal-mark` watermark as the first child shifted the count by one and silently moved the rule to Friday, deleting the Friday/Saturday hairline.

The reminders bar shows what is **inside a 30-day window** (plus any `pinned_reminder`); everything further out is counted into a `+N` button that opens the full list. The button is `position:absolute` and was appended to `bar.firstElementChild`, i.e. to the first visible chip — so on a board whose reminders are ALL beyond the cutoff, `visible` is empty, there is no first chip, and the button was silently never created. `body.has-reminders` is keyed off `all.length`, not `visible.length`, so the bar still rendered: a blank strip with 38 reminders behind it and no way to reach them (2026-09-21 — birthdays run months ahead, so this is the board's normal state, not an edge case).

`buildBooks()` had already solved it — when nothing is visible it creates an **empty chip** to host the button — and `buildReminders()` now does the same. A bar's `+N` must never be parented to content that may not exist.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Grid lines.** At 1px they were lost against the scanlines; at 0.12 alpha with 1px rules the month lost its grid, so the weight lives in the border width (5px), not the alpha scale.
- **Archive preserving `scheduled_day`.** Clearing it fell back to `due_date`, a different day for anything completed early or rescheduled. 33 already-archived cards were backfilled from the activity log.
- **Dot colours.** Interfacing = Marigold @1, Hobby = Ember @0.8 (palette names for `--orange-hsl` / `--orange-glow-hsl`).
- **`.cal-more`.** Was a `+` glyph, which sat on its own baseline and broke the row's rhythm.
- **Week wash.** Green's scale jumps 0.12→0.45; 0.45 turned the week into a solid block the dark numbers were lost on. The week used to read as a shadow, now lit.
- **Today box.** A border override replaced that one cell's 5px rules, thinning the grid there and leaving the bright line riding the outer edge of a 5px band so it read ~4px right and down.
- **`.cal-eow`.** Adding the `.cal-mark` watermark as first child shifted `:nth-child(7n)` onto Friday.
- **Swipe.** Dragging across dates selected them; a drag off a text selection fires native `dragstart` which swallowed the rest of the pointer stream. Capturing to an element whose subtree is replaced killed event delivery. Verified 5-row↔6-row in WebKit.
- **8g.** Measured only at build time and on `resize`, bar heights held a stale value after the bit webfont landed (88px for an 82px bar), leaving a dead 6px gap. `.card.plain` fill: scanlines now cross cards at reduced strength, which is the point.
- **8h.** A board whose reminders all lie past the 30-day cutoff (birthdays run months ahead) rendered a blank bar with no way in; `showRemOverflow()` once lacked the `!c.pinned_reminder` term, so a pinned far-future reminder showed on the bar AND in the `+N`.

### 8-notes. From CLAUDE.md (moved 2026-09-27) — verbatim

**[Pages → /rd]**

`/rd` — R&D board from `rd.json` — the four columns, the reminders + books bars, and under them a minimal **month calendar** (`#rd-calendar`, built by **`web/rd-calendar.js`**, split out of rd.js for the 500-line cap; same global scope, loaded before it). The calendar is the current month only, each day showing the zero-padded date over up to 5 dots — one per card landing on that day, hued by category and **as wide as the card is important** (`dotUnits()`: wisp 1 → commitment 4), with a hollow silver `.cal-more` ring standing for any that don't fit. Books + exiled are excluded; **archived cards still count, but only on days already past**, and archiving PRESERVES `scheduled_day` (`_apply_patch_schedule`) since that is the only record of the day the work actually happened. Recurring cards are projected 2 months forward (`_advanceRecur`), because only one occurrence is ever live. Weekends tint their date cyan, Québec statutory holidays pink (`web/qc-holidays.js` — **computed, not tabulated**, so it answers for any year), this week washes green, today draws a bright 1px `::after` box. **Drag a card onto a day to schedule it** (`wireCalendarDrops` → `POST /api/rd/{id}/schedule`); drag/swipe sideways to page months (`wireCalendarSwipe`). Three things bite anyone touching this: any gesture surface here needs `touch-action:none` + `user-select:none` + pointermove/up on **window** with NO `setPointerCapture` (a native `dragstart` or a rebuilt subtree otherwise eats the gesture mid-swipe); bar heights (`--rem-bar-h`/`--books-bar-h`/`--cal-h`) are kept live by **`ResizeObserver`**, since no resize event fires for a webfont reflow; and `#cal-mark` must stay a fixed SIBLING of `#rd-calendar` at `z-index:-2` to sit under the CRT stack.

**[API → POST /api/rd/{card_id}/schedule]**

POST `/api/rd/{card_id}/schedule` — Drop a card on a /rd calendar day. Body `{date}`. The day becomes the `due_date` (an existing clock time survives — a 7pm concert dragged to another day stays 7pm, so `scheduler.timed_start_min` still pins its block); in-window it also goes rd→hq via `schedule_to_day`, beyond the window the due date lands alone. Reminders + books are dated but never scheduled; a card dragged out of archives/exile returns to rd first. 409 when an active nudge loop would be deferred (consequences first), 400 on a bad date, 404 unknown card. Pushes `{cards_changed}` so an open /hq refetches.


---

## 9. The landing page

Current design: [ARCHITECTURE.md §9](ARCHITECTURE.md).

**What it replaced:** a full-height column of all eight that ran **1289px tall in a 932px viewport**, where `body{overflow:hidden}` silently clipped the last two sections off the bottom.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Measured 2026-10-14 at 11 sections, headless WebKit, read from the live globals (`wheelDth`, `wheelR`):** `K`=6 (`ceil(11/2)`, the odd-`n` round-up), `DTH`=15°, all 11 lit at every resting position, at 430×932 (R 317px), 382×700 (R 394px) and 1280×800 (R 274px). At 9 sections it was `K`=5, `DTH`=18°, all 9 lit.
- **Spacing verified 2026-10-14** at every one of the 11 resting positions (front gap = focused item to each neighbour): 430×932 front gaps a constant 22px; 382×700 front gaps 4–45px (4px only where the two tallest blurbs sit together); 1280×800 front gaps 4px (`WHEEL_MIN_GAP`; pitch is tight at desktop). No lit item's centre is past the viewport except the faint rim bleed `WHEEL_REACH` allows (2 at 382×700). At 9 sections (430×932 / 390×844 / 1440×900 / 1280×700): all lit, front gaps 7–45px.
- **Rounding up on odd `n` pays twice**: it lights every item and narrows `DTH`, which tightens the front spacing (`R·sin DTH`).
- **Frame cost.** Blur quantised to a half-pixel and dropped under 1px so a spin hands the compositor two distinct radii across four elements instead of a new value on six. WebKit at 430×932 holds a 17ms median frame through a spin, blur on or off. Position settle uses real elapsed time so it takes the same wall-clock at any frame rate.
- **Left-edge scaling.** Centre-origin is the truer projection but cascades the icon column rightward as items recede, reading as a vanishing point off to the side rather than a wheel.
- Recruiter and security share hue 36°; security is second because its blue secondary leans toward what follows.

### 9-notes. From CLAUDE.md (moved 2026-09-27) — verbatim

**[Web app → Landing page]**

`/` is a public landing page (`_landing_html()` in routes_views, styles in `web/landing.css`, driven by `web/landing-wheel.js`) — no auth, no exec bubble. It is a **ferris wheel**: eleven sections as spokes on a ring seen edge-on, ordered by icon hue (`_LANDING_HUE_ORDER`), each showing its nav code (`_NAV_LABELS`), its own title (`_LANDING_BLURBS`) and one line saying what it is (`_LANDING_DESCS`). Scroll, drag/swipe, or arrow-key it; tapping a lit item turns the wheel to that slot first, then follows the link. Logged-in admins (valid `session` cookie) skip the landing and 302 to `/rd`; an `admin` link sits bottom-right → `/login`; clicking a section follows the 401 redirect to the right login. The geometry solves itself at the viewport it is being viewed at (`wheelGeometry`) — do not hard-code slot counts.


---

## 10. The CRT effect stack (`_CRT_FX`)

Current design: [ARCHITECTURE.md §10](ARCHITECTURE.md).

**Tint, 2026-09-21.** The phosphor read heavy on every page, so it was dialled TOWARDS WHITE: saturation −40 and lightness +25 off `--cat-social` (125 55% 68% → ~125 15% 93%), written as `calc()` on those channels — the idiom `--card-social-plan` already uses, which keeps it on the palette with no new colour literal and no baseline to regenerate. The lesson is that **opacity and hue are different knobs**: the first attempt dropped the stripe's alpha from 0.45 to 0.25 and pulled the contrast filter back with it, which makes the scanlines fainter while leaving them exactly as green. Both are back where they were.

**The measurements behind that.** The glass was removed 2026-08-30: back then it sat UNDER the sweep, took ~45% of frame time at **1131ms/frame** in WebKit, and the page filled in **top-to-bottom** because the engine could not finish a viewport in one vsync. It was **reinstated 2026-08-31** with the scan-above-glass fix, and re-measured live at 430×932: WebKit steady-state is **16.9ms/frame WITH the glass vs 16.5ms without** — 60fps, the blur adding ~0.4ms, which is the proof that a static backdrop caches.

Also gone since 2026-08-30 and not coming back: `plus-lighter` on `.cyber-bg`, `overlay` on `.cyber-scan`.

Merging `.cyber-bg` INTO `.cyber-lines` as one hard-light element buys ~42ms more in WebKit but was **rejected**: one blend pass cannot compound the way two do, and the scanlines flatten out over text.

The `.cyber-crt` punch was tuned 2026-08-31 from `brightness(1.03) contrast(1.1)` to a **multiply feel**: `brightness < 1` darkens the unlit ground, and high `contrast` (pivot 0.5) crushes the sub-midpoint green haze toward black while the bright green text clamps at max — unlit MUCH darker, lit text held. It is a filter, not a colour, so it pops the phosphor greens and deepens the blacks without touching the palette, and it caches exactly like the glass because its backdrop never animates. Over the sweep it would re-fire every frame, the same trap.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Login screens (2026-09-21).** `/login` builds from the raw static shell and `/guest` from the bare one, so neither was picking up `_CRT_FX`; added then.
- **Phosphor dialled toward white (2026-09-21).** Saturation −40 and lightness +25 off `--cat-social` (125 55% 68% → ~125 15% 93%), via the same `calc()`-on-channels idiom `--card-social-plan` uses. The first attempt dropped the stripe's alpha to 0.25 instead, which made the scanlines fainter while leaving them exactly as green; alphas are back at 0.45/0.06. The punch's contrast went 1.5 → 1.25 in a comment trail then back; the shipped values are 0.85/1.5.
- **Scanline shoulder** widened 0.25px → 0.75px 2026-08-31 (the hairline read too faint); a brief bump to full-opacity black was reverted.
- **Blend layers.** `.cyber-bg` was `plus-lighter`, the sweep `overlay`; three full-viewport blend layers cost 3x baseline frame time and a blend on the sweep cost 110ms/frame in WebKit alone. Both are now plain alpha; `.cyber-lines` is the one blend layer left.
- **Glass history.** The glass was the single most expensive thing on the site (233ms/frame WebKit, ~45% of frame time) and was removed 2026-08-30 because it sat UNDER the animated sweep; reinstated 2026-08-31 above bg+lines with the sweep above it (idle readback cost 0).
- **CRT lite measurement (Chromium `--disable-gpu`, 4x CPU throttle, 2026-10-06, on `/`).** 1440x900 baseline 5fps idle / 6fps spinning, 430x932 15fps; without the panes + sweep 60fps at both widths. The blend layer and the wheel's per-item blur/text-shadow were each measured and are NOT the cost. A GPU machine measures ~16ms and keeps the full stack.
- **Dim history.** `/rd`, `/hq` were pushed behind content at `z-index:-1` (taking the in-the-CRT look off the boards), restored to the top at 0.5 on 2026-09-07, `/mtg` joined 2026-09-11 (so did the `/cc` page, folded 2026-09-29), and the dim went 0.5 → 0.75. Previously the same three lines lived in both rd.css and hq.css. Half of 0.45 is 0.225 and three quarters 0.3375 — off the snap scale, hence `opacity`.
- `.exec-nav` has a boot-in stagger honoring `prefers-reduced-motion`; icons scale on hover.

### 10-notes. From CLAUDE.md (moved 2026-09-27) — verbatim

**[Web app → CRT stack]**

Cyberpunk fx — the shared CRT stack `_CRT_FX`, **five** fixed `pointer-events:none` layers injected by `_render_page`/landing/graph, all at `--z-modal`: `.cyber-bg` (phosphor) · `.cyber-lines` (static black scanlines, `hard-light`, the ONE blend layer) · `.cyber-blur` (glass, `backdrop-filter: blur()`) · `.cyber-crt` (phosphor punch, `backdrop-filter: brightness/contrast`) · `.cyber-scan` (the sweep beam, the ONE animated layer). **Paint order = DOM order — `bg → lines → blur → crt → scan` — is load-bearing.** The invariant, and the most expensive rule in this repo to rediscover: **a `backdrop-filter`/`mix-blend-mode` layer is a full-viewport readback with no partial invalidation — cheap ONLY when nothing under it animates (the compositor caches the texture), ruinous when it sits OVER an animated layer (it re-fires every frame, forever).** So: do NOT put a `backdrop-filter`/`mix-blend-mode` layer UNDER an animated one, do NOT give `.cyber-scan` a blend mode, and do not animate anything that sits beneath the glass (that is what froze the old `/cc` page in voice mode). The dense text-heavy pages (`/rd`, `/hq`, `/mtg`) keep all five on top but **dimmed to 0.75** via the shared `web/crt-dim.css` — dimmed with `opacity`, never by rescaling the gradient alphas, which would land off the palette snap scale and be lint-rejected. `/tarot` stays at full strength. **The phosphor was dialled TOWARDS WHITE 2026-09-21** — saturation −40 and lightness +25 off `--cat-social` (125 55% 68% → ~125 15% 93%), via the same `calc()`-on-channels idiom `--card-social-plan` uses, so it stays on the palette with no new literal and no baseline to regenerate. **Opacity and hue are different knobs**: the first attempt dropped the stripe's alpha to 0.25 instead, which makes the scanlines fainter while leaving them exactly as green. Alphas are back at `0.45`/`0.06` where they belong. **Both login screens now carry the stack too**: `/login` builds from the raw static shell and `/guest` from the bare one, so neither was picking up `_CRT_FX`; the layers are fixed, `pointer-events:none` and at `--z-modal`, so they sit over the form without taking a click off it. `.exec-nav` sits at `--z-top`, above the fx. Zoom-lock lives in `web/crt-zoom.js` (`--crt-scale`).


---

## 11. `/graph`

**Node rotation was removed after three attempts (2026-09-24).** "Get rid of the shape rotation
it's fucked."

The feature was: the instant before a big node throws a wavefront, turn its shape a quarter, half or
three quarters. The obstacle was never the rotation itself — it is a few lines of vertex arithmetic —
but that vis draws its OWN copy of every node, at the original angle, on a canvas one layer below
the overlay. The overlay cannot erase that canvas, and with physics off vis never redraws it, so the
copy is baked. Re-orienting it would mean forcing a full redraw of the graph, about 100ms, on every
rotation — once a beat.

So every attempt was a way of COVERING vis's copy, and each failed on the same fact in a different
disguise:

1. Fill both orientations in the opaque punch. The punch runs after the halos, so it cut a hole in
   the glow instead of covering anything, and the union of an up- and a down-triangle is a hexagram.
   Reported as doubled shapes.
2. Fill only the rotated orientation. No hole, but vis's copy then showed wherever it protruded past
   the rotated glyph — a visible rim of its own border, not the hairline that reasoning predicted,
   because the border is 2px wide and CENTRED on its path so a pixel of it lies outside the glyph
   that was supposed to contain it.
3. Fill the unrotated orientation FIRST, before the halos, so the halo paints over the cover rather
   than being cut by it. This is actually correct and would have worked. It was abandoned because
   the feature had by then cost three rounds and the owner called it.

Worth keeping for the general shape: an effect that needs two layers to agree is only as good as the
layer you do not control. The wavefront's own rotation stayed, and costs nothing, precisely because
nothing on vis's canvas corresponds to it.

**Punching two orientations cut a hexagram out of the halo (2026-09-24).** Reported twice, the
second time as *why are the node shapes still doubled up after rotation*.

A node that turns before throwing a wavefront is drawn rotated by the overlay, while vis draws its
own copy at the original angle on a canvas a layer down that the overlay cannot erase. The fix
attempted was to fill BOTH orientations in the opaque punch, so the rotated fill would cover vis's
copy too, and the commit justified the extra area as costing nothing "being the page background over
the page background".

That sentence was the whole error, and it survived a round of fixing the page background because the
background was genuinely also wrong. The punch does not land on the page. It lands on the node's own
HALO — two soft discs out to 2.6x the glyph radius, drawn on this same canvas a few passes earlier —
so the fill cuts a hole in the glow, and the hole is shaped like exactly what was filled. An up- and
a down-triangle about one centre make a hexagram, and a hexagram-shaped hole in a glowing disc reads
as two triangles. Looking at a zoomed screenshot with the CRT layers hidden showed it in one glance,
after two rounds of reasoning about it had produced two wrong answers.

Punching one shape — the node's current orientation — makes the hole match the outline drawn over
it. What it leaves is vis's copy still sitting under the halo where it protrudes, which is a hairline
of a 0.2-alpha border under an additive glow rather than a second shape. Removing that too would
mean re-orienting vis's own node, and with physics off vis's canvas is static, so that is a full
redraw of the graph (~100ms) on every rotation, once a beat. Not worth it.

Verified structurally rather than by eye, because eyes had already been wrong twice here: wrap
`graphGlyph.path`, record the `turn` every glyph is built with over a frame, and check that no node
appears at two orientations. Zero turn is now absent from a frame entirely.

**The node fill was never the page background, and it showed up as duplicated nodes
(2026-09-24).** Reported as *the nodes themselves are duplicated, not the waves*.

`graph_style._GRAPH_BG` was `#0f0f1a`, and the comment above it called that "graph.html body bg".
That was true of graphify's own emitted page and stopped being true the moment `/graph` started
injecting chrome.css over it. This site's `--bg-hsl` is `0 0% 0%` — measured `rgb(0, 0, 0)`, pure
black — so the fill was a dark NAVY, and every node interior it painted was a visible shape on a
black page rather than a hole in the overlay.

It went unnoticed for as long as it did because a single navy triangle behind a coloured outline
just looks like a node. What made it visible was the rotation: a node that turns before throwing a
wavefront has BOTH orientations filled, because vis draws its own unrotated copy on a lower canvas
that the overlay cannot erase, so the only way to hide that copy is to cover it. The union of an up-
and a down-triangle is a hexagram — invisible if the fill matches the page, and two overlapping
triangles if it does not. The claim in that commit that punching both orientations "costs nothing
visually, being the page background over the page background" was exactly right and exactly the
assumption that was false.

Fixed at both ends. `_GRAPH_BG` is `#000000` for vis's unlit layer, which has nothing to fall back
on, and `web/graph-surface.js` reads the overlay's fill from `getComputedStyle(document.body)` —
which cannot drift the way a literal or a data field can, because it IS the thing being matched.
Verified by sampling the canvas pixel at the centre of the largest hub: `[0, 0, 0, 255]`, where it
had been `[15, 15, 26]`.

Both incidents on this value have the same shape: a fill that must equal something else was stored
as its own copy of that something, and the copy went stale in a different way each time. The
occlusion pass is only correct when it reads the thing it is trying to match.

**`setBg('transparent')` silently switched off node occlusion (2026-09-24).** Reported as *the
centre of big nodes is getting bright*.

`graph-pulse-draw.js` reads the page background off real node data rather than holding a second
literal — `graphPulseDraw.setBg(n.color.background)` — guarded by `if (n.color.background)`. That
guard was correct until `graph_geometry._unocclude_small_nodes` started writing the string
`"transparent"` onto every node under the size percentile, which at `_OCCLUDE_PCTL` 0.80 is four
fifths of them. `"transparent"` is TRUTHY, so the guard accepted it and whichever node the index
loop visited last decided the value. `BG` became `"transparent"`, `punchNodes` filled with it,
`source-over` with a fully transparent fill paints nothing, and the pass that makes a node occlude
the edges behind it became a silent no-op.

The symptom pointed away from the cause. Nothing looked broken at small nodes — they are not
supposed to occlude — and the visible failure was at the HUBS, whose lit edges all converge on one
point, so with no opaque fill over them they summed under `'lighter'` into a bright core. It read as
a glow bug, not as a missing fill.

Two things fixed it. `setBg` now rejects `transparent` as well as empty, and it is the SINGLE gate —
`graph-pulse.js` passes the value straight through instead of holding a second opinion about which
values are acceptable. Verified by sampling the canvas pixel at the centre of the largest hub with
40 neighbours lit and their edges fired: `[15, 15, 26, 255]`, exactly `#0f0f1a` at full opacity.

The general lesson is about DATA whose meaning changed under a reader that was written before it: a
falsy check is not a validity check, and a sentinel added at one end of a pipeline needs every
consumer re-read, not just the one that motivated it.


Current design: [ARCHITECTURE.md §11](ARCHITECTURE.md).

**The first thing painted is the loading bar** (2026-09-22). Two things stood between a visitor and that bar, and only one of them was obvious. The cover was built by `graph-overlay.js`, which is injected before `</body>`; serving it as static markup at the top of `<body>` (`_GRAPH_BOOT`) fixes the document ORDER but not the paint, because graphify emits its entire dataset as one ~2.1MB **inline** `<script>` right after it. An inline script cannot carry `defer`, and a script executing is a main thread with no rendering opportunity in it — so the browser parsed the cover and then sat in that block for a second before painting anything at all. Measured on the served page: `responseStart` 129ms, **first-contentful-paint 1304ms**, and none of the gap is transfer (133KB gzipped).

**A black /graph is a JS failure wearing a crash's clothes** (2026-09-22). `#graph` is `opacity: 0` until `body.gp-loaded` lifts it, so every path that does not reach `reveal()` shows the same thing: a black page. Reported from a phone as *nothing happens when I tap GPH, then the page goes black* — with the visuals turning up around three minutes later, which is what ruled out a crashed tab and made it a slow load nobody could see the inside of. The failsafe at the time was **120s**, so even the recovery was two minutes of black.

**Three failures that only ever showed on a phone** (2026-09-22), found by asking what the screen actually did rather than by reproducing them — none of them reproduce on the droplet's headless WebKit.

**A black page after switching tabs and coming back** was `watchSleep` reloading the document. It ran a 10s interval and treated a tick landing >60s late as "the device slept", on the reasoning that a canvas comes back wedged from a suspend. iOS freezes a backgrounded tab within seconds, so switching apps and returning tripped it EVERY time, and a reload of /graph is a black screen for the whole load (opacity 0 until `gp-loaded`) — which is how a slow load came to be reported as a crash. The old comment already recorded the same shape of bug on the droplet: a reload landing in another stabilisation, tripping it again. It is now `watchWake`, hung on `visibilitychange` and a `persisted` `pageshow` — the events that actually mean *you are back* — and it REPAIRS instead of reloading: `graphPulseDraw.resize()` re-measures the backing store, `network.redraw()` repaints. That is the entire recovery the reload was buying, minus the document.

**A finished page that would not take a tap.** `graphPulse.init()` now returns early on `(pointer: coarse)`. The cascade is the only animated layer on the page and it sits UNDER the CRT stack's two `backdrop-filter` layers — §10's most expensive rule: a backdrop-filter is a full-viewport readback with no partial invalidation, cheap only while nothing under it animates, ruinous when something does. 2fps against 18 measured here with the stack hidden; on a phone that is a main thread and compositor with nothing left over for touch. The stack stays and the cascade goes, and the order matters: the stack is the site's look on every page, while the cascade is /graph-only ambience that happens to be exactly what makes the stack expensive.

**Lag between tapping GPH and anything happening** was the response, not the page. The render is 1.7-2.9s of CPU and `_CACHE` is per-PROCESS, so every restart — routine under `--reload` — parked a cold render in front of whoever opened /graph next, and the tap sat there looking ignored. `run_graph_warm_loop` is a lifespan task beside the nudge loop: it renders both tiers at startup and re-warms whenever `(mtime_ns, size)` changes, which covers the 05:00 rebuild without a schedule of its own, and it swallows its own failures because the route still renders on demand. First request after a restart measured 6.5s (the warm and the request contending), steady state **0.046s**.

**The bar is a fraction of the work, and that is the second answer to the question.** The first was bytes: `graph-cover.js` fetches the payload itself (`window.GRAPH_BOOT_URL`, a streamed `fetch`, handed back as a Blob `<script src>` so the payload's top-level `const RAW_NODES` / `network` stay global bindings) instead of leaving it to a `<script defer src>`, which reports nothing until it is finished. Then the measurement came back: **WebKit returns all 2,204,421 bytes in ONE chunk**, so a byte-driven bar fires exactly once, at 100%, and correlates with nothing. A slower link does split it — which is the phone this is for and not the loopback it gets tested on — so bytes are kept where they appear, but they cannot be the whole bar.

So the bar is cut by phase, and every step is a real thing finishing: `FETCHED` 0.45 (payload down), `BUILT` 0.9 (it has executed — the injected script's `onload`, the only honest marker for that from outside), 1.0 at reveal. Inside the download it tracks bytes. Inside the BUILD it holds its width and **breathes** — `.gp-build`, an opacity keyframe — because opacity is a compositor property that keeps moving through a main thread blocked solid, while a JS-driven width freezes exactly when the page most needs to look alive. The marquee is now only for the phase before there is any position to hold.

Three things that only showed up by tracing the running page: the phase text ran BACKWARDS (`building the graph` then `fetching graph data`) while both `go()` and the loader wrote it — the loader owns it now; `indeterminate()` has to clear the inline width, or the marquee slides a FULL-WIDTH bar rather than a segment; and `X-Payload-Bytes` exists because `Content-Length` is the gzipped length while the reader yields decoded bytes. Since the page no longer carries a `<script src>` for the payload, three separate paths restore one: the fetch's `catch`, the injected script's `onerror`, and a 25s `RESCUE_MS` timer — plus a belt in graph-overlay.js for the case where graph-cover.js never ran at all.

**The cover lifts on a finished page, not an ordered one.** `reveal()` sat on the line after `moveTo`, which left two things in flight. `moveTo` sets the camera but does not paint at it, so the reveal uncovered the frame BEFORE the move and the graph jumped into position a beat later. And `graphPulse.init()` only wires the model up — the first cascade lights a moment afterwards, so the page arrived still and then twitched into life.

**One `moveNode` per node is one REDRAW per node, and that was the freeze.** `snapToGrid` wrote 2,722 positions through `network.moveNode`. That was already the cheap path — a DataSet bulk write fires vis's `_dataUpdated` cascade and rebuilds every physics body, 7.4s against 1.07s — but every call also asks vis to redraw, and **the draws it queues are invisible to a timer wrapped around the loop**. `place` reported 0.0s while the work it had just ordered ran on for seconds afterwards, which is precisely why the instrumentation exonerated the guilty step twice over.

Hooking `beforeDrawing`/`afterDrawing` is what found it: **160 draws, 16.1s of main thread, a median 93ms apart**, 130 of them before the cover lifted, each repainting a 3.36-megapixel canvas of 2,722 nodes. A thread that busy cannot run a timer, which is why the 3s reveal failsafe never fired and the page sat frozen with the bar at `drawing` — the exact state in the screenshot that reported it. Writing straight to `network.body.nodes[id].x/y` (guarded, falling back to `moveNode` on any vis that renames it) and calling `network.redraw()` once after the loop: **160 draws -> 4, 16,161ms -> 737ms**.

`graphPulse.index()` was chunked into four rAF-separated phases during the same hunt, and it was **not** the culprit — `nodes 22 / edges 5 / pos 7 / grid 54ms`, 88ms all told. The phases stay anyway: a thread that yields between them is what allows a failsafe to fire at all, and the per-phase numbers print in the cover line, which is how a device nobody here can profile gets to name its own slow step. The reveal gains `DRAWN_CAP` (800ms from vis's first painted frame) for the same reason — waiting for the first lit frame stays the intent, but it is no longer the only way out.

`CELLS_PER_NODE` moved **4 -> 9** in the same pass, on request: more points for each part of the graph to snap to. The cell is `sqrt(area / (n * CELLS_PER_NODE))`, so raising it makes the grid finer without moving the cloud's outline — 107x103 distinct coordinates against roughly 70x70 — every node lands nearer where the layout put it, and `nearestFree` walks less because there is more room beside each first choice.

**“Groups of four” was a moire: the layout was quantised twice.** Reported from a phone as nodes sitting in evenly spaced clusters of up to four, which looks like an arrangement somebody chose. `scripts/graph-layout.py` waits for `gp-loaded` and reads `network.getPositions()` — and `gp-loaded` comes after `snapToGrid`, so the nightly file held **already a lattice**: 107 distinct x values, gaps of 146/147, exactly `cell` at `CELLS_PER_NODE` 4. Every visit snapped that again at whatever cell was current, 97 at CPN 9, and **146/97 = 1.505**. Multiples of 146 rounded onto a 97 grid give indices 0, 2, 3, 5, 6, 8, 9: alternating wide and narrow gaps, in both axes at once, drawn as pairs and pairs of pairs.

`snapToGrid` publishes `window.__GP_PRESNAP` — the positions as the layout left them, before it quantises anything — and the baker reads that, falling back to `getPositions()` so a bake still works against an older page. **Snap once, at serve time**, against whatever density is current. Re-baked and measured: the file went from 107 distinct x values to **2,433** (gaps of 1, 2, 3, 4, 5), the rendered lattice to gaps of 99 x121 and 100 x25 with an occasional 198 or 298 where the graph is sparse, and the clump distribution from a hard cap at 4 to a natural tail (1220 singles, 223 pairs, down to one 107-node mass in the densest region).

**`_cached` keys on the layout file too, which fixes a day-long fault nobody had noticed.** The key was graph.html's `(mtime_ns, size)` alone, while the 05:00 cron rebuilds graphify FIRST and bakes after. A visit landing in that window cached a render made without a baked layout, and nothing invalidated it until the next rebuild twenty-four hours later — every visitor in between paying the ~30s browser stabilisation the bake exists to remove. A re-bake by hand had the same problem, which is how it surfaced.

**The physics gets another hundred iterations before it freezes.** `stabilization.iterations` went 220 -> 270 on 2026-09-21 and 270 -> **370** on 2026-09-22: the sim runs longer before `stabilizationIterationsDone` turns physics off and `snapToGrid` quantises what it left, so what gets frozen is a layout that has settled rather than one still drifting. Every one of those iterations now runs inside `scripts/graph-layout.py` — a normal serve gets physics off and the baked coordinates — so the bill is a nightly cron job's, measured **20.7s -> 29.1s**, and no visitor waits on any of it.

Worth knowing because it is the opposite of the drop passes: raising the iteration count invalidates NOTHING. `graph_layout_key` hashes surviving node ids and edge pairs, not coordinates, so the old bake still matches by key and goes on being served — the longer run changes nothing until the baker is actually re-run. Dropping nodes is the reverse: it changes the key, the bake misses instantly, and every visit pays the browser stabilisation until a re-bake. One needs a re-run to take effect; the other needs one to stop hurting.

**Shape carries a node's TYPE, colour carries its community.** `code` (1,955) is a hexagon, `rationale` (403) a triangle, `document` (223) a dot — `_TYPE_SHAPES` and `_shape_graph_nodes_by_type` (then in graph_style.py, since moved to graph_geometry.py; the shapes were later reassigned, see ARCHITECTURE.md §11a). It is `dot` and not `circle` even though a dot IS a circle, because vis splits its shapes into two families: `circle`, `ellipse`, `box` and `text` draw the label INSIDE and size themselves to it, ignoring `size` entirely, while `dot`, `hexagon`, `triangle`, `diamond`, `square` and `star` draw the label outside and take their size from `size`. Node size here is geometric in degree, which is the graph's primary encoding, so `circle` would have discarded it for every document and relocated their labels in the same move. The per-node `shape` must be named in graphify's DataSet mapper or it is dropped on the way in — the same explicit-field trap as the baked x/y — and the global `nodes: { shape: 'hexagon' }` stays as the fallback for a type this misses. The cascade's lit glyph follows the shape too (`glyph()` in graph-pulse-draw.js, since moved to `web/graph-glyph.js`), since lighting everything as a hexagon made a cascade misdescribe what it was crossing; the triangle draws at 1.15x radius because at equal circumradius it reads smaller than the hexagon beside it.

The opening view is `OPEN_ZOOM` **1.2** — renamed from `OPEN_ZOOM_OUT`, which at a value above 1 said the opposite of what it did. It multiplies the cover scale: 0.75 when the cloud was square and the window was not, 1 once the stretch made cover and contain the same number, and 1.2 on request, which crops roughly a sixth off each axis in exchange for nodes large enough to read. Measured at 430x867: the graph draws 513x1032, a 1.19x overflow both ways.

**The lattice keeps equal spacing on both axes, and that bounds what it can do about the viewport.** graphify's cloud is roughly square; the window rarely is. At 430x932 the camera opened on cover, filled the height and ran **2.08x the width** — a phone saw the middle strip of the graph and had to drag for the rest. `snapToGrid` did rescale every node into a box of the viewport's own aspect before snapping, which fitted the outline to the screen (0.50 -> 0.50 at 430x932, 1.72 -> 1.73 at 1280x800) and was **reverted**: square grid points with a stretched picture standing on them is the worst of both, because a force layout means something by distance and scaling one axis alone rewrites that meaning. The map is uniform now — a single `k` applied to x and y — so the step between adjacent lattice points is identical on both axes (measured 97 and 97).

What that costs is the thing it was reaching for. With a uniform scale the grid's row-to-column ratio follows the CLOUD's aspect, not the window's: **107x103 on a 0.50 phone and on a 1.72 desktop alike**. A roughly square cloud cannot become a tall one without either stretching it or moving nodes relative to each other, and both of those rewrite the layout. The camera takes the slack instead. Getting a genuinely tall, undistorted layout means computing it tall — baking a second layout at a phone's aspect in `scripts/graph-layout.py` — not reshaping a wide one after the fact.

Wiring that up surfaced a bug in the size gate from the commit before: `var many = Object.keys(pos).length > AMBIENT_MAX_NODES` ran BEFORE `index()`, which is what fills `pos`. It was counting an empty object every time, so `many` was always false and the one case the gate exists for — a coarse pointer on the full 2,722-node graph — was never gated at all. It looked correct only because `_prune_for_lite` had already made the common case cheap. Verified in WebKit by reading lit pixels off the canvas: desktop ambient peak 261 / after a node click 295; phone (`has_touch`, coarse) ambient **0** / after a node tap 61.

**The reasoning that produced it —** iOS Safari froze on /graph: not a slow load, a FROZEN one, with the nav bar unable to take a tap — the signature of a main thread that never came back, not of a graph that failed to arrive. Everything tried before it (the static cover, the deferred payload, the DPR cap, the pulse gate, the wake repair) made the wait cheaper, better reported, or better behaved, and not one of them made the page do less: 2,722 nodes with 3,582 edges is a page a laptop draws and a phone dies on.

vis's `fit()` is CONTAIN: it scales until the limiting axis fits and leaves the other as empty margin, which on this near-square cloud in a wide window was two black bands with the graph sitting in the middle distance. `nodeBounds()` returns both scales and the page takes **`cover`** = `max(W/w, H/h)`, so neither edge has a gap and the cloud runs off the axis that is not limiting. It is centred on the node bounding box, so the overflow is shared evenly rather than landing all at one end. Measured: 1280×744 opens at 0.0883, cloud width exactly 1.00× the window and height 1.80×; 430×876 opens at 0.0593, height exactly 1.00× and width 2.08×. A wide window fills to width and crops top/bottom; a phone fills to height and crops left/right. **Every node is SNAPPED to a lattice first** (`snapToGrid`, 2026-09-21). The cell is `sqrt(area / (n x CELLS_PER_NODE))` over the cloud's bounding box — 4 cells per node, so most land on their first choice — and a taken cell sends the node ring-searching outward for the nearest free one, compared on real distance within a ring since a ring is a square and its corners are further than its edges. Placement is CENTRE-OUT so the crowded middle claims its own cells before the sparse rim pushes in, which keeps the walk short instead of cascading through the core. Measured on 2722 nodes: a 138-unit cell, 107x103 lattice, 2722 distinct points, zero overlaps. It writes with `network.moveNode`, never a DataSet update — a bulk write fires vis's `_dataUpdated` cascade and rebuilds every physics body. The camera bounds are recomputed after it, since the snap moves everything. **Then it backs off a quarter** (`OPEN_ZOOM_OUT` 0.75, 2026-09-21): cover alone runs the cloud to both edges, and a graph with no margin reads as cropped rather than as filling the frame. Note that at the opening scale (~0.046 on a 900px canvas) a node draws sub-pixel and vis gives it NO hit area — `getNodeAt` finds nothing anywhere on the canvas, so clicking a node means zooming in first. Worth knowing before testing a click by hand: it looks exactly like a broken click handler.

It replaced an `OPEN_ZOOM` of 1.25× applied on top of `fit()` — cover is already about 1.8× contain on a desktop window, so stacking the two would have over-cropped. The zoom-OUT wall stays on CONTAIN × `FIT_MARGIN` (0.8), deliberately looser than the cover the page opens at, so zooming out until every node is on screen at once is still allowed. It used to cap the viewport at half the node-cloud's area, which the opening view violates on arrival.

#### The tour kept its job and lost its mechanism, twice

The original overlay ran a **camera tour** — pick a random cluster every 10s, `network.focus()` its highest-degree node, and random-walk the gravitational constant to keep the layout "breathing" — behind a top-left **freeze | tour** segmented toggle. To do that it **re-enabled physics after graphify had already turned it off**, which left a 4.5k-node canvas running a force sim and redrawing every frame, forever. Measured: **0.4 fps, with 4.2-second frames**.

What was wrong with it was the camera, not the cycling. Flying to a cluster shows you that cluster and throws away the graph it came from; you arrive somewhere with no idea where you are. So the tour cycles as before and lights its stop **in place**, and the freeze toggle is gone outright — physics off is the only state. **The physics configurator panel went too** (2026-09-21), along with every `vis-configuration` rule that themed it: a strip of live sliders governs nothing once the sim is off for good, and a reload undoes whatever they were dragged to. The node-info panel on the right is the only panel left.

#### Why nothing writes to the DataSets, or to `network.body` either

An earlier hover-highlight mutated vis's drawn node objects and called `network.redraw()`. That was already the fast path — measured on the droplet's headless WebKit, for a ~30-node neighbourhood:

| Path | Cost |
|---|---|
| `nodesDS.update()` + `edgesDS.update()` | **7.4s** |
| direct `body.nodes[id].setOptions()` + one `network.redraw()` | **1.07s** |

A DataSet write fires vis's whole `_dataUpdated` cascade — visible-index rebuild, **physics-body rebuild for all 4.5k nodes and 6.5k edges** — on a graph whose physics is switched off and will never run again.

But 1.07s is a *hover*, not a *frame*. Once the tour had to animate, even the fast path was a full graph redraw 60 times a second, so the overlay took over and vis's canvas is now left completely alone. The DataSets stay pristine as the source of truth the overlay indexes at startup.

#### What a redraw costs, and what that means

A warm full redraw of the served graph, on the droplet's headless WebKit (no GPU, shared core — the pessimistic end; a phone or desktop is several times quicker):

| | ms |
|---|---|
| first redraw after stabilisation (cold: label measurement, shape caching) | ~8300 |
| warm redraw, nodes + edges | ~1500 |
| nodes only (edges hidden) | ~717 |
| edges only (nodes hidden) | ~539 |
| arrowheads disabled | ~1463 — **no saving; arrows stay** |

Redraw cost tracks the primitive count almost linearly and splits roughly evenly between nodes and edges, which is why the answer to "rendering is slow" is *draw fewer things* (11b) rather than *draw them cheaper* — and why the firing animation had to move off this canvas entirely. Those numbers were taken at 4561 nodes / 6501 edges; the graph is 2722 / 3582 now, so scale them by about 0.57.

---

**Seeds were drawn from a 16-square positional lattice until 2026-09-24.**
`partition()` cut the node cloud's bounding box into a `GRID`x`GRID` (4x4)
lattice, filed every node under one square at index time with its own weighted
prefix sum, and an iteration drew its extra seeds from the FIRST seed's own
square. It was cheap and it quantised, in three ways that all have the same
shape: a seed near a boundary could only draw inward, two seeds a pixel apart on
either side of a boundary got completely disjoint pools, and the same 16 regions
recurred for the life of the page. Replaced by a draw over the 64 nearest nodes
to the seed, which has no seams and needs no bookkeeping — the layout is frozen,
so one pass over ~2.8k nodes costs a few hundred microseconds a few times a
second. `GRID`, `cells`, `cellOf` and `partition()` went with it.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

(Moved out of ARCHITECTURE.md §11 / 11a–11e during the 2026-10-15 concision pass. Prose is verbatim or lightly trimmed. Items marked STALE no longer exist in source.)

### 11 (intro)

Guest-gated (Turnstile; it was public until 2026-07-03). `graph_page()` was split out of routes_views into `routes_graph.py` on 2026-08-30 for the 500-line cap.

### 11a. Applied per request, COMPUTED once per artifact

The pipeline chews a 3.6MB string through ten json round-trips. Measured on the droplet, that was **2.5–2.9s of CPU on every single page load** — the page's whole "slow to load" reputation, before a byte reached the browser (gzip takes the response to ~170KB, so the wire was never the problem).

`_cached()` objection answered: *"the graph is constantly regenerated, so it can't be cached"* has the invalidation backwards: it is regenerated ONCE A DAY by the 05:00 cron, and an mtime key is correct at any rebuild frequency because the next request after a write misses. A stale render cannot outlive its source.

The layout file joined the cache key after a day-long failure: the 05:00 cron rebuilds graphify (new graph.html, cache dropped) and only then runs `scripts/graph-layout.py`, so any visit in that window cached a render made WITHOUT a layout, and nothing invalidated it until the next rebuild — every visitor paid the ~30s browser stabilisation. A hand re-bake had the same problem.

`_externalise_boot` lifts every inline `<body>` script into ONE external file, content hash in `?v=` so the middleware stamps it `immutable`: 2.1MB of JS that changes once a day. `_defer_scripts` then marks every same-origin src tag `defer`. The fetch the parser now waits on is the rendering opportunity the cover needed. **FCP 1304ms → 387ms**, page shell 2.21MB → 9.3KB.

**It runs LAST in `_render`, and that is not a style preference.** Extracting first — the version this was written as — left every scrub/drop/merge/restyle/stats rewrite operating on a 9KB shell: they silently did nothing, the layout key came back EMPTY (every visit fell back to the ~30s browser stabilisation), and the payload served to the browser was the raw artifact with **no redaction**. Caught by checking the served payload rather than the served page: 2,722 nodes / 3,582 edges / 14 communities with x/y baked, and zero occurrences of the dropped prefixes.

**The bar moves from the first frame.** Until vis can report a real fraction there is nothing to report, so the track is served with `.gp-indet` — an indeterminate marquee — and `graph-overlay.js` adopts the existing element and drops that class on its first progress call or at reveal. A sliding segment claims only "working"; the fixed 3s fill this file replaced claimed a fraction it did not have.

The cover is its own file, `web/graph-cover.js` (`gpCover`, split from graph-overlay.js at the 500-line cap, same global scope, loaded first). It is the one script on the page that is **not** deferred: deferred, it ran after the payload it exists to report on, and the phase line's first words were `drawing` — after the slow part had already happened. What it reports:
- **The phase**, named: `fetching graph data` -> `building the graph` -> `drawing`, with seconds once there are at least three of them (a counter that opens at 0s makes a fast load look like a stopwatch).
- **The split the payload measures on itself.** `_externalise_boot` brackets the payload with `__GP_PAYLOAD_START`/`__GP_PAYLOAD_MS`, so the line reads `· data 0.9s · build 1.0s`. The marks are written BY the payload: through the build the main thread is blocked solid and a ticking clock measures nothing, while two timestamps taken either side survive it.
- **`(slower than usual)`** past 20s, and on a thrown error, or a payload that never arrives, `[ <reason> — reload to retry ]` with the cover lifted so the nav underneath is reachable. A global `error` listener and a `try/catch` around `go()` both land there, because opacity 0 is forever otherwise.
- The hard cap is **180s** and only calls it failure when `network` never appeared; otherwise it lifts the cover on whatever there is. A cap that fires while the page is genuinely working replaces a slow graph with a broken-looking one.

`#gp-pulse` caps its backing store at **DPR 2** in the same pass: on a DPR-3 phone it was a 1290x2628 buffer (12.9MB) composited under the CRT stack every frame, against 5.7MB. Measured warm after all of it, at 430x932 DPR 3: FCP **384ms**, revealed **2318ms**, no page errors.

**Tapping a node fires a cascade seeded on it** (`graphPulse.seed(id)`, wired to vis's `click`; graph.html's own handler still opens the node panel). It is the ordinary iteration with its seed chosen instead of drawn. Only the SEEDING clock is ever gated, never the rAF loop — an idle frame paints nothing, so the backdrop-filter readback never re-fires.

**Both ambient gates are gone as of the lite revert — `auto` is never set false today** (STALE: `AMBIENT_MAX_NODES` (1200) no longer exists in web/graph-*.js). The second read: `auto` is false only when a coarse pointer draws more than `AMBIENT_MAX_NODES`. The first read `(pointer: coarse)` alone, and that was wrong twice over. The cost was never the finger: it was 2,722 nodes lighting every frame under two backdrop-filter layers, and the lite variant already removed that. More to the point, **the cascade is what this page is**. Turning it off to protect the phone produced the report it was meant to fix — "page still freezes on safari mobile", which on asking meant *no animations*, not an unresponsive page. A still graph reads as a dead one.

`openView` waits for both: vis's own `afterDrawing` (camera-correct frame on screen), then the pulse's first PAINTED frame, reported through `graphPulse.init(onReady)` — fired from inside the draw call, because init returning only means the model exists. `network.redraw()` is called explicitly after `moveTo` in case the camera did not change. `READY_CAP` (3s) is armed BEFORE either wait and lifts unconditionally. Where nothing will ever paint by itself (`auto` off), `onReady` fires at once.

**A tap guarantees its first hop.** `advance()` lights a neighbour only on `Math.random() < catchOdds(id)`, and `fireEdge` sits inside that branch — so tapping a hub, whose neighbours are mostly degree-1 leaves at `TERMINAL_ODDS` 0.15, lit the node and almost nothing else. A `force` flag on the queued hop lights it without rolling, set only on the first ring out of a tapped node and never passed on. A tap also seeds none of the extra `SEEDS_PER_ITER` draws (they make an ambient iteration read as a REGION waking up; on a tap they would bury the answer under eight unrelated nodes). Measured on a degree-157 hub: lit pixels 896 ambient, **1842** after the tap.

**Community packing (`?pack=1`).** Each of the 14 communities moves as a RIGID tile — translation only, never scaling — shelf-packed into a box of the viewport's aspect, because vis's physics runs in world coordinates and ignores the viewport (baking in a tall window changes nothing) and scaling an axis is the squish. Measured at 430x932: **117 columns x 218 rows**, step 350 on both axes, cloud aspect 0.53 against a 0.50 viewport. Off by default: nothing inside a community moves, but where the communities sit relative to each other is dealt out again, and it reads as a different graph. `cell` is sized from the cloud BEFORE packing — letting the gaps between tiles coarsen the grid took the step from 97 to 350, which is exactly what makes nodes collide and clump. It feeds the achieved aspect back into the target four times (0.51 against a 0.49 phone).

**Shape reassignment, 2026-09-23.** `code` (2,078, 74%) upward triangle, `rationale` (462, 16%) hexagon, `document` (262, 9%) downward triangle. It got there in two steps — rotated one place (hexagon -> triangleDown -> triangle -> hexagon), then the two triangle directions swapped back — so against the previous table `code` and `rationale` traded shapes while `document` kept its downward triangle. The two triangle directions read as a related pair against the one hexagon, the reason `dot` is not in the table. The global `nodes: { shape }` tracks the MAJORITY type (`triangle` now, `hexagon` before the rotation), so an unknown type has always drawn like `code`. The cascade's lit glyph follows the shape (`web/graph-glyph.js`) because lighting everything as one shape made a cascade misdescribe what it was crossing; triangles draw at 1.15x radius and shifted, because that is what vis itself does (`triangle: y += 0.275 * (size *= 1.15)`, `triangleDown: y -= 0.275 * …`) — the overlay agrees with the renderer it paints over.

vis shape families: `circle`, `ellipse`, `box`, `text` draw the label INSIDE and size themselves to it, ignoring `size`; `dot`, `hexagon`, `triangle`, `triangleDown`, `diamond`, `square`, `star` draw the label outside and take `size`. Node size is geometric in degree, the primary encoding, so the first family would discard it.

**Two bakes, one per shape, because vis has no per-axis gravity.** Checked in the vendored 9.1.9 bundle: the only knobs are `centralGravity` (single scalar) and `gravitationalConstant`, both isotropic, no per-tick force hook. `scripts/graph-layout.py` imposes a shape on the SIM instead: on every `stabilizationProgress` it squeezes the cloud a few percent toward a target aspect and lets the next interval's springs relax against it. What comes out is a layout the forces agreed to at that shape — edges re-balance instead of being multiplied. It undershoots: **wide targets 1.60 and reaches 1.25, tall targets 0.50 and reaches 0.74**. Still worth it — a 0.49 phone picks the tall bake and `stretchToViewport` covers 0.72 -> 0.49 rather than 1.6 -> 0.49, roughly a third of the distortion. The tall set rides in the payload (~50KB of coordinates on the 9KB `no-cache` shell would be paid every load). `useBakedAspect` picks on log distance (0.5 and 2.0 equally far from 1) and applies all-or-nothing: a half-applied layout draws as two clouds overlapping.

**`__GP_PRESNAP` moved to the top of `snapToGrid`.** It was captured after the stretch, so the file held a cloud already pulled to the bake window's 1.6 and every client stretched that AGAIN. The served ratio still came out right (the stretch recomputes from the bbox), but the distortion compounded silently — the same class of bug as the moire.

**`centreBesidePanel`.** The node info panel covers the right, so centring on the canvas centre puts the node under the panel; the camera moves so the node lands at `(W - panel) / 2`. The correction is MEASURED (open-loop assumed the node starts at the canvas centre and landed 156px out). It runs on the next frame, **without animation**: every animated frame is a full vis redraw of 2,581 nodes at ~100ms, so a 200ms animated pan was still travelling 2.1s after the click with the hub's cascade competing. The camera is moved before the cascade is seeded.

**Bar easing.** The steps are real events and discrete, so the fill snapped. `transition: width 280ms ease-out` smooths how each step is drawn while leaving what it claims untouched. Filling the gaps with a timed creep was the obvious alternative and is what this file already removed once (a flat 3s fill sat full while the layout kept settling — slowing a lie down does not make it true). The marquee sets `transition: none` because its segment moves by transform. Measured: 0.28s on the fill, intermediate widths (89, 92, 152, 228px) sampled at 30ms.

**Small islands.** `_drop_graph_small_islands` walks connected components and cuts every one under `min_size` (5). At the opening zoom they are specks around the rim, and each costs a payload entry, a DataSet row and a lattice cell. Orphans are components of size 1, so this subsumes them; it still runs second because the cheaper pass shrinks the graph this one walks. Served: **2,722 -> 2,581 nodes, 3,582 -> 3,482 edges**, 137 components, smallest exactly 5, all 14 communities intact (424 down to 69).

**Bake invalidation observed.** The page reported key `fd0e2d07…` against a file holding `d43d7ddd…`; re-running `scripts/graph-layout.py` took 20.7s and restored it.

**Opening zoom history.** The opening view was `OPEN_ZOOM` **1.2** (a fifth IN of cover, cropping roughly a sixth off each axis; 430x867: graph drew 513x1032); `OPEN_ZOOM` is gone: it now opens at `contain * FIT_MARGIN` (0.8), the identical expression `setupZoomLimits` clamps the outward wall to. `OPEN_ZOOM_OUT` went 0.75 -> 1 once cloud matched window (STALE: the constant no longer exists in web/graph-*.js) — a quarter out was how you got the shape back when cover cropped hard, and with nothing left to overflow it was only a border of empty black.

**Stretch then snap.** `stretchToViewport` scales x and y by different factors so the cloud takes the window's shape, preserving area (`boxW*boxH == w*h`) so `cell` and lattice density come out unchanged; `snapToGrid` then quantises with one `cell` on both axes. Measured: **98 columns x 199 rows at 430x932**, ratio 0.49 against 0.49, and **183 x 106 at 1280x800**, 1.73 against 1.72 — step 112 on both axes.

Two different things have been called squished here and only one of them is. The POSITIONS are reshaped (x and y scale differently, so distance no longer means quite what the force layout meant). The LATTICE is not: the step between adjacent points is identical horizontally and vertically (measured 97 and 97). Conflating the two sent this round-trip through a removal and a restoration. The ordering is forced: with one cell size, `cols/rows` is exactly the cloud's bbox aspect, so the cloud has to be reshaped before the snap runs. `nodeBounds` pads the box by the largest node radius (`pw`/`ph`) because the bbox is built from node CENTRES and filling the window against an unpadded box clips the outermost nodes down the middle. It distorts distances, knowingly: the trade is against a phone seeing less than half the picture, and the same trade the snap makes by quantising at all.

**The snap is not cached, and does not need to be.** It runs client-side on every load; the nightly bake records positions from BEFORE it (via `__GP_PRESNAP`). A phone re-lays its 600 lite survivors onto a lattice whose `cell` is **2.13x** coarser (`cell` derives from node COUNT). Both measured **0.0-0.1s**, which corrected the bar: the snap was the suspect for the pause a phone reported after the bar filled, and it is not the cost — the gap is vis's first full draw at the new camera plus `graphPulse.index()`. `openView` yields a macrotask after naming its phase, since setting text then blocking in the same turn paints neither.

**`?lite=1` history.** A smaller graph was served to phones by user-agent (`_MOBILE_UA`: `iPhone|iPod|Android.+Mobile`; iPad deliberately not matched) for a few hours on 2026-09-22, and the owner reverted it: the whole graph is the point of the page. The reason: 2,722 nodes made Safari on iOS freeze solid on load (nav unable to take a tap). Every other lever (first paint, deferred payload, DPR cap, pulse gate) made the WAIT better and none made the work smaller. `_prune_for_lite` keeps the busiest 600 by degree — this graph's shape IS its hubs, the tail is leaves hanging off a single parent. It runs AFTER `_apply_graph_layout` (same trap `_externalise_boot` fell into: pruning first would change the key, miss the bake, and give the weakest device the ~30s stabilisation). `_CACHE` was keyed `(guest, lite)` — four entries, all kept warm by `run_graph_warm_loop`; `/graph/boot.js` looks in both variants for an unknown hash. Measured, iPhone UA at 430x932 DPR 3: **0.49MB / 600 nodes / 929 edges**, against 2.10MB / 2,722 / 3,582 full, all 14 communities and every baked x/y intact. On the droplet the two load within 300ms of each other (1978ms vs 2273ms) — this box was never the device that froze. `?full=1` was the escape hatch while lite was the phone default (STALE: the server no longer reads it).

### 11b. Drops

Net (2026-09 measurement; the 2026-10-12 bake holds 4,949 nodes as the repo grew): 4843 nodes / 7154 edges / 610 communities as emitted → **2722 / 3582 / 14** as served — 56% of the nodes and half the edges are somebody else's code, a reference text, a data file's key names, or a relationship graphify was only guessing at.

Prefix rationale: `api/tarot/book/` ~110 nodes; `web/vendor/` ~150 (one per mangled minified name `Kv()`, `_f()`, `Le()`); `nightfall-incident/nightfall-src/` 1054 nodes — a quarter of the whole graph and the single biggest community; `api/data/` 786 — JSON KEY structure of rd.json, the gamesaves, cron logs, cc_titles.json (`numCredits`, `netmapStatus`, `at`, bare uuids). Keys only, never values, so never a leak. The `.graphifyignore` mirror of `api/data/` was added 2026-10-14 after `api/data/`'s spire-perflog alone grew to 6,644 nodes and pushed the build to 14,666 > 8,000, so graph.html was skipped. Hyperedges dropped with the book were narrative clusters like "First-row forces gathered into the Chariot's ego". The vendored bundle is also excluded at ingestion (`**/vendor/`, `*.min.js`) so fresh graphs never carry vendor nodes; the prefix is the serve-time backstop for a stale graph.html. The overlay used to `hidden`-flag orphan nodes client-side, which still parsed them, built them into the DataSet and walked them each redraw. After 2026-10-14 submodule files index as `apps/<name>/…` (the nightly of that date 05:00 predates the move; its graph.json still held `web/aspira*`, `api/noodle/`, `tests/test_{spire,noodle}*`).

### 11c. Communities

54 buckets at `_MIN_COMMUNITY`; raising the threshold plateaus around 20 because the long tail is whole top-level dirs, not small modules. Colour is only a legible encoding while a reader can hold the legend in their head; 28 shades past that point encode nothing.

### 11d. Size, labels, shape, physics, stats

Size: doubled from `min(44, 6 × …)` on 2026-09-21 because at the opening whole-graph fit the hexagons were specks, and a node you cannot see is a node nobody will hover. Replaced `_size_graph_by_loc()` (sqrt of line count, ~10..40), which compressed the interesting end flat. Degree distribution at pick time: median 1, p90 5, p99 21, max 171 — the range is spent on degrees 1–17 (97% of nodes). x1.25 (15..110) tried 2026-09-22 and reverted the same day: largest hubs measured 220 across against a 168 lattice step, sitting over their neighbours.

Edges: opacity was 0.7 / width 2 in graphify, 1.0 for a while, 0 for an afternoon (too far — nothing for a lit node to be lit AGAINST, the page read as empty not dark), now 0.2 / 3. A global `edges: { color: { opacity } }` did nothing — measured, a runtime override moved the canvas ink count by exactly zero.

Nodes: fill was `#0f0f1a` (graphify's own body colour) until it read as navy shapes on the real black page; once the overlay punched both triangle orientations to cover vis's unrotated copy, navy-on-black showed as a visible union and was reported as the nodes being DUPLICATED. `_OCCLUDE_PCTL` was `_SIZE_MAX / 2` for one commit — wrong denominator: sizes are geometric, so the range midpoint caught 82 of 2867 nodes (2.9%). It went to 0.80 on 2026-09-24 and back to 0.90 the same day as a DIAGNOSTIC (the cause was `setBg` accepting the string "transparent" and turning the occlusion pass into a no-op): 0.90 -> 0.80 moved the cut only 20.3 -> 15.6 while more than doubling the solid set, 261 -> 573 nodes. The occlusion cut and the wave cut started as one number and were separated because they answer different questions (being solid vs throwing a front, which at 300x fills the screen). Every node used to have an opaque interior, including degree-1 leaves (76% of the graph, at the size floor) — a notch cut out of the single edge running in.

Physics: constants were graph-overlay.js's old tuned set (applied AFTER graphify's own stabilisation, i.e. stabilising twice then simulating forever). Iteration count walked on 2026-09-22: 270 -> 370 -> 300 -> 325 -> 300; 325 moved the bakes by 0.06 and 0.01 because the springs pulling back against the squeeze limit them, not run length. The run is spent inside the nightly bake now, so another hundred is ~7s of a ~20s job. `updateInterval` is small so the run yields the main thread (vis runs each interval's iterations in one synchronous batch). A never-idle force sim measured 0.4 fps; curved edges cost a bezier per edge per frame, the most expensive thing on the canvas at 6k edges. Stats header example: "56 communities" when 8 are rendered.

### 11e. Baked layout

Stabilising is ~300 forceAtlas2 iterations over 2581 nodes; on a phone it measured around thirty seconds on every visit. Baked layout measured at 430x932: **8.8s to ready, down from ~30s**, no node at the origin. `graph-layout.json` ~470KB at 4,949 nodes. `graphify-out` gitignored since 2026-10-12. The `systemd-run --user` bus failure was found by testing: the bake would have taken its failure branch every night while looking fine by hand. WebKit launch 200-400MB against ~650MB free at rest.

### 11f. The client-side overlay (history moved out of ARCHITECTURE.md, 2026-10-15)

#### Cascade tuning stories
- Seed weighting: strictly size-proportional looked like nothing happening (76% of nodes are size-floor, one-edge leaves; 9 seeds in 10 landed on a leaf that lit itself, rolled its one neighbour and stopped) -> `SEED_POW` 2. Seeds scattered anywhere in a hairball read as unrelated sparks; eight inside one proximity pool read as a region waking up. Proximity replaced a 16-square positional lattice that quantised at its boundaries.
- Stagger: eight hexagons on one frame = flashbulb; the same eight over 0.8s = a region coming awake. At 100ms each a 48-seed burst would take 4.8s, so the stagger became a WINDOW (`SEED_WINDOW_MS` 800).
- `P_MIN` was 0.18: chains too short to read as travelling (a spark, not a cascade); 0.55 carries about two hops through degree-1 nodes. `TERMINAL_ODDS` 0.15 because at `P_MIN` every cascade dragged a halo of dead ends.
- Overlap: once "one in flight, a new one every 2s"; now `ITER_MS` 1s / `ITER_LIFE` 2s (about two in flight). The busyness comes from how many nodes ONE iteration lights.
- Life: `DUR_MIN`/`DUR_PER_DEG` 1100+130 -> 1650+195 -> 2500+290 (2026-09-24, on request). `DECAY_POW` 1.8 -> 1.2 -> 0.85: below 1 the curve is concave (55% at the halfway point vs 43%); a node stays above alpha 0.5 +78% longer (1305 -> 2325ms) and above 0.1 +63%; it cannot go much lower or the fade becomes a hold that switches off. `ATTACK_MS` 90 -> 280: with a charge layer accumulating underneath, the rise was the only fast edge left and read as flicker. Cost of the longer life is FRAMES (`lit` non-empty longer), not drawing. `EDGE_DUR` stays 900 (node:edge 2.9x -> 4.4x).
- Edge effects fade faster than node effects: a node is a place, an edge is a crossing; held as long, the picture is a wireframe with bright corners, and over a long track an accumulating edge set ends as a solid web. Measured ambient: charged edges below charged nodes at every sample (72/97, 114/147, 137/178, 160/208, 221/275). Edges used to stroke white in the flash pass (a white -> community hue change over time); now tinted from the from-node on all passes; neutral ink is 1.7-8% of lit pixels (node cores).
- Saturated second layer (2026-09-23): over the top rather than under (under `'lighter'` it would be washed out during the overlap). Measured at 1000x800, 9s after seeding a hub (past the white pass's ~5.6s max): 31,924 of 33,072 lit pixels carried colour (channel spread up to 235); before the layer, zero. `graph-pulse.js` was exactly at the 500-line cap, so the layer lives wholly in `graph-pulse-draw.js` (model edits: cached ink on `pos`, `totalLife` in `expire`, `lit` in the `init` handover). `graph-seed.js` was split out when proximity seeding took graph-pulse.js past the cap.
- Hover used to pin the hovered node's whole community lit; the animation stopping dead under the pointer was worse than the question it answered -> `pin`/`unpin` removed (2026-09-21).
- Canvas under the CRT stack: raised above it on 2026-09-22 and REVERTED (the CRT was not the problem). Measured 2 fps under the stack vs 18 with it hidden on the GPU-less droplet WebKit, canvas work 0ms either way.
- `_NODE_OPACITY` was 0 for an afternoon: nothing to be lit against, the page read as empty not dark. Unlit ink at 1200x744: 121,177 pixels. A runtime `edges.color.opacity` override moved ink by exactly zero (per-edge colour objects outrank it).
- Ambient lit pixels 25 -> 22,767 and charged nodes 1 -> 168 over 7s (accumulating, not sawtoothing). `graphGlow not defined` happened when a browser got a new graph-pulse.js beside a shell whose `<script>` tags predated the dependency -> the no-op shim.
- Outline-and-halo: `A_FILL` was 1 (and earlier 0.55, which only greyed the bg-filled interior): the centre clipped to white and the halos ringed it, a blob at any real brightness that buried the shape (= node type). Opaque bg pixels on the overlay grew 97 -> 118 -> 139 over 3s of cascade (small because glyphs are a few pixels at the opening zoom).

#### Paint order history
- Originally three groups: all edges (charge, white, sat) -> halos -> one opaque black fill -> outlines. Edges drawn first meant `source-atop` landed the wavefront on every lit edge it crossed. 2026-09-24 re-cut to six passes (halos, clearNodes, punchNodes, outlines, ring, edges beneath via `destination-over`).
- Before that, passes interleaved (charge-edges, charge-nodes, white-edges, white-nodes...), so later edge passes drew over earlier node passes and edges crossed the glyphs they arrived at.
- `destination-out` vs a bg fill: an opaque fill hides vis's canvas a layer down (the unlit graph) and would undo `_unocclude_small_nodes` for exactly the nodes a cascade touches.
- Node fill bg bug 1: `_GRAPH_BG` was graphify's `#0f0f1a` after /graph began injecting chrome.css (`--bg-hsl` is pure black) -> navy shapes; rotated nodes had BOTH orientations filled, so the union (hexagram) read as duplicated nodes. Sampled punched interior `[0,0,0,255]` vs `[15,15,26]`. Bug 2: four fifths of nodes carry `transparent` (truthy), the old falsy-only guard accepted it, `BG` became `transparent`, `punchNodes` silently stopped occluding; symptom: bright centres of big nodes (a hub's lit edges add up under `'lighter'`). Verified: a hub with 40 lit neighbours read `[15,15,26,255]` once fixed (at the time).
- Occlusion: every node had an opaque interior including degree-1 leaves (76%), cutting a NOTCH out of the one edge running in. First threshold `_SIZE_MAX / 2` caught 82 of 2867 nodes (2.9%): sizes are geometric in degree, so the range midpoint sits in a thin tail -> percentile. `_OCCLUDE_PCTL` briefly 0.80 (a DIAGNOSTIC for the bright-centre bug) moved the cut only 20.3 -> 15.6 while solid nodes went 261 -> 573. At 0.90: threshold 20.3, 261 nodes (9.1%), min occluding degree 6. Trade: the same fill punches the halo inside a small node's glyph (small nodes carry their own faint glow).
- Rotated-node punching: briefly punched BOTH orientations "because it's page bg over page bg" - wrong, the punch lands on the node's own halo (2.6x radius) and cuts a hexagram hole = doubled shapes (reported twice).
- Node rotation removed 2026-09-24: written on `pos[id].t`; vis's static copy at the original angle can't be erased or re-oriented without a ~100ms full redraw per beat; two cover-ups failed (the opaque fill cut a hole in the halo; trimmed back it left a rim of vis's border).
- Sizes 6..44 -> 12..88 (2026-09-21); x1.25 (15..110) tried 2026-09-22 and reverted: the largest hubs were 220 across vs a 168 lattice step.
- `graph-surface.js` (108 lines) and `graph-glyph.js` split off graph-pulse-draw.js; `graph_geometry.py` split off graph_style.py at 513 lines (occlusion READS the size rule, so they must live together).
- Shape table reassigned 2026-09-23 (code up-triangle 2,078 / 74%, rationale hexagon 462 / 16%, document down-triangle 262 / 9%). Triangle: a plainly centred triangle put the lit glyph a third of a radius off; triangle gets 1.15x radius since at equal circumradius it reads smaller than the hexagon.

#### Wavefront history (2026-09-24)
- Originally a copy of the node's own shape (three silhouettes said the wrong thing); one UPWARD triangle (74% wear it anyway). `GROW` 300 so the largest front passes well off every edge. Linear growth because easing compounds against the range (at 0.75 and 50x, a front is past 18x a quarter through its life). Stroke strictly proportional is the zoom illusion; ends at 420px wide with alpha gone over the same span.
- Per-node gate let one beat throw several fronts (strobe); global `BEAT_GAP`. Concurrent fronts 23 -> 3. Nominal life ~2.6s vs beats ~0.5s apart nested ~5 fronts (read as a doubled shape) -> life clamped to one beat (500ms at 120bpm, 345 at 174). `BEAT_FALLBACK_MS` was 420 (now 840).
- `HALO_SWELL` removed: the halo followed `bloom` and swelled on every lit node, throbbing the whole picture in place; the kick's pulse moved to the front's extent (`BLOOM_GROW`, captured once at release so a later kick doesn't resize live fronts). `EDGE_SWELL` stays (per-passage, not per-kick).
- Front colour: coloured stroke under `source-atop` REPLACED node colour; white imposes no hue. `'luminosity'` would be exact but the single composite slot is taken. Residue: white over colour lightens toward white. Currently drawn via scratch layer + `'saturation'` blend.

#### Audio history
- Added 2026-09-24. Reading `getDisplayMedia` first (only route to real output; works with headphones), mic fallback. Chrome shows the picker whether or not "share tab audio" is ticked; unticked = video track, no audio.
- Old chain `source -> lowpass(200Hz) -> analyser`; averaging 512 bins after the filter divided the signal by ~128 (kick peaked 6.7/255 on the silence floor; 252 over the band alone). Then the lowpass itself removed: everything above 200Hz discarded, "loudness" was BASS loudness. 
- Old onset: energy over 1.32x the mean of the last 45 frames, history written AFTER the test; replaced by flux over a running MEDIAN (a mean is dragged up by the transients it baselines). Measured: 45 frames of sustained high flux then a 3x transient: `hit` 0.450 -> 1.000 at ratio 3.00.
- Octave: 120bpm click track raw-locked at 61 with high confidence; offering the winner its double gives 120, period exactly 500ms. A weighting nudge can't do it (half tempo is genuinely equally periodic).
- Tempo stability: a 6s envelope is ~12 beats at 120bpm, too little evidence -> 12s window; rolling median vote; the old `nextFire = now` on any 3% period change threw away the grid. 77 lines of dead code (a duplicate `tick()` left by a file split, referencing nonexistent `hist`/`HIST_N`/`FLOOR`/`fire`) came out of graph-tempo.js. Synthetic 120bpm train: locks at conf 0.958, accent 0.947 on beat 0 and exactly 0 on beats 1-3. `isDownbeat()` was missing the `LOCK_MIN` gate.
- Silence: "quiet hands back to ambient after 4s" was dropped; `driving()` = `on`. Verified by forcing the flag: 0 lit pixels for 24s.
- Placement: pan drove X for one commit - a mixed track sits near 0.5 and the un-normalised centroid mid-range -> a vertical column. The `at()` lookup itself spans the graph (fx 0..1 -> 11 distinct nodes over 18,011 world units; fy 10 nodes over 10,071), so the column was the input, not the lookup. Raw centroid uses a narrow slice of 60Hz..8kHz.
- X walk: independent random X per beat read as "too random"; then a pure random walk sat in one region (expected displacement zero, distance ~sqrt(steps)); momentum + reflection-flips-velocity: fraction of width covered after 16 fires 0.210 -> 0.822, after 32 0.321 -> 0.959. `X_STEP` 0.07 -> 0.09.
- Burst: seeds 4..20 -> 2..8; `MAX_SEEDS` 24 -> 48 -> 20; `EXTENT_GAIN` 3 -> 0.8 (pool reached 320 nodes: a region the size of the argument); `REACH_GAIN` 0.45 -> 0.18 (branching is degree x p so reach compounds; a cascade has to be able to die).
- Length bias measured on the served graph (mean edge 715; shortest 5% 194, longest 2% 2584): low pitch 1.60x long / 0.56x short; high 0.40x / 1.44x. Viewport shape at 430x932 vs 1400x900: cloud aspect 0.509 -> 1.656, mean-edge/diagonal 0.0319 vs 0.0313, p50/mean 0.761 vs 0.813, p98/mean 3.56 vs 3.77. The stretch is anisotropic, so a vertical edge on a tall phone is genuinely longer.
- Timbre: `mid`/`treb` were computed every frame and read by NOTHING until 2026-09-24. Bend `1 + K(1 - 2 sharp)`: 4069ms/448ms at the bass end vs 1181ms/112ms at treble. Crossovers: a 90Hz source cuts 118/1000, 700Hz 400/1400, 4kHz 400/6000. Fixed 200Hz/2kHz left a dark master with one band ~0 all song. dB window defaults -100..-30 pinned anything mastered at 255. Smoothing measured: 5 frames up 0.480 -> 0.792, down 0.728 -> 0.522. `PEAK_DECAY` 0.999 -> 0.99995 (fell to 1/e in ~17s, so the drop didn't look like one). `fftSize` 4096 (~11.7Hz bins): 2048 enough for a visualiser, 8192 smears time.
- Allocation found and removed: flux history was a pushed array (now a `Float32Array` ring + second buffer for the median), `window_` returned a fresh `{lo,hi,v}` per catch roll (out-params now), `graphLit.levels()` built a map + key per lit node per frame (one reused map).
- `graph-norm.js` split from `graph-audio.js` at 521 lines; `graph-source.js`/`graph-bias.js` split along their seams.
- Pitch is the `graphBias.length` rule: measured with a tight node (mean edge 194) and a far-reaching one (2135): same table as above. A node with no edges at 0 would make every isolated node a high-pitch magnet.

#### Cover / opening view / lattice / layout history
- First paint: graphify's dataset was one ~2.1MB inline script right after the cover; an inline script can't defer, so the parser spent a second executing it with no render opportunity. FCP 1304ms (129ms responseStart; page 133KB gzipped) -> 387ms after `_externalise_boot` (130KB gzipped, immutable). `_externalise_boot` before the drops left a 9KB shell: empty layout key (~30s phone stabilisation) and an UNREDACTED payload.
- Black /graph: reported from a phone as "tap GPH, nothing, then black"; failsafe was 120s. Cover moved to its own file (deferred it sat behind the payload; phase line first appeared at `drawing`). Two bugs from tracing the bar: phase text ran backwards while `go()` and the loader both wrote it; `indeterminate()` must clear the inline width or the marquee slides a full-width bar. WebKit returned all 2,204,421 bytes in ONE chunk, so a byte bar fired once at 100%. Milestones were 0.45/0.9 at first, then 0.35/0.6/0.75/0.9 after the lite payload made download+build finish almost at once.
- watchSleep (10s interval, >60s gap = "device slept", reload) tripped on every iOS app switch and reloaded into a black page; earlier its 30s watchdog fired mid-stabilisation and reloaded forever. Replaced by `watchWake`.
- Three phone failures 2026-09-22: reload-on-wake; the `(pointer: coarse)` pulse gate (turned the animation off on the device that reported a frozen page; later gate on node count also removed - "the animation is what the page IS"); cold render after restart (1.7-2.9s, per-process `_CACHE`) -> warm loop, TTFB 0.046s.
- Reveal used to fire the line after `moveTo` (uncovered the previous frame; first cascade lit a beat later). `moveNode` per node = a vis redraw per node: 160 draws, 16.1s main thread, median 93ms apart, 130 before the cover lifted; the 3s failsafe never fired (a busy thread can't run a timer). Direct writes + one redraw: 4 draws, 0.74s. `graphPulse.index()` chunked into four rAF phases (`nodes 22 / edges 5 / pos 7 / grid 54ms`) was not the culprit but stays so a failsafe can fire. `DRAWN_CAP` 800ms added.
- Opening zoom: `OPEN_ZOOM` 0.75 -> 1 -> 1.2 on top of fit(); cover (wallpaper fill; 1280x744 opened at 0.0883, 430x876 at 0.0593) then replaced by `contain x FIT_MARGIN`. Lattice was briefly rescaled into a viewport-aspect box before snapping (squashed everything inside; grid points square, picture not); then UNIFORM `k` (107x103 on every screen); then stretch-then-snap with one cell: 98x199 at 430x932 (0.49 vs 0.49), 183x106 at 1280x800 (1.73 vs 1.72), step 112/112.
- Moire "groups of four": the baker read positions AFTER `snapToGrid` (107 distinct x, gaps 146/147), re-snapped at cell 97, 146/97 = 1.505 -> alternating wide/narrow gaps. `__GP_PRESNAP` fixed it: 107 -> 2,433 distinct x; clumps from hard cap 4 to a natural tail (1220 singles ... one 107). `__GP_PRESNAP` was first captured after the stretch (baked the bake window's aspect, stretched again).
- `CELLS_PER_NODE` 4 -> 9 -> 7 (19,054 pts, cell 112) -> 5.25 -> 3.9375 -> 2.953125 -> 2.21484375 (5,716 pts, cell 194). Simulated on the tall bake: blocks 588 -> 328, nodes alone 341 -> 184, largest block 196 -> 204. `nearestFree` tie-break: displaced nodes 903 -> 793 (old density), 1,285 -> 1,150 (this one).
- Stabilisation 220 -> 270 -> 370 -> 300 (370 bought nothing for 8s of bake; 270/300/325/370 walked 2026-09-22); bake 20.7s -> 29.1s at 370. Bakes: vis has no per-axis gravity (9.1.9 has scalar `centralGravity`); targets 1.60 (got 1.20) and 0.50 (got 0.72); stretch remainder 0.72 -> 0.49 vs 1.6 -> 0.49, about a third of the distortion. `?pack=1`: 14 communities as rigid tiles shelf-packed (117x218, step 350, cloud 0.53 vs 0.50), aspect fed back four times (0.51 vs 0.49); off because it deals the communities out again. Baked layout: 430x932 ready 8.8s vs ~30s.
- `_cached` once keyed on graph.html alone: the 05:00 cron rebuilds graphify and bakes after it, so a visit in between cached a render with NO baked layout for a full day.
- Phone default `?lite=1` lasted a few hours and was reverted on the owner's call (a codebase map with its leaves cut off is a smaller claim). Freeze answered by making the page cheaper: 0.49MB / 600 nodes / 929 edges vs 2.10MB / 2,722 / 3,582.
- Islands under 5 dropped (2026-09-22): 2,722 -> 2,581 nodes, 3,582 -> 3,482 edges, 137 components (smallest 5), 14 communities (424 down to 69). `api/data/` (786 key-structure nodes) and `nightfall-src/` (1054) dropped 2026-09-21. 4843/7154/610 emitted -> 2581/3482/14 served; `(other)` 444 (38 small modules). Raising the cap to 22 only took `(other)` to 285 (52 buckets before the fold).
- Tap-centring: open-loop offset landed 156px out; measured correction next frame; animated pan took 2.1s (each frame a full 2,581-node redraw ~100ms). Tap guaranteed first hop: lit pixels 896 ambient -> 1842 after tapping a degree-157 hub. Palette lint: `hue2rgb` in graph-ink.js renamed `hueChan`.
- The physics configurator panel, freeze|tour toggle and the camera tour were removed 2026-09-21 (tour re-enabled physics: 4.5k-node canvas at 0.4 fps with 4.2s frames).

### 11g. Field notes (moved verbatim from CLAUDE.md 2026-09-27)
Everything above was folded out of the 11g block; stale values found there on 2026-10-15 (ITER cadence "every 2s", `BEAT_FALLBACK_MS` 420, `X_STEP` 0.07, bar milestones 0.45/0.9, "unlit edges opacity 1.0", "beat calls `seed()` with no argument", "ambient resumes after 4s of silence", `lowpass(200Hz)` chain, `MAX_SEEDS` 24/48, `ITER_LIFE` cadence) were dropped as superseded. The 11g text on the 05:00 bake: "~370 forceAtlas2 iterations over 2581 nodes measured ~30s on a phone every visit" is the motivation for the baked layout.


---

## 12. The bottom nav

Current design: [ARCHITECTURE.md §12](ARCHITECTURE.md).

**While the panel is open the bubble is HIDDEN** (`body:has(#exec-panel.open) #exec-bubble { display: none }`, exec-bubble.css — the same rule the card dialog already applies for the same reason). Bubble and panel are both at `--z-bubble`, so DOM order decides and the bubble wins it: wherever it rests it is ABOVE the panel and swallows every tap inside its 50px circle — and the tap it swallows is `togglePanel()`, i.e. CLOSE. At phone width the panel is full-screen and the bubble's resting corner (right 14px, bottom `--nav-h + 10`) lands squarely on the tail of the last choice row and on the composer's `#exec-mute` / `#exec-ph-close`: measured at 430x932, bubble `366..416 x 807..857` over a choice row at `12..418 x 808..841`. So tapping the last answer of a nudge MINIMISED the panel instead of answering it (reported 2026-09-18). The bubble's job is to OPEN; the panel closes from its own `[x]`, or a tap outside where there is an outside — on a phone the panel covers the screen, so `[x]` is the close.

The second half of the same failure is **WebKit touch adjustment**: a tap that lands on no clickable element snaps to the nearest one within ~10px, and the composer's `[x]` is a 29x19 target directly under the transcript's last line (`[x]` at `389..418 x 841..860` against a row ending at 841). `#exec-term` therefore carries `var(--space-2)` of BOTTOM padding as a tap guard, not as rhythm — without it a tap aimed at the last answer, landing a few px low, still closed the panel. Pinned by `tests/test_exec_bubble_overlap_browser.py` (WebKit, 430x932): nothing of the bubble may intersect the open panel, every choice button must be the topmost element at its own left/centre/right, and tapping the row's last answer must send it and leave the panel open.

(The standalone `/directives` timeline page was removed — that timeline now lives in the hq today column.)

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

**GPH in the guest nav (2026-09-21).** The §12 table and CLAUDE.md both said `GPH` was a guest-nav entry while `_GUEST_NAV_LINKS` omitted it, so the public landing offered `/graph` to a visitor with no nav entry to leave by. `tests/test_landing_nav_parity.py` now pins it, both sides scraped from rendered markup rather than a hand list, so a new section is covered the day it is added.

**The `/cc` star (2026-09-21 to 2026-09-29).** `/cc` wore `✦` (U+2726), absent from the ASCII-only 04b25 font, so the fallback face varied per device. The page folded into the Exec panel on 2026-09-29; the detection machinery stayed. Measurements of the star: at `--fs-2xs` the ink was 6.1px; ink 9.0px at `scale(1.48)`, same as the M of MTG two slots along; square, so 9.0px tall against the caps' 11.3px (width is the match, one glyph cannot have both). Measured 2026-09-21 at 430x932 by clipping a screenshot per label and counting green pixels at 3x DPR (letters ink 910.04-921.04, star 911.09-919.76, centres 0.12px apart). Canvas `measureText` reported the glyph ~30% off what it painted. A first baseline nudge, `vertical-align:-0.05em`, did nothing (label is a flex item). An older doc version quoted `translateY(0.3px) scale(1.9)`; the shipped rule is `scale(1.48)`.

**Icon tracing: how it got here.** Colour mode arrived 2026-09-21: tile dropped, every other colour painted as itself, ink taking the tile colour. It returns for free what the line-art path needs an interior pass, a colour quantiser, a despeckler, per-icon floors and hand-drawn glyphs to reconstruct (all remain, for the eight `LINE_ART` icons only). Fourteen icons trace in colour. At 20px the PNGs were mush (tile read, art did not). A first version ran Chaikin corner-cutting to round the staircases off: 120KB for the set against 26KB, and smoothing a pixel grid is the opposite of keeping it.

The outline alone was not the icon: flat-colour features (the boss's mouth, watchman's iris, wardenpp's badge, golem-stone's panels, the wizard's moon) are invisible to a darkest-cluster pass, hence the interior pass. Three things make it work rather than produce noise, each learned by producing noise: it runs only on pixels enclosed by the outline (the drop shadow lies outside); colour is quantised first (sources shade by DITHERING, a stippled iris is never one region at full depth); a region under the size floor is merged into its nearest neighbour rather than dropped (dropping inked a line only where both sides survived, so every removed speck punched a hole in the line past it). Against the tile the ink goes on the art's side whatever the luminance says (data-file's near-white pages on orange made the TILE the darker side, and a darker-side rule drew the silhouette onto the background where a "never ink the tile" guard deleted it). `GLYPH_ONLY` icons: data-doctor's cross is five red cells smeared across an isometric face, laser-satellite's dice have dithered facets, data-file's back sheets only traced as slivers. A drawn glyph marked `solid` occludes earlier ones (without it three closed sheets are three wireframes). Named glyphs: watchman's iris is dithered green-on-olive with a two-cell pupil; the boss's mouth is a 6px red band too small to survive the floor that calms his stippled skin; data-file writes its text as grey blocks, noise at icon size. `NO_INTERIOR` for watchman and bitman/printer (the same biting sphere). `DESPECKLE_OUTLINE` counts all eight neighbours or a diagonal outline is deleted as speckle. Ink = DARKEST cluster, not everything darker than the tile (the loose test fills the subject solid and turns dither into thousands of one-pixel squares); data-file/data-doctor are flat vector art with no outline, so their line is derived from where colour regions meet. `ICON_COLOUR` e.g. `turbo` (yellow bolt on blue tile); `ICON_ACCENT` e.g. data-doctor's red cross, wardenpp's gold rank crosses, wizard's moon and stars.

**Standalone refresh (2026-09-26).** The guest nav renders `F5` server-side in every mode: a guest is the visitor likeliest to be on a phone watching a page that has stopped updating, with no idea a reload is the fix.

**Bubble z-order.** The bubble used to be `--z-max` with an `.exec-under-fx` opt-in only the link-bubble pages passed, so on `/rd`+`/hq` (where it is actually used) it painted on top of the monitor. The class is gone; the base rule carries `--z-bubble`. Measured: `elementFromPoint` at the bubble's centre returns the bubble on `/rd` and `/debug` despite the fx layers.

**Bubble hidden while panel open (2026-09-18).** At phone width the bubble's resting corner sat on the tail of the last choice row and on the composer's mute/`[x]`; answering a nudge minimised the panel instead (the swallowed tap was `togglePanel()`).

**Mic prompt arm.** The `.mic` prompt is a `<span>`; it had to be added to the panel's first-gesture keyboard arm (`exec-bubble.js`; the old `cc-input.js` went with the page), which `preventDefault()`s a pointerdown on anything not a control and ate the first tap on it.

**Composer height.** It was 33px against an 18.6px message line (6px row padding, plus `#exec-mute` and `#exec-ph-close` carrying their own vertical padding) before the zero-height rule.

**Touch Enter (2026-10-05).** On touch the composer's Enter became a newline with the third consecutive Enter sending.

**Voice off semantics.** Exec voice is `glados` on `piper` (a container on the droplet), so it works with the home box asleep; voice goes both ways via `exec-mic.js` on `voice-input.js` (drops anything heard while a reply streams or `execVoice.isSpeaking()`, else the panel transcribes its own narration; closing the panel ends the session).

**Page scroll** was introduced because the native root scrollbar is top-layer and painted its pill over the fixed nav.


---

## 13. The pre-commit hook suite

Current design: [ARCHITECTURE.md §13](ARCHITECTURE.md).

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

## 14. `/tarot`

Current design: [ARCHITECTURE.md §14](ARCHITECTURE.md).

**The outline used to stand off the art.** A `.tarot-card` was a fixed `--card-w x --card-h` box (0.597 at phone size) with the image `object-fit: contain` inside it, and the 78 scans run 0.5545 (`strength`) to 0.5837 (`the_tower`), median **0.5714** — so no single box could fit them and every face was letterboxed by ~2px a side, while the zoom (`width:auto`, hence intrinsic) hugged its card exactly. The card now takes the HEIGHT and its width from the image (`width:auto` + `justify-self:center`, which is what makes a grid item shrink to fit rather than stretch to its column), and the image is sized `height: var(--card-h); width: auto` — measured gap 0.00px in both states at 430x932. `card_back.jpg` was **cropped 700x1200 -> 686x1200** (0.5833 -> 0.5717) so a flip does not resize the outline under the finger: face-down 73.7px, face-up 73.0px. The back also stops being `object-fit: fill` — it was stretched to a box it did not match. `#sig-card` gets the same hug the other way round: it must keep a box when EMPTY (the back is its background, not an `<img>`), so it carries `aspect-ratio: 686 / 1200` and the background fills it exactly.

**Set that level by MEASURING dBFS, not by picking a multiplier — the usable band is narrow.** The shipping bake (`?v=3`) is the source × 0.15 = **−31.8 dBFS mean / −16.2 dB peak**. That is quiet enough to read as silent on desktop speakers (a "music isn't playing" report that was the music playing: `paused:false`, clock advancing, no media error, verified in chromium/firefox/webkit), but a 2026-09-02 re-bake at **+10 dB → −21.8 dBFS mean** overshot and drowned the reader, so v3 was restored the same day. Anything replacing it has to clear the desktop noise floor without competing with the narration, and that window is well under 10 dB.

**And 4.6s is the mild version.** The first synth after the home box came back from being fully off measured **10.3s to first audio** (2026-09-20 — `OK SLOW` in the nightly log), with the next two at 704ms and 433ms on the same box, so the cold load is the whole of it and it is worse from a cold BOX than from an evicted model. A querent would have watched a blank terminal for ten seconds before the reader said a word.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

**Status bar.** Those lines used to be `.msg.sys` entries in the chat scrollback. The `[State: …]` parrot: the model sometimes echoed the per-turn Phase 1 count note as its reply's first line ("[State: Phase 1 turn count = 5.] You've said enough…", 2026-09-27); the note was made private and the filter added.

**Cards.** The old fixed `--card-w x --card-h` box letterboxed every one of the 78 scans. `card_back.jpg` cropped to the median (earlier docs quoted 0.5714). Before `paintFlipped` the card she had just turned kept showing its back for the length of the reading.

**Narration (2026-09-20).** The ♪ button used to be a volume mute that kept narrating and kept pacing the reveal to audio nobody could hear. `twAudio` moved out of `tarot-stream.js` into shared `web/typewriter.js` when the Exec panel got the same voice.

**Mic.** A reading is the longest conversation on the site, run to five Phase 1 answers, a query dialogue and three turned cards, often had lying down: a lot of phone typing in the dark. The narrator core's `speaking` flag used to be cleared only by the queue's own drain, so `/tarot` left it true forever and nothing noticed until a microphone needed to know when the reader had stopped talking.

**Ambient level.** Set by measuring: a +10 dB re-bake drowned the reader. Usable band well under 10 dB; must clear the desktop noise floor without competing with narration. A `?v=` earlier bakes existed before `?v=3`. File-name archive master `~/tarot-ambient-0.15-orig.m4a`.

**Openings: why the first reading of a day was slow.** Generating live cost an opus round-trip AND a TTS synth before the querent had typed a word; on the first reading of a day the synth is a COLD one: ~4.6s of model load against 0.36s loaded (measured 2026-09-10). Image of the pre-generation: the page used to carry an inline opening block at the end of tarot-chat.js. Generation: asked for ten at a time the model varies them against each other instead of converging on the same lamp and the same siren; asked one at a time it would not. A bad opening would be frozen into audio and played for months, hence drop-not-repair. The id-shape defence is the same structural guarantee `gamesave_store` makes with its sha256 component. WAV: ffmpeg lives on the HOST only; an encoder in the container means a new pinned dep and a re-resolve of the whole lock, which is how `httpx`/`httpx2` took the site down (§1).

**Home-box-down note.** The page used to say nothing until the first turn had already failed mid-reading. A note that contradicts the voice currently talking is worse than no note; a note that guesses is worse than no note.

**Nightly check.** Five jobs (morning 4:30, graphify 5:00, security 5:10, cc probe 5:20, tarot 5:45) sequenced so none contend for a 1967MB box. In-process rather than cron for the same reason as the nudge loop (a baked `/etc/cron.d` entry needs an image rebuild to change).


---

## 15. The nudge loop

Current design: [ARCHITECTURE.md §15](ARCHITECTURE.md).

The old stall-peel path (`peel_sync`/`apply_peel`/`_PEEL_FLOOR_MIN`/`_stall_generate`, the whole "peel a tinier first sub-step off a stalled step" mechanism) was **removed 2026-08-28**. `window_deadline` and `redecompose_count`/`redecompose_at` are now **vestigial** fields on `card["nudge"]` — still in `default_nudge_state`, never written.

**EVERY open question keeps its buttons — nothing is wiped.** `clear()` used to run at the top of `attach()` and remove every `.exec-choice-row` but the one being added, on the theory that an older question had been overtaken. It had not. A day that fires two nudges asks two real questions about two different cards, and Wai answers them when she surfaces rather than in arrival order. Wiping left exactly ONE tappable row on screen, under the NEWEST card, so a tap meant for an earlier question hit the wrong one. Measured 2026-09-16: nudges at 14:00 (climbing) and 17:57 (Lyre poster); the 23:22:59 tap meant for climbing PATCHed `craft-lyre-poster` to archives, and climbing was archived by hand from /hq 22s later. `clear()` is now a no-op, an exported leftover with no caller left.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

### 15e (2026-09-13) — why the nudge asks instead of asserts

The old framing ("a task sitting untouched on today's timeline", "frame the un-started task as a clinical finding") asserted a fact the system cannot know, and read as an accusation when the thing was already finished. The first cut's "you are requesting a status confirmation, not filing an accusation" read as *be nicer* and flattened the voice. Not knowing costs GLaDOS nothing and the doubt is plainly performative: extending Wai the benefit of it lands harder than an accusation, which would at least credit her with being worth the certainty.

`last_nudge_text` was added as an anti-repeat signal because "VARY it every single time" had nothing to vary against: two of four samples opened identically.

Time-critical steps: asking whether a still-future 6:30 departure is "done" reads as nonsense; the old prompt's "keep the warm, practical register" there fought the persona on exactly the path where it matters most.

### 15e-bis — tappable answers, history

- Bold-wrapped rows: the model reaches for bold on a line that reads like a control; the failure was silent in the worst way (row printed as raw brackets, no buttons). Prompts now say write it plain AND the parser forgives it (2026-09-15).
- `addMsg` used to parse only the `probe` role, so ordinary-turn question rows printed as brackets. A chat reply used to get answer buttons only — no card id in its payload, and guessing one would archive the wrong card. Hence the `card=<id>` cell in the row.
- Why the cell matters: "is the poster picked up?" asked in ordinary chat is answered by doing the thing, and about half the time the next action Wai wants is to mark the card done; without the cell the panel showed the question and no way to close it.
- Wiping all rows but the newest (2026-09-16) left one tappable row under the WRONG card: the tap meant for the climbing nudge archived "Lyre poster". The `[answering: "..." card=...]` reference replaced the wiping; `clear()` is now a no-op.
- Panel closing on tap: besides the detached-target click-outside bug, the bubble itself (hidden while open) and WebKit touch adjustment (~10px snap to the 29x19 composer `[x]`) both closed the panel; hence capture-phase `markOrigin` and the `#exec-term` bottom padding.
- `done` -> `archive` rename (2026-10-14): Wai tapped `done` after a step of an interview prep card and the whole card went to archives (log: `moved hq->archives source=Exec`, no `actor`, 8s after the `advanced` entry).
- `archive_card` (2026-09-15): the prompt used to say archiving was Wai's alone, so asked to mark a card done Exec answered that the lever lived on her side of the glass.
- Card actions through the model would spend a turn doing something the tap already decided and could silently not happen; a model that must remember to offer them will sometimes forget — hence client-appended.

### 15a/15d — stall re-peel removal

The old peel mechanism (re-fire and peel a smaller sub-step when a nudge went unanswered) was removed 2026-08-28; `window_deadline` and `redecompose_count`/`redecompose_at` are the vestigial remains.

### 15g — recalibration detail

Every completion is tagged; late ones carry `minutes_late` + `estimated_time`. Late tasks push the factor up (proportional to lateness), on-time ones pull toward 1.0. Gated off pending real data.

### CLAUDE.md "15-notes" dump (moved 2026-09-27) — residue not kept in section 15

Card schema note, tappable-answers paragraph and archive/exile card-action paragraph were moved verbatim from CLAUDE.md; their content is now folded into §15a (field table), §15e-bis. Two measured/dated details kept only here:

- The stale-wiping incident above (2026-09-16).
- Pinned by `tests/test_exec_bubble_overlap_browser.py` (overlap/tap-guard).


---

## 16. The Exec monitor

Current design: [ARCHITECTURE.md §16](ARCHITECTURE.md).

Orphaning happened because `_save_chat`'s chronological `ts`-sort could **split a tool turn**: a `tool_use`/`tool_result`-only message has no text key, so it was stamped a fresh `now` while its paired text kept its old `ts`, floating them apart.

Fixed on both sides: `sanitize_history_for_api` guarantees the outbound sequence is valid regardless of stored corruption, and `_save_chat` now makes a keyless (structural) message **inherit the preceding message's `ts`** so a tool turn stays contiguous in storage.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

### Exec's own changes (2026-09-29)

Once the panel moved onto the sidecar, Wai saw Exec call `advance_chunk`, report it, then a minute later comment on its own step ("One message sent. Three steps... still waiting"). The old `MONITORED_TOOLS` hook that scheduled the monitor after a tool call is gone; `actor` marker replaced it.

### Watermark advance

The watermark used to advance BEFORE the LLM call, so any failure (429/529/timeout, routine for a live external API) permanently dropped that batch's entries: they were already older than the new watermark on every later `_recent_entries()` call, with no retry and no visible sign of loss. Now advanced only on success.

### Orphaned tool_use

Orphaned `tool_use` (its `tool_result` drifted away) -> API 400 `tool_use ids … without tool_result blocks immediately after`. Two fixes: `sanitize_history_for_api` flattening, and `_save_chat` keyless-message `ts` inheritance so the sort cannot split a tool turn apart in storage.

### CLAUDE.md "16-notes" dump (moved 2026-09-27)

`/api/monitor/stream` payload list: `{thinking}` / `{comment}` plus `{cards_changed:true}` when a server-side mutation (morning rollover, nudge advance/decompose, discord tool round, web exec tool round — every tool but `update_context` writes `rd.json`, and the panel lives ON /rd + /hq so a card it archives has to leave the board under it) rewrites `rd.json`.


---

## 17. Memory is the scarce resource on this box

Current design: [ARCHITECTURE.md §17](ARCHITECTURE.md).

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

## 18. The typewriter and the shared chat surfaces

Current design: [ARCHITECTURE.md §18](ARCHITECTURE.md).

**The caret mirror is the argument for all of it.** Four surfaces drew the same drawn-caret, and after WebKit threw `IndexSizeError` on a stale selection — blanking the page mid-send — the fix landed in three of them. The panel kept the broken copy until the files were merged. A copy is a fix you will forget to apply.

It used to sit after, among the settle-pass work — so the voice waited out the entire typewriter run and only began once the last character had landed. On a long reply that is the whole point of the narration gone: the screen has finished saying it. Measured with a stubbed stream at 430x932: speech at 740ms, reveal complete at 3396ms, i.e. **2656ms of silence that should have been narration**.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Before the merge, the shared pieces were: transcript look = three near-copies of forty lines; stream bubble + caret mirror = four copies each (the panel's caret lacked the try/catch the others grew after WebKit threw `IndexSizeError` on a stale selection and blanked the page mid-send); reveal = `tarot-stream.js` owned the audio half; voice = two hand-written narrators; mic = one engine, three near-identical bindings.
- Speed: measured ~45 chars/sec on a real /mtg reply at SPEED 2; the multiplier went 2 -> 3 -> 5 (2026-09-14) as the reveal kept reading slower than the eye. At 5 the 65ms char is 13ms, still a reveal rather than a paste.
- `twAudio` was `/tarot`'s main path in tarot-stream.js; moved into the shared engine 2026-09-20 when the Exec panel got the same voice.
- `FIRST_AUDIO_MS` was 8s; raised to 12s after a cold synth measured 10.3s off a box that had just come up (§14d).
- Why syntax costs zero reveal time: charging time for a span the voice skips puts a long code block's worth of drift between words on screen and in the air (the panel's normal reply shape).
- Jump sample: 283 chars in 150 frames for a sample holding every syntax form; `Done - not a bullet, 3 * 4, a # hash.` still types as prose. 89-char reply with one SVG block: 18 frames instead of 89, the 72-char block landing in one. Half a URL revealed and then taken back is worse than a short pause; a `|` mid-sentence would be mistaken for a table; typing a table shows a row of raw pipes slowly becoming one.
- The blink cursor: dropping the empty bubble for a tool call used to take the only "still going" signal off screen, so a long search looked like a stopped page. Dot spans are `display:none` rather than churning three files.
- Narration ordering bug: `execVoice.speak()` used to sit after the reveal await, so the voice opened its mouth once the last character landed (speech started 2.7s late measured). `speak()` is fire-and-forget (strips markdown and `[bracketed]` rows, opens the TTS socket, returns), so moving it earlier cannot delay the text. Only the streamed reply had the bug; `addMsg` never did.
- Transcript look drift: Exec's scrollback a step tighter than /mtg's, sys lines near-invisible on one page and legible on another. The composer-merged-into-scrollback used to be an override in chat-reader.css, leaving the slab variant styled but unreachable. chat-doc.css was the same ten lines copied into each page file. Markers used to be inline `::before` of varying width, one indent per role.
- Sys alpha moved 0.12 -> 0.45: at 0.12 it was legible only as a smudge, which is how /cc's "not logged in" got read as a broken page. `--lh-tight` was added to chrome.css for this.
- Headless WebKit: `#exec-panel` is in the DOM, hit-tests on top, paints nothing in the PNG.
- Link rule incident (2026-09-19): the biweekly EI card's nudge said "open the login link" while the `hrdc-drhc.gc.ca` URL sat in its notes; the reader is on a phone, so the instruction handed her a search instead of a tap. The scheme check goes through `URL()` because the regex scrub after `marked.parse` only caught a literal `javascript:`, and `java\nscript:` is the same href to a browser. `/mtg` already rendered links this way; the panel was the one surface on bare `marked.parse`. The one line in the transcript that carries links (`probe`) rendered in UA default blue until `.msg.probe a` was added. `.msg.monitor` is vocabulary no JS applies any more.
- 2026-10-14 security audit: `marked` passes raw HTML through and the old regex scrub let `<img src=x/onerror=…>`, entity-encoded `javascript:` and `<iframe srcdoc>` survive; a reply steered by a web page the agent read would have run as the owner. Fixed with DOMPurify on every `marked.parse`. `marked` 15.0.12 is byte-identical to what the unversioned CDN URL served. An unpinned jsDelivr script ran with the page's origin and could read every noodle identity in localStorage or call owner APIs, hence vendoring.
- `18-notes. From CLAUDE.md (moved 2026-09-27)` and `19-notes`: verbatim CLAUDE.md dumps that duplicated the subsections; deleted in the rewrite (all content already in §18/§19 above or here). The /zombo one additionally recorded: the CSS fallback reproduction (wordmark, loader, caption crawl) and `zombo-audio.js` (synthesised bed + voice) deleted 2026-09-17; the page-local red-Z favicon override dropped 2026-09-17; alternatives measured and worse: `noBorder` crops the wordmark to "mbo.co" on a phone, `exactFit` stretches it 2.4x, `backgroundColor:'transparent'` broke rendering (page went solid green), width-driven sizing cropped the loader on a short window.


---

## 19. `/zombo`

Current design: [ARCHITECTURE.md §19](ARCHITECTURE.md).

**The page is the movie and one line, and nothing else.** A CSS reproduction of the intro used to sit underneath as a fallback — wordmark, loader cluster, caption crawl, plus `zombo-audio.js` synthesising a bed and voice for it. All of it was deleted 2026-09-17. If the movie cannot mount, the page says so rather than drawing an imitation of it.

**Positional selectors were a bug that shipped.** A `<br>` is an element child too, so the moment the copy gained a line break every `:nth-child` cycle after it shifted by one and a handful of letters fell through every rule to the default ink — they rendered BLACK. The per-word wrapper compounds it: it nests the spans, so they are no longer siblings of one parent and a positional match fails outright. An explicit index is immune to both. Each **word** is wrapped (`.zb-w`, `white-space: nowrap`) because every character is an `inline-block`, so a line break could otherwise land between any two letters — it broke `exp / erience`.

The alternatives were all measured and all worse:

| Approach | Result |
|---|---|
| `scale: 'noBorder'` | covers by whichever axis needs it — on a portrait phone that is HEIGHT, cropping the wordmark to "mbo.co" |
| `scale: 'exactFit'` | stretches ~2.4× vertically on a portrait phone |
| `backgroundColor: 'transparent'` | breaks this movie's rendering outright — the whole page came back solid green |
| width × 11:8, overflow at the bottom | band reaches the edges, but the loader cluster gets cropped on a short window |
| **fit + sampled pillars** | nothing cropped, band edge to edge, and it tracks the movie |

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Trap 1 history: a version asked wai-lau.net for `/welcomeclip.swf`, got a 404 and played a blank 1360-frame white rectangle while `load()` resolved happily.
- Trap 2 measured: `player.metadata` is `null` at the promise's resolve, `{550×400, 1360 frames}` four seconds later; a version read it there, treated empty as failure and tore down a healthy player.
- Link rewrite: plain HTTP to a domain that has not served that page this century; clicking navigated the tab off the page to nothing. The movie carries no URL string at all (its type is drawn as glyph shapes). Overriding `window.open` would only cover the named-target case, not this link. The fragment is padding that happens to record where the visitor came from; the landing ignores it.
- Colour classes: positional selectors shipped as a bug: adding the `<br>` shifted every cycle after it and dropped letters through to the default ink (visible as BLACK letters); the line otherwise broke mid-word (`exp / erience`). Nine hues against five offsets repeat only every 45 characters; blue three times, orange twice because it is a sequence to repeat, not a palette.
- Pre-click hide: `visibility: hidden` is inherited but a descendant can override it; Ruffle's play overlay sets `visibility: visible` on itself, parking a large orange play button on the begin line. Ruffle's own unmute control is a speaker button the intro never had.
- Cross-fade: movie fade was 1.4s, line fade 1s; raising the movie's fade alone leaves a second of blank white paper mid-transition.
- Sizing: without `display: block` the movie sat hard left with both pillars bunched on the right; a fixed CSS gradient for the pillars was the first attempt and is wrong in principle (hardcodes the opening frames, drifts as the movie animates).


---

## 20. Pages and subsystems without a section of their own

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Header note "Moved verbatim from CLAUDE.md on 2026-09-27 when CLAUDE.md was thinned to an index. Unedited" removed; subsections rewritten as current-state rules.
- 20a: the guest set grew over time: three pages moved public -> guest 2026-07-03; `/printer` owner -> guest read-only 2026-08-30; `/noodle` and `/spire` added 2026-10-14. The old shared `GUEST_KEY` is gone. Removed from `/guest`: the manual submit button, the PED logo, the `admin` link. Cookie lifetime story: both tokens were already restart-stable (`sha256` of an env value) and nothing server-side ever expired a session; what logged Wai out was `set_cookie` without `max_age`, making them browser-session cookies the browser drops when ITS session ends (phone evicting the tab, standalone PWA killed). 400 days is the ceiling Chrome/Safari clamp to and what `nf_save` already used; Safari's 7-day ITP cap is for script-written cookies, not HttpOnly server-set ones. The admin token is a static derivation, so a longer cookie adds no forgeability. Security headers added 2026-10-14 after an audit found none; HSTS has no includeSubDomains/preload because both are hard to take back, and an http:// noodle link could otherwise be TLS-stripped and its `#k=` key read by the attacker's page.
- 20b: original text said a restart-less stale board "sat stale until a manual refresh — the mobile failure mode, where the tab lives for days": the fired `saveTimer` handle left set wedged `hqCanReload()` false for the life of the page after the first drag of a session. SSE re-open exists because `EventSource` never replays what it missed (catches a drop shorter than the 30s wake threshold, e.g. a phone backgrounded 10s). No expand/collapse toggle on breakdown cards.
- 20c: vain-empress and moltbook heartbeat panels removed 2026-09-10 with the `/api/moltbook/heartbeat-log` route and the jsdelivr `marked` script (`/debug` left `_JSDELIVR_PAGES`). `--doc-*` alias layer ripped out 2026-07-02 (every consumer inlines the palette token). Doc-theme values: green at `0.12/0.45/0.8/1`, cyan `0.8`, pink `1`; card surface = green 0.12 over `--bg-hsl`.
- 20d: was public until 2026-07-03. Framed as the automated bot/scanner traffic any public server sees, deliberately NOT a script-kiddie attack-count wall. Map projection crops empty ocean/poles centred on 0,0. `security.py` alone references ~56 tokens. Per-panel cards would be card-on-card.
- 20e: `/UI` was public until 2026-07-03. Detail dropped for concision: grid collapses to one column <=640px; fixed-height description box `.clr-guse`; non-card alpha usages map onto the nearest card size; card colours' count row is text `(sizes +N)×`, non-card is per-column `×N`; radius renders as rounded boxes (unused steps hidden -> the 4 numeric steps), font tokens self-labelled, `--name` row dropped when the visual is the name.
- 20f incident (2026-09-01): commit 005e26c moved the gamesave API to `guest_protected` so guests could save, without giving the three GLOBAL slot files any caller identity. `wai-save-sync.js` restores server -> IndexedDB on load ("server is source of truth") and uploads IDB -> server on every put, so the halves composed into a full swap: any visitor who solved Turnstile pulled Wai's save, played it and pushed progress back over it. Observed in the wild 17:15 that day.
- 20g: light mode simplified 2026-09-24 (was monospace/pill/spaced-caps terminal look). Dark toggle kaomoji `⋆₊⏾⁺₊⋆` as an outline pill in the footer row right of `wai-lau.net`; a switch smooth-scrolls to the top. Dark mode had a 3-layer CRT subset before matching `_CRT_FX`. Summary type-out is tarot-paced with a decoy fake-out.
- 20i: tall cards (recurring + notes + 5-step breakdown) used to push the action buttons out of reach when they were inside the one scrolling box; each of the three footer fixes was a separate bug (a `90vh` box in iOS's large viewport drops its bottom below the visible area; invisible to headless WebKit, which has no browser chrome). An unstyled `textarea` fell through to chrome.css's phosphor-green page default (green bar on an orange card); a `currentColor` thumb changed hue per card; Chrome 121+ lets the standard scrollbar prop override the webkit thumb without the `@supports` guard.


## 21. noodle — moved to its own repo

Since 2026-10-14 noodle's history is `apps/noodle/ARCHAEOLOGY.md` (repo `wai-lau/noodle`).

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Left the repo 2026-10-14 via `git filter-repo`, 163 commits of history kept; the section was ~700 lines.


## 22. /spire — moved to its own repo

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Left the repo 2026-10-14 via `git filter-repo`, 1,172 commits kept; the section became the spire repo's `ARCHITECTURE.md`, since rewritten as a topic-ordered game design doc.

