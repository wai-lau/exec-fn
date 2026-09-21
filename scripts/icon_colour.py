"""The FULL-COLOUR trace: every colour region painted as itself.

The other mode in this set (icon_mask.py) traces an icon as LINEWORK -- the
darkest cluster -- and then works to recover whatever the artist drew as flat
colour instead, with an interior pass, a despeckler, per-icon floors and, for
three icons, hand-drawn glyphs. That apparatus exists because at 27px THE
SHADING IS THE SHAPE: a drawn crescent is a white blob, a drawn iris ring is a
diagram of an eye rather than an eye.

This mode skips the reconstruction and paints the shading. The tile is dropped
-- that is what makes the file transparent -- and every other colour is
emitted as its own path in its own colour. The ink is the one exception: it
takes the TILE's colour, which is what gives each icon its rim and carries the
tile's identity after the tile itself is gone.

Most icons read better this way and use it. Six do not, and stay on the
line-art path (LINE_ART in icon_config.py): where a source is heavily dithered
the full-colour trace reproduces the dither faithfully, and faithful is not
always what an icon wants."""
from icon_config import AS_INK, INK_BAND, INNER_INK_KEPT
from icon_mask import colour_groups, ink_colours


def colour_paths(px, w, h, tile, rim, ox, oy, path_for, stem=""):
    """`<path>` strings for one icon, largest region first.

    `path_for` is passed in rather than imported to keep this module free of a
    cycle back to the emitter."""
    groups = colour_groups(px, w, h, tile)
    if not groups:
        return []
    ink = ink_colours(groups, INK_BAND) | set(AS_INK.get(stem, ()))
    # Only the ink colour that actually carries the OUTLINE is split into
    # silhouette-plus-islands. The others are ink by adoption (AS_INK) and are
    # small marks in their own right -- splitting them pits one speck against
    # another and sends the loser back to a colour that is not there.
    main_ink = max(ink, key=lambda c: len(groups[c]), default=None)

    out = []
    for colour, pixels in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        if colour == main_ink and stem in INNER_INK_KEPT:
            outline, islands = split_outline(pixels, px, w, h, tile)
            for part, fill in ((outline, rim), (islands, "#%02x%02x%02x" % colour)):
                d = path_for(part, ox, oy) if part else ""
                if d:
                    out.append(f'<path fill="{fill}" d="{d}"/>')
            continue
        d = path_for(pixels, ox, oy)
        if not d:
            continue
        fill = rim if colour in ink else "#%02x%02x%02x" % colour
        out.append(f'<path fill="{fill}" d="{d}"/>')
    return out


def split_outline(pixels, px, w, h, tile):
    """(outline, interior marks) of an ink set.

    An ink region is INTERIOR when no pixel of it touches the tile or the
    image edge. Eyes sit in the middle of a creature; an outline has the
    background on one side of it by definition. On bug that test picks out
    the two eyes and nothing else, from fourteen ink regions.

    Two rules that look right and are not. SIZE: bug's eyes are 2px each, and
    so are three fragments of its left edge. LARGEST REGION IS THE OUTLINE:
    the dithering breaks that outline into fourteen pieces, so the largest is
    one arc of the shell and every other piece -- edges, feet -- comes out as
    an interior mark. That one was tried, and it painted the whole outline
    black."""
    outline, islands = set(), set()
    for region in connected(pixels):
        if on_background(region, px, w, h, tile):
            outline |= region
        else:
            islands |= region
    return outline, islands


def connected(pixels):
    """The 4-connected regions of a pixel set."""
    seen, regions = set(), []
    for start in pixels:
        if start in seen:
            continue
        region, stack = set(), [start]
        while stack:
            p = stack.pop()
            if p in seen or p not in pixels:
                continue
            seen.add(p)
            region.add(p)
            x, y = p
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        regions.append(region)
    return regions


def on_background(region, px, w, h, tile):
    """True when any pixel of the region touches the tile or the image edge."""
    for (x, y) in region:
        if x == 0 or y == 0 or x == w - 1 or y == h - 1:
            return True
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if (dx or dy) and px[x + dx, y + dy][:3] == tile:
                    return True
    return False
