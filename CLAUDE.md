# exec-fn

ADHD scaffolding for Wai. Claude runs planning pipeline.

---

## RULES — READ FIRST

**TWO CONTEXTS — know which you are before deploying:**
- **Droplet claude** — cwd is `/exec-fn` on the server (hostname `main`). You ARE the live working tree: edit files in place and they go live (see *Live edits*). No SSH, no `git pull`, no `reset`. Commit + push to origin. **NEVER `git reset --hard`** — it would discard your own uncommitted edits.
- **Local claude** — cwd is `~/src/exec-fn` on the home box (WSL). You edit a dev MIRROR; nothing is live until you commit + push + deploy to the droplet over SSH (see *Local-claude deploy*).

**Live edits (droplet claude, editing `/exec-fn` directly):**
- *Templates/static* are live on next page load — `api/templates/` read per request via `_tmpl()`; `web/static/index.html` per request via `_index_pages()` (mtime-cached); `web/` served directly by FastAPI. No restart.
- *Python* is live too — `./api` is volume-mounted to `/app` and uvicorn runs `--reload`, so editing any `api/*.py` auto-reloads the worker (1–2s). No `docker cp`, no rebuild. (If `--reload` misses a change: `docker compose restart api`.)

**Local-claude deploy — push, then deterministic reset over SSH, never `git pull`/`git stash`** (the bind-mounted untracked dirs make pull/stash fragile; both have caused outages). `git stash` is blocked by a hook — clear a rebase blocker with `git checkout -- graphify-out/`. Why, and the `/nightfall` lazy-mount history: **ARCHITECTURE.md §1**. After `git push` from `~/src/exec-fn`:
```bash
ssh wai-root@wai-lau.net 'cd /exec-fn && git fetch origin && git reset --hard origin/master && sudo docker compose up -d --force-recreate api'
```
**NO `sudo` on the git half** — only docker needs it (root-owned socket). `sudo git reset --hard` leaves root-owned sources that then need `sudo` to edit; the tree was chowned back to `wai-root` on 2026-09-12 — keep it that way. `reset --hard` discards the droplet's `graphify-out` drift (re-run `/graphify` or commit it first); untracked `nightfall-incident` survives; `--force-recreate` rebuilds the mount namespace. **ARCHITECTURE.md §1**.

**Auto-deploy is the expected workflow** (local claude) — the owner wants code changes pushed to the live droplet via the SSH deploy above (confirmed after weighing the outage risk); deploy yourself, don't hand the command back to run manually.

**PYTHON DEPS ARE LOCKED.** Edit `api/requirements.in` (the direct deps, hand-edited), run `bash scripts/lock-requirements.sh` to regenerate the full `requirements.txt` lock, then **rebuild and check a route** — a resolve verifies nothing. Anything `api/` imports by name gets its own `.in` line (an unpinned rebuild dropped `httpx` → 502 on every route, 2026-09-17). Both `httpx` and `httpx2` are in the lock on purpose — don't remove either. **ARCHITECTURE.md §1**.

**Rebuild only if** `Dockerfile`, `requirements.txt`, `entrypoint.sh`, or `exec-fn.cron` changed:
```bash
docker compose up -d --build
```

**COMMIT after each discrete fix.** Don't batch.

**PRE-COMMIT HOOK** (`scripts/pre-commit`; `.git/hooks/pre-commit` symlinks to it — `bash scripts/install-hooks.sh` on a fresh clone, `bash scripts/pre-commit` by hand). Every check gated on what is staged: ruff, JS syntax + ESLint (`max-lines-per-function: 100`), stylelint, palette lint, scale lint, **cache-bust lint** (a changed asset must bump its `?v=` on every `api/` reference in the SAME commit), shellcheck, 500-line cap, no-multiline-inline-JS/CSS, fixture resolution, page smoke tests, admin-tier guard (route list enumerated from decorators), and the CLAUDE.md 140k cap. **Adding a colour, alpha, shadow or z-index is deliberate**: make the change, eyeball it on `/UI`, then `python3 scripts/lint-colors.py --update` (or `lint-scale.py --update`) and commit the baseline. Snap onto the scale with `python3 scripts/scale-codemod.py [file...]` / `--write`. **ARCHITECTURE.md §13**.

**CLAUDE-CODE COMMIT GUARD** (separate from the shell hook above — fires only when committing *through Claude Code*, not bare terminal `git commit`): a PreToolUse hook (`.claude/settings.json` → `.claude/hooks/docs-commit-guard.sh`) blocks a commit that stages `api/*.py`/templates without also staging `CLAUDE.md`/`ARCHITECTURE.md`. Claude updates the docs (or adds `[skip-docs]` to the commit message if none are warranted), then retries. Deterministic detection; doc-writing is the agent acting on the deny reason.

**CLAUDE-CODE GUARD SET** (`.claude/hooks/`, registered in `.claude/settings.json`; every one **fails open**): the docs guard above, `git-stash-guard.sh`, `push-after-commit.sh` (pushes after a commit, rebases on rejection, never stashes, never publishes a new branch), `deploy-healthcheck.sh` (curls `https://wai-lau.net/` after commit/push/deploy), `nightfall-build-guard.py`, `dead-file-guard.sh` (`Netmap.tsx`), `session-context.sh` (droplet-or-local by hostname). Every Bash-matching hook routes through `cmdscan.py` so it matches an INVOCATION, not a mention. **ARCHITECTURE.md §13**.

**UPDATE CLAUDE.md** when routes, pipelines, data files, schemas, or naming conventions change — **as an INDEX, one short line + a pointer to the ARCHITECTURE.md section.** Measurements, traps, tuning values and incident stories go in ARCHITECTURE.md / ARCHAEOLOGY.md, never appended to an existing CLAUDE.md row. Pre-commit blocks CLAUDE.md over **140k chars** (Claude Code stops loading it past 150k; it hit 211k on 2026-09-27).

**NO INLINE JS/CSS in templates; 500-line cap on `.py`/`.js`; 100-line per-function cap on staged `web/*.js`.** Extract to `web/<page>.{js,css}` (a one-liner handler may stay inline); split an oversized file on a real seam — modules, or same-global-scope files loaded in order. Enforced by pre-commit. Existing splits: **ARCHITECTURE.md §13**.

---

## System overview

| Layer | What |
|-------|------|
| Droplet | DigitalOcean NYC1, `168.144.13.51`, `wai-lau.net` |
| nginx | Bare-metal, SSL termination, proxies → port 8080 |
| FastAPI | All routes + API endpoints (`api/main.py`) |
| Docker | Single container, `TZ=America/New_York` set in compose |
| Cron | Inside container — fires `POST /api/morning` at 4:30 AM ET |

**When testing TTS, switch the GPU to `homo` first** (`POST /api/hosaka/mode {"action":"homo"}`) — on `idle` the models load on demand and first-byte latency is ~4.6s of cold load, which reads as broken and hides the real number; loaded it is **0.36s** (measured 2026-09-10, nicole/kokoro). From a box that was fully OFF the first synth is worse still: **10.3s** to first audio, with the next two at 704ms / 433ms (measured 2026-09-20).

Models: `claude-opus-4-8` for reasoning, chat, voice, and the nudge graph; `claude-haiku-4-5` for two cheap classification calls — NL date-parse (`card_llm.parse_date_natural`) and gcal event batch-classify (`gcal._haiku_classify_batch`). `classify_card` stays on opus. Auth: `ANTHROPIC_API_KEY` in `.env` — these are pay-per-token API calls, NOT a Claude subscription.

**Prompt caching** (`cache_control: ephemeral`, 5-min TTL) on the static system prefixes of **Tarot**, **MTG** and **Exec chat**. **Opus will not cache a prefix under 4096 tokens — silently.** Rule when editing any of them: the marker goes on a byte-stable block, anything per-turn goes elsewhere. Call sites + token counts: **ARCHITECTURE.md §5**.

