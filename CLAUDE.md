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

**Local-claude deploy — push, then deterministic reset over SSH (NOT `git pull`/`git stash`).** `/exec-fn` always carries local drift (regenerated `graphify-out`) + a rebase-pull config; with the bind-mounted **untracked** dirs (`./nightfall-incident` → `/app/nightfall`, `./graphify-out`), `pull`/`stash` are fragile — a mangled stash-pop or a staled mount crashes the worker → **502** (`routes_nightfall` reads `nightfall-incident/wai-head.js` at import, so a staled `/app/nightfall` kills startup). Both `stash -u` and plain `stash` have caused outages. After `git push` from `~/src/exec-fn`:
```bash
ssh wai-root@wai-lau.net 'cd /exec-fn && sudo git fetch origin && sudo git reset --hard origin/master && sudo docker compose up -d --force-recreate api'
```
`reset --hard` discards the droplet's `graphify-out` drift (re-run `/graphify` after, or commit it first); untracked `nightfall-incident` is preserved; `--force-recreate` rebuilds the mount namespace so a churned untracked dir can't stale and crash startup.

**Auto-deploy is the expected workflow** (local claude) — the owner wants code changes pushed to the live droplet via the SSH deploy above (confirmed after weighing the outage risk); deploy yourself, don't hand the command back to run manually.

**Rebuild only if** `Dockerfile`, `requirements.txt`, `entrypoint.sh`, or `exec-fn.cron` changed:
```bash
docker compose up -d --build
```

**COMMIT after each discrete fix.** Don't batch.

