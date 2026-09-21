# icons/ — the PNG icon set's own pixels, as SVG

One `.svg` per icon PNG in `web/`, same basename. **Generated, not authored**:
`python3 scripts/trace-icons.py` rebuilds every file in here from the PNGs.
Edit the script, never these — a hand edit is gone on the next run.

Each source is a subject drawn in black linework on a flat coloured tile. That
linework is what gets traced, pixel for pixel. An earlier pass drew lookalikes
by hand instead and they were the wrong shapes wearing the right colours; the
rule now is that no shape in here comes from anywhere but the pixels, and no
step smooths them afterwards.

## The contract

- **It stays pixel art.** One source pixel is one viewBox unit, so the
  viewBox is the source's own grid (`0 0 27 27`, and `0 0 64 64` for the
  downsampled favicon), every coordinate in the path is an integer, and the
  staircases are the point rather than something to sand off.
- `shape-rendering="crispEdges"` on the root. Without it the renderer
  antialiases every pixel edge that misses a device pixel — at the nav's 20px
  that is all of them, since 20/27 is not a whole number — and hard pixel art
  comes out a smudge. `image-rendering:pixelated` is the raster knob and does
  nothing here; this is the vector one.
- A non-square source (`bitman`, 27x26) is centred in a square viewBox, never
  stretched to fill it.
- One `<path>`, `fill-rule="evenodd"`, filled with a flat colour and no
  stroke. Every loop — outer edges and the holes inside them — is in that one
  path, and evenodd subtracts the holes without anyone tracking winding.
- Transparent. No backdrop rect; the tile is dropped, not drawn.
- The fill is the SOURCE PNG's tile colour, sampled from its border ring —
  fiddle's `#0090fc`, watchman's `#ff258a`. The tile was the icon's identity
  and it is the one thing that survives dropping it.
- A tile too close to the site background has its BRIGHTNESS inverted: if its
  HSL lightness is within 25 points of `--bg-hsl`'s (`0 0% 0%`, so: under
  25%), L becomes 100-L with hue and saturation untouched. Measured and fixed
  on the same axis, which is why it is a lightness test and not a contrast
  ratio. It fires on exactly two — `favicon` (`#000000` → `#ffffff`) and
  `golem-stone` (`#303033` → `#cccccf`) — and the rest are nowhere near it,
  the sources being 8-bit palette colours clustered at L 49.4%.

## How the ink is found

The only per-icon decision. In order:

1. **Tile** = the most common colour on the border ring.
2. **Ink** = every pixel within a narrow luminance band of the *darkest*
   non-tile pixel. Not "darker than the tile" — every one of these casts a
   drop shadow, often a 50% checkerboard of a darkened tile hue, and the
   looser test swallows it, fills the subject in solid and turns the dither
   into thousands of one-pixel squares. The band adapts per icon, which is how
   one rule covers pure-black linework, `data-file`'s `#33333b`, `Kuang12`'s
   `#281e0a`, and `golem-stone`, whose black linework sits on a `#303033` tile
   that any absolute threshold would have to keep or drop along with it.
3. **Nothing darker than the tile** means the tile is the dark thing and the
   art is the light shape on it — `favicon`, a white skull on black. Then the
   whole non-tile silhouette is the linework.
4. **`data-file` and `data-doctor` are named exceptions.** They are the two
   flat vector sources, drawn as adjacent blocks of colour with no outline
   anywhere in them, so there is nothing to trace and rule 2 finds the darkest
   *block*: for `data-file` that is the sliver of dark back sheet behind the
   page stack, traced perfectly, reading as a comma. For these the line the
   artist never drew is derived — a pixel is ink where its neighbour is a
   different enough colour — which produces the same 1px outline the pixel-art
   icons carry explicitly. Named and not detected on purpose: every statistic
   that separates these two also misfiles several that were fine
   (`data-file`'s mask is 98% boundary pixels, identical to a real outline),
   and a wrong guess silently mangles a good icon.

## The trace

Marching squares over that mask — every pixel side facing a non-ink neighbour
is a unit edge, and the edges chain into closed loops. Where two regions touch
only at a corner the walk takes the sharpest clockwise turn, which keeps them
two regions instead of welding them into one. Loops enclosing less than a
pixel are dropped as dither speckle.

Runs of collinear pixels are then collapsed, which is exact — dropping a
redundant point in the middle of a straight edge moves nothing. That is the
only reduction applied. An earlier version also ran Chaikin corner-cutting to
round the staircases off; smoothing a pixel grid is the opposite of keeping
it, and it cost 4x the bytes to do it (120KB for the set against 26KB).

Sources over 64px are nearest-downsampled first (only `favicon`, at 261px):
the art is flat colour, and at 20px nothing is lost that the viewBox would
have kept.

## Notes

`favicon.svg` is the skull, not the site's `.ico`. `printer`/`bitman` and
`boss-original`/`boss-green` come out as identical pairs of shapes in
different colours, because that is exactly what their PNGs are. `IMG_25419`
(a photo), `ped-logo` (a wordmark) and the `qr-*` code are skipped — not
icons.

The nav serves these at `/icons/<name>.svg` (`_NAV_ICONS` in `api/pages.py`).
A changed icon needs its `?v=` bumped there in the same commit, per the
cache-bust lint.
