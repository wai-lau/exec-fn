## 3. Morning pipeline + scheduling

Current design: [ARCHITECTURE.md §3](../architecture/03-morning-pipeline.md).

  A save landing in the same millisecond as the read that seeded the `_load_json` mtime cache left the stale PRE-save board being handed to the next load. Two quick cycles — a
  chat tool archiving a card, then re-reading it — saw the card back in the
  column it started in (found 2026-09-15 by `test_archive_card.py`, where a
  second archive of the same card re-cloned its recurrence).

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **2026-10-06**: before `_post_morning_errors`, a failing morning step (gcal `invalid_grant`) was visible only in `/debug`'s cron log.
- **2026-09-27**: CLAUDE.md was thinned to an index; its card-schema notes (`dir_start_min`, `prep_time`, rd.json concurrency) were moved into ARCHITECTURE.md §3 as "3-notes" and are now folded into §3b and the concurrency section. The `prep_time` UI box once labelled "event" was renamed "duration" (field UI only). `prep_time = 0` became "fully decomposed, no event block" (the protected event block exists only for a card reached through prep).
- Earlier text in the Exec call chain mentioned only `schedule_to_day` from "HQ drag"; the drag path is actually `PATCH /api/hq` with `clamp_to_window=True`.


---

