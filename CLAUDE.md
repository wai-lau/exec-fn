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

**PRE-COMMIT HOOK** runs automatically on commit: ruff on staged `.py` files, JS syntax + ESLint on HTML templates, shellcheck on `.sh` files. Run `.git/hooks/pre-commit` manually to check before committing.

**UPDATE CLAUDE.md** when routes, pipelines, data files, schemas, or naming conventions change.

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
  docker-compose.yml      # TZ=America/New_York; volume-mounts templates + web/static
  nightfall-incident/     # separate repo (wai-lau/nightfall), volume-mounted
  web/                    # static frontend (index.html, fonts, card-dialog.js, images)
    card-dialog.js        # shared card edit dialog used by kanban/prophecies/directives
    boss-green.png        # green-recolored Boss.png — Exec nav icon
    # nav icons (27x27 program art): laser-satellite(core) fiddle(profs)
    #   bug(debug) hack2(night) wizard(mtg) watchman(tarot)
    #   (turbo.png = old dirs icon, now unused)
    # all *.png gitignored; each nav icon whitelisted in .gitignore
  api/
    main.py               # FastAPI routes; _render_page() page composer (cached chrome HTML by mtime); nav builder; _tmpl() reads templates from disk per request; _atomic_write_json() for rd/profile writes
    auth.py               # SESSION_TOKEN, GUEST_SESSION_TOKEN; require_auth + require_guest_auth deps
    pipeline.py           # morning pipeline: retrospective, purge stale notes, archive log
    scheduler.py          # single home for scheduling: schedule_to_day() (canonical rd->hq promotion + scheduled_day on due day, shared by morning pipeline + exec chat), layout_day() (cron autostack entry point), place_card_today() (intraday slot >= now). SCHED_WINDOW_DAYS=5 (6-day window)
    monitor.py            # exec-bubble monitor: generate_encouragement(), significant-activity detection
    routes_chat.py        # /api/chat SSE stream + handler (exec planning tools)
    routes_nightfall.py   # /api/gamesave/* + build_nightfall_html() (injects base href, SW unregister, save sync)
    entrypoint.sh         # Docker CMD: cron + uvicorn
    exec-fn.cron          # crontab baked into image (4:30 AM ET morning cron only)
    morning_cron.sh       # cron script → POST /api/morning
    gcal_auth.py          # one-time Google Calendar OAuth
    gcal.py               # GCal helpers: fetch_calendar_events, import_gcal_cards, ICS feeds, LLM classification
    helpers.py            # shared helpers: _next_recurrence(), _load_json (mtime cache), _append_rd_log_batch, _now_et
    prophecies.py         # prophecies module: get_week_data(), bulk_update_scheduled_days()
    chat.py               # exec chat: system prompt (+ ACTIVE NUDGE block), tool definitions, classify_card, parse_date_natural, _save_chat
    chat_tools.py         # exec chat tool handlers: create_card, exile_card, update_card, schedule_card, update_context, decompose_task, advance_chunk, record_consequences, reschedule_after_consequences
    nudge.py              # decomposition+nudge loop: card["nudge"] state, eligibility, window math, LLM cores (decompose/peel/nudge-text), clear_awaiting_focused(), morning_reconcile(). _factor() biases lead/window/anchor by recalibration.factor_for()
    recalibration.py      # per-category lateness factor (EMA over completions): factor_for(card), recalibrate(log_entries). Consumes `late` telemetry, fed by morning pipeline
    mtg/
      routes.py           # /api/mtg/log + /api/mtg/chat (SSE)
      agent.py prompt.py tools.py lookup.py
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
      plan.html           # /plan — legacy daily plan view
      kanban.html         # /rd — core kanban; book cards hidden from rd/hq columns
      prophecies.html     # /prophecies — 6-day planning kanban, 3 columns: today | tomorrow+day-after | next-3-days (small cards); books bar at top
      debug.html          # /debug — profile.json + activity logs viewer
      mtg.html            # /mtg — rules-assistant chat
      tarot.html          # /tarot — spread + reader chat (localStorage state; reading saved server-side on reset)
    data/                 # persistent volume (./api/data → /app/data)
      plan.json           # seek/hack/dive/schedule/encouraging_message
      directives.json     # legacy alias for plan.json
      rd.json             # core kanban cards
      profile.json        # Wai's long-term context notes (replaces context.json)
      activity_log.json   # today's card activity log (archived at 4:30 AM)
      activity_log_MMDD.json  # archived daily activity logs
      chat.json           # exec chat history (cleared each morning)
      gcal_events_raw.json    # cached raw GCal pull (written on full-year imports)
      moltbook-heartbeat.log  # moltbook heartbeat ledger (archived each morning)
      tarot_readings.json     # saved tarot readings (appended by /api/tarot/save on reset; owner-only — logged-in Wai)
      recalibration.json      # {categories:{<cat>:{factor,samples,updated}}} — per-category lateness EMA; written by morning recalibrate step, read by nudge._factor()
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
| prophecies (prof) | 6-day planning view — assigns `scheduled_day` to cards. 3 columns: today \| tomorrow+day-after \| next-3-days (small cards) |
| scheduled_day | ISO date field on a card indicating which day it's planned for |
| recur_type | Recurrence type; when archived, clone auto-created with advanced due_date |
| reader / querent | Tarot terminology: reader = AI; querent = human |
| Significator | Court card chosen by the reader during Phase 1 to represent the querent; removed from deck before draw |
| frame | Tarot Three-Card frame: `past_present_future` or `situation_obstacle_advice`; relabels position UI |