**PRE-COMMIT HOOK** runs automatically on commit: ruff on staged `.py` files, JS syntax + ESLint on HTML templates, stylelint on `web/*.css`, a **palette lint** (`scripts/lint-colors.py`, runs when any css/web-js/template is staged — no new colors or alphas: the allowed `(color, alpha)` pairs are DERIVED from usage, the same extraction `/api/color/usage` feeds /color, and frozen in `scripts/palette-baseline.json`. It rejects (1) any off-snap-scale alpha — scale is `0/0.06/0.12/0.25/0.45/0.6/0.8/1`, (2) any colour using more than **4 non-zero** alpha steps, (3) any `(token, alpha)` pair not in the baseline — a new alpha for a colour or a new colour token, (4) any `var(--*-hsl)` not defined in chrome.css or `LOCAL_ACCENTS`. Every hued colour sits at ≤4 (e.g. `--cyan-hsl` = `0.12/0.45/0.8/1`, matching `--green-hsl`); neutrals (Silver, Smoked Glass) use fewer. Adding a colour/alpha = make the change, eyeball it on `/color`, then `python3 scripts/lint-colors.py --update` to regenerate + commit the baseline), shellcheck on `.sh` files, a **500-line cap** on staged `.py`/`.js` (`api/main.py` allowlisted pending its split), a **no-multiline-inline-JS/CSS** check on templates, a **fixture-resolution check** (`pytest tests/ --setup-plan`, runs when any `tests/` or `api/*.py` is staged — RESOLVES every test's fixture graph across the WHOLE suite without executing fixture/test bodies, so no WebKit/live-app needed (~0.3s); catches a stale/renamed/deleted fixture reference *anywhere* even when the consuming test sits behind a per-feature trigger gate below — a cross-cutting conftest rename can't hide in an untriggered test; skips cleanly with no pytest venv), **page smoke tests** (`tests/` via pytest, run only when `api/*.py` or templates change — HTTP over every route against the live container on :8080; skips cleanly if it's down or the dev venv is absent, fails+blocks on a broken route), plus a non-blocking reminder to update `CLAUDE.md`/`ARCHITECTURE.md` when source changes. Source of truth is `scripts/pre-commit` (version-controlled); `.git/hooks/pre-commit` is a symlink to it — run `bash scripts/install-hooks.sh` to (re)install on a fresh clone. Run `bash scripts/pre-commit` manually to check before committing. Linter configs are tracked: `ruff.toml`, `eslint.config.mjs`, `.stylelintrc.json`, `package.json`.

**CLAUDE-CODE COMMIT GUARD** (separate from the shell hook above — fires only when committing *through Claude Code*, not bare terminal `git commit`): a PreToolUse hook (`.claude/settings.json` → `.claude/hooks/docs-commit-guard.sh`) blocks a commit that stages `api/*.py`/templates without also staging `CLAUDE.md`/`ARCHITECTURE.md`. Claude updates the docs (or adds `[skip-docs]` to the commit message if none are warranted), then retries. Deterministic detection; doc-writing is the agent acting on the deny reason.

**UPDATE CLAUDE.md** when routes, pipelines, data files, schemas, or naming conventions change.

**NO INLINE JS/CSS in templates; 500-line cap on `.py`/`.js`.** HTML templates carry no multi-line inline `<script>`/`<style>` — extract to `web/<page>.{js,css}` and reference via `<link>`/`<script src>` (a one-liner `onclick=`/touch-detect handler may stay inline). No `.py`/`.js` over 500 lines: split into modules (`main.py`→`pages.py`+`routers.py`+`routes_views.py`+`routes_api.py`; `nudge.py`+`nudge_deadlines.py`+`nudge_llm.py`+`nudge_loop.py`; `monitor_sse.py`) or same-global-scope files loaded in order (`hq-core/drag/groups/board.js` — `hq-drag.js` holds the shared pointer wiring + floating-ghost drag (`attachBlockDrag`/`startTimelineDrag`), `tarot-view/voice/stream/chat.js` — `tarot-stream.js` holds `streamResponse()` + the typewriter). Both enforced by the pre-commit hook (no allowlist — every file is under the cap). A **per-function** cap also applies: `max-lines-per-function: 100` (skipping blanks+comments), via ESLint on staged `web/*.js` — a ratchet that only fires on files a commit touches (`no-undef`/`no-unused-vars` are off for `web/**` since those are cross-file same-scope globals, not modules).

---

## System overview

| Layer | What |
|-------|------|
| Droplet | DigitalOcean NYC1, `168.144.13.51`, `wai-lau.net` |
| nginx | Bare-metal, SSL termination, proxies → port 8080 |
| FastAPI | All routes + API endpoints (`api/main.py`) |
| Docker | Single container, `TZ=America/New_York` set in compose |
| Cron | Inside container — fires `POST /api/morning` at 4:30 AM ET |

Models: `claude-opus-4-8` for reasoning, chat, voice, and the nudge graph; `claude-haiku-4-5` for two cheap classification calls — NL date-parse (`card_llm.parse_date_natural`) and gcal event batch-classify (`gcal._haiku_classify_batch`). `classify_card` stays on opus. Auth: `ANTHROPIC_API_KEY` in `.env` — these are pay-per-token API calls, NOT a Claude subscription.

**Prompt caching** (Anthropic `cache_control: ephemeral`, 5-min TTL) is wired on the large STATIC system prefixes that get reused across turns, so repeat turns read the prefix at ~0.1x instead of full price. Opus min cacheable prefix = 4096 tokens; anything below that won't cache (silently) and is left alone. Cached call sites:
- **Tarot** (`tarot/agent.py`) — `system=build_system(spread_type)` (~8.7K no-spread / ~13.4K three-card) + `TOOLS`, marked on the single system block. Fully static per reading; the per-turn spread context rides in `messages`, never `system`. A reading is many turns reusing the prefix.
- **MTG** (`mtg/agent.py`, `_SYSTEM_CACHED`) — `SYSTEM` (~5.9K) marked once, used at both call sites. Pass 1 (research tool-loop, with `TOOLS`) caches the ~6.6K tools+system prefix across its own iterations; pass 2 (summarize, NO tools) is a separate system-only prefix — both cache cross-question, only pass 1 caches within a single question.
- **Exec chat** (`chat._build_chat_system_prompt`) returns a TWO-block system list: block 1 = `_CHAT_STATIC_PREFIX` (identity + `EXEC_VOICE` + global rules, marked `cache_control`), block 2 = the volatile tail (TODAY, activity log, card lists, schedule, context, active-nudge block — NO marker). With the exec tools the cached prefix is ~5.2K tokens. TODAY moved from the top into the volatile tail — it was the silent invalidator. Both `routes_chat` call sites (main stream + `_stream_tool_followup`) build the identical static block, so the follow-up turn reads the cache the main turn wrote. Restructure was required because the tools alone (~3.5K) are under opus's 4096 minimum.

The SKIP list (measured under 4096 and/or low reuse, left uncached): `monitor.py` static slice 1342 (no tools, debounced bursts), `nudge_llm` `_TONE` 1442 (no tools, per-card one-shot), `card_llm` classify/parse (one-shot, no/tiny system), `morning.py` + `chat._dedupe_context` (daily one-shot, prompt in user message), `gcal._haiku_classify_batch` (no system block, tiny instructions in user message).

---

## File map

The file/symbol map now lives in the knowledge graph (built with `/graphify`): open `graphify-out/graph.html` in a browser, or read `graphify-out/GRAPH_REPORT.md`. Regenerate after structural changes with `/graphify`.

---

## Terminology

| Term | Meaning |
|------|---------|
| R&D | Main board — all cards (`rd.json`) |
| r&d column | Upcoming ideas/backlog — card added here by default |
| hq column | Active working set |
| archives column | Completed tasks |
| exile column | Won't-do tasks |
| HQ | 7-day planning view — assigns `scheduled_day` to cards. 3 columns: today (timeline) \| next 3 days \| last 3 days (small cards) |
| scheduled_day | ISO date field on a card indicating which day it's planned for |
| recur_type | Recurrence type; when archived, clone auto-created with advanced due_date |
| reader / querent | Tarot terminology: reader = AI; querent = human |
| Significator | Court card chosen by the reader during Phase 1 to represent the querent; removed from deck before draw |
| frame | Tarot Three-Card frame: `past_present_future` or `situation_obstacle_advice`; relabels position UI |

---

## Web app

`/` is a public landing page (`_landing_html()`, styles in `web/landing.css`) — a vertically-centered **two-column grid** of sections ordered by icon hue (`_LANDING_HUE_ORDER` in routes_views: recruiter · hosaka · graph · nightfall · color · mtg · tarot), each with a Gibson-register blurb + plain description (`_LANDING_BLURBS`/`_LANDING_DESCS`), no auth, no exec bubble. The grid (`grid-template-columns:repeat(2,…)`) collapses to one column under 640px (two side-by-side icon+blurb rows won't fit a phone). Cyberpunk fx: CRT scanlines/flicker (`.cyber-bg`), sweeping scan beam (`.cyber-scan`), icons scale on hover, boot-in stagger (honors `prefers-reduced-motion`). An `admin` link sits bottom-right → `/login`. Logged-in admins (valid `session` cookie) skip the landing and 302 to `/rd`. Clicking a section follows the 401 redirect to the right login.

Two cookie auth tiers:
- `session` cookie (set via `POST /login`, requires `API_KEY`) — full access. Login form at `GET /login` (already-authed visitors redirect to `?next=`/`/rd`).
- `guest_session` cookie (set via `POST /guest`, requires solving a **Cloudflare Turnstile** challenge) — only `/mtg`, `/tarot`, `/nightfall`, `/hosaka`. Login form at `GET /guest` renders the Turnstile widget (CF `api.js` + site key `TURNSTILE_SITE_KEY`, auto-submits via `web/guest_login.js`); `POST /guest` verifies the `cf-turnstile-response` token via CF `siteverify` (`auth.verify_turnstile`, secret `TURNSTILE_SECRET`) then sets the cookie. The cookie token derives from `TURNSTILE_SECRET` (`GUEST_SESSION_TOKEN = sha256("guest:"+secret)`) — the old shared `GUEST_KEY` is gone, and `require_guest_auth` no longer accepts a guest bearer (only `session`/`guest_session` cookies + the admin `API_KEY` bearer). `GET /guest-login` is a 302 alias to `/guest` (bookmark compat).

Both cookies: `HttpOnly`, `SameSite=Lax`, `Secure`. `/guest` `next` param is allowlisted (`/mtg`, `/tarot`, `/nightfall`, `/hosaka` only); arbitrary values are clamped to `/mtg`. 401 on an HTML GET redirects protected pages to `/login?next=`, guest pages (`/mtg`, `/tarot`, `/hosaka`) to `/guest?next=`. Both login forms carry a visually-hidden `username` input (autocomplete=username) so password managers can store/fill credentials.

Nav: `R&D` · `HQ` · `debug` · `sec` (→`/security`, owner-only) · `graph` · `emet` · `color` · `nightfall` · `mtg` · `tarot` · `hosaka` (→`/hosaka` TTS, guest-or-full auth; in the guest nav too) · `cv` (→`/recruiter`) — bottom nav, all pages. **Standalone launch** (home-screen / installed web app — detected by `navigator.standalone` or `display-mode: standalone` in the `_build_nav` script, which adds `html.standalone` + sets `--per-row` = ceil(item count / 2)): the nav reflows to **two rows** with one empty icon-cell of padding on each side (`html.standalone .exec-nav` in chrome.css; cell width = W/(per-row+2)). Standalone also appends a **refresh** nav item (`#nav-refresh`, `firewall.png` padlock icon, last slot) — created in JS only when the standalone class is added (counted before `--per-row`), with no href (so the link interceptor skips it) and a click handler that hard-reloads via `location.reload()`; there's no browser chrome to reload from in a home-screen launch. The nav script also tracks the live nav height via a `ResizeObserver` (→ `--nav-h`, taller in two-row mode so pages reserving it don't hide content behind the nav) and, in standalone, intercepts same-origin link taps → `location.href` (prevents Safari kick-out). **Keeping iOS chrome-less across navigation is the manifest's job, not the meta's**: `/manifest.webmanifest` (served by the static mount with `application/manifest+json` via a `mimetypes.add_type` in main.py; linked from `_APPLE_WEBAPP_META`) declares `scope:"/"` + `display:"standalone"`, so iOS treats in-scope page loads as in-app and hides the back/reload toolbar. iOS reads the manifest **at add-to-home-screen time only** — changing it requires deleting + re-adding the icon. **Exec** is NOT a nav entry — it's a floating draggable bubble (`#exec-bubble`, `guru-pink.png` glasses icon, `exec-bubble.js` + `exec-bubble-drag.js`) injected by `_build_nav()` on the planning routes (`/rd` R&D + `/hq`) for non-guests. Clicking/tapping the bubble toggles the Exec chat panel. On every OTHER non-guest page the same `#exec-bubble` renders (identical look via exec-bubble.css, same drag + shared `exec-bpos` position via exec-bubble-drag.js) but a tap NAVIGATES to `/hq?exec=open` instead of toggling a panel — wired by `exec-link.js` (a `<div>`, not `<a>`, so a drag can't fire a stray click; nav via `location.href`, which stays in-app under standalone). Guests get no bubble. **Voice:** Exec speaks aloud in the GLaDOS voice (`exec-voice.js`, `glados`/piper over the shared HosakaAudio core), audible by default with an `#exec-mute` toggle in the panel input line (localStorage `exec.voice`, global across pages); Wai's own messages and bracketed sys notes are never spoken. Each Exec turn's leading glyph in the panel is a clickable **replay** marker (`.msg-mark` — `>` reply / `~` monitor-nudge, built by `exec-bubble.js speakMark`): tap it to re-speak that message via `execVoice.speak`. Wai's `$` and sys `#` lines get no marker. On the planning pages the panel voices assistant replies + monitor comments + nudges. On every OTHER non-planning protected page (except /tarot + /hosaka) `exec-voice-listener.js` loads the same player and voices the unsolicited turns (monitor comments + nudges) that arrive over `/api/monitor/stream`, so a nudge narrates wherever Wai is — /tarot and /hosaka keep the link-bubble but no voice. Audio unlocks on the first user gesture per page (browser autoplay rule); just viewing a page with nothing for Exec to say is silent. The panel's top section is a server-persisted scratch **todo list** (`exec-todos.js`, `exec_todos.json`) — sizes to its content up to half the panel, then scrolls; an add-input sits at the top, a clear divider line under the list, and the chat fills the rest below. Items are DELETED on checkbox (distinct from rd.json cards, which archive). No `/exec` route. Unread monitor count shows as a badge on the bubble. Appending `?exec=open` to R&D/HQ opens the chat expanded on load. Bubble position persists in `localStorage` (`exec-bpos`), clamped to viewport. (The standalone `/directives` timeline page was removed — the timeline now lives in the hq today column.)

