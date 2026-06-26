# Graph Report - exec-fn  (2026-06-26)

## Corpus Check
- 585 files · ~9,797,558 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 930 nodes · 1635 edges · 57 communities (45 shown, 12 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 253 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `33a741ba`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Tarot Major Arcana Meanings|Tarot Major Arcana Meanings]]
- [[_COMMUNITY_Community 2|Community 2]]
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
- [[_COMMUNITY_GCal OAuth Setup|GCal OAuth Setup]]
- [[_COMMUNITY_Module Import Graph (doc)|Module Import Graph (doc)]]
- [[_COMMUNITY_ESLint Flat Config|ESLint Flat Config]]
- [[_COMMUNITY_Package Init|Package Init]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_FastAPI Dep|FastAPI Dep]]
- [[_COMMUNITY_Tarot Package Init|Tarot Package Init]]
- [[_COMMUNITY_MTG Package Init|MTG Package Init]]
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
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 56|Community 56]]

## God Nodes (most connected - your core abstractions)
1. `_load_rd()` - 26 edges
2. `Request` - 24 edges
3. `$()` - 23 edges
4. `_now_et()` - 22 edges
5. `_save_rd()` - 20 edges
6. `exec-fn` - 14 edges
7. `_load_json()` - 14 edges
8. `_find_card()` - 14 edges
9. `_append_rd_log()` - 13 edges
10. `build_morning()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `graph_page()` --calls--> `_build_nav()`  [INFERRED]
  api/routes_views.py → api/pages.py
- `classify_card()` --calls--> `_parse_json()`  [INFERRED]
  api/card_llm.py → api/helpers.py
- `_build_chat_system_prompt()` --calls--> `_load_json()`  [INFERRED]
  api/chat.py → api/helpers.py
- `_build_chat_system_prompt()` --calls--> `_load_rd()`  [INFERRED]
  api/chat.py → api/helpers.py
- `_run_monitor()` --calls--> `append_monitor_comment()`  [INFERRED]
  api/monitor.py → api/chat.py

## Import Cycles
- None detected.

## Communities (57 total, 12 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (58): require_auth(), require_guest_auth(), classify_card(), parse_date_natural(), Card-creation LLM helpers: classify a new card's category + importance, and pars, _cache_control(), _lifespan(), FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.  Routes l (+50 more)

### Community 1 - "Tarot Major Arcana Meanings"
Cohesion: 0.05
Nodes (50): bookBarColors(), CARD_CATS, cardStyle(), _catKey(), chipStyle(), _remChipHtml(), buildBoard(), buildSchedule() (+42 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (56): _canType(), _caretOffset(), _caretToEnd(), focusInput(), _focusNow(), _inputBar, _inputCursor, _msgInput (+48 more)

### Community 3 - "Tarot Reader Engine"
Cohesion: 0.07
Nodes (57): active_label(), clear_awaiting_focused(), active_anchor(), assign_auto_deadlines(), _back_schedule(), card_deadline(), compute_deadlines(), ensure_event_terminal() (+49 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (50): _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _nudge_resched_blocked(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., Due dates are protected: an active-nudge card can't be deferred without the, _tool_advance_chunk(), _tool_create_card() (+42 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (34): Any, get_chat(), api_chat(), api_chat_get(), ChatBody, Stream follow-up assistant turn after tool results., _stream_tool_followup(), BaseModel (+26 more)

### Community 6 - "Tarot Core Framework"
Cohesion: 0.09
Nodes (32): _active_nudge_block(), append_monitor_comment(), _build_chat_system_prompt(), _dedupe_context(), _focused_nudge_card(), Most-recently-nudged card with an active nudge loop., get_rd_log(), _now_et() (+24 more)

### Community 7 - "Exec Bubble UI"
Cohesion: 0.09
Nodes (30): The three top-level APIRouters, shared by every route module.  Defined here (not, _err(), Two passes. Pass 1 (research) runs the tool loop with its prose discarded —, stream_chat(), _card_summary(), _keyword_rules(), _load_cards(), _load_rulings() (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (32): _array_re(), _drop_graph_book_nodes(), _drop_graph_moltbook_nodes(), _drop_graph_vendor_nodes(), _fix_graph_stats(), _friendly_dir(), _loc_by_node_id(), _merge_graph_communities() (+24 more)

### Community 9 - "MTG Rules Assistant"
Cohesion: 0.15
Nodes (27): addMsg(), addStreamDiv(), armFirstGestureFocus(), buildBubble(), buildPanel(), _caretOffset(), closePanel(), connectMonitorStream() (+19 more)

### Community 10 - "Celtic Cross Spread"
Cohesion: 0.11
Nodes (26): addMsg(), addStreamDiv(), _caretOffset(), _imgCache, _inputBar, _inputCursor, _linkifyRules(), messages (+18 more)

### Community 11 - "Google Calendar Sync"
Cohesion: 0.12
Nodes (22): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, _compositeBg() (+14 more)

### Community 12 - "Stylelint Config"
Cohesion: 0.22
Nodes (21): assert_recovered(), fulfill_sse(), open_tarot(), Tarot reading-progression tests (WebKit / playwright).  The /tarot reader is a c, Open /tarot in a fresh context with the boundaries mocked.      `chat_handler` a, The querent can act again: not streaming, input unblocked, nothing held., Frame events as the SSE the reader stream emits: `data: <json>\\n\\n`., A /api/tarot/chat route handler that streams `body` as 200 event-stream. (+13 more)

### Community 13 - "Card Edit Dialog"
Cohesion: 0.13
Nodes (22): connect(), $(), applySpeedCap(), applyVolume(), checkHealth(), CLONE_BACKENDS, loadVoices(), mountPresence() (+14 more)

### Community 14 - "Card Image Downloader"
Cohesion: 0.17
Nodes (19): _load_json(), api_context(), api_context_patch(), api_profile(), api_rd(), api_rd_patch(), api_todos(), api_todos_add() (+11 more)

### Community 15 - "Authentication"
Cohesion: 0.20
Nodes (17): addToggles(), buildPhysicsColumn(), clusterSpan(), focusRandomCluster(), go(), hideOrphans(), initTour(), isRedacted() (+9 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (15): buildColumns(), CAT_DESC, categoryTokens(), esc(), groupHtml(), loadColors(), mergedSites(), nearestSize() (+7 more)

### Community 17 - "ESLint / NPM Config"
Cohesion: 0.14
Nodes (5): _is_page(), Page smoke tests — every HTML route loads (or redirects) per its auth tier.  Cat, test_guest_loads_with_guest_bearer(), test_protected_loads_with_admin(), test_public_page_loads()

### Community 18 - "Card Styling"
Cohesion: 0.21
Nodes (15): create_gcal_event(), _dedup_key(), fetch_calendar_events(), _fetch_gcal_raw_full(), _fetch_ics_events(), fetch_omens(), gcal_complete_auth(), _gcal_creds() (+7 more)

### Community 19 - "MTG Rules Compressor"
Cohesion: 0.22
Nodes (13): _build_context(), _entry_is_significant(), _entry_line(), flush_monitor(), generate_encouragement(), _is_commentable(), Trailing debounce: each call resets the 60s timer., Fire the monitor now if significant activity exists since the last     comment ( (+5 more)

### Community 20 - "Claude Hooks Config"
Cohesion: 0.22
Nodes (9): loadDebug(), profileNotes, renderLogs(), renderMoltbook(), renderMtg(), renderProfile(), renderProfileSection(), renderTarot() (+1 more)

### Community 21 - "Container Entrypoint"
Cohesion: 0.21
Nodes (12): bulk_update_scheduled_days(), get_prophecies_log(), get_week_data(), log_prophecy_change(), _logical_today(), Yesterday if before 4:30 AM ET, matching client isoToday()., Return cards scheduled for 7 days starting from start_iso (default logical today, Apply list of {id, scheduled_day?, order?} updates to rd.json. (+4 more)

### Community 22 - "Morning Cron Script"
Cohesion: 0.15
Nodes (7): admin_cookie(), base_url(), _key(), Smoke-test fixtures.  These run against the LIVE app (the running container on :, Env var first; fall back to the repo .env (same host, same secrets)., Probe the live app once; skip the whole suite if it isn't reachable., Full-auth via the SESSION COOKIE (what a real logged-in browser sends).      Som

### Community 23 - "Droplet Bootstrap"
Cohesion: 0.27
Nodes (8): _open_panel(), open_rd(), Exec-voice behaviour tests (WebKit / playwright).  Proves the GLaDOS voice actua, Open /rd (the planning panel) with the TTS boundary + chat mocked., _spoken(), test_assistant_reply_is_spoken_in_glados(), test_muted_player_stays_silent(), test_speak_strips_markdown_and_brackets()

### Community 24 - "Community 24"
Cohesion: 0.28
Nodes (11): cgDraw(), cgNodeEl(), computeOffsets(), firstOpen(), fmtClock(), freezeOffsets(), layerOf(), masterStartOf() (+3 more)

### Community 25 - "Session Start Hook"
Cohesion: 0.35
Nodes (11): _akey(), check(), _defined_tokens(), _load_baseline(), main(), Drop block + HTML comments so example/placeholder tokens in prose (e.g.     chro, Per-token used alphas {token: {alpha_key}}, mirroring /api/color/usage., _scan_paths() (+3 more)

### Community 26 - "GCal OAuth Setup"
Cohesion: 0.25
Nodes (9): _broadcast_presence(), _pump_to_client(), _pump_to_upstream(), TTS page + WebSocket reverse-proxy to the home GPU server.  The TTS models (Koko, Is the home-box TTS upstream reachable. The reverse-tunnel listener stays     bo, tts_health(), ws_presence(), ws_tts() (+1 more)

### Community 27 - "Module Import Graph (doc)"
Cohesion: 0.29
Nodes (9): factor_for(), _load(), Lateness recalibration.  Consumes the `late` telemetry that lands on archive mov, Lateness factor for a card's category (1.0 if unknown / never late)., Per-completion target the EMA pulls toward., Fold a day's completions into the per-category factors. A completion is a     `m, recalibrate(), _save() (+1 more)

