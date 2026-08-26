# Graph Report - exec-fn  (2026-06-15)

## Corpus Check
- 102 files · ~4,582,066 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 814 nodes · 1338 edges · 49 communities (39 shown, 10 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 184 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `07cf3e10`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Tarot Major Arcana Meanings|Tarot Major Arcana Meanings]]
- [[_COMMUNITY_Exec Chat Tools|Exec Chat Tools]]
- [[_COMMUNITY_Tarot Reader Engine|Tarot Reader Engine]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Tarot Core Framework|Tarot Core Framework]]
- [[_COMMUNITY_Exec Bubble UI|Exec Bubble UI]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_MTG Rules Assistant|MTG Rules Assistant]]
- [[_COMMUNITY_Celtic Cross Spread|Celtic Cross Spread]]
- [[_COMMUNITY_Google Calendar Sync|Google Calendar Sync]]
- [[_COMMUNITY_Stylelint Config|Stylelint Config]]
- [[_COMMUNITY_Card Edit Dialog|Card Edit Dialog]]
- [[_COMMUNITY_Card Image Downloader|Card Image Downloader]]
- [[_COMMUNITY_Authentication|Authentication]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_ESLint  NPM Config|ESLint / NPM Config]]
- [[_COMMUNITY_Card Styling|Card Styling]]
- [[_COMMUNITY_MTG Rules Compressor|MTG Rules Compressor]]
- [[_COMMUNITY_Claude Hooks Config|Claude Hooks Config]]
- [[_COMMUNITY_Container Entrypoint|Container Entrypoint]]
- [[_COMMUNITY_Morning Cron Script|Morning Cron Script]]
- [[_COMMUNITY_Droplet Bootstrap|Droplet Bootstrap]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Session Start Hook|Session Start Hook]]
- [[_COMMUNITY_Module Import Graph (doc)|Module Import Graph (doc)]]
- [[_COMMUNITY_Anthropic SDK Dep|Anthropic SDK Dep]]
- [[_COMMUNITY_FastAPI Dep|FastAPI Dep]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 55|Community 55]]

