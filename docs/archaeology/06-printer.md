## 6. Printer (ELEGOO Centauri Carbon)

Current design: [ARCHITECTURE.md §6](../architecture/06-printer.md).

Verified end-to-end against the live printer with the real app under
uvicorn (auth tiers, rewrites, etag→304, un-gzipped MJPEG, WS relay + the
cmd-386 rewrite, reconnect splice against a fake upstream that drops every
few frames).

Nav label is `3DP`, icon `printer.png` — the bitman smiley tile with rounded corners, baked from the untracked `bitman.png`. Its tile was recoloured lime→blue `#0090fc` on 2026-08-30: the lime read as the phosphor `.active` green, so the nav item looked permanently lit on every page. The route, icon key and internal name all stay `printer`; on the landing page it sits between nightfall and UI (its hue slot moved with the recolour).

**That interval was 0.5s (~2fps) until 2026-09-19 and read as broken rather than thrifty.** A print head moves far enough in half a second that consecutive frames look like unrelated stills, and a camera pointed at a machine exists to show the machine moving. 5fps is where motion reads as motion; the bandwidth is bounded twice over — ~34KB a frame, and `MAX_VIEWERS` caps the whole page at 16 streams however many people find it. Verified live: 5 concurrent viewers = 1 upstream socket, every part a valid JPEG.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Guest tier added 2026-08-30. Guest page cut down 2026-09-19: strip mirrors the vendor SPA's print-job row minus pause/stop (decoration over a 401); dropped page chrome (`.printer-head`: lede + online chip talked about a machine the guest does not drive), and nozzle/bed/chamber temps (telemetry, not "what is it printing"). Filename/thumbnail never sent by `public_status`.
- Job strip as a CARD (2026-09-19): it was a full-width grid with state chip hard left and percent hard right, a whole phone-width apart. As a card sized to its content the eye travels down. Same surface as `.doc-card` (green 0.12 over the page, matching border), one step down on radius/padding because it holds four values. `.pj-rows` stacks one pair per line because side by side elapsed + remaining + layer are wider than the feed and the card reads as a caption bar. Idle: state chip alone, no card around one word.
- Guest frame rate history: 0.5s (~2fps; a moving print head read as a slideshow of unrelated stills), then 0.2s (5fps), now 0.1s ceiling.
- **Lag fix 2026-09-26** ("the printer page is super laggy"), measured causes: (1) a strict `gap < interval` throttle against a ~100ms upstream skipped the frame landing at 199ms, so "5fps" was 3.3fps of 300ms gaps; both throttles now accept from `_SLACK` 0.75. (2) A pushed MJPEG body queues in uvicorn's transport, nginx and two kernel socket buffers, none dropping: client reading at 100KB/s saw 3.5s median, 7s and climbing after 25s. Pull model: same client ~380ms flat; a fast one 4.99fps at ~7ms. Still laggy on iPhone (Safari and Chrome): guests were capped at 5fps against the owner's 10; and one pull at a time capped a phone at 1/(RTT+transfer) — 150ms added RTT gave 6.4fps with one in flight, 9.9fps with `PULL_DEPTH` 2; real guest page in WebKit with 150ms injected measured 9.5fps, max gap 168ms. Guest costs ~340KB/s droplet egress only (home uplink carries one stream). Test: live 5s pull AS A GUEST with 150ms added RTT asserting >=8fps with no hole.
- Scrollbar (2026-09-19): the vendor document painted the browser's grey system bar, a bright strip down an otherwise green page. Verified by pixel: thumb reads phosphor green at the gutter, 4px of fill in a 12px bar. Two hammers needed: `html ::-webkit-scrollbar` (SPA's styles.<hash>.css wins on specificity otherwise) and `!important` (Angular-injected inline copy lands after our `<link>`, wins on source order).
- Gzip: newer starlette binds the exclusion list as a constructor-kwarg default at import time, so the module-global patch was silently ignored and MJPEG frames (and the fonts/images already listed) were gzipped after all; tuple now carries prefix and `type/*` spellings.
- Verified end-to-end against the live printer under uvicorn: auth tiers, rewrites, etag→304, un-gzipped MJPEG, WS relay + cmd 386 rewrite, reconnect splice.
- Hub reconnect: upstream closes 10s after last viewer leaves, releasing one of the printer's 4 streams; viewer bodies are the hub's own re-mux so an upstream boundary change no longer matters.


---

