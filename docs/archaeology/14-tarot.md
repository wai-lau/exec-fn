## 14. `/tarot`

Current design: [ARCHITECTURE.md §14](../architecture/14-tarot.md).

**The outline used to stand off the art.** A `.tarot-card` was a fixed `--card-w x --card-h` box (0.597 at phone size) with the image `object-fit: contain` inside it, and the 78 scans run 0.5545 (`strength`) to 0.5837 (`the_tower`), median **0.5714** — so no single box could fit them and every face was letterboxed by ~2px a side, while the zoom (`width:auto`, hence intrinsic) hugged its card exactly. The card now takes the HEIGHT and its width from the image (`width:auto` + `justify-self:center`, which is what makes a grid item shrink to fit rather than stretch to its column), and the image is sized `height: var(--card-h); width: auto` — measured gap 0.00px in both states at 430x932. `card_back.jpg` was **cropped 700x1200 -> 686x1200** (0.5833 -> 0.5717) so a flip does not resize the outline under the finger: face-down 73.7px, face-up 73.0px. The back also stops being `object-fit: fill` — it was stretched to a box it did not match. `#sig-card` gets the same hug the other way round: it must keep a box when EMPTY (the back is its background, not an `<img>`), so it carries `aspect-ratio: 686 / 1200` and the background fills it exactly.

**Set that level by MEASURING dBFS, not by picking a multiplier — the usable band is narrow.** The shipping bake (`?v=3`) is the source × 0.15 = **−31.8 dBFS mean / −16.2 dB peak**. That is quiet enough to read as silent on desktop speakers (a "music isn't playing" report that was the music playing: `paused:false`, clock advancing, no media error, verified in chromium/firefox/webkit), but a 2026-09-02 re-bake at **+10 dB → −21.8 dBFS mean** overshot and drowned the reader, so v3 was restored the same day. Anything replacing it has to clear the desktop noise floor without competing with the narration, and that window is well under 10 dB.

**And 4.6s is the mild version.** The first synth after the home box came back from being fully off measured **10.3s to first audio** (2026-09-20 — `OK SLOW` in the nightly log), with the next two at 704ms and 433ms on the same box, so the cold load is the whole of it and it is worse from a cold BOX than from an evicted model. A querent would have watched a blank terminal for ten seconds before the reader said a word.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

**Status bar.** Those lines used to be `.msg.sys` entries in the chat scrollback. The `[State: …]` parrot: the model sometimes echoed the per-turn Phase 1 count note as its reply's first line ("[State: Phase 1 turn count = 5.] You've said enough…", 2026-09-27); the note was made private and the filter added.

**Cards.** The old fixed `--card-w x --card-h` box letterboxed every one of the 78 scans. `card_back.jpg` cropped to the median (earlier docs quoted 0.5714). Before `paintFlipped` the card she had just turned kept showing its back for the length of the reading.

**Narration (2026-09-20).** The ♪ button used to be a volume mute that kept narrating and kept pacing the reveal to audio nobody could hear. `twAudio` moved out of `tarot-stream.js` into shared `web/typewriter.js` when the Exec panel got the same voice.

**Mic.** A reading is the longest conversation on the site, run to five Phase 1 answers, a query dialogue and three turned cards, often had lying down: a lot of phone typing in the dark. The narrator core's `speaking` flag used to be cleared only by the queue's own drain, so `/tarot` left it true forever and nothing noticed until a microphone needed to know when the reader had stopped talking.

**Ambient level.** Set by measuring: a +10 dB re-bake drowned the reader. Usable band well under 10 dB; must clear the desktop noise floor without competing with narration. A `?v=` earlier bakes existed before `?v=3`. File-name archive master `~/tarot-ambient-0.15-orig.m4a`.

**Openings: why the first reading of a day was slow.** Generating live cost an opus round-trip AND a TTS synth before the querent had typed a word; on the first reading of a day the synth is a COLD one: ~4.6s of model load against 0.36s loaded (measured 2026-09-10). Image of the pre-generation: the page used to carry an inline opening block at the end of tarot-chat.js. Generation: asked for ten at a time the model varies them against each other instead of converging on the same lamp and the same siren; asked one at a time it would not. A bad opening would be frozen into audio and played for months, hence drop-not-repair. The id-shape defence is the same structural guarantee `gamesave_store` makes with its sha256 component. WAV: ffmpeg lives on the HOST only; an encoder in the container means a new pinned dep and a re-resolve of the whole lock, which is how `httpx`/`httpx2` took the site down (§1).

**Home-box-down note.** The page used to say nothing until the first turn had already failed mid-reading. A note that contradicts the voice currently talking is worse than no note; a note that guesses is worse than no note.

**Nightly check.** Five jobs (morning 4:30, graphify 5:00, security 5:10, cc probe 5:20, tarot 5:45) sequenced so none contend for a 1967MB box. In-process rather than cron for the same reason as the nudge loop (a baked `/etc/cron.d` entry needs an image rebuild to change).


---

