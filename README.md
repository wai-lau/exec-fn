# exec-fn

A self-hosted personal assistant that fights ADHD task-paralysis. FastAPI
app, an LLM runs the planning pipeline, and it talks back in a GLaDOS
voice. Live at [wai-lau.net](https://wai-lau.net).

Three parts: a task board, a day-planner timeline, and a nudge loop that
breaks a task into steps and prods you through them. One LLM pipeline
handles the reasoning, the scheduling and the voice.

---

## What it does

| Piece | What it does |
|-------|--------------|
| **R&D board** (`/rd`) | Cards with category, importance, time estimates, recurrence |
| **HQ** (`/hq`) | 7-day planner. Drag cards onto a today-timeline with real time blocks |
| **Nudge loop** | Splits a task into prep steps that back-schedule to finish before the event, then nudges you once at each step's start time. Moving a due date means answering "what happens if this slips?" first |
| **Morning pipeline** | 4:30 AM cron. Retrospective over yesterday, pulls durable facts into a long-term profile, imports GCal, restacks the day |
| **Exec voice** | Every reply is read aloud in a GLaDOS register over a streamed TTS backend |
| **Side apps** | A Magic: The Gathering rules assistant, a tarot reader in Rachel Pollack's voice, and an embedded browser RPG |

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI (Python 3.12), single composition root |
| LLM | A hosted API. A large model for reasoning, a small one for cheap classification |
| Frontend | Server-composed HTML and vanilla JS modules, no SPA framework |
| Deploy | Docker (cron + uvicorn) behind nginx on a DigitalOcean droplet |
| State | JSON files on a bind-mounted volume, no database |

## Engineering notes

- Commits run through ruff, ESLint, stylelint and shellcheck, plus a palette
  linter that rejects off-scale colours, a 500-line cap per file, a 100-line
  cap per function, and HTTP smoke tests over every route against the live
  container.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) has the Mermaid UML: deployment, the
  module graph, and the morning pipeline sequence.
- No SPA and no database. State is plain JSON, pages are composed
  server-side, and both hot-reload from a volume mount.

> Personal project. Code is public to read, not packaged for reuse.

[![The /graph page](docs/graph.webp)](https://wai-lau.net/graph)
