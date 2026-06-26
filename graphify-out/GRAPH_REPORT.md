# Graph Report - /home/wai/src/exec-fn  (2026-06-26)

## Corpus Check
- Large corpus: 241 files · ~4,618,287 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 1053 nodes · 1973 edges · 70 communities (59 shown, 11 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 292 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `12db9361`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_prophecies-groups.js|prophecies-groups.js]]
- [[_COMMUNITY_tarot-view.js|tarot-view.js]]
- [[_COMMUNITY_routes api.py|routes api.py]]
- [[_COMMUNITY_routes.py|routes.py]]
- [[_COMMUNITY_vis-network-9.1.9.min.js|vis-network-9.1.9.min.js]]
- [[_COMMUNITY_routes.py|routes.py]]
- [[_COMMUNITY_exec-bubble.js|exec-bubble.js]]
- [[_COMMUNITY_graph scrub.py|graph scrub.py]]
- [[_COMMUNITY_datetime|datetime]]
- [[_COMMUNITY_mtg.js|mtg.js]]
- [[_COMMUNITY_kanban.js|kanban.js]]
- [[_COMMUNITY_load rd()|load rd()]]
- [[_COMMUNITY_test tarot progression.py|test tarot progression.py]]
- [[_COMMUNITY_yd()|yd()]]
- [[_COMMUNITY_Ib()|Ib()]]
- [[_COMMUNITY_nudge loop.py|nudge loop.py]]
- [[_COMMUNITY_g()|g()]]
- [[_COMMUNITY_graph-overlay.js|graph-overlay.js]]
- [[_COMMUNITY_color.js|color.js]]
- [[_COMMUNITY_HTTPException|HTTPException]]
- [[_COMMUNITY_routes views.py|routes views.py]]
- [[_COMMUNITY_test smoke.py|test smoke.py]]
- [[_COMMUNITY_gcal.py|gcal.py]]
- [[_COMMUNITY_scheduler.py|scheduler.py]]
- [[_COMMUNITY_$()|$()]]
- [[_COMMUNITY_helpers.py|helpers.py]]
- [[_COMMUNITY_nudge llm.py|nudge llm.py]]
- [[_COMMUNITY_Kv()|Kv()]]
- [[_COMMUNITY_tmpl()|tmpl()]]
- [[_COMMUNITY_debug.js|debug.js]]
- [[_COMMUNITY_chat.py|chat.py]]
- [[_COMMUNITY_nudge.py|nudge.py]]
- [[_COMMUNITY_conftest.py|conftest.py]]
- [[_COMMUNITY_test exec voice browser.py|test exec voice browser.py]]
- [[_COMMUNITY_card-graph.js|card-graph.js]]
- [[_COMMUNITY_lint-colors.py|lint-colors.py]]
- [[_COMMUNITY_lh()|lh()]]
- [[_COMMUNITY_Rp()|Rp()]]
- [[_COMMUNITY_now et()|now et()]]
- [[_COMMUNITY_bulk update scheduled days()|bulk update scheduled days()]]
- [[_COMMUNITY_Request|Request]]
- [[_COMMUNITY_recruiter.js|recruiter.js]]
- [[_COMMUNITY_index pages()|index pages()]]
- [[_COMMUNITY_routes tts.py|routes tts.py]]
- [[_COMMUNITY_rules|rules]]
- [[_COMMUNITY_exec-voice.js|exec-voice.js]]
- [[_COMMUNITY_test exec voice.py|test exec voice.py]]
- [[_COMMUNITY_hosaka-audio.js|hosaka-audio.js]]
- [[_COMMUNITY_card-dialog.js|card-dialog.js]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_exec-todos.js|exec-todos.js]]
- [[_COMMUNITY_mtg compress.py|mtg compress.py]]
- [[_COMMUNITY_tts-watchdog.sh|tts-watchdog.sh]]
- [[_COMMUNITY_subset cv fonts.py|subset cv fonts.py]]
- [[_COMMUNITY_exec-link.js|exec-link.js]]
- [[_COMMUNITY_entrypoint.sh|entrypoint.sh]]
- [[_COMMUNITY_morning cron.sh|morning cron.sh]]
- [[_COMMUNITY_bootstrap.sh|bootstrap.sh]]
- [[_COMMUNITY_docs-commit-guard.sh script|docs-commit-guard.sh script]]
- [[_COMMUNITY_session-start.sh script|session-start.sh script]]
- [[_COMMUNITY_install-hooks.sh script|install-hooks.sh script]]
- [[_COMMUNITY_tarot-music.js|tarot-music.js]]
- [[_COMMUNITY_tarot-voice.js|tarot-voice.js]]

