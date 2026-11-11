# exec-fn — Archaeology

The past: bugs that have already been fixed, choices made and then reversed,
measurements taken once, and mechanisms that no longer exist.

**Why it is kept.** Every entry here cost somebody a day to find. Knowing that
`/graph`'s "groups of four" was a double quantisation, or that an unpinned
`httpx` once 502'd every route on the box, is what keeps the second occurrence
from taking as long as the first. None of it describes how the system works
today — [`ARCHITECTURE.md`](ARCHITECTURE.md) is for that.

**Sections mirror ARCHITECTURE.md**, so §11 is `/graph` in both files. A section
absent here has no recorded history yet.

**The split is by a paragraph's primary claim.** A standing rule lives in
ARCHITECTURE.md even where it names the incident that produced it; the incident
itself lives here. Text is moved verbatim.

---

## Sections

Each `## N.` section lives in its own file under `docs/archaeology/`, text
moved verbatim (2026-11-10, the 500-line cap). This file is the index:
every `§N` reference still resolves here, then one click to the file.

| § | Topic | File |
|---|---|---|
| 1 | Deployment | [`docs/archaeology/01-deployment.md`](docs/archaeology/01-deployment.md) |
| 2 | Module graph | [`docs/archaeology/02-module-graph.md`](docs/archaeology/02-module-graph.md) |
| 3 | Morning pipeline + scheduling | [`docs/archaeology/03-morning-pipeline.md`](docs/archaeology/03-morning-pipeline.md) |
| 4 | TTS (text-to-speech) | [`docs/archaeology/04-tts.md`](docs/archaeology/04-tts.md) |
| 5 | LLM call sites + prompt caching | [`docs/archaeology/05-llm-calls.md`](docs/archaeology/05-llm-calls.md) |
| 6 | Printer (ELEGOO Centauri Carbon) | [`docs/archaeology/06-printer.md`](docs/archaeology/06-printer.md) |
| 7 | `/cc` — the Exec panel's agent | [`docs/archaeology/07-cc-exec-agent.md`](docs/archaeology/07-cc-exec-agent.md) |
| 8 | `/rd` — the board and its month calendar | [`docs/archaeology/08-rd-board.md`](docs/archaeology/08-rd-board.md) |
| 9 | The landing page | [`docs/archaeology/09-landing-page.md`](docs/archaeology/09-landing-page.md) |
| 10 | The CRT effect stack (`_CRT_FX`) | [`docs/archaeology/10-crt-effects.md`](docs/archaeology/10-crt-effects.md) |
| 11 | `/graph` | [`docs/archaeology/11-graph.md`](docs/archaeology/11-graph.md) |
| 12 | The bottom nav | [`docs/archaeology/12-bottom-nav.md`](docs/archaeology/12-bottom-nav.md) |
| 13 | The pre-commit hook suite | [`docs/archaeology/13-pre-commit-hooks.md`](docs/archaeology/13-pre-commit-hooks.md) |
| 14 | `/tarot` | [`docs/archaeology/14-tarot.md`](docs/archaeology/14-tarot.md) |
| 15 | The nudge loop | [`docs/archaeology/15-nudge-loop.md`](docs/archaeology/15-nudge-loop.md) |
| 16 | The Exec monitor | [`docs/archaeology/16-exec-monitor.md`](docs/archaeology/16-exec-monitor.md) |
| 17 | Memory is the scarce resource on this box | [`docs/archaeology/17-memory.md`](docs/archaeology/17-memory.md) |
| 18 | The typewriter and the shared chat surfaces | [`docs/archaeology/18-typewriter-chat.md`](docs/archaeology/18-typewriter-chat.md) |
| 19 | `/zombo` | [`docs/archaeology/19-zombo.md`](docs/archaeology/19-zombo.md) |
| 20 | Pages and subsystems without a section of their own | [`docs/archaeology/20-other-pages.md`](docs/archaeology/20-other-pages.md) |
| 21 | noodle — moved to its own repo | [`docs/archaeology/21-noodle.md`](docs/archaeology/21-noodle.md) |
| 22 | /spire — moved to its own repo | [`docs/archaeology/22-spire.md`](docs/archaeology/22-spire.md) |

## 1. Deployment

