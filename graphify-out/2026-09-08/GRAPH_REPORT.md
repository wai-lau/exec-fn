# Graph Report - /home/wai/src/exec-fn  (2026-06-27)

## Corpus Check
- 94 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1071 nodes · 1877 edges · 59 communities (48 shown, 11 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 301 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_routes_views.py|routes_views.py]]
- [[_COMMUNITY_datetime|datetime]]
- [[_COMMUNITY_hq-groups.js|hq-groups.js]]
- [[_COMMUNITY_tarot-view.js|tarot-view.js]]
- [[_COMMUNITY_prophecies-groups.js|prophecies-groups.js]]
- [[_COMMUNITY_routes.py|routes.py]]
- [[_COMMUNITY_routes_api.py|routes_api.py]]
- [[_COMMUNITY__now_et()|_now_et()]]
- [[_COMMUNITY_routes.py|routes.py]]
- [[_COMMUNITY_graph_scrub.py|graph_scrub.py]]
- [[_COMMUNITY_exec-bubble.js|exec-bubble.js]]
- [[_COMMUNITY_tts.js|tts.js]]
- [[_COMMUNITY_mtg.js|mtg.js]]
- [[_COMMUNITY_routes_tts.py|routes_tts.py]]
- [[_COMMUNITY_kanban.js|kanban.js]]
- [[_COMMUNITY_rd.js|rd.js]]
- [[_COMMUNITY__load_rd()|_load_rd()]]
- [[_COMMUNITY_test_tarot_progression.py|test_tarot_progression.py]]
- [[_COMMUNITY_nudge_loop.py|nudge_loop.py]]
- [[_COMMUNITY_graph-overlay.js|graph-overlay.js]]
- [[_COMMUNITY_exec-fn|exec-fn]]
- [[_COMMUNITY_color.js|color.js]]
- [[_COMMUNITY_test_smoke.py|test_smoke.py]]
- [[_COMMUNITY_gcal.py|gcal.py]]
- [[_COMMUNITY_helpers.py|helpers.py]]
- [[_COMMUNITY_prophecies.py|prophecies.py]]
- [[_COMMUNITY_debug.js|debug.js]]
- [[_COMMUNITY_conftest.py|conftest.py]]
- [[_COMMUNITY_test_exec_voice_browser.py|test_exec_voice_browser.py]]
- [[_COMMUNITY_card-graph.js|card-graph.js]]
- [[_COMMUNITY_lint-colors.py|lint-colors.py]]
- [[_COMMUNITY_bulk_update_scheduled_days()|bulk_update_scheduled_days()]]
- [[_COMMUNITY_recalibration.py|recalibration.py]]
- [[_COMMUNITY_exec-voice.js|exec-voice.js]]
- [[_COMMUNITY_recruiter.js|recruiter.js]]
- [[_COMMUNITY_rules|rules]]
- [[_COMMUNITY_test_exec_voice.py|test_exec_voice.py]]
- [[_COMMUNITY_hosaka-audio.js|hosaka-audio.js]]
- [[_COMMUNITY_card-dialog.js|card-dialog.js]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_exec-todos.js|exec-todos.js]]
- [[_COMMUNITY_tts-watchdog.sh|tts-watchdog.sh]]
- [[_COMMUNITY_subset_cv_fonts.py|subset_cv_fonts.py]]
- [[_COMMUNITY_exec-link.js|exec-link.js]]
- [[_COMMUNITY_entrypoint.sh|entrypoint.sh]]
- [[_COMMUNITY_morning_cron.sh|morning_cron.sh]]
- [[_COMMUNITY_bootstrap.sh|bootstrap.sh]]
- [[_COMMUNITY_docs-commit-guard.sh script|docs-commit-guard.sh script]]
- [[_COMMUNITY_session-start.sh script|session-start.sh script]]
- [[_COMMUNITY_install-hooks.sh script|install-hooks.sh script]]
- [[_COMMUNITY_tarot-music.js|tarot-music.js]]
- [[_COMMUNITY_tarot-voice.js|tarot-voice.js]]

## God Nodes (most connected - your core abstractions)
1. `_load_rd()` - 29 edges
2. `_now_et()` - 22 edges
3. `_save_rd()` - 21 edges
4. `exec-fn` - 14 edges
5. `_load_json()` - 14 edges
6. `_find_card()` - 14 edges
7. `_append_rd_log()` - 14 edges
8. `build_morning()` - 13 edges
9. `api_rd_patch()` - 12 edges
10. `cardStyle()` - 12 edges

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

