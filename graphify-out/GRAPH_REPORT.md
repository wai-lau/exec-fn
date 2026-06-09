# Graph Report - exec-fn  (2026-06-09)

## Corpus Check
- 79 files · ~4,568,118 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 508 nodes · 842 edges · 34 communities (24 shown, 10 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 120 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8d71cb35`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_API Routes & Endpoints|API Routes & Endpoints]]
- [[_COMMUNITY_Tarot Major Arcana Meanings|Tarot Major Arcana Meanings]]
- [[_COMMUNITY_Exec Chat Tools|Exec Chat Tools]]
- [[_COMMUNITY_Tarot Reader Engine|Tarot Reader Engine]]
- [[_COMMUNITY_Frontend Templates & Widgets|Frontend Templates & Widgets]]
- [[_COMMUNITY_Morning Pipeline|Morning Pipeline]]
- [[_COMMUNITY_Tarot Core Framework|Tarot Core Framework]]
- [[_COMMUNITY_Exec Bubble UI|Exec Bubble UI]]
- [[_COMMUNITY_Exec Chat & Monitor|Exec Chat & Monitor]]
- [[_COMMUNITY_MTG Rules Assistant|MTG Rules Assistant]]
- [[_COMMUNITY_Celtic Cross Spread|Celtic Cross Spread]]
- [[_COMMUNITY_Google Calendar Sync|Google Calendar Sync]]
- [[_COMMUNITY_Stylelint Config|Stylelint Config]]
- [[_COMMUNITY_Card Edit Dialog|Card Edit Dialog]]
- [[_COMMUNITY_Card Image Downloader|Card Image Downloader]]
- [[_COMMUNITY_Authentication|Authentication]]
- [[_COMMUNITY_Deployment Topology|Deployment Topology]]
- [[_COMMUNITY_ESLint  NPM Config|ESLint / NPM Config]]
- [[_COMMUNITY_Card Styling|Card Styling]]
- [[_COMMUNITY_MTG Rules Compressor|MTG Rules Compressor]]
- [[_COMMUNITY_Claude Hooks Config|Claude Hooks Config]]
- [[_COMMUNITY_Container Entrypoint|Container Entrypoint]]
- [[_COMMUNITY_Morning Cron Script|Morning Cron Script]]
- [[_COMMUNITY_Droplet Bootstrap|Droplet Bootstrap]]
- [[_COMMUNITY_MTG Image Downloader|MTG Image Downloader]]
- [[_COMMUNITY_Session Start Hook|Session Start Hook]]
- [[_COMMUNITY_Module Import Graph (doc)|Module Import Graph (doc)]]
- [[_COMMUNITY_Anthropic SDK Dep|Anthropic SDK Dep]]
- [[_COMMUNITY_FastAPI Dep|FastAPI Dep]]

## God Nodes (most connected - your core abstractions)
1. `HTTPException` - 19 edges
2. `datetime` - 16 edges
3. `Numerology Across Pips and Courts` - 15 edges
4. `_now_et()` - 14 edges
5. `_load_rd()` - 14 edges
6. `Request` - 14 edges
7. `The Sun (XIX)` - 14 edges
8. `exec-fn` - 13 edges
9. `_load_json()` - 12 edges
10. `build_morning()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `createBlock() drag/resize timeline block` --calls--> `openCardDialog() shared edit dialog`  [EXTRACTED]
  api/templates/directives.html → web/card-dialog.js
- `createBlock() drag/resize timeline block` --calls--> `cardStyle() shared category coloring`  [EXTRACTED]
  api/templates/directives.html → web/card-style.js
- `kanban buildBoard()` --calls--> `openCardDialog() shared edit dialog`  [EXTRACTED]
  api/templates/kanban.html → web/card-dialog.js
- `kanban renderCard()` --calls--> `cardStyle() shared category coloring`  [EXTRACTED]
  api/templates/kanban.html → web/card-style.js
- `prophecies buildBoard() 6-day grid` --calls--> `cardStyle() shared category coloring`  [EXTRACTED]
  api/templates/prophecies.html → web/card-style.js

## Import Cycles
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

## Communities (34 total, 10 thin omitted)

### Community 0 - "API Routes & Endpoints"
Cohesion: 0.05
Nodes (67): Scoped bearer auth for /api/exec/say. EXEC_SAY_KEY only grants message-queueing,, require_auth(), require_guest_auth(), require_say_auth(), _load_json(), api_assemble_plan(), api_context(), api_context_patch() (+59 more)

### Community 1 - "Tarot Major Arcana Meanings"
Cohesion: 0.05
Nodes (68): Death (XIII), Ego dissolution / death of the personality, Initiation: simulated death and rebirth, Skeleton (shamanic eternity image), White rose (purified desire), Judgement (XX), Child between figures (new reality), New consciousness merging with life-force (+60 more)

### Community 2 - "Exec Chat Tools"
Cohesion: 0.09
Nodes (40): _build_chat_system_prompt(), _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _handle_tool(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., _tool_create_card(), _tool_delete_card() (+32 more)

### Community 3 - "Tarot Reader Engine"
Cohesion: 0.08
Nodes (29): Any, Path, Request, BaseModel, _load_card_chapter(), load_framework(), _load_framework_file(), load_numerology_text() (+21 more)

### Community 4 - "Frontend Templates & Widgets"
Cohesion: 0.15
Nodes (18): openCardDialog() shared edit dialog, cardStyle() shared category coloring, buildSchedule() timeline renderer, computeColumns() lane layout, createBlock() drag/resize timeline block, directives load() from /api/prophecies, saveStartTime() PATCH /api/rd, kanban buildBoard() (+10 more)

### Community 5 - "Morning Pipeline"
Cohesion: 0.10
Nodes (34): _tool_reschedule(), _day_window(), _now_et(), _parse_file_ts(), Most recent 4:30 AM ET expressed as a naive UTC datetime., (yesterday 4:30 AM ET, now) as naive UTC datetimes., _rollover_cutoff(), build_morning() (+26 more)

### Community 6 - "Tarot Core Framework"
Cohesion: 0.10
Nodes (26): Core Framework, Court Cards (Page/Knight/Queen/King), The Fool's Journey (three rows), Major Arcana, Minor Arcana, Reversed Cards (Pollack's Position), Minor Arcana Framework, Numerology Across Pips and Courts (+18 more)

### Community 7 - "Exec Bubble UI"
Cohesion: 0.17
Nodes (24): addMsg(), addStreamDiv(), buildBubble(), buildPanel(), _caretOffset(), closePanel(), connectMonitorStream(), fmtTs() (+16 more)

### Community 8 - "Exec Chat & Monitor"
Cohesion: 0.10
Nodes (21): append_monitor_comment(), append_user_message(), classify_card(), _dedupe_context(), get_chat(), parse_date_natural(), _parse_json(), Extract and parse the first JSON object or array from a string. (+13 more)

### Community 9 - "MTG Rules Assistant"
Cohesion: 0.15
Nodes (14): Path, _card_summary(), _load_cards(), _load_rulings(), lookup_card(), lookup_rulings(), api_mtg_chat(), api_mtg_log() (+6 more)

### Community 10 - "Celtic Cross Spread"
Cohesion: 0.15
Nodes (17): Celtic Cross Framework, The Cross (six-card situation), Position: Crossing Influence, Position: Crown, Position: Environment, Position: Foundation, Position: Heart of the Matter, Position: Hopes and Fears (+9 more)

### Community 11 - "Google Calendar Sync"
Cohesion: 0.23
Nodes (14): create_gcal_event(), _dedup_key(), fetch_calendar_events(), _fetch_gcal_raw_full(), _fetch_ics_events(), fetch_omens(), gcal_complete_auth(), _gcal_creds() (+6 more)

### Community 12 - "Stylelint Config"
Cohesion: 0.22
Nodes (8): extends, rules, alpha-value-notation, color-function-alias-notation, color-function-notation, declaration-block-single-line-max-declarations, font-family-no-missing-generic-family-keyword, no-descending-specificity

### Community 14 - "Card Image Downloader"
Cohesion: 0.57
Nodes (6): Path, _clone(), _convert_one(), main(), _make_card_back(), One-shot card-image downloader.  Populates ``web/tarot/cards/<card_id>.jpg`` (78

### Community 15 - "Authentication"
Cohesion: 0.12
Nodes (16): API endpoints, Cron, Docker volumes, Droplet, Exec chat tools (bubble overlay), exec-fn, Exec monitor, File map (+8 more)

### Community 17 - "ESLint / NPM Config"
Cohesion: 0.33
Nodes (5): devDependencies, eslint, @eslint/js, globals, type

### Community 18 - "Card Styling"
Cohesion: 0.40
Nodes (3): CAT_HUE, CAT_LIGHT, CAT_SAT

### Community 19 - "MTG Rules Compressor"
Cohesion: 0.18
Nodes (11): MTG Comprehensive Rules (compressed rules.txt), MTG rules caveman-compression pipeline, Scryfall card image tooltip, mtg streamResponse() SSE, drawSpread() POST /api/tarot/draw, Face-down card privacy (server sees only revealed), filteredSpread() face-down privacy filter, flipCard() reveal + event marker (+3 more)

### Community 27 - "Module Import Graph (doc)"
Cohesion: 0.29
Nodes (6): 1. Deployment, 2. Module graph, 3. Morning pipeline + scheduling, 3a. Morning cron sequence, 3b. scheduler.py — the time model, exec-fn — Architecture (UML, Mermaid)

## Knowledge Gaps
- **97 isolated node(s):** `RULES — READ FIRST`, `System overview`, `File map`, `Terminology`, `Pages` (+92 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `datetime` connect `Morning Pipeline` to `Exec Chat Tools`, `Tarot Reader Engine`, `Exec Chat & Monitor`, `MTG Rules Assistant`, `Google Calendar Sync`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `HTTPException` connect `API Routes & Endpoints` to `Exec Chat & Monitor`, `Tarot Reader Engine`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `_now_et()` connect `Morning Pipeline` to `Exec Chat & Monitor`, `Exec Chat Tools`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `HTTPException` (e.g. with `require_auth()` and `require_guest_auth()`) actually correct?**
  _`HTTPException` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `_now_et()` (e.g. with `_build_chat_system_prompt()` and `_tool_reschedule()`) actually correct?**
  _`_now_et()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `RULES — READ FIRST`, `System overview`, `File map` to the rest of the system?**
  _132 weakly-connected nodes found - possible documentation gaps or missing edges._