→ [`docs/archaeology/01-deployment.md`](docs/archaeology/01-deployment.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/01-deployment.md#moved-out-of-architecturemd-2026-10-15-pass)
- [Python deps, the httpx2 502 (2026-09-17)](docs/archaeology/01-deployment.md#python-deps-the-httpx2-502-2026-09-17)
- [rmapi-auth](docs/archaeology/01-deployment.md#rmapi-auth)
- [nginx 502 on `--reload` (the double upstream)](docs/archaeology/01-deployment.md#nginx-502-on---reload-the-double-upstream)
- [413 on pasted screenshots (2026-09-13)](docs/archaeology/01-deployment.md#413-on-pasted-screenshots-2026-09-13)
- [Access-log masking (2026-10-14, security audit)](docs/archaeology/01-deployment.md#access-log-masking-2026-10-14-security-audit)
- [Submodule migration (2026-10-14)](docs/archaeology/01-deployment.md#submodule-migration-2026-10-14)
- [`--reload-exclude` (2026-10-14)](docs/archaeology/01-deployment.md#--reload-exclude-2026-10-14)
- [Traps hit during the swap (2026-10-14)](docs/archaeology/01-deployment.md#traps-hit-during-the-swap-2026-10-14)
- [deploy.sh (2026-10-14)](docs/archaeology/01-deployment.md#deploysh-2026-10-14)
- [Local-claude deploy: no pull / no stash](docs/archaeology/01-deployment.md#local-claude-deploy-no-pull--no-stash)
- [sudo on the git half](docs/archaeology/01-deployment.md#sudo-on-the-git-half)

## 2. Module graph

→ [`docs/archaeology/02-module-graph.md`](docs/archaeology/02-module-graph.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/02-module-graph.md#moved-out-of-architecturemd-2026-10-15-pass)

## 3. Morning pipeline + scheduling

→ [`docs/archaeology/03-morning-pipeline.md`](docs/archaeology/03-morning-pipeline.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/03-morning-pipeline.md#moved-out-of-architecturemd-2026-10-15-pass)

## 4. TTS (text-to-speech)

→ [`docs/archaeology/04-tts.md`](docs/archaeology/04-tts.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/04-tts.md#moved-out-of-architecturemd-2026-10-15-pass)

## 5. LLM call sites + prompt caching

→ [`docs/archaeology/05-llm-calls.md`](docs/archaeology/05-llm-calls.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/05-llm-calls.md#moved-out-of-architecturemd-2026-10-15-pass)

## 6. Printer (ELEGOO Centauri Carbon)

→ [`docs/archaeology/06-printer.md`](docs/archaeology/06-printer.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/06-printer.md#moved-out-of-architecturemd-2026-10-15-pass)

## 7. `/cc` — the Exec panel's agent

→ [`docs/archaeology/07-cc-exec-agent.md`](docs/archaeology/07-cc-exec-agent.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/07-cc-exec-agent.md#moved-out-of-architecturemd-2026-10-15-pass)

## 8. `/rd` — the board and its month calendar

→ [`docs/archaeology/08-rd-board.md`](docs/archaeology/08-rd-board.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/08-rd-board.md#moved-out-of-architecturemd-2026-10-15-pass)
- [8-notes. From CLAUDE.md (moved 2026-09-27) — verbatim](docs/archaeology/08-rd-board.md#8-notes-from-claudemd-moved-2026-09-27--verbatim)

## 9. The landing page

→ [`docs/archaeology/09-landing-page.md`](docs/archaeology/09-landing-page.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/09-landing-page.md#moved-out-of-architecturemd-2026-10-15-pass)
- [9-notes. From CLAUDE.md (moved 2026-09-27) — verbatim](docs/archaeology/09-landing-page.md#9-notes-from-claudemd-moved-2026-09-27--verbatim)

## 10. The CRT effect stack (`_CRT_FX`)

→ [`docs/archaeology/10-crt-effects.md`](docs/archaeology/10-crt-effects.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/10-crt-effects.md#moved-out-of-architecturemd-2026-10-15-pass)
- [10-notes. From CLAUDE.md (moved 2026-09-27) — verbatim](docs/archaeology/10-crt-effects.md#10-notes-from-claudemd-moved-2026-09-27--verbatim)

## 11. `/graph`

→ [`docs/archaeology/11-graph.md`](docs/archaeology/11-graph.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/11-graph.md#moved-out-of-architecturemd-2026-10-15-pass)
- [11 (intro)](docs/archaeology/11-graph.md#11-intro)
- [11a. Applied per request, COMPUTED once per artifact](docs/archaeology/11-graph.md#11a-applied-per-request-computed-once-per-artifact)
- [11b. Drops](docs/archaeology/11-graph.md#11b-drops)
- [11c. Communities](docs/archaeology/11-graph.md#11c-communities)
- [11d. Size, labels, shape, physics, stats](docs/archaeology/11-graph.md#11d-size-labels-shape-physics-stats)
- [11e. Baked layout](docs/archaeology/11-graph.md#11e-baked-layout)
- [11f. The client-side overlay (history moved out of ARCHITECTURE.md, 2026-10-15)](docs/archaeology/11-graph.md#11f-the-client-side-overlay-history-moved-out-of-architecturemd-2026-10-15)
- [11g. Field notes (moved verbatim from CLAUDE.md 2026-09-27)](docs/archaeology/11-graph.md#11g-field-notes-moved-verbatim-from-claudemd-2026-09-27)

## 12. The bottom nav

→ [`docs/archaeology/12-bottom-nav.md`](docs/archaeology/12-bottom-nav.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/12-bottom-nav.md#moved-out-of-architecturemd-2026-10-15-pass)

## 13. The pre-commit hook suite

→ [`docs/archaeology/13-pre-commit-hooks.md`](docs/archaeology/13-pre-commit-hooks.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/13-pre-commit-hooks.md#moved-out-of-architecturemd-2026-10-15-pass)

## 14. `/tarot`

→ [`docs/archaeology/14-tarot.md`](docs/archaeology/14-tarot.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/14-tarot.md#moved-out-of-architecturemd-2026-10-15-pass)

## 15. The nudge loop

→ [`docs/archaeology/15-nudge-loop.md`](docs/archaeology/15-nudge-loop.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/15-nudge-loop.md#moved-out-of-architecturemd-2026-10-15-pass)
- [15e (2026-09-13) — why the nudge asks instead of asserts](docs/archaeology/15-nudge-loop.md#15e-2026-09-13--why-the-nudge-asks-instead-of-asserts)
- [15e-bis — tappable answers, history](docs/archaeology/15-nudge-loop.md#15e-bis--tappable-answers-history)
- [15a/15d — stall re-peel removal](docs/archaeology/15-nudge-loop.md#15a15d--stall-re-peel-removal)
- [15g — recalibration detail](docs/archaeology/15-nudge-loop.md#15g--recalibration-detail)
- [CLAUDE.md "15-notes" dump (moved 2026-09-27) — residue not kept in section 15](docs/archaeology/15-nudge-loop.md#claudemd-15-notes-dump-moved-2026-09-27--residue-not-kept-in-section-15)

## 16. The Exec monitor

→ [`docs/archaeology/16-exec-monitor.md`](docs/archaeology/16-exec-monitor.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/16-exec-monitor.md#moved-out-of-architecturemd-2026-10-15-pass)
- [Exec's own changes (2026-09-29)](docs/archaeology/16-exec-monitor.md#execs-own-changes-2026-09-29)
- [Watermark advance](docs/archaeology/16-exec-monitor.md#watermark-advance)
- [Orphaned tool_use](docs/archaeology/16-exec-monitor.md#orphaned-tool_use)
- [CLAUDE.md "16-notes" dump (moved 2026-09-27)](docs/archaeology/16-exec-monitor.md#claudemd-16-notes-dump-moved-2026-09-27)

## 17. Memory is the scarce resource on this box

→ [`docs/archaeology/17-memory.md`](docs/archaeology/17-memory.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/17-memory.md#moved-out-of-architecturemd-2026-10-15-pass)
- [Swap sizing](docs/archaeology/17-memory.md#swap-sizing)
- [17b — graphify rebuild ownership](docs/archaeology/17-memory.md#17b--graphify-rebuild-ownership)
- [17c — the `$?` bug](docs/archaeology/17-memory.md#17c--the--bug)
- [17d — graphify history](docs/archaeology/17-memory.md#17d--graphify-history)
- [17e — the `--reload` poller burning 44% of a core](docs/archaeology/17-memory.md#17e--the---reload-poller-burning-44-of-a-core)
- [CLAUDE.md "17-notes" dump (moved 2026-09-27)](docs/archaeology/17-memory.md#claudemd-17-notes-dump-moved-2026-09-27)

## 18. The typewriter and the shared chat surfaces

→ [`docs/archaeology/18-typewriter-chat.md`](docs/archaeology/18-typewriter-chat.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/18-typewriter-chat.md#moved-out-of-architecturemd-2026-10-15-pass)

## 19. `/zombo`

→ [`docs/archaeology/19-zombo.md`](docs/archaeology/19-zombo.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/19-zombo.md#moved-out-of-architecturemd-2026-10-15-pass)

## 20. Pages and subsystems without a section of their own

→ [`docs/archaeology/20-other-pages.md`](docs/archaeology/20-other-pages.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/20-other-pages.md#moved-out-of-architecturemd-2026-10-15-pass)

## 21. noodle — moved to its own repo

→ [`docs/archaeology/21-noodle.md`](docs/archaeology/21-noodle.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/21-noodle.md#moved-out-of-architecturemd-2026-10-15-pass)

## 22. /spire — moved to its own repo

→ [`docs/archaeology/22-spire.md`](docs/archaeology/22-spire.md)

- [Moved out of ARCHITECTURE.md (2026-10-15 pass)](docs/archaeology/22-spire.md#moved-out-of-architecturemd-2026-10-15-pass)
