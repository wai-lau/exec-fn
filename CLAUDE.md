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
    rm.py                 # reMarkable helpers: pull_rmdocs, push_pdf, list_archive
    build_pdf.py          # plan.json → PDF plan (A5, reportlab)
    rm_to_pdf.py          # rMdoc page → PNG (Pillow)
    entrypoint.sh         # Docker CMD: cron + uvicorn
    exec-fn.cron          # crontab baked into image
    morning_cron.sh       # cron script → POST /api/morning
    gcal_auth.py          # one-time Google Calendar OAuth
    requirements.txt
    Dockerfile
    templates/
      exec.html           # /exec — terminal chat
      plan.html           # /plan — daily plan view
      kanban.html         # /rd — r&d kanban
      vault.html          # /archive — PDF archive
    data/                 # persistent volume (./api/data → /app/data)
      plan.json           # source of truth: seek/hack/dive/omens/schedule/encouraging_message
      directives.json     # legacy alias for plan.json
      omens.json          # upcoming calendar events (title, formatted date, raw start ISO)
      delta_MMDD.json     # daily merged delta (e.g. delta_0419.json)
      delta_wai_*.json    # per-doc cached delta (keyed by rmdoc stem)
      delta_wai_*.png     # marked page PNGs for vision
      context.json        # Wai's daily constraints/priorities
      rd.json             # r&d kanban data
      rd_log.json         # today's card activity log (cleared/archived at 4:30 AM)
      rd_log_MMDD.json    # archived daily card logs
      YYYYMMDD_HHMMSS.rmdoc  # pulled rMdoc (filename = rM ModifiedClient timestamp)
      WAI_*.pdf           # PDF plans
