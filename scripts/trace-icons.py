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
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web"
OUT = ROOT / "web" / "icons"

# The icon PNGs: everything in web/ that is a subject on a tile. Excluded by
# name because they are not icons -- a photo, a wordmark, a QR code.
SKIP = {"IMG_25419", "ped-logo"}
SKIP_PREFIX = ("qr-",)
MAX_DIM = 64      # big sources are nearest-downsampled before tracing
INK_BAND = 0.015  # luminance band above the darkest ink, absolute
MIN_AREA = 1.0    # px^2; smaller loops are dither speckle, not linework
EDGE_DELTA = 40   # RGB distance that counts as a colour boundary
# The two flat-vector sources, which carry no drawn outline to trace. See
# colour_edge_mask() for why this is a list of names and not a measurement.
EDGE_TRACED = {"data-file", "data-doctor"}

BG_L = 0.0      # --bg-hsl lightness, in percent
NEAR_L = 25.0   # a stroke within this many points of it gets L -> 100-L
# No VIEW/PAD: the viewBox is the source's own pixel grid, one pixel per unit.


def relative_luminance(rgb):
    def chan(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def tile_colour(px, w, h):
    """The flat background, as the most common colour on the border ring."""
    ring = [px[x, y][:3] for x in range(w) for y in (0, h - 1)]
    ring += [px[x, y][:3] for y in range(h) for x in (0, w - 1)]
    return Counter(ring).most_common(1)[0][0]


def ink_mask(im, stem=""):
    """{(x, y)} of the pixels that make up the icon's linework.

    The ink is the DARKEST cluster, not merely everything darker than the
    tile. Every one of these icons casts a drop shadow -- often a 50%
    checkerboard of a darkened tile hue -- and a plain "darker than the tile"
    test swallows it, which fills the subject in solid and turns the dither
    into thousands of one-pixel squares. The outline is always the darkest
    thing present, so the mask is everything within a narrow luminance band of
    the darkest non-tile pixel. That band adapts per icon, which is what lets
    one rule cover pure-black linework, data-file's #33333b, Kuang12's #281e0a
    and golem-stone (black linework on a #303033 tile, where an absolute
    threshold would have to choose between keeping the ink and dropping the
    tile)."""
    w, h = im.size
    px = im.load()
    tile = tile_colour(px, w, h)
    tile_lum = relative_luminance(tile)

    others = [(relative_luminance(px[x, y][:3]), (x, y))
              for y in range(h) for x in range(w)
              if px[x, y][3] > 8 and px[x, y][:3] != tile]
    if not others:
        return set(), tile
    floor = min(lum for lum, _ in others)
    if floor >= tile_lum:
        # Nothing darker than the tile: the tile IS the dark thing and the art
        # is the light shape on it (favicon, a white skull on black). Then the
        # whole non-tile silhouette is the linework.
        return {pt for _, pt in others}, tile
    if stem in EDGE_TRACED:
        return colour_edge_mask(px, w, h, tile), tile
    return {pt for lum, pt in others if lum <= floor + INK_BAND}, tile


def colour_edge_mask(px, w, h, tile):
    """A 1px outline DERIVED from where the flat colour regions meet.

    Two of these icons are not pixel art at all -- data-file and data-doctor
    are flat vector icons, drawn as adjacent blocks of colour with no outline
    anywhere in them. There is no linework to trace, so the darkest-cluster
    rule finds whatever the darkest BLOCK happens to be: for data-file that is
    the sliver of the dark back sheet showing behind the page stack, which is
    traced perfectly and reads as a comma.

    So the line the artist never drew is derived instead: a pixel is ink when
    a neighbour is a different enough colour. That is the same 1px outline the
    pixel-art icons carry explicitly, so both kinds come out in one visual
    language. Named, not detected -- every statistic that separates these two
    from the other twenty also misfiles several of them (data-file's mask is
    98% boundary pixels, indistinguishable from a real outline), and a wrong
    heuristic silently mangles an icon that was fine."""
    def rgb(x, y):
        r, g, b, a = px[x, y]
        return tile if a <= 8 else (r, g, b)

    ink = set()
    for y in range(h):
        for x in range(w):
            here = rgb(x, y)
            for nx, ny in ((x + 1, y), (x, y + 1)):
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                there = rgb(nx, ny)
                if sum((a - b) ** 2 for a, b in zip(here, there)) > EDGE_DELTA ** 2:
                    # Ink the darker side, so the outline hugs the art the way
                    # a drawn one would rather than haloing it.
                    dark = (x, y) if relative_luminance(here) <= relative_luminance(there) else (nx, ny)
                    ink.add(dark)
    return ink


def outward_edges(mask):
    """{vertex: [vertex]} -- one directed unit edge per ink pixel side whose
    neighbour is not ink, wound so the ink stays on a consistent hand."""
    edges = defaultdict(list)
    for (x, y) in mask:
        if (x, y - 1) not in mask:
            edges[(x, y)].append((x + 1, y))
        if (x + 1, y) not in mask:
            edges[(x + 1, y)].append((x + 1, y + 1))
        if (x, y + 1) not in mask:
            edges[(x + 1, y + 1)].append((x, y + 1))
        if (x - 1, y) not in mask:
            edges[(x, y + 1)].append((x, y))
    return edges


def _step_from(edges, cur, nxt):
    """The next vertex after `nxt`, consuming the edge taken."""
    outs = edges.get(nxt)
    if not outs:
        return None                  # open chain; drop it rather than guess
    if len(outs) == 1:
        return outs.pop(0)
    # A vertex where two diagonally-touching regions meet. Take the sharpest
    # clockwise turn, which keeps the two regions separate instead of welding
    # them into one.
    dx, dy = nxt[0] - cur[0], nxt[1] - cur[1]

    def turn(p):
        ex, ey = p[0] - nxt[0], p[1] - nxt[1]
        return (dx * ey - dy * ex, dx * ex + dy * ey)

    step = min(outs, key=turn)
    outs.remove(step)
    return step


def boundary_loops(mask):
    """Marching squares: chain the outward unit edges into closed loops."""
    edges = outward_edges(mask)
    loops = []
    for start in list(edges):
        while edges.get(start):
            loop = [start]
            cur, nxt = start, edges[start].pop(0)
            while nxt != start:
                loop.append(nxt)
                step = _step_from(edges, cur, nxt)
                if step is None:
                    break
                cur, nxt = nxt, step
            if len(loop) >= 4 and abs(shoelace(loop)) >= MIN_AREA:
                loops.append(loop)
    return loops


def shoelace(loop):
    """Twice the signed area, halved -- used only to size a loop."""
    total = 0.0
    for i, (ax, ay) in enumerate(loop):
        bx, by = loop[(i + 1) % len(loop)]
        total += ax * by - bx * ay
    return total / 2.0


def drop_collinear(loop):
    out = []
    n = len(loop)
    for i in range(n):
        ax, ay = loop[i - 1]
        bx, by = loop[i]
        cx, cy = loop[(i + 1) % n]
        if (bx - ax) * (cy - by) != (by - ay) * (cx - bx):
            out.append((bx, by))
    return out or loop


def stroke_colour(tile):
    """The tile colour, with its brightness inverted if it would vanish into
    the site background. Hue and saturation are left alone."""
    r, g, b = [v / 255 for v in tile]
    h, lightness, s = colorsys.rgb_to_hls(r, g, b)
    if abs(lightness * 100 - BG_L) < NEAR_L:
        lightness = 1.0 - lightness
    rr, gg, bb = colorsys.hls_to_rgb(h, lightness, s)
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in (rr, gg, bb))


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

    colour = stroke_colour(tile)
    # shape-rendering=crispEdges turns antialiasing off for this shape. Without
    # it the renderer feathers every pixel edge that does not land on a device
    # pixel -- which at the nav's 20px is all of them, since 20/27 is not a
    # whole number -- and the result is a blurred smudge rather than pixel art.
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" '
        f'width="32" height="32" fill="{colour}" fill-rule="evenodd" '
        f'shape-rendering="crispEdges" aria-hidden="true">\n'
        f'<path d="{"".join(d)}"/>\n</svg>\n'
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
