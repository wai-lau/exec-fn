# exec-fn — Architecture (UML, Mermaid)

Generated from source (`api/*.py`, `docker-compose.yml`, `Dockerfile`,
cron). Three views:

1. [Deployment](#1-deployment) — how a request reaches code
2. [Module graph](#2-module-graph) — what imports what
3. [Morning pipeline + scheduling](#3-morning-pipeline--scheduling) — how
   cards move through time

---

## 1. Deployment

nginx (bare metal) terminates SSL, proxies to a single Docker container
running cron + uvicorn. Persistent state is JSON files on a bind-mounted
volume.

```mermaid
flowchart TB
  browser["Browser<br/>wai-lau.net"]

  subgraph droplet["DigitalOcean droplet (Ubuntu 24.04, 168.144.13.51)"]
    nginx["nginx (bare metal)<br/>:443 SSL term<br/>:80 to 443 redirect"]

    subgraph container["Docker: exec-fn-api-1 (TZ=America/New_York)"]
      direction TB
      entry["entrypoint.sh"]
      cron["cron daemon<br/>4:30 AM to morning_cron.sh"]
      uvicorn["uvicorn main:app<br/>0.0.0.0:8080 --reload"]
      entry --> cron
      entry --> uvicorn
      cron -->|"POST /api/morning<br/>localhost:8080"| uvicorn
    end

    subgraph vols["Volumes"]
      data["./api/data to /app/data<br/>rd.json profile.json chat.json<br/>activity logs, tarot_readings"]
      tmpl["./api/templates to /app/templates<br/>(hot-reload)"]
      web["./web to /app/static<br/>(hot-reload)"]
      mtgd["./mtg/data to /app/mtg/data"]
      night["./nightfall-incident to /app/nightfall"]
      gcal["gcal-auth to /root/.config/gcal"]
      rmapi["rmapi-auth to /root/.config/rmapi"]
    end

    uvicorn --- data
    uvicorn --- tmpl
    uvicorn --- web
    uvicorn --- mtgd
    uvicorn --- night
    uvicorn --- gcal
    uvicorn --- rmapi
  end

  browser -->|HTTPS 443| nginx
  nginx -->|"proxy to localhost:8080"| uvicorn
```

**Port chain:** `nginx :443 (SSL) -> localhost:8080 -> container:8080 (uvicorn)`

**Image:** `python:3.12-slim`; rmapi Go binary pre-built from
`golang:1.24-alpine`. No `EXPOSE`; port bound at compose level only.

**Secrets** (`.env`): `API_KEY`, `ANTHROPIC_API_KEY`, `GUEST_KEY`.
cron reads them via `/run/cron_env`.

---

## 2. Module graph

Intra-project imports only (stdlib / fastapi / anthropic omitted).
`main.py` is the composition root; `helpers.py` is the shared base
(10 inbound edges). Two self-contained subsystems: `tarot/*` and `mtg/*`.

```mermaid
flowchart LR
  main["main.py<br/>(routes + page composer)"]
  auth["auth.py"]
  helpers["helpers.py<br/>(shared base)"]
  pipeline["pipeline.py"]
  scheduler["scheduler.py"]
  monitor["monitor.py"]
  prophecies["prophecies.py"]
  chat["chat.py"]
  chat_tools["chat_tools.py"]
  routes_chat["routes_chat.py"]
  routes_night["routes_nightfall.py"]
  gcal["gcal.py"]

  main --> pipeline
  main --> gcal
  main --> chat
  main --> chat_tools
  main --> helpers
  main --> routes_night
  main --> routes_chat
  main --> monitor
  main --> auth
  main --> mtgr["mtg.routes"]
  main --> tarr["tarot.routes"]

  routes_chat --> auth
  routes_chat --> chat
  routes_chat --> chat_tools
  routes_chat --> helpers

  pipeline --> helpers
  pipeline --> chat
  chat --> helpers
  chat_tools --> helpers
  monitor --> helpers
  scheduler --> helpers
  prophecies --> helpers
  prophecies --> scheduler
  routes_night --> helpers

  subgraph tarot["tarot/"]
    tarr --> tauth["(auth)"]
    tarr --> tag["agent"]
    tarr --> tcards["cards"]
    tarr --> tprompt["prompt"]
    tarr --> tspreads["spreads"]
    tag --> ttools["tools"]
    ttools --> tcards
    ttools --> tlookup["lookup"]
    tprompt --> tlookup
    tlookup --> tcards
  end

  subgraph mtg["mtg/"]
    mtgr --> mag["agent"]
    mag --> mprompt["prompt"]
    mag --> mtools["tools"]
    mtools --> mlookup["lookup"]
  end
```

Note: `scheduler.py` is reached at runtime from `chat_tools` and
`pipeline` via `__import__`/late import, so it has no static import edge
from them — the runtime call path is shown in view 3.

---

## 3. Morning pipeline + scheduling

### 3a. Morning cron sequence

`POST /api/morning` (4:30 AM ET) runs `build_morning()` in `pipeline.py`.

```mermaid
sequenceDiagram
  participant cron
  participant API as main.POST /api/morning
  participant P as pipeline.build_morning
  participant LLM as Claude (opus-4-8)
  participant GC as gcal.import_gcal_cards
  participant S as scheduler
  participant FS as data/*.json

  cron->>API: POST /api/morning (Bearer API_KEY)
  API->>P: build_morning()
  P->>FS: read activity_log.json
  P->>LLM: _morning_retrospective (extract durable facts)
  LLM-->>P: facts
  P->>FS: append to profile.json
  P->>LLM: _purge_stale_notes
  P->>FS: rewrite profile.json
  P->>GC: import_gcal_cards(days_ahead=14)
  GC->>FS: add events to rd.json
  P->>FS: archive activity_log to _MMDD, reset to []
  P->>FS: archive moltbook-heartbeat to _MMDD, reset to ""
  P->>FS: read rd.json
  P->>S: _roll_and_schedule (roll past scheduled_day, rd->hq in window)
  P->>S: layout_day(anchor=10AM, only_ids=restack)
  S-->>P: cards mutated (dir_start_min assigned)
  P->>FS: write rd.json
  P->>FS: delete chat.json
  P->>LLM: _dedupe_context
  P->>FS: rewrite profile.json
  P-->>API: summary
```

### 3b. scheduler.py — the time model

All `dir_start_min` / `scheduled_day` logic lives here. Window =
`SCHED_WINDOW_DAYS=5` (today + 5 = 6-day span).

```mermaid
flowchart TB
  subgraph entry["Callers"]
    morning["morning cron<br/>(_roll_and_schedule)"]
    execchat["exec chat tools<br/>create_card / schedule_card"]
    prof["prophecies drag"]
  end

  subgraph sched["scheduler.py"]
    s2d["schedule_to_day(card, ...)<br/>canonical rd to hq promoter"]
    place["place_card_today()<br/>next free slot >= now"]
    layout["layout_day(anchor, only_ids)<br/>autostack from anchor"]
  end

  morning --> s2d
  morning --> layout
  execchat -->|"_apply_schedule()"| s2d
  prof --> s2d

  s2d --> decide{"target in<br/>6-day window?"}
  decide -->|"no"| outwin["stay in rd<br/>set due_date only<br/>(clamp_to_window: clamp to edge)"]
  decide -->|"yes"| inwin["column = hq<br/>scheduled_day = target<br/>(overdue: clamp to today)"]
  inwin --> istoday{"target ==<br/>today?"}
  istoday -->|"yes"| setmin["dir_start_min =<br/>param or place_card_today()"]
  istoday -->|"no"| clearmin["dir_start_min = null"]
```

**rd to hq promotion** (`schedule_to_day`): a card moves out of the `rd`
column into `hq` only when its target day falls inside the 6-day window.
`dir_start_min` (timeline position) is set only when the target is today —
either an explicit value or the next free slot from `place_card_today()`.
Outside the window the card stays in `rd` with just a `due_date`.

**Exec chat call chain:**
`POST /api/chat -> routes_chat._handle_tool -> chat_tools._TOOL_HANDLERS[name]`
`-> _apply_schedule -> scheduler.schedule_to_day`.
