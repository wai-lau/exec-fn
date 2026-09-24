# /graph — NODE GEOMETRY: what shape a node is, how big it is, and whether it is
# solid. Split out of graph_style.py at the 500-line cap, at the seam where "how a
# node is FORMED" stops and "what colour it is" begins — graph_style.py keeps the
# communities and their palette, the labels, the edges and the stats header.
#
# The three belong together because the third READS the second. Occlusion is a
# PERCENTILE OF THE REAL SIZES, so it has to be computed where the size rule lives
# or the two are free to drift — and a drifted pair is a node that occludes on one
# layer and not another, which reads as a rendering bug rather than as a rule.
# That is the argument for this file existing, rather than for three passes
# sitting wherever they happened to land.
#
# Every pass here is a string edit on graphify's emitted RAW_NODES, applied at
# SERVE time — never an edit to the generated artifact, which the next nightly
# rebuild would overwrite.
from graph_scrub import _sub_json_array


_TYPE_SHAPES = {
    "code": "triangle",
    "rationale": "hexagon",
    "document": "triangleDown",
}


def _shape_graph_nodes_by_type(page: str) -> str:
    """Give every node a `shape` from its file_type, and make vis carry it.

    The global `nodes: { shape: ... }` above is the default for anything this
    misses. It tracks the majority type (so an unknown type draws like `code`,
    which is what it did when both were hexagons) rather than vanishing."""
    def _shape(nodes):
        for n in nodes:
            shape = _TYPE_SHAPES.get(n.get("file_type"))
            if shape:
                n["shape"] = shape
        return nodes

    page = _sub_json_array(page, "RAW_NODES", _shape)
    # Same explicit-field trap as the baked x/y: graphify's DataSet mapper lists
    # what it carries, so a `shape` on RAW_NODES is dropped on the way in unless
    # it is named here too.
    return page.replace(
        "  id: n.id, label: n.label, color: n.color, size: n.size,",
        "  id: n.id, label: n.label, color: n.color, size: n.size, shape: n.shape,",
        1,
    )


# vis-network node size range: 6..44 until 2026-09-21, doubled to 12..88 because
# at the opening whole-graph fit the hexagons were specks, and a node you cannot
# see is a node nobody will hover. BOTH ends move together, and that is a rule
# rather than a coincidence: the RATIO is what carries the meaning (size is
# geometric in degree, so a hub reads as a hub), and scaling both ends keeps the
# encoding while changing only how much of the screen it spends.
#
# Tried at x1.25 (15..110) on 2026-09-22 and reverted the same day: too big. At
# 110 the largest hubs measured 220 across against a 168 lattice step, so they
# sat over their neighbours rather than in a cell of their own — which is the
# ceiling this range has to respect while the lattice keeps getting coarser.
_SIZE_MIN = 12.0
_SIZE_MAX = 88.0
# Size grows GEOMETRICALLY with degree — each extra edge multiplies rather than
# adds — so a hub reads as a hub instead of as a slightly larger leaf. The old
# sqrt-of-line-count scale did the opposite: it compressed the interesting end
# flat. 1.14 is picked against this graph's own distribution (median degree 1,
# p90 5, p99 21, max 171): it spends the whole range on degrees 1-17, which
# is where 97% of the nodes are, and saturates the long tail at the cap.
_SIZE_GROWTH = 1.14


def _size_graph_by_degree(page: str) -> str:
    """Rescale RAW_NODES so node size is exponential in the node's edge count,
    capped at `_SIZE_MAX`. Reads the `degree` field, which
    `_drop_graph_inferred_edges` has already recomputed against the surviving
    edges — so this must run after the drops or hubs would be sized off edges the
    page no longer draws. No-op if RAW_NODES is absent."""
    def _resize(nodes):
        for n in nodes:
            d = max(int(n.get("degree") or 0), 1)
            n["size"] = round(
                min(_SIZE_MAX, _SIZE_MIN * _SIZE_GROWTH ** (d - 1)), 1
            )
        return nodes

    return _sub_json_array(page, "RAW_NODES", _resize)


