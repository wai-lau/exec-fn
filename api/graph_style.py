"""Presentation transforms for graphify's /graph page.

Same serve-time, survives-a-rebuild contract as graph_scrub (which holds the
privacy scrubs + node/edge drops); this half is purely how the surviving graph
LOOKS: community regrouping + colours, hexagon restyle, hover-tooltip removal,
degree-driven node sizes, labels + node font, the one-shot physics tune, and
the header count fixup. Split out of graph_scrub.py to keep both under the
500-line cap.

Anything that can be decided once per ARTIFACT belongs here rather than in
graph-overlay.js. The overlay used to walk all ~4.7k nodes three times at load
(set every font, redact every long label, hide every orphan) and each walk cost a
whole-DataSet update plus the canvas redraw it triggers -- on the page's slowest
few seconds. The same decisions made here ride in the bytes, which are memoised
per artifact by routes_graph, so they cost nothing at all on a warm load.
"""
import re
from collections import Counter

from graph_scrub import _read_array, _sub_json_array

# vis renders a node/edge's `title` as a hover tooltip (graphify puts the whole
# docstring-derived summary there). Drop the field where the DataSets are built,
# so nothing pops up on hover; the same text still reaches the click-through
# node-info panel, which reads RAW_NODES directly.
_TOOLTIP_FIELD_RE = re.compile(r"\s*title:\s*[A-Za-z_$][\w$]*\.title,")


def _drop_graph_tooltips(page: str) -> str:
    """Strip `title:` from the node + edge DataSet mappers — no hover tooltips.
    Unquoted `title: x.title,` only appears in those two mappers (RAW_NODES/
    RAW_EDGES carry it JSON-quoted), so a blanket sub is safe. String tweak on
    graphify's emitted JS, so it survives a /graphify rebuild."""
    return _TOOLTIP_FIELD_RE.sub("", page)


# A node's shape says what KIND of thing it is, the way its colour says which
# community it belongs to. Three types survive the scrubs, so three shapes.
#
# All three come from the same vis family, and that constraint is why `circle`
# never appears here. vis splits its shapes in two: `circle`, `ellipse`, `box`
# and `text` draw the label INSIDE and size themselves to it, ignoring `size`
# entirely; `dot`, `hexagon`, `triangle`, `triangleDown`, `diamond`, `square` and
# `star` draw the label outside and take their size from `size`. Node size here
# is geometric in degree (_size_graph_by_degree), which is the graph's main
# encoding, so a shape from the first family would discard it for every node of
# that type and relocate its label in the same move. Documents were briefly
# `dot`; `triangleDown` pairs them against the rationale triangle instead, which
# reads as a related pair rather than three unrelated glyphs.
_TYPE_SHAPES = {
    "code": "hexagon",
    "rationale": "triangle",
    "document": "triangleDown",
}


def _shape_graph_nodes_by_type(page: str) -> str:
    """Give every node a `shape` from its file_type, and make vis carry it.

    The global `nodes: { shape: ... }` above is the default for anything this
    misses, so an unknown type stays a hexagon rather than vanishing."""
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


def _restyle_graph_nodes(page: str) -> str:
    """Render nodes as hexagons (matching /emet) instead of vis's default dots,
    and bump the border so the bg-filled outline reads. Also repoint the node-info
    neighbour stripe from .color.background (now the page bg, invisible) to
    .color.border (the community colour). String tweaks on graphify's emitted JS,
    so they survive a /graphify rebuild."""
    page = page.replace(
        "nodes: { shape: 'dot', borderWidth: 1.5 }",
        "nodes: { shape: 'hexagon', borderWidth: 2 }",
        1,
    )
    page = _shape_graph_nodes_by_type(page)
    # showInfo() colours each neighbour link's left stripe from the neighbour's
    # fill; with bg-filled nodes that stripe vanishes, so use the border colour.
    page = page.replace("nb.color.background", "nb.color.border", 1)
    return page


# Short tokens that read better fully uppercased in a derived community name
# (acronyms / domain terms) than title-cased ("Routes Api" -> "Routes API").
_NAME_ACRONYMS = {
    "api", "css", "js", "html", "llm", "mtg", "gcal", "sse", "ui", "id",
    "json", "cv", "rd", "hq", "ics", "oauth", "svg", "etag", "ip", "ts",
    "tsx", "md", "sh", "url", "sql", "http", "dag", "tts",
}


