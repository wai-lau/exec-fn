"""The per-icon tables: which PNGs to trace, and every by-name exception.

Split out of icon_mask.py at the repo's 500-line cap, and the right seam --
this file is the part that GROWS. The algorithms next door are general; what
changes when an icon does not read is almost always an entry here. Each one
carries the measurement or the failure that put it there, so nothing in here
reads as a magic number.

Used by icon_mask.py (which pixels are the drawing) and trace-icons.py (colour
and emission). web/icons/README.md explains the rules in prose."""

# The icon PNGs: everything in web/ that is a subject on a tile. Excluded by
# name because they are not icons -- a photo, a wordmark, a QR code.
SKIP = {"IMG_25419", "ped-logo"}
# Icons that stay on the LINE-ART path. Everything else is traced in its own
# colours (icon_colour.py), which reads better on most of the set -- but where
# a source is heavily dithered the full-colour trace reproduces the dither
# faithfully, and faithful is not always what an icon wants. These seven were
# each judged by eye against their colour version and kept as they were.
LINE_ART = {"turbo", "bitman", "printer", "wizard", "data-file", "data-doctor",
             "sentinel"}
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
#                (NO_INTERIOR) and an iris ring and a white pupil are drawn.
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
        # Three closed sheets, offset mostly sideways. The back two were open
        # L-shapes at first -- only the part of each that is not hidden --
        # which avoids crossing lines entirely but leaves two of the papers
        # looking torn rather than stacked.
        # Back to front. Each sheet is `solid`, so the one in front cuts it:
        # paper is not see-through, and three whole rectangles drawn over each
        # other is three wireframes, not a stack.
        {"shape": "rect", "at": (11, 11), "w": 14, "h": 18, "solid": True},
        {"shape": "rect", "at": (7, 7), "w": 14, "h": 18, "solid": True},
        {"shape": "rect", "at": (3, 3), "w": 14, "h": 18, "solid": True},
        {"shape": "lines", "at": (6, 8), "len": 8, "count": 4, "gap": 3,
         "last": 5},
    ],
    # The mouth is a 6px band of dark red at row 18 -- the one feature of the
    # face that is neither linework nor big enough to survive the floor that
    # calms the stippled skin, so it is drawn back in at its own position.
    "boss-original": [{"shape": "lines", "at": (10, 18), "len": 6, "count": 1,
                       "gap": 0, "last": 6}],
    "boss-green": [{"shape": "lines", "at": (10, 18), "len": 6, "count": 1,
                    "gap": 0, "last": 6}],
    # A first-aid case, drawn face-on. The source draws it in isometric and
    # paints the cross on one slanted FACE, so the cross is five cells smeared
    # down-left and the case is a lumpy hexagon -- neither reads at icon size,
    # whichever way the pixels are lifted out. Face-on, with a handle and a
    # real cross, it is a first-aid kit at a glance.
    "data-doctor": [
        {"shape": "rect", "at": (3, 9), "w": 21, "h": 15, "round": 2},
        {"shape": "rect", "at": (10, 5), "w": 7, "h": 5, "round": 1},
        {"shape": "plus", "arm": 4, "weight": 3, "fill": "#ff0000",
         "at": (13, 16)},
    ],
    # Two twelve-sided dice. The source draws them as faceted solids whose
    # facets are dithered, so every floor either lost the facets or drew the
    # dither with them; the shape is simple enough to state outright.
    "laser-satellite": [
        # Each die is a hexagonal silhouette, the pentagon of its front face,
        # and the five edges running between them. Silhouette plus front face
        # alone was too bare to be a solid -- those spokes are the other five
        # faces, and without them it reads as a flat badge.
        *[g for at in ((9, 17), (18, 9)) for g in (
            {"shape": "poly", "at": at, "points": [(0, -7), (6, -3), (6, 4), (0, 7), (-6, 4), (-6, -3)]},
            {"shape": "poly", "at": at, "points": [(0, -4), (4, -1), (2, 3), (-2, 3), (-4, -1)]},
            {"shape": "spokes", "at": at, "inner": [(0, -4), (4, -1), (2, 3), (-2, 3), (-4, -1)],
             "outer": [(0, -7), (6, -3), (6, 4), (-6, 4), (-6, -3)]},
        )],
    ],
    # The moon, as a crescent rather than the handful of cells the source
    # spends on it -- at 27px those read as a smudge beside the stars.
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
    # Its two bodies are faceted like dice and the facets ARE the icon; each
    # face is 10-17px and everything under that is dither, so the floor goes
    # between them and the lines that survive are the edges of the solids.
    "laser-satellite": 14,
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
ICON_COLOUR = {
    "turbo": (255, 255, 85),
    "data-doctor": (255, 251, 240),
    # The papers are white in the source, and CV is a resume -- an orange
    # stack of paper is a folder, a white one is a document.
    "data-file": (255, 251, 240),
    # /printer wears 3DP in the nav, and its own tile is the same blue as
    # fiddle's and turbo's. It takes bitman's colour instead -- the same
    # biting sphere it IS, and the only nav slot that was a third blue.
    "printer": (182, 252, 0),
}
# A second path, filled, in its own colour: a feature that is not linework and
# whose COLOUR is its meaning. A medical cross that is not red is a plus sign.
# Icons whose INTERIOR detail is suppressed: the source's inside is dither all
# the way down and the traced boundaries read as scribble rather than as the
# thing. What replaces it is a drawn glyph (ICON_GLYPH in trace-icons.py).
# bitman and printer are the same biting sphere; its inside is nothing but
# dither, and every floor that left the mouth readable also left speckle
# around it. Black linework only.
NO_INTERIOR = {"watchman", "bitman", "printer", "wizard"}
# Colours thrown away before anything else looks at the image. data-file's
# drop shadow is a solid dark slab, not a dither, so no size or luminance rule
# reaches it -- it traced as a fourth sheet behind the stack.
DROP_COLOURS = {
    "data-file": ((51, 51, 59), (71, 61, 53), (137, 130, 119)),
    # The navy the 2.0 readout is filled with, so the digits stand alone.
    "hack2": ((42, 63, 85),),
}
# Icons centred on their INK rather than on the image. Dropping a shadow
# leaves the subject sitting where it sat with the shadow's space still
# reserved around it.
CENTRE_INK = {"data-file"}
# Icons whose OUTLINE is despeckled: a lone ink pixel with fewer than two
# neighbours of any of the eight is dropped. The wizard's brim and its cast shadow are
# dithered in black, so the darkest-cluster pass picks up a dotted fringe that
# no interior rule touches -- the speckle is IN the linework.
DESPECKLE_OUTLINE = {"wizard"}
# Icons drawn ENTIRELY from glyphs, the trace discarded. data-file's three
# sheets overlap in the source, so two of them only ever traced as the sliver
# of themselves that is not hidden -- a stack of papers where two papers have
# no outline of their own. Drawn, each sheet is a whole sheet.
GLYPH_ONLY = {"data-file", "data-doctor", "laser-satellite"}
ICON_ACCENT = {
    # src: a source colour lifted out and painted in `fill` over the trace.
    # strip: also drop the black ring the source drew AROUND those pixels.
    # The moon is TWO colours -- a cream body and a pale blue edge, 16 and 11
    # pixels -- and the same cream makes the stars. Both are taken where the
    # source put them. A drawn crescent was tried instead and it was a white
    # blob: at 27px the shading IS the shape, and one flat colour throws it
    # away.
    "wizard": [{"src": (255, 251, 240), "fill": "#fffbf0"},
               {"src": (166, 202, 240), "fill": "#a6caf0"}],
    # The eyeball in its OWN colours, the way hack2's blade keeps its steel.
    # It was a drawn iris ring and a flat disc before, which is a diagram of
    # an eye rather than the eye: the sclera, the olive iris, its green
    # flecks and the lids are all shading, and shading is what makes the
    # thing read. Every non-tile, non-ink colour is listed -- a cell no
    # accent paints is a HOLE, which is how hack2's blade lost four pixels.
    "watchman": [{"src": c, "fill": "#%02x%02x%02x" % c} for c in (
        (255, 223, 85), (212, 95, 0), (255, 251, 240), (127, 127, 85),
        (255, 223, 170), (255, 127, 85), (255, 159, 170), (127, 63, 0),
        (205, 207, 255), (85, 63, 0), (160, 160, 164), (0, 159, 0),
        (192, 220, 192), (255, 213, 255), (255, 95, 255), (255, 63, 0),
        (255, 0, 0),
    )],
    # The two rank crosses are gold on a red cap, and gold is the whole point
    # of a rank cross. Their source outline is stripped, or the ring renders
    # in the icon's red and boxes each cross in a colour it never had.
    "wardenpp": [{"src": c, "fill": "#ffff55", "strip": True}
                 for c in ((255, 255, 85), (255, 255, 170), (255, 191, 85))],
    # A Swiss army knife: red handle, and the 2.0 readout in white.
    "hack2": [
        *[{"src": c, "fill": "#ff2020"}
          for c in ((255, 0, 0), (170, 0, 0), (127, 0, 0), (255, 16, 85))],
        # The 2.0 as WHITE DIGITS ALONE. `strip` is a REACH, not a flag: the box
        # sits two pixels off the digits once the navy filling it is dropped
        # (below), so a one-pixel strip left its outer edge behind as a
        # bracket around each numeral.
        {"src": (255, 251, 240), "fill": "#ffffff", "strip": 2},
        # The handle's five highlight cells. They are neither ink nor red, so
        # without this they are holes in the red and read as black dots.
        {"src": (255, 213, 255), "fill": "#ffd5ff"},
        # The blade keeps its own steel, which is what tells it from the
        # handle -- in one flat colour a knife is a wedge. Every shade of it
        # has to be listed: a blade cell that no accent paints is not ink
        # either, so it comes out as a HOLE and reads as a black pixel
        # (#aaffff, a 4-cell run at row 8, was exactly that).
        *[{"src": c, "fill": "#%02x%02x%02x" % c}
          for c in ((85, 255, 255), (212, 255, 255), (85, 223, 255),
                    (170, 255, 255))],
    ],
    # What is IN the glassware -- the whole subject of a chemistry icon, and
    # monochrome it was three empty vessels.
    "fiddle": [{"src": c, "fill": "#%02x%02x%02x" % c}
               for c in ((212, 255, 85), (42, 223, 85), (85, 9, 170),
                         (170, 31, 255), (212, 31, 170), (255, 95, 255))],
}