---

## File map

The file/symbol map now lives in the knowledge graph (built with `/graphify`): open `graphify-out/graph.html` in a browser, or read `graphify-out/GRAPH_REPORT.md`. Regenerate after structural changes with `/graphify`.

**Typewriter (`web/typewriter.js`)** — every chat surface reveals a reply character by character: `twAudio` paces to the measured utterance when the voice is on; `twGuess` is the silent pace (`/tarot` 1.25, `/cc`/`/mtg`/Exec panel 5; `/tarot` leads the voice by 350ms). Markdown SYNTAX is jumped, never typed, and costs zero reveal time. The waiting indicator is a blinking block. Each surface **awaits the reveal before its settle pass**, but narration must start BEFORE that await. A reveal must never hang — every failure path ends at the guessed pace. **ARCHITECTURE.md §18**.

---

## Terminology

| Term | Meaning |
|------|---------|
| R&D | Main board — all cards (`rd.json`) |
| r&d column | Upcoming ideas/backlog — card added here by default |
| hq column | Active working set |
| archives column | Completed tasks |
| exile column | Won't-do tasks |
| HQ | 7-day planning view — assigns `scheduled_day` to cards. Today (timeline) is a tall column on the LEFT; the other 6 days are full-width **rows** stacked to its right (`dayRowHtml`), each with a vertical-text day-label spine and cards flowing horizontally (`.hq-list-row`, ≥3 cards visible per row, `--fs-2xs` text) |
| scheduled_day | ISO date field on a card indicating which day it's planned for |
| recur_type | Recurrence type; when archived, clone auto-created with advanced due_date |
| reader / querent | Tarot terminology: reader = AI; querent = human |
| Significator | Court card chosen by the reader during Phase 1 to represent the querent; removed from deck before draw |
| frame | Tarot Three-Card frame: `past_present_future` or `situation_obstacle_advice`; relabels position UI |

---

## Web app

`/` is a public landing page — a ferris wheel of nine sections (`_landing_html()` in routes_views, `web/landing.css`, `web/landing-wheel.js`), no auth, no exec bubble; logged-in admins 302 to `/rd`. The geometry solves itself per viewport (`wheelGeometry`) — never hard-code slot counts. **ARCHITECTURE.md §9**.

Cyberpunk fx — the shared CRT stack `_CRT_FX`: five fixed `pointer-events:none` layers at `--z-modal`; **paint order `bg → lines → blur → crt → scan` is load-bearing**. **Never put a `backdrop-filter`/`mix-blend-mode` layer over anything animated** (it re-reads the whole viewport every frame, forever), never give `.cyber-scan` a blend mode. `/rd`, `/hq`, `/mtg`, `/cc` dim it to 0.75 via `web/crt-dim.css` with `opacity`, never by rescaling alphas. Both login screens carry it too. **ARCHITECTURE.md §10**.

Two cookie auth tiers:
- `session` cookie (set via `POST /login`, requires `API_KEY`) — full access. Login form at `GET /login` (already-authed visitors redirect to `?next=`/`/rd`).
- `guest_session` cookie (`POST /guest`, solving a **Cloudflare Turnstile** challenge; the page auto-submits on solve) — guest set: `/mtg`, `/tarot`, `/nightfall`, `/hosaka`, `/graph`, `/UI`, `/security`, `/printer` (read-only), `/zombo` (unlinked, still gated). Token derives from `TURNSTILE_SECRET`; no guest bearer. `GET /guest-login` → 302 `/guest`.

Both cookies: `HttpOnly`, `SameSite=Lax`, `Secure`, `Max-Age` 400 days (`auth.SESSION_MAX_AGE`) — logins survive restarts because the COOKIE lives long; rotating `API_KEY` is the only revocation. **The guest page set lives in three places that must stay in sync**: `_GUEST_NEXT_ALLOWED` (`/guest` `next`, else `/mtg`), the 401 handler's guest prefix tuple in `main.py` (`/printer` matched exactly), and the router tiers — or a gated page bounces guests to the admin login. **ARCHITECTURE.md §20a**.

Nav: `✦` (`/cc`, owner-only, first) · `R&D` · `HQ` · `DBG` · `BOT` · `GPH` · `UIX` · `12AM` · `MTG` · `TRT` · `HSK` · `3DP` · `CV` — fixed 3-char codes (`_NAV_LABELS`). The guest nav (`_GUEST_NAV_LINKS`) carries the guest-gated ones, pinned against the landing by `tests/test_landing_nav_parity.py`. Icons are GENERATED traced pixel-art SVGs (`scripts/trace-icons.py` → `web/icons/`) — edit the script, never the SVGs. Non-ASCII labels re-font via `.nav-label.glyph`, sized by `transform`, never `font-size`. Standalone launch adds `F5` (guest nav always). **Exec is NOT a nav entry** — a floating bubble (`#exec-bubble`) under the CRT stack, hidden while its panel is open: on `/rd`+`/hq` it toggles the panel, elsewhere navigates to `/hq?exec=open`; guests get none. The panel speaks (`exec-voice.js`), listens (`exec-mic.js`) and holds a scratch todo list (`exec-todos.js`). Non-`full_height` pages scroll inside `.page-scroll`. **ARCHITECTURE.md §12**.

### The voice (shared engine, shared control)

**Three surfaces speak, one stack does the work.** `/tarot`'s reader, the **Exec panel** and `/cc` share `web/hosaka-audio.js` (the player + `/ws/hosaka`), **`web/voice-narrator.js`** (the narrator core — player lifecycle, the persisted on/off, the iOS unlock, the queue, and the controller a typewriter paces to), **`web/voice-ui.js` + `voice-ui.css`** (the `.voice-mute` toggle and the tap-to-replay glyph, deliberately position-free like chat-msg.css), `web/voice-util.js` (markdown → spoken prose) and `web/typewriter.js` (`twGuess`/`twAudio`). `exec-voice.js` and `tarot-voice.js` are BINDINGS over that core, holding only what is genuinely theirs.

**Which voice, and from which machine, is the load-bearing difference.** Exec and `/cc` speak **`glados` on `piper`, which is a container on THIS droplet** — their voice works with the home box asleep. `/tarot` speaks **`nicole` on `kokoro`, from the home GPU box over the SSH tunnel**, and is the only surface that can lose its voice (hence `tarotVoice.probeHome()` and the offline note). Exec + `/cc` share the `exec.voice` localStorage key, so one toggle governs both; `/tarot` keeps `tarot.voice`.

**OFF means off, not muted** (changed 2026-09-20 — the `/tarot` button used to be a volume mute that kept narrating and kept pacing the reveal to audio nobody could hear). Nothing is synthesized, no socket opens, `speak()` returns a DEAD controller, and the surface types at its own fast pace. One flag, no second state to keep in sync.

**Voice goes both ways on all three.** `voice-input.js` is the mic engine + `bindComposer`; `cc-mic.js`/`exec-mic.js`/`tarot-mic.js` are thin bindings. A final result ARMS a send 1s out (`SEND_DELAY_MS`) rather than sending. **The mic drops everything heard while a reply streams or the narrator `isSpeaking()`** — else the page answers its own narration. **ARCHITECTURE.md §4c, §7k**.

### Chat surfaces (shared CSS)

