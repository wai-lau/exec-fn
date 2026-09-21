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
from icon_config import INK_BAND
from icon_mask import colour_groups, ink_colours


def colour_paths(px, w, h, tile, rim, ox, oy, path_for):
    """`<path>` strings for one icon, largest region first.

    `path_for` is passed in rather than imported to keep this module free of a
    cycle back to the emitter."""
    groups = colour_groups(px, w, h, tile)
    if not groups:
        return []
    ink = ink_colours(groups, INK_BAND)

    out = []
    for colour, pixels in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        d = path_for(pixels, ox, oy)
        if not d:
            continue
        fill = rim if colour in ink else "#%02x%02x%02x" % colour
        out.append(f'<path fill="{fill}" d="{d}"/>')
    return out
