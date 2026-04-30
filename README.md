# exec-fn ヽ(・∀・)ﾉ

> ADHD scaffolding for Wai. Claude runs the planning pipeline.

---

## what is this (｡•̀ᴗ-)✧

A personal productivity server that lives on a DigitalOcean droplet and helps me not fall apart.
Claude (Sonnet) wakes up at **4:30 AM** every day, reviews what happened, writes durable facts into
a profile, and clears the slate for the new day. The rest is a web app I actually use.

```
                    ┌─────────────┐
                    │  nginx SSL  │  wai-lau.net
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   FastAPI   │  port 8080
                    │  main.py    │
                    └──────┬──────┘
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼───┐  ┌────▼───┐  ┌────▼────┐
         │ kanban │  │  chat  │  │ prophec │
         │rd.json │  │ Claude │  │  ies    │
         └────────┘  └────────┘  └─────────┘
```

---

## pages (っ˘ω˘ς )

| route | vibe |
|-------|------|
| `/rd` | core kanban — the whole board |
| `/exec` | terminal chat with Claude for planning |
| `/prophecies` | 6-day planning view — where things go |
| `/directives` | today's timeline — drag & resize blocks |
| `/debug` | profile notes + activity log spelunking |
| `/nightfall` | a little game (semi-public) |
| `/mtg` | MTG rules assistant (semi-public) |

---

## morning pipeline ☆ミ(o*・ω・)ﾉ

every day at **4:30 AM ET**, inside the docker container:

```
activity_log.json
       │
       ▼
  📖 Sonnet reads the day
       │
       ▼
  🧠 extracts durable facts → profile.json
       │
       ▼
  🧹 Haiku purges expired notes
       │
       ▼
  📦 archives the log → activity_log_MMDD.json
       │
       ▼
  💤 chat.json cleared, new day begins
```

---

## stack (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧

- **FastAPI** — routes + API
- **Docker** — single container, `TZ=America/New_York`
- **nginx** — SSL termination, bare-metal
- **Claude Sonnet** — morning retrospective + exec chat
- **Claude Haiku** — cheap checks, date parsing, card classification
- **Google Calendar** — event import via OAuth
- **DigitalOcean** — NYC1 droplet, `168.144.13.51`

---

## card schema (≧◡≦)

```json
{
  "id": "card-<timestamp>",
  "title": "do the thing",
  "column": "rd | hq | archives | exile",
  "category": "Interfacing | Hobby | Social | Self | Book",
  "size": "chore | task | project | titan | book",
  "due_date": "YYYY-MM-DD",
  "estimated_time": 30,
  "notes": "...",
  "recur_type": "week | bi-week | month | holiday | birthday | null",
  "scheduled_day": "YYYY-MM-DD or null",
  "is_reminder": false
}
```

cards live in `rd.json`. when a recurring card is archived, a clone rises from the ashes
with the due_date advanced. ✧*。٩(ˊᗜˋ*)و✧*。

---

## columns explained (´• ω •`)

| column | vibe |
|--------|------|
| `rd` | backlog — the pile |
| `hq` | active working set — what I'm actually doing |
| `archives` | done! gone! proud! |
| `exile` | won't do. goodbye. |

---

## dev notes (￣ω￣)

**template changes** → live immediately (read from disk per request) ٩(ˊᗜˋ*)و

**python changes** → need docker cp + restart:
```bash
docker cp api/main.py exec-fn-api-1:/app/main.py
docker compose -f /exec-fn/docker-compose.yml restart api
```

**before every commit:**
```bash
~/.local/bin/ruff check api/pipeline.py api/main.py
.git/hooks/pre-commit  # checks JS syntax in templates
```

---

## models (ﾉ´ヮ`)ﾉ*: ･ﾟ

| model | job |
|-------|-----|
| `claude-sonnet-4-6` | main reasoning, morning pipeline, exec chat |
| `claude-haiku-4-5-20251001` | cheap checks, merges, date parsing |

---

*built with love and executive dysfunction* (╥﹏╥)
