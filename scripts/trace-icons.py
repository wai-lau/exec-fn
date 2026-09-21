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
    CENTRE_INK, GLYPH_ONLY, ICON_ACCENT, ICON_COLOUR, ICON_GLYPH, MAX_DIM,
    SKIP, SKIP_PREFIX, ink_mask,
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


def line_pixels(a, b):
    """Bresenham between two grid points, endpoints included."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    out = set()
    while True:
        out.add((x0, y0))
        if (x0, y0) == (x1, y1):
            return out
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def glyph_pixels(spec, mask):
    """The pixel set for a DRAWN glyph, rasterised onto the source's own grid.

    Kept on that grid on purpose: a glyph that is drawn with real geometry and
    then scaled would be the one smooth thing in a set of pixel art."""
    at = spec.get("at", "ink")
    if at == "ink":
        xs = [x for x, _ in mask]
        ys = [y for _, y in mask]
        cx, cy = (min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2
    else:
        cx, cy = at

    return SHAPES[spec["shape"]](spec, cx, cy)


def _poly(spec, cx, cy):
    """A closed outline through explicit points, drawn with Bresenham so every
    segment lands on whole pixels like the rest of the set."""
    pts = [(cx + px, cy + py) for px, py in spec["points"]]
    out = set()
    last = len(pts) if spec.get("closed", True) else len(pts) - 1
    for i in range(last):
        out |= line_pixels(pts[i], pts[(i + 1) % len(pts)])
    return out


def _spokes(spec, cx, cy):
    """Line segments from each inner point out to its matching outer one --
    the edges that run from a solid's front face to its silhouette."""
    out = set()
    for (ix, iy), (ox_, oy_) in zip(spec["inner"], spec["outer"]):
        out |= line_pixels((cx + ix, cy + iy), (cx + ox_, cy + oy_))
    return out


def glyph_solid(spec):
    """The pixels a glyph BLOCKS, when it is marked `solid`.

    Paper is not see-through. Without this the sheets behind the top one draw
    straight across it and the stack reads as three wireframes rather than
    three sheets."""
    if not spec.get("solid"):
        return set()
    x0, y0 = spec["at"]
    return {(x0 + i, y0 + j) for i in range(spec["w"]) for j in range(spec["h"])}


def _rect(spec, cx, cy):
    x0, y0 = spec["at"]
    w, h = spec["w"], spec["h"]
    out = ({(x0 + i, y0) for i in range(w)}
           | {(x0 + i, y0 + h - 1) for i in range(w)}
           | {(x0, y0 + i) for i in range(h)}
           | {(x0 + w - 1, y0 + i) for i in range(h)})
    # `round`: cut each corner back by that Manhattan distance AND bridge the
    # gap it leaves. Cutting alone is not a rounded corner, it is a hole --
    # at r=2 the top edge restarts two pixels in and the side edge two pixels
    # down, with nothing joining them, so the outline reads as broken.
    r = spec.get("round", 0)

    def corners(i, j):
        return ((x0 + i, y0 + j), (x0 + w - 1 - i, y0 + j),
                (x0 + i, y0 + h - 1 - j), (x0 + w - 1 - i, y0 + h - 1 - j))

    for i in range(r):
        for j in range(r - i):
            for pt in corners(i, j):
                out.discard(pt)
    for i in range(1, r):
        out.update(corners(i, r - i))
    return out


def _lines(spec, cx, cy):
    x0, y0 = spec["at"]
    out = set()
    for i in range(spec["count"]):
        width = spec["last"] if i == spec["count"] - 1 else spec["len"]
        out |= {(x0 + dx, y0 + i * spec["gap"]) for dx in range(width)}
    return out


