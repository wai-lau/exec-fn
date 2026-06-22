# exec-fn

ADHD scaffolding for Wai. Claude runs planning pipeline.

---

## RULES — READ FIRST

**WE ARE ON THE SERVER.** This repo lives at `/exec-fn` on the production server (hostname: main). No SSH or scp needed.

**Template/static file changes are live on next page load** — `api/templates/` files are read from disk per request via `_tmpl()` in `main.py`. `web/static/index.html` is read per request via `_index_pages()` (cached by mtime). `web/` static files are served directly by FastAPI. No restart needed for any of these.

**Python changes are live too** — `./api` is volume-mounted to `/app` (see `docker-compose.yml`) and uvicorn runs with `--reload`, so editing any `api/*.py` on disk auto-reloads the worker. No `docker cp`, no restart, no image drift. (If `--reload` ever misses a change, `docker compose restart api` forces it — but no `docker cp` is needed since the source is mounted.)

**Rebuild only if** `Dockerfile`, `requirements.txt`, `entrypoint.sh`, or `exec-fn.cron` changed:
```bash
docker compose up -d --build
```

**COMMIT after each discrete fix.** Don't batch.

**PRE-COMMIT HOOK** runs automatically on commit: ruff on staged `.py` files, JS syntax + ESLint on HTML templates, stylelint on `web/*.css`, shellcheck on `.sh` files, a **500-line cap** on staged `.py`/`.js` (`api/main.py` allowlisted pending its split), a **no-multiline-inline-JS/CSS** check on templates, plus a non-blocking reminder to update `CLAUDE.md`/`ARCHITECTURE.md` when source changes. Source of truth is `scripts/pre-commit` (version-controlled); `.git/hooks/pre-commit` is a symlink to it — run `bash scripts/install-hooks.sh` to (re)install on a fresh clone. Run `bash scripts/pre-commit` manually to check before committing. Linter configs are tracked: `ruff.toml`, `eslint.config.mjs`, `.stylelintrc.json`, `package.json`.

**UPDATE CLAUDE.md** when routes, pipelines, data files, schemas, or naming conventions change.

**NO INLINE JS/CSS in templates; 500-line cap on `.py`/`.js`.** HTML templates carry no multi-line inline `<script>`/`<style>` — extract to `web/<page>.{js,css}` and reference via `<link>`/`<script src>` (a one-liner `onclick=`/touch-detect handler may stay inline). No `.py`/`.js` over 500 lines: split into modules (`main.py`→`pages.py`+`routers.py`+`routes_views.py`+`routes_api.py`; `nudge.py`+`nudge_deadlines.py`+`nudge_llm.py`+`nudge_loop.py`; `monitor_sse.py`) or same-global-scope files loaded in order (`prophecies-core/groups/board.js`, `tarot-view/chat.js`). Both enforced by the pre-commit hook (no allowlist — every file is under the cap).

---

## System overview

| Layer | What |
|-------|------|
| Droplet | DigitalOcean NYC1, `168.144.13.51`, `wai-lau.net` |
| nginx | Bare-metal, SSL termination, proxies → port 8080 |
| FastAPI | All routes + API endpoints (`api/main.py`) |
| Docker | Single container, `TZ=America/New_York` set in compose |
| Cron | Inside container — fires `POST /api/morning` at 4:30 AM ET |

Models: `claude-opus-4-8` everywhere (main reasoning + cheap checks/merges). Auth: `ANTHROPIC_API_KEY` in `.env`.

---

## File map

