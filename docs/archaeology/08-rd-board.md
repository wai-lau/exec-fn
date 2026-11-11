## 8. `/rd` — the board and its month calendar

Current design: [ARCHITECTURE.md §8](../architecture/08-rd-board.md).

**The last column's missing right rule is keyed off a `.cal-eow` class the builder sets from the day, never `:nth-child(7n)`.** nth-child counts every child of `#rd-calendar`, so adding the `.cal-mark` watermark as the first child shifted the count by one and silently moved the rule to Friday, deleting the Friday/Saturday hairline.

The reminders bar shows what is **inside a 30-day window** (plus any `pinned_reminder`); everything further out is counted into a `+N` button that opens the full list. The button is `position:absolute` and was appended to `bar.firstElementChild`, i.e. to the first visible chip — so on a board whose reminders are ALL beyond the cutoff, `visible` is empty, there is no first chip, and the button was silently never created. `body.has-reminders` is keyed off `all.length`, not `visible.length`, so the bar still rendered: a blank strip with 38 reminders behind it and no way to reach them (2026-09-21 — birthdays run months ahead, so this is the board's normal state, not an edge case).

`buildBooks()` had already solved it — when nothing is visible it creates an **empty chip** to host the button — and `buildReminders()` now does the same. A bar's `+N` must never be parented to content that may not exist.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Grid lines.** At 1px they were lost against the scanlines; at 0.12 alpha with 1px rules the month lost its grid, so the weight lives in the border width (5px), not the alpha scale.
- **Archive preserving `scheduled_day`.** Clearing it fell back to `due_date`, a different day for anything completed early or rescheduled. 33 already-archived cards were backfilled from the activity log.
- **Dot colours.** Interfacing = Marigold @1, Hobby = Ember @0.8 (palette names for `--orange-hsl` / `--orange-glow-hsl`).
- **`.cal-more`.** Was a `+` glyph, which sat on its own baseline and broke the row's rhythm.
- **Week wash.** Green's scale jumps 0.12→0.45; 0.45 turned the week into a solid block the dark numbers were lost on. The week used to read as a shadow, now lit.
- **Today box.** A border override replaced that one cell's 5px rules, thinning the grid there and leaving the bright line riding the outer edge of a 5px band so it read ~4px right and down.
- **`.cal-eow`.** Adding the `.cal-mark` watermark as first child shifted `:nth-child(7n)` onto Friday.
- **Swipe.** Dragging across dates selected them; a drag off a text selection fires native `dragstart` which swallowed the rest of the pointer stream. Capturing to an element whose subtree is replaced killed event delivery. Verified 5-row↔6-row in WebKit.
- **8g.** Measured only at build time and on `resize`, bar heights held a stale value after the bit webfont landed (88px for an 82px bar), leaving a dead 6px gap. `.card.plain` fill: scanlines now cross cards at reduced strength, which is the point.
- **8h.** A board whose reminders all lie past the 30-day cutoff (birthdays run months ahead) rendered a blank bar with no way in; `showRemOverflow()` once lacked the `!c.pinned_reminder` term, so a pinned far-future reminder showed on the bar AND in the `+N`.

### 8-notes. From CLAUDE.md (moved 2026-09-27) — verbatim

**[Pages → /rd]**

`/rd` — R&D board from `rd.json` — the four columns, the reminders + books bars, and under them a minimal **month calendar** (`#rd-calendar`, built by **`web/rd-calendar.js`**, split out of rd.js for the 500-line cap; same global scope, loaded before it). The calendar is the current month only, each day showing the zero-padded date over up to 5 dots — one per card landing on that day, hued by category and **as wide as the card is important** (`dotUnits()`: wisp 1 → commitment 4), with a hollow silver `.cal-more` ring standing for any that don't fit. Books + exiled are excluded; **archived cards still count, but only on days already past**, and archiving PRESERVES `scheduled_day` (`_apply_patch_schedule`) since that is the only record of the day the work actually happened. Recurring cards are projected 2 months forward (`_advanceRecur`), because only one occurrence is ever live. Weekends tint their date cyan, Québec statutory holidays pink (`web/qc-holidays.js` — **computed, not tabulated**, so it answers for any year), this week washes green, today draws a bright 1px `::after` box. **Drag a card onto a day to schedule it** (`wireCalendarDrops` → `POST /api/rd/{id}/schedule`); drag/swipe sideways to page months (`wireCalendarSwipe`). Three things bite anyone touching this: any gesture surface here needs `touch-action:none` + `user-select:none` + pointermove/up on **window** with NO `setPointerCapture` (a native `dragstart` or a rebuilt subtree otherwise eats the gesture mid-swipe); bar heights (`--rem-bar-h`/`--books-bar-h`/`--cal-h`) are kept live by **`ResizeObserver`**, since no resize event fires for a webfont reflow; and `#cal-mark` must stay a fixed SIBLING of `#rd-calendar` at `z-index:-2` to sit under the CRT stack.

**[API → POST /api/rd/{card_id}/schedule]**

POST `/api/rd/{card_id}/schedule` — Drop a card on a /rd calendar day. Body `{date}`. The day becomes the `due_date` (an existing clock time survives — a 7pm concert dragged to another day stays 7pm, so `scheduler.timed_start_min` still pins its block); in-window it also goes rd→hq via `schedule_to_day`, beyond the window the due date lands alone. Reminders + books are dated but never scheduled; a card dragged out of archives/exile returns to rd first. 409 when an active nudge loop would be deferred (consequences first), 400 on a bad date, 404 unknown card. Pushes `{cards_changed}` so an open /hq refetches.


---

