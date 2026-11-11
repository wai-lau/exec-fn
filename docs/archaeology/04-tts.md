## 4. TTS (text-to-speech)

Current design: [ARCHITECTURE.md §4](../architecture/04-tts.md).

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

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Pre-fix premise removed**: §4 opened with "Every voice streams from a single home GPU box... No TTS models run on the droplet; the container only proxies." Wrong since glados moved to the `hosaka-piper` container on the droplet.
- **GPU-mode drift** (`gpu-mode.js`): its recheck-on-load and refresh-on-refocus only covered pages that got touched; its own comment said "No interval -- a long-open foreground tab drifts until touched". The 15s poll in `/mode/stream` fixed pages already open. Before the 90s homo grace, the next poll read "homo but no TTS" and flipped the strip idle→homo.
- **Terminal-frame guarantee**: before `_pump_to_client`'s synthesized error, a silently-dead upstream left `/tarot`'s reveal spinning forever with text stuck part-revealed. The stall watchdog originally used raw `el + dur` for progress, which never stopped rising (the ctx clock keeps running after the buffer drains), so it could never fire.
- **`/hosaka` button rename 2026-09-10**: the middle GPU-mode button was renamed `down`; `data-mode` stayed `idle`.
- **Star glyph (`[✦]`) geometry**: Iosevka has the glyph and its advance IS the mono cell, so in `--font-mono` the star occupies one character: three cells for `[✦]`, three for `[x]`, 29.28px each, line box a character's. `transform: scale(1.25)` sets how much of the cell the star fills (ink 6.67px → 8.67px; gap to each bracket down to 1px vs the `[x]`'s 2.33px). Layout is untouched at any factor, which is why the size lives in a transform. Both bars measure 24.61, both controls 29.28. The nav's glyph label is sized the same way (§12). `/tarot` overrides in `tarot.css`: its column has `[↺]` at 1.7em and `[♪]` at 1.3em with real side margins, so the cell-sized star read tiny (ink 5.67px vs the note's 10.67, 1px gaps vs 4px); it takes the reset glyph's metrics plus the factor that brings ink to a note's: 10.33px, 3.33px gaps, same button height as `[↺]`.
- **Mic send arm**: a pause used to send half a thought and let the rest arrive as a second message, hence the 1s `SEND_DELAY_MS` arm. Finalized text is held on the session (`pending`), not read back off the composer, because iOS ends the recognizer on silence and the rebuild resets `base` to 0; an EMPTY result event never cancels the arm; tapping the mic off mid-window deliberately does not send. `cc-mic.js` went with the `/cc` page.
- **Moved from CLAUDE.md 2026-09-27** ("4-notes"): voice-both-ways, `/hosaka` page, `/api/hosaka/mode`, `/mode/stream`, `WS /ws/hosaka`, `WS /ws/hosaka/presence` blocks; now folded into 4a–4e.


---

