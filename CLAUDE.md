# exec-fn

ADHD scaffolding for Wai. Claude runs planning pipeline.

---

## RULES — READ FIRST

**DEPLOY = BACKGROUND AGENT. ALWAYS. NO EXCEPTIONS.**
Never run scp/ssh/docker deploy on main thread. Spawn background sub-agent.

**NEVER do `docker compose up --build` for normal deploys.** Rebuild only if `Dockerfile`, `requirements.txt`, `entrypoint.sh`, or `exec-fn.cron` changed.

**COMMIT after each discrete fix.** Don't batch. Push only after deploy succeeds and app is verified healthy.

**RUN RUFF BEFORE EVERY COMMIT.** `~/.local/bin/ruff check api/pipeline.py api/main.py` must pass clean. Fix violations before commit.

**UPDATE CLAUDE.md** when routes, pipelines, data files, schemas, or naming conventions change.

---

## Deploy (background agent procedure)

Container: `exec-fn-api-1` · Host: `root@wai-lau.net` · Repo on host: `/exec-fn`

```bash
# 0. Check if already on the server (hostname = main, pwd = /exec-fn)
#    If yes: run docker commands directly — no scp/ssh needed.
#    If no: use scp/ssh as below.

# 1. scp changed files to host (skip if already on server)
scp api/main.py api/pipeline.py root@wai-lau.net:/tmp/

# 2. docker cp into running container (skip if already on server — docker cp directly)
ssh root@wai-lau.net "docker cp /tmp/main.py exec-fn-api-1:/app/main.py && docker cp /tmp/pipeline.py exec-fn-api-1:/app/pipeline.py"

# 3. restart — or rebuild if Dockerfile/requirements.txt/entrypoint.sh/exec-fn.cron changed
ssh root@wai-lau.net "docker compose -f /exec-fn/docker-compose.yml restart api"
# rebuild: ssh root@wai-lau.net "cd /exec-fn && git pull && docker compose up -d --build"
# (if on server, omit ssh prefix and run docker compose commands directly)

# 4. check logs
ssh root@wai-lau.net "docker compose -f /exec-fn/docker-compose.yml logs --tail=20 api"

# 5. git commit + push after healthy
```

Container paths: `/app/` api, `/app/static/` web, `/app/templates/` templates, `/app/nightfall/` nightfall game (volume-mounted from `./nightfall-incident/` on host — separate repo: `wai-lau/nightfall`).

### Deploy agent prompt template

Pass change summary so agent can update context. Template:

```
Deploy <files> to production and update project context.

WHAT CHANGED:
<one paragraph summary of what was added/changed/removed>

CONTEXT UPDATE:
- Read /home/wai/src/exec-fn/CLAUDE.md and update if routes, pipelines, schemas, or conventions changed
- Read /home/wai/.claude/projects/-home-wai-src-exec-fn/memory/MEMORY.md and update relevant memory files
- Only update what actually changed — don't rewrite things that are still accurate

DEPLOY:
0. Check if already on the server: run `hostname && pwd`. If hostname=main and cwd=/exec-fn, you are on the server — skip scp/ssh and run all commands directly.
1. If NOT on server: scp <files> root@wai-lau.net:/tmp/
2. If NOT on server: ssh root@wai-lau.net "docker cp /tmp/<file> exec-fn-api-1:/app/<file> [...]"
   If ON server: docker cp <file> exec-fn-api-1:/app/<file> [...]
3. If Dockerfile, requirements.txt, entrypoint.sh, or exec-fn.cron changed:
     ON server:  docker compose up -d --build
     OFF server: ssh root@wai-lau.net "cd /exec-fn && git pull && docker compose up -d --build"
   Otherwise (normal restart):
     ON server:  docker compose -f /exec-fn/docker-compose.yml restart api
     OFF server: ssh root@wai-lau.net "docker compose -f /exec-fn/docker-compose.yml restart api"
4. Check logs: docker compose -f /exec-fn/docker-compose.yml logs --tail=20 api
5. Verify health: curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
   - 200 or 401 = healthy, continue
   - Anything else = app not running; fix and retry from step 1
6. Once healthy: git push

Report logs, health check result, and what context was updated.
```

