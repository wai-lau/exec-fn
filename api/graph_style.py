"""Presentation transforms for graphify's /graph page.

Same serve-time, survives-a-rebuild contract as graph_scrub (which holds the
privacy scrubs + node/edge drops); this half is purely how the surviving graph
LOOKS: community regrouping + colours, hexagon restyle, hover-tooltip removal,
line-count-driven node sizes, and the header count fixup. Split out of
graph_scrub.py to keep both under the 500-line cap.
"""
import re
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

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


def _merge_graph_communities(page: str, min_size: int = _MIN_COMMUNITY) -> str:
    """Regroup nodes into logically-named, feature-based communities for the
    /graph page only, so color encodes real structure. graphify emits dozens of
    fine-grained communities but vis cycles a 10-color palette -> colors collide
    -> the clusters read as indistinguishable noise. Group by logical
    module/feature (`_logical_key`: api/tarot/* + web/tarot-*.js -> "Tarot",
    api/nudge*.py -> "Nudge", ...); a feature smaller than `min_size` folds into
    its top-level dir bucket ("API"/"Web") so the legend isn't littered with
    2-node modules. Every feature here is already <=150 nodes. Reassigns each
    node's community/community_name/color and rebuilds LEGEND, biggest community
    first. No-op if RAW_NODES absent. Supersedes the per-community rename pass."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return page
    fam_counts = Counter(_logical_key(n.get("source_file")) for n in nodes)

    def key_of(n):
        src = n.get("source_file")
        fam = _logical_key(src)
        return fam if fam_counts[fam] >= min_size else _node_group_key(src)

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


# vis-network node size range to map line counts into. Matches graphify's own
# default spread (~10..40) so the rescale changes *what* drives size, not the
# overall visual scale.
_SIZE_MIN = 10.0
_SIZE_MAX = 40.0
_LOC_LINE_RE = re.compile(r"L(\d+)")


def _loc_by_node_id(graph_json_path: "Path"):
    """Approximate each node's line count from graph.json `source_location`
    start lines (no file reads — most source files aren't mounted in the serving
    container). Within a file, symbols are sorted by start line: a symbol's span
    is the gap to the next symbol; the file node (label == basename) gets the
    whole-file length (max start line). Returns {node_id: loc} or {} on any
    failure (missing/unparseable graph.json) so the caller no-ops safely."""
    try:
        data = json.loads(Path(graph_json_path).read_text())
        gnodes = data["nodes"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}
    starts, sources, labels = {}, {}, {}
    for n in gnodes:
        nid = n.get("id")
        m = _LOC_LINE_RE.match(str(n.get("source_location") or ""))
        if nid is None or not m:
            continue
        starts[nid] = int(m.group(1))
        sources[nid] = n.get("source_file")
        labels[nid] = n.get("label")
    by_file = defaultdict(list)
    for nid, start in starts.items():
        if sources.get(nid):
            by_file[sources[nid]].append((start, nid))
    loc = {}
    for src, entries in by_file.items():
        entries.sort()
        file_len = entries[-1][0]            # max start line ~ file length
        base = src.rsplit("/", 1)[-1]
        for i, (start, nid) in enumerate(entries):
            if labels.get(nid) == base:      # the file node itself
                loc[nid] = max(file_len, 1)
            else:                            # symbol: span to the next def
                nxt = entries[i + 1][0] if i + 1 < len(entries) else file_len
                loc[nid] = max(nxt - start, 1)
    return loc


def _size_graph_by_loc(page: str, graph_json_path: "Path") -> str:
    """Rescale RAW_NODES so node size tracks line count instead of graphify's
    degree default. sqrt-compressed into _SIZE_MIN.._SIZE_MAX so a 460-line file
    isn't 40x a one-liner. Nodes without a line span keep their existing size.
    No-op if graph.json is unavailable or yields no spans."""
    loc = _loc_by_node_id(graph_json_path)
    if not loc:
        return page
    lo = math.sqrt(min(loc.values()))
    hi = math.sqrt(max(loc.values()))
    span = hi - lo

    def _scale(value):
        if span <= 0:
            return (_SIZE_MIN + _SIZE_MAX) / 2
        t = (math.sqrt(value) - lo) / span
        return round(_SIZE_MIN + t * (_SIZE_MAX - _SIZE_MIN), 1)

    def _resize(nodes):
        for n in nodes:
            if n.get("id") in loc:
                n["size"] = _scale(loc[n["id"]])
        return nodes

    return _sub_json_array(page, "RAW_NODES", _resize)
