## 18. The typewriter and the shared chat surfaces

Current design: [ARCHITECTURE.md §18](../architecture/18-typewriter-chat.md).

**The caret mirror is the argument for all of it.** Four surfaces drew the same drawn-caret, and after WebKit threw `IndexSizeError` on a stale selection — blanking the page mid-send — the fix landed in three of them. The panel kept the broken copy until the files were merged. A copy is a fix you will forget to apply.

It used to sit after, among the settle-pass work — so the voice waited out the entire typewriter run and only began once the last character had landed. On a long reply that is the whole point of the narration gone: the screen has finished saying it. Measured with a stubbed stream at 430x932: speech at 740ms, reveal complete at 3396ms, i.e. **2656ms of silence that should have been narration**.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Before the merge, the shared pieces were: transcript look = three near-copies of forty lines; stream bubble + caret mirror = four copies each (the panel's caret lacked the try/catch the others grew after WebKit threw `IndexSizeError` on a stale selection and blanked the page mid-send); reveal = `tarot-stream.js` owned the audio half; voice = two hand-written narrators; mic = one engine, three near-identical bindings.
- Speed: measured ~45 chars/sec on a real /mtg reply at SPEED 2; the multiplier went 2 -> 3 -> 5 (2026-09-14) as the reveal kept reading slower than the eye. At 5 the 65ms char is 13ms, still a reveal rather than a paste.
- `twAudio` was `/tarot`'s main path in tarot-stream.js; moved into the shared engine 2026-09-20 when the Exec panel got the same voice.
- `FIRST_AUDIO_MS` was 8s; raised to 12s after a cold synth measured 10.3s off a box that had just come up (§14d).
- Why syntax costs zero reveal time: charging time for a span the voice skips puts a long code block's worth of drift between words on screen and in the air (the panel's normal reply shape).
- Jump sample: 283 chars in 150 frames for a sample holding every syntax form; `Done - not a bullet, 3 * 4, a # hash.` still types as prose. 89-char reply with one SVG block: 18 frames instead of 89, the 72-char block landing in one. Half a URL revealed and then taken back is worse than a short pause; a `|` mid-sentence would be mistaken for a table; typing a table shows a row of raw pipes slowly becoming one.
- The blink cursor: dropping the empty bubble for a tool call used to take the only "still going" signal off screen, so a long search looked like a stopped page. Dot spans are `display:none` rather than churning three files.
- Narration ordering bug: `execVoice.speak()` used to sit after the reveal await, so the voice opened its mouth once the last character landed (speech started 2.7s late measured). `speak()` is fire-and-forget (strips markdown and `[bracketed]` rows, opens the TTS socket, returns), so moving it earlier cannot delay the text. Only the streamed reply had the bug; `addMsg` never did.
- Transcript look drift: Exec's scrollback a step tighter than /mtg's, sys lines near-invisible on one page and legible on another. The composer-merged-into-scrollback used to be an override in chat-reader.css, leaving the slab variant styled but unreachable. chat-doc.css was the same ten lines copied into each page file. Markers used to be inline `::before` of varying width, one indent per role.
- Sys alpha moved 0.12 -> 0.45: at 0.12 it was legible only as a smudge, which is how /cc's "not logged in" got read as a broken page. `--lh-tight` was added to chrome.css for this.
- Headless WebKit: `#exec-panel` is in the DOM, hit-tests on top, paints nothing in the PNG.
- Link rule incident (2026-09-19): the biweekly EI card's nudge said "open the login link" while the `hrdc-drhc.gc.ca` URL sat in its notes; the reader is on a phone, so the instruction handed her a search instead of a tap. The scheme check goes through `URL()` because the regex scrub after `marked.parse` only caught a literal `javascript:`, and `java\nscript:` is the same href to a browser. `/mtg` already rendered links this way; the panel was the one surface on bare `marked.parse`. The one line in the transcript that carries links (`probe`) rendered in UA default blue until `.msg.probe a` was added. `.msg.monitor` is vocabulary no JS applies any more.
- 2026-10-14 security audit: `marked` passes raw HTML through and the old regex scrub let `<img src=x/onerror=…>`, entity-encoded `javascript:` and `<iframe srcdoc>` survive; a reply steered by a web page the agent read would have run as the owner. Fixed with DOMPurify on every `marked.parse`. `marked` 15.0.12 is byte-identical to what the unversioned CDN URL served. An unpinned jsDelivr script ran with the page's origin and could read every noodle identity in localStorage or call owner APIs, hence vendoring.
- `18-notes. From CLAUDE.md (moved 2026-09-27)` and `19-notes`: verbatim CLAUDE.md dumps that duplicated the subsections; deleted in the rewrite (all content already in §18/§19 above or here). The /zombo one additionally recorded: the CSS fallback reproduction (wordmark, loader, caption crawl) and `zombo-audio.js` (synthesised bed + voice) deleted 2026-09-17; the page-local red-Z favicon override dropped 2026-09-17; alternatives measured and worse: `noBorder` crops the wordmark to "mbo.co" on a phone, `exactFit` stretches it 2.4x, `backgroundColor:'transparent'` broke rendering (page went solid green), width-driven sizing cropped the loader on a short window.


---

