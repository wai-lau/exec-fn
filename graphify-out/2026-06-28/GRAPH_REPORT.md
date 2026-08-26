# Graph Report - exec-fn  (2026-06-28)

## Corpus Check
- 601 files · ~9,841,856 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1077 nodes · 1881 edges · 64 communities (52 shown, 12 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 301 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `969bf74e`
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
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Claude Hooks Config|Claude Hooks Config]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Morning Cron Script|Morning Cron Script]]
- [[_COMMUNITY_Droplet Bootstrap|Droplet Bootstrap]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Session Start Hook|Session Start Hook]]
- [[_COMMUNITY_GCal OAuth Setup|GCal OAuth Setup]]
- [[_COMMUNITY_Module Import Graph (doc)|Module Import Graph (doc)]]
- [[_COMMUNITY_ESLint Flat Config|ESLint Flat Config]]
- [[_COMMUNITY_Package Init|Package Init]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Tarot Package Init|Tarot Package Init]]
- [[_COMMUNITY_Community 33|Community 33]]
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
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]

## God Nodes (most connected - your core abstractions)
1. `_load_rd()` - 29 edges
2. `Request` - 24 edges
3. `_now_et()` - 22 edges
4. `_save_rd()` - 21 edges
5. `exec-fn` - 14 edges
6. `_load_json()` - 14 edges
7. `_find_card()` - 14 edges
8. `_append_rd_log()` - 14 edges
9. `build_morning()` - 13 edges
10. `api_rd_patch()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `test_pick_upstream_kokoro_goes_home()` --calls--> `pick_upstream()`  [INFERRED]
  tests/test_tts_routing.py → api/tts_routing.py
- `test_pick_upstream_missing_backend_defaults_home()` --calls--> `pick_upstream()`  [INFERRED]
  tests/test_tts_routing.py → api/tts_routing.py
- `test_pick_upstream_non_dict_defaults_home()` --calls--> `pick_upstream()`  [INFERRED]
  tests/test_tts_routing.py → api/tts_routing.py
- `test_pick_upstream_piper_goes_to_piper()` --calls--> `pick_upstream()`  [INFERRED]
  tests/test_tts_routing.py → api/tts_routing.py
- `test_merge_voices_keeps_piper_from_piper_and_rest_from_home()` --calls--> `merge_voices()`  [INFERRED]
  tests/test_tts_routing.py → api/tts_routing.py

## Import Cycles
- None detected.

## Communities (64 total, 12 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (20): True iff Cloudflare attests the Turnstile token. Empty token short-circuits, verify_turnstile(), color_usage(), guest_login(), guest_login_alias(), guest_login_page(), _landing_html(), login() (+12 more)

### Community 1 - "Tarot Major Arcana Meanings"
Cohesion: 0.06
Nodes (66): _day_window(), _prep_min(), Minutes of decomposed lead-up before the event block (0 if unset)., Minutes of the atomic event block = estimated_time minus prep (never < 0)., Most recent 4:30 AM ET expressed as a naive UTC datetime., (yesterday 4:30 AM ET, now) as naive UTC datetimes., _rollover_cutoff(), _work_min() (+58 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (54): bookBarColors(), CARD_CATS, cardStyle(), _catKey(), chipStyle(), buildBoard(), buildSchedule(), consult_oracle() (+46 more)

### Community 3 - "Tarot Reader Engine"
Cohesion: 0.05
Nodes (56): _canType(), _caretOffset(), _caretToEnd(), focusInput(), _focusNow(), _inputBar, _inputCursor, _msgInput (+48 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (44): buildBoard(), buildSchedule(), consult_oracle(), dayCellHtml(), flushUpdates(), initSortable(), load(), queueUpdate() (+36 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (28): Any, BaseModel, stream_chat(), _load_card_chapter(), load_framework(), _load_framework_file(), load_numerology_text(), load_suits_text() (+20 more)

### Community 6 - "Tarot Core Framework"
Cohesion: 0.14
Nodes (23): _load_json(), _advanced_entries(), api_context(), api_context_patch(), api_nudge_tick(), api_profile(), api_rd(), api_rd_patch() (+15 more)

### Community 7 - "Exec Bubble UI"
Cohesion: 0.07
Nodes (43): _active_nudge_block(), append_monitor_comment(), _build_chat_system_prompt(), _dedupe_context(), _focused_nudge_card(), Most-recently-nudged card with an active nudge loop., _now_et(), _parse_json() (+35 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (30): The three top-level APIRouters, shared by every route module.  Defined here (not, _err(), Two passes. Pass 1 (research) runs the tool loop with its prose discarded —, stream_chat(), _card_summary(), _keyword_rules(), _load_cards(), _load_rulings() (+22 more)

### Community 9 - "MTG Rules Assistant"
Cohesion: 0.09
Nodes (36): _array_re(), _drop_graph_book_nodes(), _drop_graph_library_nodes(), _drop_graph_moltbook_nodes(), _drop_graph_vendor_nodes(), _fix_graph_stats(), _friendly_dir(), _loc_by_node_id() (+28 more)

### Community 10 - "Celtic Cross Spread"
Cohesion: 0.15
Nodes (27): addMsg(), addStreamDiv(), armFirstGestureFocus(), buildBubble(), buildPanel(), _caretOffset(), closePanel(), connectMonitorStream() (+19 more)

### Community 11 - "Google Calendar Sync"
Cohesion: 0.12
Nodes (25): connect(), applyHealth(), applySpeedCap(), applyVolume(), backendLive(), checkHealth(), CLONE_BACKENDS, health (+17 more)

### Community 12 - "Stylelint Config"
Cohesion: 0.11
Nodes (26): addMsg(), addStreamDiv(), _caretOffset(), _imgCache, _inputBar, _inputCursor, _linkifyRules(), messages (+18 more)

### Community 13 - "Card Edit Dialog"
Cohesion: 0.10
Nodes (23): _broadcast_presence(), _pump_to_client(), TTS page + WebSocket reverse-proxy to the home GPU server.  The TTS models (Koko, Lazily open and cache one upstream WS per backend URL., Forward client messages to the right upstream, routed per utterance., ok if EITHER upstream answers. Glados alone (home box down) is still ok;     the, tts_health(), tts_voices() (+15 more)

### Community 14 - "Card Image Downloader"
Cohesion: 0.12
Nodes (22): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, _compositeBg() (+14 more)

### Community 15 - "Authentication"
Cohesion: 0.12
Nodes (22): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, _compositeBg() (+14 more)

### Community 16 - "Community 16"
Cohesion: 0.23
Nodes (23): _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _nudge_resched_blocked(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., Due dates are protected: an active-nudge card can't be deferred without the, _tool_advance_chunk(), _tool_create_card() (+15 more)

### Community 17 - "ESLint / NPM Config"
Cohesion: 0.22
Nodes (21): assert_recovered(), fulfill_sse(), open_tarot(), Tarot reading-progression tests (WebKit / playwright).  The /tarot reader is a c, Open /tarot in a fresh context with the boundaries mocked.      `chat_handler` a, The querent can act again: not streaming, input unblocked, nothing held., Frame events as the SSE the reader stream emits: `data: <json>\\n\\n`., A /api/tarot/chat route handler that streams `body` as 200 event-stream. (+13 more)

### Community 18 - "Card Styling"
Cohesion: 0.13
Nodes (19): _arm_nudge(), _build_graph(), _due_kind(), _fire_nudge(), _nudge_tick(), In-process nudge loop (the asyncio ticker) — engine lives in nudge.py.  Extracte, Actionable hq cards without a breakdown — everything in hq gets a plan., Silent decompose (no nudge sent) for an hq card missing its plan. (+11 more)

### Community 19 - "Community 19"
Cohesion: 0.20
Nodes (17): addToggles(), buildPhysicsColumn(), clusterSpan(), focusRandomCluster(), go(), hideOrphans(), initTour(), isRedacted() (+9 more)

### Community 20 - "Claude Hooks Config"
Cohesion: 0.11
Nodes (17): API endpoints, Cron, Docker volumes, Droplet, Exec chat tools (bubble overlay), exec-fn, Exec monitor, File map (+9 more)

### Community 21 - "Community 21"
Cohesion: 0.17
Nodes (15): buildColumns(), CAT_DESC, categoryTokens(), esc(), groupHtml(), loadColors(), mergedSites(), nearestSize() (+7 more)

### Community 22 - "Morning Cron Script"
Cohesion: 0.14
Nodes (5): _is_page(), Page smoke tests — every HTML route loads (or redirects) per its auth tier.  Cat, test_guest_loads_with_guest_cookie(), test_protected_loads_with_admin(), test_public_page_loads()

### Community 23 - "Droplet Bootstrap"
Cohesion: 0.25
Nodes (13): create_gcal_event(), _dedup_key(), fetch_calendar_events(), _fetch_gcal_raw_full(), _fetch_ics_events(), fetch_omens(), gcal_complete_auth(), _gcal_creds() (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (11): _tool_update_context(), _advance_recurrence(), _append_rd_log_batch(), _apply_context_update(), _migrate_cards(), _next_recurrence(), _parse_file_ts(), Advance a date by one recurrence step. None for unknown type. (+3 more)

### Community 25 - "Session Start Hook"
Cohesion: 0.23
Nodes (11): get_rd_log(), bulk_update_scheduled_days(), get_prophecies_log(), get_week_data(), log_prophecy_change(), _logical_today(), Yesterday if before 4:30 AM ET, matching client isoToday()., Return cards scheduled for 7 days starting from start_iso (default logical today (+3 more)

### Community 26 - "GCal OAuth Setup"
Cohesion: 0.22
Nodes (9): loadDebug(), profileNotes, renderLogs(), renderMoltbook(), renderMtg(), renderProfile(), renderProfileSection(), renderTarot() (+1 more)

### Community 27 - "Module Import Graph (doc)"
Cohesion: 0.15
Nodes (9): admin_cookie(), base_url(), guest_cookie(), _key(), Smoke-test fixtures.  These run against the LIVE app (the running container on :, Env var first; fall back to the repo .env (same host, same secrets)., Probe the live app once; skip the whole suite if it isn't reachable., Guest tier via the guest_session cookie a real Turnstile solve would set.      T (+1 more)

### Community 28 - "ESLint Flat Config"
Cohesion: 0.27
Nodes (8): _open_panel(), open_rd(), Exec-voice behaviour tests (WebKit / playwright).  Proves the GLaDOS voice actua, Open /rd (the planning panel) with the TTS boundary + chat mocked., _spoken(), test_assistant_reply_is_spoken_in_glados(), test_muted_player_stays_silent(), test_speak_strips_markdown_and_brackets()

### Community 29 - "Package Init"
Cohesion: 0.28
Nodes (11): cgDraw(), cgNodeEl(), computeOffsets(), firstOpen(), fmtClock(), freezeOffsets(), layerOf(), masterStartOf() (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.35
Nodes (11): _akey(), check(), _defined_tokens(), _load_baseline(), main(), Drop block + HTML comments so example/placeholder tokens in prose (e.g.     chro, Per-token used alphas {token: {alpha_key}}, mirroring /api/color/usage., _scan_paths() (+3 more)

### Community 31 - "Community 31"
Cohesion: 0.23
Nodes (11): bulk_update_scheduled_days(), get_hq_log(), get_week_data(), log_hq_change(), _logical_today(), Yesterday if before 4:30 AM ET, matching client isoToday()., Return cards scheduled for 7 days starting from start_iso (default logical today, Apply list of {id, scheduled_day?, order?} updates to rd.json. (+3 more)

### Community 32 - "Tarot Package Init"
Cohesion: 0.09
Nodes (24): get_chat(), _build_context(), _entry_is_significant(), _entry_line(), flush_monitor(), generate_encouragement(), _is_commentable(), Trailing debounce: each call resets the 60s timer. (+16 more)

### Community 33 - "Community 33"
Cohesion: 0.36
Nodes (8): armUnlock(), ensurePlayer(), mark(), mountButton(), ready(), setOn(), speak(), unlock()

### Community 34 - "Community 34"
Cohesion: 0.40
Nodes (9): applyTheme(), backspace(), finish(), nextDelayAfter(), placeCaret(), runNode(), setFx(), start() (+1 more)

### Community 35 - "Community 35"
Cohesion: 0.22
Nodes (8): extends, rules, alpha-value-notation, color-function-alias-notation, color-function-notation, declaration-block-single-line-max-declarations, font-family-no-missing-generic-family-keyword, no-descending-specificity

### Community 36 - "Community 36"
Cohesion: 0.39
Nodes (7): _body(), Exec-voice wiring smoke tests (HTTP — no browser).  The GLaDOS voice is delivere, A page loading exec-voice.js must also load its deps, and vice-versa the     lis, test_other_protected_pages_load_listener_voice(), test_planning_pages_load_panel_voice(), test_tarot_and_hosaka_have_no_exec_voice(), test_voice_deps_never_appear_without_exec_voice()

### Community 37 - "Community 37"
Cohesion: 0.39
Nodes (5): enableSilentModePlayback(), flush(), openSocket(), speak(), unlock()

### Community 38 - "Community 38"
Cohesion: 0.43
Nodes (4): _collectAndPatch(), _parseMD(), _patch(), _resolve()

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (5): devDependencies, eslint, @eslint/js, globals, type

### Community 40 - "Community 40"
Cohesion: 0.60
Nodes (5): addTodo(), checkOff(), esc(), loadTodos(), renderItem()

### Community 59 - "Community 59"
Cohesion: 0.18
Nodes (17): _build_nav(), _index_pages(), Page composition: nav builder, index-shell variants, template loader.  Pure rend, Return (no_form, bare) variants of /app/static/index.html, re-read on change., _render_page(), _tmpl(), tts_page(), color_page() (+9 more)

### Community 60 - "Community 60"
Cohesion: 0.15
Nodes (14): require_auth(), require_guest_auth(), gcal_start_auth(), api_gcal_auth(), api_gcal_import_cards(), api_morning(), api_gamesave_delete(), api_gamesave_get() (+6 more)

### Community 61 - "Community 61"
Cohesion: 0.18
Nodes (12): classify_card(), parse_date_natural(), Card-creation LLM helpers: classify a new card's category + importance, and pars, _cache_control(), _lifespan(), FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.  Routes l, unauthorized_handler(), api_hq_patch() (+4 more)

### Community 62 - "Community 62"
Cohesion: 0.50
Nodes (3): hooks, PreToolUse, SessionStart

## Knowledge Gaps
- **101 isolated node(s):** `git-stash-guard.sh script`, `SessionStart`, `PreToolUse`, `RULES — READ FIRST`, `System overview` (+96 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Request` connect `Community 61` to `Community 0`, `Community 5`, `Tarot Core Framework`, `MTG Rules Assistant`, `Community 16`, `Community 59`, `Community 60`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `graph_page()` connect `MTG Rules Assistant` to `Community 0`, `Community 59`, `Community 61`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `_now_et()` connect `Exec Bubble UI` to `Tarot Package Init`, `Tarot Major Arcana Meanings`, `Tarot Core Framework`, `Community 16`, `Card Styling`, `Community 24`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Are the 26 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `_now_et()` (e.g. with `_build_chat_system_prompt()` and `_tool_advance_chunk()`) actually correct?**
  _`_now_et()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `_save_rd()` (e.g. with `_apply_schedule()` and `_tool_advance_chunk()`) actually correct?**
  _`_save_rd()` has 20 INFERRED edges - model-reasoned connections that need verification._
- **What connects `git-stash-guard.sh script`, `SessionStart`, `PreToolUse` to the rest of the system?**
  _244 weakly-connected nodes found - possible documentation gaps or missing edges._