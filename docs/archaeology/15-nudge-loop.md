## 15. The nudge loop

Current design: [ARCHITECTURE.md §15](../architecture/15-nudge-loop.md).

The old stall-peel path (`peel_sync`/`apply_peel`/`_PEEL_FLOOR_MIN`/`_stall_generate`, the whole "peel a tinier first sub-step off a stalled step" mechanism) was **removed 2026-08-28**. `window_deadline` and `redecompose_count`/`redecompose_at` are now **vestigial** fields on `card["nudge"]` — still in `default_nudge_state`, never written.

**EVERY open question keeps its buttons — nothing is wiped.** `clear()` used to run at the top of `attach()` and remove every `.exec-choice-row` but the one being added, on the theory that an older question had been overtaken. It had not. A day that fires two nudges asks two real questions about two different cards, and Wai answers them when she surfaces rather than in arrival order. Wiping left exactly ONE tappable row on screen, under the NEWEST card, so a tap meant for an earlier question hit the wrong one. Measured 2026-09-16: nudges at 14:00 (climbing) and 17:57 (Lyre poster); the 23:22:59 tap meant for climbing PATCHed `craft-lyre-poster` to archives, and climbing was archived by hand from /hq 22s later. `clear()` is now a no-op, an exported leftover with no caller left.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

### 15e (2026-09-13) — why the nudge asks instead of asserts

The old framing ("a task sitting untouched on today's timeline", "frame the un-started task as a clinical finding") asserted a fact the system cannot know, and read as an accusation when the thing was already finished. The first cut's "you are requesting a status confirmation, not filing an accusation" read as *be nicer* and flattened the voice. Not knowing costs GLaDOS nothing and the doubt is plainly performative: extending Wai the benefit of it lands harder than an accusation, which would at least credit her with being worth the certainty.

`last_nudge_text` was added as an anti-repeat signal because "VARY it every single time" had nothing to vary against: two of four samples opened identically.

Time-critical steps: asking whether a still-future 6:30 departure is "done" reads as nonsense; the old prompt's "keep the warm, practical register" there fought the persona on exactly the path where it matters most.

### 15e-bis — tappable answers, history

- Bold-wrapped rows: the model reaches for bold on a line that reads like a control; the failure was silent in the worst way (row printed as raw brackets, no buttons). Prompts now say write it plain AND the parser forgives it (2026-09-15).
- `addMsg` used to parse only the `probe` role, so ordinary-turn question rows printed as brackets. A chat reply used to get answer buttons only — no card id in its payload, and guessing one would archive the wrong card. Hence the `card=<id>` cell in the row.
- Why the cell matters: "is the poster picked up?" asked in ordinary chat is answered by doing the thing, and about half the time the next action Wai wants is to mark the card done; without the cell the panel showed the question and no way to close it.
- Wiping all rows but the newest (2026-09-16) left one tappable row under the WRONG card: the tap meant for the climbing nudge archived "Lyre poster". The `[answering: "..." card=...]` reference replaced the wiping; `clear()` is now a no-op.
- Panel closing on tap: besides the detached-target click-outside bug, the bubble itself (hidden while open) and WebKit touch adjustment (~10px snap to the 29x19 composer `[x]`) both closed the panel; hence capture-phase `markOrigin` and the `#exec-term` bottom padding.
- `done` -> `archive` rename (2026-10-14): Wai tapped `done` after a step of an interview prep card and the whole card went to archives (log: `moved hq->archives source=Exec`, no `actor`, 8s after the `advanced` entry).
- `archive_card` (2026-09-15): the prompt used to say archiving was Wai's alone, so asked to mark a card done Exec answered that the lever lived on her side of the glass.
- Card actions through the model would spend a turn doing something the tap already decided and could silently not happen; a model that must remember to offer them will sometimes forget — hence client-appended.

### 15a/15d — stall re-peel removal

The old peel mechanism (re-fire and peel a smaller sub-step when a nudge went unanswered) was removed 2026-08-28; `window_deadline` and `redecompose_count`/`redecompose_at` are the vestigial remains.

### 15g — recalibration detail

Every completion is tagged; late ones carry `minutes_late` + `estimated_time`. Late tasks push the factor up (proportional to lateness), on-time ones pull toward 1.0. Gated off pending real data.

### CLAUDE.md "15-notes" dump (moved 2026-09-27) — residue not kept in section 15

Card schema note, tappable-answers paragraph and archive/exile card-action paragraph were moved verbatim from CLAUDE.md; their content is now folded into §15a (field table), §15e-bis. Two measured/dated details kept only here:

- The stale-wiping incident above (2026-09-16).
- Pinned by `tests/test_exec_bubble_overlap_browser.py` (overlap/tap-guard).


---

