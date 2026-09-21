"""Which pixels of an icon PNG are its linework.

Split out of trace-icons.py, which was over the repo's 500-line cap. This
half answers "what is the drawing"; icon_config.py holds the per-icon tables
it consults, icon_contours.py turns the answer into closed loops, and
trace-icons.py emits the SVG.

Two passes make the mask. The OUTLINE is the darkest colour cluster -- not
everything darker than the tile, because every one of these icons casts a
drop shadow, often a 50% checkerboard, and the loose test swallows it, fills
the subject in solid and turns the dither into thousands of one-pixel
squares. The INTERIOR pass then adds what the artist drew as flat colour
rather than ink (a mouth, an iris, a cap badge, a moon), as the boundaries
between colour regions, confined to the pixels the outline encloses.

Read web/icons/README.md for why each rule here is the rule."""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from icon_config import (  # noqa: E402
    DESPECKLE_OUTLINE, DETAIL_MIN_REGION, DROP_COLOURS, EDGE_DELTA,
    EDGE_TRACED, FILL_ENCLOSED, ICON_ACCENT, ICON_QUANT, INK_BAND, MIN_REGION,
    NO_INTERIOR, QUANT,
)


def relative_luminance(rgb):
    def chan(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def quant(rgb, step=QUANT):
    """A colour rounded to a coarse step, for the detail passes only.

    These sources SHADE by dithering: watchman's iris is olive stippled with
    green, the wizard's hat is three purples checkerboarded together. At full
    colour depth none of that is ever one region, so no region clears the size
    floor and a feature the eye plainly reads -- the iris ring, the hat's dark
    band -- produces no line at all. Rounding the channels first merges each
    stipple back into the one shape the artist was shading, and a boundary
    between two quantised colours is a boundary the eye already sees.

    The outline pass does NOT use this: it wants the exact darkest cluster."""
    return tuple(v // step for v in rgb)


def tile_colour(px, w, h):
    """The flat background, as the most common colour on the border ring."""
    ring = [px[x, y][:3] for x in range(w) for y in (0, h - 1)]
    ring += [px[x, y][:3] for y in range(h) for x in (0, w - 1)]
    return Counter(ring).most_common(1)[0][0]


def colour_groups(px, w, h, tile):
    """{colour: {(x, y)}} for every opaque pixel that is not the tile. The
    full-colour mode's reading of the image (see icon_colour.py)."""
    groups = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= 8 or (r, g, b) == tile:
                continue
            groups.setdefault((r, g, b), set()).add((x, y))
    return groups


def ink_colours(colours, band):
    """The colours making up the linework: the darkest, plus everything within
    `band` luminance of it -- the colour-space twin of ink_mask's rule."""
    if not colours:
        return set()
    floor = min(relative_luminance(c) for c in colours)
    return {c for c in colours if relative_luminance(c) <= floor + band}


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

    dropped = DROP_COLOURS.get(stem, ())
    others = [(relative_luminance(px[x, y][:3]), (x, y))
              for y in range(h) for x in range(w)
              if px[x, y][3] > 8 and px[x, y][:3] != tile
              and px[x, y][:3] not in dropped]
    if not others:
        return set(), tile
    floor = min(lum for lum, _ in others)
    if floor >= tile_lum:
        # Nothing darker than the tile: the tile IS the dark thing and the art
        # is the light shape on it (favicon, a white skull on black). Then the
        # whole non-tile silhouette is the linework.
        return {pt for _, pt in others}, tile
    floor_px = DETAIL_MIN_REGION.get(stem, MIN_REGION)
    step = ICON_QUANT.get(stem, QUANT)
    if stem in EDGE_TRACED:
        return colour_edge_mask(px, w, h, tile, floor_px, step), tile
    outline = {pt for lum, pt in others if lum <= floor + INK_BAND}
    if stem in FILL_ENCLOSED:
        return outline | filled_body(px, outline, w, h, None), tile
    mask = outline
    if stem not in NO_INTERIOR:
        mask = mask | interior_detail(px, w, h, outline, floor_px, step)
    mask -= outline_around_accents(px, w, h, stem)
    if stem in DESPECKLE_OUTLINE:
        # EIGHT neighbours, not four. A diagonal run of pixels -- which is
        # most of a hat brim -- has no orthogonal neighbours at all, so the
        # four-way test called the whole outline speckle and deleted it.
        near = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                if (dx, dy) != (0, 0)]
        mask = {(x, y) for (x, y) in mask
                if sum((x + dx, y + dy) in mask for dx, dy in near) >= 2}
    return mask, tile


def outline_around_accents(px, w, h, stem):
    """Ink pixels touching an accent's own pixels -- the ring the source drew
    around a feature that is about to be redrawn in its own colour."""
    wanted = [(a["src"], int(a["strip"])) for a in ICON_ACCENT.get(stem, ())
              if a.get("strip")]
    if not wanted:
        return set()
    touching, accent = set(), set()
    for src, reach in wanted:
        own = {(x, y) for y in range(h) for x in range(w) if px[x, y][:3] == src}
        accent |= own
        for (x, y) in own:
            for dx in range(-reach, reach + 1):
                for dy in range(-reach, reach + 1):
                    touching.add((x + dx, y + dy))
    return touching - accent


def filled_body(px, outline, w, h, seeds):
    """What the outline encloses -- by REGION, not by pixel.

    `seeds` names the subject's own colours; an enclosed region is kept only
    if it contains one. Filtering pixel by pixel instead punches holes: the
    bolt's shading appears as single cells INSIDE its bright face as well as
    in the band down its side, and dropping every dark cell leaves the bolt
    moth-eaten. The band is its own enclosed region -- ink separates it -- so
    dropping whole regions removes it and leaves the face solid."""
    inside = enclosed_by(outline, w, h)
    if not seeds:
        return inside

    keep, seen = set(), set()
    for start in inside:
        if start in seen:
            continue
        region, stack = set(), [start]
        while stack:
            p = stack.pop()
            if p in seen or p not in inside:
                continue
            seen.add(p)
            region.add(p)
            x, y = p
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        if any(px[p][:3] in seeds for p in region):
            keep |= region
    return keep


def enclosed_by(outline, w, h):
    """{(x, y)} inside the subject -- every non-outline pixel the tile cannot
    reach from the image border without crossing the outline.

    This is what separates the subject's INSIDE from everything the artist
    drew around it. The drop shadow, and the dithered checkerboard it is often
    made of, lie outside the linework and are reachable from the border, so
    confining the detail pass to this set keeps them out for free."""
    outside = set()
    stack = [(x, y) for x in range(w) for y in (0, h - 1)]
    stack += [(x, y) for y in range(h) for x in (0, w - 1)]
    stack = [p for p in stack if p not in outline]
    while stack:
        x, y = stack.pop()
        if (x, y) in outside or (x, y) in outline:
            continue
        if not (0 <= x < w and 0 <= y < h):
            continue
        outside.add((x, y))
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return {(x, y) for y in range(h) for x in range(w)
            if (x, y) not in outside and (x, y) not in outline}


def colour_regions(px, pixels, step=QUANT):
    """Connected same-colour runs within `pixels`, as a list of sets."""
    seen, regions = set(), []
    for start in pixels:
        if start in seen:
            continue
        colour = quant(px[start][:3], step)
        region, stack = set(), [start]
        while stack:
            p = stack.pop()
            if p in seen or p not in pixels or quant(px[p][:3], step) != colour:
                continue
            seen.add(p)
            region.add(p)
            x, y = p
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        regions.append(region)
    return regions


def despeckle(px, pixels, min_region, step=QUANT):
    """{pixel: quantised colour}, with every region under `min_region` merged
    into whichever surviving neighbour it touches most.

    Dropping the small regions outright was the earlier version, and it is
    what left watchman's iris and the wizard's moon as broken dashes: a line
    was only inked where BOTH sides survived, so every speck of stipple the
    filter removed punched a hole in the line running past it. Merging
    instead of dropping keeps the boundary continuous -- a speck becomes part
    of the shape it sits in, which is what it was."""
    regions = colour_regions(px, pixels, step)
    colour = {}
    small = []
    for region in regions:
        if len(region) >= min_region:
            q = quant(px[next(iter(region))][:3], step)
            for pt in region:
                colour[pt] = q
        else:
            small.append(region)

    for region in sorted(small, key=len, reverse=True):
        votes = Counter()
        for (x, y) in region:
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in colour:
                    votes[colour[n]] += 1
        winner = votes.most_common(1)[0][0] if votes else quant(px[next(iter(region))][:3], step)
        for pt in region:
            colour[pt] = winner
    return colour


def interior_detail(px, w, h, outline, min_region=MIN_REGION, step=QUANT):
    """The features drawn INSIDE the subject in a colour other than the ink.

    The outline pass alone finds only the darkest cluster, so everything the
    artist drew as flat colour rather than linework vanishes -- the boss's
    mouth, data-doctor's cross, watchman's iris and pupil, wardenpp's cap
    badge, golem-stone's eyes and panels, the satellite's dish, the wizard's
    moon and stars. Each is a colour region against its neighbour, so the
    boundaries between regions are the missing lines.

    Taken naively that also inks every speck of dithered SHADING inside the
    subject (printer's sphere highlight, bitman's) as a one-pixel square. So
    the regions are built first and the ones under `min_region` pixels are
    dropped before any boundary is taken: a dither speck is 1-2 pixels, a
    drawn feature is not. A boundary counts only between two surviving
    regions whose colours actually differ, and the darker side is inked, so
    the new line sits on the feature rather than haloing it."""
    inside = enclosed_by(outline, w, h)
    if not inside:
        return set()
    colour = despeckle(px, inside, min_region, step)

    ink = set()
    for (x, y), here in colour.items():
        for nxt in ((x + 1, y), (x, y + 1)):
            there = colour.get(nxt)
            if there is None or here == there:
                continue
            a, b = px[x, y][:3], px[nxt][:3]
            if sum((u - v) ** 2 for u, v in zip(a, b)) > EDGE_DELTA ** 2:
                ink.add((x, y) if relative_luminance(a) <= relative_luminance(b) else nxt)
    return ink


def colour_edge_mask(px, w, h, tile, min_region=MIN_REGION, step=QUANT):
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
    heuristic silently mangles an icon that was fine.

    Region-filtered like the interior pass, and for the same reason: every
    boundary is a line, so without a floor data-file's page stack draws each
    of its ~50 little grey text blocks and the icon reads as noise rather than
    as paper. Its floor is raised (DETAIL_MIN_REGION) until only the sheets
    survive. Ink lands on the darker side of each boundary, and never on the
    tile, so the line sits on the art instead of haloing it."""
    everything = {(x, y) for y in range(h) for x in range(w)}
    colour = despeckle(px, everything, min_region, step)

    ink = set()
    for (x, y), here in colour.items():
        for nxt in ((x + 1, y), (x, y + 1)):
            there = colour.get(nxt)
            if there is None or here == there:
                continue
            a, b = px[x, y][:3], px[nxt][:3]
            if sum((u - v) ** 2 for u, v in zip(a, b)) > EDGE_DELTA ** 2:
                ink.add(inked_side((x, y), a, nxt, b, tile))
    return ink


def inked_side(a, a_rgb, b, b_rgb, tile):
    """Which of two neighbouring pixels carries the line between them.

    Against the TILE it is always the art's side, never the tile's. Luminance
    cannot decide that one: data-file's pages are near-white on an orange
    tile, so the tile is the darker side, and a darker-side rule drew the
    silhouette onto the background and then a "never ink the tile" guard
    deleted it -- the page stack lost its outline entirely and the icon came
    out as three bare corner strokes. Between two art colours the darker side
    still wins, so a line sits on the shaded edge of a feature rather than
    haloing it."""
    if a_rgb == tile:
        return b
    if b_rgb == tile:
        return a
    return a if relative_luminance(a_rgb) <= relative_luminance(b_rgb) else b
