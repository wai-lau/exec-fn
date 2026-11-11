## 19. `/zombo`

Current design: [ARCHITECTURE.md §19](../architecture/19-zombo.md).

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

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- Trap 1 history: a version asked wai-lau.net for `/welcomeclip.swf`, got a 404 and played a blank 1360-frame white rectangle while `load()` resolved happily.
- Trap 2 measured: `player.metadata` is `null` at the promise's resolve, `{550×400, 1360 frames}` four seconds later; a version read it there, treated empty as failure and tore down a healthy player.
- Link rewrite: plain HTTP to a domain that has not served that page this century; clicking navigated the tab off the page to nothing. The movie carries no URL string at all (its type is drawn as glyph shapes). Overriding `window.open` would only cover the named-target case, not this link. The fragment is padding that happens to record where the visitor came from; the landing ignores it.
- Colour classes: positional selectors shipped as a bug: adding the `<br>` shifted every cycle after it and dropped letters through to the default ink (visible as BLACK letters); the line otherwise broke mid-word (`exp / erience`). Nine hues against five offsets repeat only every 45 characters; blue three times, orange twice because it is a sequence to repeat, not a palette.
- Pre-click hide: `visibility: hidden` is inherited but a descendant can override it; Ruffle's play overlay sets `visibility: visible` on itself, parking a large orange play button on the begin line. Ruffle's own unmute control is a speaker button the intro never had.
- Cross-fade: movie fade was 1.4s, line fade 1s; raising the movie's fade alone leaves a second of blank white paper mid-transition.
- Sizing: without `display: block` the movie sat hard left with both pillars bunched on the right; a fixed CSS gradient for the pillars was the first attempt and is wrong in principle (hardcodes the opening frames, drifts as the movie animates).


---

