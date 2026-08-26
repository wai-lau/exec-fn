# Graph Report - exec-fn  (2026-06-26)

## Corpus Check
- 588 files · ~9,802,774 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1074 nodes · 1851 edges · 66 communities (55 shown, 11 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 299 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b1811fac`
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
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]

## God Nodes (most connected - your core abstractions)
1. `_load_rd()` - 29 edges
2. `$()` - 23 edges
3. `_now_et()` - 22 edges
4. `_save_rd()` - 21 edges
5. `Request` - 17 edges
6. `exec-fn` - 14 edges
7. `_load_json()` - 14 edges
8. `_find_card()` - 14 edges
9. `_append_rd_log()` - 14 edges
10. `api_rd_patch()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `api_debug_logs()` --calls--> `Path`  [INFERRED]
  api/routes_views.py → api/routes_api.py
- `_landing_html()` --calls--> `_index_pages()`  [INFERRED]
  api/routes_views.py → api/pages.py
- `guest_login()` --calls--> `verify_turnstile()`  [INFERRED]
  api/routes_views.py → api/auth.py
- `graph_page()` --calls--> `_drop_graph_book_nodes()`  [INFERRED]
  api/routes_views.py → api/graph_scrub.py
- `graph_page()` --calls--> `_drop_graph_library_nodes()`  [INFERRED]
  api/routes_views.py → api/graph_scrub.py

## Import Cycles
- 1-file cycle: `api/helpers.py -> api/helpers.py`
- 1-file cycle: `api/nudge.py -> api/nudge.py`
- 1-file cycle: `api/nudge_deadlines.py -> api/nudge_deadlines.py`
- 1-file cycle: `api/nudge_llm.py -> api/nudge_llm.py`

## Communities (66 total, 11 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (19): True iff Cloudflare attests the Turnstile token. Empty token short-circuits, require_auth(), require_guest_auth(), verify_turnstile(), gcal_start_auth(), _lifespan(), FastAPI entry point: app, lifespan, middleware, 401 redirects, wiring.  Routes l, unauthorized_handler() (+11 more)

### Community 1 - "Tarot Major Arcana Meanings"
Cohesion: 0.05
Nodes (51): bookBarColors(), CARD_CATS, cardStyle(), _catKey(), chipStyle(), _remChipHtml(), buildBoard(), buildSchedule() (+43 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (56): _canType(), _caretOffset(), _caretToEnd(), focusInput(), _focusNow(), _inputBar, _inputCursor, _msgInput (+48 more)

### Community 3 - "Tarot Reader Engine"
Cohesion: 0.06
Nodes (61): _prep_min(), Minutes of decomposed lead-up before the event block (0 if unset)., Minutes of the atomic event block = estimated_time minus prep (never < 0)., _work_min(), active_label(), clear_awaiting_focused(), active_anchor(), assign_auto_deadlines() (+53 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (69): _apply_reminder_flag(), _apply_schedule(), _apply_size_time(), _nudge_resched_blocked(), Exec-chat scheduling: load/save wrapper around scheduler.schedule_to_day., Due dates are protected: an active-nudge card can't be deferred without the, _tool_advance_chunk(), _tool_create_card() (+61 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (36): Any, get_chat(), api_chat(), api_chat_get(), ChatBody, _dispatch_tools(), Stream follow-up assistant turn after tool results., Run each tool_use block: stream a tool_call SSE event, collect its     tool_resu (+28 more)

### Community 6 - "Tarot Core Framework"
Cohesion: 0.10
Nodes (33): _now_et(), build_morning(), _morning_retrospective(), _purge_stale_notes(), Roll past-dated scheduled_day forward; auto-schedule rd cards due     within the, _roll_and_schedule(), _run_step(), factor_for() (+25 more)

### Community 7 - "Exec Bubble UI"
Cohesion: 0.10
Nodes (24): The three top-level APIRouters, shared by every route module.  Defined here (not, _err(), Two passes. Pass 1 (research) runs the tool loop with its prose discarded —, stream_chat(), _card_summary(), _keyword_rules(), _load_cards(), _load_rulings() (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (21): _array_re(), _friendly_dir(), _loc_by_node_id(), _logical_key(), _merge_graph_communities(), _node_color(), _node_group_key(), Serve-time scrubbing of graphify's /graph page.  graph.html is regenerated whole (+13 more)

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
Cohesion: 0.14
Nodes (23): _load_json(), _advanced_entries(), api_context(), api_context_patch(), api_nudge_tick(), api_profile(), api_rd(), api_rd_patch() (+15 more)

### Community 15 - "Authentication"
Cohesion: 0.20
Nodes (17): addToggles(), buildPhysicsColumn(), clusterSpan(), focusRandomCluster(), go(), hideOrphans(), initTour(), isRedacted() (+9 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (15): buildColumns(), CAT_DESC, categoryTokens(), esc(), groupHtml(), loadColors(), mergedSites(), nearestSize() (+7 more)

### Community 17 - "ESLint / NPM Config"
Cohesion: 0.14
Nodes (5): _is_page(), Page smoke tests — every HTML route loads (or redirects) per its auth tier.  Cat, test_guest_loads_with_guest_cookie(), test_protected_loads_with_admin(), test_public_page_loads()

### Community 18 - "Card Styling"
Cohesion: 0.25
Nodes (13): create_gcal_event(), _dedup_key(), fetch_calendar_events(), _fetch_gcal_raw_full(), _fetch_ics_events(), fetch_omens(), gcal_complete_auth(), _gcal_creds() (+5 more)

### Community 19 - "MTG Rules Compressor"
Cohesion: 0.22
Nodes (13): _build_context(), _entry_is_significant(), _entry_line(), flush_monitor(), generate_encouragement(), _is_commentable(), Trailing debounce: each call resets the 60s timer., Fire the monitor now if significant activity exists since the last     comment ( (+5 more)

### Community 20 - "Claude Hooks Config"
Cohesion: 0.22
Nodes (9): loadDebug(), profileNotes, renderLogs(), renderMoltbook(), renderMtg(), renderProfile(), renderProfileSection(), renderTarot() (+1 more)

### Community 21 - "Container Entrypoint"
Cohesion: 0.18
Nodes (10): _active_nudge_block(), append_monitor_comment(), _build_chat_system_prompt(), _focused_nudge_card(), Most-recently-nudged card with an active nudge loop., get_rd_log(), get_hq_log(), get_prophecies_log() (+2 more)

### Community 22 - "Morning Cron Script"
Cohesion: 0.15
Nodes (9): admin_cookie(), base_url(), guest_cookie(), _key(), Smoke-test fixtures.  These run against the LIVE app (the running container on :, Env var first; fall back to the repo .env (same host, same secrets)., Probe the live app once; skip the whole suite if it isn't reachable., Guest tier via the guest_session cookie a real Turnstile solve would set.      T (+1 more)

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
Cohesion: 0.12
Nodes (22): bookPartition(), buildBoard(), buildBooks(), buildReminders(), cards, COL_LABELS, COLS, _compositeBg() (+14 more)

### Community 28 - "ESLint Flat Config"
Cohesion: 0.40
Nodes (9): applyTheme(), backspace(), finish(), nextDelayAfter(), placeCaret(), runNode(), setFx(), start() (+1 more)

### Community 29 - "Package Init"
Cohesion: 0.22
Nodes (8): extends, rules, alpha-value-notation, color-function-alias-notation, color-function-notation, declaration-block-single-line-max-declarations, font-family-no-missing-generic-family-keyword, no-descending-specificity

### Community 30 - "Community 30"
Cohesion: 0.36
Nodes (8): armUnlock(), ensurePlayer(), mark(), mountButton(), ready(), setOn(), speak(), unlock()

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
Cohesion: 0.23
Nodes (12): _drop_graph_book_nodes(), _drop_graph_library_nodes(), _drop_graph_moltbook_nodes(), _drop_graph_vendor_nodes(), _prune_graph_nodes(), Splice out every node in `drop_ids` plus its dangling references: drop the     R, Remove every RAW_NODES entry whose source_file is under the tarot book     dir (, Remove every RAW_NODES entry under the vendored-lib dir (and its dangling     re (+4 more)

### Community 37 - "Community 37"
Cohesion: 0.06
Nodes (47): buildBoard(), buildSchedule(), consult_oracle(), dayCellHtml(), flushUpdates(), initSortable(), load(), queueUpdate() (+39 more)

### Community 43 - "Community 43"
Cohesion: 0.22
Nodes (8): classify_card(), parse_date_natural(), Card-creation LLM helpers: classify a new card's category + importance, and pars, _dedupe_context(), _parse_json(), Extract and parse the first JSON object or array from a string., api_parse_date(), api_rd_classify()

### Community 56 - "Community 56"
Cohesion: 0.11
Nodes (17): API endpoints, Cron, Docker volumes, Droplet, Exec chat tools (bubble overlay), exec-fn, Exec monitor, File map (+9 more)

### Community 57 - "Community 57"
Cohesion: 0.38
Nodes (7): _fix_graph_stats(), Rewrite the #stats header to match the scrubbed + merged graph. graphify     bak, _build_nav(), emet_page(), graph_page(), nightfall_page(), Request

### Community 58 - "Community 58"
Cohesion: 0.13
Nodes (16): api_debug_logs(), guest_login(), guest_login_alias(), _landing_html(), login(), login_page(), HTML page routes + the read-only data GETs that back them.  Public landing/login, Public landing page: non-admin sections only, as a centered vertical     column (+8 more)

### Community 59 - "Community 59"
Cohesion: 0.23
Nodes (11): bulk_update_scheduled_days(), get_week_data(), log_hq_change(), _logical_today(), date, Yesterday if before 4:30 AM ET, matching client isoToday()., Return cards scheduled for 7 days starting from start_iso (default logical today, Apply list of {id, scheduled_day?, order?} updates to rd.json. (+3 more)

### Community 60 - "Community 60"
Cohesion: 0.12
Nodes (15): 1. Deployment, 2. Module graph, 3. Morning pipeline + scheduling, 3a. Morning cron sequence, 3b. scheduler.py — the time model, 4. TTS (text-to-speech), 4a. Topology, 4b. Auth — now guest-or-full (+7 more)

### Community 61 - "Community 61"
Cohesion: 0.25
Nodes (9): _broadcast_presence(), _pump_to_client(), _pump_to_upstream(), TTS page + WebSocket reverse-proxy to the home GPU server.  The TTS models (Koko, Is the home-box TTS upstream reachable. The reverse-tunnel listener stays     bo, tts_health(), ws_presence(), ws_tts() (+1 more)

### Community 65 - "Community 65"
Cohesion: 0.19
Nodes (16): _index_pages(), Page composition: nav builder, index-shell variants, template loader.  Pure rend, Return (no_form, bare) variants of /app/static/index.html, re-read on change., _render_page(), _tmpl(), tts_page(), color_page(), debug_page() (+8 more)

### Community 67 - "Community 67"
Cohesion: 0.83
Nodes (3): build_prompt(), main(), ts()

### Community 68 - "Community 68"
Cohesion: 0.40
Nodes (4): Engineering notes, exec-fn, Stack, What it does

### Community 69 - "Community 69"
Cohesion: 0.39
Nodes (8): color_usage(), var(--X) occurrence counts + actually-used alphas per -hsl token +     per-(toke, Path, _clone(), _convert_one(), main(), _make_card_back(), One-shot card-image downloader.  Populates ``web/tarot/cards/<card_id>.jpg`` (78

## Knowledge Gaps
- **111 isolated node(s):** `RULES — READ FIRST`, `System overview`, `File map`, `Terminology`, `Pages` (+106 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Request` connect `Community 57` to `Community 65`, `Community 4`, `Community 43`, `Card Image Downloader`, `Community 58`, `Community 59`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `api_rd_patch()` connect `Card Image Downloader` to `Community 57`, `MTG Rules Compressor`, `Community 4`, `Tarot Core Framework`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `_load_rd()` connect `Community 4` to `Tarot Reader Engine`, `Tarot Core Framework`, `Card Image Downloader`, `MTG Rules Compressor`, `Container Entrypoint`, `Community 59`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 26 inferred relationships involving `_load_rd()` (e.g. with `_build_chat_system_prompt()` and `_apply_schedule()`) actually correct?**
  _`_load_rd()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `_now_et()` (e.g. with `_build_chat_system_prompt()` and `_tool_advance_chunk()`) actually correct?**
  _`_now_et()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `_save_rd()` (e.g. with `_apply_schedule()` and `_tool_advance_chunk()`) actually correct?**
  _`_save_rd()` has 20 INFERRED edges - model-reasoned connections that need verification._
- **What connects `HTML page routes + the read-only data GETs that back them.  Public landing/login`, `Restrict redirect targets to the known guest-accessible page set.`, `Same-origin redirect guard: accept only a leading-slash relative path,     rejec` to the rest of the system?**
  _247 weakly-connected nodes found - possible documentation gaps or missing edges._