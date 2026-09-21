# icons/ — the PNG icon set's own pixels, as SVG

One `.svg` per icon PNG in `web/`, same basename. **Generated, not authored**:
`python3 scripts/trace-icons.py` rebuilds every file in here from the PNGs.
Edit the script, never these — a hand edit is gone on the next run.

Three modules, split at the repo's 500-line cap: `scripts/icon_mask.py`
decides which pixels are the drawing (and holds every per-icon table),
`scripts/icon_contours.py` turns a pixel mask into closed loops, and
`scripts/trace-icons.py` is colour, SVG emission and the CLI.

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

## Interior detail

The outline pass alone finds only the darkest cluster, so everything an artist
drew as flat colour rather than linework disappeared: the boss's mouth,
data-doctor's cross, watchman's iris, wardenpp's cap badge, golem-stone's
panels, the satellite's dish, the wizard's moon. Those are colour regions
against their neighbours, so the boundaries BETWEEN regions are the missing
lines. Three rules make that usable:

- **Only inside the subject.** The detail pass runs on the pixels the tile
  cannot reach from the image border without crossing the outline. Every one
  of these icons casts a drop shadow, usually a dithered one, and it lies
  outside the linework — so confining the pass keeps it out for free.
- **Colour is quantised first** (`QUANT`, a 64-step per channel). These
  sources SHADE BY DITHERING, and at full depth a stippled iris is never one
  region, so no region clears the size floor and a shape the eye plainly sees
  produces no line at all. `ICON_QUANT` raises the step for one icon: the
  wizard's hat is a checkerboard of two purples that quantise apart at 64,
  leaving two interleaved combs whose shared frontier is every second pixel —
  the hat came out as solid speckle with the moon lost in it. At 128 they are
  one shape.
- **Small regions are MERGED, not dropped.** A region under the floor adopts
  the neighbour it touches most. Dropping them was the first version and it
  left watchman's iris and the wizard's moon as broken dashes, because a line
  was inked only where both sides survived and every removed speck punched a
  hole in the line running past it.

Against the tile the ink always lands on the ART's side, whatever the
luminance says — data-file's pages are near-white on orange, so the tile is
the darker side, and a darker-side rule drew the silhouette onto the
background where a "never ink the tile" guard then deleted it. Between two art
colours the darker side still wins.

`DETAIL_MIN_REGION` holds the per-icon floors, each measured from that icon's
region table rather than guessed: `data-file` 28 (pages are 162/30/30px, its
grey text blocks 26 and under — the floor keeps paper and drops typography),
`watchman` 12, `wizard` 10.

## Colour beyond the tile

Two tables, both short and both deliberate:

- `ICON_COLOUR` — an icon whose SUBJECT is not the colour of its tile.
  `turbo`'s tile is the same blue as fiddle's and printer's, but the icon is a
  lightning bolt and the bolt is yellow; `data-doctor`'s case is white on a
  blue tile.
- `ICON_ACCENT` — a second filled path in its own colour, for a feature whose
  COLOUR IS ITS MEANING. `data-doctor`'s cross is red (a medical cross that
  is not red is a plus sign) and re-centred on the case, since the source
  paints it on an isometric face and lifted flat it just reads as crooked.
  `wardenpp`'s two rank crosses are gold, across the three source shades that
  make them up. `wizard`'s moon and stars are filled in the icon's own colour
  (`None`) — outlining them draws a ring around a 10px crescent and nothing
  at all around a 2px star.

## Drawn, not traced

Five icons carry a `ICON_GLYPH` overlay: a shape rasterised onto the SAME
pixel grid as the trace (so the result is still pixel art), painted over it.
Each is there because the source shape cannot be traced into the thing it
depicts, and each is named:

| icon | glyph | why |
|---|---|---|
| `data-doctor` | red plus | the source paints its cross on an isometric FACE — in the pixels it is five red cells smeared down-left, a cross only to someone who already knows it is one |
| `watchman` | iris ring + green pupil | the eyeball traces as a clean ring, but the iris is dithered green-on-olive and the pupil is two dark cells, so the inside came out as scribble. Its interior pass is off (`NO_INTERIOR`) |
| `boss-original`, `boss-green` | one mouth rule | a 6px band of dark red at row 18 — neither linework nor big enough to survive the floor that calms the stippled skin |
| `data-file` | four text rules | the source writes text as a GRID of little grey blocks, which at icon size is noise; dropped, the page was bare |

`NO_INTERIOR` turns the interior pass off entirely for `watchman` and for
`bitman`/`printer`, the same biting sphere, whose inside is nothing but dither
— every floor that left its mouth readable also left speckle around it. Black
linework only.

`ACCENT_STRIP_OUTLINE` drops the black ring the source drew AROUND an accent:
`wardenpp`'s rank crosses are outlined in the source, and inked with the rest
of the linework that ring renders in the icon's red and boxes each gold cross
in a colour it never had.

**A 27px source's interior detail does not resolve at 20px.** The nav shows
the silhouette; the detail is what the icon has from roughly 40px up. That is
a property of the source, not of the trace.

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
