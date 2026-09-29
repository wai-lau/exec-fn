# Plan: merge /cc and Exec onto the subscription

Agreed with Wai 2026-09-27. Move to `.archaeology/plans/` when done.

## End state

One agent, **Exec**, running on the `/cc` sidecar (`claude-box/`) on Wai's Claude
subscription. Two doors: the `/cc` page and the Exec panel on `/rd` + `/hq` — one
shared conversation. A new chat starts every morning at 4:30.

## Decisions

| Question | Answer |
|---|---|
| Which LLM calls go on the subscription? | Everything, unless clearly not allowed. |
| What is clearly not allowed? | Calls a GUEST triggers: `/api/tarot/chat`, `/api/mtg/chat`, and live tarot openings. They stay on `ANTHROPIC_API_KEY`. Basis: Agent SDK docs ("Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products") + Consumer Terms ("may not make your Account available to anyone else"). |
| Grey area | Consumer Terms forbid "automated or non-human means… except… where we otherwise explicitly permit it". Owner-only unattended jobs run through Claude Code's documented headless mode; treated as permitted, not confirmed. |
| Discord | Incoming DMs turned off (one-line "use the panel" reply). Outgoing nudge/comment DMs stay. |
| Subscription limit hit | Skip the call, tell Wai, manual retry. No auto-retry, no API-key fallback. |
| Persona | Exec's GLaDOS voice replaces /cc's caveman persona. |
| Tarot openings | Canned clips on the subscription, one per half hour, with the Montreal forecast. Served to Wai and Montreal-area visitors; everyone else gets a live opening (API key) with their own city's weather. |

## Phases

(2026-09-29, beyond the plan: the `/cc` page itself was removed and its features moved into the Exec panel — ARCHITECTURE.md §7g. "Two doors" is now one.)

1. **Exec's card tools in the sidecar.** `claude-box/exec-tools.mjs`, an in-process MCP server like `archive-tools.mjs`. Each tool calls owner-only `POST /api/exec/tool/{name}` (runs `chat_tools._handle_tool`), authenticated with the sidecar's shared secret. Schemas served once from `chat._chat_tools()` via `GET /api/exec/tools`. Update `ALLOWED_TOOLS` and the probe (14 -> 24; a cold probe shows 22). **Done 2026-09-27.**
2. **Personality.** `EXEC_VOICE` + `_CHAT_STATIC_PREFIX` become the sidecar system prompt. The per-turn context (today, the board, open nudges) is built by the container and put at the top of each user message, so the system prompt stays byte-stable. **Done 2026-09-28** (`api/exec_context.py`, `GET /api/exec/prompt`, `<exec-context>` block stripped by the sidecar's `historyFor`).
3. **Exec panel on the sidecar.** `exec-bubble.js` -> `/api/exec/query` (adds the per-turn block, relays `/api/cc/query`); history from `/api/cc/history`; tool frames hidden in the panel. Retire `chat_passes.py` after first reproducing the fake-"Added X" failure against the SDK path. **Done 2026-09-28** — panel on `/api/cc/query` + `/api/cc/exec-history` (the per-turn block was already added by `/api/cc/query`, so no `/api/exec/query`); the repro did NOT reproduce (both action turns made real calls), so the panel has no two-pass guard; `chat_passes.py` stays for Discord until phase 4.
4. **Daily new chat.** The 4:30 morning run calls the sidecar's `/new` instead of clearing `chat.json`. Past days stay in `/list`. Discord inbound off.
5. **Background calls on the subscription.** New sidecar `POST /complete` (`{system, messages, model, schema?}`), no tools, own single slot, memory-capped. `api/llm.py` becomes the one caller for `nudge_llm`, `monitor`, `morning` + `chat._dedupe_context`, `card_llm` (classify + parse_date), `gcal._haiku_classify_batch`, tarot openings. Confirm the SDK supports schema/JSON output before moving the structured calls. Measure classify/parse_date latency before and after.
6. **Failure handling.** `llm.py` catches failures, asks the sidecar's `/limits` for the reset time, writes `data/llm_failed.json` (what, why, reset), and pushes a fixed-text notice through the monitor feed, e.g. `[nudge for "Lyre poster" skipped — subscription limit, resets 14:20]`, with a **retry** button (`POST /api/llm/retry/{id}`). `/debug` lists pending failures.
7. **Tarot openings.**
   - Weather: Open-Meteo hourly forecast (no key); Montreal = 45.50, -73.57, `America/Toronto`; each slot takes the nearest hour, rendered as plain words.
   - Nightly (existing 5:45 loop): regenerate all 48 half-hour slots, 06:00 today -> 05:30 tomorrow, ~6 opus calls of 8 slots, then 48 narrations on the home box. Stale clips deleted, never replayed. Home box down -> slots stay empty -> live fallback + a phase-6 notice.
   - Prompt: replace "let the weather of the room say it" with the real forecast, never stated as a report.
   - Storage keys `s0600`, `s0630`, …; client asks `?slot=` (its local time floored to :00/:30). Retire `TARGET_PER_HOUR` and the hourly top-up.
   - Visitor location, no prompt: local IP-geo database on the droplet (DB-IP Lite or GeoLite2, monthly cron refresh); the IP never leaves the box and is never stored. Cross-check / fallback: the browser's `Intl` time zone.
   - Routing: Wai, or visitor within ~50km of Montreal (or DB miss + Montreal time zone) -> canned clip. Elsewhere -> live opening with their city's forecast + local time. Unknown -> live opening, no weather.

## Risks

- **Memory.** Each call is a ~300MB CLI process against ~650MB free. One chat slot + one background slot, background memory-capped.
- **Latency.** Card classify and date parse get slower (process start per call). Measure.
- **Shared limit.** Exec shares the 5-hour window with Wai's own Claude Code use; exhaustion -> skipped calls + notice.
- **Prompt injection** via a fetched page could archive/exile cards (recoverable).
- **Same opening per half hour** for every canned-clip visitor, including repeat visits.

Estimate: ~4.5 days.
