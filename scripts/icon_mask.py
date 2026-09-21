"""Which pixels of an icon PNG are its linework.

Split out of trace-icons.py, which was over the repo's 500-line cap. This
half answers "what is the drawing"; icon_contours.py turns the answer into
closed loops and trace-icons.py emits the SVG.

Two passes make the mask. The OUTLINE is the darkest colour cluster -- not
everything darker than the tile, because every one of these icons casts a
drop shadow, often a 50% checkerboard, and the loose test swallows it, fills
the subject in solid and turns the dither into thousands of one-pixel
squares. The INTERIOR pass then adds what the artist drew as flat colour
rather than ink (a mouth, an iris, a cap badge, a moon), as the boundaries
between colour regions, confined to the pixels the outline encloses.

Read web/icons/README.md for why each rule here is the rule."""
from collections import Counter

# The icon PNGs: everything in web/ that is a subject on a tile. Excluded by
# name because they are not icons -- a photo, a wordmark, a QR code.
SKIP = {"IMG_25419", "ped-logo"}
SKIP_PREFIX = ("qr-",)
MAX_DIM = 64      # big sources are nearest-downsampled before tracing
INK_BAND = 0.015  # luminance band above the darkest ink, absolute
MIN_AREA = 1.0    # px^2; smaller loops are dither speckle, not linework
EDGE_DELTA = 40   # RGB distance that counts as a colour boundary
MIN_REGION = 3    # px; a smaller interior colour run is dither, not a feature
QUANT = 64        # channel step the detail passes see colours at -- see quant()
# Per-icon override of that step. The wizard's hat is a CHECKERBOARD of two
# purples, #7f3fff and #2a01aa. At 64 they quantise apart, so the two combs
# stay two interleaved regions and the frontier between them is every second
# pixel -- the hat came out as solid speckle with the moon lost inside it. At
# 128 they land in one bucket and the hat is one shape again, while the moon
# (#fffbf0) still separates.
ICON_QUANT = {"wizard": 128}
# DRAWN, not traced -- the only two, and both because the source shape cannot
# be traced into the thing it depicts:
#
#   data-doctor  its red cross is painted on an isometric FACE. In the pixels
#                it is five red cells smeared down-left, a cross only to
#                someone who already knows it is one; traced flat it reads as
#                a bent smear wherever it is put.
#   watchman     the eyeball traces as a clean ring, but the iris is dithered
#                green-on-olive and the pupil is a couple of dark cells, so
#                the inside came out as scribble. Its interior pass is off
#                (NO_INTERIOR) and an iris ring and a green pupil are drawn.
#
# Each glyph rasterises onto the SAME pixel grid as the trace, so the result
# is still pixel art. `at` is either "ink" (centre of the traced mask's
# bounding box) or an explicit source-pixel coordinate.
ICON_GLYPH = {
    # The source writes its text as a GRID of little grey blocks, which at
    # icon size is noise rather than text -- dropping them (DETAIL_MIN_REGION)
    # left three bare sheets. A few horizontal rules inside the front page
    # (its box is x 5..18, y 4..21) say "document" the way the blocks meant to.
    "data-file": [
        {"shape": "lines", "at": (8, 8), "len": 8, "count": 4, "gap": 3,
         "last": 5},
    ],
    "data-doctor": [
        {"shape": "plus", "arm": 5, "weight": 3, "fill": "#ff0000", "at": "ink"},
    ],
    # The mouth is a 6px band of dark red at row 18 -- the one feature of the
    # face that is neither linework nor big enough to survive the floor that
    # calms the stippled skin, so it is drawn back in at its own position.
    "boss-original": [{"shape": "lines", "at": (10, 18), "len": 6, "count": 1,
                       "gap": 0, "last": 6}],
    "boss-green": [{"shape": "lines", "at": (10, 18), "len": 6, "count": 1,
                    "gap": 0, "last": 6}],
    "watchman": [
        {"shape": "ring", "r": 6, "weight": 1, "at": (12, 12)},
        {"shape": "disc", "r": 3, "fill": "#2ade5a", "at": (12, 12)},
    ],
}
# The one source with no drawn outline anywhere in it to trace. See
# colour_edge_mask() for why this is a name and not a measurement.
# (data-doctor was here too until the interior pass existed -- it DOES carry a
# black outline, and once the interior detail was being found as well, the
# ordinary path drew both its case and its cross.)
EDGE_TRACED = {"data-file"}
# Per-icon region floor for the detail passes. data-file's page stack is drawn
# with rows of little grey text blocks; at the default every one of them is a
# feature and the icon reads as noise, so its floor is raised until only the
# sheets themselves survive.
DETAIL_MIN_REGION = {
    # Pages are 162/30/30px and the back sheets 58/38px; the grey text blocks
    # are 26px and under, so this floor keeps paper and drops typography.
    "data-file": 28,
    # The eye's interior is dithered green-on-olive: at the default floor it
    # came out as a circle full of speckle, and at 8 only two marks survived.
    # 5 leaves the sclera, the iris and the pupil.
    "watchman": 12,
    # The two boss portraits are stippled skin; at the default floor every
    # speck was a line and the face read as scribble.
    "boss-green": 22,
    "boss-original": 22,
    # The hat is dithered all over, and at the default every speck of it was a
    # line -- which buried the moon this icon is actually known by. Its
    # interior regions are 94 / 27 / 10 px and then nothing above 3, so 10
    # keeps the hat, its dark band and the moon, and drops the noise.
    "wizard": 10,
}
# An icon whose SUBJECT is not the colour of its tile. turbo's tile is the same
# blue as fiddle's and printer's, but the icon is a lightning bolt and the bolt
# is yellow; data-doctor's case is white on a blue tile. Both wear the
# subject's colour, not the backdrop's.
ICON_COLOUR = {"turbo": (255, 255, 85), "data-doctor": (255, 251, 240)}
# A second path, filled, in its own colour: a feature that is not linework and
# whose COLOUR is its meaning. A medical cross that is not red is a plus sign.
# Icons whose INTERIOR detail is suppressed: the source's inside is dither all
# the way down and the traced boundaries read as scribble rather than as the
# thing. What replaces it is a drawn glyph (ICON_GLYPH in trace-icons.py).
# bitman and printer are the same biting sphere; its inside is nothing but
# dither, and every floor that left the mouth readable also left speckle
# around it. Black linework only.
NO_INTERIOR = {"watchman", "bitman", "printer"}
# Icons where the black outline AROUND an accent is dropped from the main
# mask. wardenpp's rank crosses are ringed in black in the source; inked with
# the rest of the linework that ring renders in the icon's red and boxes each
# gold cross in a colour it never had.
ACCENT_STRIP_OUTLINE = {"wardenpp"}
ICON_ACCENT = {
    # The moon and the stars, filled WHITE -- outlining them draws a ring
    # around a 10px crescent and nothing at all around a 2px star, and in the
    # hat's own muted purple a white moon stops being a white moon.
    "wizard": [((255, 251, 240), "#ffffff")],
    # The two rank crosses are gold on a red cap, and gold is the whole point
    # of a rank cross -- rendered in the tile's red they were just two more
    # shapes. Three source shades make up each one.
    "wardenpp": [((255, 255, 85), "#ffff55"),
                 ((255, 255, 170), "#ffff55"),
                 ((255, 191, 85), "#ffff55")],
}


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
    floor_px = DETAIL_MIN_REGION.get(stem, MIN_REGION)
    step = ICON_QUANT.get(stem, QUANT)
    if stem in EDGE_TRACED:
        return colour_edge_mask(px, w, h, tile, floor_px, step), tile
    outline = {pt for lum, pt in others if lum <= floor + INK_BAND}
    mask = outline
    if stem not in NO_INTERIOR:
        mask = mask | interior_detail(px, w, h, outline, floor_px, step)
    if stem in ACCENT_STRIP_OUTLINE:
        mask -= outline_around_accents(px, w, h, stem)
    return mask, tile


def outline_around_accents(px, w, h, stem):
    """Ink pixels touching an accent's own pixels -- the ring the source drew
    around a feature that is about to be redrawn in its own colour."""
    accent = {(x, y) for y in range(h) for x in range(w)
              if any(px[x, y][:3] == src for src, *_ in ICON_ACCENT.get(stem, ()))}
    touching = set()
    for (x, y) in accent:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                touching.add((x + dx, y + dy))
    return touching - accent


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