---

## Web app

`/` is a public landing page (`_landing_html()`, styles in `_LANDING_STYLE`) — a vertically-centered column of the **non-admin** sections only (nightfall, mtg, tarot; `_GUEST_NAV_LINKS`), no auth, no exec bubble. Cyberpunk fx: CRT scanlines/flicker (`.cyber-bg`), sweeping scan beam (`.cyber-scan`), icons scale on hover, boot-in stagger (honors `prefers-reduced-motion`). An `admin` link sits bottom-right → `/login`. Logged-in admins (valid `session` cookie) skip the landing and 302 to `/rd`. Clicking a section follows the 401 redirect to the right login.

Two cookie auth tiers:
- `session` cookie (set via `POST /login`, requires `API_KEY`) — full access. Login form at `GET /login` (already-authed visitors redirect to `?next=`/`/rd`).
- `guest_session` cookie (set via `POST /guest`, requires `GUEST_KEY`) — only `/mtg`, `/tarot`, `/nightfall`. Login form at `GET /guest`. `GET /guest-login` is a 302 alias to `/guest` (bookmark compat).

Both cookies: `HttpOnly`, `SameSite=Lax`, `Secure`. `/guest` `next` param is allowlisted (`/mtg`, `/tarot`, `/nightfall` only); arbitrary values are clamped to `/mtg`. 401 on an HTML GET redirects protected pages to `/login?next=`, guest pages (`/mtg`, `/tarot`) to `/guest?next=`. Both login forms carry a visually-hidden `username` input (autocomplete=username) so password managers can store/fill credentials.

Nav: `core` · `prophecies` · `debug` · `graph` · `nightfall` · `mtg` · `tarot` — bottom nav, all pages. Exec is a bubble overlay (`exec-bubble.js`) injected onto the planning pages (`core`/`prophecies`) by `_build_nav()`; no `/exec` route. Appending `?exec=open` to a planning page URL opens the bubble expanded on load. (The `/directives` timeline page was removed — its today-schedule role folded into the prophecies today column.)

### Pages

| Route | What |
|-------|------|
| `/rd` | Core kanban from `rd.json` |
| `/prophecies` | 6-day planning kanban — assign `scheduled_day` to cards. 3 columns: today \| tomorrow+day-after \| next-3-days (small cards) |
| `/debug` | Profile notes + activity log viewer + saved tarot readings |
| `/nightfall` | Standalone game (semi-public, guest auth) |
| `/mtg` | MTG rules assistant (semi-public, guest auth) |
| `/tarot` | Tarot reading: spread (top, fixed-height) + Pollack-voiced reader chat (bottom); guest auth; per-browser state in `localStorage` (no server persistence) |

### API endpoints