---

## System overview

| Layer | What |
|-------|------|
| Droplet | DigitalOcean NYC1, `168.144.13.51`, `wai-lau.net` |
| nginx | Bare-metal, SSL termination, proxies → port 8080 |
| FastAPI | All routes + API endpoints (`api/main.py`) |
| Docker | Single container, same compose file local + prod |
| Cron | Inside container — fires `POST /api/morning` at 4:30 AM ET |

Models: `claude-sonnet-4-6` main reasoning · `claude-haiku-4-5-20251001` cheap checks/merges

---

## File map

```
exec-fn/
  bootstrap.sh            # one-time droplet setup — safe to re-run
  docker-compose.yml
  nightfall-incident/     # separate repo (wai-lau/nightfall), volume-mounted
  web/                    # static frontend (index.html, fonts, images)
  api/
    main.py               # FastAPI routes only — no inline HTML
    pipeline.py           # all backend logic
    entrypoint.sh         # Docker CMD: cron + uvicorn
    exec-fn.cron          # crontab baked into image
    morning_cron.sh       # cron script → POST /api/morning
    gcal_auth.py          # one-time Google Calendar OAuth
    gcal.py               # GCal helpers: fetch_calendar_events, import_gcal_cards
    helpers.py            # shared helpers: _next_recurrence(), etc.
    prophecies.py         # prophecies module: get_week_data(), bulk_update_scheduled_days(), log_prophecy_change()
    chat.py               # exec chat: system prompt (includes 7-day schedule context), tool dispatch
    chat_tools.py         # chat tool handlers incl. _tool_schedule_card()
    requirements.txt
    Dockerfile
    templates/
      exec.html           # /exec — terminal chat + carry-over panel
      plan.html           # /plan — daily plan view (legacy)
      kanban.html         # /rd — core kanban (is_reminder + recur_type fields)
      prophecies.html     # /prophecies — 7-day planning kanban
      directives.html     # /directives — today's schedule with drag/resize
    data/                 # persistent volume (./api/data → /app/data)
      plan.json           # source of truth: seek/hack/dive/omens/schedule/encouraging_message
      directives.json     # legacy alias for plan.json
      omens.json          # upcoming calendar events (title, formatted date, raw start ISO)
      context.json        # Wai's daily constraints/priorities
      rd.json             # core kanban data (cards: is_reminder, recur_type, scheduled_day, manual_pin)
      activity_log.json   # today's card activity log (cleared/archived at 4:30 AM)
      activity_log_MMDD.json  # archived daily activity logs
```

---

## Terminology

| Term | Meaning |
|------|---------|
| seek | Easy tasks, 5–15 min each |
| hack | Medium tasks, 30–60 min, has sub-steps |
| dive | One hard task, 1–2 hours, has sub-steps |
| omens | Upcoming Google Calendar events (title + formatted date) |
| core | Main kanban — all cards not in other zones (`rd.json`) |
| rd column | Upcoming ideas/backlog — card added here by default |
| hq column | Active working set — cards for the next seven days |
| archives column | Completed tasks |
| exile column | Won't-do tasks |
| plan | Full `plan.json` — seek/hack/dive/omens/schedule/encouraging_message |
| schedule | Time-block schedule in `plan.json`, generated by Sonnet |
| browser plan | The `/plan` web page showing seek/hack/dive/schedule |
| prophecies (prof) | 7-day planning view — assigns `scheduled_day` to cards |
| directives (dirs) | Today's schedule — visual timeline with drag/resize |
| scheduled_day | ISO date field on a card indicating which day it's planned for |
| manual_pin | Card field — true when user manually placed the card in Prophecies |
| recur_type | Recurrence type for a card; when archived, clone is auto-created with advanced due_date |

---

## Web app

All routes: `API_KEY` cookie auth (set via `POST /login`).

