# exec-fn — Architecture (UML, Mermaid)

Generated from source (`api/*.py`, `docker-compose.yml`, `Dockerfile`,
cron). Five views:

1. [Deployment](#1-deployment) — how a request reaches code
2. [Module graph](#2-module-graph) — what imports what
3. [Morning pipeline + scheduling](#3-morning-pipeline--scheduling) — how
   cards move through time
4. [TTS subsystem](#4-tts-text-to-speech) — how every voice reaches the
   browser
5. [LLM call sites + prompt caching](#5-llm-call-sites--prompt-caching) —
   every Claude request and which prefixes are cached

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

**Secrets** (`.env`): `API_KEY`, `ANTHROPIC_API_KEY`, `TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET` (the guest gate is a Cloudflare Turnstile challenge, not a
shared key — `GUEST_KEY` retired).
cron reads them via `/run/cron_env`.

---

### 1d. nginx — the `--reload` 502, and the body-size 413

nginx does HTTP 80 → HTTPS redirect and HTTPS 443 → the `execfn_app` upstream (`127.0.0.1:8080`). The live config is `/etc/nginx/sites-enabled/default`; **backups live in `/etc/nginx/backups/`, NOT in `sites-enabled/`**, whose include is an unfiltered `*` that would load a `.bak` as a duplicate server block. `bootstrap.sh` carries the same block for a fresh box. The `/ws/` location is untouched.

**A `--reload` worker swap used to surface as a 502.** The reloader holds the listen socket in the parent and swaps the worker underneath, so a new connection is never refused — but a request landing on the OLD worker while it drains gets its connection closed with no response, which nginx reports as 502.

Measured live: **20 of 220 requests to `/` across two reloads came back 502**, while the same probe straight at `127.0.0.1:8080` saw none. That is what pinned it on the proxy rather than the app.

The fix is an explicit `upstream` block listing the server **TWICE** — nginx allows one try per peer, so a single-server upstream can never retry — with `max_fails=0`, plus `proxy_next_upstream error timeout http_502` / `_tries 3` / `_timeout 20s` / `proxy_connect_timeout 3s` on `location /`. Same probe after: **220/220 200s**, worst request ~7s (the swap is slow, not broken).

**Two deliberate omissions:**
- **`non_idempotent` is NOT set** — a retried POST/PATCH would apply a mutation twice — so retries cover the GETs that serve pages and assets.
- **`http_503` is NOT retried** — this app returns a real 503 when the home box or the printer is unreachable, and retrying would only delay an honest answer.

**`client_max_body_size 25m`** is set on the 443 server block (2026-09-13). nginx's default is **1m**, and a screenshot pasted into `/cc` arrives as base64 in a JSON body, so a normal phone screenshot was rejected with nginx's own HTML 413 before the app ever saw it — reported as `[ request failed (413) ] when uploading image`.

**The app's caps are meant to be the real ones** (4 images, 5MB base64 each, 24MB body) because they answer in JSON the page can render; nginx only has to be wide enough to let them do the refusing. Verified live: a 2MB body now reaches the app (401 unauthenticated, not 413), and an over-cap 7MB image returns the app's `{"error":"image too large"}` 413. Printer firmware/model uploads pass through the same limit.

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
  hq["hq.py"]
  chat["chat.py"]
  chat_tools["chat_tools.py"]
  chat_actions["chat_actions.py<br/>(follow-up action diff)"]
  routes_chat["routes_chat.py"]
  routes_night["routes_nightfall.py"]
  gamesave["gamesave_store.py<br/>(per-caller save slots)"]
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

  routes_night --> gamesave
  routes_chat --> auth
  routes_chat --> chat
  routes_chat --> chat_tools
  routes_chat --> helpers

  pipeline --> helpers
  pipeline --> chat
  chat --> helpers
  chat --> chat_actions
  chat_tools --> helpers
  monitor --> helpers
  scheduler --> helpers
  hq --> helpers
  hq --> scheduler
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

### rd.json concurrency — `helpers._RD_LOCK`

rd.json writers run on genuinely parallel OS threads: the nudge loop's scans
(`asyncio.to_thread`), chat-tool dispatch (`routes_chat` → `to_thread`),
sync-`def` routes on Starlette's thread pool (gcal import), and the event loop
itself (`PATCH /api/rd`). Three guards in `helpers.py` make that safe:

- **`_RD_LOCK`** (`threading.RLock`) — every read-modify-write cycle holds it
  around the WHOLE load→mutate→save sequence (`with _RD_LOCK:`), so one
  thread's save can never silently drop another's changes. LLM/network calls
  are NEVER made under the lock — callers release, call the model, then
  re-lock + reload + apply (`_fire_nudge`, `_build_graph`, `_run_triage`,
  `api_rd_recalc`, `_tool_decompose_task`, `import_gcal_cards`).
- **`_load_rd()` returns a private deep copy** — the `_load_json` mtime cache
  holds one shared object; handing it out mutable would leak one thread's
  in-progress edits into another's snapshot.
- **`_save_rd()` is an atomic replace** (tmp + rename), so a concurrent
  reader never sees a truncated file.

Single-process invariant: uvicorn runs ONE worker (`--reload`), so a
process-wide lock is sufficient; nothing outside the container writes rd.json.
Read-only loads (`monitor`, `get_week_data`, scans) don't take the lock — the
deep copy + atomic replace make unlocked reads safe.

### 3b. scheduler.py — the time model

All `dir_start_min` / `scheduled_day` logic lives here. Window =
`SCHED_WINDOW_DAYS=6` (today + 6 = 7-day span).

```mermaid
flowchart TB
  subgraph entry["Callers"]
    morning["morning cron<br/>(_roll_and_schedule)"]
    execchat["exec chat tools<br/>create_card / schedule_card"]
    hq["HQ drag"]
  end

  subgraph sched["scheduler.py"]
    s2d["schedule_to_day(card, ...)<br/>canonical rd to hq promoter"]
    place["place_card_today()<br/>next free slot >= now"]
    layout["layout_day(anchor, only_ids)<br/>autostack from anchor"]
  end

  morning --> s2d
  morning --> layout
  execchat -->|"_apply_schedule()"| s2d
  hq --> s2d

  s2d --> decide{"target in<br/>7-day window?"}
  decide -->|"no"| outwin["stay in rd<br/>set due_date only<br/>(clamp_to_window: clamp to edge)"]
  decide -->|"yes"| inwin["column = hq<br/>scheduled_day = target<br/>(overdue: clamp to today)"]
  inwin --> istoday{"target ==<br/>today?"}
  istoday -->|"yes"| setmin["dir_start_min =<br/>param or place_card_today()"]
  istoday -->|"no"| clearmin["dir_start_min = null"]
```

**rd to hq promotion** (`schedule_to_day`): a card moves out of the `rd`
column into `hq` only when its target day falls inside the 7-day window.
`dir_start_min` (timeline position) is set only when the target is today —
either an explicit value or the next free slot from `place_card_today()`.
Outside the window the card stays in `rd` with just a `due_date`.

**Exec chat call chain:**
`POST /api/chat -> routes_chat._handle_tool -> chat_tools._TOOL_HANDLERS[name]`
`-> _apply_schedule -> scheduler.schedule_to_day`.

---

## 4. TTS (text-to-speech)

Every voice in the app — the `/hosaka` SPEAK page, the `/tarot` reader
narration, and the Exec bubble — streams from a **single home GPU box**
through a **same-origin reverse proxy**. No TTS models run on the droplet;
the container only proxies. The browser always talks same-origin, so the
session/guest cookie carries auth on the WebSocket handshake (HTTP basic
auth does not ride a WS upgrade reliably on mobile).

### 4a. Topology

The model server (Kokoro / Chatterbox / Piper) runs on Wai's home box and
is reached only over an SSH reverse tunnel bound to the Docker bridge
gateway (`TTS_UPSTREAM`, default `172.17.0.1:8123`). `tts-box/` (systemd
user service + port watchdog, installed on the home box) keeps that
upstream alive.

```mermaid
flowchart LR
  browser["Browser<br/>(/hosaka · /tarot · Exec bubble)"]

  subgraph droplet["droplet container — routes_tts.py"]
    page["GET /hosaka<br/>(guest_protected)"]
    voices["GET /api/hosaka/voices<br/>GET /api/hosaka/health<br/>(guest_protected)"]
    ws["WS /ws/hosaka<br/>(public route, cookie-gated)"]
  end

  tunnel(["SSH reverse tunnel<br/>172.17.0.1:8123"])

  subgraph home["home GPU box (RTX) — tts-box keepalive"]
    upstream["TTS upstream<br/>WS /v1/audio/stream<br/>GET /v1/voices<br/>Kokoro · Chatterbox · Piper"]
  end

  browser -->|HTTPS page load| page
  browser -->|"GET (httpx proxy)"| voices
  browser <-->|"WS audio (bidi pump)"| ws
  voices -->|http| tunnel
  ws -->|"websockets.connect"| tunnel
  tunnel --- upstream
```

`_pump_to_upstream` / `_pump_to_client` shuttle text + binary frames both
directions; `/api/hosaka/health` probes the upstream for a *real* response
(the reverse-tunnel listener stays bound on the droplet even when the model
server is down — a bound port is **not** liveness), letting `/hosaka` show
"TTS server offline" before SPEAK.

**Every utterance ends in a terminal frame** — the proxy guarantees it even
when the backend doesn't. An utterance normally ends with the upstream's own
`{"type":"end"}` / `{"type":"error"}`, which clears `busy[url]`; if the
upstream stream instead just *ends* (home box crashed, tunnel dropped, GPU
server restarted mid-sentence) `_pump_to_client`'s `finally` synthesizes
`{"type":"error","detail":"tts upstream closed mid-utterance"}` and evicts the
dead connection so the next utterance reconnects. This is load-bearing for
`/tarot`: the reader's typewriter paces off the audio clock and waits on a
terminal frame, so a silently-dead upstream left the reveal spinning forever
with the text stuck part-revealed. The guard is the pure predicate
`tts_routing.died_mid_utterance` (unit-tested — `routes_tts` can't be imported
by the dev venv), which fires **only** for the live connection on that `url`:
a stale socket `_ws_dispatch` deliberately cut to start a new utterance is
superseded, and its error would abort the utterance that replaced it.

Client-side belts for the same failure, since a frame can also be lost between
browser and droplet: `hosaka-audio.js`'s `ws.onclose` delivers a synthetic
`{type:"error"}` to the in-flight utterance (guarded on the socket still being
the live one), and `tarot-stream.js`'s stall watchdog caps `elapsed()` at the
buffered duration in its progress signal — the raw `el + dur` never stopped
rising (the ctx clock keeps running after the buffer drains), so the watchdog
could never fire on a dead stream.

### 4b. Auth — now guest-or-full

`/hosaka` and `/api/hosaka/*` moved from the full-auth `protected` router to
**`guest_protected`** — a guest session now reaches the SPEAK page. The WS
`/ws/hosaka` is declared on the `public` router but rejects (close `1008`)
unless a `session` **or** `guest_session` cookie matches before `accept()`.
The guest tier is what lets the `/tarot` reader voice work for guests.

| Endpoint | Router | Reachable by |
|----------|--------|--------------|
| `GET /hosaka` | `guest_protected` | full + guest (nav renders guest-tier for non-admins) |
| `GET /api/hosaka/voices`, `/health` | `guest_protected` | full + guest |
| `WS /ws/hosaka` | `public` + cookie check | full + guest (else `1008`) |

### 4b-ii. GPU-mode owner control

`GET /api/hosaka/mode` and `POST /api/hosaka/mode` sit on the **`protected`**
router (owner-only -- guests must never flip the GPU). They proxy the home-box
`gpu-mode` service over the SSH tunnel at `172.17.0.1:8124` (env:
`GPU_MODE_UPSTREAM`, default `172.17.0.1:8124`) using `Authorization: Bearer
$GPU_MODE_TOKEN` (the token must match the value on the home box;
provisioned in the droplet `.env` -- operator step). The GET returns the
current mode; the POST body `{"action": "homo"|"emo"|"idle", "force"?: bool}`
transitions it.
`emo` and `idle` stop hosaka-server and therefore disconnect active remote
users; the route confirms against `_audio_conns` (the live `/ws/hosaka` audio
socket set in `routes_tts.py` — the real listeners, incl. /tarot narration and
Exec voice, not just `/hosaka`-page `_presence`) and returns `409` if any users
are connected and the caller has not sent `{"force": true}`. `homo` never needs
confirmation.

**The reported mode is corrected against reality.** `/mode` reports the box's
*intent*, and that outlives the truth: when hosaka-server dies or wedges the
box goes on answering `homo` while nothing synthesizes, and the strip lights
the homo segment over a dead backend. `_current_mode()` probes `/mode` and TTS
liveness concurrently and passes both to the pure
`gpu_mode_client.effective_mode`, which reports `idle` for a claimed `homo`
whose TTS is not answering. Only `homo` is second-guessed — under `emo`/`idle`
a failing probe is the *expected* state, not a contradiction, and `gone` (box
unreachable) already says everything. Liveness is the same `_live()` rule the
health route uses: only a real `/v1/voices` response, never a bound tunnel
port. A `homo` switch sets a 90s grace (`_HOMO_GRACE_S`) during which liveness
is assumed, because the box has to load models before `/v1/voices` answers and
the next poll would otherwise read "homo but no TTS" and flip the strip to
idle and back.

**Mode changes reach open pages two ways.** A POST here pushes instantly to
`_mode_subscribers`. Everything else — a switch made at the home box, a
watchdog restart, hosaka-server dying under a mode still claiming homo — never
touches that queue, so `/api/hosaka/mode/stream`'s keepalive tick doubles as a
poll of the real mode (`_MODE_POLL_S`, 15s) and emits on change. This is what
fixes drift for pages that are already open; `gpu-mode.js`'s recheck-on-load
and refresh-on-refocus only ever covered pages that got touched, and its own
comment said so ("No interval -- a long-open foreground tab drifts until
touched"). An unchanged poll falls through to a `: keepalive` comment, so an
idle stream still costs one line per tick.

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

| Endpoint | Router | Reachable by |
|----------|--------|--------------|
| `GET /api/hosaka/mode` | `protected` | owner only |
| `POST /api/hosaka/mode` | `protected` | owner only |
| `GET /api/hosaka/mode/stream` | `protected` | owner only |

### 4c. Three consumers of one audio core

All three share `web/hosaka-audio.js` (`HosakaAudio.createPlayer()`) — it
owns the `AudioContext`, the iOS unlock dance, the `/ws/hosaka` socket, and
playback of streamed **24 kHz float32 PCM** via scheduled
`AudioBufferSourceNode`s. The upstream emits only `{start}` / coarse PCM
blobs / `{end}` (no per-word timestamps), so any visual syncs to the
*measured* audio duration.

| Surface | Script | Voice | Backend |
|---------|--------|-------|---------|
| `/hosaka` SPEAK UI | `tts.js` | `charlie` (default) + full voice list | chatterbox + RVC |
| `/tarot` reader | `tarot-voice.js` | `af_nicole` | kokoro |
| Exec bubble | `exec-voice.js` / `exec-voice-listener.js` | `glados` | piper |

The `/tarot` reader paces its typewriter to the audio clock (holds text
until audio starts, then reveals on a `charWeight` schedule normalized to
the measured duration); on any audio failure it bails to a guessed-pace
typewriter and logs a sys note. Exec is fire-and-forget (no typewriter).

### 4d. One utterance

```mermaid
sequenceDiagram
  participant B as Browser (HosakaAudio)
  participant WS as /ws/hosaka (proxy)
  participant U as home upstream

  B->>WS: WS upgrade (cookie)
  WS->>WS: session|guest_session? else close 1008
  WS->>U: websockets.connect /v1/audio/stream
  B->>WS: speak(text)
  WS->>U: text frame
  U-->>WS: {start}
  WS-->>B: {start} (onStatus)
  loop PCM blobs
    U-->>WS: 24kHz float32 PCM
    WS-->>B: bytes -> schedule AudioBufferSourceNode
  end
  U-->>WS: {end}
  WS-->>B: {end} (playback drains to completion)
```

---

## 5. LLM call sites + prompt caching

Every Claude call goes through the `anthropic` SDK with a pay-per-token
`ANTHROPIC_API_KEY` (no subscription). Where a large, byte-stable system
prefix is **reused across turns**, a `cache_control: {type: ephemeral}`
marker (5-min TTL) lets repeat requests read that prefix at ~0.1x instead
of full price.

### The one invariant

Render order is `tools -> system -> messages`. A marker on the **last
system block** caches `tools + system` together as the prefix. Caching is
a pure prefix match: any byte that changes inside the cached span (a
timestamp, per-request card data) invalidates everything after it. So the
static text must physically precede the volatile text, and the marker sits
at the end of the static part. **Opus min cacheable prefix = 4096 tokens**
— a shorter prefix silently caches nothing (`cache_creation_input_tokens`
stays 0), so anything under that is left uncached.

### Cached sites

```mermaid
flowchart LR
  subgraph tarot["tarot/agent.py — stream_chat"]
    tsys["system = [build_system(spread_type)]<br/>+ cache_control"]
    ttools["tools = TOOLS"]
    tmsg["messages<br/>(spread context lives HERE)"]
    ttools --> tsys --> tmsg
  end

  subgraph mtg["mtg/agent.py — _SYSTEM_CACHED"]
    msys["system = [SYSTEM] + cache_control"]
    p1["pass 1: + TOOLS<br/>(research loop)"]
    p2["pass 2: no tools<br/>(summarize)"]
    msys --> p1
    msys --> p2
  end

  subgraph exec["chat._build_chat_system_prompt"]
    estatic["block 1: _CHAT_STATIC_PREFIX<br/>(identity + EXEC_VOICE + rules)<br/>+ cache_control"]
    evol["block 2: volatile tail<br/>(TODAY, log, cards, schedule,<br/>context, nudge) — NO marker"]
    etools["tools = _chat_tools()"]
    etools --> estatic --> evol
  end
```

| Call site | Model | Cached prefix | Tokens | Reuse pattern |
|-----------|-------|---------------|-------:|---------------|
| `tarot/agent.py` `stream_chat` | opus-4-8 | `build_system(spread_type)` + `TOOLS` | ~8.7K / ~13.4K | every turn of a reading |
| `mtg/agent.py` pass 1 | opus-4-8 | `SYSTEM` + `TOOLS` | ~6.6K | across research tool-loop iterations + cross-question |
| `mtg/agent.py` pass 2 | opus-4-8 | `SYSTEM` (no tools) | ~5.9K | cross-question only (separate prefix from pass 1) |
| `routes_chat` `/api/chat` + `_stream_tool_followup` | opus-4-8 | `_CHAT_STATIC_PREFIX` + `_chat_tools()` | ~5.2K | every exec turn; follow-up reads what the main turn wrote |

**Exec restructure:** the tools alone (~3.5K) are under 4096, so the static
text is what lifts the prefix over the floor. `_build_chat_system_prompt`
returns a **two-block** system list — a marked static block (identity +
`EXEC_VOICE` + global rules) and an unmarked volatile tail. `TODAY` was at
the top of the old single-string prompt and silently invalidated the cache
every request; it now lives in the volatile tail. Both `routes_chat` call
sites build the identical static block.

**Follow-up action diff:** after a tool round, the follow-up turn rebuilds the
system prompt — so its board lists now include any card the turn just created.
`_build_chat_system_prompt(stage, actions=…)` appends an **ACTIONS YOU JUST
TOOK** block (rendered by `chat_actions._actions_taken_block` from the dispatched
`{name, input, result}` list) to the **volatile tail**, so the model reads the
refreshed board as the result of its own action rather than reporting a phantom
duplicate. Marked only in the volatile tail → the cached static prefix stays
byte-stable. Threaded through both follow-up paths (`routes_chat._dispatch_tools`
collects the actions; `discord_bot.exec_reply` rebuilds `system2` with them).

**Tool rounds are a bounded LOOP, not one shot** (`_MAX_TOOL_ROUNDS` = 3, in both
`routes_chat` and `discord_bot`). The follow-up turn is handed the tools, so it
can answer a tool result by calling another tool — an exile right after a create.
Both paths used to keep only the follow-up's TEXT: any `tool_use` it emitted was
dropped on the floor, never dispatched and never stored, so Exec could announce
an action ("I'll exile the duplicate") that provably never happened — observed
2026-09-02, with `rd.json` holding one card and the activity log holding no
exile. `chat_store.assistant_content_blocks` is the shared helper that preserves
text + `tool_use` from an API message; each round dispatches the pending turn's
tool_use blocks, appends the results, and streams the next turn with a REBUILT
action diff (cumulative across rounds). A stream that dies mid-follow-up keeps
whatever text arrived and ends the loop.

**Activity-log entries carry the card `id`** (`_log_entries_for_patch`:
created/moved/updated/deleted, plus `revived`), and `_build_chat_system_prompt`
renders it as a trailing `[id:…]` on each log line. One `create_card` WITH a
due_date emits both a `created` and an `updated` entry — by title alone that
reads as two cards, which is what produced the phantom "there was already one in
the pool from earlier this turn". The actions block says so explicitly: entries
sharing an id are one card. Legacy entries with no id render unchanged.
Regression properties pinned in `tests/test_exec_tool_rounds.py`.

### Uncached (measured, left alone)

| Call site | Why |
|-----------|-----|
| `monitor.py` | static slice ~1.3K (no tools) < 4096; debounced bursts = low reuse |
| `nudge_llm` `_TONE` | ~1.4K (no tools) < 4096; per-card one-shot |
| `card_llm` classify / parse-date | one-shot per card; no system / ~80-token volatile system |
| `morning.py`, `chat._dedupe_context` | daily one-shot; prompt lives in the user message |
| `gcal._haiku_classify_batch` | no system block; tiny instructions in the user message |

**Verifying:** the response `usage` reports `cache_creation_input_tokens`
(written this request, ~1.25x) and `cache_read_input_tokens` (served from
cache, ~0.1x). First request creates, second identical-prefix request
reads. `cache_read` staying 0 across two identical requests means a silent
invalidator is back in the prefix.

---

### 5d. Where the marker goes

Anthropic prompt caching is `cache_control: ephemeral`, 5-min TTL, wired on the large STATIC system prefixes reused across turns, so repeat turns read the prefix at ~0.1x. **Opus's minimum cacheable prefix is 4096 tokens; anything below that will not cache, silently**, and is left alone.

The marker always goes on a byte-stable block, and the volatile part must live somewhere else:

- **Tarot** (`tarot/agent.py`) — the marker sits on the single system block, `system=build_system(spread_type)` (~8.7K no-spread / ~13.4K three-card) + `TOOLS`. Fully static per reading; **the per-turn spread context rides in `messages`, never `system`**. A reading is many turns reusing one prefix.
- **MTG** (`mtg/agent.py`, `_SYSTEM_CACHED`) — `SYSTEM` (~5.9K) marked once, used at both call sites. Pass 1 (research tool-loop, with `TOOLS`) caches the ~6.6K tools+system prefix across its own iterations; pass 2 (summarize, NO tools) is a separate system-only prefix. Both cache cross-question; only pass 1 caches within a single question.
- **Exec chat** (`chat._build_chat_system_prompt`) returns a **TWO-block** system list: block 1 is `_CHAT_STATIC_PREFIX` (identity + `EXEC_VOICE` + global rules) carrying the marker, block 2 the volatile tail (TODAY, activity log, card lists, schedule, context, active-nudge block) carrying none. With the exec tools the cached prefix is ~5.2K.

  **TODAY moved from the top into the volatile tail — it was the silent invalidator.** The restructure was required because the tools alone (~3.5K) sit under opus's 4096 minimum.

  Both `routes_chat` call sites (main stream and `_stream_tool_followup`) build the identical static block, so the follow-up turn reads the cache the main turn wrote. The follow-up passes `_build_chat_system_prompt(stage, actions=…)` — an **ACTIONS YOU JUST TOOK** block (built by `chat_actions._actions_taken_block` from the turn's dispatched `{name,input,result}` list) appended to the volatile tail, **with the marker staying on block 1 so the cached prefix is byte-stable**.

## 6. Printer (ELEGOO Centauri Carbon) — two-tier reverse proxy

`/printer` serves the printer's **own** web UI (an Angular SPA with a live
MJPEG camera and SDCP websocket controls) from wai-lau.net, without the SPA
ever knowing it left the LAN. Same-origin everywhere: the browser talks only
to the droplet, so the full `session` cookie rides every sub-request incl.
the websocket handshake, and nothing weaker than the owner reaches a machine
that can heat a nozzle.

Since 2026-08-30 the page also has a **guest tier — read-only, by routing**
(it is linked from the public landing; guests pass Turnstile). The rule is not
"filter what a guest may send", it is "a guest has no route that carries their
bytes to the LAN":

| Route | Owner | Guest | Why |
|-------|-------|-------|-----|
| `GET /printer` | SPA wrapper | camera + stats wrapper | same template, `data-readonly="1"` for guests |
| `ANY /printer/{path}` | full proxy | **401 → admin login** | the SPA, its file endpoints, uploads — every browser→printer HTTP path |
| `WS /ws/printer` | SDCP relay | **1008** | the only browser→printer socket; it drives the machine |
| `GET /printer/video` | ~10fps | ~2fps | one-way read, off the shared hub |
| `GET /api/printer/status` | ✓ | ✓ | one-way read; the printer pushes it unasked |
| `GET /api/printer/health` | ✓ | ✓ | one-way liveness GET |

The two guest-reachable readers are **server-opened singletons**, not relays
of anything a viewer said: `printer_camera.py` holds ONE upstream MJPEG
stream (demuxed to whole JPEG frames, re-muxed per viewer — the printer only
allows ~4 streams, so a public page can't be 1:1) and `printer_status.py`
holds ONE SDCP socket that **sends no frame, ever** — the printer pushes
`sdcp/status/<id>` about once a second on its own, and `public_status()`
whitelists it (no `MainboardID`/`TaskId`/`Filename`).

### 6a. Topology

The printer sits on Wai's home LAN (`192.168.2.25`). Its three ports are
reverse-tunnelled from the home box to the droplet's docker bridge by
`printer-box/printer-tunnel.service` — the hosaka/emet pattern (§4a), with
the `-R` forwards pointing straight at the printer's LAN address (nothing
listens on the home box).

```mermaid
flowchart LR
  browser["Browser<br/>(/printer wrapper + iframe)"]

  subgraph droplet["droplet container — routes_printer.py"]
    page["GET /printer<br/>(guest or owner)"]
    health["GET /api/printer/health<br/>(guest or owner)"]
    status["GET /api/printer/status<br/>(guest or owner, read-only)"]
    http["ANY /printer/{path}<br/>(OWNER ONLY, rewrites HTML+JS)"]
    video["GET /printer/video<br/>(guest or owner, shared MJPEG hub)"]
    ws["WS /ws/printer<br/>(OWNER ONLY, session-cookie gated)"]
  end

  tunnel(["SSH reverse tunnel<br/>172.17.0.1:8126 / 8127 / 8128"])

  subgraph lan["home LAN — ELEGOO Centauri Carbon"]
    p80[":80 SPA + files"]
    p3030[":3030 /websocket (SDCP)"]
    p3031[":3031 /video (MJPEG)"]
  end

  browser -->|HTTPS| page
  browser -->|15s poll| health
  browser -->|iframe src + assets| http
  browser -->|"<img src>"| video
  browser -->|3s poll, guest view| status
  browser <-->|SDCP JSON frames| ws
  health --> tunnel
  status --> tunnel
  http --> tunnel
  video --> tunnel
  ws --> tunnel
  tunnel --- p80
  tunnel --- p3030
  tunnel --- p3031
```

### 6b. Why rewrites, and which

The SPA assumes it is the origin. Served under a path prefix on a different
host over https, four things break; each is patched in flight by the pure
helpers in `printer_proxy.py` (no I/O — unit-tested in
`tests/test_printer_proxy.py` against verbatim slices of firmware V1.4.49):

| Upstream shape | Breaks because | Rewrite |
|----------------|----------------|---------|
| `<base href="/">`, `href="/assets/…"` (index HTML) | assets + Angular routes resolve against the site root | `rewrite_html`: root-absolute `href`/`src` → `/printer/…` (protocol-relative `//` untouched) |
| `` `ws://${this.hostName}:3030/websocket` `` (main.js) | wrong host, wrong port, `ws://` on an https page | `rewrite_js`: → `` `${location.protocol==="https:"?"wss":"ws"}://${location.host}/ws/printer` `` |
| `"http://"+(…VideoUrl)` on the camera `<img>` (25.\<hash\>.js) | mixed content | `rewrite_js`: scheme dropped, the (rewritten) `VideoUrl` used verbatim |
| `` `http://${…hostName}:80` `` (file download href, upload POST) | wrong origin | `rewrite_js`: → `` `${location.origin}/printer` `` |
| `"/assets/images/network/*.png"` string literals in the compiled Angular templates (all bundles) | root-absolute → 404 against the site root (blank icons) | `rewrite_js`: quoted `/assets/` → `/printer/assets/` |
| `"VideoUrl":"192.168.2.25:3031/video"` in the SDCP reply to *enable video stream* (cmd 386) | LAN address | `rewrite_ws_text` on printer→browser text frames → `/printer/video` |
| `</head>` of the index | the SPA's own top bar (logo · language · store link) is noise inside the site shell | `rewrite_html` injects `<link href="/printer-frame.css">` (site-side overrides for the *proxied* document: hides `app-header`); injected after the re-root pass so the absolute href stays |
| `"Thumbnail":"http://192.168.2.25/board-resource/history_image/<task>.png"` (task detail, cmd 321; timelapse `TimeLapseVideoUrl` likewise) | LAN address, bound straight onto `<img src>` | `rewrite_ws_text`: any `http://<lan-ip>[:80]/` → `/printer/` (served off the printer's :80 by the proxy; other ports left alone) |

Relative URLs (hashed CSS/JS, webpack lazy chunks with `publicPath ""`,
`assets/i18n/…`, `iconfont.ttf`) resolve against the rewritten base href and
need nothing. **Deliberately not rewritten:** the WebRTC signalling socket
(`ws://<host>:8883`, reached only when the printer advertises
`VIDEO_WEBRTC` — this unit reports FILE_TRANSFER / PRINT_CONTROL /
VIDEO_STREAM only); a regression test pins it as untouched, so wiring it
(a fourth tunnel port + relay) is a conscious change.

Headers are **allowlists** in both directions (`upstream_request_headers` /
`client_response_headers`): the session cookie and admin bearer never reach
the printer; `accept-encoding` is pinned to `identity` so rewritable bodies
arrive uncompressed; `content-length` / `content-encoding` are dropped on
the way back (bodies change) but a request `content-length` is forwarded (a
streamed upload keeps its known length — the printer's tiny HTTP server is
not trusted to speak chunked); every response is stamped
`Cache-Control: private, no-cache` (auth-gated, never a shared-cache
candidate) and `main.py`'s `CacheControlMiddleware` skips the `/printer/`
prefix so its public/immutable stamp for static-looking suffixes never
applies. Conditional requests are answered by the **proxy**, never the
printer: `If-None-Match` is not forwarded, and a rewritten body's ETag is
the printer's tag + `-rw<REWRITE_VERSION>` (bump the constant whenever
`rewrite_html`/`rewrite_js` change), so the hashed bundles still 304 while a
browser copy patched by older rules misses and refetches — otherwise the
printer's unchanged ETag would 304 a stale rewrite back into service; only a
root-relative `Location` survives, re-rooted under the prefix — an absolute
or protocol-relative redirect target is dropped rather than sent to the
owner's browser.

### 6c. Runtime shape

- **`/printer/{path}`** streams every non-HTML/JS body straight through in
  BOTH directions (`StreamingResponse` over `httpx` `aiter_raw` down; the
  request body as `request.stream()` up, write timeout unbounded so a gcode
  upload runs at whatever the home uplink allows) — nothing is buffered;
  HTML/JS are read whole, rewritten, re-served.
- **`/printer/video`** relays the camera's `multipart/x-mixed-replace` with
  `X-Accel-Buffering: no` (nginx's `location /` buffers by default) and the
  content type excluded from `GZipMiddleware` (gzip would hold frames inside
  zlib). Newer starlette binds the exclusion list as a constructor-kwarg
  default at import time, so `main.py` passes the patched list explicitly
  when the signature accepts it (older starlette keeps reading the module
  global), and the tuple carries both the prefix and `type/*` spellings —
  without that, the MJPEG frames (and the fonts/images the list already
  named) were being gzipped after all. The relay **reconnects instead of
  ending**: the SPA's `<img>` never re-requests a dead MJPEG stream, so when
  the upstream ends or stalls past the 30s read timeout (camera pause,
  tunnel restart) `_video_frames` re-dials with 1→15s backoff and splices
  the fresh stream into the SAME open response (the printer's part boundary
  is constant; a changed boundary ends the response instead). Closing the
  tab cancels the generator wherever it is; its `finally` closes the
  upstream, releasing one of the printer's 4 allowed streams.
- **`/ws/printer`** accepts first, then dials the printer (like
  `/ws/hosaka`) — a browser that vanishes mid-handshake never strands an
  open upstream socket, and a down printer surfaces as a clean `1011` close
  the SPA retries on. Two pump tasks (`_pump_to_client` rewrites text
  frames; `_pump_to_upstream` forwards text + bytes) under
  `asyncio.wait(FIRST_COMPLETED)`; whichever side closes tears down both.
  Declared on the `public` router like `/ws/hosaka` (a router-level
  `Depends` can't gate a websocket the same way) and checks the `session`
  cookie itself with `hmac.compare_digest` — guests are refused (`1008`
  before `accept()`, which the browser sees as a 403 handshake).
- **Liveness** (`/api/printer/health`): the tunnel ports stay bound while the
  printer is off and a connect *accepts then resets* — so only a real HTTP
  answer from the SPA shell counts as online (the `/api/hosaka/health`
  rule), probed with its own fail-fast 2s-connect / 3s timeout. Every
  upstream call has a short connect timeout and degrades to a 503 or a
  closed socket, never a 500.
- **The wrapper** (`templates/printer.html` + `web/printer.{css,js}`): a
  status row over an `<iframe>` of `/printer/network-device-manager/network/control`.
  The iframe isolates the SPA's global antd CSS from chrome.css and scopes
  its `<base href>` to its own document. `printer.js` polls health every 15s
  (+ on tab focus; polls are sequence-numbered so a slow, older answer can
  never overwrite a fresher one) and mounts the iframe only while online;
  offline swaps in a "printer offline" note and sets the frame to
  `about:blank` so the SPA's reconnect loop dies with it. Online again →
  remounts by itself. The page keeps the site's Exec link-bubble; because
  `window` mouse events stop firing once the cursor crosses into a
  cross-document frame, `exec-bubble-drag.js` flags a live mouse drag as
  `html.exec-drag` and `printer.css` drops the iframe's `pointer-events`
  for its duration, so the bubble can be dragged across the SPA.

Verified end-to-end against the live printer with the real app under
uvicorn (auth tiers, rewrites, etag→304, un-gzipped MJPEG, WS relay + the
cmd-386 rewrite, reconnect splice against a fake upstream that drops every
few frames).

| Endpoint | Router | Reachable by |
|----------|--------|--------------|
| `GET /printer`, `GET /api/printer/health` | `protected` | owner only |
| `ANY /printer/{path}`, `GET /printer/video` | `protected` | owner only |
| `WS /ws/printer` | `public` + `session` cookie check | owner only (else `1008`) |

### 6d. The tunnel and its env

The printer's three ports are `ssh -R`-tunnelled from the home box to the docker bridge exactly like hosaka/emet (install steps in `printer-box/README.md`):

| Printer port | Bridge | Env var |
|---|---|---|
| `:80` SPA + files | `172.17.0.1:8126` | `PRINTER_UPSTREAM` |
| `:3030` SDCP websocket | `:8127` | `PRINTER_WS_UPSTREAM` |
| `:3031` MJPEG camera | `:8128` | `PRINTER_VIDEO_UPSTREAM` |

`routes_printer.py` serves every route; the pure rewrite helpers live in `printer_proxy.py`, unit-tested against verbatim slices of firmware V1.4.49 in `tests/test_printer_proxy.py`.

### 6e. The wrapper page

**`GET /printer`** serves `templates/printer.html` through `printer_page()` — the standard shell + full nav, `full_height`: a lede and an online/offline status row over an **`<iframe>`** of the proxied SPA at `/printer/network-device-manager/network/control`.

The iframe is **isolated on purpose**: the SPA's global antd CSS never touches chrome.css, and its `<base href>` only applies inside its own document.

`web/printer.js` polls `/api/printer/health` every 15s (+ on tab focus; polls are sequence-numbered so a slow older answer never overwrites a fresher one) and mounts the iframe ONLY while the printer answers. Offline (printer off, home box asleep) shows a quiet "printer offline" note instead of the SPA's endless reconnect loop (frame set to `about:blank`), and it remounts by itself when the printer is back.

**The iframe fades in only on its `load` event** (`.printer-frame` is `opacity:0` until `printer.js` adds `.ready`) — the vendor SPA paints a white document before its app renders, so revealing it the instant `src` is set flashed white; now the page shows its own dark bg during the boot and the SPA fades in once painted.

**The guest render is a different page, not a filtered one.** `printer_page()` marks it `data-readonly="1"` on `.printer` and `printer.js` then never mounts the SPA frame at all — belt to the route tiering's braces — showing `#printer-view` instead: the camera `<img>` plus a stats row polled from `/api/printer/status` every 3s.

**`printer.css` does NOT drop the CRT stack to `z-index:-1`** the way `/rd` and `/hq` do. It stays at `--z-modal` IN FRONT for BOTH tiers, so the printer's picture reads as a feed on a CRT (phosphor + scanlines + glass blur), the proxied vendor SPA included; the layers are `pointer-events:none` so the SPA stays clickable underneath.

**The Exec link-bubble is draggable ACROSS the iframe**: window mouse events stop at a cross-document frame, so `exec-bubble-drag.js` flags a live mouse drag as `html.exec-drag` and `printer.css` drops the frame's `pointer-events` meanwhile.

Nav label is `3DP`, icon `printer.png` — the bitman smiley tile with rounded corners, baked from the untracked `bitman.png`. Its tile was recoloured lime→blue `#0090fc` on 2026-08-30: the lime read as the phosphor `.active` green, so the nav item looked permanently lit on every page. The route, icon key and internal name all stay `printer`; on the landing page it sits between nightfall and UI (its hue slot moved with the recolour).

### 6f. What gets rewritten, exactly

`text/html` and JS bodies are rewritten in flight; everything else streams through untouched, both ways (an upload body is `request.stream()`ed with its `content-length` forwarded, write timeout unbounded).

| In the vendor bundle | Becomes | Why |
|---|---|---|
| `<base href="/">` + root-absolute `href/src` | under `/printer/` | the SPA thinks it is at the site root |
| *(injected into `<head>`)* | a `<link>` to `web/printer-frame.css` | site-side overrides for the VENDOR UI — currently just hiding its `app-header` (logo/language/store) |
| `ws://${hostName}:3030/websocket` | `wss://<host>/ws/printer` | same-origin socket |
| `"http://"+VideoUrl` | scheme dropped | mixed content otherwise |
| `http://${hostName}:80` | `${location.origin}/printer` | file download/upload host |
| quoted `"/assets/images/…"` | `/printer/assets/…` | baked into compiled templates; 404ed as blank icons against the site root |

The WebRTC signalling socket (`ws://<host>:8883`, needs `VIDEO_WEBRTC`, which this unit lacks) is deliberately **NOT** rewritten — pinned by a regression test.

The wrapper's own styles stay in `printer.css`; `web/printer-frame.css` is only ever for the proxied document.

**Headers are an ALLOWLIST both ways.** Requests forward accept / content-type / content-length / if-none-match / range / … plus `accept-encoding: identity`, so the session cookie or bearer NEVER reaches the printer. Responses are likewise filtered and every one is stamped `Cache-Control: private, no-cache` — auth-gated, so never shared-cacheable. `CacheControlMiddleware` skips `/printer/` so its public/immutable stamp for `.js/.css/.ttf` suffixes cannot apply here.

**Conditional requests are answered by the PROXY, never the printer.** `If-None-Match` is not forwarded, and a rewritten body's ETag is the printer's tag + `-rw<REWRITE_VERSION>` — **bump that constant whenever the rewrite rules change**. The hashed bundles still 304, but a browser copy patched by older rules misses and refetches instead of reusing stale rewrites off the printer's unchanged ETag. (`last-modified` survives only on pass-through bodies.) Only a root-relative `Location` survives, re-rooted under the prefix; any other redirect shape is dropped.

On the socket, printer→browser text frames pass `rewrite_ws_text`, which turns `"VideoUrl":"<ip>:3031/video"` (the enable-video-stream reply, cmd 386) into `/printer/video`, and any other `http://<lan-ip>[:80]/…` URL — the print-task `Thumbnail` from cmd 321, the timelapse `TimeLapseVideoUrl` — into `/printer/…`. The SPA binds those straight onto `<img src>`.

`WS /ws/printer` **accepts first, THEN dials the printer**, so a vanished browser never strands an upstream socket and a down printer is a clean 1011 the SPA retries.

### 6g. The camera hub

`GET /printer/video` is declared on the **`public`** router with the tier checked by hand (`_has_view_access`). The routers mount public → protected → guest_protected, so a `guest_protected` declaration would never be reached — the owner-only `/printer/{path}` catch-all would match `/printer/video` first.

The printer accepts only ~4 concurrent streams, so a 1:1 relay stopped scaling the moment the page went public. The hub holds **ONE** upstream stream however many browsers watch: it demuxes the upstream parts into whole JPEG frames (`Content-Length`-framed), keeps the latest, and re-muxes a fresh multipart body per viewer (own boundary `--printerframe`) starting from that frame, so a joiner paints instantly instead of catching half a frame.

Each viewer has a one-frame queue and drops what it cannot keep up with, so a slow viewer never stalls the upstream. Guests are throttled to `GUEST_FRAME_INTERVAL` 0.5s (~2fps / ~55KB/s vs the owner's ~10fps / ~340KB/s), viewers cap at `MAX_VIEWERS` 16 (503 past that), and the upstream is dropped 10s after the last viewer leaves. Verified live: 5 concurrent viewers = 1 upstream socket, every part a valid JPEG.

**The hub RECONNECTS instead of ending.** An `<img>` never re-requests a dead MJPEG stream, so on upstream end/stall (>30s silence, tunnel restart) it re-dials with 1→15s backoff and keeps feeding the SAME open viewer responses — the viewer bodies are ours, so a changed upstream boundary no longer matters.

`StreamingResponse` with `X-Accel-Buffering: no` for nginx, and the content type is excluded from gzip in `main.py` — which now passes the exclusion list to `GZipMiddleware` **EXPLICITLY**, since newer starlette binds the kwarg default at import time and silently ignored the module-global patch. The tuple lists both the prefix and `type/*` spellings so old and new starlette both honour it.

`GET /api/printer/health` is `{ok}` 200/503 with its own fail-fast 2s-connect/3s timeout. **Liveness = the SPA shell actually answers**: the tunnel port stays bound while the printer is off and accepts-then-resets, and a bound port is NOT online — the same rule as `/api/hosaka/health`. Every upstream call has a short connect timeout and degrades to 503 or a closed socket, never a 500.

Verified end-to-end against the live printer with the real app under uvicorn: auth tiers, rewrites, etag→304, un-gzipped MJPEG, WS relay + cmd 386 rewrite, reconnect splice.


---

## 7. `/cc` — Claude Code in the browser

Owner-only. Wai's own Claude Code session, driven from a web page instead of a terminal — often from a phone. Summary + the invariants a change must not break live in CLAUDE.md's page table; this section is the mechanism and the incident history.

**It became a full agent on 2026-09-13.** It shipped as a deliberately tools-light chat page ("no filesystem, never offer to run anything", two web tools), and that framing is now historical: `Read`, `Write`, `Edit`, `Bash`, `Glob` and `Grep` are on, at Wai's request, because she wants the working surface of a terminal session without the terminal. Both halves of that decision are recorded here — what it bought, and what it costs (§7b).

Its `cwd` is a private scratch sandbox and **not** a checkout of exec-fn: the repo is not in the unit's mount namespace, so the agent cannot see it. The system prompt says so explicitly, because a model that goes looking for a project, finds an empty directory and reports the page as broken is the obvious failure here.

### 7a. Topology

Claude Code cannot run in the app container (`python:3.12-slim` — no node, no `claude` binary, no credentials), so it runs on the droplet HOST as its own unprivileged user and the container reaches it over the docker bridge at `172.17.0.1:8129`. Same idiom as hosaka/emet/printer minus the SSH tunnel, since it is the same box.

```mermaid
flowchart LR
  B[browser /cc] -->|SSE over POST| API[FastAPI routes_cc.py]
  API --> CL[cc_client.py]
  CL -->|172.17.0.1:8129| SC[claude-box/server.mjs<br/>cc-sidecar.service]
  SC --> SDK[Agent SDK -> claude CLI subprocess]
  SC --> ARCH[(~cc-agent/.cc-archive)]
  SC --> PTR[(~cc-agent/.cc-session)]
  SDK --> MCP[createSdkMcpServer 'archive']
```

Host side is `claude-box/` (`server.mjs` sidecar on the Agent SDK, `cc-sidecar.service`, idempotent `setup.sh`, README). Container side is `cc_client.py` (transport) + `routes_cc.py` (routes), mirroring the `emet_client`/`routes_emet` split.

`/srv/cc-agent` (the sidecar code) is **root-owned** so the agent cannot rewrite the server that constrains it.

**Auth is `cc-agent`'s OWN subscription login** (`sudo -u cc-agent -H /usr/bin/claude`, then `/login`) — NOT a copy of wai-root's `~/.claude/.credentials.json`. Two processes sharing one OAuth refresh token race, and the loser (usually the interactive session) is logged out mid-refresh. A logged-out sidecar answers a clean per-request `Not logged in · Please run /login` text frame, so the page degrades rather than 500s.

`MAX_CONCURRENT` 1 + `MemoryMax=700M` is a memory ceiling expressed as a queue depth (~930MB free, each run spawns a CLI subprocess); a second request gets 429, surfaced as "busy".

### 7b. The sandbox — three mechanisms, and they are NOT equally strong

Know which is which before trusting one.

1. **The filesystem is an ALLOWLIST and is solid**: `TemporaryFileSystem=/:ro` + named `BindReadOnlyPaths`/`BindPaths`.

2. **MCP connectors are an ALLOWLIST and are solid**: `strictMcpConfig: true` + `mcpServers` naming only the in-process `archive` server = "only the servers named here". (It was `mcpServers: {}` — literally none — until the archive tools landed 2026-09-11; the allowlist property is what carried over, not the emptiness.)

   **This was the 2026-09-10 session's worst finding.** Signing cc-agent into claude.ai attached that ACCOUNT's connectors — a probe found Gmail, Google Calendar and Google Drive all `"connected"`, exposing `send_message`, `trash_thread`, `share_file`, `download_file_content` and `delete_event` through a public-internet page behind one cookie. They are server-side capability riding the OAuth identity, so the mount namespace, `settingSources: []` and a built-in-tool blocklist ALL missed them completely. **Any subscription login inherits whatever connectors the account has** — re-probe after enabling a new one.

3. **Tools are an ALLOWLIST — since 2026-09-13, and only since then.** The SDK's **`tools`** option sets the base set of built-in tools (`[]` disables them all), so anything not named there never enters the model's context, **including a tool that ships in a future SDK**. `BUILTIN_TOOLS` is `["WebSearch", "WebFetch"]`; the archive tools arrive separately through `mcpServers`.

   It was a **denylist** until then (`disallowedTools`, listing every name by hand), and that is a losing game: every name added to it after the fact is one that already reached a user once. **`AskUserQuestion` is how this was found** — nothing listed it, because nothing knew to, so it rode in on the login, the model called it mid-answer, and the page printed a raw `AskUserQuestion is not available in the sandbox` at Wai.

   Measured on the pre-fix config the same day — **8 tools reached the model, not 5**: `AskUserQuestion`, **`EnterPlanMode`** and **`ExitPlanMode`**, the last two unnoticed because the model never happened to call them. With `tools` set: exactly the 5 in `ALLOWED_TOOLS`.

   `disallowedTools` stays as belt, and to keep built-ins out of CONTEXT — a tool the model can see, calls, and is refused on burns a turn and reads as the assistant being broken.

   **`canUseTool` is NOT the gate and must never be described as one.** Measured 2026-09-10 with a deny-everything callback and `ToolSearch`/`CronList` left visible: both EXECUTED (`CronList` returned "No scheduled jobs") and the callback was never invoked once. It does not see harness tools. The code said "the actual gate" in a comment for months, which is most of why the denylist was treated as cosmetic and left to rot.

   > After any `@anthropic-ai/claude-agent-sdk` bump, run the probe and confirm `TOOL COUNT: 5` with no `UNEXPECTED` line:
   >
   > ```bash
   > systemd-run --user --scope -p MemoryMax=700M \
   >   sudo -u cc-agent -H node /srv/cc-agent/probe-tools.mjs
   > ```
   >
   > `claude-box/probe-tools.mjs` imports `sandboxOptions()` from `server.mjs` rather than rebuilding it, so it measures the policy that actually serves traffic. That import is why `server.listen` is guarded by `RUN_AS_MAIN` — an import that seized the port would take the live sidecar down to answer a question about it. **The probe was referenced in these docs for months without existing as a file**, which is most of how a tool reached a user: nothing was re-run because there was nothing to run.

### 7b-bis. The blast radius, honestly (2026-09-13)

This used to read "with no `Read` there is no local untrusted content to inject THROUGH, and with no `Bash`/`Write` an injected instruction reaches nothing it could act on." **That is no longer true and must not be quoted back as if it were.**

With `Bash` + `Read` + `WebFetch` all on, the exfiltration path is real and specific:

```
fetched page (or text inside a pasted screenshot)
  -> untrusted instructions land in context
  -> Bash/Read reach /home/cc-agent/.claude/.credentials.json
  -> WebFetch carries it out
```

`/home/cc-agent` is a **writable** bind (`BindPaths=` in the unit) and the sidecar runs **as** `cc-agent`, so the OAuth subscription token is readable by the very process holding the tools. No mount trick fixes this: the process needs those credentials to authenticate at all.

**Admin-only does not mitigate it.** The trigger is content the model fetched, not a person logging in — so "I am the only one with access" is true and irrelevant to this path.

**This was raised, understood and accepted** by Wai on 2026-09-13, weighing that the worst case is her subscription quota rather than infrastructure or data. Do not re-litigate it. **Do** re-raise if the credential storage changes, if a larger secret lands in that bind, or if the unit ever gains a bind that reaches the exec-fn repo or `data/`.

### 7b-ter. The path gate, and the one tool it does not cover

`canUseTool` confines every **path-taking** tool to the sandbox directory: `Read`, `Write`, `Edit`, `NotebookEdit`, `Glob`, `Grep`. The logic is `claude-box/sandbox-paths.mjs`.

The mount namespace decides what EXISTS; this decides where inside it the agent may go — which matters because the namespace still contains `/home/cc-agent`, and that holds the OAuth token.

**It is two checks, and the second is why this is not "a regex".** A character allowlist on the raw string, then the **resolved** path must still sit under the root — the same shape `archive-tools.mjs` uses (§7d). The resolution is not optional, because the agent has `Write`:

```bash
ln -s /home/cc-agent/.claude/.credentials.json ./notes.txt   # then Read ./notes.txt
```

That path is textually inside the sandbox the whole time; `realpath()` is what collapses it back to where it really points. A file that does not exist yet (Write creating one) resolves its deepest EXISTING ancestor, since a new file lands wherever its parent really is and the parent can be the link. Containment compares path **segments**, never a string prefix — `/srv/cc-sandbox-evil` starts with `/srv/cc-sandbox` as text while being a different directory.

Verified against the running sidecar, `Read` on `/etc/passwd`:

```
outside the sandbox -- Read.file_path: resolves to /etc/passwd, outside the sandbox
```

13 cases in `claude-box/sandbox-paths.test.mjs`, against real directories and real symlinks rather than mocks (a mocked `realpath` would be testing the test). Run in the pytest suite by `tests/test_cc_sandbox_paths.py` — pointed at the test FILE, because `node --test claude-box/` treats every `.mjs` in the directory as a test and would execute `server.mjs` (binds a port) and `probe-tools.mjs` (spends a real API call).

> **`Bash` is NOT covered, and cannot be by this or any regex.** A shell command reaches any path through quoting, variables, subshells or a redirect; a pattern that appeared to contain it would be worse than the honest gap. Demonstrated in the same live test: asked about the credentials file, the agent reached it with `ls -l` and declined to open the contents **by its own judgement, not because anything stopped it**.
>
> **Decided 2026-09-14: keep `Bash`, accept that the sandbox dir binds only the file tools.** The boundary for `Bash` is the mount namespace — it cannot see `/exec-fn`, `data/`, the docker socket, `/etc/cron.d` or `/etc/shadow`, but it CAN reach `/home/cc-agent`. The alternative on the table was dropping `Bash`, which would have made the gate the complete story at the cost of the terminal-like surface that is the point of the page. Do not re-litigate; do re-raise if a bigger secret lands in that bind.

What still bounds it:

- **The mount namespace** (§7b.1) is still the strongest layer, and was TIGHTENED when Bash landed: `TemporaryFileSystem=/:ro` plus named binds, so the process sees `/usr /bin /sbin /lib /lib64 /srv/cc-agent` read-only, a file-by-file slice of `/etc`, and `/srv/cc-sandbox` + `/home/cc-agent` read-write — **nothing else on the droplet**. Not `/exec-fn`, not `data/`, not the docker socket.

  **`/etc` used to be bound wholesale**, which was the one place the allowlist went coarse. Once `Bash` was on that mattered: `/etc/cron.d/exec-fn-security` carries `SECURITY_OWNER_IP` — Wai's home IP, precisely the owner-identifying data `/security` is careful never to render — and `/etc/nginx` exposed the topology. Neither is a secret the way a key is, but neither belongs in reach of a page that fetches untrusted URLs. Now only `ssl` / `ca-certificates` (outbound TLS), `passwd` / `group`, `nsswitch.conf` / `hosts` / `resolv.conf` (name resolution) and `localtime` are bound. Verified in the live namespace: `/etc/cron.d`, `/etc/nginx`, `/etc/shadow` and `/exec-fn` are all absent; `/etc/shadow` and the letsencrypt private keys were already unreadable on permissions alone.

  **The sandbox stays sealed, by decision.** Asked on 2026-09-13 whether /cc should see `/exec-fn`, Wai said no — keep it in the sandbox dir. Do not add a bind for the repo, `data/`, or the docker socket. If /cc says it cannot find a project, that is correct.

  **Verify any unit change from INSIDE the namespace**, because running as `cc-agent` alone does not test it — `sudo` will not even start in there (no `/etc/sudoers`, which is the confinement working):

  ```bash
  PID=$(systemctl show -p MainPID --value cc-sidecar)
  sudo nsenter -t "$PID" -m -S $(id -u cc-agent) -G $(id -g cc-agent) -- \
    env HOME=/home/cc-agent node /srv/cc-agent/probe-tools.mjs
  ```

  The probe authenticates to api.anthropic.com, so it exercises DNS, TLS and OAuth and fails loudly if a bind is missing.
- **`MemoryMax=700M`** on the unit means a runaway command kills the sidecar rather than inviting the global OOM killer to pick a victim by badness score (§17b).
- **`settingSources: []`** stops the agent writing its own permission rules and having them honoured next turn. That was a hypothetical when it had no `Write`; it is now load-bearing.
- **The tier.** `/cc` hands a shell to whoever reaches it, so admin-only is the whole of the access story — pinned by `tests/test_cc_admin_only.py`, which enumerates the routes from `routes_cc.py` rather than trusting a hand-written list.

### 7c. Tools — what is granted, and the deliberate widening

It runs with **five tools and one MCP server, all of them ours** — `WebSearch`, `WebFetch`, and the three `mcp__archive__*` tools, the only names in `ALLOWED_TOOLS` — plus an explicit `systemPrompt` replacing Claude Code's coding-CLI preset, and `cwd` on an empty confined dir.

The web tools were added 2026-09-11 after the page answered "search news" with its training cutoff, which is broken behaviour for a chat assistant; the system prompt now tells it to search first and never cite its cutoff on a dated question.

**This is a deliberate widening of the sandbox, not an oversight.** `WebFetch` is a real exfiltration channel — a fetched page is untrusted text that can try to steer the model into putting conversation content into a follow-up URL — and Wai enabled it weighing exactly that.

Tool lines render on the page via `summarize()` in `cc.js`, which puts `query`/`url` FIRST (WebSearch has none of the older keys and fell through to a raw JSON dump; WebFetch's `prompt` is the instruction to the fetcher, not the thing fetched).

**A tool call is ONE line, and its output folds under it** (`web/cc-toolout.js`, 2026-09-13). The line clips with an ellipsis (`.msg.tool .msg-body`, `white-space: nowrap`) — a url or a bash command routinely wrapped to three rows, and a turn with four fetches was a wall of addresses with the answer somewhere past it. The result renders collapsed (`hidden`); tapping the line reveals it and flips the gutter marker `+` → `-`. **The whole row is the hit target, not the marker glyph** — a 1ch pseudo-element is not a thumb, and this page is driven from a phone. Open, the block is capped at `max-height: 20lh` and scrolls inside itself: `lh` is 20 of the block's OWN lines, which is what the cap is about, where the `12rem` it replaced was a different number of lines at every font size.

Pairing is **FIFO, not by id**: the sidecar flattens `tool_use`/`tool_result` blocks to name+text (`server.mjs`) and carries no `tool_use_id`, and a turn's results arrive in the order its calls were made. A call is consumed from the queue even when its result is empty and nothing renders — otherwise it would stay queued and swallow the NEXT result — and `streamResponse` empties the queue at the top of every turn so an aborted run cannot pair across turns. A result with no waiting call falls back to a standalone open block rather than vanishing. The cursor parks on the TOOL line while the block is folded, since a blinking cursor inside a hidden element reads as a page that stopped.

### 7d. The archive is three tools, not a filesystem

`claude-box/archive-tools.mjs` (2026-09-11): `list_conversations`, `search_conversations`, `read_conversation`, served by an in-process `createSdkMcpServer` named `archive` — the ONE entry in `mcpServers`, so `strictMcpConfig` still drops the account's claude.ai connectors.

Asked whether it could read its own archived conversations, the page answered "no filesystem, no history store here" — true and useless, since `/new` had been writing every one of them to `~cc-agent/.cc-archive/`. **Granting `Read` would have been the lazy fix and the wrong one**: `Read` is a filesystem, and a filesystem is every file the unit can see.

Containment is enforced TWICE per call — the id must match `^[A-Za-z0-9_:-]+$` (no separators, no dots, so `..` cannot be spelled) AND the resolved path must still sit under the archive root. The second check is what survives a future edit to the first. `transcriptPath` is exported for exactly that test — verified refusing `../../etc/passwd`, `..`, `a/../../b`, `/etc/passwd`, `x/../..`, `../.cc-session`, `..%2f..`.

Reads come back in 40K-char slices with a `from=` offset to continue. The system prompt tells it to search the archive rather than claim it has no memory.

### 7e. The persona is two halves

`SYSTEM_PROMPT` in `server.mjs` (the operating rules — no tools, no repo, and the SVG-drawing affordance) plus **`claude-box/cc-context.md`**, appended by `buildSystemPrompt()` — who Wai is, her ADHD calibration (inattentive, high-masking, so generic ADHD advice misses and the answer has to name the smallest concrete first action), and caveman-ultra delivery.

It is read **per run**, so an edit lands with no restart — but it reads `/srv/cc-agent/cc-context.md`. **Editing the repo copy alone changes nothing**; reinstall it:

```bash
sudo install -o root -g cc-agent -m 0640 claude-box/cc-context.md /srv/cc-agent/
```

Root-owned like the rest of the sidecar so the agent cannot rewrite its own instructions, and byte-stable across turns so the prefix caches. It deliberately carries NO repo/project detail — with no tools and no filesystem that would be tokens every turn buying nothing — and the personal detail it does carry is safe only while /cc stays owner-only.

Testing a prompt change appends to the ONE live conversation: park `/home/cc-agent/.cc-session` first, restore after.

### 7f. One continuing conversation — the SIDECAR owns the pointer

A pointer file (`~cc-agent/.cc-session`) holding the current session id, not a JS variable on the page. It used to be the latter, so every page load silently began a new conversation: five sessions came out of a handful of messages. Server-side means the thread also survives a phone locking and a move between devices, which no browser-side value can.

The page never sends a session id; `GET /api/cc/history` replays the thread on load. Because the pointer IS the thread, resuming is a one-line change on the server — nothing is copied and nothing is lost.

**Clearing ARCHIVES first.** `/new` writes the whole conversation to `~cc-agent/.cc-archive/<ISO-stamp>__<session-id>/conversation.txt` before dropping the pointer, and **a failed archive ABORTS the clear** (the page says so and keeps the thread) — a clear that loses the transcript is the one outcome worth failing loudly for.

Format is fixed and parseable, not pretty-printed: a `key: value` header, a blank line, then one block per message opening `[NNNN] SPEAKER ISO8601Z`. The index is zero-padded so lexical order IS chronological order, the speaker is a bare uppercase word, and timestamps are always UTC with a `Z` — nothing varies with locale, timezone or terminal width. Pasted images are written beside the transcript as `img-<NNNN>-<n>.<ext>`, named from the index that referenced them, with an `images:` line in the block. The dir is `0700` cc-agent, so read it with `sudo`.

`/new` drops the POINTER only — the old transcript stays on disk under `~cc-agent/.claude/projects`, so ending a conversation is never destroying one. Slash-command turns are stored as user messages wrapped in `<command-name>` tags and are filtered out of the replay; an unreadable or vanished session replays as EMPTY rather than erroring, so the page always opens.

### 7g. Commands (`web/cc-commands.js`, `web/cc-sessions.js`)

Split out of `cc.js` at the 500-line cap, and named for what it holds: what a leading slash means before anything is sent.

| Command | What |
|---|---|
| `/new`, `/clear` | Archive the conversation, drop the pointer |
| `/help` | Lists every command — the page's own, so it beats the SDK's "isn't available in this environment" |
| `/list` | The 20 most recent conversations |
| `/listall` | Every one |
| `/back` | The most recently touched conversation that is not the current one — one word instead of listing and aiming |

The list renders **oldest first, so the most recent sits at the BOTTOM**, nearest the composer and where the eye already is, the same way the transcript reads; the sidecar returns newest-first as the canonical order and the page reverses it. `/list` says `[ 20 of 35 — /listall for the rest ]` when it truncates.

Each row carries how long ago it was touched, right-aligned, as `<1m` / `45m` / `2h 20m` / `3d 14h 3m` — minutes are the floor (nothing in this list turns on seconds) and days the ceiling (`3w` makes you do arithmetic to compare it against `9d`); leading and trailing zero units are dropped (`2h`, not `2h 0m`) but an interior zero stays (`3d 0h 5m`) so the columns keep their meaning.

Rows are **tappable, not numbered**: the page is used one-handed, where reading a list and then typing `/resume 3` means the keyboard covers the thing being read from. The list is scoped sidecar-side to this sandbox's `cwd`, so the account's other sessions never appear, and `/resume` re-checks that the id is one of them (plus a uuid-shape test, since the string becomes a filename downstream). Titles prefer the **cached** haiku rolling title over the SDK's summary, read-only — a list of forty rows must not fire forty haiku calls to name itself.

**Some slash commands are the SDK's own and are passed through deliberately** (`CC_SDK_COMMANDS`): `/context`, `/cost`, `/usage`, `/compact`, `/model` — probed 2026-09-11, not assumed. They cost no turn (`turns: 0`) and never reach the model, and `/model <name>` really does switch it. `/help`, `/status` and `/memory` answer "isn't available in this environment"; `/agents` says it was removed.

**`/clear` is deliberately NOT passed through**: the SDK honours it SILENTLY, which would drop the conversation without the archive `/new` writes first, so the page keeps `/clear` as its own alias for `/new`.

Every leading slash now goes through `runCommand` — the old `text.startsWith('/') && !pending.length` meant a command typed with a screenshot attached bypassed the page entirely and went to the SDK verbatim, `/clear` included.

### 7h. The status bar (`web/cc-status.js`)

Carries the same numbers the Claude Code status line shows in a terminal, **in the same shape and the same colours** — read off `~/.claude/statusline-command.sh` rather than approximated.

`#cc-status` is **two rows, metrics first**: line 1 the metrics, line 2 the conversation's title on a full-width hash-coloured band (black text) sitting directly above the transcript it names.

Metrics sit on the page's own black in **five equal columns** (`grid-template-columns: repeat(5, 1fr)`, each value centred in its own fifth):

| Slot | Colour |
|---|---|
| `ctx:N%` | bright white |
| `(base:N%)` | grey `#8a8a8a` |
| `5h:N%` | pink `#ffafaf` |
| its reset | mint `#afffaf` |
| `7d:N%` | cyan `#00cdcd` |

**Each box also carries a little gauge under its number** (`.cs-bar`, 2026-09-14), drawn in the idiom `/rd`'s month calendar already uses for a day's load: **a row of PILLS, not a bar with a lit portion** — same 5px body, same `--radius-pill`, same flat fill with no gloss. Ten pills, so one pill is 10%; lit pills take the segment's own colour via `currentColor` (a gauge belongs to the number above it, rather than the row becoming one green block) and the rest sit at the calendar's own `0.12` rule green.

Three details it turns on:
- **The pills flex (`flex: 1 1 0`, `min-width: 0`) rather than sitting at a fixed 5px.** Five gauges of ten fixed dots do not fit a 375px phone, and a gauge that overflows its fifth is worse than one whose dots are a little narrow.
- **The lit count rounds UP off zero** — 4% is one pill, not none. An empty gauge has to mean nothing is there, not "not much".
- **The gauges carry side margins, and the pills inside one carry none** (`gap: 0`). Touching pills read as one gauge that happens to be divided; spaced ones read as ten separate marks the eye has to count. Between gauges the margin is what stops the five running together into a single dotted rule across the bar.

**`[x]` ends the conversation** — Exec's own button, same mono and same 0.8 green lifting to 1, doing what `/new` does (archive first, then drop the pointer; a run in flight is interrupted before the pointer moves, since a reply streaming into a conversation that no longer exists is the one way to lose it). **It sits in the status bar, not at the right end of the composer where Exec puts it**: on this page that corner belongs to the Exec bubble, and `elementFromPoint` over a composer button there returns `exec-bubble` — every tap would have opened the planning panel. `.cs-meta` pads right by the button's width so the `7d` column never slides under it.

The reset box gauges **how much of the 5h window has BURNED** (`ccBurned`, from the time left), so all five bars mean the same thing — more filled = less left — instead of one of them running backwards. No reset time means an empty bar, never a full one: an unknown must not look like an alarm.

**All five always render, defaulting to 0**: a slot that appears only once it has a value makes the row jump as numbers arrive, and an absent `ctx` reads as broken rather than as "no reply yet". A flex row sized each box to its text, so `9% → 10%` shifted everything after it; on a fixed fifth a value moves only inside its own box and the row reads as a gauge. (All four colours grandfathered into `raw-color-baseline.json` via `--update`, the sanctioned route for a deliberate new colour.)

The title hue is `hash(title) % 360` at 95% / 60% — the shell hashes with md5 and the browser has none (SubtleCrypto is SHA-only), so it uses FNV-1a: same behaviour, different exact hue from the terminal for the same title.

**Every figure is REPORTED, never estimated** — model from the SDK's `init` frame, context from the input side of the last `result` (`input_tokens + cache_read + cache_creation`, forwarded as `ctxTokens` and taken against 1M for a `[1m]` model else 200K), and the 5h/7d windows from `GET /api/cc/limits`.

**That last one is not in the SDK.** `rate_limit_event` is declared in its `.d.ts` but the string appears ZERO times in the shipped `sdk.mjs` (0.3.265), and nothing the CLI writes to disk holds the numbers either. What the CLI actually does — both strings are in its binary — is read `anthropic-ratelimit-unified-*` response headers and call `GET /api/oauth/usage`; that endpoint is the one reachable outside a request, so `claude-box/usage.mjs` asks it with cc-agent's own OAuth access token and returns percentages. **The token never leaves the sidecar** (read there, exchanged for two numbers, never refreshed — two processes on one refresh token race, which is why this account has its own login; an expired token degrades to no numbers). Cached 60s server-side, fetched on load and on `cc:reply-done` rather than polled. The stream's `limits` frame handling stays as a free upgrade path if a future SDK starts emitting it.

`cc.js` hands every SSE frame to `ccStatusOn()` and the bar ignores what it doesn't need.

**`base` is the script's definition, mirrored**: the SMALLEST total input ever observed — system prompt + tools + standing context, the floor a conversation cannot go below — persisted in `localStorage` (`cc.ctxbase`), the analogue of the script's `~/.claude/cache/statusline_baseline_global`. The first turn after a `/new` is the only time it is seen cleanly, which is why it persists rather than being recomputed.

The two rows were merged onto one on 2026-09-11 and split back the same day: on a phone the metrics are a fixed ~330px of the 430 available, so a single row truncated the title to almost nothing. On its own line the band gets the full width and the metric colours survive (white, mint and cyan are illegible on a bright band). The model is no longer shown at all — it is still tracked, since it decides which context window `ctx%` is measured against.

**Positioning, all three learned by failing:**
- Anchored to `top: var(--vvt, 0)`, the VISUAL viewport's offset, not the layout viewport — a soft keyboard shrinks and offsets the visual viewport (iOS standalone also scrolls the document) while a `fixed; top: 0` stays pinned to the layout viewport, which is how the bar ended up above the screen the moment the keyboard opened. `#exec-panel` anchors to the same variable for the same reason, and `#terminal`'s top inset adds it too.
- FIXED and **moved onto `<body>` by cc-status.js** — `_render_page` wraps a non-`full_height` page in a fixed, scrolling `.page-scroll`, and a bar meant to outlast every scroll has no business inside the thing being scrolled (reported as having to scroll up to see it).
- OUTSIDE `#terminal` — the numbers describe the session, not the part of the transcript on screen, so scrolling never takes them away. Its measured height rides in `--cc-status-h` via a `ResizeObserver` (the meta line wraps at narrow widths and the bit webfont re-wraps the title with no resize event, the same reason `--nav-h` and `--cal-h` are observed rather than hard-coded); `#terminal` restates its whole `inset` because chat-doc.css pins it with `!important`.

### 7i. The rolling title — two calls, with a deterministic floor

`api/cc_title.py`, `GET /api/cc/title`. A rolling 3-6 word haiku summary of the conversation.

**The SDK's own `summary` was tried first and is NOT enough**: on a live conversation it is usually just the opening prompt, so the bar showed the first thing typed back, verbatim. The good titles in Wai's terminal come from her own recap hook (`~/.claude/hooks/session-recap-gen.js`), which asks haiku for a 3-6 word rolling title every few prompts — this mirrors it.

**Generation runs in the SIDECAR, on the PLAN** (`claude-box/title-gen.mjs`, `POST /title-gen`, reached by `cc_client.generate_title`). It used to call the Anthropic API with the per-token key, and it is Claude Code's own subscription that should be paying to name a Claude Code conversation. Measured price of that move: **~304MB peak and ~6.9s per call**, since each one spawns a CLI subprocess — so the route is **single-flight AND yields entirely while a chat turn is in flight** (`titleBusy`, separate from `active`: a title must never take the one query slot and 429 Wai's actual message). Both refusals answer `title: null`, which lands in `cc_title` as "keep the cached one".

**The titler is a SECOND `query()` call site, and it had its own tool exposure.** Measured 2026-09-13: it was reaching the model with **`WebSearch` and `WebFetch`** — a call whose entire job is to name a conversation, holding an outbound-request tool while being fed that conversation's text. It carried `allowedTools: []`, which reads like a restriction and is not one (it means "auto-allow these without prompting"), and no `tools` option at all. It is now `tools: []` — **zero** tools, verified. Any new `query()` call site must set `tools` explicitly; there are three in the sidecar (`server.mjs`, `title-gen.mjs`, `probe-tools.mjs`) and nothing enforces it but review.

**The titler runs in its OWN cwd** (`CC_TITLE_SANDBOX`, default `<sandbox>/.titles`, created by the sidecar at startup). A `query()` call files a session transcript in the project dir for its cwd, and `/sessions` lists every session whose cwd is the sandbox — so sharing the sandbox meant each rolling title (writer + judge, twice on a retry) left 2-4 throwaway sessions in the `/list` picker, each summarised by the SDK from the transcript excerpt it carried. `/list` showed "Zekoa physical mitigation" three times seconds apart, none of them a conversation, and **20 of 61 listed sessions were titler scratch** (reported 2026-09-13). A subdir of the sandbox needs no unit change — `/srv/cc-sandbox` is already one of the two writable binds. The 20 existing ones were MOVED to `~cc-agent/.cc-titler-scratch/`, not deleted.

**It is TWO calls, not one**: haiku writes a title, then a second, independent haiku call judges whether it is title *shaped* and returns one sentence of feedback the writer gets ONE retry with. (Two writes plus two judges is already four subprocesses; the feedback loop's whole gain lands on the first retry.) A model grading its own output in the same breath talks itself into whatever it just wrote.

**A deterministic floor runs BEFORE the judge** (`shapeFault`) — word count, trailing punctuation, wrapping quotes, a preamble, generic filler, second person, a verbatim echo of a message. Measuring showed the model judge is not trustworthy alone: on a real transcript it **passed both "Chat Session" and "Sourdough"**, having quietly written its own title and graded that instead. All five bad titles in that test are caught by the floor for free, and the judge then only rules on the part no rule can check — whether the title names what the conversation is actually about.

Two more things measurement forced:
- The proposed title goes **FIRST** in the judge's prompt — trailing it after the transcript is how it lost track of which string it was grading.
- The verdict is read with **regex, not `JSON.parse`** — "reply with JSON only" produced ` ```json ` fences, a one-element ARRAY, and an object followed by a paragraph of prose. **An unreadable verdict PASSES**: a judge that cannot make itself understood must not be able to veto a good title.

The same loop, floor and parser are duplicated in the statusline hook, which cannot import from the sandboxed sidecar — **change one, change the other**.

Cached in `data/cc_titles.json` per session and regenerated every 4 messages (a conversation drifts; a title from message two is wrong by message twenty), weighted to the latest 12 messages at 400 chars each. The SDK's value is the fallback, for a deliberate rename or when generation is unavailable; it never raises, since a bar without a title is fine and a 500 is not.

**The route handler is deliberately not named `cc_title`** — a route function with the module's name rebinds it at module scope, and `cc_title.rolling_title` then resolves against the function object.

Fetched on load and again on every `cc:reply-done`, cached with the rest of the bar's state, and cleared by `/new`. Only when there is no generated title yet — a brand-new conversation — does it fall back to the transcript's opening line, user → assistant, since a conversation that opens with a wordless screenshot has an empty first user message while the reply right under it says what it is about.

With **no** title the band is `hidden` entirely (the rule restates `display: none` for `[hidden]`, the same trap `#cc-thumbs` hit) rather than showing a stand-in — a full-width band of colour saying nothing is the loudest thing on the page. The title is read from the transcript, which arrives asynchronously, so a **`MutationObserver` on `#terminal`** re-renders until there is a first line and then disconnects; without it the bar rendered before `/api/cc/history` had replayed anything and every conversation was titled empty.

### 7j. The page

`templates/cc.html` + `web/cc.{css,js}` is **the /mtg chat UI** — the shared chat stack (see CLAUDE.md § *Chat surfaces*) + marked, rendered like /mtg with NO `full_height` (chat.css owns the layout). `cc.css` is only what an AGENT transcript needs on top (`.msg.tool`/`.msg.out`/`.msg.think`, pasted images, SVG diagrams). `cc.js` reuses mtg.js's contenteditable input, caret mirror, plain-text paste and iOS first-gesture focus.

**Transport differs from every other chat surface**: SSE over POST, so `EventSource` is unusable (GET only) and frames are parsed off a fetch body reader with a streaming `TextDecoder` (a chunk boundary can split a frame mid-UTF-8). The transcript only chases the tail when the reader is already at the bottom.

**Sending a message while a run is in flight INTERRUPTS it** (`web/cc-interrupt.js`, 2026-09-14). The page used to drop the keystroke — `if (streaming) return` — which is the wrong half of the terminal idiom it copies: a run that has gone the wrong way is exactly when you most want to say something.

There is **no interrupt endpoint, and none is needed**. The sidecar already aborts a run whose caller hangs up (`req.on("close")` → `controller.abort()`, written so a browser that navigates away cannot leave a CLI subprocess resident against `MAX_CONCURRENT 1`). Aborting the fetch hangs up through the whole chain — fetch → Starlette cancels the streaming generator → httpx closes the upstream stream → node sees `close` → the SDK query aborts. One mechanism, already load-bearing, reused.

Three details the implementation turns on:
- **The slot is freed at the FAR end of that chain**, so the new run cannot simply be fired: it would race the decrement and come back `busy` — the interrupt would eat the message that caused it. `ccInterrupt()` waits for its own handler to unwind and then **polls `/api/cc/health` until the sidecar reports itself free** (4s cap; past that the send proceeds and a real `busy` renders as the line it always was).
- **The user's line lands in the transcript BEFORE the interrupt it triggers.** The wait is up to a few hundred ms of round trips, and text that leaves the composer and appears nowhere reads as a dropped keystroke.
- **An abort is not an error.** The catch renders `[ interrupted ]` (`ccStopNote`), cancels the reveal so the partial reply stops where it is, and leaves that partial standing — the way a terminal leaves the output of a job it was told to stop. `_sending` guards only the interrupt window: interrupting again mid-reply is allowed, two Enters in the same tick doing it twice is not.

**Voice deliberately does NOT interrupt** — speech heard while a reply streams is still dropped (`ccMicBusy`, §7 above). Typing is a decision; a room saying something near an open microphone is not.

`tests/test_cc_stream_browser.py` (WebKit) pins both this and the blinking cursor, with `/api/cc/query` mocked as a route that never answers — which IS the state under test, so no sidecar and no subscription run. The cursor test does not settle for "the element is there": it takes the running animation off `getAnimations()`, pauses it and **scrubs `currentTime` to each half of the period**, demanding the computed opacity actually change. It timed wall-clock samples first and that version passed alone and failed in a three-test run: **a page that is not the frontmost one has its timers throttled to ~1s**, which is the blink's own period, so every sample landed in the same phase and a live cursor read as frozen. `web/cc-input.js` (the composer: caret mirror, Enter, paste, iOS first-gesture focus) was split out of `cc.js` at the 500-line cap in the same change, and is the one cc-* file loaded AFTER `cc.js` — it touches `_msgInput` at load, and a top-level `const` in a classic script is only initialised when ITS script runs, so reading cc.js's consts from a file loaded first is a TDZ error, not a hoist.

An assistant bubble is opened up front for the typing dots and **dropped if still empty** when a tool/thinking event arrives, then reopened for later prose — otherwise a tool call landing before any text renders after an empty bubble and the transcript reads out of order.

**`dropIfEmpty()` must be idempotent** (fix landed in `0de197a`, whose message covers only the CRT work). It nulls `div`, and a turn routinely fires several drops in a row — the archive tools list then read, so `tool`, `tool_result`, `tool` — at which point the second call ran `div.remove()` on null and the whole turn died with `null is not an object (evaluating 'div.remove')`, taking the reply that was still streaming behind it. It now returns early when `div` is already gone. Pinned by driving a real two-tool turn in WebKit: 2 tool lines, 1 assistant reply, zero console errors.

**The transcript never narrates itself.** The `[ continuing — /new starts a fresh conversation ]` and `[ ready — … ]` lines are gone, and the turn/time receipt prints only when something happened (more than one turn, or 15s+ — a wait long enough to want explaining).

**That receipt is hung on the END of the reply, not given a row of its own** (`ccAppendReceipt`, 2026-09-13): it is a footnote about the answer, and a `#` sys line under every tool-using turn reads as another thing said. Inline inside the final `<p>` when the reply ends in prose, a trailing element after anything that is not (a code block, a diagram, a list — an inline tail would land INSIDE the `<pre>`), and with no reply to hang it on (a turn that was all tool calls and no text) it falls back to the sys line it used to be. It is STASHED at the `done` frame rather than rendered there: `done` can arrive while the typer is still revealing, and the settle pass rebuilds `innerHTML` from scratch, so anything appended earlier is wiped a moment later.

A sys line is for something Claude DID: a tool call, its output, or a failure. **On load the page states the sidecar's state as a `.msg.sys.warn` line** (`authed:false` → the exact login command): a logged-out sidecar answers every run with `Not logged in · Please run /login`, which reads as a broken page unless something says otherwise — that is exactly how this got reported as down.

No voice OUTPUT on /cc yet — `execVoice` (GLaDOS) is loaded on the page for monitor/nudge lines but deliberately not wired to Claude's replies.

### 7k. Hands-free input (`web/cc-mic.js`)

Wires the browser's own `webkitSpeechRecognition` — tap, talk, and the message sends itself when you stop. The recognizer is **never stopped between turns** (`continuous = true`).

**That is not a preference, it is the only shape iOS allows**: `start()` requires a user gesture and `stop()` does not, so pausing the mic is one-way and a session could never restart itself — re-opening the mic a few hundred ms after a reply is simply denied, which is exactly how the first cut failed. One tap therefore has to cover the whole session.

Speech heard **while a reply is streaming is DROPPED** (`ccMicBusy()` reads cc.js's `streaming`): the results are marked consumed via `ccMicBase` so they can never resurface glued to the next utterance, the composer is cleared, and the prompt dims to `data-drop` — a mic that looks identical whether or not it is keeping what you say is how you end up talking into a bin. `ccMicBase` exists because a continuous `e.results` accumulates every result of the session, so without a floor each utterance would resend the whole conversation.

`cc.js` still fires `cc:reply-done` on `#terminal` at the end of a turn; in a continuous session that only repaints the dot, and it is the fallback path for a browser that ends recognition per utterance anyway (where `onend` retries `start()` and, if refused, ends the session with a visible `[ mic: tap $ to keep talking ]` rather than a prompt that looks armed and is not).

It is a voice SESSION, not one dictation, and it is scoped deliberately: **a turn you TYPED never opens the mic**, because a page that starts listening on its own is one you have to remember to switch off.

**A session ends when it is tapped off, and not before** — silence does not end it, and no recognizer error does either. iOS tears the audio session down when a recognizer sits idle and the next one wakes into `onerror: audio-capture`; that was printed as a red `[ mic: audio-capture ]` line and ended the session, so a long pause read as the mic bricking. **`onerror` is now empty by design**: `no-speech`, `audio-capture` and `network` are weather, not failures, `end` follows every one of them, and the restart path there is the single place that decides what happens next.

**No `getUserMedia` track is held, deliberately.** One was, to keep iOS's audio session warm across a long silence, and it worked — but Safari gates `getUserMedia` (microphone) and speech recognition as SEPARATE permissions, so opening a voice session prompted twice, which is a worse bug than the one it fixed. The recovery path carries it alone now; if `audio-capture` becomes common again, the held stream is the fix and the second prompt is its price.

Every restart builds a **fresh recognizer** — `ccMicKill()` detaches `onresult`/`onend`/`onerror` before aborting, because an aborted instance still fires `end` and a corpse calling back into the restart path is how one dead recognizer became a mic that no tap could revive. A refused `start()` retries quietly (300ms, up to 10) and then stops **silently**, leaving an idle `$` rather than printing.

**During a session the composer is never focused** (`sendMsg` skips its `focus()` when `ccMicActive()`, and starting the mic blurs it): on a phone the keyboard is what shrinks the viewport and takes the nav bar down with it, which is absurd for an input nobody is typing into. Interim results type into the composer as you speak; the recognizer stops on silence, and `onend` does the sending so a final result and a natural stop cannot both fire it.

**The control IS the `$` prompt**, which gains `.mic` and turns into a lit `●` while listening. It does **NOT** pulse — /cc rides under the CRT stack, and an animated element beneath `.cyber-blur`/`.cyber-crt` re-fires both full-viewport backdrop readbacks every frame for as long as the mic is open; that shipped once and was reported as the page freezing in voice mode, the same trap chrome.css warns about for `.cyber-scan`. A separate button belongs at the right end of the input line, which is exactly where the Exec bubble rests (`right: 14px`, `bottom: navH + 10`) and it swallowed the taps — measured. The prompt is already a one-character cell in the shared 1ch gutter, so using it costs no width, cannot collide, and keeps the composer aligned with the transcript.

Where the API is absent (Firefox, and iOS home-screen launches have historically been flaky) the prompt stays a plain `$` and nothing is wired — a missing API costs an affordance, never a dead control.

**Two bugs shipped in the first cut, both fixed.** `onresult` iterated `e.results` with `for...of`, but **`SpeechRecognitionResultList` is array-LIKE in Safari with no `Symbol.iterator`**, so the handler threw before it could fill the composer or call `stop()` — the recognizer stayed running with its audio session hot, which is what "it never sends" was. Index loops now, the handler is wrapped in try/catch, a 20s watchdog stops a recognizer that never fires `end`, `visibilitychange` aborts one left open by backgrounding the tab, and a real error is SHOWN as a `.msg.sys.warn` line rather than swallowed (there is no console on a phone; `no-speech`/`aborted` end quietly, being ordinary outcomes of tapping and not talking). **The browser test stubs the result list as array-like on purpose** — a plain JS array would hide exactly this bug.

The keyboard's own dictation key already types into this field; what this adds is not needing the keyboard at all.

### 7l. Pictures — SVG out, screenshots in, zoom for both

**Claude can send diagrams back, via SVG.** It cannot produce raster images at all, but it writes clean SVG, so a fenced ` ```svg ` block is the one route a picture takes back from the model. `web/cc-svg.js` (loaded before cc.js, same global scope — cc.js was at 468 of the 500-line cap) swaps those blocks for the rendered diagram and keeps the markup in a collapsed `<details>`.

**The sanitiser is load-bearing.** The markdown path uses `innerHTML`, so raw SVG would EXECUTE — `<script>` runs, `on*` handlers fire, `<foreignObject>` smuggles in arbitrary HTML, an external `href` both leaks that the page was opened and hands over a fetch. **"The model wrote it" is not a safety argument**, since model output is steered by whatever Wai pastes in, including text inside a screenshot.

It is an ALLOWLIST of elements and attributes (so a new SVG element fails closed), `href` only when it starts with `#`, no `url(`/`expression(`/`javascript:` in any value, and it returns null — leaving the code block visible — rather than ever rendering something it could not clean. Pinned by an in-browser attack suite: script tag, onload, foreignObject, external image, external href, style `url()`. Authored `width`/`height` are stripped and a `viewBox` synthesised if missing, so a 620px diagram scales to a 430px phone instead of forcing a horizontal scroll.

The **system prompt tells the model it can draw** and that the canvas is a DARK terminal (light strokes, transparent background, no width/height) — without that it describes diagrams in prose instead of drawing them.

**A diagram appears the moment its block CLOSES, not when the whole reply settles** (2026-09-13). It was settle-only, so an SVG the model had finished drawing kept scrolling past as raw markup for the rest of the answer — reported as "svg not being rendered immediately, being typed out". The typer now calls `ccRenderSvgBlocks(body, ccClosedSvgCount(shown))` each frame, and **the LIMIT is the whole mechanism**: `ccClosedSvgCount` counts only fenced svg blocks whose CLOSING fence has arrived, because a half-written block either sanitises to nothing and flickers or, worse, parses as a partial drawing that is replaced a frame later. Sanitised results are cached by source text (`ccSanitizeSvgCached`) — the typer rebuilds `innerHTML` every frame, so a finished diagram would otherwise be re-parsed ~60 times a second for the rest of the reply. Verified in WebKit by revealing a reply one character at a time: the diagram renders at exactly the character that completes the closing fence, never before, the count only ever goes 0→1, a trailing ` ```js ` block is not swept in, and there are no page errors.

**Images paste in.** A screenshot paste carries an image FILE on the clipboard, so `cc.js` takes `clipboardData.files` before the plain-text path and **downscales to ~1568px in the browser** (`shrink()`, canvas) — Claude downsamples above that anyway, so full-res buys nothing and costs everything on a 1967MB box: a 3-4MB phone photo arrives ~200KB.

Thumbnails stack above the input line inside `#input-bar` (so the composer grows upward and the terminal re-anchors off `--input-h`), each with an × to drop it. **`#input-bar` is a flex ROW**, so the strip needs `flex: 1 0 100%` + `order: -1` (and `flex-wrap` on the bar) to take a row of its own instead of sitting BESIDE the input. And **`#cc-thumbs[hidden]` must restate `display: none`**, because `#cc-thumbs {display: flex}` outranks the UA stylesheet's `[hidden]{display:none}` — without it an EMPTY strip stayed a zero-width flex item and the bar's `gap` shoved the whole input line 10px right of the transcript (reported 2026-09-11; `prompt.left` went 20→30 the moment a message was sent, since that is when the strip is first created).

A string `prompt` cannot carry images, so once any are attached the sidecar hands the SDK an **async iterable of `SDKUserMessage`** instead, content = image blocks + one text block. **An image with no text is a valid message** ("what is this?"), so every emptiness check tests BOTH. Limits are guards, not the normal path: 4 images, 5MB base64 each, 24MB body. A malformed image block is DROPPED rather than failing the turn — losing one picture beats losing the message. History replays images too, because keeping the words and silently dropping the picture they were about reads as corruption. Transcript images cap at `40vh` as well as 100% width, or a tall screenshot pushes the reply it is about off a phone screen.

**Any picture in the transcript — a drawn SVG or a pasted screenshot — taps open into a zoomable overlay** (`web/cc-zoom.js`, delegated off `#terminal` so streamed-in content needs no re-binding): a diagram authored for a page puts its labels at ~6px in a 430px column with scanlines across them, so the part most worth reading is the part you cannot read.

The overlay sits at `--z-bubble`, UNDER the `cyber-*` layers (`--z-modal`) like the rest of the chrome, so the picture is on the screen rather than in front of it and the scanlines cross it; the fx are `pointer-events:none`, so every gesture still lands. It is opaque, so the transcript underneath does not read through.

Pinch to zoom (clamped **0.5–8x**), drag to pan, double-tap toggles 2.5x at the tap point, single tap closes only at fit (zoomed, a tap is how you stop a fling). **Below-fit zoom is deliberate** and pairs with `overflow: visible` on the zoomed svg: an outermost svg clips to its viewBox, a model routinely draws a label past the box it declared, and pulling back is the only way to see the ink that lands off the screen edge. The svg is fitted `width:100%; height:auto; max-height:100%` — a `height:100%` fills the screen with the svg's BOX and letterboxes the drawing inside it, which opened a wide diagram at about a sixth of the height it could use.

Same three gesture rules as the landing wheel and the /rd calendar: `touch-action:none`, the PREFIXED `-webkit-user-select:none`, and pointermove/up on WINDOW with no `setPointerCapture`.

---

## 8. `/rd` — the board and its month calendar

The board itself is `rd.json` rendered into four columns (see CLAUDE.md § *Terminology*). This section is the **month calendar** that sits under the reminders/books bars — `#rd-calendar`, built by `web/rd-calendar.js` (split out of rd.js for the 500-line cap; same global scope, loaded before it).

### 8a. The grid

Full-width Sunday-first grid of the CURRENT MONTH only, no weekday guide row, 4-6 rows emitted to fit exactly the weeks the month spans (never a spare row). Out-of-month cells are blank but keep their weekend class.

**The last column's missing right rule is keyed off a `.cal-eow` class the builder sets from the day, never `:nth-child(7n)`.** nth-child counts every child of `#rd-calendar`, so adding the `.cal-mark` watermark as the first child shifted the count by one and silently moved the rule to Friday, deleting the Friday/Saturday hairline.

Grid lines are 5px at `0.12` (per-cell right+bottom; at 1px they were lost against the scanlines), with `background-clip: padding-box` on `.cal-d` so a cell's wash never tints its OWN rules — a cell draws only its right+bottom, so under the default border-box clip a lit week ended up lit down one side and dark down the other. **`.cal-d.cw` must therefore set `background-color`, NOT the `background` shorthand**, which resets every `background-*` longhand and silently undoes that clip.

`.cal-d` needs **`min-width: 0`** or the `1fr` track's `auto` minimum lets a busy day WIDEN its own column and knock the grid out of square.

### 8b. Dots — one per card, sized by importance

Each day is the zero-padded day number (`calc(var(--fs-sm) * 1.5)` bold) over a centered row of up to 5 dots, one per card landing on that day (`scheduled_day`, else the `due_date`'s date part).

**Books and EXILED cards are excluded; archived cards still count** — they happened on their day, and erasing finished work makes a month read emptier than it was. But **only on days that have already happened**: a card finished EARLY kept dotting a day nothing would happen on, and a recurring card double-booked the future, since archiving clones the next occurrence as its own card.

**Archiving now PRESERVES `scheduled_day`** (`_apply_patch_schedule`). Leaving hq clears it, except into archives, where the move means *done* and that field is the only record of the day it actually happened; clearing it fell back to `due_date`, which is a different day for anything completed early or rescheduled. Inert elsewhere: `get_week_data` takes `column == "hq"`, the morning rollover takes `("rd", "hq")`, nudges need `decomposable()` → hq. 33 already-archived cards were backfilled from the activity log.

Each dot is painted its card's category hue (`dotColor()` in card-style.js) at full opacity — except for the two adjacent warms a 4px dot cannot separate under the phosphor wash: **Interfacing is Marigold @ 1 and Hobby is Ember @ 0.8** (`_DOT_COLOR`), splitting them by VALUE as well as hue. Both pairs were already in the palette baseline, so it adds no colour; the CARDS keep Coral.

**A dot is as wide as the card is important.** `dotUnits()` (card-style.js) maps `size` to circle-widths — wisp 1 · idea 2 · plan 3 · commitment 4, unknown/missing → idea — so a day shows its WEIGHT, not just its count. A **reminder is forced to wisp** whatever its `size` says, the same override `cardStyle` applies: it is a note that a day exists, not work, and gcal imports (`size: null`) would otherwise take the `idea` default.

A multi-unit dot is a **stadium** (two semicircles joined by a rectangle, no seam) via `--radius-pill`; `--radius-round`'s 50% is per-axis and would draw a long dot as an ellipse.

Dots never shrink (`flex: 0 0 auto`) since a squashed dot would misreport its size. A day with more dots than fit shows as many WHOLE dots as the cell holds plus a trailing **hollow silver dot** (`.cal-more` — a ring at the one-unit diameter, `--gray-hsl / 0.45`, inheriting `--cal-dot` so it tracks the dot size). It was a `+` glyph, which sat on its own baseline and broke the row's rhythm; being hued like nothing in the palette it names no card — which is the point, since it stands for the ones it cannot show.

`fitCalDots` runs after every build, and **the fit test measures the visible children's SPAN, not `scrollWidth`** — the row is `justify-content:center`, so overflow spills out both sides and `scrollWidth` reports none of it.

**A recurring card is projected forward two months** (`_RECUR_HORIZON_MONTHS`, `_advanceRecur` mirroring the server's `helpers._advance_recurrence` step-for-step incl. the month-end clamp). Only one occurrence is ever live — archiving it is what clones the next — so without projection the months ahead read empty even though a weekly series lands in them every week. Projections dot exactly like the real card; archived cards are never projected, since the past occurrences already exist as their own cards.

### 8c. Three date markers, one weight

A weekend colours its **DATE** cyan `0.8` (`.cal-d.we .cal-n` — exactly what HQ does, tinting the day name; the cell background is untouched, so an out-of-month weekend cell shows nothing, having no date to colour). A **Québec statutory holiday** colours its date **pink** `0.8` (`.cal-d.hol`, source-ordered after the weekend rule so a holiday landing on a weekend wins).

Every date sits at alpha `0.8` — green weekday, cyan weekend, pink holiday — so the three read as one row of equal weight and only the HUE carries the meaning.

One of the 7 days from today washes the cell green as TWO stacked `0.12` `linear-gradient`s (~0.23 composite). **Green's scale jumps 0.12→0.45**, and 0.45 turned the week into a solid block the dark numbers were lost on, so the stack buys a middle step with both declared alphas still on-scale. This week LIGHTENS — it is the live part of the month, lit not shadowed. The markers never composite, so a weekend inside this week just shows both.

**Today draws a bright `0.8` 1px box as a `::after` overlay** (`position:absolute; inset:0`), NOT as a border: a border override would replace that one cell's 5px grid rules, thinning the grid there and leaving the bright line riding the outer edge of a 5px band so it read as shifted ~4px right and down. At `inset:0` the overlay lays out against the PADDING box, landing exactly on the cell's visual interior. It stays **1px** while the grid rules are 5px, because today reads as today by being bright, not thick.

### 8d. Holidays are computed, not tabulated

`web/qc-holidays.js` — a computus for Easter, nth-weekday for Labour Day/Thanksgiving, "Monday strictly before May 25" for the Patriotes — so it answers for any year with no table to expire.

It carries the eight that bind a Québec-regulated worker (LNT s. 60 + the Fête nationale's own statute) and deliberately EXCLUDES Family Day, the August Civic Holiday, Boxing Day, Remembrance Day, and Sep 30 Truth & Reconciliation (federally regulated employers only — Québec has not adopted it). Victoria Day's Monday IS marked, as the Journée nationale des patriotes. **Good Friday is the Easter entry** — the statute lets the EMPLOYER choose Good Friday *or* Easter Monday, so no calendar is right for everyone.

Dates pinned in `tests/test_qc_holidays.py`.

### 8e. Drag a card onto a day to schedule it

`wireCalendarDrops`: every in-month cell carries a `data-day` and is a Sortable list in the board's own `rd` group, so dropping a card on a date is the same gesture as dropping it in a column — it just lands on a day.

The dropped day IS the due date (`POST /api/rd/{id}/schedule` → `card_schedule.drop_on_day`), and inside the 7-day window the card also goes rd→hq through `schedule_to_day`; beyond it, the due date lands alone and the card waits in r&d (a toast says so, since nothing visibly moved).

Sortable really does insert the dragged card into the cell it hovers, and a full-size card in a ~40px grid cell would grow the calendar — which moves the board under the finger mid-drag — so `#rd-calendar .cal-d > .card` is `display:none` and the cell answers with a `:has(> .card)` green `0.45` wash instead: **the lit cell IS the feedback**.

Two rules the drop leans on:
- The POST fires only AFTER the board's own `save()` resolves (`rd.js` chains `flushCalDrop` onto it). `save()` sends every card's `{column, order}` from the local array, where the dropped card still reads as the column it left, so fired concurrently it could land last and undo the promotion to hq.
- The reminders bar is excluded from the drop group (`put:` accepts only `#col-*`), because the bar's `onRemove` reads any exit as *no longer a reminder* and a chip dropped on a date would silently clear the flag too.

### 8f. Paging months, and the watermark

**Drag (mouse) or swipe (touch) sideways to page months** (`wireCalendarSwipe`, one month per gesture past a 45px threshold; drag right = previous). `calOffset` is a plain module variable, never persisted, so a page load ALWAYS opens on the present month.

Arrows point the way BACK to the present month: a past month reads `08 >>`, a future one `<< 10`, and the present month points INWARD as `> 09 <` (you are here). No year — a month is only ambiguous 12+ away, further than this is meant to be dragged. today/this-week classes key off the REAL today, so another month simply has none.

The month shows as a big glowing zero-padded NUMBER behind the grid (`#cal-mark`, green `0.12` fill + a `0.12` `text-shadow` glow, sized `min(var(--cal-h), 26vw)`).

**It is a SIBLING of `#rd-calendar`, not a child, and that is load-bearing.** `#rd-calendar` is `position:fixed` WITH a z-index, so it opens its own stacking context and a negative-z child of it can only sink behind its own content, never behind the page's `cyber-*` layers (which `/rd` pins at `-1`). As a **fixed sibling at `z-index:-2`** it lands UNDER the CRT stack — scanlines and phosphor run across it, so it reads as part of the screen — and above the page background; it tracks the calendar's band by reading the same bar-height vars. Being fixed it costs no row and cannot change `--cal-h`, which is why sizing it FROM `--cal-h` has no feedback loop.

**Three gesture rules, all load-bearing** (the same three the landing wheel and `/cc`'s zoom overlay need):
- `user-select: none` — dragging across dates selected them, and a drag off a text selection fires the native `dragstart`, which SWALLOWS the rest of the pointer stream; the gesture died mid-swipe.
- `touch-action: none`.
- pointermove/up bound to **window** with NO `setPointerCapture` — stepping rebuilds the calendar's children mid-gesture, and capturing to an element whose subtree is then replaced killed event delivery the same way.

A month with a different row count changes `--cal-h`, and `.rd-board`'s top inset is computed from it, so the board re-anchors — verified 5-row↔6-row in WebKit. Cells are otherwise inert: nothing on hover or click.

### 8g. Bar heights are observed, not measured once

The calendar's measured height rides in `--cal-h`, which `.rd-board`'s top inset adds to the bars' height. The bar heights it anchors to (`--rem-bar-h`/`--books-bar-h`) are kept live by a **`ResizeObserver`** on both bars.

Measured only at build time and on `resize`, they held a stale height after the bit webfont landed and reflowed the chips (88px for an 82px bar), leaving a dead 6px gap between the reminders and the calendar — **no resize event fires for a reflow**. Same idiom the nav uses for `--nav-h` and `/cc`'s status bar for `--cc-status-h`.

`/rd`'s `.card.plain` opaque `color-mix` fill stays (matching `/hq`) — not to keep scanlines off the cards any more (they cross them now, at reduced strength, which is the point) but so nothing behind the board bleeds up through a card.

---

## 9. The landing page — a ferris wheel, not a list

`/` is public: no auth, no exec bubble. `_landing_html()` in `routes_views.py`, styles in `web/landing.css`, driven by `web/landing-wheel.js`. Logged-in admins (valid `session` cookie) skip it and 302 to `/rd`; clicking a section follows the 401 redirect to the right login. An `admin` link sits bottom-right → `/login`.

Sections are ordered by icon hue (`_LANDING_HUE_ORDER`): recruiter · security · hosaka · graph · nightfall · printer · ui · mtg · tarot. Recruiter and security share hue 36°, security second because its blue secondary leans toward what follows. Each shows its **nav code** (`_NAV_LABELS` — the same code as the bottom nav, so nightfall reads `12AM` in both), then the thing's own **title** (`_LANDING_BLURBS`) and one plain line saying what it is (`_LANDING_DESCS`).

**What it replaced:** a full-height column of all eight that ran **1289px tall in a 932px viewport**, where `body{overflow:hidden}` silently clipped the last two sections off the bottom.

### 9a. One angle drives everything

It is a real wheel, not a styled list: the sections are **spokes `DTH` radians apart on a ring of radius R, seen EDGE-ON**.

| Quantity | Formula | Meaning |
|---|---|---|
| position | `y = R·sin θ` | where the item sits |
| depth | `1 − cos θ` | how far it has swung into the screen |
| scale | `scale = P/(P + 1 − cos θ)` | perspective shrink (`P` = 0.55, focal length over radius) |
| opacity | `opacity = cos^1.6 θ` | how square-on the spoke is |
| blur | a depth-of-field `filter: blur()` rising with `1 − cos θ` | `WHEEL_BLUR_PX` 8 at the seam |

Items stay **upright** as they travel (gondolas hang level), so the copy stays readable and the arc shows itself in the SPACING instead — slots bunch toward the rim the way seats on a turning wheel do.

### 9b. `DTH = (π/2)/K` is the load-bearing choice

`K` is how many slots it takes to reach the **seam** — where an item wraps from the bottom of the ring back round to the top. Putting the seam at exactly 90° means a spoke there is edge-on and `cos θ` is 0, so **an item is already fully transparent at the instant it teleports**: the ring closes with no pop, whatever `K` turns out to be.

**`K` is solved for, not baked in** (`wheelGeometry`, re-run on resize and by a `ResizeObserver` on every item). It walks `K` down from `ceil(n/2)` and takes the largest that neither collides the front pair nor pushes the outermost lit item's centre past `vh/2 · WHEEL_REACH` — so up to `2K−1` items are lit (capped by `n`), and "as many as will fit" is something the page works out at the size it is actually being viewed at.

**`K` may reach `n/2` but never pass it**, or two offsets would name the same item. On an EVEN `n` that lands a spoke exactly on the seam where `cos` is 0 and it is already invisible; on an ODD `n` the seam falls BETWEEN two slots, so `K` rounds UP — nothing ever rests there and an item only crosses it at a few hundredths of opacity behind ~6px of blur. **Rounding up pays twice**: it lights every item, and it narrows `DTH`, which tightens the front spacing (`R·sin DTH`) at the same time.

With the current 9 sections that is `K`=5, `DTH`=18°, and all 9 lit.

### 9c. Spacing

Only the FRONT pair can collide (furthest apart in `y`, both near full size), so clearance is measured over the pairs that really sit together, taller one unshrunk, plus `WHEEL_MIN_GAP`. The rim is allowed to bleed off both edges (`WHEEL_REACH` 1.12) because a real wheel is bigger than what you can see of it, and those items are the blurriest and faintest, so the bleed reads as depth rather than as clipping.

`R = max(vh/2 · WHEEL_FILL, need/sin DTH)`. **`WHEEL_FILL` (0.68) is the spacing knob**, but the tallest adjacent PAIR is usually what actually sets the pitch — which is why the item is `96vw` wide with a 48px icon column and the title runs at `--lh-none`: every wrapped line saved off the tallest item tightens the gaps for all the others.

Verified at 430×932 / 390×844 / 1440×900 / 1280×700: all 9 lit, front gaps 7–45px, at every one of the 9 positions. Rim pairs may touch by a px or two — they are the blurriest and faintest, and only the FRONT pair is guarded.

### 9d. The wheel genuinely turns

**Position is a float animated by `requestAnimationFrame`** (exponential settle, `TAU` 95ms, off real elapsed time so the settle takes the same wall-clock at any frame rate). The wheel turns THROUGH the arc, scale, opacity and blur sweeping the same functions on the way.

**A CSS transition would tween in a straight line between two states and flatten the arc back out** — which is why nothing here is transitioned and the script writes `transform`/`opacity`/`filter`/`visibility`/`pointer-events` inline per frame.

The blur is quantised to a **half-pixel and dropped under 1px**: a radius that changes every frame is a fresh rasterisation every frame, so a spin hands the compositor two distinct radii across four elements instead of a new value on six. WebKit at 430×932 holds a **17ms median frame through a spin, blur on or off**.

Only the RESTING position is a whole slot, so a gesture always ends snapped to an item.

| Input | Behaviour |
|---|---|
| scroll (`wheel` on window) | 60px per slot, leftover pixels kept within a gesture and dropped after 220ms idle; a hard flick carries up to 3 slots per event |
| drag / swipe (vertical) | turns the wheel **continuously at 1:1** under the finger (`wheelPitch` = `R·DTH`), snaps on release |
| arrow keys | step it |
| tap a lit item | turns the wheel to that slot FIRST, then follows the link once it lands |

The front item goes straight through; a press that travelled >8px is a drag, not a tap; and a `WHEEL_NAV_MAX_MS` timeout means a stalled rAF in a backgrounded tab can never strand the tap.

The `ResizeObserver` matters because R is derived from item heights, and the bit webfont landing re-wraps the blurbs with **no resize event firing** (same idiom as `--nav-h`).

### 9e. Three gesture details, all learned by failing

- `body` is `touch-action: pinch-zoom` — a vertical pan would otherwise be swallowed by scroll and the pointer stream would die mid-swipe.
- The wheel needs the **prefixed** `-webkit-user-select: none`. WebKit computes the unprefixed one to `text` (measured), and a drag off a text selection fires the native `dragstart`, which eats the rest of the gesture — the same trap the `/rd` calendar's month swipe hit (§8f).
- pointermove/up bind to **window** with no `setPointerCapture`.

The `.landing-wheel` box itself is `pointer-events: none` (only the lit items take taps, so the `admin` link underneath stays clickable) — which is why the gesture listeners live on `window`, not on it.

**Items scale about their LEFT edge** (`transform-origin: 0% 50%`), not their centre: every item then shares one left margin so the icons hold a clean vertical column as the wheel turns. Centre-origin is the truer projection but cascades the icon column rightward as items recede, reading as a vanishing point off to the side rather than as a wheel.

Icons are rounded (`--radius-4`); titles are `--fw-bold`.

---

## 10. The CRT effect stack (`_CRT_FX`)

Five fixed, `pointer-events:none` layers injected by `_render_page` (and by the landing and graph pages), all at `--z-modal`. Defined in chrome.css.

**Paint order = DOM order, and it is load-bearing:**

```
.cyber-bg  →  .cyber-lines  →  .cyber-blur  →  .cyber-crt  →  .cyber-scan
   static        static          cached         cached        ANIMATED
```

| Layer | What it is |
|---|---|
| `.cyber-bg` | phosphor overlay — **chatsubo** hue `--cat-social-*` filling the lit rows between the black lines @ 0.45, plus a weak centre glow @ 0.06. Static. |
| `.cyber-lines` | **static black scanlines** @ 0.45, `hard-light` — the ONE blend layer. A **thin triangle ramp** (0.25px shoulder, peak fading to transparent, NOT a hard stop), near single-frequency so it does not alias into a moiré band on zoom. Painted AFTER bg so the darkening blend **re-blacks the line rows** the green tinted. |
| `.cyber-blur` | **CRT glass** — `backdrop-filter: blur(var(--blur-2xs))` = 0.5px frost over the static bg+lines+content composite. |
| `.cyber-crt` | **CRT phosphor punch** — `backdrop-filter: brightness(0.85) contrast(1.5)` over that SAME static composite, painted right after the glass and UNDER the sweep. |
| `.cyber-scan` | sweep beam, 480px tall, same chatsubo hue @ 0.06, plain alpha. The **ONE animated layer**, painted LAST = above the glass. |

### 10a. The invariant

> A `backdrop-filter` / `mix-blend-mode` layer is a full-viewport readback with **no partial invalidation**. It is cheap ONLY when nothing under it animates (blurs/blends once, compositor caches the texture), and ruinous when it sits OVER an animated layer (re-fires every frame, forever).

So the glass caches — its backdrop is bg+lines+static content, which never animates — and the sweep is kept ABOVE it. `.cyber-scan` stays plain-alpha, because a blend mode on the animated layer is the same trap.

**The measurements behind that.** The glass was removed 2026-08-30: back then it sat UNDER the sweep, took ~45% of frame time at **1131ms/frame** in WebKit, and the page filled in **top-to-bottom** because the engine could not finish a viewport in one vsync. It was **reinstated 2026-08-31** with the scan-above-glass fix, and re-measured live at 430×932: WebKit steady-state is **16.9ms/frame WITH the glass vs 16.5ms without** — 60fps, the blur adding ~0.4ms, which is the proof that a static backdrop caches.

Also gone since 2026-08-30 and not coming back: `plus-lighter` on `.cyber-bg`, `overlay` on `.cyber-scan`.

Merging `.cyber-bg` INTO `.cyber-lines` as one hard-light element buys ~42ms more in WebKit but was **rejected**: one blend pass cannot compound the way two do, and the scanlines flatten out over text.

The `.cyber-crt` punch was tuned 2026-08-31 from `brightness(1.03) contrast(1.1)` to a **multiply feel**: `brightness < 1` darkens the unlit ground, and high `contrast` (pivot 0.5) crushes the sub-midpoint green haze toward black while the bright green text clamps at max — unlit MUCH darker, lit text held. It is a filter, not a colour, so it pops the phosphor greens and deepens the blacks without touching the palette, and it caches exactly like the glass because its backdrop never animates. Over the sweep it would re-fire every frame, the same trap.

### 10b. Zoom-lock

The scanline geometry is sized in `calc(N * var(--crt-u))` where `--crt-u = 1px * var(--crt-scale)`. `web/crt-zoom.js` (loaded via `_CRT_FX`) sets `--crt-scale = baseDPR/currentDPR` on resize, so the pattern holds a constant on-screen size across browser (ctrl/cmd) zoom. Pinch-zoom does not change DPR, so it is uncompensated.

### 10c. Dimming on the dense pages

`/rd`, `/hq`, and since 2026-09-11 `/mtg` + `/cc`, keep all five layers ON TOP at `--z-modal` like every other page, but **dimmed to 0.75 of full strength** via the shared `web/crt-dim.css` (2026-09-07, restoring the in-the-CRT look the old `z-index:-1` push had taken off the boards; the three lines lived in both rd.css and hq.css until the chat pages needed them too). It was 0.5 from 2026-09-07 until 2026-09-11.

`/tarot` deliberately stays at full strength — its CRT is the mood, and it is looked at rather than scanned.

The halving is `.cyber-bg`/`.cyber-lines`/`.cyber-scan` at `opacity: .75`, and both backdrop-filter panes pulled a quarter of the way back toward identity: glass `blur(calc(var(--blur-2xs) * 0.75))` = 0.375px, punch `brightness(0.8875) contrast(1.375)`.

**Dimmed with `opacity` rather than by rewriting the gradient alphas, because a scaled alpha lands off the palette snap scale** (half of 0.45 is 0.225, three quarters 0.3375) — the palette lint would reject it, and `opacity` is governed by neither lint.

Paint order is untouched, so the two backdrop-filters still sit UNDER the one animated layer and cache their static backdrop. A card DRAG is the one thing that dirties them per frame.

`.exec-nav` sits at `--z-top`, above the fx; the `/graph` nav override (`graph-overlay.css`) matches it. Icons scale on hover, and there is a boot-in stagger that honors `prefers-reduced-motion`.

---

## 11. `/graph` — serve-time transforms over a generated artifact

Guest-gated (Turnstile; it was public until 2026-07-03). A self-contained graphify codebase visualisation served from the `./graphify-out` volume, which `/graphify` regenerates (nightly at 05:00 — see CLAUDE.md § *Cron*).

**Everything below is a string transform applied at SERVE time, on graphify's emitted HTML/JS — never a change to the generated file.** That is the whole design: a rebuild overwrites `graph.html` wholesale, so any edit made to it would be lost the next morning. Serve-time patches survive.

`graph_page()` lives in **`routes_graph.py`** (split out of routes_views 2026-08-30 for the 500-line cap). The transforms split two ways:

- **`graph_scrub.py`** — privacy scrubs + node/edge drops (what survives)
- **`graph_style.py`** — communities/colours, hexagons, tooltips, sizes, the stats fixup (how what survives LOOKS)

chrome.css, the cyber-fx bg, the bottom nav and `web/graph-overlay.{css,js}` (nav restyle + live physics panel) are all injected at serve time for the same reason. Non-admins get the guest nav (the full nav links to login-gated pages); admins keep the full nav. Content-hash ETag + `no-cache`.

### 11a. Drops, in order

| Function | Drops | Why |
|---|---|---|
| `_redact_graph_nodes()` | node summaries in `_GRAPH_REDACT_IDS` → `[redacted]` | a few leak internals (the bearer-auth scheme, the `EXEC_SAY_KEY` name) |
| `_drop_graph_book_nodes()` | the Pollack tarot reference book (`api/tarot/book/`, ~110 nodes) | prefix `_GRAPH_DROP_SOURCE_PREFIX`, via `_sub_json_array()` |
| `_drop_graph_moltbook_nodes()` | the moltbook heartbeat plumbing (one read-only route node) | substring match on id/label/source |
| `_drop_graph_vendor_nodes()` | the vendored vis-network bundle (`web/vendor/`), by prefix `_GRAPH_DROP_VENDOR_PREFIX` | ~150 minified function nodes like `Kv()`/`_f()` graphify parsed out of the blob — noise, not our code. The `<script>` that loads the lib stays; only its parsed nodes go |
| `_drop_graph_library_nodes()` | external library/framework symbols | a code node with NO `source_file` (no in-repo definition) OR a label in `_GRAPH_LIB_LABELS` — `BaseModel`, `Request`, `WebSocket`, `FastAPI`, `Path`, `datetime`, … |
| `_drop_graph_inferred_edges()` | the dashed INFERRED edges (~16% of edges, opacity 0.35) | keeps only solid EXTRACTED relationships; thins the physics/canvas load for a faster render |

The book drop also prunes `RAW_EDGES` touching those nodes, drops their now-empty `LEGEND` rows ("Tarot Major Arcana Meanings" / "Tarot Core Framework" / "Celtic Cross Spread"), and drops the `hyperedges` (shaded narrative clusters off the book, e.g. "First-row forces gathered into the Chariot's ego") that reference any removed node. Tarot *engine* nodes stay.

The vendored bundle is ALSO excluded at ingestion by the repo-root `.graphifyignore` (`**/vendor/`, `*.min.js`, … — graphify reads it each build), so fresh graphs never carry vendor nodes; `_drop_graph_vendor_nodes()` is the serve-time backstop for a stale/cached `graph.html` built before that landed.

`_drop_graph_inferred_edges()` runs **before** the stats rewrite so the edge count is honest.

### 11b. Communities are re-derived by FEATURE

**vis cycles only a 10-colour palette**, so graphify's dozens of fine-grained communities share colours and the clusters become indistinguishable colour-noise.

`_merge_graph_communities()` regroups nodes into logically-named, FEATURE-based communities (`_logical_key`: `api/tarot/*` + `web/tarot-*.js` → "Tarot", `api/nudge*.py` → "Nudge", `api/graph_scrub` + `web/graph-overlay` → "Graph", …), giving each module its OWN distinct colour from `_COMMUNITY_COLORS` (Tableau-20 + Dark2 = 28 hues) and rebuilding `LEGEND` biggest-first, reassigning every node's `community`/`community_name`/`color`.

A feature with fewer than `_MIN_COMMUNITY` (10) nodes folds into its top-level dir bucket ("API"/"Web") so the legend is not littered with 2-node modules. Every feature is already ≤150 nodes — the cross-layer merge is what splits the old per-dir API/Web blobs.

This supersedes the old per-community rename pass, and it is `/graph`-page-only: the raw `graph.json` / `GRAPH_REPORT.md` keep graphify's full community set.

### 11c. Size, shape, tooltips, stats

`_size_graph_by_loc()` rescales every node's `size` to track its line count (file node = whole-file lines, symbol = span to the next def), read from the sibling `graph.json`'s `source_location` start lines — **no source-file reads, since most are not mounted in the container** — sqrt-compressed into ~10..40. It uses a **per-line anchored** array regex, because a non-greedy `[.*?]` truncates at a `];` inside a node title.

`_restyle_graph_nodes()` renders nodes as **hexagons** (vis default is `dot`) with a bg-filled interior + community-coloured border — the /emet look, node fill `_GRAPH_BG` `#0f0f1a`, set in `_node_color()` — and repoints `showInfo()`'s neighbour-stripe colour from `.color.background` (now the page bg, invisible) to `.color.border`.

`_drop_graph_tooltips()` strips `title:` from BOTH DataSet mappers (node + edge) so **nothing pops up on hover** — graphify puts a whole docstring-derived summary in `title`. The same text/metadata still reaches the click-through node-info panel, which reads `nodesDS`'s `label`/`_*` fields, never `title`. The regex targets the unquoted `title: x.title,`; `RAW_NODES`/`RAW_EDGES` carry it JSON-quoted, so the data arrays are untouched.

`_fix_graph_stats()` runs **last**, rewriting the `#stats` header — graphify bakes PRE-scrub node/edge/community counts — to the merged/dropped reality.

### 11d. The client-side overlay

`graph-overlay.js` does four things the server cannot:

1. Redacts any node *label* over 20 chars to `[ redacted ]`.
2. For any redacted node (server `[redacted]` or client `[ redacted ]`), `patchInfoPanel()` wraps graph.html's global `showInfo()` to blank the node-info Type + Source to "redacted" and remove the neighbors section. Community + Degree stay.
3. Reloads the page when the device wakes from sleep (interval-gap >30s → `location.reload()`).
4. `setupZoomLimits()` clamps zoom/pan with hard walls so the viewport holds roughly between 2 and half the non-orphan nodes — translating that intent into min/max scale (viewport world-area vs. node-cloud area) plus a pan box (centre clamped to the node bounding box), recomputed live, clamping in place on each user zoom/drag so the camera stops AT the threshold (no snap-back). Programmatic camera moves (tour focus) are skipped (`zoom` params.event == null).

---

## 12. The bottom nav

Fixed to every page. Labels are all **fixed 3-char codes** (`_NAV_LABELS`).

| Code | Route | Tier |
|---|---|---|
| `CD` | `/cc` | owner-only, FIRST slot |
| `R&D` · `HQ` · `DBG` | `/rd` · `/hq` · `/debug` | owner |
| `BOT` | `/security` | guest-gated |
| `GPH` | `/graph` | guest-gated |
| `UIX` | `/UI` | guest-gated |
| `12AM` | `/nightfall` | guest |
| `MTG` · `TRT` | `/mtg` · `/tarot` | guest |
| `HSK` | `/hosaka` | guest-or-full |
| `3DP` | `/printer` | guest read-only / owner control |
| `CV` | `/recruiter` | public |

The guest-gated ones (`BOT`, `UIX`, `HSK`, `3DP`, `GPH`) appear in the guest nav too.

### 12a. A non-ASCII label needs machinery that is deliberately NOT present

The pixel nav font (`04b25`, `--font-pixel`) carries **106 glyphs, ASCII only**. A symbol like `✦` (U+2726) has no glyph, so the implicit fallback picks a different face on every device.

It needs a marked class re-fonted to `--font-mono` (Iosevka has it) at a size step up, and **that rule must sit AFTER `.nav-label`** — both selectors weigh (0,2,0), so source order alone decides. A `nav-glyph` mechanism doing exactly this existed briefly for a `✦` label and was removed with it rather than left as an unexercised branch. Re-add it from this note if a glyph label ever returns.

### 12b. Standalone launch (home-screen / installed web app)

Detected by `navigator.standalone` or `display-mode: standalone` in the `_build_nav` script, which adds `html.standalone` and sets `--per-row` = ceil(item count / 2).

The nav reflows to **two rows** with one empty icon-cell of padding on each side (`html.standalone .exec-nav` in chrome.css; cell width = W/(per-row+2)).

Standalone also appends a **refresh** nav item (`#nav-refresh`, `firewall.png` padlock icon, last slot, labelled `F5`) — created in JS only when the standalone class is added (counted before `--per-row`), with no href so the link interceptor skips it, and a click handler that hard-reloads via `location.reload()`. There is no browser chrome to reload from in a home-screen launch.

The nav script also tracks the live nav height via a `ResizeObserver` (→ `--nav-h`, taller in two-row mode so pages reserving it do not hide content behind the nav) and, in standalone, intercepts same-origin link taps → `location.href` (prevents Safari kick-out).

**Keeping iOS chrome-less across navigation is the manifest's job, not the meta's.** `/manifest.webmanifest` (served by the static mount with `application/manifest+json` via a `mimetypes.add_type` in main.py; linked from `_APPLE_WEBAPP_META`) declares `scope:"/"` + `display:"standalone"`, so iOS treats in-scope page loads as in-app and hides the back/reload toolbar. **iOS reads the manifest at add-to-home-screen time only** — changing it requires deleting and re-adding the icon.

### 12c. The Exec bubble is not a nav entry

It is a floating draggable bubble (`#exec-bubble`, `guru-pink.png` glasses icon, `exec-bubble.js` + `exec-bubble-drag.js`) injected by `_build_nav()`. There is no `/exec` route. Guests get no bubble.

**On the planning routes (`/rd`, `/hq`)** it toggles the Exec chat panel. Appending `?exec=open` opens the panel expanded on load.

**On every OTHER non-guest page** the same `#exec-bubble` renders (identical look via exec-bubble.css, same drag + shared `exec-bpos` position) but a tap NAVIGATES to `/hq?exec=open` — wired by `exec-link.js`. It is a `<div>`, not an `<a>`, so a drag cannot fire a stray click; nav goes via `location.href`, which stays in-app under standalone.

The link-bubble carries `.exec-under-fx` (`z-index: var(--z-bubble)` < the fx's `--z-modal`) so it sits UNDER the CRT glass + scanlines — behind the screen, the same in-the-CRT look as the rest of the chrome. The fx are `pointer-events:none`, so the tap still lands. On `/rd`+`/hq` the interactive bubble keeps its default `--z-max`.

Bubble position persists in `localStorage` (`exec-bpos`), clamped to viewport. Unread monitor count shows as a badge on it.

(The standalone `/directives` timeline page was removed — that timeline now lives in the hq today column.)

### 12d. Exec's voice, and the panel

Exec speaks aloud in the GLaDOS voice (`exec-voice.js`, `glados`/piper over the shared HosakaAudio core), audible by default with an `#exec-mute` toggle in the panel input line (localStorage `exec.voice`, global across pages). Wai's own messages and bracketed sys notes are never spoken.

Each Exec turn's leading glyph in the panel is a clickable **replay** marker (`.msg-mark` — `>` reply / `~` monitor-nudge, built by `exec-bubble.js speakMark`); Wai's `$` and sys `#` lines get no marker.

On the planning pages the panel voices assistant replies + monitor comments + nudges. On every OTHER non-planning protected page **except /tarot and /hosaka**, `exec-voice-listener.js` loads the same player and voices the unsolicited turns (monitor comments + nudges) arriving over `/api/monitor/stream`, so a nudge narrates wherever Wai is. Audio unlocks on the first user gesture per page (browser autoplay rule).

The panel's top section is a server-persisted scratch **todo list** (`exec-todos.js`, `exec_todos.json`) — sizes to its content up to half the panel, then scrolls; an add-input at the top, a divider under the list, chat below. Items are DELETED on checkbox, distinct from rd.json cards, which archive.

**The panel's composer is exactly one text line tall**, matching the messages above it — the point of the panel is that it reads as a terminal where the prompt is simply the next line. It was 33px against an 18.6px message line (6px of row padding, plus `#exec-mute` and `#exec-ph-close` carrying their own vertical padding), so **nothing in that row may have height of its own**: `#exec-iline` has zero padding and `align-items: flex-start`, and both buttons are `padding: 0 0 0 var(--space-2)` at `--lh-tight`. Measured in WebKit: prompt, input and the assistant/user message bodies all start at x=27 with an 18.6px line box.

### 12e. Page scroll

Non-`full_height` pages (`/UI`, `/security`, `/debug`, `/mtg`, `/tarot`) scroll inside a `.page-scroll` wrapper — `_render_page` wraps `content` when not `full_height`; `position:fixed; inset:0 0 var(--nav-h) 0; overflow-y:auto` in chrome.css.

The reason is not layout preference: **the native root scrollbar is top-layer** and painted the styled pill (and its track's scanlines) OVER the fixed bottom nav's right edge. Confining the scroller to end at the nav top keeps the pill in the content area.

`full_height` pages (`/rd`, `/hq`, `/printer`, `/hosaka`) already scroll inner containers (body `overflow:hidden`) so they skip the wrapper.


---

## 13. The pre-commit hook suite

Source of truth is `scripts/pre-commit` (version-controlled); `.git/hooks/pre-commit` is a symlink to it — run `bash scripts/install-hooks.sh` to (re)install on a fresh clone. Run `bash scripts/pre-commit` manually to check before committing. Linter configs are tracked: `ruff.toml`, `eslint.config.mjs`, `.stylelintrc.json`, `package.json`.

Every check is **trigger-gated on what a commit actually stages**, so the suite stays fast.

| Check | Fires when | What it rejects |
|---|---|---|
| ruff | staged `.py` | lint |
| JS syntax + ESLint | staged templates, `web/*.js` | syntax; `max-lines-per-function: 100` |
| stylelint | staged `web/*.css` | lint |
| `scripts/lint-colors.py` | any css / web-js / template staged | a new colour or alpha (below) |
| `scripts/lint-scale.py` | any `web/*.css` staged | a raw literal on a governed property (below) |
| `scripts/lint-cachebust.py` | staged `web/*.{css,js}` | an asset edited without bumping its `?v=` |
| shellcheck | staged `.sh` | lint |
| 500-line cap | staged `.py`/`.js` | any file over the cap (`api/main.py` allowlisted pending its split) |
| no-multiline-inline-JS/CSS | templates | a multi-line inline `<script>`/`<style>` |
| fixture resolution | staged `tests/` or `api/*.py` | a stale/renamed/deleted fixture reference |
| page smoke tests | staged `api/*.py` or templates | a broken route |
| admin-tier guard | (part of the smoke tests) | a `protected` route reachable by guest/anon |

Plus a non-blocking reminder to update `CLAUDE.md`/`ARCHITECTURE.md` when source changes.

### 13a. The palette lint (`scripts/lint-colors.py`)

**The allowed `(color, alpha)` pairs are DERIVED from usage**, by the same extraction `/api/ui/usage` feeds to `/UI`, and frozen in `scripts/palette-baseline.json`. It rejects:

1. Any off-snap-scale alpha. The scale is `0/0.06/0.12/0.25/0.45/0.6/0.8/1`.
2. Any colour using more than **4 non-zero** alpha steps.
3. Any `(token, alpha)` pair not in the baseline — a new alpha for a colour, or a new colour token.
4. Any `var(--*-hsl)` not defined in chrome.css or `LOCAL_ACCENTS`.
5. Any raw colour literal (rgb/rgba/hex, or a non-token `hsl()`/`hsla()`) not in `scripts/raw-color-baseline.json` — current raw literals are grandfathered as a freeze-baseline, a NEW one is rejected.
6. Any CSS **named colour** (red/white/gold/…) in a colour property — `web/*.css` declarations and template inline `style=` — rejected outright. None exist to grandfather. `var(--green-hsl)` etc. are not misread as the colour; `transparent`/`currentcolor` stay allowed.

Every hued colour sits at ≤4 steps (e.g. `--cyan-hsl` = `0.12/0.45/0.8/1`, matching `--green-hsl`); neutrals (Silver, Smoked Glass) use fewer.

**To add a colour or alpha**: make the change, eyeball it on `/UI`, then `python3 scripts/lint-colors.py --update` to regenerate the baseline, and commit that too.

### 13b. The scale lint (`scripts/lint-scale.py`)

The SAME move as the palette lint, for every OTHER design choice.

Structural scale tokens live in chrome.css's second `:root` section: `--space-*` px steps, `--radius-*`, `--font-*` families, `--fs-*` (4 rem sizes — 2xs/sm/xl/3xl; fluid `clamp()` sizes stay bespoke), `--fw-*` (2 weights), `--lh-*`, `--tracking-*` em, `--blur-*`, `--z-*`. Border-width, duration and easing tokens were all dropped as unused — transitions and the `border` shorthand stay raw.

Every **governed** property — padding / margin / gap / border-radius / font-size / font-weight / line-height / letter-spacing / font-family — must reference a token, not a raw literal.

Allowed raw: `0`, `calc()/min()/max()/clamp()`, `%` + viewport units, CSS keywords, **`em`** (relative-by-design, left fluid for size and spacing — but letter-spacing tokens ARE em, so raw em tracking is rejected), and **negative** lengths (deliberate pull-ups).

NOT governed: border-width (it lives in the `border` shorthand), and transition/animation duration.

**`box-shadow` and `z-index` are FREEZE-governed** — there is no clean token scale to snap them to, so the current values are frozen into `scripts/scale-baseline.json` and any NEW/unseen value is rejected. A tokenised `z-index: var(--z-*)` always passes. Add a deliberate new shadow or z with `python3 scripts/lint-scale.py --update`, the same act as the palette `--update`.

It scans `web/*.css` only; inline template styles are covered by the no-inline-CSS rule.

**Snap a page onto the scale** with `python3 scripts/scale-codemod.py [file...]` (dry-run) or `--write`. The codemod is unit-aware: px↔rem convert and snap, em stays raw.

### 13c. The cache-bust lint (`scripts/lint-cachebust.py`)

A changed asset must bump the `?v=` on EVERY `api/` reference to it **in the same commit**.

Versioned static is served `public, max-age=31536000, immutable`, so an unbumped edit simply never reaches a browser that already holds the old copy. That is how `/hq`'s row layout shipped to desktop while the phone kept rendering the pre-rows `hq.css?v=17` for weeks.

`--all` audits the whole tree against git history — an asset committed later than its `?v=` last moved. **Pick a version number never used before**: reusing one a browser cached earlier busts nothing.

### 13d. The admin-tier guard (`tests/test_admin_only.py`)

Every route on `protected` must be admin-**ONLY**: refused for anonymous AND guest, and still reachable by the admin cookie. (A route that refused everyone would otherwise pass a "not public, not guest" check while being broken.)

**The route list is enumerated from the decorators, never hand-written.** A hand-written list is a denylist covering only what someone remembered, and a route added later would be silently uncovered.

Two traps it hit while being written, both worth knowing:

- **`protected` is a SUFFIX of `guest_protected`**, so an unanchored match files every guest route as admin — the same substring trap `cmdscan.py` exists for. The regex uses `(?<![\w_])`.
- **An included router's alias must resolve to its MODULE.** Nearly every route module names its router `router`, so resolving `chat_router` to the bare symbol and scanning every file swept mtg/tarot/nightfall in as admin.

**GET routes are fired over HTTP; mutating ones deliberately are NOT.** The suite runs against the LIVE container, and the one case where an unauthenticated POST does not stop at 401 is precisely the bug under test — at which point `POST /api/morning` would run the morning pipeline against real data. Those get a structural assertion instead.

SSE routes (`/api/monitor/stream`, `/api/hosaka/mode/stream`) are held open by an ACCEPTED request and answer nothing, so a timeout there means *not refused* and is read as such.

### 13e. The fixture-resolution check

`pytest tests/ --setup-plan`, run when any `tests/` or `api/*.py` is staged. It RESOLVES every test's fixture graph across the WHOLE suite without executing fixture or test bodies, so no WebKit and no live app are needed (~0.3s).

It catches a stale/renamed/deleted fixture reference *anywhere*, even when the consuming test sits behind a per-feature trigger gate — so a cross-cutting conftest rename cannot hide in an untriggered test. It skips cleanly with no pytest venv.

The **page smoke tests** themselves are HTTP over every route against the live container on :8080; they skip cleanly if it is down or the dev venv is absent, and fail+block on a broken route.

---

## 14. `/tarot` — the reading surface

Guest auth. Spread (top, fixed-height) + Pollack-voiced reader chat (bottom). Per-browser state in `localStorage`, no server persistence. The reading FLOW and its five phases are in CLAUDE.md § *Tarot reading flow*; this section is the page.

### 14a. The status bar carries what the chat no longer says

A fixed **status bar under the cards** (`#tarot-status`, styled in tarot.css) sits below the spread and above the nav; the spread/input/terminal stacks reserve `--status-h` at the bottom for it, and `#terminal` reserves `--status-h` at top.

It holds two dim credit lines, each a whole-line link — "method from 78 Degrees of Wisdom — Rachel Pollack" → the Pollack book, and "card back by u/vegetablebasket" → that reddit comment — below a single-line `#tarot-statusline` (top of the bar) showing the LATEST bracketed sys note: `set_significator`/`deal_spread` results, `reader voice unavailable`, errors.

Those used to be `.msg.sys` lines in the chat scrollback. Now `setStatus()` (tarot-view.js) writes them to the bar, latest-wins, and **the chat carries only reader/querent prose**.

**The deal turn's last two lines are likewise unrendered.** `drawSpread` still pushes the `[drew a … spread; N cards face-down]` state record and the frontend-owned flip invite ("When you're ready, turn the **Situation**.") into `messages` — the model needs the deal state and its own invite for continuity — but neither reaches the scrollback, so the chat ends on "…let me set the cards." with the face-down cards saying the rest. `isHiddenLine()` (tarot-view.js) is the shared predicate, and `tarot-chat.js`'s reload replay skips the same two, so a refresh cannot resurrect them.

The pre-reading `begin-hint` ("tap anywhere to begin the reading") centers vertically in the empty terminal — a `#terminal:has(.begin-hint)::before{flex:0}` neutralizes chat.css's bottom-anchoring flex spacer.

### 14b. Narration paces the typewriter

`tarot-voice.js`, AUDIBLE by default, works for full `session` AND `guest_session`. The reader's turn is spoken via hosaka (voice `nicole`), and the typewriter paces to **the actual audio clock**.

`tarot-chat.js` holds the text until audio starts (the reader "draws breath" behind a blinking cursor), then reveals characters on a `charWeight`-shaped schedule normalized to the measured audio duration — preserving punctuation pauses, with no drift, self-correcting off `player.elapsed()`.

The ♪ button in `#spread-controls` is a **MUTE** (volume → 0); narration still streams and still paces the typewriter. Audio failure or not-yet-unlocked falls back to the guessed-pace typewriter.

This is the one chat surface that does NOT use the shared `web/typewriter.js` engine for its main path — that engine is its SILENT fallback. See CLAUDE.md § *Typewriter*.

### 14c. Ambient music, and why the level is measured

`tarot-music.js`, ♫ toggle below the reset button. A looping background track, streamed lazily from `web/tarot-ambient.m4a` (gitignored, 58MB — **the server holds the only copy**). Starts and fades in over 4s on the first tap, from a random point.

**The bed level is baked into the file.** iOS makes `el.volume` read-only AND silences a WebAudio-routed element, so no JS path can attenuate it there. There is no ducking.

**Set that level by MEASURING dBFS, not by picking a multiplier — the usable band is narrow.** The shipping bake (`?v=3`) is the source × 0.15 = **−31.8 dBFS mean / −16.2 dB peak**. That is quiet enough to read as silent on desktop speakers (a "music isn't playing" report that was the music playing: `paused:false`, clock advancing, no media error, verified in chromium/firefox/webkit), but a 2026-09-02 re-bake at **+10 dB → −21.8 dBFS mean** overshot and drowned the reader, so v3 was restored the same day. Anything replacing it has to clear the desktop noise floor without competing with the narration, and that window is well under 10 dB.

Re-bake from `~/tarot-ambient-0.15-orig.m4a`:

```bash
ffmpeg -i <master> -af volume=NdB -c:a aac -b:a 128k -movflags +faststart
ffmpeg -i <out> -af volumedetect -f null -   # verify
```

Then bump `?v=`.

It loops via `el.loop=true` **plus** an `ended` handler that rewinds to 0 and replays — native loop can fail to restart a track seeked into a progressively-streamed m4a.

---

## 15. The nudge loop (`nudge.py` + `nudge_deadlines.py` + `nudge_loop.py`)

ADHD activation scaffolding. Every card is decomposed **prep** steps plus (when `work > 0`) one atomic **event block**. The prep back-schedules to finish at the event anchor; a nudge fires **once at the start of each step** — prep step or the event block itself ("start commuting at 6:50"). No reply just leaves that step `awaiting_reply` in silence. The frontier moves only when Wai acts, and due dates are protected behind the consequences conversation.

### 15a. Trigger and eligibility

An in-process asyncio loop (`_run_nudge_loop` in `nudge_loop.py`, lifespan-started from `main.py`, 30s tick). **No cron, no rebuild** — state lives on the cards in `rd.json`, so `--reload` restarts just re-arm. `POST /api/nudge/tick` is a manual tick.

`_eligible`: `decomposable()` (hq, not reminder/book) AND `scheduled_day == today`. **No-Rollover cards are NOT excluded** — they sit on the timeline and nudge like any other, their prep and their event block.

**Anchor** (`active_anchor`): each node's start is its back-scheduled deadline minus its own duration.

**First nudge** is the card's placement (`scheduled_day` @ `dir_start_min`). While unfired, `next_nudge_at` tracks the slot each tick.

**Fire**: decompose on first fire (one LLM call → graph + first chunk + nudge text), else nudge text for the active node. Delivered via the monitor SSE channel + `chat.json` `role=monitor` — the same pipe as encouragement comments, zero frontend.

**Failure backoff**: per-card 5-min in-memory retry delay on LLM errors; an in-flight set prevents a double fire.

### 15b. Everything in hq has a plan

Each tick, hq cards missing a graph (excluding reminders + books) get a **silent decompose** (`_build_graph` — no nudge sent) that builds the prep steps only; the event block is appended by `compute_deadlines`/`ensure_event_block`.

A card with `prep_time = 0` is **fully decomposed** — the whole `estimated_time` is broken into work steps with no event block (the decompose prompt and `ensure_event_block` both special-case prep 0). A self-task with `work = 0` is likewise all steps, no event node.

**The breakdown is a strict linear chain — never parallel.** `_linearize_chain` (nudge.py, called inside `_normalize_graph`) topo-sorts the LLM's steps by its edges, then re-chains them `step1→…→stepN`, discarding any branching. Legacy parallel graphs relinearize on their next breakdown/recalc.

The **event block** (`is_event_start:true`, `est_min = work`, label = card title) is the terminal sink every prep step points to. It is present only when `work > 0` (`nudge_deadlines.ensure_event_block`), back-scheduled so it ends at `card_deadline` (= block end) and starts at the anchor.

### 15c. The breakdown UI

Visible and editable in the card dialog (`web/card-graph.js` SVG chain, shown when `card.nudge.graph.nodes` is non-empty). Per-step label, start time (→ `tl_offset`) and estimate (`est_min`) are all editable; edits persist on dialog save, and `active_node` is recomputed client-side with the same first-open rule.

Nodes render **full-width** (single-column chain). Each step's left control stack is two circled buttons (`.cg-circ`): `✕` delete over `+` insert — the in-graph done-toggle was removed. The `+` inserts a `new step` *after* its node (`insertStep` splices `from→to` into `from→new→to`). An **entry arrow** points into the head step with a circled `+` above it to insert before the start. The chain stays linear; inserts persist via the dialog onChange.

A **breakdown** button beside the notes field (shown only for a non-book, non-reminder card with NO breakdown yet — it creates the first one; once a graph exists it hides and the breakdown-row **recalculate** button takes over) and **recalculate** both run the same rebuild: POST `/api/rd/{id}/recalc` with the current `{notes, prep, duration}`.

The hq today-column timeline renders the event block as a dashed block after the prep (`web/hq-groups.js renderSubBlock`). It drags to reschedule the occurrence — moving the whole card so the event lands at the drop, cascading the prep and retiming the due via `saveStartTime` (`wireEvent`) — and resizes to set its own duration (work), folded into `estimated_time = prep + work` by `snapMasterToSubs`.

### 15d. One nudge per step — no stall re-peel

A step nudges **exactly once**, at its start (`_due_nudge` in nudge_loop.py). If Wai does not reply, the card sits `awaiting_reply` in **silence**: the loop never re-fires or peels a smaller sub-step for that step.

The frontier advances only when Wai acts. `advance_chunk` (chat tool / timeline tap-done) marks the step done and re-arms `next_nudge_at` one stall-window out (`now + window_for`, `clamp(estimate × 2.6, 45, 240)` min) so the **next** step nudges once too. A reply-**without**-advance (any exec-chat turn) likewise re-arms the *same* step one window out via `clear_awaiting_focused` — so Wai engaging keeps the loop alive, but staying silent does not.

The old stall-peel path (`peel_sync`/`apply_peel`/`_PEEL_FLOOR_MIN`/`_stall_generate`, the whole "peel a tinier first sub-step off a stalled step" mechanism) was **removed 2026-08-28**. `window_deadline` and `redecompose_count`/`redecompose_at` are now **vestigial** fields on `card["nudge"]` — still in `default_nudge_state`, never written.

### 15e. A nudge ASKS whether the step is done; it never asserts that it isn't

`_TONE` + both prompts in `nudge_llm.py`, 2026-09-13.

**The loop has no completion data.** A fire means only that the step's slot on the timeline arrived, and Wai routinely does a step without tapping it done — so the old framing ("a task sitting untouched on today's timeline", "frame the un-started task as a clinical finding") was asserting a fact the system cannot know, and read as being accused of nothing when the thing was already finished.

The shape is now *ask whether it's done, then name the tiny first move for if it isn't*, which also makes the reply self-classifying: "done" → `advance_chunk`, "not yet" → the step. Either way the loop re-arms.

The prompt explicitly countermands `EXEC_VOICE`'s activity-log example ("The task you scheduled for 10 AM is untouched at 2 PM") — **that framing belongs to monitor comments**, which really do read the log. A nudge has none.

**Asking is not softening — the question is the weapon**, and the prompt says so explicitly, because the first cut's "you are requesting a status confirmation, not filing an accusation" read as *be nicer* and flattened the voice. Not knowing costs GLaDOS nothing and the doubt is plainly performative: extending Wai the benefit of it lands harder than an accusation, which would at least credit her with being worth the certainty.

The tone block carries five **mechanisms** to rotate rather than phrases to reuse — mock-charitable doubt, feigned ignorance as the jab, sarcastic optimism, mock scientific rigour, false comfort — with the rule that the step and the reason still land in plain words: the sass rides ON the question, never replacing the instruction.

**The previous nudge is fed in as an anti-repeat signal** (`last_nudge_text`, already stored on the card). Each nudge is an independent LLM call with no memory of the last, so "VARY it every single time" had nothing to vary *against* and the same good line recurred — two of four samples opened identically before this.

**Time-critical steps ask READINESS, not completion.** Asking whether a 6:30 departure that is still in the future is "done" reads as nonsense, so: clock + action first, then "are you ready to walk out?" The clock going first buys clarity, not a softer voice — the old prompt's "keep the warm, practical register" there fought the persona on exactly the path where it matters most.

`chat.py`'s `_active_nudge_block` handling carries the other half: a bare "yes"/"yep"/"did that" answering the question IS Wai saying the step is done, and a "not yet" is an answer, not pushback — so it must not trigger the consequences conversation.

### 15e-bis. Answering a nudge by tapping

A nudge ends on a question, and the question is the part Wai answers — so the model writes the answers as its final line, `[Sent it | Not yet | Doing it now]`, and `web/exec-choices.js` renders them as buttons under the message in the exec panel.

**Why one bracketed span**: that is already how Exec writes a sys note, and `exec-voice.js`'s `speak()` strips every `[...]` span before narrating — so the marker costs the voice path nothing and needs no second parser there.

**The regex is anchored to the LAST line and requires a `|`** (`/\n[ \t]*\[([^[\]\n]*\|[^[\]\n]*)\][ \t]*$/`), so an ordinary `[bracketed]` sys note, a markdown link, or a stray bracket mid-sentence is never mistaken for a choice row. Options cap at 4.

Tapping an answer **sends that text as Wai's own message** — the same message she would have typed — so nothing server-side has to know the buttons exist: the exec chat already reads "done" as advancing the chunk and "not yet" as an answer rather than pushback (§15e).

**Only the NEWEST nudge keeps live buttons** (`attach` calls `clear` first). An older row is a question already answered or overtaken, and tapping one would send an answer about a step Exec has since moved off. Replaying history walks oldest-first, so this leaves the buttons on the last nudge for free.

#### Card actions are the exception, and are deliberately not messages

`done` and `exile` mean exactly what the same two buttons on the card dialog mean — archive it, or drop it — so they **PATCH the card directly**. `cdDone`/`cdExile` in `card-dialog.js` do the identical `{id, column}` write to `archives` / `exile`.

Routing those through the model instead would spend a turn asking it to do something the tap already decided, and could silently not happen.

**They are appended by the CLIENT, not written by the model.** They apply to every nudge, and a model that has to remember to offer them is one that will sometimes forget.

**Only `{id, column}` is sent.** `PATCH /api/rd` merges by id, so every field the client does not own — above all the server-owned `nudge` block — is preserved. The server then does the rest on its own: clearing `scheduled_day` on exile, preserving it into archives (§8b), and reviving a recurring card. **Leaving hq also ends the nudge loop for that card**, since `_eligible` requires `column == "hq"` — nothing has to disarm it by hand.

**This is why a nudge carries its card's id** and a monitor comment does not: `_fire_nudge` passes it to both `append_monitor_comment(text, card_id=…)` and `push_to_monitor({"comment": …, "card_id": …})`, monitor messages are preserved whole by `_save_chat`, `sanitize_history_for_api` drops them entirely so the key never reaches the API, and `GET /api/chat` returns the stream raw so a page reload still gets it. A monitor comment reads the whole board rather than one card, so it gets no actions.

**A failed PATCH re-arms the button and leaves the row.** A failed tap that removed the row would look exactly like a successful one.

Pinned in `tests/test_exec_choices_browser.py`, which **stubs `fetch`** — the suite runs against the LIVE container, and a real PATCH there would archive one of Wai's actual cards.

### 15f. Due-date protection

`schedule_card` refuses to defer or unschedule an active-nudge card. `record_consequences` → `reschedule_after_consequences` is the **only** later-day path.

**Morning (4:30)**: `morning_reconcile()` re-anchors placed-today cards to a fresh first nudge at the restacked slot and disarms others to `idle` (they re-arm on their day). It never leaves a past-dated `next_nudge_at`.

### 15g. Lateness recalibration — built, and GATED OFF

`recalibration.py`. Every completion (`moved→archives`) is tagged with its `category`; late ones (`completed_late`) also carry `minutes_late` + `estimated_time` (`_log_entries_for_patch` / `_minutes_late` in `routes_api.py`).

The morning pipeline folds the day's completions into a per-category EMA `factor` (`recalibrate()`), bounded [1.0, 2.0] — late tasks push it up (∝ how late), on-time pull it back toward 1.0. `nudge._factor(card)` reads it and biases `_lead()` (reserve more time), `window_for()` (wider stall window) and `active_anchor()` (nudge earlier), so a chronically-late category starts sooner with no manual estimate change. A missing or broken store means factor 1.0 — the loop never breaks.

**`recalibration.ENABLED = False`** pending real data: `factor_for`/`recalibrate` no-op at factor 1.0.

The telemetry is **dormant**, not merely unused. The manual "late" dialog button that set `completed_late` was **removed 2026-06-29** and was its only producer, so the late branch in `_log_entries_for_patch` currently receives nothing. The telemetry (the `late`/`minutes_late` tags) accrues only when a card carries `completed_late`. `_minutes_late` and the recalibration backend stay in place, gated off. **Flip `ENABLED` on only after re-wiring a late source and accruing a sample.**

---

## 16. The Exec monitor (`monitor.py`)

Unsolicited comments after significant card activity, in Exec's GLaDOS voice (`EXEC_VOICE`, shared with chat) — backhanded observations rather than warm encouragement.

### 16a. What counts as significant

A move to archives/exile, a book-card update, or a completed decompose sub-step.

**A sub-step completes two ways, both significant:**
1. The `advance_chunk` chat tool, fired from `routes_chat._dispatch_tools`.
2. A **timeline tap-done** in the hq today column — `persistLayout` PATCHes the whole card, and `_log_entries_for_patch` emits an `advanced` log entry (carrying the card `id` + `node_id`) on any nudge node's `done` false→true transition. That is independent of the card-level diff, so a same-patch column change cannot mask it.

An `advanced` entry is **re-validated at fire time** (`_drop_undone_advanced` in `_recent_entries`): if the node is no longer done by the time the debounce fires, the entry is dropped — a step marked done then unmarked (accidental) earns no comment.

### 16b. Timing

`schedule_monitor()` runs a **60s trailing debounce**, called from `PATCH /api/rd` on a significant entry and from the chat tool dispatch on a sub-step. `POST /api/monitor/flush` bypasses the wait.

The "already-commented" boundary is the last log entry's `ts` at process start (`_init_monitor_ts`), compared **strictly (`>`)** so a `--reload`/restart never re-comments the last action.

Context for the comment = profile.json + hq cards + books-in-progress + today's schedule.

**Recurring cards.** When one is archived, a `revived` entry is also logged (the auto-cloned next occurrence). `revived` is not significant on its own, but it rides the same batch as the `moved→archives` entry, so `_entry_line` renders it as context ("'{title}' is a recurring task; the system automatically queued its next occurrence") and a system-prompt rule tells the model to read the requeue as a normal recurrence — done this round, back next time — **never as resurrection, undeath, or a clerical error**.

Subscribers receive `{thinking}`/`{comment}` via `/api/monitor/stream` SSE. The posted comment is written to `chat.json` as `role=monitor` so the exec bubble shows it on next load.

### 16c. chat.json is ONE chronological stream

Persistence lives in **`chat_store.py`** (`get_chat`/`_save_chat`/`append_monitor_comment`/`sanitize_history_for_api`/`_msg_text_key`) — split out of `chat.py` to keep both under the 500-line cap; `chat.py` keeps the prompt + tool builders.

Every stored message (conversation + monitor) carries a server-side `ts` (ISO-UTC), and the file is kept sorted by `ts` — **not** conversation-then-monitor — so the bubble renders monitor comments and nudges interleaved in time order rather than dumped at the bottom. `_save_chat` carries each conversation message's original `ts` forward by index (the convo only grows by append) and stamps new tail messages `now`; `append_monitor_comment` stamps and re-sorts.

### 16d. The orphaned-`tool_use` 400, and its two fixes

Before an Anthropic call, **both** send paths (`routes_chat.api_chat` and `discord_bot.exec_reply`) run the history through `chat_store.sanitize_history_for_api`. It flattens every stored message to text-only, role-alternating `{role, content:<string>}` — dropping the server-side `ts` (the API rejects unknown keys), all monitor lines, AND every prior-turn `tool_use`/`tool_result` block. The fresh, correctly-paired tool round is appended *after*, so only past turns flatten.

**Stripping the tool blocks is load-bearing.** An **orphaned** `tool_use` — one whose `tool_result` drifted away — makes the API 400: `tool_use ids … without tool_result blocks immediately after`.

Orphaning happened because `_save_chat`'s chronological `ts`-sort could **split a tool turn**: a `tool_use`/`tool_result`-only message has no text key, so it was stamped a fresh `now` while its paired text kept its old `ts`, floating them apart.

Fixed on both sides: `sanitize_history_for_api` guarantees the outbound sequence is valid regardless of stored corruption, and `_save_chat` now makes a keyless (structural) message **inherit the preceding message's `ts`** so a tool turn stays contiguous in storage.

---

## 17. Memory is the scarce resource on this box

1967MB RAM + **5GB of swap** (`/swapfile` 1G and `/swapfile3` 4G, both in `/etc/fstab`; `/swapfile2` was retired 2026-09-13).

**Swap is sized at 2x RAM**, the standard rule under 2GB, because the spikes here are whole processes rather than growth: a WebKit launch is 200-400MB and every CLI subprocess (a chat turn, a title call) is ~300MB, against ~650MB of available RAM at rest. The 2GB it replaced was already 1029/2047MB used with 6 OOM kills behind it, so there was no headroom left to absorb one.

`vm.swappiness` stays at the default 60 **deliberately**: most of what sits in RAM here is idle interactive sessions, and those pages belong on disk.

The 4G file is `pri=10` so new pages land there; the old 1G file is priority -2 and drains as its pages are touched. Retire it with `sudo swapoff /swapfile && sudo rm /swapfile` once it reads near 0 — **a swapoff has to fit every live page somewhere, so do it while the new file has room**.

### 17a. What the pressure actually is

**Not the test suite.** The browser suites already run serially, and `conftest.py` launches ONE WebKit for the whole pytest session, shared by every browser test.

**Not the containers** (api ~148MB, hosaka-piper ~57MB).

It is the **baseline**: measured at rest, two Claude Code sessions plus the daemon account for ~890MB (456 + 242 + 94) and tmux ~146MB, against ~180MB for the app and the sidecar combined. The top consumers are an interactive `claude` session (~400MB) and tmux (~216MB).

### 17b. The global OOM killer picks by badness score, not by culprit

That is the whole reason for the caps below. An uncapped spike shoots `dbus-daemon` or uvicorn's python instead of the process that caused it; a capped one just fails.

**The browser suites run inside `systemd-run --user --scope -p MemoryMax=700M`** (`run_capped` in `scripts/pre-commit`, falling back to a bare run where systemd-run is unavailable), so an over-budget browser fails the commit instead of taking out the site.

**The graphify post-commit rebuild was the repeat offender.** `graphify.watch._apply_resource_limits()` renices to 10 and then RETURNS WITHOUT CAPPING unless `GRAPHIFY_REBUILD_MEMORY_LIMIT_MB` is set, so it ran unbounded at ~780MB and invoked the global OOM killer — which took out `dbus-daemon` (2026-09-10) and uvicorn-side `python` three times (2026-08-31, 09-01, 09-02).

Two fixes, both applied 2026-09-10:

1. **`graphify-out/GRAPH_REPORT.md` + `graph.html` had been root-owned since Aug 22**, so every rebuild did the full work and then died at the write — never recording state, so the next run redid it all. `chown wai-root` turned a ~780MB full rebuild into a **125MB no-op**. *Check ownership first when a rebuild looks expensive.*
2. `export GRAPHIFY_REBUILD_MEMORY_LIMIT_MB=600` in `~/.zshenv` (git hooks inherit it from the invoking shell) so the rebuild dies of `MemoryError` and logs it instead of taking the site down. A failed graph is cheap; a 502 is not.

Rebuilds cannot overlap (`fcntl.flock` on `graphify-out/.rebuild.lock`).

**Ad-hoc WebKit/playwright runs are the other hazard** — MiniBrowser triggered the 2026-09-10 21:09 OOM. Wrap heavy one-offs in `systemd-run --user --scope -p MemoryMax=...` and check for strays afterwards with `pgrep -f '[M]iniBrowser'` (the bracket keeps the pattern from matching its own command line).

Check pressure with `free -m` (watch **Swap used**, not just Mem) and `sudo dmesg -T | grep -i oom`.

### 17c. Every cron job writes where both sides can see it

`data/cron/YYYY-MM-DD__<job>.log` (`morning`, `graphify`, `security`), read by `/debug`'s cron section through `GET /api/debug/cron`. **The data volume is the only filesystem both the container and the host can see, and a log nobody can see is how a nightly job fails quietly for weeks.**

**One file per JOB, not one per day**: the three writers are three different uids (container root, host root for the security refresh, host `wai-root` for graphify), and whoever created a shared daily file first would own it and lock the others out of appending.

The host cron lines therefore `mkdir -p` the directory and escape the date as `$(date +\%F)` — **a bare `%` is a newline to crontab**.

`morning_cron.sh` tees to both that file and `/var/log/exec-fn.log`, and reports **`${PIPESTATUS[0]}` rather than `$?`** — through a pipe `$?` is `tee`'s status, so the old line logged "exit 0" for every failed curl.

`morning._prune_cron_logs` keeps 30 days, as a string compare on the filename — no `stat()` per file and no clock skew between writer and sweeper.

### 17d. The nightly graphify publishes its own output

Host cron `/etc/cron.d/exec-fn-graphify` → `scripts/graphify-daily.sh`, as `wai-root`, at 05:00.

It used to run on **every commit**, which was the wrong trigger for something this heavy on a 1967MB box: dozens of runs a day. A graph a few hours stale costs nothing; a 502 does. It now sits between the 04:30 morning pipeline and the 05:10 security refresh so the three never contend. `flock`-guarded, capped at 600MB (a full rebuild measures 4089 nodes in 25s at a 366MB peak), logging to `~/.cache/graphify-rebuild.log`.

**It commits and pushes its own output** (2026-09-13). graphify-out is a generated artifact but a TRACKED one here — `/graph` serves it, and a rebuild that only ever exists on the droplet is one disk away from gone. Measured cost: **1.4 MiB of pack per night, ~0.5 GiB/year**.

**The publish step is scoped so it cannot pick up anything else.** This working tree is production and routinely carries live edits, so it stages only `graphify-out`, **refuses outright if the index already holds anything else**, and skips when the graph did not change.

cron has no ssh-agent, so the key is named explicitly (`GIT_SSH_COMMAND`) with `BatchMode=yes` — a passphrase prompt then errors instead of hanging the job until the next night skips on the lock.

A rejected push (the remote moved) is retried ONCE through a fetch + rebase, and only when the tree has no other modified tracked files — **never a stash**, which has taken the site down twice through the bind mounts. A conflict inside `graphify-out` resolves to tonight's build (`--theirs` during a rebase is the commit being replayed); a conflict anywhere else aborts and leaves the commit unpushed for a human.

**The lock is held on FD 9** rather than by `exec flock`, because an exec'd flock replaces the shell and there would be nothing left to run the publish step.

**The per-commit path is disabled by `GRAPHIFY_SKIP_HOOK=1` in `~/.zshenv`, not by deleting `.git/hooks/post-commit`** — that hook is untracked and `session-context.sh` reinstalls it, so a deleted hook comes back and an env var does not.

---

## 18. The typewriter and the shared chat surfaces

### 18a. Every chat surface reveals character by character

`web/typewriter.js`, on the engine `/tarot` has always used for its SILENT fallback: a per-character delay where punctuation is a beat (`twCharWeight`: `.` 850ms, `\n` 1100, `,` 420, ` ` 110, else 65), divided by a speed multiplier.

`/tarot` runs it at **1.25** — a reading is paced to be listened to. `/cc`, `/mtg` and the **Exec panel** run the same engine at **5**, because those are read for an answer, and **a typewriter that lags the eye is latency with a costume on**. Measured on a real /mtg reply: ~45 chars/sec at SPEED 2; the multiplier has gone 2 → 3 → 5 (2026-09-14) as the reveal kept reading slower than the eye, and at 5 the ordinary 65ms character is 13ms, still a reveal rather than a paste.

### 18b. Everything that is SYNTAX rather than prose is jumped

Markdown's markers are instructions to the renderer; typing them shows punctuation that then vanishes, and the reader watches the machinery instead of the sentence.

One place answers it — `twJump`, largest form first: a fenced block, a table opening, a link tail, an image `![alt](url)` whole (it renders as a picture; none of it is read), then the small markers — `#` heading, `>` quote, `-`/`*`/`+`/`1.` list, `---` rule (block ones only at a line start, so a dash mid-sentence stays a dash), and `**`/`__`/`*`/`_`/`` ` ``/`~~`/`[` anywhere.

Measured on a sample holding all of them: **283 chars in 150 frames**, and `Done - not a bullet, 3 * 4, a # hash.` still types as prose.

| Jump | Rule | Why |
|---|---|---|
| `twLinkTail` — a link's `](url)` tail | waits for the closing paren rather than jumping to the end of what has streamed | the label is the only part anyone reads; typing the URL spends seconds on something invisible once the link closes. Half a URL revealed and then taken back is worse than a short pause |
| `twTableHead` — a table's opening | header + separator revealed together, body rows type like prose; only at a line start | a table is only a table once its `|---|---|` is complete, so typing those two lines shows a row of raw pipes slowly becoming a table. A `|` mid-sentence would otherwise be mistaken for one |
| `twFenceEnd` — a fenced block | jumped **whole, never typed**; while still unclosed, everything available is revealed each frame | an SVG diagram revealed backtick by backtick is markup scrolling past, not a picture being drawn. Measured on an 89-char reply carrying one SVG block: **18 frames instead of 89**, the 72-char block landing in a single one |

### 18c. The waiting indicator is a solid blinking block

`#blinkcursor` / `#exec-bc` in chat-msg.css — the one `/tarot`'s reader has always had (`.reader-cursor`). **A terminal that is thinking shows a cursor, not the three pulsing dots of a messaging app.**

The dot spans the JS still builds are simply `display: none`, which is cheaper than churning three files for no visual difference, and the `blink` keyframes live in chat-msg.css so the reader and the three chat surfaces share one definition.

On `/cc` the cursor **follows the work**: dropping the empty bubble for a tool call used to take the only "still going" signal off the screen with it, so a long search looked like a page that had stopped. `park()` re-attaches it to whatever line is last until the turn actually ends.

### 18d. Tarot's other mode is not shared

`tarot-stream.js` paces the reveal off the measured audio clock (`player.elapsed()`), which needs narration to pace against (§14b).

**The state object is shared and mutable by contract** — the caller appends to `buffered` and sets `serverDone`, the engine owns `displayed` — and **each surface must await the reveal before its settle pass** (markdown + SVG on `/cc`, rule-citation linkifying on `/mtg`), since settling mid-type prints the whole reply and then types over it.

The Exec glue lives in `exec-bubble-assets.js` rather than `exec-bubble.js`, which sits at 484 of the 500-line cap.

### 18e. Four surfaces, one transcript look

`/mtg`, `/cc`, `/tarot` and the **Exec panel** are ONE look in four stacked files. They used to be three near-copies of the same forty lines, drifting a value at a time — Exec's scrollback a step tighter than /mtg's, sys lines near-invisible on one page and legible on another.

| File | Holds | Note |
|---|---|---|
| `chat-msg.css` | the vocabulary: `.msg` roles + markers, markdown inside a reply, the typing dots, the composer | **Deliberately position-free** — nothing fixed, no viewport sizing, no keyboard awareness — so the same rules work inside a panel that slides in and a terminal pinned to the window |
| `chat.css` | the full-page shell only: non-scrolling body, `#terminal` pinned to the window, `#input-bar` anchored above the keyboard | The composer is MERGED into the scrollback (transparent, no slab, no rule) for every page that loads it; that used to be an override in chat-reader.css, which left the slab variant underneath it styled but unreachable |
| `chat-doc.css` | `/mtg` + `/cc`: the document palette (softer phosphor, full-width scrollback, the `--kb-anchor`+`--input-h` terminal inset) | was the same ten lines copied into the head of both page files |
| `chat-reader.css` | `/tarot` only: the neon reader mood — glow, wide tracking, `--lh-relaxed` over the dense shared default | a reading is paced to spoken audio; the other two are read as a column of exchanges |

`chat-msg.css` is loaded by the three pages AND injected on `/rd`+`/hq` by `exec-bubble-assets.js`, **before** `exec-bubble.css` — order is the cascade, and a swap hands the pages' rules the last word over the panel's.

**One gutter.** Every line hangs its marker (`>` reply · `$` Wai · `#` sys · `~` monitor · `+` tool) in a fixed `1ch` column (`--chat-gutter`), so every body and every wrapped line starts on ONE left edge; markers used to be inline `::before` content of varying width, leaving each role at its own indent.

A surface that builds its own marker ELEMENT — the Exec panel, whose mark is a replay button — is caught by `.msg:has(> .msg-mark)::before { content: none }`, **which must sit after the role markers**: it and `.msg.assistant` weigh exactly the same (two classes), so source order is the whole of the decision, and above them it silently loses and every Exec reply opens `> >`. A markerless line (tool output, thinking, the monitor probe) indents by `--chat-indent` instead.

**Density is the point of the merge**: `--lh-tight` (1.2, added to chrome.css for this), `--space-1` between messages, `--fs-2xs` sys lines. Sys moved from alpha 0.12 to **0.45** — at 0.12 it was legible only as a smudge, which is exactly how /cc's "not logged in" got read as a broken page.

**Headless WebKit will not composite the panel's `backdrop-filter` into a screenshot.** `#exec-panel` is in the DOM, hit-tests on top, and paints nothing in the PNG. Neutralise it (`backdrop-filter:none`) in an injected style tag when verifying the panel, and **do not read a blank panel as a regression**.
