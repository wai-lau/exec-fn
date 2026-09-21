# icons/ — outline SVG twins of the PNG icon set

One `.svg` per icon PNG in `web/`, same basename. These are line-art
redraws, not traces: the sources are 27x27 pixel art whose shapes vanish
at any size, so each icon was re-drawn as the same subject in one shared
stroke style.

The style contract, which every file in here follows:

- `viewBox="0 0 32 32"`, art kept inside x/y 3..29.
- `fill="none"`, `stroke="currentColor"`, `stroke-width="1.8"`,
  round caps and joins. The colour comes from the CSS `color` of
  whatever mounts it, so one file works on every page's palette.
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