## God Nodes (most connected - your core abstractions)
1. `_load_rd()` - 19 edges
2. `HTTPException` - 16 edges
3. `_now_et()` - 15 edges
4. `_save_rd()` - 15 edges
5. `Numerology Across Pips and Courts` - 15 edges
6. `exec-fn` - 14 edges
7. `Request` - 14 edges
8. `The Sun (XIX)` - 14 edges
9. `build_morning()` - 13 edges
10. `_append_rd_log()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `The Sun (XIX)` --semantically_similar_to--> `Cosmic Dance / Shiva`  [INFERRED] [semantically similar]
  api/tarot/book/cards/the_sun.md → api/tarot/book/cards/the_world.md
- `_normalize_graph()` --calls--> `_now_et()`  [INFERRED]
  api/nudge.py → api/helpers.py
- `clear_awaiting_focused()` --calls--> `_load_rd()`  [INFERRED]
  api/nudge.py → api/helpers.py
- `clear_awaiting_focused()` --calls--> `_now_et()`  [INFERRED]
  api/nudge.py → api/helpers.py
- `clear_awaiting_focused()` --calls--> `_save_rd()`  [INFERRED]
  api/nudge.py → api/helpers.py

## Import Cycles
- 1-file cycle: `api/nudge.py -> api/nudge.py`
- 1-file cycle: `api/nudge_deadlines.py -> api/nudge_deadlines.py`
- 1-file cycle: `api/main.py -> api/main.py`
- 1-file cycle: `api/nudge_llm.py -> api/nudge_llm.py`
- 1-file cycle: `api/helpers.py -> api/helpers.py`

## Hyperedges (group relationships)
- **Shared card-style/dialog widgets across boards** — card_style_cardstyle, card_dialog_opencarddialog, kanban_rendercard, directives_createblock, prophecies_buildboard [EXTRACTED 0.90]
- **Frontend views reading/writing rd.json cards** — kanban_save, directives_savestarttime, prophecies_flushupdates, rd_json_card [INFERRED 0.85]
- **Morning pipeline + scheduler card promotion** — architecture_morning_pipeline, architecture_scheduler_time_model, architecture_rd_hq_promotion, architecture_exec_chat_callchain [EXTRACTED 0.85]
- **Second-row initiation arc: Strength to Temperance via inner transformation** — cards_strength, cards_justice, cards_the_hanged_man, cards_death, cards_temperance [EXTRACTED 0.95]
- **Pollack's halfway point as process: Wheel, Justice, Hanged Man** — cards_justice, cards_the_hanged_man, cards_judgement [INFERRED 0.65]
- **First-row forces gathered into the Chariot's ego** — cards_the_empress, cards_the_emperor, cards_the_chariot [EXTRACTED 0.95]
- **Third-row revelation passage (Tower breaks the dam, Star is peace behind the veil, Moon distorts into image, Sun carries light into life)** — cards_the_tower, cards_the_star, cards_the_moon, cards_the_sun [EXTRACTED 1.00]
- **Abulafia's three-trump triangle: Hierophant (doctrine), Hermit (teacher), Sun (ecstasy)** — cards_the_hierophant, cards_the_hermit, cards_the_sun [EXTRACTED 1.00]
- **Four living creatures transformed alive from the Wheel into the World** — cards_wheel_of_fortune, cards_the_world, concept_four_living_creatures [EXTRACTED 1.00]
- **The four suits form the Minor Arcana** — suits_wands, suits_cups, suits_swords, suits_pentacles [EXTRACTED 1.00]
- **The six positions of the Cross** — book_framework_celtic_cross_heart, book_framework_celtic_cross_crossing, book_framework_celtic_cross_crown, book_framework_celtic_cross_foundation, book_framework_celtic_cross_recent_past, book_framework_celtic_cross_near_future [EXTRACTED 1.00]
- **The three positions of the Three-Card spread** — book_framework_three_past_present_future, book_framework_three_middle_card, book_framework_three_situation_action_outcome [EXTRACTED 0.75]

## Communities (49 total, 10 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (11): api_context_patch(), api_rd_patch(), _atomic_write_json(), _flag_triage(), _log_entries_for_patch(), _minutes_late(), JSON API routes: card CRUD, scheduling, profile/context, gcal, monitor + nudge c, Refresh per-node deadlines so a due-time edit updates the plan immediately, (+3 more)

### Community 1 - "Tarot Major Arcana Meanings"
Cohesion: 0.05
Nodes (68): Death (XIII), Ego dissolution / death of the personality, Initiation: simulated death and rebirth, Skeleton (shamanic eternity image), White rose (purified desire), Judgement (XX), Child between figures (new reality), New consciousness merging with life-force (+60 more)

### Community 2 - "Exec Chat Tools"
Cohesion: 0.06
Nodes (67): _build_chat_system_prompt(), _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _nudge_resched_blocked(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., Due dates are protected: an active-nudge card can't be deferred without the, _tool_advance_chunk() (+59 more)

### Community 3 - "Tarot Reader Engine"
Cohesion: 0.08
Nodes (29): Any, Path, Request, BaseModel, _load_card_chapter(), load_framework(), _load_framework_file(), load_numerology_text() (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (15): api_debug_logs(), color_usage(), graph_page(), guest_login(), guest_login_alias(), _landing_html(), HTML page routes + the read-only data GETs that back them.  Public landing/login, Bookmark-safe alias for the renamed /guest route. (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (13): _build_context(), _entry_is_significant(), _entry_line(), flush_monitor(), generate_encouragement(), _is_commentable(), Trailing debounce: each call resets the 60s timer., Fire the monitor now if significant activity exists since the last     comment ( (+5 more)

### Community 6 - "Tarot Core Framework"
Cohesion: 0.10
Nodes (26): Core Framework, Court Cards (Page/Knight/Queen/King), The Fool's Journey (three rows), Major Arcana, Minor Arcana, Reversed Cards (Pollack's Position), Minor Arcana Framework, Numerology Across Pips and Courts (+18 more)

### Community 7 - "Exec Bubble UI"
Cohesion: 0.15
Nodes (27): addMsg(), addStreamDiv(), armFirstGestureFocus(), buildBubble(), buildPanel(), _caretOffset(), closePanel(), connectMonitorStream() (+19 more)

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (14): _build_nav(), _index_pages(), Page composition: nav builder, index-shell variants, template loader.  Pure rend, Return (no_form, bare) variants of /app/static/index.html, re-read on change., _render_page(), _tmpl(), color_page(), debug_page() (+6 more)

### Community 9 - "MTG Rules Assistant"
Cohesion: 0.10
Nodes (21): _lifespan(), _no_cache_static(), Request, FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.  Routes l, unauthorized_handler(), Path, The three top-level APIRouters, shared by every route module.  Defined here (not, FastAPI (+13 more)

### Community 10 - "Celtic Cross Spread"
Cohesion: 0.15
Nodes (17): Celtic Cross Framework, The Cross (six-card situation), Position: Crossing Influence, Position: Crown, Position: Environment, Position: Foundation, Position: Heart of the Matter, Position: Hopes and Fears (+9 more)

### Community 11 - "Google Calendar Sync"
Cohesion: 0.08
Nodes (26): _active_nudge_block(), classify_card(), _dedupe_context(), _focused_nudge_card(), get_chat(), Most-recently-nudged card with an active nudge loop., create_gcal_event(), _dedup_key() (+18 more)

### Community 12 - "Stylelint Config"
Cohesion: 0.22
Nodes (8): extends, rules, alpha-value-notation, color-function-alias-notation, color-function-notation, declaration-block-single-line-max-declarations, font-family-no-missing-generic-family-keyword, no-descending-specificity

### Community 13 - "Card Edit Dialog"
Cohesion: 0.43
Nodes (4): _collectAndPatch(), _parseMD(), _patch(), _resolve()

### Community 14 - "Card Image Downloader"
Cohesion: 0.57
Nodes (6): Path, _clone(), _convert_one(), main(), _make_card_back(), One-shot card-image downloader.  Populates ``web/tarot/cards/<card_id>.jpg`` (78

### Community 15 - "Authentication"
Cohesion: 0.11
Nodes (17): API endpoints, Cron, Docker volumes, Droplet, Exec chat tools (bubble overlay), exec-fn, Exec monitor, File map (+9 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (10): api_parse_date(), api_prophecies_patch(), api_rd_classify(), login(), login_page(), nightfall_page(), Same-origin redirect guard: accept only a leading-slash relative path,     rejec, Admin login screen. Already-authed visitors skip it and land on their     redire (+2 more)

### Community 17 - "ESLint / NPM Config"
Cohesion: 0.33
Nodes (5): devDependencies, eslint, @eslint/js, globals, type

### Community 18 - "Card Styling"
Cohesion: 0.53
Nodes (5): bookBarColors(), CARD_CATS, cardStyle(), _catKey(), chipStyle()

### Community 27 - "Module Import Graph (doc)"
Cohesion: 0.29
Nodes (6): 1. Deployment, 2. Module graph, 3. Morning pipeline + scheduling, 3a. Morning cron sequence, 3b. scheduler.py — the time model, exec-fn — Architecture (UML, Mermaid)

### Community 34 - "Community 34"
Cohesion: 0.13
Nodes (16): Scoped bearer auth for /api/exec/say. EXEC_SAY_KEY only grants message-queueing,, require_auth(), require_guest_auth(), require_say_auth(), api_gcal_auth(), api_gcal_import_cards(), api_morning(), api_rd_recalc() (+8 more)

### Community 35 - "Community 35"
Cohesion: 0.27
Nodes (13): addToggles(), buildPhysicsColumn(), clusterSpan(), focusRandomCluster(), go(), hideOrphans(), initTour(), makeControls() (+5 more)

### Community 36 - "Community 36"
Cohesion: 0.07
Nodes (56): active_label(), clear_awaiting_focused(), active_anchor(), assign_auto_deadlines(), _back_schedule(), card_deadline(), compute_deadlines(), ensure_event_terminal() (+48 more)

### Community 40 - "Community 40"
Cohesion: 0.31
Nodes (9): factor_for(), _load(), Lateness recalibration.  Consumes the `late` telemetry that lands on archive mov, Lateness factor for a card's category (1.0 if unknown / never late)., Per-completion target the EMA pulls toward., Fold a day's completions into the per-category factors. A completion is a     `m, recalibrate(), _save() (+1 more)