## God Nodes (most connected - your core abstractions)
1. `Ib()` - 31 edges
2. `nb()` - 30 edges
3. `_load_rd()` - 26 edges
4. `_now_et()` - 22 edges
5. `_save_rd()` - 20 edges
6. `$()` - 17 edges
7. `_load_json()` - 14 edges
8. `_find_card()` - 14 edges
9. `_append_rd_log()` - 13 edges
10. `build_morning()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `classify_card()` --calls--> `_parse_json()`  [INFERRED]
  api/card_llm.py → api/helpers.py
- `_focused_nudge_card()` --calls--> `logical_today_iso()`  [INFERRED]
  api/chat.py → api/scheduler.py
- `_build_chat_system_prompt()` --calls--> `_load_json()`  [INFERRED]
  api/chat.py → api/helpers.py
- `_build_chat_system_prompt()` --calls--> `_load_rd()`  [INFERRED]
  api/chat.py → api/helpers.py
- `_build_chat_system_prompt()` --calls--> `_now_et()`  [INFERRED]
  api/chat.py → api/helpers.py

## Import Cycles
- None detected.

## Communities (70 total, 11 thin omitted)

### Community 0 - "prophecies-groups.js"
Cohesion: 0.05
Nodes (50): bookBarColors(), CARD_CATS, cardStyle(), _catKey(), chipStyle(), _remChipHtml(), buildBoard(), buildSchedule() (+42 more)

### Community 1 - "tarot-view.js"
Cohesion: 0.05
Nodes (56): _canType(), _caretOffset(), _caretToEnd(), focusInput(), _focusNow(), _inputBar, _inputCursor, _msgInput (+48 more)

### Community 2 - "routes api.py"
Cohesion: 0.06
Nodes (47): _load_json(), _build_context(), _entry_is_significant(), _entry_line(), flush_monitor(), generate_encouragement(), _is_commentable(), Trailing debounce: each call resets the 60s timer. (+39 more)

### Community 3 - "routes.py"
Cohesion: 0.07
Nodes (34): Any, get_chat(), api_chat(), api_chat_get(), ChatBody, Stream follow-up assistant turn after tool results., _stream_tool_followup(), BaseModel (+26 more)

### Community 4 - "vis-network-9.1.9.min.js"
Cohesion: 0.07
Nodes (22): Av(), Ay(), cM(), Cv(), ev(), ey(), fM(), GM() (+14 more)

### Community 5 - "routes.py"
Cohesion: 0.09
Nodes (30): The three top-level APIRouters, shared by every route module.  Defined here (not, _err(), Two passes. Pass 1 (research) runs the tool loop with its prose discarded —, stream_chat(), _card_summary(), _keyword_rules(), _load_cards(), _load_rulings() (+22 more)

### Community 6 - "exec-bubble.js"
Cohesion: 0.14
Nodes (29): Cb(), eb(), addMsg(), addStreamDiv(), armFirstGestureFocus(), buildBubble(), buildPanel(), _caretOffset() (+21 more)

### Community 7 - "graph scrub.py"
Cohesion: 0.11
Nodes (30): _apply_legend_renames(), _apply_node_renames(), _array_re(), _community_renames(), _dominant_community_name(), _drop_graph_book_nodes(), _drop_graph_moltbook_nodes(), _friendly_from_source() (+22 more)

### Community 8 - "datetime"
Cohesion: 0.13
Nodes (27): _parse_file_ts(), active_anchor(), assign_auto_deadlines(), _back_schedule(), card_deadline(), compute_deadlines(), ensure_event_terminal(), _has_fixed_deadline() (+19 more)

### Community 9 - "mtg.js"
Cohesion: 0.11
Nodes (26): addMsg(), addStreamDiv(), _caretOffset(), _imgCache, _inputBar, _inputCursor, _linkifyRules(), messages (+18 more)

### Community 10 - "kanban.js"
Cohesion: 0.12
Nodes (22): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, _compositeBg() (+14 more)

### Community 11 - "load rd()"
Cohesion: 0.23
Nodes (23): _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _nudge_resched_blocked(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., Due dates are protected: an active-nudge card can't be deferred without the, _tool_advance_chunk(), _tool_create_card() (+15 more)

### Community 12 - "test tarot progression.py"
Cohesion: 0.22
Nodes (21): assert_recovered(), fulfill_sse(), open_tarot(), Tarot reading-progression tests (WebKit / playwright).  The /tarot reader is a c, Open /tarot in a fresh context with the boundaries mocked.      `chat_handler` a, The querent can act again: not streaming, input unblocked, nothing held., Frame events as the SSE the reader stream emits: `data: <json>\\n\\n`., A /api/tarot/chat route handler that streams `body` as 200 event-stream. (+13 more)

### Community 13 - "yd()"
Cohesion: 0.13
Nodes (23): bd(), Bf(), ch(), dh(), dv(), _f(), gf(), Hf() (+15 more)

### Community 14 - "Ib()"
Cohesion: 0.17
Nodes (22): bN(), dD(), dN(), DR(), EN(), Ib(), iN(), IR() (+14 more)

### Community 15 - "nudge loop.py"
Cohesion: 0.12
Nodes (20): append_monitor_comment(), _arm_nudge(), _build_graph(), _due_kind(), _fire_nudge(), _nudge_tick(), In-process nudge loop (the asyncio ticker) — engine lives in nudge.py.  Extracte, Actionable hq cards without a breakdown — everything in hq gets a plan. (+12 more)

### Community 16 - "g()"
Cohesion: 0.12
Nodes (21): A(), Af(), AP(), BM(), bp(), cn(), d(), dM() (+13 more)

### Community 17 - "graph-overlay.js"
Cohesion: 0.20
Nodes (17): addToggles(), buildPhysicsColumn(), clusterSpan(), focusRandomCluster(), go(), hideOrphans(), initTour(), isRedacted() (+9 more)

### Community 18 - "color.js"
Cohesion: 0.17
Nodes (15): buildColumns(), CAT_DESC, categoryTokens(), esc(), groupHtml(), loadColors(), mergedSites(), nearestSize() (+7 more)

### Community 19 - "HTTPException"
Cohesion: 0.17
Nodes (13): require_auth(), require_guest_auth(), _lifespan(), FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.  Routes l, unauthorized_handler(), api_gcal_import_cards(), api_gamesave_delete(), api_gamesave_get() (+5 more)

### Community 20 - "routes views.py"
Cohesion: 0.15
Nodes (13): color_usage(), guest_login(), guest_login_alias(), login(), login_page(), HTML page routes + the read-only data GETs that back them.  Public landing/login, Admin login screen. Already-authed visitors skip it and land on their     redire, Bookmark-safe alias for the renamed /guest route. (+5 more)

### Community 21 - "test smoke.py"
Cohesion: 0.14
Nodes (5): _is_page(), Page smoke tests — every HTML route loads (or redirects) per its auth tier.  Cat, test_guest_loads_with_guest_bearer(), test_protected_loads_with_admin(), test_public_page_loads()

### Community 22 - "gcal.py"
Cohesion: 0.21
Nodes (15): create_gcal_event(), _dedup_key(), fetch_calendar_events(), _fetch_gcal_raw_full(), _fetch_ics_events(), fetch_omens(), gcal_complete_auth(), _gcal_creds() (+7 more)

### Community 23 - "scheduler.py"
Cohesion: 0.21
Nodes (15): card_duration(), is_dir_card(), layout_day(), logical_today_iso(), now_minutes(), place_card_today(), Single home for dirs-timeline scheduling (dir_start_min).  Every dir_start_min d, Yesterday if before 4:30 AM ET — matches dirs.html isoToday(). (+7 more)

### Community 24 - "$()"
Cohesion: 0.22
Nodes (15): $(), applyVolume(), checkHealth(), CLONE_BACKENDS, loadVoices(), PARAM_IDS, params(), player (+7 more)

### Community 25 - "helpers.py"
Cohesion: 0.16
Nodes (12): _tool_update_context(), _advance_recurrence(), _append_rd_log_batch(), _apply_context_update(), _day_window(), _next_recurrence(), Advance a date by one recurrence step. None for unknown type., Next ISO date for a recurring card.      Advances one step from the card's due_d (+4 more)

### Community 26 - "nudge llm.py"
Cohesion: 0.28
Nodes (14): active_label(), _active_node(), _card_brief(), decompose_sync(), _fmt_clock(), _json_call(), nudge_text_sync(), peel_sync() (+6 more)

### Community 27 - "Kv()"
Cohesion: 0.30
Nodes (15): Cy(), gy(), Hv(), jv(), Kv(), nv(), ov(), Qv() (+7 more)

### Community 28 - "tmpl()"
Cohesion: 0.24
Nodes (13): _build_nav(), Page composition: nav builder, index-shell variants, template loader.  Pure rend, _render_page(), _tmpl(), tts_page(), color_page(), debug_page(), emet_page() (+5 more)

### Community 29 - "debug.js"
Cohesion: 0.22
Nodes (9): loadDebug(), profileNotes, renderLogs(), renderMoltbook(), renderMtg(), renderProfile(), renderProfileSection(), renderTarot() (+1 more)

### Community 30 - "chat.py"
Cohesion: 0.18
Nodes (10): _active_nudge_block(), _build_chat_system_prompt(), _dedupe_context(), _focused_nudge_card(), Most-recently-nudged card with an active nudge loop., get_rd_log(), _parse_json(), Extract and parse the first JSON object or array from a string. (+2 more)

### Community 31 - "nudge.py"
Cohesion: 0.21
Nodes (12): clear_awaiting_focused(), decomposable(), default_nudge_state(), _eligible(), ensure_nudge(), _first_open(), Task-decomposition + time-based nudge loop (Phase 1).  Pure logic + LLM calls; c, First not-done node whose prerequisites (incoming edges) are all done.      An e (+4 more)

### Community 32 - "conftest.py"
Cohesion: 0.15
Nodes (7): admin_cookie(), base_url(), _key(), Smoke-test fixtures.  These run against the LIVE app (the running container on :, Env var first; fall back to the repo .env (same host, same secrets)., Probe the live app once; skip the whole suite if it isn't reachable., Full-auth via the SESSION COOKIE (what a real logged-in browser sends).      Som

### Community 33 - "test exec voice browser.py"
Cohesion: 0.27
Nodes (8): _open_panel(), open_rd(), Exec-voice behaviour tests (WebKit / playwright).  Proves the GLaDOS voice actua, Open /rd (the planning panel) with the TTS boundary + chat mocked., _spoken(), test_assistant_reply_is_spoken_in_glados(), test_muted_player_stays_silent(), test_speak_strips_markdown_and_brackets()

### Community 34 - "card-graph.js"
Cohesion: 0.28
Nodes (11): cgDraw(), cgNodeEl(), computeOffsets(), firstOpen(), fmtClock(), freezeOffsets(), layerOf(), masterStartOf() (+3 more)

### Community 35 - "lint-colors.py"
Cohesion: 0.35
Nodes (11): _akey(), check(), _defined_tokens(), _load_baseline(), main(), Drop block + HTML comments so example/placeholder tokens in prose (e.g.     chro, Per-token used alphas {token: {alpha_key}}, mirroring /api/color/usage., _scan_paths() (+3 more)

### Community 36 - "lh()"
Cohesion: 0.29
Nodes (12): aD(), AN(), fN(), gN(), kR(), lh(), mR(), rb() (+4 more)

### Community 37 - "Rp()"
Cohesion: 0.20
Nodes (12): Dp(), Ep(), Fp(), kp(), Op(), Pp(), Qp(), Rp() (+4 more)

### Community 38 - "now et()"
Cohesion: 0.29
Nodes (10): _now_et(), build_morning(), _morning_retrospective(), _purge_stale_notes(), Roll past-dated scheduled_day forward; auto-schedule rd cards due     within the, _roll_and_schedule(), _run_step(), apply_peel() (+2 more)

### Community 39 - "bulk update scheduled days()"
Cohesion: 0.25
Nodes (10): bulk_update_scheduled_days(), get_week_data(), log_prophecy_change(), _logical_today(), Yesterday if before 4:30 AM ET, matching client isoToday()., Return cards scheduled for 7 days starting from start_iso (default logical today, Apply list of {id, scheduled_day?, order?} updates to rd.json., _today_iso() (+2 more)

### Community 40 - "Request"
Cohesion: 0.22
Nodes (9): classify_card(), parse_date_natural(), Card-creation LLM helpers: classify a new card's category + importance, and pars, _cache_control(), api_parse_date(), api_rd_classify(), build_nightfall_html(), nightfall_page() (+1 more)

### Community 41 - "recruiter.js"
Cohesion: 0.40
Nodes (9): applyTheme(), backspace(), finish(), nextDelayAfter(), placeCaret(), runNode(), setFx(), start() (+1 more)

### Community 42 - "index pages()"
Cohesion: 0.22
Nodes (9): _index_pages(), Return (no_form, bare) variants of /app/static/index.html, re-read on change., guest_login_page(), _landing_html(), Public landing page: non-admin sections only, as a centered vertical     column, Public landing page (non-admin sections). Logged-in admins skip it     and land, Public, auth-free résumé page for recruiters. Clean layout on the site     palet, recruiter_page() (+1 more)

### Community 43 - "routes tts.py"
Cohesion: 0.28
Nodes (7): _pump_to_client(), _pump_to_upstream(), TTS page + WebSocket reverse-proxy to the home GPU server.  The TTS models (Koko, Is the home-box TTS upstream reachable. The reverse-tunnel listener stays     bo, tts_health(), ws_tts(), WebSocket

### Community 44 - "rules"
Cohesion: 0.22
Nodes (8): extends, rules, alpha-value-notation, color-function-alias-notation, color-function-notation, declaration-block-single-line-max-declarations, font-family-no-missing-generic-family-keyword, no-descending-specificity

### Community 45 - "exec-voice.js"
Cohesion: 0.39
Nodes (7): armUnlock(), ensurePlayer(), mountButton(), ready(), setOn(), speak(), unlock()

### Community 46 - "test exec voice.py"
Cohesion: 0.39
Nodes (7): _body(), Exec-voice wiring smoke tests (HTTP — no browser).  The GLaDOS voice is delivere, A page loading exec-voice.js must also load its deps, and vice-versa the     lis, test_other_protected_pages_load_listener_voice(), test_planning_pages_load_panel_voice(), test_tarot_and_hosaka_have_no_exec_voice(), test_voice_deps_never_appear_without_exec_voice()

### Community 47 - "hosaka-audio.js"
Cohesion: 0.39
Nodes (5): enableSilentModePlayback(), flush(), openSocket(), speak(), unlock()

### Community 48 - "card-dialog.js"
Cohesion: 0.43
Nodes (4): _collectAndPatch(), _parseMD(), _patch(), _resolve()

### Community 49 - "devDependencies"
Cohesion: 0.33
Nodes (5): devDependencies, eslint, @eslint/js, globals, type

### Community 50 - "exec-todos.js"
Cohesion: 0.60
Nodes (5): addTodo(), checkOff(), esc(), loadTodos(), renderItem()

### Community 51 - "mtg compress.py"
Cohesion: 0.83
Nodes (3): build_prompt(), main(), ts()

## Knowledge Gaps
- **73 isolated node(s):** `docs-commit-guard.sh script`, `session-start.sh script`, `extends`, `no-descending-specificity`, `font-family-no-missing-generic-family-keyword` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `graph_page()` connect `graph scrub.py` to `Request`, `routes views.py`, `tmpl()`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `_now_et()` connect `now et()` to `routes api.py`, `datetime`, `load rd()`, `nudge loop.py`, `scheduler.py`, `helpers.py`, `nudge llm.py`, `chat.py`, `nudge.py`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `api_rd_patch()` connect `routes api.py` to `Request`, `helpers.py`, `scheduler.py`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **What connects `docs-commit-guard.sh script`, `session-start.sh script`, `extends` to the rest of the system?**
  _195 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `prophecies-groups.js` be split into smaller, more focused modules?**
  _Cohesion score 0.053075396825396824 - nodes in this community are weakly interconnected._
- **Should `tarot-view.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05427547363031234 - nodes in this community are weakly interconnected._