`/mtg`, `/cc`, `/tarot` and the **Exec panel** are ONE transcript look in four stacked files — they used to be three near-copies of the same forty lines, drifting a value at a time. **`web/chat-dom.js` is the same argument in markup**: `chatStreamDiv()` (the assistant bubble + its waiting cursor) and `chatCaret()` (the contenteditable's drawn caret) had four copies each, and the panel's caret was still missing the try/catch the other three grew after WebKit threw `IndexSizeError` on a stale selection and blanked the page mid-send. One copy cannot drift.

- **`chat-msg.css`** — the vocabulary (`.msg` roles + markers, markdown, composer, and the `.mic` prompt states `/cc` and the panel share). **Deliberately position-free**, so the same rules work in a panel that slides in and a terminal pinned to the window. Loaded by the three pages AND injected on `/rd`+`/hq` by `exec-bubble-assets.js` **before** `exec-bubble.css` — order is the cascade, and a swap hands the pages' rules the last word over the panel's.
- **`chat.css`** — the full-page shell only: non-scrolling body, `#terminal` pinned to the window, `#input-bar` above the keyboard.
- **`chat-doc.css`** — `/mtg` + `/cc`: the document palette + the `--kb-anchor`/`--input-h` terminal inset.
- **`chat-reader.css`** — `/tarot` only: the neon reader mood, `--lh-relaxed` over the dense shared default.

**One gutter.** Every marker (`>` `$` `#` `~` `+`) hangs in a fixed `1ch` column (`--chat-gutter`); `.msg:has(> .msg-mark)::before { content: none }` must sit AFTER the role markers. Dense by design (`--lh-tight`). **ARCHITECTURE.md §18**.

**A link Exec names is a link Wai can tap.** Prompts (`chat._CHAT_STATIC_PREFIX`, `nudge_llm._TONE`) require markdown links, never a bare URL or a naked "the link"; `mdHtml()` in `exec-bubble-assets.js` renders `target="_blank"`. **ARCHITECTURE.md §18f**.

**Headless WebKit will not composite the panel's `backdrop-filter` into a screenshot** — neutralise it (`backdrop-filter:none`) when verifying the panel, and do not read a blank panel as a regression.

File split, the jump table and the gutter rules: **ARCHITECTURE.md §18**.

### Pages

| Route | What |
|-------|------|
| `/rd` | R&D board: four columns, reminders + books bars, and a month calendar (`web/rd-calendar.js`) — one dot per card, width by importance; drag a card onto a day to schedule it. Archiving PRESERVES `scheduled_day`. Gesture surfaces need `touch-action:none` + window listeners, no `setPointerCapture`; bar heights via `ResizeObserver`. **ARCHITECTURE.md §8**. |
| `/hq` | 7-day planning: today's timeline = tall left column (16h window), other 6 days = rows (`dayRowHtml`). Stays in sync with `rd.json` via SSE `{cards_changed}`, SSE reconnect and wake catch-up, all gated by `hqCanReload()` — **`flushUpdates()` must null `saveTimer` as its first statement** or every reload is silently skipped. Breakdown cards render as a spine view; tap a task to mark it done. **ARCHITECTURE.md §20b**. |
| `/debug` | Profile notes + cron archive + activity logs + mtg log + saved tarot readings, on the shared **document theme** (`.doc-card`/`.doc-h2`/`.doc-chip` in chrome.css, raw palette tokens, no `--doc-*` layer). Moltbook plumbing outside the page (`morning.py` log rotation, `graph_scrub._drop_graph_moltbook_nodes`) is deliberately kept — not dead code. **ARCHITECTURE.md §20c**. |
| `/security` | **Guest-gated.** Bot/scanner traffic page (`security.py` `render_security()`) from `data/security.json`, written out-of-band by the HOST cron `scripts/security/refresh.py`. **Renders no owner-identifying data** (no owner IP, attacker-IP table, usernames). Deliberately no UA-based human/bot split. **ARCHITECTURE.md §20d**. |
| `/graph` | **Guest-gated** (Turnstile). graphify codebase viz from `./graphify-out` (rebuilt nightly 05:00), served by `graph_page()` in `routes_graph.py`. **Every transform is applied at SERVE time to graphify's emitted HTML/JS, never an edit to the generated file** (rebuild overwrites it); memoised per artifact `(mtime_ns,size)` + per tier, warmed at startup by `run_graph_warm_loop`. `_externalise_boot` MUST run last (scrubs + `graph_layout_key` operate on the inline JSON). Layout is BAKED nightly by `scripts/graph-layout.py` (two bakes, wide+tall); **any drop/merge change alters `graph_layout_key` → re-run the bake**. Modules: `graph_scrub.py` (privacy scrubs + drops), `graph_style.py` (communities, palette, labels), `graph_geometry.py` (shape/size/occlusion). Client: `web/graph-cover.js` (loading bar), `graph-overlay.js`, the cascade `graph-pulse.js`/`graph-pulse-draw.js`, and the nine-file audio stack (`graph-source`→`bands`→`audio`→`bias`→`tempo`→`seed`→`lit`/`glow`→`pulse`). Keep `_GRAPH_BG` equal to `--bg-hsl`; `SIZE_FLOOR`/`SIZE_CEIL` mirror graph_style's size range. Full notes (every measurement, trap and tuning value): **ARCHITECTURE.md §11g** + §11a–f (history: **ARCHAEOLOGY.md §11**). |
| ~~`/emet`~~ | **UNLINKED 2026-09-10** — nav entry removed and `import routes_emet` dropped from `main.py`, so `/emet` + `/api/emet/*` are 404 and nothing reaches the home-box MCP. The code is deliberately KEPT in tree (`api/routes_emet.py`, `api/emet_client.py`, `api/templates/emet.html`, `web/emet.{css,js}`, the `golem-stone.png` icon) — re-link by restoring the `main.py` import and the four `emet` entries in `pages.py`'s nav tables (`_NAV_LINKS`/`_NAV_HREFS`/`_NAV_ICONS`/`_NAV_LABELS`). It was an owner-only test harness for Wai's emet knowledge-graph MCP (FastMCP on the home box, reverse-tunnelled to `172.17.0.1:8125/mcp` like hosaka/printer), wrapping its recall/scope/ask tools 1:1. |
| `/cc` | **Owner-only, and must NEVER move to `guest_protected`** — it hands the caller a shell on the droplet host as `cc-agent` (pinned by `tests/test_cc_admin_only.py`). Claude Code in the browser: host sidecar `claude-box/server.mjs` at `172.17.0.1:8129` via `cc_client.py` + `routes_cc.py`. Full agent, 24 tools (11 built-in + 3 archive + 10 Exec card tools relayed by `exec-tools.mjs` to `/api/exec/tool/*`), an ALLOWLIST (SDK `tools` option + hand-written `EXEC_TOOLS`), cwd a private sandbox; path tools confined by `sandbox-paths.mjs`; `Bash` bounded only by the mount namespace (decided — don't re-litigate); credential exfil via WebFetch is an accepted risk. Must-knows: tool set re-probed on SDK bumps (a cold probe shows 22 — `BashOutput`/`KillShell` appear only on demand — and no `UNEXPECTED`); a subscription login inherits that account's claude.ai connectors (Gmail/Calendar/Drive) — `strictMcpConfig` drops them, re-probe after enabling one; edit `cc-context.md` then reinstall to `/srv/cc-agent/`; the session pointer is server-side and `/new` must archive before dropping it; the abort listener goes on `res`, never `req`. **ARCHITECTURE.md §7**. |
| `/UI` | **Guest-gated** (case-sensitive). Read-only palette + scale moodboard, live counts from `/api/ui/usage`. Edit colours/scale in chrome.css; this page only watches. **ARCHITECTURE.md §20e**. |
| `/nightfall` | Standalone game (guest auth). **Save slots are scoped PER CALLER** (`gamesave_store.py`): owner at `data/gamesave_<slot>.json`, guests under `data/gamesave_guests/`, keyed by an `nf_save` cookie minted on the PAGE response and hashed before touching the filesystem. Replaced global slots that let guests overwrite Wai's save (2026-09-01); pinned by `tests/test_gamesave_store.py`. **ARCHITECTURE.md §20f**. |
| `/hosaka` | **Guest-or-full** TTS page (default voice `charlie`) streaming from the home GPU box via a same-origin WS proxy (`routes_tts.py`). Presence count (`/ws/hosaka/presence`; `/tarot` readers count too) and an owner-only GPU-mode strip (`web/gpu-mode.{css,js}`; the button labelled `down` sends `idle`) that live-syncs over SSE. **ARCHITECTURE.md §4**. |
| `/printer` | Wai's ELEGOO Centauri Carbon, reverse-proxied from the home LAN (`routes_printer.py`, `printer_proxy.py`, `printer_camera.py`, `printer_status.py`). **Owner**: the full SPA (drives the machine). **Guest**: read-only camera (pulled via `/printer/frame`, ~10fps) + job strip, no controls. Read-only is enforced by which ROUTES a tier reaches (`/printer/{path}` and `/ws/printer` stay owner-only). **Bump `REWRITE_VERSION` when a rewrite rule changes**; `/printer/video` must stay on the `public` router with its tier checked in-handler. **ARCHITECTURE.md §6**. |
| `/mtg` | MTG rules assistant (semi-public, guest auth). Card names show a Scryfall image preview on hover; rule citations (e.g. `724.1b`) show the rule text on hover/tap (mtg.js `_linkifyRules` wraps them, fetches `/api/mtg/rule/{number}`). The `lookup_card` tool (`mtg/lookup.py`) returns each card's official WotC **rulings inline** (`_attach_rulings` folds `rulings-slim.json` into the summary) — one call pulls ALL of a card's info, so the model reasons from the deciding rulings rather than oracle text alone (`lookup_rulings` is now a bare-oracle_id fallback). |
| `/tarot` | Tarot reading (guest auth), five-phase flow (§ *Tarot reading flow*), state in `localStorage`, no server persistence. The first reader turn is pre-generated per hour (`web/tarot-opening.js`, `api/tarot/openings*.py`, `data/tarot_openings/`); `/api/tarot/warm` loads models meanwhile. Narration `nicole` comes from the home box — the one voice that can go offline, and the page says so. Chat holds only reader/querent prose; sys notes go to the `#tarot-status` bar (`isHiddenLine()`). Mic via `tarot-mic.js`. `web/tarot-ambient.m4a` is gitignored and **the server holds the only copy**; set its level by measuring dBFS. **ARCHITECTURE.md §14**. |
| `/zombo` | **SECRET + guest-gated** — unlisted is not a tier (still in `_GUEST_NEXT_ALLOWED`, the 401 prefix tuple, `GUEST_PAGES`). The real 1999 Flash intro via Ruffle, **hotlinked** from welcometozombo.com, never vendored (`web/zombo-flash.js`, `api/routes_zombo.py`). Traps: Ruffle needs `base`; hand over on `loadedmetadata`, never `load()`; colour/jitter by class from a running index, never `:nth-child`. The newsletter link is rewritten in the loader's bytes at equal length. **ARCHITECTURE.md §19**. |
| `/recruiter` | **Public.** Static résumé (`recruiter_page()`, `templates/recruiter.html`, `web/recruiter.css`), light theme on page-local `--cv-*` tokens, no nav. Dark toggle (`#cv-theme`) → terminal look with the full 5-layer CRT stack and the summary type-out (dark only). **ARCHITECTURE.md §20g**. |
| `/noodle/<slug>` | **Public by unguessable link; `/noodle` (create/list) owner-only.** Standalone Doodle-style poll (the first voter HOSTS: guests pick only from the host's halves), package `api/noodle/`, state `data/noodle/polls/`. **Imports no other app module** (pinned by `tests/test_noodle_isolation.py`); the owner tier comes from `routers.py` mounting `owner_router` on `protected`. Passphrase -> Argon2id (worker) -> Ed25519, signed votes; results are on the vote page (dots + roster); identity + an unsubmitted draft kept in localStorage (never a cookie) until submit sends only `{name, pub, slots, ts, sig}`; every non-ASCII glyph single-width via `web/fonts/noodle-seal.woff2`. Owner key reset: `docker compose exec api python -m noodle.reset <slug> "<name>"`. **ARCHITECTURE.md §21**. |

### API endpoints

| Method | Path | What |
|--------|------|------|
| POST | `/api/morning` | retrospective, purge stale notes, archive activity_log, reset chat (4:30 AM cron) |
| GET | `/api/rd/log` | Today's activity log (last 20 entries) |
| GET | `/api/rd` | Returns rd.json |
| PATCH | `/api/rd` | **Merge-by-id, NOT whole-array replace** (`helpers._merge_cards`): clients send only touched cards + fields; omitted fields (esp. server-owned `nudge`) are preserved. Runs schedule side-effects (`_apply_patch_schedule`), recurring revival, monitor debounce. **ARCHITECTURE.md §20h**. |
| POST | `/api/rd/{card_id}/schedule` | Drop a card on a /rd calendar day (`{date}`); keeps an existing clock time; 409 if it would defer an active nudge. **ARCHITECTURE.md §8**. |
| POST | `/api/rd/classify` | Classify card via LLM → category + size |
| GET | `/api/context` | Returns profile.json (alias of `/api/profile`) |
| GET | `/api/profile` | Returns profile.json |
| PATCH | `/api/context` | Replace profile.json `notes` field. Atomic write. |
| GET/POST/DELETE | `/api/chat` | Exec chat history (planning SSE). |
| GET | `/api/todos` | Exec-panel scratch todo list (`exec_todos.json`): `{items:[{id,text}]}`. |
| POST | `/api/todos` | Add a todo. Body `{text}` → appends `{id,text}`, returns the item. 400 on empty. |
| PATCH | `/api/todos/{id}` | Edit a todo's text. Body `{text}` → updates in place, returns the item. 400 on empty, 404 on unknown id. Tap the item text in the exec panel to inline-edit (Enter/blur commits, Escape reverts). |
| DELETE | `/api/todos/{id}` | Delete a todo (checkbox = delete, not archive). |
| GET | `/api/monitor/stream` | SSE `{thinking}`/`{comment}`, plus `{cards_changed:true}` on any serverside `rd.json` rewrite (relayed as `exec:cards-changed`) so open boards refetch. |
| POST | `/api/monitor/flush` | Force-fire the monitor immediately if there is significant activity since the last comment (bypasses 60s debounce). |
| POST | `/api/nudge/tick` | Manual one-shot tick of the nudge loop (the in-process asyncio loop in `main.py` runs this every 30s; started from the FastAPI lifespan hook — no cron). |
| GET | `/api/gcal/auth` | Initiate Google Calendar OAuth |
| GET | `/api/gcal/callback` | Receive OAuth code, save token (public; constant-time state check) |
| POST | `/api/gcal/import_cards` | One-time import of GCal events as rd.json cards |
| GET | `/api/hq` | 7-day week data starting from `?start=YYYY-MM-DD` (defaults to logical-today): scheduled cards + unscheduled hq cards |
| PATCH | `/api/hq` | Bulk update `scheduled_day` and/or `order` on cards; logs `rescheduled` entries with `source=hq`. Cards unscheduled (null) drop back to `column=rd`. |
| GET | `/api/hq/log` | Activity log filtered by source=hq |
| POST | `/api/parse_date` | Parse natural language date → ISO via LLM |
| GET | `/api/debug/logs` | All activity log files (today + archived), newest first |
| GET | `/api/debug/cron` | Every cron job's output, newest day first: `{days:[{day, jobs:[{job, bytes, text}]}]}`. Reads `data/cron/YYYY-MM-DD__job.log`. A file over 20K is cut from the FRONT (the tail is what matters after an overnight failure); an unreadable one is skipped rather than 500ing the viewer. |
| GET | `/data/{filename}` | Serve file from /app/data/ (path-traversal guarded) |
| GET | `/api/ui/usage` | Public. Token reference counts, used alphas and usage sites across templates, web assets and all `api/*.py`; feeds `/UI`. |
| GET | `/api/mtg/log` | **Owner-only** (`protected`, defined in routes_views.py — NOT the guest `mtg_router`). All MTG session transcripts for the `/debug` viewer; returns every session unscoped and the store is shared across auth tiers (holds Wai's own /mtg chats), so guests must never reach it. Same rationale as `/api/tarot/readings`. |
| GET | `/api/mtg/rule/{number}` | Rule text for the hover/tap preview (`lookup_rule` by number, e.g. `724.1b`). |
| POST | `/api/mtg/chat` | mtg chat (tool-use over rules) SSE. In-process per-IP rate limit (20 req / 60s), mirroring `/api/tarot/chat`. |
| GET | `/api/tarot/spreads` | Spread layouts (position coords/labels) |
| GET | `/api/tarot/cards` | 78-card canonical list (id/name/image) |
| POST | `/api/tarot/draw` | Body `{spread_type, significator_id?}` → fresh draw with reversed flags. Significator removed from deck before draw. No server persistence — client stores in `localStorage`. |
| POST | `/api/tarot/chat` | Body `{messages, spread: {type, revealed, face_down_positions, significator?}}` → SSE stream. Server told only about revealed cards; face-down identities never leave the browser. In-process per-IP rate limit (20 req / 60s); message history capped (last 40 messages, per-message content clamped to 4000 chars) before the LLM call. |
| POST | `/api/tarot/save` | Body `{significator?, spread?, messages}` → append reading to `tarot_readings.json`. Called by `resetAll()` before wiping local state. Owner-only: saves only when full `session` cookie present (Wai); guests no-op (their readings stay localStorage-only). No-op on empty reading. |
| GET | `/api/tarot/readings` | Full-auth (`protected`, not guest tarot router) → `{readings: [...]}` from `tarot_readings.json`. Rendered in `/debug` tarot-readings section. |
| GET | `/api/tarot/opening` | One of the hour's pre-generated opening turns: `{clip:{id,text,dur,audio}}`, or `{clip:null}` when the hour has none (page then generates the opening live). `?hour=` is the CLIENT's hour, so a querent in another timezone opens on their own light; out-of-range wraps rather than 500ing. |
| GET | `/api/tarot/opening/{id}.wav` | That clip's rendered narration (16-bit 24kHz mono). `immutable` — the id is content-unique. The id shape `h<HH>-<8 hex>` is validated before it touches the filesystem, so it can safely be a path component. |
| POST | `/api/tarot/warm` | Load the TTS models now, while the querent reads the canned opening — the opening needs no synth but the reader's NEXT turn does, and under GPU mode `idle` models load on demand. Server-side 300s cooldown; rate-limited like the chat routes. |
| GET | `/api/gamesave/{slot}` | Nightfall save slot read. **Guest-or-full** (the game is guest-playable); slot names allowlisted (`VALID_SLOTS`). **Scoped per caller** — see below. |
| POST | `/api/gamesave/{slot}` | Nightfall save slot write (guest-or-full; atomic temp+rename; 400 on malformed body; **413 over 64KB**). |
| DELETE | `/api/gamesave/{slot}` | Nightfall save slot delete (guest-or-full) — deletes the CALLER's own slot only. |
| GET | `/api/hosaka/voices` | Guest-or-full. Proxies the TTS upstream's `/v1/voices` list (empty list on upstream error). |
| GET | `/api/hosaka/health` | Guest-or-full. Probes the TTS upstream → `{ok:true}` or 503 `{ok:false,detail}`. Liveness = a real response (the reverse-tunnel port stays bound when the home server is down). `/hosaka` polls it to show "TTS server offline". |
| GET/POST | `/api/hosaka/mode` | **Owner-only.** GET → `homo`/`emo`/`idle`/`gone`, corrected against reality (claimed `homo` with no live TTS → `idle`; 90s grace after a switch). POST `{action, force?}`; 409 if it would cut off users. **ARCHITECTURE.md §4b-ii**. |
| GET | `/api/hosaka/mode/stream` | **Owner-only** SSE: `{mode}` on every switch + a 15s poll of the real mode. |
| WS | `/ws/hosaka` | TTS audio proxy; closes 1008 without a `session`/`guest_session` cookie. **Every utterance is guaranteed a terminal frame** (synthesized error if upstream dies mid-utterance). **ARCHITECTURE.md §4d**. |
| WS | `/ws/hosaka/presence` | Presence count; same cookie gate; server broadcasts the TOTAL, each client subtracts its own socket. |
| GET | `/api/cc/health` | **Owner-only.** `{ok, busy, active, authed}`, or `{ok:false, unreachable:true}`. |
| GET | `/api/cc/sessions` | **Owner-only.** `{current, sessions:[{id,title,modified,bytes}]}` — past conversations for the `/list` picker, newest first, scoped to the sandbox's own `cwd`. Titles come from the `cc_titles.json` cache where one exists (read-only), else the SDK's summary. Unreachable degrades to an empty list. |
| POST | `/api/cc/resume` | **Owner-only.** Body `{sessionId}` → points the sidecar's session pointer at an existing conversation. Refuses anything that is not a uuid AND not one of this sandbox's sessions. Non-destructive: the pointer moves, the transcript replays. |
| GET | `/api/cc/title` | **Owner-only.** Rolling 3-6 word haiku title (`cc_title.rolling_title`, cached in `data/cc_titles.json`), generated on the subscription via the sidecar. Never raises. |
| GET | `/api/cc/limits` | **Owner-only.** `{ok, five_hour:{pct,resetsAt}, seven_day, seven_day_opus}` — the subscription's usage windows for the /cc status bar, via the sidecar's `/limits` → `api.anthropic.com/api/oauth/usage` with cc-agent's OAuth token (which never leaves the sidecar). `{ok:false}` when logged out or unreachable, never an error: the bar omits what it cannot stand behind. |
| GET | `/api/cc/history` | **Owner-only.** `{sessionId, messages:[{role,text}]}` — the ongoing conversation, replayed on page load. Unreachable degrades to an empty thread, never an error: the page must still open and accept a message. |
| POST | `/api/cc/new` | **Owner-only.** Ends the current conversation by dropping the sidecar's session pointer. Non-destructive — the previous transcript stays on disk. |
| POST | `/api/cc/query` | **Owner-only.** `{prompt, images?}` → SSE relayed verbatim from the sidecar. 400 empty, 413 over limits. Failures arrive as an `error` FRAME, never raised. |
| GET | `/api/exec/tools` | **Sidecar token only** (`x-cc-token` = `CC_SIDECAR_TOKEN`; admin/guest creds are refused). Exec's card-tool schemas, from `chat._chat_tools()`. `public` router, checked in-handler (`routes_exec.py`). **ARCHITECTURE.md §7c-bis**. |
| POST | `/api/exec/tool/{name}` | **Sidecar token only.** Runs one Exec card tool via `exec_tools.run_tool` (the same dispatcher the chat path uses) → `{result}`; pushes `{cards_changed}`. |
| GET | `/api/printer/health` | Guest-or-full. `{ok:true}` 200 when the printer's SPA shell answers through the tunnel, `{ok:false}` 503 otherwise (printer off / home box asleep / tunnel down). `/printer` polls it to mount/unmount the SPA iframe (owner) or the camera (guest). |
| GET | `/api/printer/status` | Guest-or-full, **read-only**. Whitelisted machine state (`online`, `state`, `job_state`, `printing`, `layer`/`total_layers`, `progress`, `elapsed_s`/`total_s`, nozzle/bed/chamber temps) from the shared SDCP listener, which never sends the printer a frame. No `MainboardID`/`TaskId`/`Filename` — the page is public. |
| ANY | `/printer/{path}` | **Owner-only** reverse proxy to the printer's `:80`, HTML/JS rewritten by `printer_proxy.py`; the session cookie never reaches the printer. |
| GET | `/printer/frame` | Guest-or-full. ONE camera JPEG newer than `?after=<seq>` (long-poll ≤5s; 204 = ask again; seq in `X-Frame-Seq`) off the shared hub's guest sample (~10fps) — the guest view's pull loop, which cannot queue and so cannot lag. Same `public`-router + in-handler tier as `/printer/video`. |
| GET | `/printer/video` | Guest-or-full MJPEG relay (the owner SPA's `<img>`), on the `public` router with an in-handler tier check. |
| WS | `/ws/printer` | SDCP control-socket relay to the printer's `:3030/websocket` — the ONLY browser→printer channel, and it stays owner-only. Public route, but closes (1008) unless the FULL `session` cookie matches (no guest tier — it drives the machine); 1011 when the printer/tunnel is down (the SPA retries). Printer→browser text frames get their `VideoUrl` rewritten to `/printer/video`. |
| GET | `/api/noodle/{slug}` | Public. Poll window + voters (name, pub, slots). **ARCHITECTURE.md §21**. |
| POST | `/api/noodle/{slug}/vote` | Public. Signed `{name, pub, slots, ts, sig}`; 403 wrong key/bad sig, 409 replay, 413 over 8KB. |
| POST | `/api/noodle/{slug}/ask` | Public. Haiku text -> a `reading` + RULES, applied to every date by code (`noodle/rules.py`) -> slots, clamped to the window, never submits; 422 if truncated; rolling rate limits (429 + `retry_after`, never a lifetime cap) in `noodle/config.py`. |
| POST | `/api/noodle/{slug}/settings`, `/remove` | Public, **host-signed** (`noodle/host.py`): split days or not + the CROP (first/last day anyone can pick; the first to act claims host), remove a guest. Host-only; the host drags crop lines on an always-endless calendar, guests just see the crop. |
| POST | `/api/noodle/{slug}/rekey` | Public, signed by the voter's OLD key: new passphrase and/or name (`noodle/rekey.py`). **ARCHITECTURE.md §21**. |
| GET/POST | `/api/noodle-polls` | **Owner-only.** List / create polls (`{title}` only). |

### Exec chat tools (bubble overlay)

Bound in `chat_tools._TOOL_HANDLERS`; schemas in `chat._chat_tools()`.

**Every Exec turn is TWO PASSES** (`api/chat_passes.py`, web + Discord): **ACT** (tools on, its text DISCARDED, tool rounds until it stops) then **REPLY** (`tool_choice: none`, streamed, reports only what the tool results show). A reply that finds a requested action missing answers `[redo: …]` instead — never shown, sent back to the act pass as an `[auto-check, not from Wai]` note (stripped before save), at most 2 times. Why: history is flattened without tool calls, so a single pass learned to SAY "Added X" without calling anything (2026-09-24, Nick/Jesse cards that never existed, with an invented card id). Cost: ~9s to first text on an action turn vs ~2s on a question. **ARCHITECTURE.md §5**.

| Tool | What |
|------|------|
| `create_card` | Add card. Default column `rd`; pass `column="hq"` for today. If `due_date` given, runs `_apply_schedule` → `scheduler.schedule_to_day()` (rd→hq on due day if in window, overdue clamped to today; `dir_start_min` for today). |
| `archive_card` | Mark a card DONE (column `archives`) — the chat-side twin of the card dialog's archive button. Only on Wai's word that the task is finished, never on Exec's own read of the board and never just because the last breakdown step was marked done. PRESERVES `scheduled_day` (the record of the day the work happened), resolves the card's nudge block, and revives a recurring card's next occurrence via `helpers.recurring_clone` — the same helper `PATCH /api/rd` uses, so both archive paths clone identically. |
| `exile_card` | Move card to exile column (drop / won't-do). Clears `scheduled_day`. |
| `update_card` | Edit title/category/size (importance)/estimated_time/prep_time/notes/is_reminder/is_book/no_rollover. Size is a manual importance rating — not derived from estimated_time. `estimated_time` is total (prep+event); `prep_time` is the decomposed prep slice (`estimated_time - prep_time` = the atomic event). |
| `schedule_card` | Set or clear `scheduled_day` via `scheduler.schedule_to_day()`. Beyond 7-day window → sets `due_date` only and parks in rd; inside window → moves to hq with `scheduled_day` (overdue target clamped to today). Target = today → a timed due_date pins `dir_start_min = event_time - prep` (`scheduler.timed_start_min`), else stacks via `scheduler.place_card_today()` (explicit `dir_start_min` overrides); other days clear it. |
| `update_context` | add/remove/replace a fact in `profile.json`. |
| `decompose_task` | Build/rebuild the card's **prep** breakdown (`card["nudge"]["graph"]`) and pick the first chunk; the atomic event block is appended automatically. Optional `feedback` rebuilds from the existing breakdown. Not for reminders/books (No-Rollover cards CAN decompose). |
| `advance_chunk` | Mark the current step done, surface the next open node; all done → `stage=resolved` (never archives — Wai archives). |
| `record_consequences` | Store Wai's answer to "what happens if this doesn't get done?" — the gate for any deferral of an active-nudge card. |
| `reschedule_after_consequences` | The ONLY path that moves an active-nudge card later. Hard-fails without a recorded consequences answer. Resets loop timing, keeps graph + metrics. |

Tarot tools (separate handler set in `tarot/tools.py`):

| Tool | What |
|------|------|
| `lookup_card_meaning` | Load Pollack chapter for a Major Arcana card. Returns `{error}` on Minor — Minors must be read from suit + numerology in the system prompt. |
| `set_significator` | Reader-side selection of the querent's court card after Phase 1 interview. Frontend fills the Significator slot when this returns. Rejects non-court ids. |
| `deal_spread` | End of Phase 2 — deals the Three-Card spread face-down. Requires `frame ∈ {past_present_future, situation_obstacle_advice}`. Frontend calls `/api/tarot/draw` after this fires. |

---

## rd.json card schema

```json
{
  "id": "card-<timestamp>",
  "title": "...",
  "column": "rd|hq|archives|exile",
  "category": "Interfacing|Hobby|Social|Self",
  "size": "wisp|idea|plan|commitment",
  "due_date": "YYYY-MM-DD or YYYY-MM-DDTHH:MM",
  "estimated_time": 30,
  "prep_time": 0,
  "notes": "...",
  "is_reminder": false,
  "is_book": false,
  "no_rollover": false,
  "recur_type": null,
  "scheduled_day": null,
  "dir_start_min": null
}
```

- `recur_type`: null | "week" | "bi-week" | "month" | "holiday" | "birthday"
- `scheduled_day`: ISO date — which day the card is planned for (HQ)
- `dir_start_min`: minutes from midnight — the card block's start (= prep start) for a card scheduled today. Timed due → pinned at `event_time - prep` (`scheduler.timed_start_min`); timeless cards stack from 10 AM. All scheduling lives in `scheduler.py`. **ARCHITECTURE.md §3b**.
- `size`: **importance** (low→high) `wisp | idea | plan | commitment` — a manual rating, NOT derived from time (estimated_time holds duration; no size→duration mapping). Drives card-fill intensity. Default `idea`.
- `estimated_time`: TOTAL minutes (prep + event) — the timeline block length read by scheduler + nudge.
- `prep_time`: of `estimated_time`, the decomposed **prep** minutes; the remainder (`work`) is the atomic **event** — but only when `prep_time > 0`. With `prep_time = 0` the whole time is decomposed and there is no event block. Edited as `cd-prep` + `cd-dur` in the card dialog. **ARCHITECTURE.md §3b**.

**The card dialog NEVER scrolls itself** (`web/card-dialog.js`): `.cd-body` is the only scroller, actions are a pinned footer; size to `dvh` (check 430x700 too), pad by `--nav-h`, hide the exec bubble while open; scrollbars silver. Its CSS is a JS template literal — **no backticks in its comments**. **ARCHITECTURE.md §20i**.
- `is_reminder`: true = calendar alert only, shown in reminders bar on R&D. Where one DOES render as a card (i.e. on `/hq`), `cardStyle` forces **wisp** regardless of `size` — a reminder is a note that a day exists, not work. This also catches gcal-imported reminders with `size: null`, which fell past every branch to the `else` and rendered as full commitment cards, the loudest thing on the board
- `is_book`: true = ongoing read — shown in books bar on HQ, hidden from rd/hq columns in R&D, never scheduled/decomposed (checkbox in card dialog, like `is_reminder`)
- `no_rollover`: true = a fixed occurrence that does NOT carry forward if its day passes (concert, flight, show, scheduled call) — the morning pipeline skips it when rolling past-dated cards to today. Default false (tasks roll forward until done). The **"no-rollover"** checkbox in the card dialog (renamed from the old "event" flag, field `is_event`, migrated on load by `helpers._migrate_cards`). Affects rollover ONLY — not scheduling or decomposition.

**Recurring card revival**: when a card with `recur_type` is archived, a clone is auto-created in `rd` with reset `scheduled_day` and `due_date` advanced via `_next_recurrence()`. The clone's `nudge` state and `dir_start_min` are stripped — each occurrence starts its own loop.

**rd.json concurrency**: every read-modify-write holds `helpers._RD_LOCK` around the WHOLE load→mutate→save, never across an LLM/network call; `_load_rd()` returns a deep copy, `_save_rd()` is atomic and evicts the mtime cache. **Any new rd.json writer must follow this.** **ARCHITECTURE.md §3**.

**`card["nudge"]`** (lazy; absent on most cards): loop state — `stage`, `graph` (a **strict linear chain**, never parallel — `_linearize_chain`; the event block `is_event_start` is the terminal sink when `work > 0`), `active_node`, timing fields, `consequences`, `version`. Full field list: **ARCHITECTURE.md §15**.

---

## Nudge loop (`nudge.py` + `nudge_deadlines.py` + `nudge_loop.py`)

ADHD activation scaffolding: every card = decomposed **prep** steps + (when `work > 0`) one atomic **event block**. The prep back-schedules to finish at the event anchor; a nudge fires **once at the start of each step**; no reply leaves that step `awaiting_reply` in silence; the frontier moves only when Wai acts; due dates are protected behind the consequences conversation.

- **Trigger**: an in-process asyncio loop (`_run_nudge_loop` in `nudge_loop.py`, lifespan-started from `main.py`, 30s tick). **No cron, no rebuild** — state lives on the cards in `rd.json`, so `--reload` restarts just re-arm. `POST /api/nudge/tick` = manual tick.
- **Eligibility** (`_eligible`): `decomposable()` (hq, not reminder/book) AND `scheduled_day == today`. No-Rollover cards are NOT excluded.
- **Everything in hq has a plan**: each tick, hq cards missing a graph get a silent decompose (`_build_graph`, no nudge sent). **The breakdown is a strict linear chain — never parallel** (`_linearize_chain` discards any branching). A card with `prep_time = 0` is fully decomposed with no event block. Editable in the card dialog (`web/card-graph.js`); **breakdown** / **recalculate** both POST `/api/rd/{id}/recalc`.
- **One nudge per step — no stall re-peel.** A step nudges exactly once, at its start (`_due_nudge`). Silence changes nothing; `advance_chunk` re-arms `next_nudge_at` one stall window out (`window_for` = `clamp(estimate × 2.6, 45, 240)` min), and any exec-chat reply re-arms the same step via `clear_awaiting_focused`. The old peel mechanism was removed 2026-08-28 — `window_deadline` and `redecompose_count`/`redecompose_at` are **vestigial**.
- **A nudge ASKS whether the step is done; it never asserts that it isn't.** The loop has NO completion data — a fire means only that the step's slot arrived, and Wai routinely does a step without marking it. Asserting otherwise accuses her of nothing. **Asking is not softening — the question is the weapon.** Time-critical steps ask READINESS, not completion. A bare "yes"/"not yet" is an answer, so `chat._active_nudge_block` must not read it as pushback into the consequences conversation.
- **A nudge's answers are TAPPABLE** (`web/exec-choices.js`): a final line `[A | B | C]` becomes buttons — on any Exec reply, not just nudges (needs a `|`, tolerates emphasis). A card question may carry `card=<id>` as a cell: the one place Exec prints a raw id, stripped before render/speech (`discord_bot.strip_card_cell` on Discord). **Every open question stays tappable** (never wipe rows); a tap sends `[answering: "<question>" card=<id>] <answer>`. Tapping must not close the panel — click-outside is decided in the **capture** phase; `#exec-term` bottom padding guards the `[x]`. **ARCHITECTURE.md §15e-bis**.
- **`done`/`exile` are CARD ACTIONS**, appended by the client to any row that knows its card: they PATCH `{id, column}` directly, no model turn. Monitor comments carry no card, so no actions. **ARCHITECTURE.md §15e-bis**.
- **Due-date protection**: `schedule_card` refuses to defer an active-nudge card; `record_consequences` → `reschedule_after_consequences` is the ONLY later-day path.
- **Morning (4:30)**: `morning_reconcile()` re-anchors placed-today cards and disarms others to `idle`; never leaves a past-dated `next_nudge_at`.
- **Lateness recalibration** (`recalibration.py`) is built but **GATED OFF** (`ENABLED = False`) and its telemetry is **dormant** — the manual "late" button that set `completed_late` was removed 2026-06-29 and was its only producer. Flip `ENABLED` on only after re-wiring a late source and accruing a sample.

Loop internals, the breakdown UI, the tone rules and the recalibration design: **ARCHITECTURE.md §15** (history: **ARCHAEOLOGY.md §15**).

---

## Morning pipeline (`POST /api/morning`) — 4:30 AM ET

1. Read today's `activity_log.json`
2. **Retrospective** — extract durable facts only (preferences, relationships, recurring habits) from the day's activity, append to `profile.json`. Never writes time-bound, event-specific, or task-status entries.
3. **Recalibrate** — fold the day's completions into per-category lateness factors (`recalibration.recalibrate`); read before the log is archived.
4. **Purge** — remove time-specific expired notes from `profile.json`
5. **GCal import** — pull calendar events 14 days ahead as cards
6. Archive `activity_log.json` → `activity_log_YYYYMMDD.json`, reset to `[]` (year included so archives don't collide/overwrite across years; `/api/debug/logs` globs `activity_log_[0-9]*.json`, matching both the new 8-digit and legacy `MMDD` names)
7. Archive `moltbook-heartbeat.log` → `moltbook-heartbeat_YYYYMMDD.log`, reset to `""`
8. Roll past-dated `scheduled_day` on rd/hq cards forward to today (skip `no_rollover` cards — a missed fixed occurrence stays in the past), auto-promote rd cards with a `due_date` inside the 7-day window to hq (rd->hq via `schedule_to_day`), then `scheduler.layout_day()` autostacks carryover + unpinned timeless today cards from 10 AM while pinning timed cards at `event_time - prep` (preserves cards already placed for today), then `nudge.morning_reconcile()` re-anchors nudge state to the fresh layout
9. Clear `chat.json`
10. Dedupe `profile.json` notes

---

## Exec monitor

`monitor.py` produces unsolicited comments after significant card activity, in Exec's GLaDOS voice (`EXEC_VOICE`, shared with chat) — backhanded observations, not warm encouragement. **Significant** = a move to archives/exile, a book-card update, or a completed decompose sub-step (which happens two ways: the `advance_chunk` chat tool, or a timeline tap-done in the hq today column, where `_log_entries_for_patch` emits an `advanced` entry on any nudge node's `done` false→true transition). An `advanced` entry is re-validated at fire time (`_drop_undone_advanced`), so a step marked done then unmarked earns no comment.

`schedule_monitor()` runs a 60s trailing debounce (called from `PATCH /api/rd` and from the chat tool dispatch); `POST /api/monitor/flush` bypasses it. The already-commented boundary is the last log entry's `ts` at process start (`_init_monitor_ts`), compared strictly (`>`) so a `--reload` never re-comments. Subscribers get `{thinking}`/`{comment}` over `/api/monitor/stream`; the comment is written to `chat.json` as `role=monitor`.

**`chat.json` is ONE chronological stream sorted by `ts`** (`chat_store.py`). Both send paths run history through `sanitize_history_for_api` — an orphaned `tool_use` 400s the API; keyless messages inherit the preceding `ts`. **ARCHITECTURE.md §16**.

Trigger rules, the recurring-card `revived` handling, and the orphan bug's two fixes: **ARCHITECTURE.md §16** (history: **ARCHAEOLOGY.md §16**).

---

## Discord bridge (`discord_bot.py`)

Reaches Wai's phone when away from the computer — a `discord.py` bot run as a lifespan asyncio task (`_run_discord_bot`, spawned in `main.py` beside `_run_nudge_loop`). **Disabled (clean no-op) unless `DISCORD_BOT_TOKEN` + `DISCORD_USER_ID` are set in `.env`** — so dev/tests without the token (and without `discord.py` installed) import fine: `import discord` is deferred *inside* `_run_discord_bot`, never at module top.

- **Outbound** — the bot appends its own `asyncio.Queue` to `monitor_sse._monitor_subscribers` (the same fan-out an SSE client subscribes to), drains `{comment}` payloads, and DMs them. Nudge fires AND monitor comments both push `{comment}` through that one channel, so a single drain catches both; `{thinking}` events are ignored. **No edits to the nudge/monitor call sites.**
- **Inbound** — `on_message` from the owner's user-id, in a DM only, runs `exec_reply()`: loads the shared `chat.json` history, calls the Exec model with the same `_build_chat_system_prompt` + `_chat_tools` as the web bubble, does **one tool round** (full parity — can create/schedule/decompose cards), persists via `_save_chat`, and replies in the DM. So the phone and the web bubble are one conversation. Sync helpers go through `asyncio.to_thread`; replies are chunked to Discord's 2000-char cap.

`--reload` cancels the lifespan on every `.py` edit → the gateway re-identifies (Discord rate-limits identify), but that churn only happens during active dev = when Wai is at the computer = when phone push is moot; steady-state prod has no edits and the bot stays connected. Adding the dep means **one rebuild** (`docker compose up -d --build`). Bot setup is owner-side: create the app + bot at discord.com/developers (enable the **Message Content** intent), add it to a server you share, copy the bot token + your user-id into `.env`.

---

## Tarot reading flow

Server has no per-session state. The client (`tarot.html`) drives the reading via `localStorage`-stored `messages`, `spread`, `significator`, plus bracketed `[event marker]` user-messages emitted on UI actions (open, choose Significator, draw, turn a card).

Phases (enforced by `tarot/prompt.py` system prompt):
1. **Phase 1** — Significator interview. Bot asks ≥5 single-question turns (one open question, ≤30 words, ends in `?`), silently maps answers to a court card via private rank/suit cheatsheet, then on the exit turn declares the card, calls `set_significator`, and asks Phase 2's opening question.
2. **Phase 2** — Query dialogue. Up to 4 clarifying exchanges, then names the heart of the query + chosen frame and calls `deal_spread`.
3. **Phase 3** — Spread drawn face-down. Bot invites the first position turn.
4. **Phase 4** — One card per `[turned ...]` event. Calls `lookup_card_meaning` for Majors; reads Minors from system prompt's suit + numerology. Ends by naming the next position.
5. **Phase 5** — Synthesis once all three cards revealed. Two-paragraph max.

Frontend sends `[opened /tarot; ...; time=HH:MM <band>]` markers; the time band drives the opening atmospheric image (Gibson register).

Privacy: server only sees revealed cards. Face-down identities live in the browser; the request body carries face-down *positions* only, never `card_id`s.

---

## Cron

Config baked into image at `/etc/cron.d/exec-fn`.

| Schedule | Task |
|----------|------|
| 4:30 AM ET | `morning_cron.sh` → `POST /api/morning` (in-container) |
| 5:00 AM ET | **HOST** cron `/etc/cron.d/exec-fn-graphify` → `scripts/graphify-daily.sh` (as `wai-root`): graphify rebuild, then the /graph layout bake. Commits + pushes its own `graphify-out` only, never stashes. **`GRAPHIFY_VIZ_NODE_LIMIT` must stay above the repo's node count** or `/graph` 404s behind an exit-0 nightly. **ARCHITECTURE.md §17d**. |
| 5:20 AM ET | **HOST** cron `/etc/cron.d/exec-fn-ccprobe` → `scripts/cc-probe-daily.sh` (root): re-probes the `/cc` tool allowlist whenever the INSTALLED Agent SDK version changes; drift shouts nightly until fixed. **ARCHITECTURE.md §7**. |
| 5:45 AM ET | **NOT CRON** — `tarot/openings_loop.py` probes the `/tarot` voice and tops up openings; its log `data/cron/…__tarotvoice.log` is the stamp. Only `FAIL (mode=homo)` is a real fault. **ARCHITECTURE.md §14e**. |
| 5:10 AM ET | **HOST** cron `/etc/cron.d/exec-fn-security` → `scripts/security/refresh.py` (root; reads `/var/log`, writes `data/security.json` for `/security`). NOT baked into the image — installed on the droplet host so it can read host logs; `SECURITY_OWNER_IP` set in the cron file. flock-guarded; logs to `/var/log/exec-fn-security.log`. |

**MEMORY IS THE SCARCE RESOURCE ON THIS BOX** (1967MB RAM + 5GB swap). The OOM killer shoots by badness score, not culprit — so cap spikes: browser suites via `systemd-run --user --scope -p MemoryMax=700M` (`run_capped`), graphify at 600MB. Check `free -m` and `sudo dmesg -T | grep -i oom`; if a rebuild looks expensive, check `graphify-out` ownership first. **ARCHITECTURE.md §17**.

**EVERY cron job logs to `data/cron/YYYY-MM-DD__<job>.log`** — one file per JOB (writers are different uids), shown on `/debug` via `/api/debug/cron`. Escape `%` as `\%` in crontab; `morning_cron.sh` reports `${PIPESTATUS[0]}`. **ARCHITECTURE.md §17c**.

Logs: `docker compose logs api` or `docker compose exec api tail -f /var/log/exec-fn.log`

---

## Docker volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `./api/data` | `/app/data` | Persistent data |
| `./api/templates` | `/app/templates` | Templates (hot-reload) |
| `./web` | `/app/static` | Static files (hot-reload) |
| `gcal-auth` | `/root/.config/gcal` | Google Calendar token |
| *(tmpfs)* | `/app/nightfall/nightfall-src` | **A MASK, not a mount** — an empty tmpfs shadowing the game's source tree |

**Don't remove the tmpfs mask** — it keeps uvicorn's `--reload` poller from walking `nightfall-src/` (was 44% of a core). **ARCHITECTURE.md §17e**.

---

## Droplet

OS: Ubuntu 24.04 · IP: `168.144.13.51` · Domain: `wai-lau.net`

- nginx: 80 → HTTPS; 443 → upstream `execfn_app` (127.0.0.1:8080), **listed twice** so a `--reload` swap retries instead of 502ing (no `non_idempotent`, no `http_503` retry). `client_max_body_size 25m`. Live config `/etc/nginx/sites-enabled/default`; backups in `/etc/nginx/backups/`, **never `sites-enabled/`**. **ARCHITECTURE.md §1d**.
- Certs: `/etc/letsencrypt/live/wai-lau.net/` (auto-renews)
- SSH: key-only (password auth disabled), **direct root login disabled** (`PermitRootLogin no`); log in as `wai-root` (sudo NOPASSWD) — `ssh wai-root@wai-lau.net`. fail2ban active.
- Container: `restart: unless-stopped`

Fresh setup: `bash bootstrap.sh`.