Nav: `core` · `Exec` · `prophecies` · `directives` · `媁` · `mtg` — bottom nav, all pages. No back button.

### Pages

| Route | What |
|-------|------|
| `/rd` | Core kanban from `rd.json` (core — first tab) |
| `/exec` | Terminal chat with Claude for daily planning (with carry-over panel) |
| `/prophecies` | 7-day planning kanban — assign `scheduled_day` to cards |
| `/directives` | Today's schedule — visual timeline with drag/resize, 6am–midnight |
| `/nightfall` | Standalone game, 媁 tab (unprotected route) |
| `/mtg` | MTG rules assistant |
| `/plan` | Legacy browser plan — seek/hack/dive grid + schedule (still active) |

### API endpoints

| Method | Path | What |
|--------|------|------|
| POST | `/api/morning` | Reset chat + activity_log, fetch omens (4:30 AM cron) |
| POST | `/api/assemble_plan` | Generate full plan.json via Claude (seek/hack/dive + schedule) |
| GET | `/api/plan` | Returns plan.json |
| GET | `/api/directives` | Returns plan.json (alias) |
| GET | `/api/rd/log` | Today's activity log (last 20 entries) |
| GET/POST | `/api/omens` | Get/refresh omens |
| GET | `/api/rd` | Returns rd.json |
| PATCH | `/api/rd` | Update rd.json (source query param: core/Exec/prof/dirs) |
| POST | `/api/rd/classify` | Classify card via Haiku → category + size |
| GET | `/api/context` | Returns profile.json |
| GET/POST/DELETE | `/api/chat` | Chat history |
| GET | `/api/gcal/auth` | Initiate Google Calendar OAuth (protected, redirects to Google) |
| GET | `/api/gcal/callback` | Receive OAuth code from Google, save token (public) |
| POST | `/api/gcal/import_cards` | One-time import of GCal events as rd.json cards |
| GET | `/api/prophecies` | 7-day week data: scheduled cards + unscheduled hq/rd cards |
| PATCH | `/api/prophecies` | Bulk update `scheduled_day` on cards; sets `manual_pin=true`, logs to activity_log |
| GET | `/api/prophecies/log` | Activity log filtered by source=prof |
| POST | `/api/parse_date` | Parse natural language date string via Haiku → ISO date |
| GET | `/data/{filename}` | Serve file from /app/data/ |

### Chat tools (in `/exec` terminal)

| Tool | What |
|------|------|
| `create_card` | Add card to core pool (goes to TOP of rd column) |
| `move_card` | Move card between columns: rd/hq/archives/exile |
| `update_card` | Edit card fields |
| `delete_card` | Delete card permanently |
| `schedule_card` | Set `scheduled_day` (YYYY-MM-DD) on a card, or null to unschedule |
| `refresh_omens` | Refetch Google Calendar → update omens |
| `assemble_plan` | Refresh omens, generate seek/hack/dive + schedule → write plan.json |
| `reschedule` | Regenerate schedule only (optional feedback string) |
| `update_context` | Add/remove/replace a long-term fact in profile.json |
| `create_gcal_event` | Create a Google Calendar event (title, date/time, optional duration/description) |

Chat messages: `[DD/MM HH:MM ET]` timestamp prepended. System prompt includes current date/time.

---

## plan.json schema

```json
{
  "generated_at": "...",
  "seek": ["task", "task", "task"],
  "hack": [{"title": "task", "steps": ["step 1", "step 2"]}],
  "dive": {"title": "task", "steps": ["step 1", "step 2", "step 3"]},
  "omens": [{"title": "...", "date": "..."}],
  "encouraging_message": "...",
  "schedule": [{"time": "9:00 AM", "task": "...", "type": "seek|hack|dive|break"}]
}
```

Schedule `title` field = task name only. NEVER include category prefix (SEEK/HACK/DIVE) or size tags.

---

## rd.json card schema

Cards in `rd.json` have these fields (all new fields are optional, default null/false):