### Community 41 - "Community 41"
Cohesion: 0.26
Nodes (13): computeOffsets(), draw(), firstOpen(), fmtClock(), freezeOffsets(), layerOf(), masterStartOf(), nodeEl() (+5 more)

### Community 43 - "Community 43"
Cohesion: 0.06
Nodes (53): _caretOffset(), _caretToEnd(), focusInput(), _focusNow(), _inputBar, _inputCursor, _msgInput, _post (+45 more)

### Community 44 - "Community 44"
Cohesion: 0.11
Nodes (24): buildBoard(), buildSchedule(), consult_oracle(), dayCellHtml(), flushUpdates(), initSortable(), load(), queueUpdate() (+16 more)

### Community 45 - "Community 45"
Cohesion: 0.10
Nodes (24): push_to_monitor(), Exec-bubble SSE fan-out — shared by the monitor (main) and the nudge loop., Push a payload to all exec-bubble SSE subscribers., _arm_nudge(), _build_graph(), _due_kind(), _fire_nudge(), _nudge_tick() (+16 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (19): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, fmtDate() (+11 more)

### Community 48 - "Community 48"
Cohesion: 0.83
Nodes (3): build_prompt(), main(), ts()

### Community 50 - "Community 50"
Cohesion: 0.13
Nodes (21): addMsg(), addStreamDiv(), _caretOffset(), _imgCache, _inputBar, _inputCursor, messages, _msgInput (+13 more)

### Community 51 - "Community 51"
Cohesion: 0.17
Nodes (15): buildColumns(), CAT_DESC, categoryTokens(), esc(), groupHtml(), loadColors(), mergedSites(), nearestSize() (+7 more)

### Community 53 - "Community 53"
Cohesion: 0.18
Nodes (12): assignLanes(), attachBlockDrag(), attachResize(), createGroup(), freezeOffsets(), hasBreakdown(), orderedSubs(), patchCard() (+4 more)

### Community 55 - "Community 55"
Cohesion: 0.29
Nodes (3): loadDebug(), profileNotes, renderProfile()

## Knowledge Gaps
- **134 isolated node(s):** `RULES — READ FIRST`, `System overview`, `File map`, `Terminology`, `Pages` (+129 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build_morning()` connect `Exec Chat Tools` to `Community 34`, `Google Calendar Sync`, `Community 36`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `api_morning()` connect `Community 34` to `Community 0`, `Exec Chat Tools`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `HTTPException` connect `Community 34` to `Community 16`, `MTG Rules Assistant`, `Tarot Reader Engine`, `Community 4`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 17 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `HTTPException` (e.g. with `require_auth()` and `require_guest_auth()`) actually correct?**
  _`HTTPException` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `_now_et()` (e.g. with `_build_chat_system_prompt()` and `_tool_advance_chunk()`) actually correct?**
  _`_now_et()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `_save_rd()` (e.g. with `_apply_schedule()` and `_tool_advance_chunk()`) actually correct?**
  _`_save_rd()` has 14 INFERRED edges - model-reasoned connections that need verification._