## Communities (59 total, 11 thin omitted)

### Community 0 - "routes_views.py"
Cohesion: 0.05
Nodes (61): True iff Cloudflare attests the Turnstile token. Empty token short-circuits, require_auth(), require_guest_auth(), verify_turnstile(), classify_card(), parse_date_natural(), Card-creation LLM helpers: classify a new card's category + importance, and pars, _cache_control() (+53 more)

### Community 1 - "datetime"
Cohesion: 0.06
Nodes (66): _day_window(), _prep_min(), Minutes of decomposed lead-up before the event block (0 if unset)., Minutes of the atomic event block = estimated_time minus prep (never < 0)., Most recent 4:30 AM ET expressed as a naive UTC datetime., (yesterday 4:30 AM ET, now) as naive UTC datetimes., _rollover_cutoff(), _work_min() (+58 more)

### Community 2 - "hq-groups.js"
Cohesion: 0.05
Nodes (54): bookBarColors(), CARD_CATS, cardStyle(), _catKey(), chipStyle(), buildBoard(), buildSchedule(), consult_oracle() (+46 more)

### Community 3 - "tarot-view.js"
Cohesion: 0.05
Nodes (56): _canType(), _caretOffset(), _caretToEnd(), focusInput(), _focusNow(), _inputBar, _inputCursor, _msgInput (+48 more)

### Community 4 - "prophecies-groups.js"
Cohesion: 0.06
Nodes (44): buildBoard(), buildSchedule(), consult_oracle(), dayCellHtml(), flushUpdates(), initSortable(), load(), queueUpdate() (+36 more)

### Community 5 - "routes.py"
Cohesion: 0.06
Nodes (36): Any, get_chat(), api_chat(), api_chat_get(), ChatBody, _dispatch_tools(), Stream follow-up assistant turn after tool results., Run each tool_use block: stream a tool_call SSE event, collect its     tool_resu (+28 more)

### Community 6 - "routes_api.py"
Cohesion: 0.08
Nodes (39): _load_json(), _build_context(), _entry_is_significant(), _entry_line(), flush_monitor(), generate_encouragement(), _is_commentable(), Trailing debounce: each call resets the 60s timer. (+31 more)

### Community 7 - "_now_et()"
Cohesion: 0.09
Nodes (34): _active_nudge_block(), append_monitor_comment(), _build_chat_system_prompt(), _dedupe_context(), _focused_nudge_card(), Most-recently-nudged card with an active nudge loop., _now_et(), _parse_json() (+26 more)

