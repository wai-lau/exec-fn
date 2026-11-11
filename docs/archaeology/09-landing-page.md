## 9. The landing page

Current design: [ARCHITECTURE.md §9](../architecture/09-landing-page.md).

**What it replaced:** a full-height column of all eight that ran **1289px tall in a 932px viewport**, where `body{overflow:hidden}` silently clipped the last two sections off the bottom.

### Moved out of ARCHITECTURE.md (2026-10-15 pass)

- **Measured 2026-10-14 at 11 sections, headless WebKit, read from the live globals (`wheelDth`, `wheelR`):** `K`=6 (`ceil(11/2)`, the odd-`n` round-up), `DTH`=15°, all 11 lit at every resting position, at 430×932 (R 317px), 382×700 (R 394px) and 1280×800 (R 274px). At 9 sections it was `K`=5, `DTH`=18°, all 9 lit.
- **Spacing verified 2026-10-14** at every one of the 11 resting positions (front gap = focused item to each neighbour): 430×932 front gaps a constant 22px; 382×700 front gaps 4–45px (4px only where the two tallest blurbs sit together); 1280×800 front gaps 4px (`WHEEL_MIN_GAP`; pitch is tight at desktop). No lit item's centre is past the viewport except the faint rim bleed `WHEEL_REACH` allows (2 at 382×700). At 9 sections (430×932 / 390×844 / 1440×900 / 1280×700): all lit, front gaps 7–45px.
- **Rounding up on odd `n` pays twice**: it lights every item and narrows `DTH`, which tightens the front spacing (`R·sin DTH`).
- **Frame cost.** Blur quantised to a half-pixel and dropped under 1px so a spin hands the compositor two distinct radii across four elements instead of a new value on six. WebKit at 430×932 holds a 17ms median frame through a spin, blur on or off. Position settle uses real elapsed time so it takes the same wall-clock at any frame rate.
- **Left-edge scaling.** Centre-origin is the truer projection but cascades the icon column rightward as items recede, reading as a vanishing point off to the side rather than a wheel.
- Recruiter and security share hue 36°; security is second because its blue secondary leans toward what follows.

### 9-notes. From CLAUDE.md (moved 2026-09-27) — verbatim

**[Web app → Landing page]**

`/` is a public landing page (`_landing_html()` in routes_views, styles in `web/landing.css`, driven by `web/landing-wheel.js`) — no auth, no exec bubble. It is a **ferris wheel**: eleven sections as spokes on a ring seen edge-on, ordered by icon hue (`_LANDING_HUE_ORDER`), each showing its nav code (`_NAV_LABELS`), its own title (`_LANDING_BLURBS`) and one line saying what it is (`_LANDING_DESCS`). Scroll, drag/swipe, or arrow-key it; tapping a lit item turns the wheel to that slot first, then follows the link. Logged-in admins (valid `session` cookie) skip the landing and 302 to `/rd`; an `admin` link sits bottom-right → `/login`; clicking a section follows the 401 redirect to the right login. The geometry solves itself at the viewport it is being viewed at (`wheelGeometry`) — do not hard-code slot counts.


---