### Pages

| Route | What |
|-------|------|
| `/rd` | R&D board from `rd.json` |
| `/hq` | 7-day planning — assign `scheduled_day` to cards. 3 columns: today (timeline) \| next 3 days \| last 3 days (small cards) |
| `/debug` | Profile notes + activity log viewer + saved tarot readings |
| `/security` | **Protected** (owner-only). Three-tab security-telemetry dashboard (geolocation \| ssh brute-force \| all incoming; geo default) — `security.py`'s `render_security()` builds inline-SVG charts from `data/security.json`, wrapped in the standard shell via `_render_page("security", ...)`. The JSON is produced OUT-OF-BAND by a **host** cron (`scripts/security/refresh.py`, runs as root OUTSIDE the container) that parses `/var/log/{auth,nginx/access,fail2ban}.log*`, geolocates the top IPs via ip-api.com (cached in `data/geo_cache.json`), and atomically writes `data/security.json` (gitignored) — keeping host log access out of the internet-facing app. Owner IP via env `SECURITY_OWNER_IP` (never committed; exec-fn is public). Nav icon = `sentinel.png`; default favicon kept. Missing JSON → "not generated yet" placeholder. |
| `/graph` | **Public** (no auth). Self-contained graphify codebase viz from the `./graphify-out` volume (regenerated by `/graphify`), served by `graph_page()` in routes_views.py — chrome.css + cyber-fx bg + bottom nav + `web/graph-overlay.{css,js}` (nav restyle + live physics panel) all injected at serve time so they survive `/graphify` rebuilds. Non-admins get the guest nav (the full nav links to login-gated pages); admins keep the full nav. A few node summaries that would leak internals (e.g. the bearer-auth scheme + the `EXEC_SAY_KEY` name) are scrubbed to `[redacted]` at serve time by `_redact_graph_nodes()` / `_GRAPH_REDACT_IDS` (operates on graphify's embedded `RAW_NODES`; survives rebuilds, same rationale as the improvedLayout patch). The Pollack tarot reference book (`api/tarot/book/` — card meanings/frameworks/numerology, ~110 nodes) is dropped wholesale at serve time by `_drop_graph_book_nodes()` (prefix `_GRAPH_DROP_SOURCE_PREFIX`, via `_sub_json_array()`): removes those `RAW_NODES`, prunes `RAW_EDGES` touching them, drops their now-empty `LEGEND` rows ("Tarot Major Arcana Meanings"/"Tarot Core Framework"/"Celtic Cross Spread"), and drops the `hyperedges` (shaded narrative clusters off the book, e.g. "First-row forces gathered into the Chariot's ego") that reference any removed node — tarot *engine* nodes stay; same survives-rebuild rationale. The moltbook heartbeat plumbing (one read-only route node) is likewise dropped by `_drop_graph_moltbook_nodes()` (substring match on id/label/source). The vendored vis-network bundle (`web/vendor/`, ~150 minified function nodes like `Kv()`/`_f()` graphify parsed out of the minified blob — noise, not our code) is dropped wholesale by `_drop_graph_vendor_nodes()` (prefix `_GRAPH_DROP_VENDOR_PREFIX`); the `<script>` that loads the lib stays, only its parsed nodes go. External library/framework symbols graphify lifts from imports + annotations (`BaseModel`, `Request`, `WebSocket`, `FastAPI`, `Path`, `datetime`, ...) are dropped by `_drop_graph_library_nodes()` — a code node with NO `source_file` (no in-repo definition) OR a label in `_GRAPH_LIB_LABELS` — they're not exec-fn code, just clutter. After the drops, `_merge_graph_communities()` regroups nodes into logically-named, FEATURE-based communities (`_logical_key`: api/tarot/* + web/tarot-*.js → "Tarot", api/nudge*.py → "Nudge", api/graph_scrub + web/graph-overlay → "Graph", ...): vis cycles only a 10-color palette, so graphify's dozens of fine-grained communities share colors and the clusters become indistinguishable color-noise — feature grouping gives each module its OWN distinct color from `_COMMUNITY_COLORS` (Tableau-20 + Dark2 = 28 hues) and rebuilds `LEGEND` biggest-first, reassigning every node's `community`/`community_name`/`color`. A feature with fewer than `_MIN_COMMUNITY` (10) nodes folds into its top-level dir bucket ("API"/"Web") so the legend isn't littered with 2-node modules; every feature is already ≤150 nodes (the cross-layer merge is what splits the old per-dir API/Web blobs). This supersedes the old per-community rename pass; it's `/graph`-page-only (the raw `graph.json`/`GRAPH_REPORT.md` keep graphify's full community set). `_size_graph_by_loc()` then rescales every node's `size` to track its line count (file node = whole-file lines, symbol = span to the next def) read from the sibling `graph.json`'s `source_location` start lines (no source-file reads — most aren't mounted in the container), sqrt-compressed into ~10..40. Uses a per-line anchored array regex (a non-greedy `[.*?]` truncates at a `];` inside a node title). `_fix_graph_stats()` last rewrites the `#stats` header (graphify bakes PRE-scrub node/edge/community counts) to the merged/dropped reality. The vendored bundle is ALSO excluded at ingestion by the repo-root `.graphifyignore` (`**/vendor/`, `*.min.js`, ... — graphify reads it each build) so fresh graphs never carry vendor nodes; `_drop_graph_vendor_nodes()` is the serve-time backstop for a stale/cached `graph.html` built before that landed. Separately, `graph-overlay.js` client-side redacts any node *label* >20 chars to `[ redacted ]`, and for any redacted node (server `[redacted]` or client `[ redacted ]`) `patchInfoPanel()` wraps graph.html's global `showInfo()` to blank the node-info Type+Source to "redacted" and remove the neighbors section (Community + Degree stay), reloads the page when the device wakes from sleep (interval-gap >30s → `location.reload()`), and clamps zoom/pan (`setupZoomLimits()`) with hard walls so the viewport holds roughly between 2 and half the non-orphan nodes — translates that intent into min/max scale (viewport world-area vs. node-cloud area) + a pan box (centre clamped to the node bounding box), recomputed live, and clamps in place on each user zoom/drag so the camera stops AT the threshold (no snap-back); programmatic camera moves (tour focus) are skipped (`zoom` params.event == null). Content-hash ETag + `no-cache`. |
| `/emet` | **Protected** vis-network knowledge graph (Wai's personal graph). `emet_page()` in routes_views.py serves the `templates/emet.html` renderer and injects the graph DATA inline as `window.EMET_GRAPH` from `templates/emet-graph.json` (`{meta,nodes,edges}` — `<` escaped to `<`). **Both emet.html + emet-graph.json are gitignored sensitive personal data — never commit** (see memory). Same UI shell as /graph: chrome.css + cyber-fx bg + bottom nav + content-hash ETag/`no-cache` cache-bust. `web/emet.css` skins it: fullscreen graph + an always-open **node-info** bottom strip (`#side`, 45vh, not collapsible) showing the selected node's summary, parent/child links (white glowing ▲/▶ triangles), and observations. Selecting a node recenters the camera, dims+desaturates everything outside the node+children, and glows only the selected node + its edges. Cyber fx pinned on top (z 9999) so scanlines never pan with the graph. Data lives in `api/templates/` (not the public `/app/static` mount) so it stays auth-gated. Nav label = `EMET` (uppercased by nav CSS), icon = `golem-stone.png` (nightfall GolemStone sprite), next to graph. |
| `/color` | **Public** (no auth — palette only, no data). Read-only moodboard: one little table per color, one per row (hue-ordered; neutrals at the end). Title (friendly `[Name]`) above; table padded to 4 columns (the variations — card colors = wisp/idea/plan/commitment, non-card `-hsl` colors = their used alpha steps, empty trailing cols); rows = swatch / opacity / count / effects / per-column usage-site list (each variation's sites, most-used first); usage description under the table. Tokens with the same H S L merge into one (max 4 variations); a non-card token's alpha usages map onto the nearest card size (`SIZE_ALPHA` = wisp .15 / idea .25 / plan .8 / commitment 1) — for card colors the count row is text `(sizes +N)×` of those mapped usages, for non-card it's per-column `×N` from `alpha_counts`. Effects (e.g. blur) sit in their column. Edit colors in chrome.css; this page just watches. Admin cookie → full nav, else guest nav |
| `/nightfall` | Standalone game (semi-public, guest auth) |
| `/hosaka` | **Guest-or-full** TTS page (`guest_protected` — guests welcome). Default voice `charlie`. SPEAK UI streaming audio from a home GPU box (Kokoro/Chatterbox) via a same-origin WS reverse-proxy (`routes_tts.py`); browser only ever talks same-origin so the session/guest cookie carries auth on the WS handshake. A live connected-users count sits at the top-right (`#tts-presence`, defaults to `0 users connected` so the count landing never shifts the layout) over a dedicated presence WS (`/ws/hosaka/presence`); the diagnostic status text (`#tts-status` — offline reason / "Wai's GPU offline -- glados only", set in `tts.js applyHealth`) sits to its left on the same row (`.tts-presence-row`, flex; count held right by `margin-left:auto`, status collapses when empty). |
| `/mtg` | MTG rules assistant (semi-public, guest auth). Card names show a Scryfall image preview on hover; rule citations (e.g. `724.1b`) show the rule text on hover/tap (mtg.js `_linkifyRules` wraps them, fetches `/api/mtg/rule/{number}`). |
| `/tarot` | Tarot reading: spread (top, fixed-height) + Pollack-voiced reader chat (bottom); guest auth; per-browser state in `localStorage` (no server persistence). **Reader narration** (`tarot-voice.js`, AUDIBLE by default; works for full `session` AND `guest_session`): the reader's turn is spoken via hosaka (voice `nicole`) and the typewriter paces to the actual audio clock — `tarot-chat.js` holds the text until audio starts (reader "draws breath" behind a blinking cursor), then reveals chars by `charWeight`-shaped schedule normalized to the measured audio duration (preserves punctuation pauses, no drift, self-corrects off `player.elapsed()`). The ♪ button in `#spread-controls` is a MUTE (volume → 0; narration still streams + paces the typewriter). Audio fail / not-yet-unlocked → the guessed-pace typewriter. Optional **ambient music** (`tarot-music.js`, ♫ toggle below the reset button): a looping background track at a 15% bed (baked into the file — iOS ignores el.volume), no ducking, streamed lazily from `web/tarot-ambient.m4a`; starts + fades in (4s) on the first tap, from a random point |
| `/recruiter` | **Public** (no auth). Clean static résumé page for recruiters — **light theme** (the one page that departs from the black palette): white card on off-white, accents = deepened legible shades of the brand hues (green 135 / cyan 188) kept as page-local `--cv-*` tokens in `recruiter.css`, no nav / no cyber fx. Skills render as chips; cyan "Download résumé (PDF)" CTA. Built from the bare shell like the landing (`recruiter_page()` in routes_views.py, markup in `templates/recruiter.html`, styles in `web/recruiter.css`). CTA → Google Doc PDF export. Top-right **dark-mode toggle** (`#cv-theme`, recruiter.js) flips to a green-on-black terminal (token overrides under `html.cv-dark`) with the tarot CRT scanline overlay, persisted in localStorage. Summary blurb types itself out on load (tarot-paced). Linked from the bottom nav (`cv`, `data-file.png` icon) and the landing page (hue-ordered first). |

### API endpoints

| Method | Path | What |
|--------|------|------|
| POST | `/api/morning` | retrospective, purge stale notes, archive activity_log, reset chat (4:30 AM cron) |
| GET | `/api/rd/log` | Today's activity log (last 20 entries) |
| GET | `/api/rd` | Returns rd.json |
| PATCH | `/api/rd` | Update rd.json (source query param: rd/Exec/hq/dirs). Atomic write. Scheduling side-effects (`_apply_patch_schedule`): hq<->rd column moves, and re-pin a today card's `dir_start_min` to `event_time - prep` (`scheduler.timed_start_min`) when its timed due_date **or prep_time** is edited (so the today timeline auto-repositions the block — prep back-schedules to finish at the event; a plain drag, with no due/prep change, is left alone). Runs recurring-card revival on archived cards with `recur_type`. Schedules monitor debounce if any entry is significant. |
| POST | `/api/rd/classify` | Classify card via LLM → category + size |
| GET | `/api/context` | Returns profile.json (alias of `/api/profile`) |
| GET | `/api/profile` | Returns profile.json |
| PATCH | `/api/context` | Replace profile.json `notes` field. Atomic write. |
| GET/POST/DELETE | `/api/chat` | Exec chat history (planning SSE). |
| GET | `/api/todos` | Exec-panel scratch todo list (`exec_todos.json`): `{items:[{id,text}]}`. |
| POST | `/api/todos` | Add a todo. Body `{text}` → appends `{id,text}`, returns the item. 400 on empty. |
| DELETE | `/api/todos/{id}` | Delete a todo (checkbox = delete, not archive). |
| GET | `/api/monitor/stream` | SSE stream — exec-bubble live updates: `{thinking}` / `{comment}` payloads as significant activity rolls in. |
| POST | `/api/monitor/flush` | Force-fire the monitor immediately if there is significant activity since the last comment (bypasses 60s debounce). |
| GET | `/api/moltbook/heartbeat-log` | Plain text of `moltbook-heartbeat.log` (today's heartbeat ledger). |
| POST | `/api/nudge/tick` | Manual one-shot tick of the nudge loop (the in-process asyncio loop in `main.py` runs this every 30s; started from the FastAPI lifespan hook — no cron). |
| GET | `/api/gcal/auth` | Initiate Google Calendar OAuth |
| GET | `/api/gcal/callback` | Receive OAuth code, save token (public; constant-time state check) |
| POST | `/api/gcal/import_cards` | One-time import of GCal events as rd.json cards |
| GET | `/api/hq` | 7-day week data starting from `?start=YYYY-MM-DD` (defaults to logical-today): scheduled cards + unscheduled hq cards |
| PATCH | `/api/hq` | Bulk update `scheduled_day` and/or `order` on cards; logs `rescheduled` entries with `source=hq`. Cards unscheduled (null) drop back to `column=rd`. |
| GET | `/api/hq/log` | Activity log filtered by source=hq |
| POST | `/api/parse_date` | Parse natural language date → ISO via LLM |
| GET | `/api/debug/logs` | All activity log files (today + archived), newest first |
| GET | `/data/{filename}` | Serve file from /app/data/ (path-traversal guarded) |
| GET | `/api/color/usage` | Public. `{counts, alphas, alpha_counts, sites}` — `var(--X)` reference counts + actually-used alphas per `-hsl` token + parallel per-alpha counts + `sites` (`{token: {α-string: {site-label: n}}}`, site = nearest CSS selector else filename), across templates + web assets (chrome.css `:root` block excluded; bare `hsl(var(--X-hsl))` = α 1). Feeds the alpha columns, per-opacity ×N, and per-column usage-site lists on `/color` |
| GET | `/api/mtg/log` | mtg chat history |
| GET | `/api/mtg/rule/{number}` | Rule text for the hover/tap preview (`lookup_rule` by number, e.g. `724.1b`). |
| POST | `/api/mtg/chat` | mtg chat (tool-use over rules) SSE |
| GET | `/api/tarot/spreads` | Spread layouts (position coords/labels) |
| GET | `/api/tarot/cards` | 78-card canonical list (id/name/image) |
| POST | `/api/tarot/draw` | Body `{spread_type, significator_id?}` → fresh draw with reversed flags. Significator removed from deck before draw. No server persistence — client stores in `localStorage`. |
| POST | `/api/tarot/chat` | Body `{messages, spread: {type, revealed, face_down_positions, significator?}}` → SSE stream. Server told only about revealed cards; face-down identities never leave the browser. In-process per-IP rate limit (20 req / 60s). |
| POST | `/api/tarot/save` | Body `{significator?, spread?, messages}` → append reading to `tarot_readings.json`. Called by `resetAll()` before wiping local state. Owner-only: saves only when full `session` cookie present (Wai); guests no-op (their readings stay localStorage-only). No-op on empty reading. |
| GET | `/api/tarot/readings` | Full-auth (`protected`, not guest tarot router) → `{readings: [...]}` from `tarot_readings.json`. Rendered in `/debug` tarot-readings section. |
| GET | `/api/gamesave/{slot}` | Nightfall save slot read |
| POST | `/api/gamesave/{slot}` | Nightfall save slot write |
| DELETE | `/api/gamesave/{slot}` | Nightfall save slot delete |
| GET | `/api/hosaka/voices` | Guest-or-full. Proxies the TTS upstream's `/v1/voices` list (empty list on upstream error). |
| GET | `/api/hosaka/health` | Guest-or-full. Probes the TTS upstream → `{ok:true}` or 503 `{ok:false,detail}`. Liveness = a real response (the reverse-tunnel port stays bound when the home server is down). `/hosaka` polls it to show "TTS server offline". |
| WS | `/ws/hosaka` | TTS audio stream reverse-proxy. Public route, but closes (1008) unless a `session` OR `guest_session` cookie matches (guests get the /tarot reader voice); pumps text/bytes both ways between browser and the home GPU upstream. |
| WS | `/ws/hosaka/presence` | Live connected-users count for /hosaka. Same cookie gate (1008 otherwise). Every open page holds one socket; server tracks them in `_presence` and broadcasts `{count}` to all on each join/leave. Separate from `/ws/hosaka` (the audio socket only opens on Speak). |

### Exec chat tools (bubble overlay)

Bound in `chat_tools._TOOL_HANDLERS`; schemas in `chat._chat_tools()`.

| Tool | What |
|------|------|
| `create_card` | Add card. Default column `rd`; pass `column="hq"` for today. If `due_date` given, runs `_apply_schedule` → `scheduler.schedule_to_day()` (rd→hq on due day if in window, overdue clamped to today; `dir_start_min` for today). |
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
- `dir_start_min`: minutes from midnight — the card BLOCK's start (= prep start) for a card scheduled today. The block runs `[dir_start_min, dir_start_min + estimated_time]`; the event block is its final `work` minutes. A card with a **timed** due_date is pinned: `dir_start_min = event_time - prep` (`scheduler.timed_start_min`), so prep back-schedules to finish exactly at the event time. Timeless cards stack forward (`place_card_today` / morning `layout_day` from 10 AM). All scheduling lives in `scheduler.py`. Edited via the hq today-column timeline (drag a block) and drives nudge anchoring. Dragging the master block also retimes the card's due (event) TIME to `block_start + prep` (`saveStartTime`), keeping the due DATE — so the event time follows the drag and a later prep/time edit re-pins to where it was dragged; cards with no due_date just move (no due fabricated). Between-column drags (`/api/hq`) only touch `scheduled_day`, never the due date.
- `size`: **importance** (low→high) `wisp | idea | plan | commitment` — a manual rating, NOT derived from time (estimated_time holds duration; no size→duration mapping). Drives card-fill intensity. Default `idea`.
- `estimated_time`: TOTAL minutes (prep + event) — the timeline block length read by scheduler + nudge.
- `prep_time`: of `estimated_time`, the **prep** minutes — the hands-on lead-up steps that get decomposed (the part Wai stalls on). The remainder (`estimated_time - prep_time` = `work`) is the **event**: an atomic external occurrence you simply attend (class, concert, appointment, show, meeting) and never split. A self-directed task has `work = 0` (all prep, no event block). Auto-filled at creation (exec chat `create_card`, `_card_brief` budgets prep-vs-event in decompose). Editable in the card dialog breakdown row as two fields (prep + event); recalculate rebuilds the graph to that split. null for reminders.
- `is_reminder`: true = calendar alert only, shown in reminders bar on R&D
- `is_book`: true = ongoing read — shown in books bar on HQ, hidden from rd/hq columns in R&D, never scheduled/decomposed (checkbox in card dialog, like `is_reminder`)
- `no_rollover`: true = a fixed occurrence that does NOT carry forward if its day passes (concert, flight, show, scheduled call) — the morning pipeline skips it when rolling past-dated cards to today. Default false (tasks roll forward until done). The **"no-rollover"** checkbox in the card dialog (renamed from the old "event" flag, field `is_event`, migrated on load by `helpers._migrate_cards`). Affects rollover ONLY — not scheduling or decomposition.

**Recurring card revival**: when a card with `recur_type` is archived, a clone is auto-created in `rd` with reset `scheduled_day` and `due_date` advanced via `_next_recurrence()`. The clone's `nudge` state and `dir_start_min` are stripped — each occurrence starts its own loop.

**`card["nudge"]`** (added lazily; absent on most cards): decomposition+nudge loop state — `stage` (`idle|nudging|awaiting|stalled|consequences|resolved`), `graph` (`{nodes:[{id,label,done,depth,created_at,est_min,deadline,tl_offset?,is_event_start?}], edges:[{from,to}]}`, edge = `from` precedes `to`; the **event block** (`is_event_start:true`, `est_min = work`, label = card title) is the terminal sink every prep step points to — present only when `work > 0` (`nudge_deadlines.ensure_event_block`), back-scheduled so it ends at `card_deadline` (= block end) and starts at the anchor; `tl_offset` = a step's start offset in minutes from the card's `dir_start_min`, set when a sub-step is placed on the dirs timeline or its time is edited in the card dialog), `active_node`, `redecompose_count`/`redecompose_at` (metrics), `first_nudge_at`/`next_nudge_at`/`window_deadline`/`last_nudge_at`/`last_user_reply_at` (naive-ET ISO), `awaiting_reply`, `last_nudge_text`, `consequences` (`{asked_at, answer, decision}`), `version`.

---

## Nudge loop (`nudge.py` + `nudge_deadlines.py` + `nudge_loop.py`)

ADHD activation scaffolding: every card = decomposed **prep** steps + (when `work > 0`) one atomic **event block**. The prep back-schedules to finish at the event anchor; a nudge fires at the **start of each step** (prep step or the event block itself — "start commuting at 6:50"); stalls peel a smaller next chunk; due dates are protected behind the consequences conversation.

- **Trigger**: in-process asyncio loop (`_run_nudge_loop` in `nudge_loop.py`, lifespan-started from `main.py`, 30s tick). No cron, no rebuild — state lives on the cards in `rd.json`, so `--reload` restarts just re-arm. `POST /api/nudge/tick` = manual tick.
- **Eligibility** (`_eligible`): `decomposable()` (hq, not reminder/book) AND `scheduled_day == today`. No-Rollover cards are NOT excluded — they sit on the timeline and nudge like any other (their prep + event block). **Anchor** (`active_anchor`): each node's start = its back-scheduled deadline minus its own duration.
- **Everything in hq has a plan** (`decomposable()`): each tick, hq cards missing a graph (excl. reminders + books) get a silent decompose (`_build_graph` — no nudge sent) that builds the **prep steps only** (the event block is appended by `compute_deadlines`/`ensure_event_block`). A card with `prep_time = 0` has no prep steps — it's a single event block (or, for a self-task with `work = 0`, just the standalone work with no event node). The breakdown is visible/editable in the card dialog (`web/card-graph.js` SVG DAG, shown when `card.nudge.graph.nodes` non-empty; per-step label, start time (-> `tl_offset`), and estimate (`est_min`) are all editable; edits persist on dialog save, `active_node` recomputed client-side with the same first-open rule). The hq today-column timeline renders the event block as a dashed block after the prep (`web/hq-groups.js renderSubBlock`); it drags to reschedule the occurrence — moving the whole card so the event lands at the drop, cascading the prep and retiming the due via `saveStartTime` (`wireEvent`) — and resizes to set its own duration (work), folded into `estimated_time = prep + work` by `snapMasterToSubs`.
- **First nudge** = card's placement (`scheduled_day` @ `dir_start_min`). While unfired, `next_nudge_at` tracks the slot each tick.
- **Fire**: decompose on first fire (one LLM call → graph + first chunk + nudge text), else nudge text for the active node. Delivered via the monitor SSE channel + `chat.json` `role=monitor` — same pipe as encouragement comments, zero frontend.
- **Stall**: no reply within `clamp(estimate × 2.6, 45, 240)` min → peel a tinier first sub-step (1-minute floor — "open the app and load the file" is fine, no sub-second flicks; enforced in code by `max(1, est_min)` in `apply_peel`/`_normalize_graph`), inserted as a prerequisite of the stalled node. Any exec-chat user turn counts as a reply and restarts the window.
- **Due-date protection**: `schedule_card` refuses to defer/unschedule an active-nudge card; `record_consequences` → `reschedule_after_consequences` is the only later-day path.
- **Morning (4:30)**: `morning_reconcile()` re-anchors placed-today cards to a fresh first nudge at the restacked slot and disarms others to `idle` (re-arm on their day); never leaves a past-dated `next_nudge_at`.
- **Failure backoff**: per-card 5-min in-memory retry delay on LLM errors; in-flight set prevents double fire.
- **Lateness recalibration** (`recalibration.py`): every completion (`moved→archives`) is tagged with its `category`; late ones (`completed_late`) also carry `minutes_late` + `estimated_time` (`_log_entries_for_patch` / `_minutes_late` in `routes_api.py`). The morning pipeline folds the day's completions into a per-category EMA `factor` (`recalibrate()`), bounded [1.0, 2.0] — late tasks push it up (∝ how late), on-time pull it back toward 1.0. `nudge._factor(card)` reads it and biases `_lead()` (reserve more time), `window_for()` (wider stall window), and `active_anchor()` (nudge earlier) — so a chronically-late category starts sooner with no manual estimate change. Missing/broken store → factor 1.0 (loop never breaks). **GATED OFF** (`recalibration.ENABLED = False`) pending real data: `factor_for`/`recalibrate` no-op (factor 1.0). Telemetry (the `late`/`minutes_late` tags) keeps accruing in archived logs. Late card-action shipped 2026-06-09 (dbfe999) — flip `ENABLED` on once the archives hold a meaningful sample.

---

## Morning pipeline (`POST /api/morning`) — 4:30 AM ET

1. Read today's `activity_log.json`
2. **Retrospective** — extract durable facts only (preferences, relationships, recurring habits) from the day's activity, append to `profile.json`. Never writes time-bound, event-specific, or task-status entries.
3. **Recalibrate** — fold the day's completions into per-category lateness factors (`recalibration.recalibrate`); read before the log is archived.
4. **Purge** — remove time-specific expired notes from `profile.json`
5. **GCal import** — pull calendar events 14 days ahead as cards
6. Archive `activity_log.json` → `activity_log_MMDD.json`, reset to `[]`
7. Archive `moltbook-heartbeat.log` → `moltbook-heartbeat_MMDD.log`, reset to `""`
8. Roll past-dated `scheduled_day` on rd/hq cards forward to today (skip `no_rollover` cards — a missed fixed occurrence stays in the past), auto-promote rd cards with a `due_date` inside the 7-day window to hq (rd->hq via `schedule_to_day`), then `scheduler.layout_day()` autostacks carryover + unpinned timeless today cards from 10 AM while pinning timed cards at `event_time - prep` (preserves cards already placed for today), then `nudge.morning_reconcile()` re-anchors nudge state to the fresh layout
9. Clear `chat.json`
10. Dedupe `profile.json` notes

---

## Exec monitor

`monitor.py` produces unsolicited comments after significant card activity — in Exec's GLaDOS voice (`EXEC_VOICE`, shared with chat), backhanded observations rather than warm encouragement. Trigger = move to archives/exile, a book-card update, or a completed decompose sub-step. A sub-step completes two ways, both significant: the `advance_chunk` chat tool (fired from `routes_chat._dispatch_tools`), OR a **timeline tap-done** in the hq today column — `persistLayout` PATCHes the whole card, and `_log_entries_for_patch` emits an `advanced` log entry (carrying the card `id` + `node_id`) on any nudge node's `done` false→true transition (independent of the card-level diff, so a same-patch column change can't mask it). An `advanced` entry is re-validated at fire time (`_drop_undone_advanced` in `_recent_entries`): if the node is no longer done by the time the debounce fires, the entry is dropped — a step marked done then unmarked (accidental) earns no comment. `monitor.py`'s `schedule_monitor()` runs a 60s trailing debounce (called from `PATCH /api/rd` on a significant entry, and from the chat tool dispatch on a sub-step); `POST /api/monitor/flush` bypasses the wait. The "already-commented" boundary is the last log entry's ts at process start (`_init_monitor_ts`), compared strictly (`>`) so a `--reload`/restart never re-comments the last action. The model generates the comment with context = profile.json + hq cards + books-in-progress + today's schedule. Subscribers receive `{thinking}`/`{comment}` via `/api/monitor/stream` SSE. Posted comment is written to `chat.json` as `role=monitor` so the exec bubble shows it on next load. Every stored message (conversation + monitor) carries a server-side `ts` (ISO-UTC); `chat.json` is kept as ONE chronological stream sorted by `ts` (not conversation-then-monitor), so the bubble renders monitor comments/nudges interleaved in time order rather than dumped at the bottom. `_save_chat` carries each conversation message's original `ts` forward by index (the convo only grows by append) and stamps new tail messages `now`; `append_monitor_comment` stamps + re-sorts. The `ts` key is stripped from the incoming conversation in `routes_chat` before it reaches the Anthropic API (which rejects unknown message keys).

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
| 5:10 AM ET | **HOST** cron `/etc/cron.d/exec-fn-security` → `scripts/security/refresh.py` (root; reads `/var/log`, writes `data/security.json` for `/security`). NOT baked into the image — installed on the droplet host so it can read host logs; `SECURITY_OWNER_IP` set in the cron file. flock-guarded; logs to `/var/log/exec-fn-security.log`. |

Logs: `docker compose logs api` or `docker compose exec api tail -f /var/log/exec-fn.log`

---

## Docker volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `./api/data` | `/app/data` | Persistent data |
| `./api/templates` | `/app/templates` | Templates (hot-reload) |
| `./web` | `/app/static` | Static files (hot-reload) |
| `gcal-auth` | `/root/.config/gcal` | Google Calendar token |

---

## Droplet

OS: Ubuntu 24.04 · IP: `168.144.13.51` · Domain: `wai-lau.net`

- nginx: HTTP 80 → HTTPS redirect, HTTPS 443 → localhost:8080
- Certs: `/etc/letsencrypt/live/wai-lau.net/` (auto-renews)
- SSH: key-only (password auth disabled), **direct root login disabled** (`PermitRootLogin no`); log in as `wai-root` (sudo NOPASSWD) — `ssh wai-root@wai-lau.net`. fail2ban active.
- Container: `restart: unless-stopped`

Fresh setup: `bash bootstrap.sh`.