### Community 8 - "routes.py"
Cohesion: 0.09
Nodes (30): The three top-level APIRouters, shared by every route module.  Defined here (not, _err(), Two passes. Pass 1 (research) runs the tool loop with its prose discarded —, stream_chat(), _card_summary(), _keyword_rules(), _load_cards(), _load_rulings() (+22 more)

### Community 9 - "graph_scrub.py"
Cohesion: 0.09
Nodes (35): _array_re(), _drop_graph_book_nodes(), _drop_graph_library_nodes(), _drop_graph_moltbook_nodes(), _drop_graph_vendor_nodes(), _fix_graph_stats(), _friendly_dir(), _loc_by_node_id() (+27 more)

### Community 10 - "exec-bubble.js"
Cohesion: 0.15
Nodes (27): addMsg(), addStreamDiv(), armFirstGestureFocus(), buildBubble(), buildPanel(), _caretOffset(), closePanel(), connectMonitorStream() (+19 more)

### Community 11 - "tts.js"
Cohesion: 0.12
Nodes (25): connect(), applyHealth(), applySpeedCap(), applyVolume(), backendLive(), checkHealth(), CLONE_BACKENDS, health (+17 more)

### Community 12 - "mtg.js"
Cohesion: 0.11
Nodes (26): addMsg(), addStreamDiv(), _caretOffset(), _imgCache, _inputBar, _inputCursor, _linkifyRules(), messages (+18 more)

### Community 13 - "routes_tts.py"
Cohesion: 0.10
Nodes (23): _broadcast_presence(), _pump_to_client(), TTS page + WebSocket reverse-proxy to the home GPU server.  The TTS models (Koko, Lazily open and cache one upstream WS per backend URL., Forward client messages to the right upstream, routed per utterance., ok if EITHER upstream answers. Glados alone (home box down) is still ok;     the, tts_health(), tts_voices() (+15 more)

### Community 14 - "kanban.js"
Cohesion: 0.12
Nodes (22): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, _compositeBg() (+14 more)

### Community 15 - "rd.js"
Cohesion: 0.12
Nodes (22): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, _compositeBg() (+14 more)

### Community 16 - "_load_rd()"
Cohesion: 0.23
Nodes (23): _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _nudge_resched_blocked(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., Due dates are protected: an active-nudge card can't be deferred without the, _tool_advance_chunk(), _tool_create_card() (+15 more)

### Community 17 - "test_tarot_progression.py"
Cohesion: 0.22
Nodes (21): assert_recovered(), fulfill_sse(), open_tarot(), Tarot reading-progression tests (WebKit / playwright).  The /tarot reader is a c, Open /tarot in a fresh context with the boundaries mocked.      `chat_handler` a, The querent can act again: not streaming, input unblocked, nothing held., Frame events as the SSE the reader stream emits: `data: <json>\\n\\n`., A /api/tarot/chat route handler that streams `body` as 200 event-stream. (+13 more)

### Community 18 - "nudge_loop.py"
Cohesion: 0.13
Nodes (19): _arm_nudge(), _build_graph(), _due_kind(), _fire_nudge(), _nudge_tick(), In-process nudge loop (the asyncio ticker) — engine lives in nudge.py.  Extracte, Actionable hq cards without a breakdown — everything in hq gets a plan., Silent decompose (no nudge sent) for an hq card missing its plan. (+11 more)

### Community 19 - "graph-overlay.js"
Cohesion: 0.20
Nodes (17): addToggles(), buildPhysicsColumn(), clusterSpan(), focusRandomCluster(), go(), hideOrphans(), initTour(), isRedacted() (+9 more)

### Community 20 - "exec-fn"
Cohesion: 0.11
Nodes (17): API endpoints, Cron, Docker volumes, Droplet, Exec chat tools (bubble overlay), exec-fn, Exec monitor, File map (+9 more)

### Community 21 - "color.js"
Cohesion: 0.17
Nodes (15): buildColumns(), CAT_DESC, categoryTokens(), esc(), groupHtml(), loadColors(), mergedSites(), nearestSize() (+7 more)

### Community 22 - "test_smoke.py"
Cohesion: 0.14
Nodes (5): _is_page(), Page smoke tests — every HTML route loads (or redirects) per its auth tier.  Cat, test_guest_loads_with_guest_cookie(), test_protected_loads_with_admin(), test_public_page_loads()

### Community 23 - "gcal.py"
Cohesion: 0.21
Nodes (15): create_gcal_event(), _dedup_key(), fetch_calendar_events(), _fetch_gcal_raw_full(), _fetch_ics_events(), fetch_omens(), gcal_complete_auth(), _gcal_creds() (+7 more)

### Community 24 - "helpers.py"
Cohesion: 0.16
Nodes (11): _tool_update_context(), _advance_recurrence(), _append_rd_log_batch(), _apply_context_update(), _migrate_cards(), _next_recurrence(), _parse_file_ts(), Advance a date by one recurrence step. None for unknown type. (+3 more)

### Community 25 - "prophecies.py"
Cohesion: 0.19
Nodes (13): get_rd_log(), get_hq_log(), bulk_update_scheduled_days(), get_prophecies_log(), get_week_data(), log_prophecy_change(), _logical_today(), Yesterday if before 4:30 AM ET, matching client isoToday(). (+5 more)

### Community 26 - "debug.js"
Cohesion: 0.22
Nodes (9): loadDebug(), profileNotes, renderLogs(), renderMoltbook(), renderMtg(), renderProfile(), renderProfileSection(), renderTarot() (+1 more)

### Community 27 - "conftest.py"
Cohesion: 0.15
Nodes (9): admin_cookie(), base_url(), guest_cookie(), _key(), Smoke-test fixtures.  These run against the LIVE app (the running container on :, Env var first; fall back to the repo .env (same host, same secrets)., Probe the live app once; skip the whole suite if it isn't reachable., Guest tier via the guest_session cookie a real Turnstile solve would set.      T (+1 more)

### Community 28 - "test_exec_voice_browser.py"
Cohesion: 0.27
Nodes (8): _open_panel(), open_rd(), Exec-voice behaviour tests (WebKit / playwright).  Proves the GLaDOS voice actua, Open /rd (the planning panel) with the TTS boundary + chat mocked., _spoken(), test_assistant_reply_is_spoken_in_glados(), test_muted_player_stays_silent(), test_speak_strips_markdown_and_brackets()

### Community 29 - "card-graph.js"
Cohesion: 0.28
Nodes (11): cgDraw(), cgNodeEl(), computeOffsets(), firstOpen(), fmtClock(), freezeOffsets(), layerOf(), masterStartOf() (+3 more)

### Community 30 - "lint-colors.py"
Cohesion: 0.35
Nodes (11): _akey(), check(), _defined_tokens(), _load_baseline(), main(), Drop block + HTML comments so example/placeholder tokens in prose (e.g.     chro, Per-token used alphas {token: {alpha_key}}, mirroring /api/color/usage., _scan_paths() (+3 more)

### Community 31 - "bulk_update_scheduled_days()"
Cohesion: 0.25
Nodes (10): bulk_update_scheduled_days(), get_week_data(), log_hq_change(), _logical_today(), Yesterday if before 4:30 AM ET, matching client isoToday()., Return cards scheduled for 7 days starting from start_iso (default logical today, Apply list of {id, scheduled_day?, order?} updates to rd.json., _today_iso() (+2 more)

### Community 32 - "recalibration.py"
Cohesion: 0.29
Nodes (9): factor_for(), _load(), Lateness recalibration.  Consumes the `late` telemetry that lands on archive mov, Lateness factor for a card's category (1.0 if unknown / never late)., Per-completion target the EMA pulls toward., Fold a day's completions into the per-category factors. A completion is a     `m, recalibrate(), _save() (+1 more)

### Community 33 - "exec-voice.js"
Cohesion: 0.36
Nodes (8): armUnlock(), ensurePlayer(), mark(), mountButton(), ready(), setOn(), speak(), unlock()

### Community 34 - "recruiter.js"
Cohesion: 0.40
Nodes (9): applyTheme(), backspace(), finish(), nextDelayAfter(), placeCaret(), runNode(), setFx(), start() (+1 more)

### Community 35 - "rules"
Cohesion: 0.22
Nodes (8): extends, rules, alpha-value-notation, color-function-alias-notation, color-function-notation, declaration-block-single-line-max-declarations, font-family-no-missing-generic-family-keyword, no-descending-specificity

### Community 36 - "test_exec_voice.py"
Cohesion: 0.39
Nodes (7): _body(), Exec-voice wiring smoke tests (HTTP — no browser).  The GLaDOS voice is delivere, A page loading exec-voice.js must also load its deps, and vice-versa the     lis, test_other_protected_pages_load_listener_voice(), test_planning_pages_load_panel_voice(), test_tarot_and_hosaka_have_no_exec_voice(), test_voice_deps_never_appear_without_exec_voice()

### Community 37 - "hosaka-audio.js"
Cohesion: 0.39
Nodes (5): enableSilentModePlayback(), flush(), openSocket(), speak(), unlock()

### Community 38 - "card-dialog.js"
Cohesion: 0.43
Nodes (4): _collectAndPatch(), _parseMD(), _patch(), _resolve()

### Community 39 - "devDependencies"
Cohesion: 0.33
Nodes (5): devDependencies, eslint, @eslint/js, globals, type

### Community 40 - "exec-todos.js"
Cohesion: 0.60
Nodes (5): addTodo(), checkOff(), esc(), loadTodos(), renderItem()

## Knowledge Gaps
- **98 isolated node(s):** `RULES — READ FIRST`, `System overview`, `File map`, `Terminology`, `Pages` (+93 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `graph_page()` connect `routes_views.py` to `graph_scrub.py`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `cardStyle()` connect `hq-groups.js` to `prophecies-groups.js`, `kanban.js`, `rd.js`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `_load_rd()` connect `_load_rd()` to `datetime`, `routes_api.py`, `_now_et()`, `nudge_loop.py`, `helpers.py`, `prophecies.py`, `bulk_update_scheduled_days()`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 26 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `_now_et()` (e.g. with `_build_chat_system_prompt()` and `_tool_advance_chunk()`) actually correct?**
  _`_now_et()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `_save_rd()` (e.g. with `_apply_schedule()` and `_tool_advance_chunk()`) actually correct?**
  _`_save_rd()` has 20 INFERRED edges - model-reasoned connections that need verification._
- **What connects `RULES — READ FIRST`, `System overview`, `File map` to the rest of the system?**
  _241 weakly-connected nodes found - possible documentation gaps or missing edges._