```
exec-fn/
  bootstrap.sh            # one-time droplet setup — safe to re-run
  scripts/                # version-controlled git hooks: pre-commit (lint + docs reminder) + install-hooks.sh (symlinks into .git/hooks)
  docker-compose.yml      # TZ=America/New_York; volume-mounts templates + web/static
  nightfall-incident/     # separate repo (wai-lau/nightfall), volume-mounted
  web/                    # static frontend (index.html, fonts, card-dialog.js, images)
    card-dialog.js        # shared card edit dialog used by kanban/prophecies
    card-style.js         # cardStyle()/chipStyle(): fetch the right --card-*/--cat-* token for a card — no color math in JS
    chrome.css            # shared chrome + THE PALETTE, hue-based: every color is an H S% L% channel token (--green-hsl etc.); consume as hsl(var(--X-hsl) / α). Category card colors = --cat-*-h/-s/-l base channels (same H S% L% units as the palette) + materialized --card-* size variants (calc offsets, computed once here). No hard-coded palette literals outside this file (page-unique accents may declare local :root vars, e.g. tarot --ember-hsl). Friendly color name authored as a leading `[Name]` in each token's comment (e.g. `--green-hsl: ...; /* [Matrix Green] usage */`; category name on the `--cat-*-l` knob) — /color reads it as the swatch headline
    chat.css              # terminal chat base (mtg, tarot)
    chat-reader.css       # shared merged-input + reader-voice skin on top of chat.css (mtg + tarot)
    landing.css           # public landing page styles (linked from _landing_html)
    emet.css              # /emet skin: fullscreen graph + always-open node-info bottom strip (#side, 45vh, not collapsible) + cyber-fx pinned on top (z 9999, matches /graph). Injected by emet_page
    recruiter.css         # public /recruiter résumé page — LIGHT theme; page-local --cv-* tokens = deepened legible shades of brand hues (green 135 / cyan 188) on off-white card
    recruiter.js          # /recruiter: (1) dark-mode toggle (#cv-theme) — flips html.cv-dark token overrides + injects tarot CRT overlay (.cyber-bg/.cyber-scan), persisted in localStorage; (2) blurb type-out — blanks .cv-summary then re-types it at ~tarot reading pace behind a .cv-caret that vanishes when done. A .cv-fake span's data-decoy types+backspaces a decoy before the real text. Click the blurb to skip to final text. Reduced-motion = instant blurb, no caret
    guru-pink.png         # pink Guru sprite (glasses) — Exec bubble icon
    exec-todos.js         # exec-panel scratch todo list (top section): GET/POST/DELETE /api/todos. window.execBuildTodos(panel) called by exec-bubble.js after buildPanel(); shares its global scope. Items DELETED on checkbox (separate from rd.json cards, which archive)
    # nav icons (27x27 program art): seeker(core) sentinel(profs)
    #   bug(debug) laser-satellite(graph) golem-stone(emet) data-doctor(color) hack2(night)
    #   wizard(mtg) watchman(tarot)   (turbo/bitman/fiddle.png now unused)
    data-file.png         # recruiter/cv nav icon: nightfall grid/data.png (3-paper "file" stack) composited onto a Sentinel-orange rgb(252,152,0) tile so it reads like the other solid-bg sprites
    # all *.png gitignored; each nav icon whitelisted in .gitignore
  api/
    main.py               # thin FastAPI entry point: app, lifespan (nudge loop), no-cache middleware, 401->redirect handler, include_router + static mounts. No routes/helpers — those live in the modules below
    routers.py            # the 3 shared APIRouters (public/protected/guest_protected) + sub-router includes (nightfall/chat/mtg/tarot). Defined here so route modules decorate them without importing main (would cycle)
    pages.py              # page composition: _build_nav(), _render_page() (cached chrome HTML by mtime), _index_pages(), _tmpl() (per-request template read), nav constants/icons/labels
    routes_views.py       # HTML page routes (landing/login/guest/recruiter, prophecies/debug/color/graph/emet/rd/mtg/tarot/nightfall) + read-only view-data GETs (color/usage, debug/logs, tarot/readings, moltbook log) + /data file serving
    graph_scrub.py        # serve-time scrubbing of graphify's /graph HTML (imported by graph_page): _redact_graph_nodes() blanks leaky node summaries; _drop_graph_book_nodes() cuts the api/tarot/book/ Pollack reference nodes + their edges/legend rows/hyperedges (the narrative "shaded region" clusters off the book, e.g. "...gathered into the Chariot's ego"). Per-line anchored array match (^NAME = [...];$, optional const/var/let) — a non-greedy [.*?] would truncate at a `];` inside a node title. Runs per request so edits survive /graphify rebuilds
    routes_api.py         # JSON API routes: card CRUD (/api/rd GET+PATCH+recalc), morning, prophecies, classify, profile/context, todos (exec scratch list), gcal, parse_date, monitor stream/flush, nudge tick. Holds _atomic_write_json/_log_entries_for_patch/_minutes_late/_recompute_node_deadlines/_flag_triage
    auth.py               # SESSION_TOKEN, GUEST_SESSION_TOKEN; require_auth + require_guest_auth deps
    morning.py            # morning pipeline (build_morning): retrospective, purge stale notes, archive log, roll+restack, reconcile
    scheduler.py          # single home for scheduling: schedule_to_day() (canonical rd->hq promotion + scheduled_day on due day, shared by morning pipeline + exec chat), layout_day() (cron autostack entry point), place_card_today() (intraday slot >= now). SCHED_WINDOW_DAYS=6 (7-day window)
    monitor.py            # exec-bubble monitor: generate_encouragement(), significant-activity detection, + the trailing-60s debounce runtime (schedule_monitor/flush_monitor/_run_monitor) moved out of main
    routes_chat.py        # /api/chat SSE stream + handler (exec planning tools)
    routes_nightfall.py   # /api/gamesave/* + build_nightfall_html() (injects base href, SW unregister, save sync)
    entrypoint.sh         # Docker CMD: cron + uvicorn
    exec-fn.cron          # crontab baked into image (4:30 AM ET morning cron only)
    morning_cron.sh       # cron script → POST /api/morning
    gcal_auth.py          # one-time Google Calendar OAuth
    gcal.py               # GCal helpers: fetch_calendar_events, import_gcal_cards, ICS feeds, LLM classification
    helpers.py            # shared helpers: _next_recurrence(), _load_json (mtime cache), _append_rd_log_batch, _now_et
    prophecies.py         # prophecies module: get_week_data(), bulk_update_scheduled_days()
    chat.py               # exec chat: system prompt (+ ACTIVE NUDGE block), tool definitions, _dedupe_context, _save_chat/get_chat, append_monitor_comment
    card_llm.py           # one-shot card LLM helpers (not chat): classify_card() category+importance, parse_date_natural() NL due date → ISO. Used by the card API endpoints
    chat_tools.py         # exec chat tool handlers: create_card, exile_card, update_card, schedule_card, update_context, decompose_task, advance_chunk, record_consequences, reschedule_after_consequences
    nudge.py              # nudge ENGINE leaves: card["nudge"] state, eligibility, slot/window math, graph helpers (_first_open/_normalize_graph), clear_awaiting_focused(), active_label(). _factor() biases lead/window by recalibration.factor_for()
    nudge_deadlines.py    # deadline math: card_deadline() precedence, staggered assign_auto_deadlines(), DAG back-schedule of per-node deadlines (compute_deadlines), event terminal node, active_anchor(), morning_reconcile(). Imports nudge leaves one-way
    nudge_llm.py          # nudge LLM calls: decompose_sync/triage_sync/peel_sync/nudge_text_sync (+ _card_brief/_profile_text/_json_call). Imports nudge engine one-way
    nudge_loop.py         # in-process asyncio nudge ticker (_run_nudge_loop/_nudge_tick/_scan/_fire) — split out of main.py
    monitor_sse.py        # exec-bubble SSE fan-out: push_to_monitor() + _monitor_subscribers (shared by monitor + nudge_loop)
    recalibration.py      # per-category lateness factor (EMA over completions): factor_for(card), recalibrate(log_entries). Consumes `late` telemetry, fed by morning pipeline
    mtg/
      routes.py           # /api/mtg/log + /api/mtg/chat (SSE) + /api/mtg/rule/{number} (rule text for hover/tap preview)
      agent.py            # two-pass stream_chat: pass 1 = research (tool loop, prose discarded, only lookup chips surface); pass 2 = streamed summarize (prompt.SUMMARIZE) — one committed verdict, no think-out-loud / flip-flop / contradicting headline
      prompt.py tools.py lookup.py
    tarot/
      routes.py           # /api/tarot/{spreads,cards,draw,chat}; in-process IP rate-limit on /chat
      agent.py            # streaming tool-use loop with text + tool_call SSE events
      prompt.py           # _PREAMBLE + _OPERATING_RULES; lru_cache build_system(spread_type)
      cards.py            # canonical 78-card list (CARDS, CARDS_BY_ID)
      spreads.py          # SPREADS dict — currently only "three" (Three-Card)
      tools.py            # lookup_card_meaning, set_significator, deal_spread tool schemas + handlers
      lookup.py           # Pollack chapter loader (lru_cache); framework + suits + numerology loader
      book/               # Pollack reference material — never shown to querent
        framework_core.md framework_minor.md framework_three.md framework_celtic_cross.md
        numerology.md
        cards/<card_id>.md  # per-Major chapter (Minors read from suit+numerology)
        suits/{cups,wands,swords,pentacles}.md
      scripts/            # one-off scripts (e.g. download_cards.py)
    requirements.txt
    Dockerfile
    templates/            # volume-mounted → live on save
      kanban.html         # /rd — core kanban; book cards hidden from rd/hq columns
      prophecies.html     # /prophecies — 7-day planning, 3 columns: today (TIMELINE: grid + dir_start_min blocks, drag/resize+drag-out-to-day/unschedule, now-line, past-hider, autoscroll; a card with a breakdown (>=2 steps) renders as a vertical master spine + its sub-steps as their own draggable/resizable blocks to the right — sub starts = nudge-node `tl_offset` from the master start, master snaps to the sub bounding box, editing one sub freezes the rest) | next 3 days | last 3 days (small cards). Full week on screen. Books bar moved to core.
      debug.html          # /debug — profile.json + activity logs viewer
      color.html          # /color — read-only palette moodboard; parses chrome.css :root tokens live
      emet.html           # /emet — protected static page; emet_page() injects chrome+cyber-fx+nav like graph (gitignored; edit on-server)
      guest_login.html    # /guest login form fragment ({next} placeholder filled by main.py)
      recruiter.html      # /recruiter — public résumé markup (styles in web/recruiter.css)
      mtg.html            # /mtg — rules-assistant chat
      tarot.html          # /tarot — spread + reader chat (localStorage state; reading saved server-side on reset)
    data/                 # persistent volume (./api/data → /app/data)
      rd.json             # core kanban cards
      profile.json        # Wai's long-term context notes (replaces context.json)
      activity_log.json   # today's card activity log (archived at 4:30 AM)
      activity_log_MMDD.json  # archived daily activity logs
      chat.json           # exec chat history (cleared each morning)
      gcal_events_raw.json    # cached raw GCal pull (written on full-year imports)
      moltbook-heartbeat.log  # moltbook heartbeat ledger (archived each morning)
      tarot_readings.json     # saved tarot readings (appended by /api/tarot/save on reset; owner-only — logged-in Wai)
      recalibration.json      # {categories:{<cat>:{factor,samples,updated}}} — per-category lateness EMA; written by morning recalibrate step, read by nudge._factor()
      exec_todos.json         # {items:[{id,text}]} — exec-panel scratch todo list; lightweight, separate from rd.json (checkbox = delete, not archive). GET/POST/DELETE /api/todos
```