def _lens(spec, cx, cy):
    """An almond, as the overlap of two discs -- the shape an upper and a
    lower lid make between them."""
    a, b = spec["a"], spec["b"]
    r = (a * a + b * b) / (2 * b)
    off = r - b
    body = {(dx, dy) for dx in range(-a, a + 1) for dy in range(-b, b + 1)
            if dx * dx + (dy + off) ** 2 <= r * r
            and dx * dx + (dy - off) ** 2 <= r * r}
    rim = {(dx, dy) for dx, dy in body
           if not all((dx + ex, dy + ey) in body
                      for ex, ey in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    return {(cx + dx, cy + dy) for dx, dy in rim}


def _plus(spec, cx, cy):
    arm, half = spec["arm"], spec["weight"] // 2
    return {(cx + dx, cy + dy)
            for dx in range(-arm, arm + 1) for dy in range(-arm, arm + 1)
            if abs(dx) <= half or abs(dy) <= half}


def _crescent(spec, cx, cy):
    r, off = spec["r"], spec["off"]
    return {(cx + dx, cy + dy)
            for dx in range(-r, r + 1) for dy in range(-r, r + 1)
            if dx * dx + dy * dy <= r * r
            and (dx - off) ** 2 + dy * dy > r * r}


def _round(spec, cx, cy):
    """A disc, or a ring when `weight` is less than the radius."""
    r = spec["r"]
    inner = r - spec.get("weight", r)
    return {(cx + dx, cy + dy)
            for dx in range(-r, r + 1) for dy in range(-r, r + 1)
            if inner ** 2 <= dx * dx + dy * dy <= r * r}


SHAPES = {"poly": _poly, "spokes": _spokes, "rect": _rect, "lines": _lines, "lens": _lens,
          "plus": _plus, "crescent": _crescent, "ring": _round, "disc": _round}


def path_for(pixels, ox, oy):
    """One `d` string for a pixel set, as the same integer-grid loops the
    trace itself emits."""
    out = []
    for loop in boundary_loops(pixels):
        head, *rest = [(ox + x, oy + y) for x, y in drop_collinear(loop)]
        out.append(f"M{head[0]} {head[1]}"
                   + "".join(f"L{x} {y}" for x, y in rest) + "Z")
    return "".join(out)


def overlay_paths(stem, im, w, h, mask, ox, oy, colour):
    """The paths painted OVER the trace: accents lifted out of the source by
    colour, and glyphs drawn from scratch. Both sit on top of the main path,
    so a feature keeps its own colour instead of the icon's."""
    out = []
    for entry in ICON_ACCENT.get(stem, ()):
        src = entry["src"]
        fill = entry.get("fill") or colour
        recentre = entry.get("recentre", False)
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
        ad = path_for({(x + dx, y + dy) for x, y in region}, ox, oy)
        if ad:
            out.append(f'<path fill="{fill}" d="{ad}"/>')

    specs = list(ICON_GLYPH.get(stem, ()))
    # A glyph is hidden by every SOLID glyph listed after it, so the list runs
    # back to front and a sheet in front cuts the one behind it.
    for i, spec in enumerate(specs):
        hidden = set()
        for later in specs[i + 1:]:
            hidden |= glyph_solid(later)
        gd = path_for(glyph_pixels(spec, mask) - hidden, ox, oy)
        if gd:
            out.append(f'<path fill="{spec.get("fill") or colour}" d="{gd}"/>')
    return out

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
    glyph_only = path.stem in GLYPH_ONLY
    loops = [] if glyph_only else boundary_loops(mask)
    if not loops and not glyph_only:
        return None

    # ONE SOURCE PIXEL = ONE VIEWBOX UNIT. The viewBox is the square that holds
    # the image, so every coordinate in the path is an integer and the art
    # keeps its grid instead of being resampled onto some other one. A
    # non-square source (bitman, 27x26) is centred in that square rather than
    # stretched to fill it.
    side = max(w, h)
    ox = (side - w) // 2
    oy = (side - h) // 2
    if path.stem in CENTRE_INK and not glyph_only:
        # Centre the DRAWING, not the image. Dropping a shadow otherwise
        # leaves the subject where it sat with the shadow's space still
        # reserved beside it.
        xs = [x for x, _ in mask]
        ys = [y for _, y in mask]
        ox += (side - (min(xs) + max(xs) + 1)) // 2
        oy += (side - (min(ys) + max(ys) + 1)) // 2

    d = []
    for loop in loops:
        head, *rest = [(ox + x, oy + y) for x, y in drop_collinear(loop)]
        d.append(f"M{head[0]} {head[1]}"
                 + "".join(f"L{x} {y}" for x, y in rest) + "Z")

    colour = stroke_colour(ICON_COLOUR.get(path.stem, tile))

    accents = overlay_paths(path.stem, im, w, h, mask, ox, oy, colour)
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
