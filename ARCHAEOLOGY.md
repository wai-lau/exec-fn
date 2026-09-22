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

## 1. Deployment

Current design: [ARCHITECTURE.md §1](ARCHITECTURE.md).

**The reMarkable feature is gone (2026-09-17), and the build got cheap because of
it.** The image used to open with `FROM golang:1.24-alpine AS rmapi-builder`,
which `git clone`d and `go build`s [rmapi](https://github.com/ddvk/rmapi); pip
then installed `rmscene` from git and the Dockerfile `sed -i`-patched one line of
its site-package source. All of it was dead: **neither `rmapi` nor `rmscene` had a
single reference in any `.py`, `.sh`, `.js` or cron file.** On a 2-core/1967MB box
a cold `go build` is a genuine OOM risk, which made every rebuild something to
schedule rather than just run — and the `sed` patch matched an upstream line by
exact string, so an upstream edit would have broken the build silently. Removing
the stage drops ~18MB of binary, the whole golang pull, the git clone, and that
patch.

The lock exists because of a specific outage. Nothing was pinned, so every
rebuild re-resolved the whole tree from scratch. On 2026-09-17 a rebuild resolved
`anthropic` and `mcp` to versions requiring **`httpx2`** rather than `httpx` — and
`api/auth.py` imports `httpx` **by name**, having only ever received it as a
transitive. It vanished, `main.py` died at import, and every route 502'd. Both
`httpx` and `httpx2` sit in the lock on purpose now: `httpx2` is what anthropic
and mcp want, `httpx` is what `auth.py` imports.

Measured live: **20 of 220 requests to `/` across two reloads came back 502**, while the same probe straight at `127.0.0.1:8080` saw none. That is what pinned it on the proxy rather than the app.


---

## 3. Morning pipeline + scheduling

Current design: [ARCHITECTURE.md §3](ARCHITECTURE.md).

  A save landing in the same millisecond as the read that seeded the `_load_json` mtime cache left the stale PRE-save board being handed to the next load. Two quick cycles — a
  chat tool archiving a card, then re-reading it — saw the card back in the
  column it started in (found 2026-09-15 by `test_archive_card.py`, where a
  second archive of the same card re-cloned its recurrence).

---

## 4. TTS (text-to-speech)

Current design: [ARCHITECTURE.md §4](ARCHITECTURE.md).

Both `/hosaka` and `/emet` render the same `emo | idle | homo` segmented
control (shared `web/gpu-mode.{js,css}`, keyed on `#gpu-mode`) for owners only.
If the proxy call to the home service fails (tunnel down, service not running),
the mode is reported as `gone` (an exec-fn label; the home service itself never
returns `gone`).

`GET /api/hosaka/mode/stream` is an owner-only SSE fan-out (`_mode_subscribers`
in `routes_tts.py`): a successful `POST` broadcasts the new mode to every
subscriber, so the control **live-syncs across pages** — flipping it on
`/hosaka` updates the strip on an open `/emet` (and vice-versa) with no reload.
The stream pushes only on an actual switch; each page seeds its initial state
from `GET /api/hosaka/mode` on load.

**The star is a CHARACTER in the bracket's own font, and a transform is the only
thing that sizes it** (fixed 2026-09-21). It was a `--font-ui` star at
`font-size: 1.3em` with `0.12em` side margins, and that cost this control both of
a composer's published dimensions. **Height**: an inline-block's own line-height
IS its box height, so a 20.18px box on an 18.62px line grew every composer
carrying the star by 1.56px — `/cc`'s input bar measured 26.17 against `/mtg`'s
24.61, and `/cc` publishes that bar as `--input-h` for `#terminal` to sit above,
so the star was quietly eating a row of transcript on the page that has the
least of it. **Width**: a 0.84em advance plus 0.24em of margin made `[✦]` nine
pixels wider than the `[x]` beside it (38.28 against 29.28), on a one-line
composer where the two read as a pair.

**OFF means off.** Before 2026-09-20 `/tarot`'s button was a volume mute that
kept synthesizing and kept pacing the reveal to audio nobody could hear. Now
`speak()` returns a DEAD controller when the narrator is off — nothing
synthesized, no socket — and every caller reads that as "reveal at your own
pace, now". One flag; no second state to keep in sync.

---

## 5. LLM call sites + prompt caching

Current design: [ARCHITECTURE.md §5](ARCHITECTURE.md).

  **TODAY moved from the top into the volatile tail — it was the silent invalidator.** The restructure was required because the tools alone (~3.5K) sit under opus's 4096 minimum.

---

## 6. Printer (ELEGOO Centauri Carbon)

Current design: [ARCHITECTURE.md §6](ARCHITECTURE.md).

Verified end-to-end against the live printer with the real app under
uvicorn (auth tiers, rewrites, etag→304, un-gzipped MJPEG, WS relay + the
cmd-386 rewrite, reconnect splice against a fake upstream that drops every
few frames).

Nav label is `3DP`, icon `printer.png` — the bitman smiley tile with rounded corners, baked from the untracked `bitman.png`. Its tile was recoloured lime→blue `#0090fc` on 2026-08-30: the lime read as the phosphor `.active` green, so the nav item looked permanently lit on every page. The route, icon key and internal name all stay `printer`; on the landing page it sits between nightfall and UI (its hue slot moved with the recolour).

**That interval was 0.5s (~2fps) until 2026-09-19 and read as broken rather than thrifty.** A print head moves far enough in half a second that consecutive frames look like unrelated stills, and a camera pointed at a machine exists to show the machine moving. 5fps is where motion reads as motion; the bandwidth is bounded twice over — ~34KB a frame, and `MAX_VIEWERS` caps the whole page at 16 streams however many people find it. Verified live: 5 concurrent viewers = 1 upstream socket, every part a valid JPEG.

---

## 7. `/cc` — Claude Code in the browser

Current design: [ARCHITECTURE.md §7](ARCHITECTURE.md).

**It became a full agent on 2026-09-13.** It shipped as a deliberately tools-light chat page ("no filesystem, never offer to run anything", two web tools), and that framing is now historical: `Read`, `Write`, `Edit`, `Bash`, `Glob` and `Grep` are on, at Wai's request, because she wants the working surface of a terminal session without the terminal. Both halves of that decision are recorded here — what it bought, and what it costs (§7b).

   **This was the 2026-09-10 session's worst finding.** Signing cc-agent into claude.ai attached that ACCOUNT's connectors — a probe found Gmail, Google Calendar and Google Drive all `"connected"`, exposing `send_message`, `trash_thread`, `share_file`, `download_file_content` and `delete_event` through a public-internet page behind one cookie. They are server-side capability riding the OAuth identity, so the mount namespace, `settingSources: []` and a built-in-tool blocklist ALL missed them completely. **Any subscription login inherits whatever connectors the account has** — re-probe after enabling a new one.

   It was a **denylist** until then (`disallowedTools`, listing every name by hand), and that is a losing game: every name added to it after the fact is one that already reached a user once. **`AskUserQuestion` is how this was found** — nothing listed it, because nothing knew to, so it rode in on the login, the model called it mid-answer, and the page printed a raw `AskUserQuestion is not available in the sandbox` at Wai.

   Measured on the pre-fix config the same day — **8 tools reached the model, not 5**: `AskUserQuestion`, **`EnterPlanMode`** and **`ExitPlanMode`**, the last two unnoticed because the model never happened to call them. With `tools` set: exactly the 5 in `ALLOWED_TOOLS`.

   **`canUseTool` is NOT the gate and must never be described as one.** Measured 2026-09-10 with a deny-everything callback and `ToolSearch`/`CronList` left visible: both EXECUTED (`CronList` returned "No scheduled jobs") and the callback was never invoked once. It does not see harness tools. The code said "the actual gate" in a comment for months, which is most of why the denylist was treated as cosmetic and left to rot.

   > `claude-box/probe-tools.mjs` imports `sandboxOptions()` from `server.mjs` rather than rebuilding it, so it measures the policy that actually serves traffic. That import is why `server.listen` is guarded by `RUN_AS_MAIN` — an import that seized the port would take the live sidecar down to answer a question about it. **The probe was referenced in these docs for months without existing as a file**, which is most of how a tool reached a user: nothing was re-run because there was nothing to run.

This used to read "with no `Read` there is no local untrusted content to inject THROUGH, and with no `Bash`/`Write` an injected instruction reaches nothing it could act on." **That is no longer true and must not be quoted back as if it were.**


  **`/etc` used to be bound wholesale**, which was the one place the allowlist went coarse. Once `Bash` was on that mattered: `/etc/cron.d/exec-fn-security` carries `SECURITY_OWNER_IP` — Wai's home IP, precisely the owner-identifying data `/security` is careful never to render — and `/etc/nginx` exposed the topology. Neither is a secret the way a key is, but neither belongs in reach of a page that fetches untrusted URLs. Now only `ssl` / `ca-certificates` (outbound TLS), `passwd` / `group`, `nsswitch.conf` / `hosts` / `resolv.conf` (name resolution) and `localtime` are bound. Verified in the live namespace: `/etc/cron.d`, `/etc/nginx`, `/etc/shadow` and `/exec-fn` are all absent; `/etc/shadow` and the letsencrypt private keys were already unreadable on permissions alone.

The web tools were added 2026-09-11 after the page answered "search news" with its training cutoff, which is broken behaviour for a chat assistant; the system prompt now tells it to search first and never cite its cutoff on a dated question.

**A tool call is ONE line, and its output folds under it** (`web/cc-toolout.js`, 2026-09-13). The line clips with an ellipsis (`.msg.tool .msg-body`, `white-space: nowrap`) — a url or a bash command routinely wrapped to three rows, and a turn with four fetches was a wall of addresses with the answer somewhere past it. The result renders collapsed (`hidden`); tapping the line reveals it and flips the gutter marker `+` → `-`. **The whole row is the hit target, not the marker glyph** — a 1ch pseudo-element is not a thumb, and this page is driven from a phone. Open, the block is capped at `max-height: 20lh` and scrolls inside itself: `lh` is 20 of the block's OWN lines, which is what the cap is about, where the `12rem` it replaced was a different number of lines at every font size.

**Every tool line expands to something** (fixed 2026-09-15). An empty result used to render nothing at all, which left the line without its `cc-fold` class or click handler: tapping it did nothing, and nothing distinguished an empty result from a broken page — how WebFetch got reported as unexpandable. Empty now folds as `[ no output ]`, and `ccFinishTools()` (end of turn, and on the interrupt path) folds `[ no result returned ]` under any call still waiting. The sidecar also stopped throwing results away: `resultText()` handles a string, an array of `{type:"text"}` blocks, **and** structured blocks with no `text` field — the web tools' shape, which joined to `""` — falling back to the block's JSON, an `[image]` marker instead of a megabyte of base64, and a 20 000-char cap so one unbounded result cannot cross the relay whole.

**Text that resumes after a tool call opens its OWN bubble.** `dropIfEmpty` used to drop the assistant bubble only when it was still empty; a bubble that already held prose stayed open, so the model's next message was appended to the same `fullText` with nothing between them and rendered ABOVE the tool line it came after. The join is invisible in the output — it reads as a missing space after a period (`…real numbers.**HG group coaching:**`, reported 2026-09-15). The bubble is now settled (markdown pass + SVG swap) and closed, the reveal state replaced with a fresh object (a cancelled typer never calls `onDone`, so leaving the old `typing` promise would hang the settle pass), and the receipt hangs on the last settled body when a turn ends on a tool. Pinned in `tests/test_cc_stream_browser.py`.

A pointer file (`~cc-agent/.cc-session`) holding the current session id, not a JS variable on the page. It used to be the latter, so every page load silently began a new conversation: five sessions came out of a handful of messages. Server-side means the thread also survives a phone locking and a move between devices, which no browser-side value can.

The two rows were merged onto one on 2026-09-11 and split back the same day: on a phone the metrics are a fixed ~330px of the 430 available, so a single row truncated the title to almost nothing. On its own line the band gets the full width and the metric colours survive (white, mint and cyan are illegible on a bright band). The model is no longer shown at all — it is still tracked, since it decides which context window `ctx%` is measured against.

**The SDK's own `summary` was tried first and is NOT enough**: on a live conversation it is usually just the opening prompt, so the bar showed the first thing typed back, verbatim. The good titles in Wai's terminal come from her own recap hook (`~/.claude/hooks/session-recap-gen.js`), which asks haiku for a 3-6 word rolling title every few prompts — this mirrors it.

**The listener has to be on `res`, and for eighteen months it was on `req`** (fixed 2026-09-21). `handleQuery` runs AFTER `readBody()` has consumed the request to `end`, and a fully-read `IncomingMessage` never emits `close` again — measured on node v22 with a stub server built exactly like this one: a client that hangs up mid-stream fires `close` on the **response** at the moment of the hangup and **nothing at all, ever**, on the request. So the abort never fired on a hangup. Nothing downstream noticed, because every OTHER link in the chain worked: the browser aborted, nginx dropped the upstream, Starlette cancelled, httpx closed the socket — and node, holding no listener that could hear any of it, went on awaiting an SDK run whose reader had left. `active` stayed at 1 and **every later send answered `busy`** until the run finished on its own or the 10-minute `IDLE_TIMEOUT_MS` abort fired; the idle abort is the same `controller`, so a CLI subprocess that had gone quiet (its API sockets open, 3s of CPU across four minutes) held the single slot for the full ten. Observed from the page as two consecutive `[ busy — one run at a time (memory ceiling); try again shortly ]` lines: the first send was an interrupt whose `ccAwaitFree()` timed out after 4s, and the second had no local run left to interrupt, so it fired blind into a slot that was never coming back. On the fix, a hangup frees the slot in **2–3s** and the CLI child exits with it.

**`dropIfEmpty()` must be idempotent** (fix landed in `0de197a`, whose message covers only the CRT work). It nulls `div`, and a turn routinely fires several drops in a row — the archive tools list then read, so `tool`, `tool_result`, `tool` — at which point the second call ran `div.remove()` on null and the whole turn died with `null is not an object (evaluating 'div.remove')`, taking the reply that was still streaming behind it. It now returns early when `div` is already gone. Pinned by driving a real two-tool turn in WebKit: 2 tool lines, 1 assistant reply, zero console errors.

No voice OUTPUT on /cc yet — `execVoice` (GLaDOS) is loaded on the page for monitor/nudge lines but deliberately not wired to Claude's replies.

---

## 8. `/rd` — the board and its month calendar

Current design: [ARCHITECTURE.md §8](ARCHITECTURE.md).

**The last column's missing right rule is keyed off a `.cal-eow` class the builder sets from the day, never `:nth-child(7n)`.** nth-child counts every child of `#rd-calendar`, so adding the `.cal-mark` watermark as the first child shifted the count by one and silently moved the rule to Friday, deleting the Friday/Saturday hairline.

The reminders bar shows what is **inside a 30-day window** (plus any `pinned_reminder`); everything further out is counted into a `+N` button that opens the full list. The button is `position:absolute` and was appended to `bar.firstElementChild`, i.e. to the first visible chip — so on a board whose reminders are ALL beyond the cutoff, `visible` is empty, there is no first chip, and the button was silently never created. `body.has-reminders` is keyed off `all.length`, not `visible.length`, so the bar still rendered: a blank strip with 38 reminders behind it and no way to reach them (2026-09-21 — birthdays run months ahead, so this is the board's normal state, not an edge case).

`buildBooks()` had already solved it — when nothing is visible it creates an **empty chip** to host the button — and `buildReminders()` now does the same. A bar's `+N` must never be parented to content that may not exist.

---

## 9. The landing page

Current design: [ARCHITECTURE.md §9](ARCHITECTURE.md).

**What it replaced:** a full-height column of all eight that ran **1289px tall in a 932px viewport**, where `body{overflow:hidden}` silently clipped the last two sections off the bottom.

---

## 10. The CRT effect stack (`_CRT_FX`)

Current design: [ARCHITECTURE.md §10](ARCHITECTURE.md).

**Tint, 2026-09-21.** The phosphor read heavy on every page, so it was dialled TOWARDS WHITE: saturation −40 and lightness +25 off `--cat-social` (125 55% 68% → ~125 15% 93%), written as `calc()` on those channels — the idiom `--card-social-plan` already uses, which keeps it on the palette with no new colour literal and no baseline to regenerate. The lesson is that **opacity and hue are different knobs**: the first attempt dropped the stripe's alpha from 0.45 to 0.25 and pulled the contrast filter back with it, which makes the scanlines fainter while leaving them exactly as green. Both are back where they were.

**The measurements behind that.** The glass was removed 2026-08-30: back then it sat UNDER the sweep, took ~45% of frame time at **1131ms/frame** in WebKit, and the page filled in **top-to-bottom** because the engine could not finish a viewport in one vsync. It was **reinstated 2026-08-31** with the scan-above-glass fix, and re-measured live at 430×932: WebKit steady-state is **16.9ms/frame WITH the glass vs 16.5ms without** — 60fps, the blur adding ~0.4ms, which is the proof that a static backdrop caches.

Also gone since 2026-08-30 and not coming back: `plus-lighter` on `.cyber-bg`, `overlay` on `.cyber-scan`.

Merging `.cyber-bg` INTO `.cyber-lines` as one hard-light element buys ~42ms more in WebKit but was **rejected**: one blend pass cannot compound the way two do, and the scanlines flatten out over text.

The `.cyber-crt` punch was tuned 2026-08-31 from `brightness(1.03) contrast(1.1)` to a **multiply feel**: `brightness < 1` darkens the unlit ground, and high `contrast` (pivot 0.5) crushes the sub-midpoint green haze toward black while the bright green text clamps at max — unlit MUCH darker, lit text held. It is a filter, not a colour, so it pops the phosphor greens and deepens the blacks without touching the palette, and it caches exactly like the glass because its backdrop never animates. Over the sweep it would re-fire every frame, the same trap.

---

## 11. `/graph`

Current design: [ARCHITECTURE.md §11](ARCHITECTURE.md).

**The first thing painted is the loading bar** (2026-09-22). Two things stood between a visitor and that bar, and only one of them was obvious. The cover was built by `graph-overlay.js`, which is injected before `</body>`; serving it as static markup at the top of `<body>` (`_GRAPH_BOOT`) fixes the document ORDER but not the paint, because graphify emits its entire dataset as one ~2.1MB **inline** `<script>` right after it. An inline script cannot carry `defer`, and a script executing is a main thread with no rendering opportunity in it — so the browser parsed the cover and then sat in that block for a second before painting anything at all. Measured on the served page: `responseStart` 129ms, **first-contentful-paint 1304ms**, and none of the gap is transfer (133KB gzipped).

**A black /graph is a JS failure wearing a crash's clothes** (2026-09-22). `#graph` is `opacity: 0` until `body.gp-loaded` lifts it, so every path that does not reach `reveal()` shows the same thing: a black page. Reported from a phone as *nothing happens when I tap GPH, then the page goes black* — with the visuals turning up around three minutes later, which is what ruled out a crashed tab and made it a slow load nobody could see the inside of. The failsafe at the time was **120s**, so even the recovery was two minutes of black.

**Three failures that only ever showed on a phone** (2026-09-22), found by asking what the screen actually did rather than by reproducing them — none of them reproduce on the droplet's headless WebKit.

**A black page after switching tabs and coming back** was `watchSleep` reloading the document. It ran a 10s interval and treated a tick landing >60s late as "the device slept", on the reasoning that a canvas comes back wedged from a suspend. iOS freezes a backgrounded tab within seconds, so switching apps and returning tripped it EVERY time, and a reload of /graph is a black screen for the whole load (opacity 0 until `gp-loaded`) — which is how a slow load came to be reported as a crash. The old comment already recorded the same shape of bug on the droplet: a reload landing in another stabilisation, tripping it again. It is now `watchWake`, hung on `visibilitychange` and a `persisted` `pageshow` — the events that actually mean *you are back* — and it REPAIRS instead of reloading: `graphPulseDraw.resize()` re-measures the backing store, `network.redraw()` repaints. That is the entire recovery the reload was buying, minus the document.

**A finished page that would not take a tap.** `graphPulse.init()` now returns early on `(pointer: coarse)`. The cascade is the only animated layer on the page and it sits UNDER the CRT stack's two `backdrop-filter` layers — §10's most expensive rule: a backdrop-filter is a full-viewport readback with no partial invalidation, cheap only while nothing under it animates, ruinous when something does. 2fps against 18 measured here with the stack hidden; on a phone that is a main thread and compositor with nothing left over for touch. The stack stays and the cascade goes, and the order matters: the stack is the site's look on every page, while the cascade is /graph-only ambience that happens to be exactly what makes the stack expensive.

**Lag between tapping GPH and anything happening** was the response, not the page. The render is 1.7-2.9s of CPU and `_CACHE` is per-PROCESS, so every restart — routine under `--reload` — parked a cold render in front of whoever opened /graph next, and the tap sat there looking ignored. `run_graph_warm_loop` is a lifespan task beside the nudge loop: it renders both tiers at startup and re-warms whenever `(mtime_ns, size)` changes, which covers the 05:00 rebuild without a schedule of its own, and it swallows its own failures because the route still renders on demand. First request after a restart measured 6.5s (the warm and the request contending), steady state **0.046s**.

**The bar is a fraction of the work, and that is the second answer to the question.** The first was bytes: `graph-cover.js` fetches the payload itself (`window.GRAPH_BOOT_URL`, a streamed `fetch`, handed back as a Blob `<script src>` so the payload's top-level `const RAW_NODES` / `network` stay global bindings) instead of leaving it to a `<script defer src>`, which reports nothing until it is finished. Then the measurement came back: **WebKit returns all 2,204,421 bytes in ONE chunk**, so a byte-driven bar fires exactly once, at 100%, and correlates with nothing. A slower link does split it — which is the phone this is for and not the loopback it gets tested on — so bytes are kept where they appear, but they cannot be the whole bar.

So the bar is cut by phase, and every step is a real thing finishing: `FETCHED` 0.45 (payload down), `BUILT` 0.9 (it has executed — the injected script's `onload`, the only honest marker for that from outside), 1.0 at reveal. Inside the download it tracks bytes. Inside the BUILD it holds its width and **breathes** — `.gp-build`, an opacity keyframe — because opacity is a compositor property that keeps moving through a main thread blocked solid, while a JS-driven width freezes exactly when the page most needs to look alive. The marquee is now only for the phase before there is any position to hold.

Three things that only showed up by tracing the running page: the phase text ran BACKWARDS (`building the graph` then `fetching graph data`) while both `go()` and the loader wrote it — the loader owns it now; `indeterminate()` has to clear the inline width, or the marquee slides a FULL-WIDTH bar rather than a segment; and `X-Payload-Bytes` exists because `Content-Length` is the gzipped length while the reader yields decoded bytes. Since the page no longer carries a `<script src>` for the payload, three separate paths restore one: the fetch's `catch`, the injected script's `onerror`, and a 25s `RESCUE_MS` timer — plus a belt in graph-overlay.js for the case where graph-cover.js never ran at all.

**The cover lifts on a finished page, not an ordered one.** `reveal()` sat on the line after `moveTo`, which left two things in flight. `moveTo` sets the camera but does not paint at it, so the reveal uncovered the frame BEFORE the move and the graph jumped into position a beat later. And `graphPulse.init()` only wires the model up — the first cascade lights a moment afterwards, so the page arrived still and then twitched into life.

**One `moveNode` per node is one REDRAW per node, and that was the freeze.** `snapToGrid` wrote 2,722 positions through `network.moveNode`. That was already the cheap path — a DataSet bulk write fires vis's `_dataUpdated` cascade and rebuilds every physics body, 7.4s against 1.07s — but every call also asks vis to redraw, and **the draws it queues are invisible to a timer wrapped around the loop**. `place` reported 0.0s while the work it had just ordered ran on for seconds afterwards, which is precisely why the instrumentation exonerated the guilty step twice over.

Hooking `beforeDrawing`/`afterDrawing` is what found it: **160 draws, 16.1s of main thread, a median 93ms apart**, 130 of them before the cover lifted, each repainting a 3.36-megapixel canvas of 2,722 nodes. A thread that busy cannot run a timer, which is why the 3s reveal failsafe never fired and the page sat frozen with the bar at `drawing` — the exact state in the screenshot that reported it. Writing straight to `network.body.nodes[id].x/y` (guarded, falling back to `moveNode` on any vis that renames it) and calling `network.redraw()` once after the loop: **160 draws -> 4, 16,161ms -> 737ms**.

`graphPulse.index()` was chunked into four rAF-separated phases during the same hunt, and it was **not** the culprit — `nodes 22 / edges 5 / pos 7 / grid 54ms`, 88ms all told. The phases stay anyway: a thread that yields between them is what allows a failsafe to fire at all, and the per-phase numbers print in the cover line, which is how a device nobody here can profile gets to name its own slow step. The reveal gains `DRAWN_CAP` (800ms from vis's first painted frame) for the same reason — waiting for the first lit frame stays the intent, but it is no longer the only way out.

`CELLS_PER_NODE` moved **4 -> 9** in the same pass, on request: more points for each part of the graph to snap to. The cell is `sqrt(area / (n * CELLS_PER_NODE))`, so raising it makes the grid finer without moving the cloud's outline — 107x103 distinct coordinates against roughly 70x70 — every node lands nearer where the layout put it, and `nearestFree` walks less because there is more room beside each first choice.

**“Groups of four” was a moire: the layout was quantised twice.** Reported from a phone as nodes sitting in evenly spaced clusters of up to four, which looks like an arrangement somebody chose. `scripts/graph-layout.py` waits for `gp-loaded` and reads `network.getPositions()` — and `gp-loaded` comes after `snapToGrid`, so the nightly file held **already a lattice**: 107 distinct x values, gaps of 146/147, exactly `cell` at `CELLS_PER_NODE` 4. Every visit snapped that again at whatever cell was current, 97 at CPN 9, and **146/97 = 1.505**. Multiples of 146 rounded onto a 97 grid give indices 0, 2, 3, 5, 6, 8, 9: alternating wide and narrow gaps, in both axes at once, drawn as pairs and pairs of pairs.

`snapToGrid` publishes `window.__GP_PRESNAP` — the positions as the layout left them, before it quantises anything — and the baker reads that, falling back to `getPositions()` so a bake still works against an older page. **Snap once, at serve time**, against whatever density is current. Re-baked and measured: the file went from 107 distinct x values to **2,433** (gaps of 1, 2, 3, 4, 5), the rendered lattice to gaps of 99 x121 and 100 x25 with an occasional 198 or 298 where the graph is sparse, and the clump distribution from a hard cap at 4 to a natural tail (1220 singles, 223 pairs, down to one 107-node mass in the densest region).

**`_cached` keys on the layout file too, which fixes a day-long fault nobody had noticed.** The key was graph.html's `(mtime_ns, size)` alone, while the 05:00 cron rebuilds graphify FIRST and bakes after. A visit landing in that window cached a render made without a baked layout, and nothing invalidated it until the next rebuild twenty-four hours later — every visitor in between paying the ~30s browser stabilisation the bake exists to remove. A re-bake by hand had the same problem, which is how it surfaced.

**The physics gets another hundred iterations before it freezes.** `stabilization.iterations` went 220 -> 270 on 2026-09-21 and 270 -> **370** on 2026-09-22: the sim runs longer before `stabilizationIterationsDone` turns physics off and `snapToGrid` quantises what it left, so what gets frozen is a layout that has settled rather than one still drifting. Every one of those iterations now runs inside `scripts/graph-layout.py` — a normal serve gets physics off and the baked coordinates — so the bill is a nightly cron job's, measured **20.7s -> 29.1s**, and no visitor waits on any of it.

Worth knowing because it is the opposite of the drop passes: raising the iteration count invalidates NOTHING. `graph_layout_key` hashes surviving node ids and edge pairs, not coordinates, so the old bake still matches by key and goes on being served — the longer run changes nothing until the baker is actually re-run. Dropping nodes is the reverse: it changes the key, the bake misses instantly, and every visit pays the browser stabilisation until a re-bake. One needs a re-run to take effect; the other needs one to stop hurting.

**Shape carries a node's TYPE, colour carries its community.** `code` (1,955) is a hexagon, `rationale` (403) a triangle, `document` (223) a dot — `_TYPE_SHAPES` and `_shape_graph_nodes_by_type` in graph_style.py. It is `dot` and not `circle` even though a dot IS a circle, because vis splits its shapes into two families: `circle`, `ellipse`, `box` and `text` draw the label INSIDE and size themselves to it, ignoring `size` entirely, while `dot`, `hexagon`, `triangle`, `diamond`, `square` and `star` draw the label outside and take their size from `size`. Node size here is geometric in degree, which is the graph's primary encoding, so `circle` would have discarded it for every document and relocated their labels in the same move. The per-node `shape` must be named in graphify's DataSet mapper or it is dropped on the way in — the same explicit-field trap as the baked x/y — and the global `nodes: { shape: 'hexagon' }` stays as the fallback for a type this misses. The cascade's lit glyph follows the shape too (`glyph()` in graph-pulse-draw.js), since lighting everything as a hexagon made a cascade misdescribe what it was crossing; the triangle draws at 1.15x radius because at equal circumradius it reads smaller than the hexagon beside it.

The opening view is `OPEN_ZOOM` **1.2** — renamed from `OPEN_ZOOM_OUT`, which at a value above 1 said the opposite of what it did. It multiplies the cover scale: 0.75 when the cloud was square and the window was not, 1 once the stretch made cover and contain the same number, and 1.2 on request, which crops roughly a sixth off each axis in exchange for nodes large enough to read. Measured at 430x867: the graph draws 513x1032, a 1.19x overflow both ways.

**The lattice keeps equal spacing on both axes, and that bounds what it can do about the viewport.** graphify's cloud is roughly square; the window rarely is. At 430x932 the camera opened on cover, filled the height and ran **2.08x the width** — a phone saw the middle strip of the graph and had to drag for the rest. `snapToGrid` did rescale every node into a box of the viewport's own aspect before snapping, which fitted the outline to the screen (0.50 -> 0.50 at 430x932, 1.72 -> 1.73 at 1280x800) and was **reverted**: square grid points with a stretched picture standing on them is the worst of both, because a force layout means something by distance and scaling one axis alone rewrites that meaning. The map is uniform now — a single `k` applied to x and y — so the step between adjacent lattice points is identical on both axes (measured 97 and 97).

What that costs is the thing it was reaching for. With a uniform scale the grid's row-to-column ratio follows the CLOUD's aspect, not the window's: **107x103 on a 0.50 phone and on a 1.72 desktop alike**. A roughly square cloud cannot become a tall one without either stretching it or moving nodes relative to each other, and both of those rewrite the layout. The camera takes the slack instead. Getting a genuinely tall, undistorted layout means computing it tall — baking a second layout at a phone's aspect in `scripts/graph-layout.py` — not reshaping a wide one after the fact.

Wiring that up surfaced a bug in the size gate from the commit before: `var many = Object.keys(pos).length > AMBIENT_MAX_NODES` ran BEFORE `index()`, which is what fills `pos`. It was counting an empty object every time, so `many` was always false and the one case the gate exists for — a coarse pointer on the full 2,722-node graph — was never gated at all. It looked correct only because `_prune_for_lite` had already made the common case cheap. Verified in WebKit by reading lit pixels off the canvas: desktop ambient peak 261 / after a node click 295; phone (`has_touch`, coarse) ambient **0** / after a node tap 61.

**The reasoning that produced it —** iOS Safari froze on /graph: not a slow load, a FROZEN one, with the nav bar unable to take a tap — the signature of a main thread that never came back, not of a graph that failed to arrive. Everything tried before it (the static cover, the deferred payload, the DPR cap, the pulse gate, the wake repair) made the wait cheaper, better reported, or better behaved, and not one of them made the page do less: 2,722 nodes with 3,582 edges is a page a laptop draws and a phone dies on.

vis's `fit()` is CONTAIN: it scales until the limiting axis fits and leaves the other as empty margin, which on this near-square cloud in a wide window was two black bands with the graph sitting in the middle distance. `nodeBounds()` returns both scales and the page takes **`cover`** = `max(W/w, H/h)`, so neither edge has a gap and the cloud runs off the axis that is not limiting. It is centred on the node bounding box, so the overflow is shared evenly rather than landing all at one end. Measured: 1280×744 opens at 0.0883, cloud width exactly 1.00× the window and height 1.80×; 430×876 opens at 0.0593, height exactly 1.00× and width 2.08×. A wide window fills to width and crops top/bottom; a phone fills to height and crops left/right. **Every node is SNAPPED to a lattice first** (`snapToGrid`, 2026-09-21). The cell is `sqrt(area / (n x CELLS_PER_NODE))` over the cloud's bounding box — 4 cells per node, so most land on their first choice — and a taken cell sends the node ring-searching outward for the nearest free one, compared on real distance within a ring since a ring is a square and its corners are further than its edges. Placement is CENTRE-OUT so the crowded middle claims its own cells before the sparse rim pushes in, which keeps the walk short instead of cascading through the core. Measured on 2722 nodes: a 138-unit cell, 107x103 lattice, 2722 distinct points, zero overlaps. It writes with `network.moveNode`, never a DataSet update — a bulk write fires vis's `_dataUpdated` cascade and rebuilds every physics body. The camera bounds are recomputed after it, since the snap moves everything. **Then it backs off a quarter** (`OPEN_ZOOM_OUT` 0.75, 2026-09-21): cover alone runs the cloud to both edges, and a graph with no margin reads as cropped rather than as filling the frame. Note that at the opening scale (~0.046 on a 900px canvas) a node draws sub-pixel and vis gives it NO hit area — `getNodeAt` finds nothing anywhere on the canvas, so clicking a node means zooming in first. Worth knowing before testing a click by hand: it looks exactly like a broken click handler.

It replaced an `OPEN_ZOOM` of 1.25× applied on top of `fit()` — cover is already about 1.8× contain on a desktop window, so stacking the two would have over-cropped. The zoom-OUT wall stays on CONTAIN × `FIT_MARGIN` (0.8), deliberately looser than the cover the page opens at, so zooming out until every node is on screen at once is still allowed. It used to cap the viewport at half the node-cloud's area, which the opening view violates on arrival.

#### The tour kept its job and lost its mechanism, twice

The original overlay ran a **camera tour** — pick a random cluster every 10s, `network.focus()` its highest-degree node, and random-walk the gravitational constant to keep the layout "breathing" — behind a top-left **freeze | tour** segmented toggle. To do that it **re-enabled physics after graphify had already turned it off**, which left a 4.5k-node canvas running a force sim and redrawing every frame, forever. Measured: **0.4 fps, with 4.2-second frames**.

What was wrong with it was the camera, not the cycling. Flying to a cluster shows you that cluster and throws away the graph it came from; you arrive somewhere with no idea where you are. So the tour cycles as before and lights its stop **in place**, and the freeze toggle is gone outright — physics off is the only state. **The physics configurator panel went too** (2026-09-21), along with every `vis-configuration` rule that themed it: a strip of live sliders governs nothing once the sim is off for good, and a reload undoes whatever they were dragged to. The node-info panel on the right is the only panel left.

#### Why nothing writes to the DataSets, or to `network.body` either

An earlier hover-highlight mutated vis's drawn node objects and called `network.redraw()`. That was already the fast path — measured on the droplet's headless WebKit, for a ~30-node neighbourhood:

| Path | Cost |
|---|---|
| `nodesDS.update()` + `edgesDS.update()` | **7.4s** |
| direct `body.nodes[id].setOptions()` + one `network.redraw()` | **1.07s** |

A DataSet write fires vis's whole `_dataUpdated` cascade — visible-index rebuild, **physics-body rebuild for all 4.5k nodes and 6.5k edges** — on a graph whose physics is switched off and will never run again.

But 1.07s is a *hover*, not a *frame*. Once the tour had to animate, even the fast path was a full graph redraw 60 times a second, so the overlay took over and vis's canvas is now left completely alone. The DataSets stay pristine as the source of truth the overlay indexes at startup.

#### What a redraw costs, and what that means

A warm full redraw of the served graph, on the droplet's headless WebKit (no GPU, shared core — the pessimistic end; a phone or desktop is several times quicker):

| | ms |
|---|---|
| first redraw after stabilisation (cold: label measurement, shape caching) | ~8300 |
| warm redraw, nodes + edges | ~1500 |
| nodes only (edges hidden) | ~717 |
| edges only (nodes hidden) | ~539 |
| arrowheads disabled | ~1463 — **no saving; arrows stay** |

Redraw cost tracks the primitive count almost linearly and splits roughly evenly between nodes and edges, which is why the answer to "rendering is slow" is *draw fewer things* (11b) rather than *draw them cheaper* — and why the firing animation had to move off this canvas entirely. Those numbers were taken at 4561 nodes / 6501 edges; the graph is 2722 / 3582 now, so scale them by about 0.57.

---

## 12. The bottom nav

Current design: [ARCHITECTURE.md §12](ARCHITECTURE.md).

**While the panel is open the bubble is HIDDEN** (`body:has(#exec-panel.open) #exec-bubble { display: none }`, exec-bubble.css — the same rule the card dialog already applies for the same reason). Bubble and panel are both at `--z-bubble`, so DOM order decides and the bubble wins it: wherever it rests it is ABOVE the panel and swallows every tap inside its 50px circle — and the tap it swallows is `togglePanel()`, i.e. CLOSE. At phone width the panel is full-screen and the bubble's resting corner (right 14px, bottom `--nav-h + 10`) lands squarely on the tail of the last choice row and on the composer's `#exec-mute` / `#exec-ph-close`: measured at 430x932, bubble `366..416 x 807..857` over a choice row at `12..418 x 808..841`. So tapping the last answer of a nudge MINIMISED the panel instead of answering it (reported 2026-09-18). The bubble's job is to OPEN; the panel closes from its own `[x]`, or a tap outside where there is an outside — on a phone the panel covers the screen, so `[x]` is the close.

The second half of the same failure is **WebKit touch adjustment**: a tap that lands on no clickable element snaps to the nearest one within ~10px, and the composer's `[x]` is a 29x19 target directly under the transcript's last line (`[x]` at `389..418 x 841..860` against a row ending at 841). `#exec-term` therefore carries `var(--space-2)` of BOTTOM padding as a tap guard, not as rhythm — without it a tap aimed at the last answer, landing a few px low, still closed the panel. Pinned by `tests/test_exec_bubble_overlap_browser.py` (WebKit, 430x932): nothing of the bubble may intersect the open panel, every choice button must be the topmost element at its own left/centre/right, and tapping the row's last answer must send it and leave the panel open.

(The standalone `/directives` timeline page was removed — that timeline now lives in the hq today column.)

---

## 13. The pre-commit hook suite

Current design: [ARCHITECTURE.md §13](ARCHITECTURE.md).

Two traps it hit while being written, both worth knowing:

- **`protected` is a SUFFIX of `guest_protected`**, so an unanchored match files every guest route as admin — the same substring trap `cmdscan.py` exists for. The regex uses `(?<![\w_])`.
- **An included router's alias must resolve to its MODULE.** Nearly every route module names its router `router`, so resolving `chat_router` to the bare symbol and scanning every file swept mtg/tarot/nightfall in as admin.

---

## 14. `/tarot`

Current design: [ARCHITECTURE.md §14](ARCHITECTURE.md).

**The outline used to stand off the art.** A `.tarot-card` was a fixed `--card-w x --card-h` box (0.597 at phone size) with the image `object-fit: contain` inside it, and the 78 scans run 0.5545 (`strength`) to 0.5837 (`the_tower`), median **0.5714** — so no single box could fit them and every face was letterboxed by ~2px a side, while the zoom (`width:auto`, hence intrinsic) hugged its card exactly. The card now takes the HEIGHT and its width from the image (`width:auto` + `justify-self:center`, which is what makes a grid item shrink to fit rather than stretch to its column), and the image is sized `height: var(--card-h); width: auto` — measured gap 0.00px in both states at 430x932. `card_back.jpg` was **cropped 700x1200 -> 686x1200** (0.5833 -> 0.5717) so a flip does not resize the outline under the finger: face-down 73.7px, face-up 73.0px. The back also stops being `object-fit: fill` — it was stretched to a box it did not match. `#sig-card` gets the same hug the other way round: it must keep a box when EMPTY (the back is its background, not an `<img>`), so it carries `aspect-ratio: 686 / 1200` and the background fills it exactly.

**Set that level by MEASURING dBFS, not by picking a multiplier — the usable band is narrow.** The shipping bake (`?v=3`) is the source × 0.15 = **−31.8 dBFS mean / −16.2 dB peak**. That is quiet enough to read as silent on desktop speakers (a "music isn't playing" report that was the music playing: `paused:false`, clock advancing, no media error, verified in chromium/firefox/webkit), but a 2026-09-02 re-bake at **+10 dB → −21.8 dBFS mean** overshot and drowned the reader, so v3 was restored the same day. Anything replacing it has to clear the desktop noise floor without competing with the narration, and that window is well under 10 dB.

**And 4.6s is the mild version.** The first synth after the home box came back from being fully off measured **10.3s to first audio** (2026-09-20 — `OK SLOW` in the nightly log), with the next two at 704ms and 433ms on the same box, so the cold load is the whole of it and it is worse from a cold BOX than from an evicted model. A querent would have watched a blank terminal for ten seconds before the reader said a word.

---

## 15. The nudge loop

Current design: [ARCHITECTURE.md §15](ARCHITECTURE.md).

The old stall-peel path (`peel_sync`/`apply_peel`/`_PEEL_FLOOR_MIN`/`_stall_generate`, the whole "peel a tinier first sub-step off a stalled step" mechanism) was **removed 2026-08-28**. `window_deadline` and `redecompose_count`/`redecompose_at` are now **vestigial** fields on `card["nudge"]` — still in `default_nudge_state`, never written.

**EVERY open question keeps its buttons — nothing is wiped.** `clear()` used to run at the top of `attach()` and remove every `.exec-choice-row` but the one being added, on the theory that an older question had been overtaken. It had not. A day that fires two nudges asks two real questions about two different cards, and Wai answers them when she surfaces rather than in arrival order. Wiping left exactly ONE tappable row on screen, under the NEWEST card, so a tap meant for an earlier question hit the wrong one. Measured 2026-09-16: nudges at 14:00 (climbing) and 17:57 (Lyre poster); the 23:22:59 tap meant for climbing PATCHed `craft-lyre-poster` to archives, and climbing was archived by hand from /hq 22s later. `clear()` is now a no-op kept only because `exec-bubble.js` calls it before sending a typed message.

---

## 16. The Exec monitor

Current design: [ARCHITECTURE.md §16](ARCHITECTURE.md).

Orphaning happened because `_save_chat`'s chronological `ts`-sort could **split a tool turn**: a `tool_use`/`tool_result`-only message has no text key, so it was stamped a fresh `now` while its paired text kept its old `ts`, floating them apart.

Fixed on both sides: `sanitize_history_for_api` guarantees the outbound sequence is valid regardless of stored corruption, and `_save_chat` now makes a keyless (structural) message **inherit the preceding message's `ts`** so a tool turn stays contiguous in storage.

---

## 17. Memory is the scarce resource on this box

Current design: [ARCHITECTURE.md §17](ARCHITECTURE.md).

**The graphify post-commit rebuild was the repeat offender.** `graphify.watch._apply_resource_limits()` renices to 10 and then RETURNS WITHOUT CAPPING unless `GRAPHIFY_REBUILD_MEMORY_LIMIT_MB` is set, so it ran unbounded at ~780MB and invoked the global OOM killer — which took out `dbus-daemon` (2026-09-10) and uvicorn-side `python` three times (2026-08-31, 09-01, 09-02).

Two fixes, both applied 2026-09-10:

1. **`graphify-out/GRAPH_REPORT.md` + `graph.html` had been root-owned since Aug 22**, so every rebuild did the full work and then died at the write — never recording state, so the next run redid it all. `chown wai-root` turned a ~780MB full rebuild into a **125MB no-op**. *Check ownership first when a rebuild looks expensive.*
2. `export GRAPHIFY_REBUILD_MEMORY_LIMIT_MB=600` in `~/.zshenv` (git hooks inherit it from the invoking shell) so the rebuild dies of `MemoryError` and logs it instead of taking the site down. A failed graph is cheap; a 502 is not.

**Ad-hoc WebKit/playwright runs are the other hazard** — MiniBrowser triggered the 2026-09-10 21:09 OOM. Wrap heavy one-offs in `systemd-run --user --scope -p MemoryMax=...` and check for strays afterwards with `pgrep -f '[M]iniBrowser'` (the bracket keeps the pattern from matching its own command line).

Found 2026-09-16 while chasing "the box feels slow and laggy". It was not the cause of the lag (that was swap thrashing — below), but it was a permanent tax nobody had measured.

The cost came from what was in the tree, not the tree's purpose:

| Subtree | Entries walked | Reason it was there |
|---|---|---|
| `/app/nightfall/nightfall-src` | **29,010** | rode along inside the `./nightfall-incident` bind mount |
| `/app/graphify-out` | 1,398 | `:ro` mount, served by `/graph` |
| `/app/data` | 742 | the data volume |
| `/app/static` | 205 | `./web` |
| everything else | ~2,800 | actual Python source |
| **total** | **34,187** | to find **66 `.py` files** |

Measured: **0.209s per pass on a 0.25s interval** — an ~84% duty cycle on one thread of a 2-core box, reported by `top` as 44-47% and by `ps` as 82 CPU-hours over the container's 8-day life.

`nightfall-src/` is the game's SOURCE (354MB with `node_modules`). **Nothing at runtime reads it** — `routes_nightfall._NF_DIR` reads only `wai-head.js`, `wai-body.html`, `wai-save-sync.js`, `index.html` and `static/`, and `main.py` mounts `/app/nightfall` as `StaticFiles`; webpack runs on the host. It was pure walk cost.


**The rebuild used to be expensive for a vestigial reason, so it was made cheap first.** `api/Dockerfile` opened with `FROM golang:1.24-alpine`, which `git clone`d and `go build`s **rmapi**; `rmscene` came from git alongside it. Neither had a single reference in any `.py`, `.sh`, `.js` or cron file. On a 2-core/1967MB box a cold `go build` is a real OOM risk, so the `watchfiles` rebuild was blocked behind a decision that had nothing to do with `watchfiles`. Both were removed 2026-09-17 (see §1, *Image*) — the build is now one `python:3.12-slim` stage and a `pip install`, which is why `watchfiles` could land without waiting on a memory cleanup first.

**It did neither until 2026-09-22, and this section described a script that did not exist.** `DAY_LOG` was computed, `CRON_DIR` was created, and then nothing wrote to that path except the `API_KEY not set` branch: the POST and its status line were redirected straight to `/var/log/exec-fn.log`, inside the container, where `/debug` cannot reach them. So **no `__morning.log` was ever produced** — of the five nightly jobs, the one whose silent failure matters most was the only one invisible on the page built to catch exactly that, and the gap showed up only because the other four jobs' logs were sitting there next to it. Fixed by piping both lines through `tee -a "$DAY_LOG"`, which is also what makes the `${PIPESTATUS[0]}` rule above load-bearing rather than theoretical (measured in the rebuilt container against a 404: `PIPESTATUS[0]` = 22, `$?` = 0).

---

## 18. The typewriter and the shared chat surfaces

Current design: [ARCHITECTURE.md §18](ARCHITECTURE.md).

**The caret mirror is the argument for all of it.** Four surfaces drew the same drawn-caret, and after WebKit threw `IndexSizeError` on a stale selection — blanking the page mid-send — the fix landed in three of them. The panel kept the broken copy until the files were merged. A copy is a fix you will forget to apply.

It used to sit after, among the settle-pass work — so the voice waited out the entire typewriter run and only began once the last character had landed. On a long reply that is the whole point of the narration gone: the screen has finished saying it. Measured with a stubbed stream at 430x932: speech at 740ms, reveal complete at 3396ms, i.e. **2656ms of silence that should have been narration**.

---

## 19. `/zombo`

Current design: [ARCHITECTURE.md §19](ARCHITECTURE.md).

**The page is the movie and one line, and nothing else.** A CSS reproduction of the intro used to sit underneath as a fallback — wordmark, loader cluster, caption crawl, plus `zombo-audio.js` synthesising a bed and voice for it. All of it was deleted 2026-09-17. If the movie cannot mount, the page says so rather than drawing an imitation of it.

**Positional selectors were a bug that shipped.** A `<br>` is an element child too, so the moment the copy gained a line break every `:nth-child` cycle after it shifted by one and a handful of letters fell through every rule to the default ink — they rendered BLACK. The per-word wrapper compounds it: it nests the spans, so they are no longer siblings of one parent and a positional match fails outright. An explicit index is immune to both. Each **word** is wrapped (`.zb-w`, `white-space: nowrap`) because every character is an `inline-block`, so a line break could otherwise land between any two letters — it broke `exp / erience`.

The alternatives were all measured and all worse:

| Approach | Result |
|---|---|
| `scale: 'noBorder'` | covers by whichever axis needs it — on a portrait phone that is HEIGHT, cropping the wordmark to "mbo.co" |
| `scale: 'exactFit'` | stretches ~2.4× vertically on a portrait phone |
| `backgroundColor: 'transparent'` | breaks this movie's rendering outright — the whole page came back solid green |
| width × 11:8, overflow at the bottom | band reaches the edges, but the loader cluster gets cropped on a short window |
| **fit + sampled pillars** | nothing cropped, band edge to edge, and it tracks the movie |
