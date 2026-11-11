## 10. The CRT effect stack (`_CRT_FX`)

Current design: [ARCHITECTURE.md §10](../architecture/10-crt-effects.md).

**Tint, 2026-09-21.** The phosphor read heavy on every page, so it was dialled TOWARDS WHITE: saturation −40 and lightness +25 off `--cat-social` (125 55% 68% → ~125 15% 93%), written as `calc()` on those channels — the idiom `--card-social-plan` already uses, which keeps it on the palette with no new colour literal and no baseline to regenerate. The lesson is that **opacity and hue are different knobs**: the first attempt dropped the stripe's alpha from 0.45 to 0.25 and pulled the contrast filter back with it, which makes the scanlines fainter while leaving them exactly as green. Both are back where they were.

**The measurements behind that.** The glass was removed 2026-08-30: back then it sat UNDER the sweep, took ~45% of frame time at **1131ms/frame** in WebKit, and the page filled in **top-to-bottom** because the engine could not finish a viewport in one vsync. It was **reinstated 2026-08-31** with the scan-above-glass fix, and re-measured live at 430×932: WebKit steady-state is **16.9ms/frame WITH the glass vs 16.5ms without** — 60fps, the blur adding ~0.4ms, which is the proof that a static backdrop caches.

Also gone since 2026-08-30 and not coming back: `plus-lighter` on `.cyber-bg`, `overlay` on `.cyber-scan`.

Merging `.cyber-bg` INTO `.cyber-lines` as one hard-light element buys ~42ms more in WebKit but was **rejected**: one blend pass cannot compound the way two do, and the scanlines flatten out over text.

The `.cyber-crt` punch was tuned 2026-08-31 from `brightness(1.03) contrast(1.1)` to a **multiply feel**: `brightness < 1` darkens the unlit ground, and high `contrast` (pivot 0.5) crushes the sub-midpoint green haze toward black while the bright green text clamps at max — unlit MUCH darker, lit text held. It is a filter, not a colour, so it pops the phosphor greens and deepens the blacks without touching the palette, and it caches exactly like the glass because its backdrop never animates. Over the sweep it would re-fire every frame, the same trap.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Login screens (2026-09-21).** `/login` builds from the raw static shell and `/guest` from the bare one, so neither was picking up `_CRT_FX`; added then.
- **Phosphor dialled toward white (2026-09-21).** Saturation −40 and lightness +25 off `--cat-social` (125 55% 68% → ~125 15% 93%), via the same `calc()`-on-channels idiom `--card-social-plan` uses. The first attempt dropped the stripe's alpha to 0.25 instead, which made the scanlines fainter while leaving them exactly as green; alphas are back at 0.45/0.06. The punch's contrast went 1.5 → 1.25 in a comment trail then back; the shipped values are 0.85/1.5.
- **Scanline shoulder** widened 0.25px → 0.75px 2026-08-31 (the hairline read too faint); a brief bump to full-opacity black was reverted.
- **Blend layers.** `.cyber-bg` was `plus-lighter`, the sweep `overlay`; three full-viewport blend layers cost 3x baseline frame time and a blend on the sweep cost 110ms/frame in WebKit alone. Both are now plain alpha; `.cyber-lines` is the one blend layer left.
- **Glass history.** The glass was the single most expensive thing on the site (233ms/frame WebKit, ~45% of frame time) and was removed 2026-08-30 because it sat UNDER the animated sweep; reinstated 2026-08-31 above bg+lines with the sweep above it (idle readback cost 0).
- **CRT lite measurement (Chromium `--disable-gpu`, 4x CPU throttle, 2026-10-06, on `/`).** 1440x900 baseline 5fps idle / 6fps spinning, 430x932 15fps; without the panes + sweep 60fps at both widths. The blend layer and the wheel's per-item blur/text-shadow were each measured and are NOT the cost. A GPU machine measures ~16ms and keeps the full stack.
- **Dim history.** `/rd`, `/hq` were pushed behind content at `z-index:-1` (taking the in-the-CRT look off the boards), restored to the top at 0.5 on 2026-09-07, `/mtg` joined 2026-09-11 (so did the `/cc` page, folded 2026-09-29), and the dim went 0.5 → 0.75. Previously the same three lines lived in both rd.css and hq.css. Half of 0.45 is 0.225 and three quarters 0.3375 — off the snap scale, hence `opacity`.
- `.exec-nav` has a boot-in stagger honoring `prefers-reduced-motion`; icons scale on hover.

### 10-notes. From CLAUDE.md (moved 2026-09-27) — verbatim

**[Web app → CRT stack]**

Cyberpunk fx — the shared CRT stack `_CRT_FX`, **five** fixed `pointer-events:none` layers injected by `_render_page`/landing/graph, all at `--z-modal`: `.cyber-bg` (phosphor) · `.cyber-lines` (static black scanlines, `hard-light`, the ONE blend layer) · `.cyber-blur` (glass, `backdrop-filter: blur()`) · `.cyber-crt` (phosphor punch, `backdrop-filter: brightness/contrast`) · `.cyber-scan` (the sweep beam, the ONE animated layer). **Paint order = DOM order — `bg → lines → blur → crt → scan` — is load-bearing.** The invariant, and the most expensive rule in this repo to rediscover: **a `backdrop-filter`/`mix-blend-mode` layer is a full-viewport readback with no partial invalidation — cheap ONLY when nothing under it animates (the compositor caches the texture), ruinous when it sits OVER an animated layer (it re-fires every frame, forever).** So: do NOT put a `backdrop-filter`/`mix-blend-mode` layer UNDER an animated one, do NOT give `.cyber-scan` a blend mode, and do not animate anything that sits beneath the glass (that is what froze the old `/cc` page in voice mode). The dense text-heavy pages (`/rd`, `/hq`, `/mtg`) keep all five on top but **dimmed to 0.75** via the shared `web/crt-dim.css` — dimmed with `opacity`, never by rescaling the gradient alphas, which would land off the palette snap scale and be lint-rejected. `/tarot` stays at full strength. **The phosphor was dialled TOWARDS WHITE 2026-09-21** — saturation −40 and lightness +25 off `--cat-social` (125 55% 68% → ~125 15% 93%), via the same `calc()`-on-channels idiom `--card-social-plan` uses, so it stays on the palette with no new literal and no baseline to regenerate. **Opacity and hue are different knobs**: the first attempt dropped the stripe's alpha to 0.25 instead, which makes the scanlines fainter while leaving them exactly as green. Alphas are back at `0.45`/`0.06` where they belong. **Both login screens now carry the stack too**: `/login` builds from the raw static shell and `/guest` from the bare one, so neither was picking up `_CRT_FX`; the layers are fixed, `pointer-events:none` and at `--z-modal`, so they sit over the form without taking a click off it. `.exec-nav` sits at `--z-top`, above the fx. Zoom-lock lives in `web/crt-zoom.js` (`--crt-scale`).


---

