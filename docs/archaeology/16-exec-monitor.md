## 16. The Exec monitor

Current design: [ARCHITECTURE.md §16](../architecture/16-exec-monitor.md).

Orphaning happened because `_save_chat`'s chronological `ts`-sort could **split a tool turn**: a `tool_use`/`tool_result`-only message has no text key, so it was stamped a fresh `now` while its paired text kept its old `ts`, floating them apart.

Fixed on both sides: `sanitize_history_for_api` guarantees the outbound sequence is valid regardless of stored corruption, and `_save_chat` now makes a keyless (structural) message **inherit the preceding message's `ts`** so a tool turn stays contiguous in storage.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

### Exec's own changes (2026-09-29)

Once the panel moved onto the sidecar, Wai saw Exec call `advance_chunk`, report it, then a minute later comment on its own step ("One message sent. Three steps... still waiting"). The old `MONITORED_TOOLS` hook that scheduled the monitor after a tool call is gone; `actor` marker replaced it.

### Watermark advance

The watermark used to advance BEFORE the LLM call, so any failure (429/529/timeout, routine for a live external API) permanently dropped that batch's entries: they were already older than the new watermark on every later `_recent_entries()` call, with no retry and no visible sign of loss. Now advanced only on success.

### Orphaned tool_use

Orphaned `tool_use` (its `tool_result` drifted away) -> API 400 `tool_use ids … without tool_result blocks immediately after`. Two fixes: `sanitize_history_for_api` flattening, and `_save_chat` keyless-message `ts` inheritance so the sort cannot split a tool turn apart in storage.

### CLAUDE.md "16-notes" dump (moved 2026-09-27)

`/api/monitor/stream` payload list: `{thinking}` / `{comment}` plus `{cards_changed:true}` when a server-side mutation (morning rollover, nudge advance/decompose, discord tool round, web exec tool round — every tool but `update_context` writes `rd.json`, and the panel lives ON /rd + /hq so a card it archives has to leave the board under it) rewrites `rd.json`.


---