---

## Terminology

| Term | Meaning |
|------|---------|
| core | Main kanban — all cards (`rd.json`) |
| rd column | Upcoming ideas/backlog — card added here by default |
| hq column | Active working set |
| archives column | Completed tasks |
| exile column | Won't-do tasks |
| prophecies (prof) | 7-day planning view — assigns `scheduled_day` to cards. 3 columns: today (timeline) \| next 3 days \| last 3 days (small cards) |
| scheduled_day | ISO date field on a card indicating which day it's planned for |
| recur_type | Recurrence type; when archived, clone auto-created with advanced due_date |
| reader / querent | Tarot terminology: reader = AI; querent = human |
| Significator | Court card chosen by the reader during Phase 1 to represent the querent; removed from deck before draw |
| frame | Tarot Three-Card frame: `past_present_future` or `situation_obstacle_advice`; relabels position UI |

---

## Web app

`/` is a public landing page (`_landing_html()`, styles in `web/landing.css`) — a vertically-centered column of sections ordered by icon hue (`_LANDING_HUE_ORDER` in routes_views: recruiter · graph · nightfall · color · mtg · tarot), each with a Gibson-register blurb + plain description (`_LANDING_BLURBS`/`_LANDING_DESCS`), no auth, no exec bubble. Cyberpunk fx: CRT scanlines/flicker (`.cyber-bg`), sweeping scan beam (`.cyber-scan`), icons scale on hover, boot-in stagger (honors `prefers-reduced-motion`). An `admin` link sits bottom-right → `/login`. Logged-in admins (valid `session` cookie) skip the landing and 302 to `/rd`. Clicking a section follows the 401 redirect to the right login.