| Method | Path | What |
|--------|------|------|
| POST | `/api/morning` | retrospective, purge stale notes, archive activity_log, reset chat (4:30 AM cron) |
| GET | `/api/plan` | Returns plan.json |
| GET | `/api/directives` | Returns plan.json (alias) |
| GET | `/api/rd/log` | Today's activity log (last 20 entries) |
| GET | `/api/rd` | Returns rd.json |
| PATCH | `/api/rd` | Update rd.json (source query param: core/Exec/prof/dirs). Atomic write. Runs recurring-card revival on archived cards with `recur_type`. Schedules monitor debounce if any entry is significant. |
| POST | `/api/rd/classify` | Classify card via LLM → category + size |
| GET | `/api/context` | Returns profile.json (alias of `/api/profile`) |
| GET | `/api/profile` | Returns profile.json |
| PATCH | `/api/context` | Replace profile.json `notes` field. Atomic write. |
| GET/POST/DELETE | `/api/chat` | Exec chat history (planning SSE). |
| GET | `/api/monitor/stream` | SSE stream — exec-bubble live updates: `{thinking}` / `{comment}` payloads as significant activity rolls in. |
| POST | `/api/monitor/flush` | Force-fire the monitor immediately if there is significant activity since the last comment (bypasses 60s debounce). |
| GET | `/api/moltbook/heartbeat-log` | Plain text of `moltbook-heartbeat.log` (today's heartbeat ledger). |
| POST | `/api/nudge/tick` | Manual one-shot tick of the nudge loop (the in-process asyncio loop in `main.py` runs this every 30s; started from the FastAPI lifespan hook — no cron). |
| GET | `/api/gcal/auth` | Initiate Google Calendar OAuth |
| GET | `/api/gcal/callback` | Receive OAuth code, save token (public; constant-time state check) |
| POST | `/api/gcal/import_cards` | One-time import of GCal events as rd.json cards |
| GET | `/api/prophecies` | 6-day week data starting from `?start=YYYY-MM-DD` (defaults to logical-today): scheduled cards + unscheduled hq cards |
| PATCH | `/api/prophecies` | Bulk update `scheduled_day` and/or `order` on cards; logs `rescheduled` entries with `source=prof`. Cards unscheduled (null) drop back to `column=rd`. |
| GET | `/api/prophecies/log` | Activity log filtered by source=prof |
| POST | `/api/parse_date` | Parse natural language date → ISO via LLM |
| POST | `/api/assemble_plan` | Run the assemble_plan tool from current directives.json (legacy plan pipeline). |
| GET | `/api/debug/logs` | All activity log files (today + archived), newest first |
| GET | `/data/{filename}` | Serve file from /app/data/ (path-traversal guarded) |
| GET | `/api/mtg/log` | mtg chat history |
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
| `update_card` | Edit title/category/size/estimated_time/notes/is_reminder. Auto-recomputes size if `estimated_time` crosses a band. |
| `schedule_card` | Set or clear `scheduled_day` via `scheduler.schedule_to_day()`. Beyond 6-day window → sets `due_date` only and parks in rd; inside window → moves to hq with `scheduled_day` (overdue target clamped to today). Target = today auto-assigns `dir_start_min` via `scheduler.place_card_today()` (explicit `dir_start_min` overrides); other days clear it. |
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
  "size": "chore|task|project|titan|book",
  "due_date": "YYYY-MM-DD or YYYY-MM-DDTHH:MM",
  "estimated_time": 30,
  "notes": "...",
  "is_reminder": false,
  "recur_type": null,
  "scheduled_day": null,
  "dir_start_min": null
}
```

- `recur_type`: null | "week" | "bi-week" | "month" | "holiday" | "birthday"
- `scheduled_day`: ISO date — which day the card is planned for (Prophecies)
- `dir_start_min`: minutes from midnight — intraday slot for a card scheduled today. Set whenever a card is scheduled for today (exec chat, rd→hq promotion) via `scheduler.place_card_today()`; morning cron autostacks carryover + unpinned today cards from 10 AM via `scheduler.layout_day()`. All scheduling lives in `scheduler.py`. (No longer has a timeline UI — the `/directives` page was removed; the field still drives nudge anchoring.)
- `is_reminder`: true = calendar alert only, shown in reminders bar on kanban
- `size === 'book'`: shown in books bar on prophecies page; hidden from rd/hq columns in kanban

**Recurring card revival**: when a card with `recur_type` is archived, a clone is auto-created in `rd` with reset `scheduled_day` and `due_date` advanced via `_next_recurrence()`. The clone's `nudge` state and `dir_start_min` are stripped — each occurrence starts its own loop.

**`card["nudge"]`** (added lazily; absent on most cards): decomposition+nudge loop state — `stage` (`idle|nudging|awaiting|stalled|consequences|resolved`), `graph` (`{nodes:[{id,label,done,depth,created_at}], edges:[{from,to}]}`, edge = `from` precedes `to`), `active_node`, `redecompose_count`/`redecompose_at` (metrics), `first_nudge_at`/`next_nudge_at`/`window_deadline`/`last_nudge_at`/`last_user_reply_at` (naive-ET ISO), `awaiting_reply`, `last_nudge_text`, `consequences` (`{asked_at, answer, decision}`), `version`.

---

## Nudge loop (`nudge.py` + loop in `main.py`)

ADHD activation scaffolding: a card placed on today's timeline gets a nudge at its slot time; stalls peel a smaller next chunk; due dates are protected behind the consequences conversation.

- **Trigger**: in-process asyncio loop (`_run_nudge_loop` in `main.py`, lifespan-started, 30s tick). No cron, no rebuild — state lives on the cards in `rd.json`, so `--reload` restarts just re-arm. `POST /api/nudge/tick` = manual tick.
- **Eligibility** (`_eligible`): `decomposable()` (hq, not reminder/book — events included) AND `scheduled_day == today`. Everything with a plan scheduled today nudges. **Anchor** (`nudge_anchor`): the timeline slot (`dir_start_min`) if placed, else 10 AM (or now if past) — so today-scheduled cards without a slot still nudge without firing pre-dawn.
- **Everything in hq has a plan** (`decomposable()`): each tick, hq cards missing a graph (incl. events — they can have prep steps; excl. reminders + books) get a silent decompose (`_build_graph` — no nudge sent). Events get a plan but never a time-based nudge (`_eligible` excludes them via `is_dir_card`). The breakdown is visible/editable in the card dialog (`web/card-graph.js` SVG DAG, shown when `card.nudge.graph.nodes` non-empty; edits persist on dialog save, `active_node` recomputed client-side with the same first-open rule).
- **First nudge** = card's placement (`scheduled_day` @ `dir_start_min`). While unfired, `next_nudge_at` tracks the slot each tick.
- **Fire**: decompose on first fire (one LLM call → graph + first chunk + nudge text), else nudge text for the active node. Delivered via the monitor SSE channel + `chat.json` `role=monitor` — same pipe as encouragement comments, zero frontend.
- **Stall**: no reply within `clamp(estimate × 2.6, 45, 240)` min → peel a tinier first sub-step (no floor — "open the app" is fine), inserted as a prerequisite of the stalled node. Any exec-chat user turn counts as a reply and restarts the window.
- **Due-date protection**: `schedule_card` refuses to defer/unschedule an active-nudge card; `record_consequences` → `reschedule_after_consequences` is the only later-day path.
- **Morning (4:30)**: `morning_reconcile()` re-anchors placed-today cards to a fresh first nudge at the restacked slot and disarms others to `idle` (re-arm on their day); never leaves a past-dated `next_nudge_at`.
- **Failure backoff**: per-card 5-min in-memory retry delay on LLM errors; in-flight set prevents double fire.
- **Lateness recalibration** (`recalibration.py`): every completion (`moved→archives`) is tagged with its `category`; late ones (`completed_late`) also carry `minutes_late` + `estimated_time` (`_log_entries_for_patch` / `_minutes_late` in `main.py`). The morning pipeline folds the day's completions into a per-category EMA `factor` (`recalibrate()`), bounded [1.0, 2.0] — late tasks push it up (∝ how late), on-time pull it back toward 1.0. `nudge._factor(card)` reads it and biases `_lead()` (reserve more time), `window_for()` (wider stall window), and `active_anchor()` (nudge earlier) — so a chronically-late category starts sooner with no manual estimate change. Missing/broken store → factor 1.0 (loop never breaks). **GATED OFF** (`recalibration.ENABLED = False`) pending real data: `factor_for`/`recalibrate` no-op (factor 1.0). Telemetry (the `late`/`minutes_late` tags) keeps accruing in archived logs. Late card-action shipped 2026-06-09 (dbfe999) — flip `ENABLED` on once the archives hold a meaningful sample.

---

## Morning pipeline (`POST /api/morning`) — 4:30 AM ET

1. Read today's `activity_log.json`
2. **Retrospective** — extract durable facts only (preferences, relationships, recurring habits) from the day's activity, append to `profile.json`. Never writes time-bound, event-specific, or task-status entries.
3. **Recalibrate** — fold the day's completions into per-category lateness factors (`recalibration.recalibrate`); read before the log is archived.
4. **Purge** — remove time-specific expired notes from `profile.json`
5. **GCal import** — pull calendar events 14 days ahead as cards
6. Archive `activity_log.json` → `activity_log_MMDD.json`, reset to `[]`
7. Archive `moltbook-heartbeat.log` → `moltbook-heartbeat_MMDD.log`, reset to `""`
8. Roll past-dated `scheduled_day` on rd/hq non-event cards forward to today, then `scheduler.layout_day()` autostacks carryover + unpinned today cards from 10 AM (preserves cards already placed for today), then `nudge.morning_reconcile()` re-anchors nudge state to the fresh layout
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