# ONLY THE BIG NODES OCCLUDE THEIR EDGES. An opaque interior is what makes an edge
# stop AT a node rather than cross over it, and every node had one — including the
# degree-1 leaves, which are 76% of this graph and sit at the size floor. At the
# opening zoom those are specks, so what the rule bought them was a notch cut out
# of the single edge running in: the structure between nodes read as broken rather
# than as arriving somewhere.
#
# THE THRESHOLD IS A PERCENTILE OF THE ACTUAL SIZES, not a fraction of the size
# RANGE. It was `_SIZE_MAX / 2` for one commit and that is the wrong denominator:
# sizes are GEOMETRIC in degree, so the range's midpoint sits far out in a very
# thin tail — it caught 82 nodes of 2867, 2.9%, where the intent was "the big
# ones". A percentile is a statement about this graph's own distribution and it
# stays true as the repo grows, where any fixed size becomes wrong the moment the
# degree distribution shifts under it.
#
# It went to 0.80 briefly on 2026-09-24 and back to 0.90 the same day. The move was
# a DIAGNOSTIC, not a tuning: the centre of every big node had gone bright and
# widening the solid set was a way to see whether the threshold was at fault. It
# was not — the cause was `setBg` accepting the string "transparent" and turning
# the whole occlusion pass into a no-op (ARCHAEOLOGY.md §11). Worth recording
# because the measurement it produced is still useful: because sizes are GEOMETRIC,
# a tenth of a step down the distribution is a small step down in SIZE, so 0.90 ->
# 0.80 moved the cut only 20.3 -> 15.6 while more than doubling the solid set,
# 261 -> 573 nodes.
_OCCLUDE_PCTL = 0.90

# AND A SECOND, HIGHER CUT FOR THE WAVEFRONT. The two started as one number and
# are kept apart on purpose even while they hold the SAME VALUE, because they
# answer different questions about the same distribution: being solid is "big
# enough that an edge should stop here", where throwing a front is an EVENT, and at
# 300x one of them fills the screen. They have already been moved independently
# once and will be again, so collapsing them into one constant would only have to
# be undone.
#
# Both are shipped to the client (`GRAPH_OCCLUDE_MIN`, `GRAPH_WAVE_MIN`) rather
# than re-derived there, for the reason either one alone would be: a percentile
# recomputed in JS is a second chance to disagree about the node sitting exactly on
# a boundary.
_WAVE_PCTL = 0.90


def _pctl(ordered, pctl: float) -> float:
    """The `pctl` percentile of an ALREADY-SORTED list, nearest-rank — a node
    qualifies when it is LARGER than this, so the value returned is the last one
    excluded.

    Nearest-rank rather than interpolated on purpose: an interpolated percentile
    invents a size no node has, and these numbers are shipped to the client and
    compared against real sizes on three more layers. A value from the actual set
    cannot land between two nodes differently in Python and in JS."""
    if not ordered:
        return 0.0
    return ordered[min(int(len(ordered) * pctl), len(ordered) - 1)]


# vis hands `color.background` straight to a canvas `fillStyle`# vis hands `color.background` straight to a canvas `fillStyle`, so the CSS keyword
# is enough and fills nothing under `source-over`. Deliberately not an `rgba()`
# string with a zero alpha: the palette lint reads source text with the whitespace
# stripped and any colour-function name followed by a paren reports as a new raw
# colour, comment or code.
_NO_FILL = "transparent"


def _unocclude_small_nodes(page: str):
    """Clear the opaque interior on every node at or under the size percentile, so
    the edges behind it show through instead of stopping at it. Returns
    `(page, threshold)` — the caller ships the threshold to the client, because the
    overlay has to gate on the SAME number and a second implementation of
    "percentile of the sizes" is a second chance to disagree about the node sitting
    exactly on it.

    MUST RUN AFTER `_size_graph_by_degree`: the decision reads `size`, and the
    colour objects are built back in `_merge_graph_communities`, which runs before
    sizes exist. Reading `degree` here instead would duplicate the size formula and
    let the two drift. Only the three `background` keys are touched — `hover.border`
    carries the full-strength community colour that graph-pulse.js reads for its
    saturated ink, and clearing that would take the afterglow's colour with it. No-op
    if RAW_NODES is absent."""
    found = {"occlude": 0.0, "wave": 0.0}

    def _clear(nodes):
        ordered = sorted(float(node.get("size") or 0) for node in nodes)
        thr = _pctl(ordered, _OCCLUDE_PCTL)
        found["occlude"] = thr
        found["wave"] = _pctl(ordered, _WAVE_PCTL)
        for node in nodes:
            if float(node.get("size") or 0) > thr:
                continue
            colour = node.get("color")
            if not isinstance(colour, dict):
                continue
            colour["background"] = _NO_FILL
            for state in ("highlight", "hover"):
                sub = colour.get(state)
                if isinstance(sub, dict):
                    sub["background"] = _NO_FILL
        return nodes

    return _sub_json_array(page, "RAW_NODES", _clear), found