Two cookie auth tiers:
- `session` cookie (set via `POST /login`, requires `API_KEY`) — full access. Login form at `GET /login` (already-authed visitors redirect to `?next=`/`/rd`).
- `guest_session` cookie (set via `POST /guest`, requires `GUEST_KEY`) — only `/mtg`, `/tarot`, `/nightfall`. Login form at `GET /guest`. `GET /guest-login` is a 302 alias to `/guest` (bookmark compat).

Both cookies: `HttpOnly`, `SameSite=Lax`, `Secure`. `/guest` `next` param is allowlisted (`/mtg`, `/tarot`, `/nightfall` only); arbitrary values are clamped to `/mtg`. 401 on an HTML GET redirects protected pages to `/login?next=`, guest pages (`/mtg`, `/tarot`) to `/guest?next=`. Both login forms carry a visually-hidden `username` input (autocomplete=username) so password managers can store/fill credentials.

Nav: `core` · `prophecies` · `debug` · `graph` · `emet` · `color` · `nightfall` · `mtg` · `tarot` · `cv` (→`/recruiter`) — bottom nav, all pages. **Exec** is NOT a nav entry — it's a floating draggable bubble (`#exec-bubble`, `guru-pink.png` glasses icon, `exec-bubble.js` + `exec-bubble-drag.js`) injected by `_build_nav()` ONLY on the planning routes (`/rd` core + `/prophecies` dirs) for non-guests. Clicking/tapping the bubble toggles the Exec chat panel. The panel's top section is a server-persisted scratch **todo list** (`exec-todos.js`, `exec_todos.json`) — sizes to its content up to half the panel, then scrolls; an add-input sits at the top, a clear divider line under the list, and the chat fills the rest below. Items are DELETED on checkbox (distinct from rd.json cards, which archive). No `/exec` route. Unread monitor count shows as a badge on the bubble. Appending `?exec=open` to core/prophecies opens the chat expanded on load. Bubble position persists in `localStorage` (`exec-bpos`), clamped to viewport. (The standalone `/directives` timeline page was removed — the timeline now lives in the prophecies today column.)