# Distinct, high-contrast node colors for the merged communities (Tableau-20 +
# ColorBrewer Dark2 = 28 hues) so each logical module gets its OWN color. These
# are vis-network DATA colors baked into the graph JSON, NOT the chrome.css UI
# palette, so the palette lint never sees them. Biggest community = index 0;
# cycles only if a graph ever yields more communities than colors.
_COMMUNITY_COLORS = [
    "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948",
    "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC", "#A0CBE8", "#FFBE7D",
    "#8CD17D", "#86BCB6", "#F1CE63", "#D7B5A6", "#FABFD2", "#D4A6C8",
    "#D37295", "#499894", "#1B9E77", "#D95F02", "#7570B3", "#E7298A",
    "#66A61E", "#E6AB02", "#A6761D", "#666666",
]
# A logical module/feature with fewer than this many nodes folds into its
# top-level dir bucket, so the legend isn't littered with 2-node modules.
_MIN_COMMUNITY = 10
# Hard ceiling on how many communities the page ever renders. The min-size fold
# alone does not bound the count -- this repo yields 54 buckets at _MIN_COMMUNITY
# and raising that threshold plateaus around 20, because the long tail is made of
# whole top-level dirs, not small modules. So the count is CAPPED rather than
# tuned: colour is only a legible encoding while a reader can hold the legend in
# their head, and 28 palette entries past that point is 28 shades of noise.
_MAX_COMMUNITIES = 14


def _node_group_key(src) -> str:
    """Merge bucket for a node: its top-level source directory. Repo-root files
    (and sourceless synthetic nodes) bucket together as "(root)"."""
    parts = str(src or "").split("/")
    return parts[0] if len(parts) > 1 and parts[0] else "(root)"


def _logical_key(src) -> str:
    """The logical module/feature a node belongs to — its community. A subdir
    module (api/tarot/*, api/mtg/* -> "tarot"/"mtg") or a flat file's family
    (web/tarot-view.js, api/nudge_loop.py -> "tarot"/"nudge"), so a FEATURE groups
    across layers: api/tarot/* and web/tarot-*.js both land in "Tarot". Root /
    sourceless nodes -> "(root)"."""
    parts = str(src or "").split("/")
    if len(parts) >= 3:
        return parts[1]  # subdir module name
    if len(parts) == 2:
        return re.split(r"[-_]", parts[1].rsplit(".", 1)[0])[0]  # filename family
    return "(root)"


def _friendly_dir(key: str) -> str:
    """Readable community label from a directory key: strip a leading dot,
    title-case each word (acronyms fully upper). "(root)" -> "Root"."""
    if key.startswith("(") and key.endswith(")"):
        return key.strip("()").capitalize()
    words = [
        w.upper() if w.lower() in _NAME_ACRONYMS else w.capitalize()
        for w in re.split(r"[_\-.]+", key.lstrip("."))
        if w
    ]
    return " ".join(words) or key


# graph.html body bg. Node interiors fill with this so the community colour reads
# as the hexagon OUTLINE only (the /emet look: bg-filled node, coloured border).
_GRAPH_BG = "#0f0f1a"


def _node_color(hex_color: str) -> dict:
    """vis-network per-node color object in graphify's shape — bg-filled interior
    + the community colour as the border (matches /emet). On select the border
    flashes white; bg never changes, so the hexagon stays a clean outline."""
    return {
        "background": _GRAPH_BG,
        "border": hex_color,
        "highlight": {"background": _GRAPH_BG, "border": "#ffffff"},
        "hover": {"background": _GRAPH_BG, "border": hex_color},
    }


def _ranked(counts, n: int):
    """The `n` biggest keys of a Counter, ties broken by name. Deterministic on
    purpose: the rendered page is content-hash ETagged and memoised, so a tie
    resolved by dict order would change the bytes across a restart for no
    reason."""
    ordered = sorted(counts.items(), key=lambda kc: (-kc[1], str(kc[0])))
    return {k for k, _ in ordered[:n]}


def _cap_communities(nodes, key_of, max_communities: int):
    """Wrap `key_of` so it yields at most `max_communities` distinct keys. Two
    folds, biggest-first, each applied only if the one before left too many: the
    tail collapses into its top-level source dir, then whatever is still over the
    cap collapses into a single "(other)" bucket. Returns `key_of` unchanged when
    it is already inside the cap."""
    counts = Counter(key_of(n) for n in nodes)
    if len(counts) <= max_communities:
        return key_of
    keep = _ranked(counts, max_communities)

    def dir_folded(n):
        k = key_of(n)
        return k if k in keep else _node_group_key(n.get("source_file"))

    counts = Counter(dir_folded(n) for n in nodes)
    if len(counts) <= max_communities:
        return dir_folded
    keep_dirs = _ranked(counts, max_communities - 1)

    def other_folded(n):
        k = dir_folded(n)
        return k if k in keep_dirs else "(other)"

    return other_folded


