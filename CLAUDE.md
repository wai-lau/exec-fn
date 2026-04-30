# exec-fn

ADHD scaffolding for Wai. Claude runs planning pipeline.

---

## RULES — READ FIRST

**WE ARE ON THE SERVER.** This repo lives at `/exec-fn` on the production server (hostname: main). No SSH or scp needed.

**Template/static file changes are live on next page load** — `api/templates/` files are read from disk per request via `_tmpl()` in `main.py`. `web/` static files are served directly by FastAPI. No restart needed for either.

**Python changes need docker cp + restart:**
```bash
docker cp api/main.py exec-fn-api-1:/app/main.py
docker compose -f /exec-fn/docker-compose.yml restart api
```

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

Models: `claude-sonnet-4-6` main reasoning · `claude-haiku-4-5-20251001` cheap checks/merges

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
    hack2.png             # Hack2.png — nightfall nav icon
    wizard.png            # Wizard.png — mtg nav icon
  api/
    main.py               # FastAPI routes + _PAGE_CHROME + _NAV_CSS + nav builder; _tmpl() reads templates from disk per request
    pipeline.py           # morning pipeline: retrospective, purge stale notes, archive log
    entrypoint.sh         # Docker CMD: cron + uvicorn
    exec-fn.cron          # crontab baked into image (4:30 AM ET morning cron only)
    morning_cron.sh       # cron script → POST /api/morning
    gcal_auth.py          # one-time Google Calendar OAuth
    gcal.py               # GCal helpers: fetch_calendar_events, import_gcal_cards
    helpers.py            # shared helpers: _next_recurrence(), etc.
    prophecies.py         # prophecies module: get_week_data(), bulk_update_scheduled_days()
    chat.py               # exec chat: system prompt, tool definitions, parse_date_natural
    chat_tools.py         # chat tool handlers
    requirements.txt
    Dockerfile
    templates/            # volume-mounted → live on save
      exec.html           # /exec — terminal chat
      plan.html           # /plan — legacy daily plan view
      kanban.html         # /rd — core kanban; book cards hidden from rd/hq columns
      prophecies.html     # /prophecies — 6-day planning kanban; books bar at top
      directives.html     # /directives — today's schedule, drag/resize timeline
      debug.html          # /debug — profile.json + activity logs viewer
    data/                 # persistent volume (./api/data → /app/data)
      plan.json           # seek/hack/dive/schedule/encouraging_message
      directives.json     # legacy alias for plan.json
      rd.json             # core kanban cards
      profile.json        # Wai's long-term context notes (replaces context.json)
      activity_log.json   # today's card activity log (archived at 4:30 AM)
      activity_log_MMDD.json  # archived daily activity logs
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
| prophecies (prof) | 6-day planning view — assigns `scheduled_day` to cards |
| directives (dirs) | Today's schedule — visual timeline with drag/resize |
| scheduled_day | ISO date field on a card indicating which day it's planned for |
| manual_pin | Card field — true when user manually placed the card in Prophecies |
| recur_type | Recurrence type; when archived, clone auto-created with advanced due_date |

---

## Web app

All routes: `API_KEY` cookie auth (set via `POST /login`).

Nav: `core` · `Exec` · `prophecies` · `directives` · `debug` · `媁` · `mtg` — bottom nav, all pages.

### Pages

| Route | What |
|-------|------|
| `/rd` | Core kanban from `rd.json` |
| `/exec` | Terminal chat with Claude for daily planning |
| `/prophecies` | 6-day planning kanban — assign `scheduled_day` to cards |
| `/directives` | Today's schedule — visual timeline with drag/resize, 6am–midnight |
| `/debug` | Profile notes + activity log viewer |
| `/nightfall` | Standalone game (semi-public, guest auth) |
| `/mtg` | MTG rules assistant (semi-public, guest auth) |

### API endpoints

| Method | Path | What |
|--------|------|------|
| POST | `/api/morning` | Sonnet retrospective, purge stale notes, archive activity_log, reset chat (4:30 AM cron) |
| GET | `/api/plan` | Returns plan.json |
| GET | `/api/directives` | Returns plan.json (alias) |
| GET | `/api/rd/log` | Today's activity log (last 20 entries) |
| GET | `/api/rd` | Returns rd.json |
| PATCH | `/api/rd` | Update rd.json (source query param: core/Exec/prof/dirs) |
| POST | `/api/rd/classify` | Classify card via Haiku → category + size |
| GET | `/api/context` | Returns profile.json |
| GET/POST/DELETE | `/api/chat` | Chat history |
| GET | `/api/gcal/auth` | Initiate Google Calendar OAuth |
| GET | `/api/gcal/callback` | Receive OAuth code, save token (public) |
| POST | `/api/gcal/import_cards` | One-time import of GCal events as rd.json cards |
| GET | `/api/prophecies` | 6-day week data: scheduled cards + unscheduled hq/rd cards |
| PATCH | `/api/prophecies` | Bulk update `scheduled_day`; sets `manual_pin=true`, logs activity |
| GET | `/api/prophecies/log` | Activity log filtered by source=prof |
| POST | `/api/parse_date` | Parse natural language date → ISO via Haiku |
| GET | `/api/debug/logs` | All activity log files (today + archived), newest first |
| GET | `/data/{filename}` | Serve file from /app/data/ |

### Chat tools (in `/exec` terminal)

| Tool | What |
|------|------|
| `create_card` | Add card to rd column |
| `move_card` | Move card between columns: rd/hq/archives/exile |
| `update_card` | Edit card fields or append progress notes |
| `delete_card` | Delete card permanently |
| `schedule_card` | Set `scheduled_day` (YYYY-MM-DD) on a card, or null to unschedule |
| `reschedule` | Regenerate time-block schedule from plan.json |
| `update_context` | Add/remove/replace a long-term fact in profile.json |

---

## rd.json card schema

```json
{
  "id": "card-<timestamp>",
  "title": "...",
  "column": "rd|hq|archives|exile",
  "category": "Interfacing|Hobby|Social|Self|Book",
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
- `dir_start_min`: minutes from midnight — saved position on the directives timeline; cleared each morning
- `is_reminder`: true = calendar alert only, shown in reminders bar on kanban
- `size === 'book'`: shown in books bar on prophecies page; hidden from rd/hq columns in kanban

**Recurring card revival**: when a card with `recur_type` is archived, a clone is auto-created in `rd` with reset `scheduled_day` and `due_date` advanced via `_next_recurrence()`.

---

## Morning pipeline (`POST /api/morning`) — 4:30 AM ET

1. Read today's `activity_log.json`
2. **Sonnet retrospective** — extract durable facts only (preferences, relationships, recurring habits) from the day's activity, append to `profile.json`. Never writes time-bound, event-specific, or task-status entries.
3. **Haiku purge** — remove time-specific expired notes from `profile.json`
4. **GCal import** — pull calendar events 14 days ahead as cards
5. Archive `activity_log.json` → `activity_log_MMDD.json`, reset to `[]`
6. Clear `dir_start_min` from all cards (resets directives timeline positions)
7. Clear `chat.json`
8. Dedupe `profile.json` notes

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