### Community 28 - "ESLint Flat Config"
Cohesion: 0.40
Nodes (9): applyTheme(), backspace(), finish(), nextDelayAfter(), placeCaret(), runNode(), setFx(), start() (+1 more)

### Community 29 - "Package Init"
Cohesion: 0.22
Nodes (8): extends, rules, alpha-value-notation, color-function-alias-notation, color-function-notation, declaration-block-single-line-max-declarations, font-family-no-missing-generic-family-keyword, no-descending-specificity

### Community 30 - "Community 30"
Cohesion: 0.39
Nodes (7): armUnlock(), ensurePlayer(), mountButton(), ready(), setOn(), speak(), unlock()

### Community 31 - "FastAPI Dep"
Cohesion: 0.39
Nodes (7): _body(), Exec-voice wiring smoke tests (HTTP — no browser).  The GLaDOS voice is delivere, A page loading exec-voice.js must also load its deps, and vice-versa the     lis, test_other_protected_pages_load_listener_voice(), test_planning_pages_load_panel_voice(), test_tarot_and_hosaka_have_no_exec_voice(), test_voice_deps_never_appear_without_exec_voice()

### Community 32 - "Tarot Package Init"
Cohesion: 0.39
Nodes (5): enableSilentModePlayback(), flush(), openSocket(), speak(), unlock()

