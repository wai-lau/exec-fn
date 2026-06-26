# exec-fn

**A self-hosted personal assistant that fights ADHD task-paralysis** —
a FastAPI app where Claude runs the planning pipeline, voiced by GLaDOS.
Live at **[wai-lau.net](https://wai-lau.net)**.

It is a task board, a day-planner timeline, and an autonomous "nudge"
loop that breaks tasks into steps and prods you through them — wired to
a single Claude pipeline that does the reasoning, scheduling, and voice.

---

## What it does

| Piece | What it does |
|-------|--------------|
| **R&D board** (`/rd`) | Cards with category, importance, time estimates, recurrence |
| **HQ** (`/hq`) | 7-day planner — drag cards onto a today-timeline with real time blocks |
| **Nudge loop** | Decomposes a task into a dependency graph, nudges you at its slot, peels a *smaller* first step when you stall, and guards due dates behind a "what happens if this slips?" conversation |
| **Morning pipeline** | 4:30 AM cron: retrospective over yesterday, durable-fact extraction into a long-term profile, GCal import, day restack |
| **Exec voice** | Every assistant turn is spoken aloud in a GLaDOS register over a streamed-TTS backend |
| **Side apps** | A Magic: The Gathering rules assistant, a Pollack-voiced tarot reader, and an embedded browser RPG |

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI (Python 3.12), single composition root |
| LLM | Claude (Opus for reasoning, Haiku for cheap classification) |
| Frontend | Server-composed HTML + vanilla JS modules, no SPA framework |
| Deploy | Docker (cron + uvicorn) behind nginx on a DigitalOcean droplet |
| State | JSON files on a bind-mounted volume — no database |

## Engineering notes

- **Pre-commit discipline**: ruff, ESLint, stylelint, shellcheck, a custom
  palette linter (no off-scale colors), a 500-line/file + 100-line/function
  cap, and HTTP smoke tests over every route against the live container.
- **Architecture** is documented as Mermaid UML in
  [`ARCHITECTURE.md`](ARCHITECTURE.md) (deployment, module graph, the
  morning pipeline sequence).
- No SPA, no database — state is plain JSON, pages are composed server-side
  and hot-reloaded from a volume mount.

> Personal project. Code is public to read; not packaged for reuse.
