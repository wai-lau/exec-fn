#!/usr/bin/env python3
"""Trace web/*.png icon art into web/icons/*.svg.

These icons are 27x27 pixel art drawn as a flat coloured tile with the subject
outlined ON it in black. That black linework IS the icon -- so the SVG beside
each PNG is a TRACE of those pixels, never a redrawing. An earlier pass drew
lookalikes by hand and they were the wrong shapes wearing the right colours.

How the ink is found, which is the only per-icon decision here:

  tile      the flat background, sampled from the border ring (every one of
            these images is a full-bleed square of one colour).
  ink       pixels DARKER than the tile. That is the outline on 21 of 22, and
            it keeps working where the outline is not pure black (data-file,
            Kuang12) or where the tile is itself dark (golem-stone: a #303033
            tile with black linework on it).
  fallback  when nothing is darker than the tile, the tile is black and the
            art is the light thing on it -- favicon, a white skull. Then the
            ink is every non-tile pixel, i.e. the silhouette.

The output is PIXEL ART, not a smoothed curve: marching squares over that
mask, where every pixel side facing a non-ink neighbour is a unit boundary
edge and the edges chain into closed loops. One source pixel is one viewBox
unit, so every coordinate is an integer and the staircases are the point.
Loops go into one path with fill-rule="evenodd", so a hole (the gap inside a
padlock shackle) subtracts without anyone tracking winding, and
shape-rendering="crispEdges" keeps the renderer from feathering the grid back
into a smudge.

Runs of collinear pixels are collapsed, which is exact -- dropping a
redundant point on a straight edge moves nothing. An earlier version also ran
Chaikin corner-cutting over the result; that rounded the grid off and is gone.

Colour: each icon's stroke is its own tile colour, and a tile too close to the
site background (--bg-hsl, 0 0% 0%) has its HSL lightness inverted so it is
not invisible -- hue and saturation untouched. See web/icons/README.md.

Usage:  python3 scripts/trace-icons.py [--out DIR] [name ...]
"""
import argparse
import colorsys
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web"
OUT = ROOT / "web" / "icons"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from icon_contours import boundary_loops, drop_collinear  # noqa: E402
from icon_mask import (  # noqa: E402
    ICON_ACCENT, ICON_COLOUR, MAX_DIM, SKIP, SKIP_PREFIX, ink_mask,
)

BG_L = 0.0      # --bg-hsl lightness, in percent
NEAR_L = 25.0   # a stroke within this many points of it gets L -> 100-L
# No VIEW/PAD: the viewBox is the source's own pixel grid, one pixel per unit.


def stroke_colour(tile):
    """The tile colour, with its brightness inverted if it would vanish into
    the site background. Hue and saturation are left alone."""
    r, g, b = [v / 255 for v in tile]
    h, lightness, s = colorsys.rgb_to_hls(r, g, b)
    if abs(lightness * 100 - BG_L) < NEAR_L:
        lightness = 1.0 - lightness
    rr, gg, bb = colorsys.hls_to_rgb(h, lightness, s)
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in (rr, gg, bb))


def px_of(im):
    return im.load()


def trace(path: Path) -> str | None:
    im = Image.open(path).convert("RGBA")
    if max(im.size) > MAX_DIM:
        # A 261px source traces into a path with thousands of points for a
        # shape that is read at 20px. Nearest-downsample first: the art is
        # flat-colour, so nothing is lost that survives the viewBox anyway.
        k = MAX_DIM / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))),
                       Image.NEAREST)
    w, h = im.size
    mask, tile = ink_mask(im, path.stem)
    if not mask:
        return None
    loops = boundary_loops(mask)
    if not loops:
        return None

    # ONE SOURCE PIXEL = ONE VIEWBOX UNIT. The viewBox is the square that holds
    # the image, so every coordinate in the path is an integer and the art
    # keeps its grid instead of being resampled onto some other one. A
    # non-square source (bitman, 27x26) is centred in that square rather than
    # stretched to fill it.
    side = max(w, h)
    ox = (side - w) // 2
    oy = (side - h) // 2

    d = []
    for loop in loops:
        head, *rest = [(ox + x, oy + y) for x, y in drop_collinear(loop)]
        d.append(f"M{head[0]} {head[1]}"
                 + "".join(f"L{x} {y}" for x, y in rest) + "Z")

    colour = stroke_colour(ICON_COLOUR.get(path.stem, tile))

    # Accent paths are painted AFTER the main one, so they sit on top of it.
    accents = []
    for entry in ICON_ACCENT.get(path.stem, ()):
        src, fill = entry[0], entry[1]
        recentre = len(entry) > 2 and entry[2]
        fill = fill or colour
        region = {(x, y) for y in range(h) for x in range(w)
                  if im.load()[x, y][:3] == src}
        if not region:
            continue
        dx = dy = 0
        if recentre:
            rx = [x for x, _ in region]
            ry = [y for _, y in region]
            mx = [x for x, _ in mask]
            my = [y for _, y in mask]
            dx = round(((min(mx) + max(mx)) - (min(rx) + max(rx))) / 2)
            dy = round(((min(my) + max(my)) - (min(ry) + max(ry))) / 2)
        ad = []
        for loop in boundary_loops(region):
            head, *rest = [(ox + x + dx, oy + y + dy) for x, y in drop_collinear(loop)]
            ad.append(f"M{head[0]} {head[1]}"
                      + "".join(f"L{x} {y}" for x, y in rest) + "Z")
        if ad:
            accents.append(f'<path fill="{fill}" d="{"".join(ad)}"/>')
    # shape-rendering=crispEdges turns antialiasing off for this shape. Without
    # it the renderer feathers every pixel edge that does not land on a device
    # pixel -- which at the nav's 20px is all of them, since 20/27 is not a
    # whole number -- and the result is a blurred smudge rather than pixel art.
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" '
        f'width="32" height="32" fill="{colour}" fill-rule="evenodd" '
        f'shape-rendering="crispEdges" aria-hidden="true">\n'
        f'<path d="{"".join(d)}"/>\n' + ("".join(accents) + "\n" if accents else "")
        + '</svg>\n'
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="icon basenames (default: all)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    wanted = set(args.names)
    written = 0
    for png in sorted(SRC.glob("*.png"), key=lambda p: p.stem.lower()):
        if (png.stem in SKIP or png.stem.startswith(SKIP_PREFIX)
                or (wanted and png.stem not in wanted)):
            continue
        svg = trace(png)
        if svg is None:
            print(f"  skip {png.stem}: no ink found", file=sys.stderr)
            continue
        (out / f"{png.stem}.svg").write_text(svg)
        written += 1
        print(f"  {png.stem:17s} {len(svg):6d} bytes")
    print(f"{written} traced -> {out}")


if __name__ == "__main__":
    main()
