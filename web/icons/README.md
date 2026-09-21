# icons/ — traced SVG twins of the PNG icon set

One `.svg` per icon PNG in `web/`, same basename. **Generated, not authored**:
`python3 scripts/trace-icons.py` rebuilds every file in here from the PNGs.
Edit the script, never these — a hand edit is gone on the next run.

Each source is a subject drawn in black linework on a flat coloured tile. That
linework is what gets traced. An earlier pass drew lookalikes by hand instead
and they were the wrong shapes wearing the right colours; the rule now is that
no shape in here comes from anywhere but the pixels.

## The contract

- `viewBox="0 0 32 32"` for all of them, the source scaled to fit with one
  unit of padding, so a 27x27 and a 32x32 source land the same size.
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

Staircases are then cut down by a single Chaikin pass, after collapsing runs
of collinear pixels so a long straight edge stays straight instead of being
nibbled into a curve. Chaikin moves no point more than a quarter of a pixel,
so the shape stays the source's. A second pass is visually indistinguishable
at icon sizes and doubles the byte count, so there is one.

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