### Community 33 - "MTG Package Init"
Cohesion: 0.43
Nodes (4): _collectAndPatch(), _parseMD(), _patch(), _resolve()

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): devDependencies, eslint, @eslint/js, globals, type

### Community 35 - "Community 35"
Cohesion: 0.60
Nodes (5): addTodo(), checkOff(), esc(), loadTodos(), renderItem()

### Community 36 - "Community 36"
Cohesion: 0.50
Nodes (5): _advance_recurrence(), _next_recurrence(), Advance a date by one recurrence step. None for unknown type., Next ISO date for a recurring card.      Advances one step from the card's due_d, date

### Community 37 - "Community 37"
Cohesion: 0.50
Nodes (3): push_to_monitor(), Exec-bubble SSE fan-out — shared by the monitor (main) and the nudge loop., Push a payload to all exec-bubble SSE subscribers.

### Community 56 - "Community 56"
Cohesion: 0.11
Nodes (17): API endpoints, Cron, Docker volumes, Droplet, Exec chat tools (bubble overlay), exec-fn, Exec monitor, File map (+9 more)

## Knowledge Gaps
- **90 isolated node(s):** `RULES — READ FIRST`, `System overview`, `File map`, `Terminology`, `Pages` (+85 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Request` connect `Community 0` to `Community 4`, `Community 5`, `Community 8`, `Card Image Downloader`, `Container Entrypoint`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `graph_page()` connect `Community 8` to `Community 0`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `_now_et()` connect `Tarot Core Framework` to `Tarot Reader Engine`, `Community 4`, `Community 36`, `Card Image Downloader`, `MTG Rules Compressor`, `Module Import Graph (doc)`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `_now_et()` (e.g. with `_build_chat_system_prompt()` and `_tool_advance_chunk()`) actually correct?**
  _`_now_et()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `RULES — READ FIRST`, `System overview`, `File map` to the rest of the system?**
  _213 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05267778753292362 - nodes in this community are weakly interconnected._