```

---

## Terminology

| Term | Meaning |
|------|---------|
| seek | Easy tasks, 5–15 min each |
| hack | Medium tasks, 30–60 min, has sub-steps |
| dive | One hard task, 1–2 hours, has sub-steps |
| omens | Upcoming Google Calendar events (title + formatted date) |
| r&d | Future projects/tasks — kanban lives in `rd.json` |
| rd column | Upcoming ideas/backlog — card added here by default |
| hq column | Active working set — should be scheduled within remaining time today |
| archives column | Completed tasks |
| exile column | Won't-do tasks |
| delta | Claude's reading of Wai's handwritten reMarkable feedback |
| plan | Full `plan.json` — seek/hack/dive/omens/schedule/encouraging_message |
| schedule | Time-block schedule in `plan.json`, generated by Haiku |
| rMdoc | Any reMarkable notebook file (`.rmdoc`) — pulled from rM, saved as timestamp filename |
| PDF plan | The generated PDF (`WAI_*.pdf`) built from `plan.json` |
| rMdoc plan | The PDF plan after upload to reMarkable (rendered on device) |
| browser plan | The `/plan` web page showing seek/hack/dive/schedule |

---

## Web app

All routes: `API_KEY` cookie auth (set via `POST /login`).

Nav: `exec` · `plan` · `看板` · `vault` — bottom nav, all pages. No back button.

`/directives` and `/omens` redirect to `/plan`.

### Pages

| Route | What |
|-------|------|
| `/exec` | Terminal chat with Claude for daily planning |
| `/plan` | Browser plan — seek/hack/dive grid + schedule + omens + delta + encouragement |
| `/rd` | R&D kanban from `rd.json` |
| `/archive` | Timestamped WAI PDFs, newest first |
| `/nightfall` | Standalone game (unprotected route) |

### API endpoints

| Method | Path | What |
|--------|------|------|
| POST | `/api/morning` | Reset chat + rd_log, pull rMdoc, analyze delta, generate briefing, push PDF plan |
| POST | `/api/pull` | Pull latest rMdoc from reMarkable |
| POST | `/api/push` | Build PDF plan from plan.json + upload to rM |
| POST | `/api/assemble_plan` | Generate full plan.json via Claude |
| POST | `/api/build_pdf` | Build timestamped PDF plan from plan.json |
| POST | `/api/reschedule` | Regenerate schedule only |
| GET | `/api/plan` | Returns plan.json |
| GET | `/api/directives` | Returns plan.json (alias) |
| GET | `/api/archive` | List *.rmdoc + delta PNGs, newest-first |
| GET | `/api/rd/log` | Today's r&d card activity log (last 20 entries) |
| GET | `/api/archive/{filename}/page/{page_num}` | Render PDF page as PNG |
| GET/POST | `/api/omens` | Get/refresh omens |
| GET/POST | `/api/delta` | Get today's delta / run delta analysis |
| GET | `/api/rd` | Returns rd.json |
| POST | `/api/rd/classify` | Classify R&D items via Claude |
| GET | `/api/context` | Returns context.json |
| GET/POST/DELETE | `/api/chat` | Chat history |
| GET | `/api/gcal/auth` | Initiate Google Calendar OAuth (protected, redirects to Google) |
| GET | `/api/gcal/callback` | Receive OAuth code from Google, save token (public) |
| POST | `/api/parse_date` | Parse natural language date string via Haiku → ISO date |
| GET | `/data/{filename}` | Serve file from /app/data/ |

### Chat tools (in `/exec` terminal)

| Tool | What |
|------|------|
| `create_card` | Add card to r&d pool (goes to TOP of rd column) |
| `move_card` | Move card between columns: rd/hq/archives/exile |
| `update_card` | Edit card fields |
| `delete_card` | Delete card permanently |
| `refresh_omens` | Refetch Google Calendar → update omens |
| `assemble_plan` | Generate seek/hack/dive + schedule → write plan.json |
| `reschedule` | Regenerate schedule only (optional feedback string) |
| `build_pdf` | Build PDF plan from current plan.json |
| `finalize_and_push` | Categorize cards → push PDF plan to rM as rMdoc plan |
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

## Pipelines

### Morning (`POST /api/morning`) — fires 4:30 AM ET via cron

1. Clear `chat.json` (reset daily chat)
2. Clear `rd_log.json` (reset daily activity log)
3. `pull_rmdocs()` + `analyze_delta()` + `fetch_omens()` + `update_rd_from_delta()`
4. `generate_morning_recap()` — Sonnet briefing → `morning.json`
5. `push_pdf()` — build PDF plan + upload to rM

### Delta (`POST /api/delta`)

Day window: most recent 4:30 AM ET → now (current time at run time).
All datetime logic: `zoneinfo.ZoneInfo("America/New_York")`. Filenames use UTC timestamps.

1. `pull_rmdocs()` — pull latest WAI rMdoc from rM (skip if local `YYYYMMDD_HHMMSS.rmdoc` already exists for that ModifiedClient)
2. Collect all WAI rMdocs in day window
3. Per file: `_analyze_wai_doc()` — check for marks via Haiku first; if marks found, full Sonnet vision → save PNG
4. Merge day deltas via Haiku, write `delta_MMDD.json`
5. `_load_all_recent_deltas()` — used by GET /api/delta and assemble_plan

### Assemble Plan (`POST /api/assemble_plan`)

1. Refresh omens (Google Calendar → formatted dates, no AI)
2. Pull + analyze latest WAI rmdoc
3. Move completed cards to archives based on delta
4. Load yesterday + today delta
5. Generate encouraging_message via Haiku (3–5 sentences, no em-dashes)
6. Generate schedule via Haiku (:15 increments, starts at current ET time)
7. Write plan.json + directives.json (legacy)

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
| `rmapi-auth` | `/root/.config/rmapi` | rmapi auth token |
| `gcal-auth` | `/root/.config/gcal` | Google Calendar token |

Local dev only (`docker-compose.override.yml`): bind mounts `./api → /app` and `./web → /app/static` for hot reload. NOT in prod.

Local dev: `docker compose up --build` → hit `localhost:8080`, login with `API_KEY` from `.env`.

---

## reMarkable

### Rules
- Use **ddvk/rmapi v0.0.32** only. `juruen/rmapi` is dead.
- Don't upload while notebook open on device (no locking — last write wins).
- **DO NOT write text via rmscene** — produces truncated text, wrong styles. Use PDF instead.

### rmapi commands

```bash
rmapi ls /EXEC                       # list files
rmapi get /EXEC/<name>               # download
rmapi put --force -f /EXEC <file>    # upload/replace inside EXEC folder
rmapi stat /EXEC/<name>              # get metadata (ModifiedClient timestamp)
```

All files in `/EXEC` folder. `RM_FOLDER = "/EXEC"` in pipeline.py.

### .rmdoc format

ZIP containing: `{uid}.content`, `{uid}.metadata`, `{uid}/{page_id}.rm`
`.rm` = reMarkable v6 binary, parsed/written with rmscene.
`write_blocks(file_obj, blocks)` — file arg comes FIRST.

### rmscene imports

```python
from rmscene.scene_items import ParagraphStyle, Text  # use this
# NOT from rmscene.text — that's a newer higher-level API, don't use for block writing
```

Key block types:
- `RootTextBlock` — typed text. `.value.items` (CrdtSequence), `.pos_x`, `.pos_y`, `.width`
- `SceneLineItemBlock` — handwritten strokes. `.item.value.points` → list of `(x, y)`
- `TreeNodeBlock` — layer definitions. `.group.label.value` = layer name ("Ink", "AI", "Wai")

rmscene note: "Some data has not been read" = PathItemBlock not supported — safe to ignore.
Firmware patch: already applied in Dockerfile (removes `assert block_id == CrdtId(0,0)` crash).

### Coordinate system

- Page: 1404 × 1872 px
- Stroke x=0: LEFT edge in most notebooks, PAGE CENTER in EXEC template. Check min x to determine.
- `RootTextBlock pos_x`: offset from page center. `pos_x=-468, width=936` = full width.
- Stroke y: relative to text block's `pos_y` in typed notebooks.

### PDF on reMarkable

reMarkable renders PDF fit-to-height (height = 1872px, centered horizontally).
A5 PDF (419.53 × 595.28 pt): scale = 3.145, rendered width = 1319px, margins = 42px each side.

Build PDF: `build_pdf.build(out_path)` → A5 via reportlab, renders schedule as `H:MM  task` rows.

### Rendering rMdoc → PNG

`rm_to_pdf.rasterize(path, page_index)` → PNG bytes (Pillow, half-res 702×936 for Claude vision).
Center-origin strokes (min x < -10): `x_offset = 702`. Left-origin: `x_offset = 0`.

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