def _merge_graph_communities(page: str, min_size: int = _MIN_COMMUNITY,
                             max_communities: int = _MAX_COMMUNITIES) -> str:
    """Regroup nodes into logically-named, feature-based communities for the
    /graph page only, so color encodes real structure. graphify emits dozens of
    fine-grained communities but vis cycles a 10-color palette -> colors collide
    -> the clusters read as indistinguishable noise. Group by logical
    module/feature (`_logical_key`: api/tarot/* + web/tarot-*.js -> "Tarot",
    api/nudge*.py -> "Nudge", ...); a feature smaller than `min_size` folds into
    its top-level dir bucket ("API"/"Web") so the legend isn't littered with
    2-node modules, and `_cap_communities` then holds the total to
    `max_communities` so the legend stays readable. Reassigns each node's
    community/community_name/color and rebuilds LEGEND, biggest community first.
    No-op if RAW_NODES absent. Supersedes the per-community rename pass."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return page
    fam_counts = Counter(_logical_key(n.get("source_file")) for n in nodes)

    def fam_key(n):
        src = n.get("source_file")
        fam = _logical_key(src)
        return fam if fam_counts[fam] >= min_size else _node_group_key(src)

    key_of = _cap_communities(nodes, fam_key, max_communities)
    key_counts = Counter(key_of(n) for n in nodes)
    order = [k for k, _ in sorted(key_counts.items(), key=lambda kc: (-kc[1], kc[0]))]
    cid_of = {k: i for i, k in enumerate(order)}

    def _color(cid):
        return _COMMUNITY_COLORS[cid % len(_COMMUNITY_COLORS)]

    def _retag(ns):
        for n in ns:
            cid = cid_of[key_of(n)]
            n["community"] = cid
            n["community_name"] = _friendly_dir(order[cid])
            n["color"] = _node_color(_color(cid))
        return ns

    page = _sub_json_array(page, "RAW_NODES", _retag)
    legend = [
        {"cid": cid_of[k], "color": _color(cid_of[k]),
         "label": _friendly_dir(k), "count": key_counts[k]}
        for k in order
    ]
    page = _sub_json_array(page, "LEGEND", lambda _rows: legend)
    return page


def _fix_graph_stats(page: str) -> str:
    """Rewrite the #stats header to match the scrubbed + merged graph. graphify
    bakes the PRE-scrub node/edge/community counts into that div, so after the
    drops + community merge it's stale (e.g. "56 communities" when we render 8).
    No-op if RAW_NODES or the div is missing."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return page
    edges = _read_array(page, "RAW_EDGES") or []
    legend = _read_array(page, "LEGEND")
    communities = len(legend) if legend else len({n.get("community") for n in nodes})
    return re.sub(
        r'(<div id="stats">).*?(</div>)',
        rf"\g<1>{len(nodes)} nodes &middot; {len(edges)} edges "
        rf"&middot; {communities} communities\g<2>",
        page, count=1, flags=re.DOTALL,
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


# graphify emits `font: {"size": 0}` per node (labels off) and graph-overlay.js
# used to turn them all on with a whole-DataSet update at load. Baked here
# instead. The face must be the site mono -- canvas labels paint with whatever
# the font stack resolves to, and the overlay repaints once document.fonts is
# ready so the first paint isn't the fallback.
_NODE_FONT = {"size": 12, "color": "#ffffff", "face": "Iosevka Mayukai Monolite"}
# A label longer than this is a docstring-derived phrase rather than a symbol
# name -- long enough to leak prose onto a guest-visible page, and far too long
# to read on the canvas. Blanked, same as _redact_graph_nodes' hand-picked ids.
_LABEL_MAX = 20


def _label_graph_nodes(page: str) -> str:
    """Give every node the site label font and blank any label over `_LABEL_MAX`
    characters to "[ redacted ]". graph-overlay.js's `isRedacted` matches that
    exact string (and the server-side "[redacted]") so the node-info panel still
    withholds Type/Source/neighbours for them. No-op if RAW_NODES is absent."""
    def _relabel(nodes):
        for n in nodes:
            if len(str(n.get("label") or "")) > _LABEL_MAX:
                n["label"] = "[ redacted ]"
            n["font"] = dict(_NODE_FONT)
        return nodes

    return _sub_json_array(page, "RAW_NODES", _relabel)


# graphify draws every edge at width 2 and opacity 0.7, inheriting its colour
# from the node it leaves. At the zoom the page opens at that is a sub-pixel
# hairline at two-thirds alpha, and the structure between the nodes -- which is
# the thing a dependency graph is FOR -- read as a haze. Full alpha and a wider
# line put it back. This is the UNLIT state only: the cascade paints its own lit
# edges on graph-pulse.js's overlay canvas and never touches these values.
_EDGE_OPACITY = 1.0
_EDGE_WIDTH = 3


def _brighten_graph_edges(page: str) -> str:
    """Raise every RAW_EDGES entry to `_EDGE_OPACITY` / `_EDGE_WIDTH`. Colour is
    left alone: vis inherits each edge's colour from its from-node, which is what
    keeps the edge set reading as community-coloured rather than as grey. No-op if
    RAW_EDGES is absent."""
    def _brighten(edges):
        for e in edges:
            color = e.get("color")
            if not isinstance(color, dict):
                color = {}
                e["color"] = color
            color["opacity"] = _EDGE_OPACITY
            e["width"] = _EDGE_WIDTH
        return edges

    return _sub_json_array(page, "RAW_EDGES", _brighten)
