# Graph Report - exec-fn  (2026-06-14)

## Corpus Check
- 84 files · ~4,583,586 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 611 nodes · 1104 edges · 49 communities (39 shown, 10 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 161 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e0cd0d96`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_API Routes & Endpoints|API Routes & Endpoints]]
- [[_COMMUNITY_Tarot Major Arcana Meanings|Tarot Major Arcana Meanings]]
- [[_COMMUNITY_Exec Chat Tools|Exec Chat Tools]]
- [[_COMMUNITY_Tarot Reader Engine|Tarot Reader Engine]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Morning Pipeline|Morning Pipeline]]
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
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]

## God Nodes (most connected - your core abstractions)
1. `_load_rd()` - 26 edges
2. `_now_et()` - 23 edges
3. `_save_rd()` - 20 edges
4. `HTTPException` - 19 edges
5. `Request` - 16 edges
6. `Numerology Across Pips and Courts` - 15 edges
7. `exec-fn` - 14 edges
8. `_find_card()` - 14 edges
9. `The Sun (XIX)` - 14 edges
10. `api_rd_patch()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `The Sun (XIX)` --semantically_similar_to--> `Cosmic Dance / Shiva`  [INFERRED] [semantically similar]
  api/tarot/book/cards/the_sun.md → api/tarot/book/cards/the_world.md
- `_focused_nudge_card()` --calls--> `logical_today_iso()`  [INFERRED]
  api/chat.py → api/scheduler.py
- `_build_chat_system_prompt()` --calls--> `_load_json()`  [INFERRED]
  api/chat.py → api/helpers.py
- `_build_chat_system_prompt()` --calls--> `_load_rd()`  [INFERRED]
  api/chat.py → api/helpers.py
- `_build_chat_system_prompt()` --calls--> `_now_et()`  [INFERRED]
  api/chat.py → api/helpers.py

## Import Cycles
- 1-file cycle: `api/nudge.py -> api/nudge.py`
- 1-file cycle: `api/main.py -> api/main.py`
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

### Community 0 - "API Routes & Endpoints"
Cohesion: 0.24
Nodes (13): color_page(), debug_page(), guest_login_page(), _index_pages(), mtg_page(), plan_page(), prophecies_page(), Return (no_form, bare) variants of /app/static/index.html, re-read on change. (+5 more)

### Community 1 - "Tarot Major Arcana Meanings"
Cohesion: 0.05
Nodes (68): Death (XIII), Ego dissolution / death of the personality, Initiation: simulated death and rebirth, Skeleton (shamanic eternity image), White rose (purified desire), Judgement (XX), Child between figures (new reality), New consciousness merging with life-force (+60 more)

### Community 2 - "Exec Chat Tools"
Cohesion: 0.08
Nodes (49): _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _nudge_resched_blocked(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., Due dates are protected: an active-nudge card can't be deferred without the, _tool_advance_chunk(), _tool_create_card() (+41 more)

### Community 3 - "Tarot Reader Engine"
Cohesion: 0.08
Nodes (29): Any, Path, Request, BaseModel, _load_card_chapter(), load_framework(), _load_framework_file(), load_numerology_text() (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (13): _handle_tool(), _load_json(), api_assemble_plan(), api_context(), api_context_patch(), api_directives_get(), api_plan_get(), api_profile() (+5 more)

### Community 5 - "Morning Pipeline"
Cohesion: 0.12
Nodes (28): _dedupe_context(), _tool_reschedule(), _now_et(), _parse_json(), Extract and parse the first JSON object or array from a string., build_morning(), _cards_text(), _generate_schedule() (+20 more)

### Community 6 - "Tarot Core Framework"
Cohesion: 0.10
Nodes (26): Core Framework, Court Cards (Page/Knight/Queen/King), The Fool's Journey (three rows), Major Arcana, Minor Arcana, Reversed Cards (Pollack's Position), Minor Arcana Framework, Numerology Across Pips and Courts (+18 more)

### Community 7 - "Exec Bubble UI"
Cohesion: 0.17
Nodes (25): addMsg(), addStreamDiv(), armFirstGestureFocus(), buildBubble(), buildPanel(), _caretOffset(), closePanel(), connectMonitorStream() (+17 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (15): _active_nudge_block(), append_monitor_comment(), _build_chat_system_prompt(), _focused_nudge_card(), get_chat(), Most-recently-nudged card with an active nudge loop., get_rd_log(), api_prophecies_log() (+7 more)

### Community 9 - "MTG Rules Assistant"
Cohesion: 0.15
Nodes (14): Path, _card_summary(), _load_cards(), _load_rulings(), lookup_card(), lookup_rulings(), api_mtg_chat(), api_mtg_log() (+6 more)

### Community 10 - "Celtic Cross Spread"
Cohesion: 0.15
Nodes (17): Celtic Cross Framework, The Cross (six-card situation), Position: Crossing Influence, Position: Crown, Position: Environment, Position: Foundation, Position: Heart of the Matter, Position: Hopes and Fears (+9 more)

### Community 11 - "Google Calendar Sync"
Cohesion: 0.25
Nodes (13): create_gcal_event(), _dedup_key(), fetch_calendar_events(), _fetch_gcal_raw_full(), _fetch_ics_events(), fetch_omens(), gcal_complete_auth(), _gcal_creds() (+5 more)

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
Cohesion: 0.17
Nodes (15): _advance_recurrence(), _next_recurrence(), Advance a date by one recurrence step. None for unknown type., Next ISO date for a recurring card.      Advances one step from the card's due_d, api_prophecies_get(), api_prophecies_patch(), bulk_update_scheduled_days(), get_week_data() (+7 more)

### Community 17 - "ESLint / NPM Config"
Cohesion: 0.33
Nodes (5): devDependencies, eslint, @eslint/js, globals, type

### Community 18 - "Card Styling"
Cohesion: 0.60
Nodes (4): CARD_CATS, cardStyle(), _catKey(), chipStyle()

### Community 27 - "Module Import Graph (doc)"
Cohesion: 0.29
Nodes (6): 1. Deployment, 2. Module graph, 3. Morning pipeline + scheduling, 3a. Morning cron sequence, 3b. scheduler.py — the time model, exec-fn — Architecture (UML, Mermaid)

### Community 34 - "Community 34"
Cohesion: 0.20
Nodes (10): gcal_start_auth(), api_gcal_auth(), api_gcal_import_cards(), api_morning(), serve_data(), api_gamesave_delete(), api_gamesave_get(), api_gamesave_post() (+2 more)

### Community 35 - "Community 35"
Cohesion: 0.27
Nodes (13): addToggles(), buildPhysicsColumn(), clusterSpan(), focusRandomCluster(), go(), hideOrphans(), initTour(), makeControls() (+5 more)

### Community 36 - "Community 36"
Cohesion: 0.08
Nodes (52): active_anchor(), active_label(), _active_node(), apply_peel(), assign_auto_deadlines(), _back_schedule(), _card_brief(), card_deadline() (+44 more)

### Community 37 - "Community 37"
Cohesion: 0.20
Nodes (10): api_rd_patch(), _flag_triage(), _log_entries_for_patch(), _minutes_late(), Mark a card for plan re-triage when its title/notes changed — the next tick, Trailing debounce: each call resets the 60s timer., How many minutes past its deadline a card was completed (clamped >= 0,     cappe, Refresh per-node deadlines so a due-time edit updates the plan immediately, (+2 more)

### Community 38 - "Community 38"
Cohesion: 0.40
Nodes (5): guest_login(), guest_login_alias(), Restrict redirect targets to the known guest-accessible page set., Bookmark-safe alias for the renamed /guest route., _safe_next()

### Community 39 - "Community 39"
Cohesion: 0.18
Nodes (12): classify_card(), parse_date_natural(), api_parse_date(), api_rd_classify(), login(), login_page(), _no_cache_static(), Same-origin redirect guard: accept only a leading-slash relative path,     rejec (+4 more)

### Community 40 - "Community 40"
Cohesion: 0.31
Nodes (9): factor_for(), _load(), Lateness recalibration.  Consumes the `late` telemetry that lands on archive mov, Lateness factor for a card's category (1.0 if unknown / never late)., Per-completion target the EMA pulls toward., Fold a day's completions into the per-category factors. A completion is a     `m, recalibrate(), _save() (+1 more)

### Community 41 - "Community 41"
Cohesion: 0.42
Nodes (8): draw(), firstOpen(), layerOf(), nodeEl(), prereqMap(), recompute(), removeNode(), startTime()

### Community 42 - "Community 42"
Cohesion: 0.50
Nodes (4): _landing_html(), Public landing page: non-admin sections only, as a centered vertical     column, Public landing page (non-admin sections). Logged-in admins skip it     and land, root()

### Community 43 - "Community 43"
Cohesion: 0.47
Nodes (5): Scoped bearer auth for /api/exec/say. EXEC_SAY_KEY only grants message-queueing,, require_auth(), require_guest_auth(), require_say_auth(), HTTPAuthorizationCredentials

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (5): api_nudge_tick(), _entry_is_significant(), monitor_flush(), Manual one-shot tick of the nudge loop (the in-process loop runs this     automa, Fire monitor immediately if significant activity exists since last comment.

### Community 45 - "Community 45"
Cohesion: 0.36
Nodes (8): push_to_monitor(), Push a payload to all exec-bubble SSE subscribers., _run_monitor(), _build_context(), _entry_line(), generate_encouragement(), _is_commentable(), _recent_entries()

### Community 46 - "Community 46"
Cohesion: 0.25
Nodes (8): api_debug_logs(), _build_nav(), color_usage(), graph_page(), nightfall_page(), var(--X) occurrence counts + actually-used alphas per -hsl token +     per-(toke, build_nightfall_html(), Path

### Community 48 - "Community 48"
Cohesion: 0.83
Nodes (3): build_prompt(), main(), ts()

## Knowledge Gaps
- **88 isolated node(s):** `RULES — READ FIRST`, `System overview`, `File map`, `Terminology`, `Pages` (+83 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `_now_et()` connect `Morning Pipeline` to `Exec Chat Tools`, `Community 36`, `Community 37`, `Community 8`, `Community 45`, `Community 16`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `_load_rd()` connect `Exec Chat Tools` to `Community 4`, `Morning Pipeline`, `Community 36`, `Community 8`, `Community 45`, `Community 16`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `HTTPException` connect `Community 34` to `Exec Chat Tools`, `Tarot Reader Engine`, `Community 4`, `Community 38`, `Community 39`, `Community 43`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `_now_et()` (e.g. with `_build_chat_system_prompt()` and `_tool_advance_chunk()`) actually correct?**
  _`_now_et()` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `_save_rd()` (e.g. with `_apply_schedule()` and `_tool_advance_chunk()`) actually correct?**
  _`_save_rd()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `HTTPException` (e.g. with `require_auth()` and `require_guest_auth()`) actually correct?**
  _`HTTPException` has 7 INFERRED edges - model-reasoned connections that need verification._