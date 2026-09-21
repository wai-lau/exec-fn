# icons/ — outline SVG twins of the PNG icon set

One `.svg` per icon PNG in `web/`, same basename. These are line-art
redraws, not traces: the sources are 27x27 pixel art whose shapes vanish
at any size, so each icon was re-drawn as the same subject in one shared
stroke style.

The style contract, which every file in here follows:

- `viewBox="0 0 32 32"`, art kept inside x/y 3..29.
- `fill="none"`, `stroke-width="1.8"`, round caps and joins. The
  background is the page's -- there is no backdrop rect and the root
  carries `fill="none"`, so every one of these is transparent.
- The stroke is the SOURCE PNG's tile colour, sampled from its border
  ring: the 27x27 art sat on a flat coloured square, and that square is
  the icon's identity (fiddle's `#0090fc`, watchman's `#ff258a`). It is
  written twice on the root, `stroke="..."` and `color="..."`, so the
  `currentColor` dots below resolve to it too. Both are presentation
  attributes, which lose to any CSS rule -- a consumer that wants the
  page's own colour sets `stroke`/`color` in CSS and wins.
- Two files depart from that rule, both because the literal answer is
  invisible: `favicon.svg` takes the skull's white ink (`#ffffff`)
  because its tile is pure black, and `golem-stone.svg` keeps its true
  `#303033`, which reads on a light surface and all but vanishes on the
  site's own black -- recolour it at the call site if it ever gets
  mounted on a dark page.
- Outline only. The one exception is a detail too small to stroke (an
  eye, a rivet, a dish feed): a circle of r <= 1.2 filled with
  `currentColor` and `stroke="none"`.
- 4-9 elements per icon. Anything finer than that is mush at the 20px
  the nav renders at.

`favicon.svg` is the skull, not the site's `.ico`. `printer.svg` and
`bitman.svg` are deliberately identical: so are their PNGs, which are
the same biting sphere on two different background colours, as are
`boss-original` / `boss-green`.

Nothing references these yet — the nav still serves the PNGs through
`_NAV_ICONS` in `api/pages.py`. Swapping one in means an `<img>`/inline
swap there plus a `?v=` bump, per the cache-bust lint.