```json
{
  "id": "card-<timestamp>",
  "title": "...",
  "column": "rd|hq|archives|exile",
  "category": "...",
  "size": "chore|small|medium|large",
  "due_date": "YYYY-MM-DD",
  "estimated_time": 30,
  "notes": "...",
  "is_reminder": false,
  "recur_type": null,
  "scheduled_day": null,
  "manual_pin": false
}
```

- `recur_type`: null | "week" | "bi-week" | "month" | "holiday" | "birthday"
- `scheduled_day`: ISO date "YYYY-MM-DD" — which day the card is planned for (used by /prophecies)
- `manual_pin`: true when user manually dragged the card in Prophecies view
- `is_reminder`: true = calendar alert only, no action needed

**Recurring card revival**: when a card with `recur_type` is moved to `archives`, a clone is auto-created in `rd` column with reset `scheduled_day`/`manual_pin` and `due_date` advanced via `_next_recurrence()` in `helpers.py`.

---

## Pipelines

### Morning (`POST /api/morning`) — fires 4:30 AM ET via cron

1. Clear `chat.json` (reset daily chat)
2. Archive + clear `activity_log.json` → `activity_log_MMDD.json`
3. Migrate `context.json` → `profile.json` if needed; dedupe profile notes
4. `fetch_omens()` — refresh Google Calendar events

### Assemble Plan (`POST /api/assemble_plan`)

1. Refresh omens (Google Calendar → formatted dates, no AI)
2. Build seek/hack/dive card lists from ids + remaining hq cards
3. Generate encouraging_message via Haiku (3–5 sentences, no em-dashes)
4. Generate schedule via Sonnet (:15 increments, starts at current ET time)
5. Write plan.json + directives.json (legacy alias)

---

## Cron

Config baked into image at `/etc/cron.d/exec-fn`. Env vars written to `/run/cron_env` at startup.

| Schedule | Task |
|----------|------|
| 4:30 AM ET | `morning_cron.sh` → `POST /api/morning` |

Logs: `docker compose exec api tail -f /var/log/exec-fn.log`

---

## Docker volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `./api/data` | `/app/data` | Persistent data |
| `gcal-auth` | `/root/.config/gcal` | Google Calendar token |

Local dev only (`docker-compose.override.yml`): bind mounts `./api → /app` and `./web → /app/static` for hot reload. NOT in prod.

Local dev: `docker compose up --build` → hit `localhost:8080`, login with `API_KEY` from `.env`.

---

## Google Calendar (one-time setup)

### Web flow (preferred)
1. Create GCP project, enable Calendar API, download `credentials.json` (Web app with redirect URI `https://wai-lau.net/api/gcal/callback`)
2. `docker compose cp credentials.json api:/root/.config/gcal/credentials.json`
3. Visit `https://wai-lau.net/api/gcal/auth` (must be logged in) → redirects to Google consent
4. After consent, Google redirects to `/api/gcal/callback` → token saved automatically
5. Token auto-saves to `gcal-auth` volume, auto-refreshes

### CLI flow (legacy / local dev)
1. Create GCP project, enable Calendar API, download `credentials.json` (Desktop app)
2. `docker compose cp credentials.json api:/root/.config/gcal/credentials.json`
3. SSH tunnel: `ssh -L 8765:localhost:8765 root@wai-lau.net`
4. `docker compose exec -it api python3 gcal_auth.py` → visit URL, paste code
5. Token auto-saves to `gcal-auth` volume, auto-refreshes

---

## Droplet

OS: Ubuntu 24.04 · IP: `168.144.13.51` · Domain: `wai-lau.net`

- nginx: HTTP 80 → HTTPS redirect, HTTPS 443 → localhost:8080
- Certs: `/etc/letsencrypt/live/wai-lau.net/` (auto-renews)
- SSH: password auth disabled, fail2ban active
- Services: nginx + fail2ban + docker all systemctl-enabled
- Container: `restart: unless-stopped`

Fresh setup: `bash bootstrap.sh` (installs everything, clones repo, starts container).