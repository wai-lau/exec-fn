# Graph Report - /home/wai/src/exec-fn  (2026-06-26)

## Corpus Check
- Large corpus: 240 files · ~4,607,906 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 912 nodes · 1618 edges · 56 communities (44 shown, 12 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 252 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3ab6c030`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_routes views.py|routes views.py]]
- [[_COMMUNITY_prophecies-groups.js|prophecies-groups.js]]
- [[_COMMUNITY_tarot-view.js|tarot-view.js]]
- [[_COMMUNITY_datetime|datetime]]
- [[_COMMUNITY_load rd()|load rd()]]
- [[_COMMUNITY_routes.py|routes.py]]
- [[_COMMUNITY_now et()|now et()]]
- [[_COMMUNITY_routes.py|routes.py]]
- [[_COMMUNITY_graph scrub.py|graph scrub.py]]
- [[_COMMUNITY_exec-bubble.js|exec-bubble.js]]
- [[_COMMUNITY_mtg.js|mtg.js]]
- [[_COMMUNITY_kanban.js|kanban.js]]
- [[_COMMUNITY_test tarot progression.py|test tarot progression.py]]
- [[_COMMUNITY_$()|$()]]
- [[_COMMUNITY_routes api.py|routes api.py]]
- [[_COMMUNITY_graph-overlay.js|graph-overlay.js]]
- [[_COMMUNITY_color.js|color.js]]
- [[_COMMUNITY_test smoke.py|test smoke.py]]
- [[_COMMUNITY_gcal.py|gcal.py]]
- [[_COMMUNITY_monitor.py|monitor.py]]
- [[_COMMUNITY_debug.js|debug.js]]
- [[_COMMUNITY_bulk update scheduled days()|bulk update scheduled days()]]
- [[_COMMUNITY_conftest.py|conftest.py]]
- [[_COMMUNITY_test exec voice browser.py|test exec voice browser.py]]
- [[_COMMUNITY_card-graph.js|card-graph.js]]
- [[_COMMUNITY_lint-colors.py|lint-colors.py]]
- [[_COMMUNITY_routes tts.py|routes tts.py]]
- [[_COMMUNITY_recalibration.py|recalibration.py]]
- [[_COMMUNITY_recruiter.js|recruiter.js]]
- [[_COMMUNITY_rules|rules]]
- [[_COMMUNITY_exec-voice.js|exec-voice.js]]
- [[_COMMUNITY_test exec voice.py|test exec voice.py]]
- [[_COMMUNITY_hosaka-audio.js|hosaka-audio.js]]
- [[_COMMUNITY_card-dialog.js|card-dialog.js]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_exec-todos.js|exec-todos.js]]
- [[_COMMUNITY_next recurrence()|next recurrence()]]
- [[_COMMUNITY_push to monitor()|push to monitor()]]
- [[_COMMUNITY_tts-watchdog.sh|tts-watchdog.sh]]
- [[_COMMUNITY_subset cv fonts.py|subset cv fonts.py]]
- [[_COMMUNITY_exec-link.js|exec-link.js]]
- [[_COMMUNITY_entrypoint.sh|entrypoint.sh]]
- [[_COMMUNITY_morning cron.sh|morning cron.sh]]
- [[_COMMUNITY_api nudge tick()|api nudge tick()]]
- [[_COMMUNITY_bootstrap.sh|bootstrap.sh]]
- [[_COMMUNITY_docs-commit-guard.sh script|docs-commit-guard.sh script]]
- [[_COMMUNITY_session-start.sh script|session-start.sh script]]
- [[_COMMUNITY_install-hooks.sh script|install-hooks.sh script]]
- [[_COMMUNITY_tarot-music.js|tarot-music.js]]
- [[_COMMUNITY_tarot-voice.js|tarot-voice.js]]

## God Nodes (most connected - your core abstractions)
1. `_load_rd()` - 26 edges
2. `$()` - 23 edges
3. `_now_et()` - 22 edges
4. `_save_rd()` - 20 edges
5. `_load_json()` - 14 edges
6. `_find_card()` - 14 edges
7. `_append_rd_log()` - 13 edges
8. `build_morning()` - 13 edges
9. `api_rd_patch()` - 13 edges
10. `_tmpl()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `classify_card()` --calls--> `_parse_json()`  [INFERRED]
  api/card_llm.py → api/helpers.py
- `_build_chat_system_prompt()` --calls--> `_load_json()`  [INFERRED]
  api/chat.py → api/helpers.py
- `_build_chat_system_prompt()` --calls--> `_load_rd()`  [INFERRED]
  api/chat.py → api/helpers.py
- `_run_monitor()` --calls--> `append_monitor_comment()`  [INFERRED]
  api/monitor.py → api/chat.py
- `_fire_nudge()` --calls--> `append_monitor_comment()`  [INFERRED]
  api/nudge_loop.py → api/chat.py

## Import Cycles
- None detected.

## Communities (56 total, 12 thin omitted)

### Community 0 - "routes views.py"
Cohesion: 0.05
Nodes (58): require_auth(), require_guest_auth(), classify_card(), parse_date_natural(), Card-creation LLM helpers: classify a new card's category + importance, and pars, _cache_control(), _lifespan(), FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.  Routes l (+50 more)

### Community 1 - "prophecies-groups.js"
Cohesion: 0.05
Nodes (50): bookBarColors(), CARD_CATS, cardStyle(), _catKey(), chipStyle(), _remChipHtml(), buildBoard(), buildSchedule() (+42 more)

### Community 2 - "tarot-view.js"
Cohesion: 0.05
Nodes (56): _canType(), _caretOffset(), _caretToEnd(), focusInput(), _focusNow(), _inputBar, _inputCursor, _msgInput (+48 more)

### Community 3 - "datetime"
Cohesion: 0.07
Nodes (57): active_label(), clear_awaiting_focused(), active_anchor(), assign_auto_deadlines(), _back_schedule(), card_deadline(), compute_deadlines(), ensure_event_terminal() (+49 more)

### Community 4 - "load rd()"
Cohesion: 0.08
Nodes (50): _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _nudge_resched_blocked(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., Due dates are protected: an active-nudge card can't be deferred without the, _tool_advance_chunk(), _tool_create_card() (+42 more)

### Community 5 - "routes.py"
Cohesion: 0.07
Nodes (34): Any, get_chat(), api_chat(), api_chat_get(), ChatBody, Stream follow-up assistant turn after tool results., _stream_tool_followup(), BaseModel (+26 more)

### Community 6 - "now et()"
Cohesion: 0.09
Nodes (32): _active_nudge_block(), append_monitor_comment(), _build_chat_system_prompt(), _dedupe_context(), _focused_nudge_card(), Most-recently-nudged card with an active nudge loop., get_rd_log(), _now_et() (+24 more)

### Community 7 - "routes.py"
Cohesion: 0.09
Nodes (30): The three top-level APIRouters, shared by every route module.  Defined here (not, _err(), Two passes. Pass 1 (research) runs the tool loop with its prose discarded —, stream_chat(), _card_summary(), _keyword_rules(), _load_cards(), _load_rulings() (+22 more)

### Community 8 - "graph scrub.py"
Cohesion: 0.11
Nodes (32): _apply_legend_renames(), _apply_node_renames(), _array_re(), _community_renames(), _dominant_community_name(), _drop_graph_book_nodes(), _drop_graph_moltbook_nodes(), _drop_graph_vendor_nodes() (+24 more)

### Community 9 - "exec-bubble.js"
Cohesion: 0.15
Nodes (27): addMsg(), addStreamDiv(), armFirstGestureFocus(), buildBubble(), buildPanel(), _caretOffset(), closePanel(), connectMonitorStream() (+19 more)

### Community 10 - "mtg.js"
Cohesion: 0.11
Nodes (26): addMsg(), addStreamDiv(), _caretOffset(), _imgCache, _inputBar, _inputCursor, _linkifyRules(), messages (+18 more)

### Community 11 - "kanban.js"
Cohesion: 0.12
Nodes (22): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, _compositeBg() (+14 more)

### Community 12 - "test tarot progression.py"
Cohesion: 0.22
Nodes (21): assert_recovered(), fulfill_sse(), open_tarot(), Tarot reading-progression tests (WebKit / playwright).  The /tarot reader is a c, Open /tarot in a fresh context with the boundaries mocked.      `chat_handler` a, The querent can act again: not streaming, input unblocked, nothing held., Frame events as the SSE the reader stream emits: `data: <json>\\n\\n`., A /api/tarot/chat route handler that streams `body` as 200 event-stream. (+13 more)

### Community 13 - "$()"
Cohesion: 0.13
Nodes (22): connect(), $(), applySpeedCap(), applyVolume(), checkHealth(), CLONE_BACKENDS, loadVoices(), mountPresence() (+14 more)

### Community 14 - "routes api.py"
Cohesion: 0.17
Nodes (19): _load_json(), api_context(), api_context_patch(), api_profile(), api_rd(), api_rd_patch(), api_todos(), api_todos_add() (+11 more)

### Community 15 - "graph-overlay.js"
Cohesion: 0.20
Nodes (17): addToggles(), buildPhysicsColumn(), clusterSpan(), focusRandomCluster(), go(), hideOrphans(), initTour(), isRedacted() (+9 more)

### Community 16 - "color.js"
Cohesion: 0.17
Nodes (15): buildColumns(), CAT_DESC, categoryTokens(), esc(), groupHtml(), loadColors(), mergedSites(), nearestSize() (+7 more)

### Community 17 - "test smoke.py"
Cohesion: 0.14
Nodes (5): _is_page(), Page smoke tests — every HTML route loads (or redirects) per its auth tier.  Cat, test_guest_loads_with_guest_bearer(), test_protected_loads_with_admin(), test_public_page_loads()

### Community 18 - "gcal.py"
Cohesion: 0.21
Nodes (15): create_gcal_event(), _dedup_key(), fetch_calendar_events(), _fetch_gcal_raw_full(), _fetch_ics_events(), fetch_omens(), gcal_complete_auth(), _gcal_creds() (+7 more)

### Community 19 - "monitor.py"
Cohesion: 0.22
Nodes (13): _build_context(), _entry_is_significant(), _entry_line(), flush_monitor(), generate_encouragement(), _is_commentable(), Trailing debounce: each call resets the 60s timer., Fire the monitor now if significant activity exists since the last     comment ( (+5 more)

### Community 20 - "debug.js"
Cohesion: 0.22
Nodes (9): loadDebug(), profileNotes, renderLogs(), renderMoltbook(), renderMtg(), renderProfile(), renderProfileSection(), renderTarot() (+1 more)

### Community 21 - "bulk update scheduled days()"
Cohesion: 0.21
Nodes (12): bulk_update_scheduled_days(), get_prophecies_log(), get_week_data(), log_prophecy_change(), _logical_today(), Yesterday if before 4:30 AM ET, matching client isoToday()., Return cards scheduled for 7 days starting from start_iso (default logical today, Apply list of {id, scheduled_day?, order?} updates to rd.json. (+4 more)

### Community 22 - "conftest.py"
Cohesion: 0.15
Nodes (7): admin_cookie(), base_url(), _key(), Smoke-test fixtures.  These run against the LIVE app (the running container on :, Env var first; fall back to the repo .env (same host, same secrets)., Probe the live app once; skip the whole suite if it isn't reachable., Full-auth via the SESSION COOKIE (what a real logged-in browser sends).      Som

### Community 23 - "test exec voice browser.py"
Cohesion: 0.27
Nodes (8): _open_panel(), open_rd(), Exec-voice behaviour tests (WebKit / playwright).  Proves the GLaDOS voice actua, Open /rd (the planning panel) with the TTS boundary + chat mocked., _spoken(), test_assistant_reply_is_spoken_in_glados(), test_muted_player_stays_silent(), test_speak_strips_markdown_and_brackets()

### Community 24 - "card-graph.js"
Cohesion: 0.28
Nodes (11): cgDraw(), cgNodeEl(), computeOffsets(), firstOpen(), fmtClock(), freezeOffsets(), layerOf(), masterStartOf() (+3 more)

### Community 25 - "lint-colors.py"
Cohesion: 0.35
Nodes (11): _akey(), check(), _defined_tokens(), _load_baseline(), main(), Drop block + HTML comments so example/placeholder tokens in prose (e.g.     chro, Per-token used alphas {token: {alpha_key}}, mirroring /api/color/usage., _scan_paths() (+3 more)

### Community 26 - "routes tts.py"
Cohesion: 0.25
Nodes (9): _broadcast_presence(), _pump_to_client(), _pump_to_upstream(), TTS page + WebSocket reverse-proxy to the home GPU server.  The TTS models (Koko, Is the home-box TTS upstream reachable. The reverse-tunnel listener stays     bo, tts_health(), ws_presence(), ws_tts() (+1 more)

### Community 27 - "recalibration.py"
Cohesion: 0.29
Nodes (9): factor_for(), _load(), Lateness recalibration.  Consumes the `late` telemetry that lands on archive mov, Lateness factor for a card's category (1.0 if unknown / never late)., Per-completion target the EMA pulls toward., Fold a day's completions into the per-category factors. A completion is a     `m, recalibrate(), _save() (+1 more)

### Community 28 - "recruiter.js"
Cohesion: 0.40
Nodes (9): applyTheme(), backspace(), finish(), nextDelayAfter(), placeCaret(), runNode(), setFx(), start() (+1 more)

### Community 29 - "rules"
Cohesion: 0.22
Nodes (8): extends, rules, alpha-value-notation, color-function-alias-notation, color-function-notation, declaration-block-single-line-max-declarations, font-family-no-missing-generic-family-keyword, no-descending-specificity

### Community 30 - "exec-voice.js"
Cohesion: 0.39
Nodes (7): armUnlock(), ensurePlayer(), mountButton(), ready(), setOn(), speak(), unlock()

### Community 31 - "test exec voice.py"
Cohesion: 0.39
Nodes (7): _body(), Exec-voice wiring smoke tests (HTTP — no browser).  The GLaDOS voice is delivere, A page loading exec-voice.js must also load its deps, and vice-versa the     lis, test_other_protected_pages_load_listener_voice(), test_planning_pages_load_panel_voice(), test_tarot_and_hosaka_have_no_exec_voice(), test_voice_deps_never_appear_without_exec_voice()

### Community 32 - "hosaka-audio.js"
Cohesion: 0.39
Nodes (5): enableSilentModePlayback(), flush(), openSocket(), speak(), unlock()

### Community 33 - "card-dialog.js"
Cohesion: 0.43
Nodes (4): _collectAndPatch(), _parseMD(), _patch(), _resolve()

### Community 34 - "devDependencies"
Cohesion: 0.33
Nodes (5): devDependencies, eslint, @eslint/js, globals, type

### Community 35 - "exec-todos.js"
Cohesion: 0.60
Nodes (5): addTodo(), checkOff(), esc(), loadTodos(), renderItem()

### Community 36 - "next recurrence()"
Cohesion: 0.50
Nodes (5): _advance_recurrence(), _next_recurrence(), Advance a date by one recurrence step. None for unknown type., Next ISO date for a recurring card.      Advances one step from the card's due_d, date

### Community 37 - "push to monitor()"
Cohesion: 0.50
Nodes (3): push_to_monitor(), Exec-bubble SSE fan-out — shared by the monitor (main) and the nudge loop., Push a payload to all exec-bubble SSE subscribers.

## Knowledge Gaps
- **75 isolated node(s):** `docs-commit-guard.sh script`, `session-start.sh script`, `extends`, `no-descending-specificity`, `font-family-no-missing-generic-family-keyword` (+70 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `graph_page()` connect `graph scrub.py` to `routes views.py`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `_now_et()` connect `now et()` to `datetime`, `load rd()`, `next recurrence()`, `routes api.py`, `monitor.py`, `recalibration.py`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `api_rd_patch()` connect `routes api.py` to `routes views.py`, `load rd()`, `next recurrence()`, `now et()`, `monitor.py`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `_now_et()` (e.g. with `_build_chat_system_prompt()` and `_tool_advance_chunk()`) actually correct?**
  _`_now_et()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `docs-commit-guard.sh script`, `session-start.sh script`, `extends` to the rest of the system?**
  _198 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `routes views.py` be split into smaller, more focused modules?**
  _Cohesion score 0.05267778753292362 - nodes in this community are weakly interconnected._