### Pages

| Route | What |
|-------|------|
| `/rd` | Core kanban from `rd.json` |
| `/prophecies` | 7-day planning — assign `scheduled_day` to cards. 3 columns: today (timeline) \| next 3 days \| last 3 days (small cards) |
| `/debug` | Profile notes + activity log viewer + saved tarot readings |
| `/graph` | **Public** (no auth). Self-contained graphify codebase viz from the `./graphify-out` volume (regenerated by `/graphify`), served by `graph_page()` in routes_views.py — chrome.css + cyber-fx bg + bottom nav + `web/graph-overlay.{css,js}` (nav restyle + live physics panel) all injected at serve time so they survive `/graphify` rebuilds. Non-admins get the guest nav (the full nav links to login-gated pages); admins keep the full nav. A few node summaries that would leak internals (e.g. the bearer-auth scheme + the `EXEC_SAY_KEY` name) are scrubbed to `[redacted]` at serve time by `_redact_graph_nodes()` / `_GRAPH_REDACT_IDS` (operates on graphify's embedded `RAW_NODES`; survives rebuilds, same rationale as the improvedLayout patch). The Pollack tarot reference book (`api/tarot/book/` — card meanings/frameworks/numerology, ~110 nodes) is dropped wholesale at serve time by `_drop_graph_book_nodes()` (prefix `_GRAPH_DROP_SOURCE_PREFIX`, via `_sub_json_array()`): removes those `RAW_NODES`, prunes `RAW_EDGES` touching them, drops their now-empty `LEGEND` rows ("Tarot Major Arcana Meanings"/"Tarot Core Framework"/"Celtic Cross Spread"), and drops the `hyperedges` (shaded narrative clusters off the book, e.g. "First-row forces gathered into the Chariot's ego") that reference any removed node — tarot *engine* nodes stay; same survives-rebuild rationale. Uses a per-line anchored array regex (a non-greedy `[.*?]` truncates at a `];` inside a node title). Separately, `graph-overlay.js` client-side redacts any node *label* >20 chars to `[ redacted ]`, reloads the page when the device wakes from sleep (interval-gap >30s → `location.reload()`), and clamps zoom/pan (`setupZoomLimits()`) with hard walls so the viewport holds roughly between 2 and half the non-orphan nodes — translates that intent into min/max scale (viewport world-area vs. node-cloud area) + a pan box (centre clamped to the node bounding box), recomputed live, and clamps in place on each user zoom/drag so the camera stops AT the threshold (no snap-back); programmatic camera moves (tour focus) are skipped (`zoom` params.event == null). Content-hash ETag + `no-cache`. |
| `/emet` | **Protected** vis-network knowledge graph (Wai's personal graph). `emet_page()` in routes_views.py serves the `templates/emet.html` renderer and injects the graph DATA inline as `window.EMET_GRAPH` from `templates/emet-graph.json` (`{meta,nodes,edges}` — `<` escaped to `<`). **Both emet.html + emet-graph.json are gitignored sensitive personal data — never commit** (see memory). Same UI shell as /graph: chrome.css + cyber-fx bg + bottom nav + content-hash ETag/`no-cache` cache-bust. `web/emet.css` skins it: fullscreen graph + an always-open **node-info** bottom strip (`#side`, 45vh, not collapsible) showing the selected node's summary, parent/child links (white glowing ▲/▶ triangles), and observations. Selecting a node recenters the camera, dims+desaturates everything outside the node+children, and glows only the selected node + its edges. Cyber fx pinned on top (z 9999) so scanlines never pan with the graph. Data lives in `api/templates/` (not the public `/app/static` mount) so it stays auth-gated. Nav label = `EMET` (uppercased by nav CSS), icon = `golem-stone.png` (nightfall GolemStone sprite), next to graph. |
| `/color` | **Public** (no auth — palette only, no data). Read-only moodboard: one little table per color, one per row (hue-ordered; neutrals at the end). Title (friendly `[Name]`) above; table padded to 4 columns (the variations — card colors = wisp/idea/plan/commitment, non-card `-hsl` colors = their used alpha steps, empty trailing cols); rows = swatch / opacity / count / effects / per-column usage-site list (each variation's sites, most-used first); usage description under the table. Tokens with the same H S L merge into one (max 4 variations); a non-card token's alpha usages map onto the nearest card size (`SIZE_ALPHA` = wisp .15 / idea .25 / plan .8 / commitment 1) — for card colors the count row is text `(sizes +N)×` of those mapped usages, for non-card it's per-column `×N` from `alpha_counts`. Effects (e.g. blur) sit in their column. Edit colors in chrome.css; this page just watches. Admin cookie → full nav, else guest nav |
| `/nightfall` | Standalone game (semi-public, guest auth) |
| `/mtg` | MTG rules assistant (semi-public, guest auth). Card names show a Scryfall image preview on hover; rule citations (e.g. `724.1b`) show the rule text on hover/tap (mtg.js `_linkifyRules` wraps them, fetches `/api/mtg/rule/{number}`). |
| `/tarot` | Tarot reading: spread (top, fixed-height) + Pollack-voiced reader chat (bottom); guest auth; per-browser state in `localStorage` (no server persistence) |
| `/recruiter` | **Public** (no auth). Clean static résumé page for recruiters — **light theme** (the one page that departs from the black palette): white card on off-white, accents = deepened legible shades of the brand hues (green 135 / cyan 188) kept as page-local `--cv-*` tokens in `recruiter.css`, no nav / no cyber fx. Skills render as chips; cyan "Download résumé (PDF)" CTA. Built from the bare shell like the landing (`recruiter_page()` in routes_views.py, markup in `templates/recruiter.html`, styles in `web/recruiter.css`). CTA → Google Doc PDF export. Top-right **dark-mode toggle** (`#cv-theme`, recruiter.js) flips to a green-on-black terminal (token overrides under `html.cv-dark`) with the tarot CRT scanline overlay, persisted in localStorage. Summary blurb types itself out on load (tarot-paced). Linked from the bottom nav (`cv`, `data-file.png` icon) and the landing page (hue-ordered first). |

### API endpoints

| Method | Path | What |
|--------|------|------|
| POST | `/api/morning` | retrospective, purge stale notes, archive activity_log, reset chat (4:30 AM cron) |
| GET | `/api/rd/log` | Today's activity log (last 20 entries) |
| GET | `/api/rd` | Returns rd.json |
| PATCH | `/api/rd` | Update rd.json (source query param: core/Exec/prof/dirs). Atomic write. Runs recurring-card revival on archived cards with `recur_type`. Schedules monitor debounce if any entry is significant. |
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
| GET | `/api/prophecies` | 7-day week data starting from `?start=YYYY-MM-DD` (defaults to logical-today): scheduled cards + unscheduled hq cards |
| PATCH | `/api/prophecies` | Bulk update `scheduled_day` and/or `order` on cards; logs `rescheduled` entries with `source=prof`. Cards unscheduled (null) drop back to `column=rd`. |
| GET | `/api/prophecies/log` | Activity log filtered by source=prof |
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

### Exec chat tools (bubble overlay)

Bound in `chat_tools._TOOL_HANDLERS`; schemas in `chat._chat_tools()`.

| Tool | What |
|------|------|
| `create_card` | Add card. Default column `rd`; pass `column="hq"` for today. If `due_date` given, runs `_apply_schedule` → `scheduler.schedule_to_day()` (rd→hq on due day if in window, overdue clamped to today; `dir_start_min` for today). |
| `exile_card` | Move card to exile column (drop / won't-do). Clears `scheduled_day`. |
| `update_card` | Edit title/category/size (importance)/estimated_time/prep_time/notes/is_reminder/is_book. Size is a manual importance rating — not derived from estimated_time. `estimated_time` is total (prep+work); `prep_time` is the lead-up slice. |
| `schedule_card` | Set or clear `scheduled_day` via `scheduler.schedule_to_day()`. Beyond 7-day window → sets `due_date` only and parks in rd; inside window → moves to hq with `scheduled_day` (overdue target clamped to today). Target = today auto-assigns `dir_start_min` via `scheduler.place_card_today()` (explicit `dir_start_min` overrides); other days clear it. |
| `update_context` | add/remove/replace a fact in `profile.json`. |
| `decompose_task` | Build/rebuild the card's internal dependency graph (`card["nudge"]["graph"]`) and pick the first chunk. Optional `feedback` rebuilds from the existing breakdown. Not for reminders/events/books. |
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
  "recur_type": null,
  "scheduled_day": null,
  "dir_start_min": null
}
```

- `recur_type`: null | "week" | "bi-week" | "month" | "holiday" | "birthday"
- `scheduled_day`: ISO date — which day the card is planned for (Prophecies)
- `dir_start_min`: minutes from midnight — intraday slot for a card scheduled today. Set whenever a card is scheduled for today (exec chat, rd→hq promotion) via `scheduler.place_card_today()`; morning cron autostacks carryover + unpinned today cards from 10 AM via `scheduler.layout_day()`. All scheduling lives in `scheduler.py`. Edited via the prophecies today-column timeline (drag a block) and drives nudge anchoring.
- `size`: **importance** (low→high) `wisp | idea | plan | commitment` — a manual rating, NOT derived from time (estimated_time holds duration; no size→duration mapping). Drives card-fill intensity. Default `idea`.
- `estimated_time`: TOTAL minutes (prep + core work) — the timeline block length read by scheduler + nudge.
- `prep_time`: of `estimated_time`, the lead-up/getting-ready/travel/setup minutes before the real work (`estimated_time - prep_time` = core work). Auto-filled at creation (exec chat `create_card`, `_card_brief` budgets prep-vs-work in decompose). Editable in the card dialog breakdown row as two fields (prep + work); recalculate rebuilds the graph to that split. null for reminders.
- `is_reminder`: true = calendar alert only, shown in reminders bar on kanban
- `is_book`: true = ongoing read — shown in books bar on prophecies, hidden from rd/hq columns in kanban, never scheduled/decomposed (checkbox in card dialog, like `is_reminder`)

**Recurring card revival**: when a card with `recur_type` is archived, a clone is auto-created in `rd` with reset `scheduled_day` and `due_date` advanced via `_next_recurrence()`. The clone's `nudge` state and `dir_start_min` are stripped — each occurrence starts its own loop.

**`card["nudge"]`** (added lazily; absent on most cards): decomposition+nudge loop state — `stage` (`idle|nudging|awaiting|stalled|consequences|resolved`), `graph` (`{nodes:[{id,label,done,depth,created_at,est_min,deadline,tl_offset?}], edges:[{from,to}]}`, edge = `from` precedes `to`; `tl_offset` = a step's start offset in minutes from the card's `dir_start_min`, set when a sub-step is placed on the dirs timeline or its time is edited in the card dialog), `active_node`, `redecompose_count`/`redecompose_at` (metrics), `first_nudge_at`/`next_nudge_at`/`window_deadline`/`last_nudge_at`/`last_user_reply_at` (naive-ET ISO), `awaiting_reply`, `last_nudge_text`, `consequences` (`{asked_at, answer, decision}`), `version`.

---

## Nudge loop (`nudge.py` + `nudge_deadlines.py` + `nudge_loop.py`)

ADHD activation scaffolding: a card placed on today's timeline gets a nudge at its slot time; stalls peel a smaller next chunk; due dates are protected behind the consequences conversation.

- **Trigger**: in-process asyncio loop (`_run_nudge_loop` in `nudge_loop.py`, lifespan-started from `main.py`, 30s tick). No cron, no rebuild — state lives on the cards in `rd.json`, so `--reload` restarts just re-arm. `POST /api/nudge/tick` = manual tick.
- **Eligibility** (`_eligible`): `decomposable()` (hq, not reminder/book — events included) AND `scheduled_day == today`. Everything with a plan scheduled today nudges. **Anchor** (`nudge_anchor`): the timeline slot (`dir_start_min`) if placed, else 10 AM (or now if past) — so today-scheduled cards without a slot still nudge without firing pre-dawn.
- **Everything in hq has a plan** (`decomposable()`): each tick, hq cards missing a graph (incl. events — they can have prep steps; excl. reminders + books) get a silent decompose (`_build_graph` — no nudge sent). Events get a plan but never a time-based nudge (`_eligible` excludes them via `is_dir_card`). The breakdown is visible/editable in the card dialog (`web/card-graph.js` SVG DAG, shown when `card.nudge.graph.nodes` non-empty; per-step label, start time (-> `tl_offset`), and estimate (`est_min`) are all editable; edits persist on dialog save, `active_node` recomputed client-side with the same first-open rule).
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
8. Roll past-dated `scheduled_day` on rd/hq non-event cards forward to today (events don't roll — a past event already happened), auto-promote rd cards with a `due_date` inside the 7-day window to hq (rd->hq via `schedule_to_day`; **events included** — they promote but never time-nudge), then `scheduler.layout_day()` autostacks carryover + unpinned today cards from 10 AM (preserves cards already placed for today), then `nudge.morning_reconcile()` re-anchors nudge state to the fresh layout
9. Clear `chat.json`
10. Dedupe `profile.json` notes

---

## Exec monitor

`monitor.py` produces unsolicited warm comments after significant card activity. Trigger = move to archives/exile, or book-card update. `main.py` runs a 60s trailing debounce (`_schedule_monitor`); `POST /api/monitor/flush` bypasses the wait. The model generates the comment with context = profile.json + hq cards + books-in-progress + today's schedule. Subscribers receive `{thinking}`/`{comment}` via `/api/monitor/stream` SSE. Posted comment is appended to `chat.json` as `role=monitor` so the exec bubble shows it on next load.

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
| 4:30 AM ET | `morning_cron.sh` → `POST /api/morning` |

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
- SSH: password auth disabled, fail2ban active
- Container: `restart: unless-stopped`

Fresh setup: `bash bootstrap.sh`.
