"""Serve-time scrubbing of graphify's /graph page.

graph.html is regenerated wholesale by /graphify (and by the post-commit watch
rebuild), so anything we want kept out of the public graph is applied per
request against its embedded RAW_NODES / RAW_EDGES / LEGEND arrays (same
survives-rebuild rationale as the improvedLayout patch in routes_views). These
transforms live here:

- `_redact_graph_nodes`: blank a few leaky per-node summaries to "[redacted]".
- `_drop_graph_book_nodes`: cut the Pollack tarot reference book wholesale.
- `_drop_graph_moltbook_nodes`: cut the moltbook heartbeat plumbing.
- `_name_graph_communities`: replace generic "Community N" labels with a name
  derived from each surviving community's dominant source file (run last, after
  the drops, so emptied communities are gone and the vote is over live nodes).
- `_size_graph_by_loc`: rescale every node so its size tracks its line count
  (file node = whole-file lines, symbol = its span) instead of graphify's degree
  default. Line spans come from graph.json's `source_location` start lines — no
  file reads (most source files aren't mounted into the serving container).

graphify emits each array as a single physical line, so we anchor on the line
(`^NAME = [...];$`, greedy within the line). A non-greedy `\\[.*?\\]` would stop
at the first `];` — which can occur *inside* a node title/docstring — and parse
a truncated, invalid array. The `const ` prefix is optional: the full /graphify
build emits `const LEGEND`, the watch rebuild emits bare `LEGEND`.
"""
import re
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

# graphify bakes a per-node "rationale" summary from each symbol's docstring. A
# few of those leak internals we don't want on the now-public /graph — e.g. the
# bearer-auth design + the EXEC_SAY_KEY key name. Scrub their label+title to
# "[redacted]" at serve time so the redaction survives /graphify rebuilds. Kept
# deliberately small — the graph is otherwise just benign codebase structure.
_GRAPH_REDACT_IDS = {
    "api_auth_rationale_47",  # bearer-auth scheme + EXEC_SAY_KEY name
}

# graphify indexes the Pollack tarot reference book under api/tarot/book/ — 100+
# concept nodes (card meanings, frameworks, numerology) that flood the public
# /graph with reading-reference trivia and drown the actual codebase structure.
# The tarot *engine* (routes/agent/prompt/cards code) stays; only the book/ info
# is cut.
_GRAPH_DROP_SOURCE_PREFIX = "api/tarot/book/"

# Vendored third-party libs (e.g. vis-network's minified bundle) parse into a
# node per mangled function name — Kv(), _f(), Le(), ... — 150+ meaningless
# symbols that aren't our code and drown the real structure. Drop the whole
# vendor dir; same survives-rebuild rationale as the book drop.
_GRAPH_DROP_VENDOR_PREFIX = "web/vendor/"

# moltbook is a separate side-ledger (heartbeat log) wired into exec-fn through a
# single read-only route + its data file. It's noise on the public codebase
# graph, so drop any node whose id/label/source mentions it. Substring match (not
# a source_file prefix) because the plumbing rides inside api/routes_views.py
# rather than its own dir.
_GRAPH_DROP_NAME_SUBSTR = "moltbook"


def _array_re(name: str) -> "re.Pattern":
    """Match `[const |var |let ]NAME = [ ... ];` on its own line. Group 1 is the
    assignment prefix (preserved on replace), group 2 is the array literal."""
    return re.compile(
        r"^((?:const |var |let )?" + re.escape(name) + r" = )(\[.*\]);$",
        re.MULTILINE,
    )


def _read_array(page: str, name: str):
    """Return the parsed array for `name`, or None if absent/unparseable."""
    m = _array_re(name).search(page)
    if not m:
        return None
    try:
        return json.loads(m.group(2))
    except ValueError:
        return None


def _sub_json_array(page: str, name: str, transform) -> str:
    """Find the `name` array, json-parse it, apply `transform`, splice the result
    back (keeping the original assignment prefix). No-op if absent/unparseable."""
    m = _array_re(name).search(page)
    if not m:
        return page
    try:
        arr = json.loads(m.group(2))
    except ValueError:
        return page
    return page.replace(
        m.group(0),
        m.group(1) + json.dumps(transform(arr), ensure_ascii=False) + ";",
        1,
    )


def _redact_graph_nodes(page: str) -> str:
    """Blank the label+title of every _GRAPH_REDACT_IDS node to "[redacted]" in
    graphify's embedded RAW_NODES array."""
    def _redact(nodes):
        for n in nodes:
            if n.get("id") in _GRAPH_REDACT_IDS:
                n["label"] = n["title"] = "[redacted]"
        return nodes

    return _sub_json_array(page, "RAW_NODES", _redact)


def _prune_graph_nodes(page: str, drop_ids) -> str:
    """Splice out every node in `drop_ids` plus its dangling references: drop the
    RAW_NODES entries, RAW_EDGES touching them, now-empty community rows from
    LEGEND, and hyperedges referencing any removed node. No-op on empty set."""
    drop_ids = set(drop_ids)
    if not drop_ids:
        return page
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return page
    kept = [n for n in nodes if n.get("id") not in drop_ids]
    live_cids = {n.get("community") for n in kept}
    page = _sub_json_array(page, "RAW_NODES", lambda _a: kept)
    page = _sub_json_array(
        page,
        "RAW_EDGES",
        lambda es: [
            e for e in es
            if e.get("from") not in drop_ids and e.get("to") not in drop_ids
        ],
    )
    page = _sub_json_array(
        page,
        "LEGEND",
        lambda rows: [r for r in rows if r.get("cid") in live_cids],
    )
    # Hyperedges (shaded regions) carry graphify's narrative cluster labels —
    # e.g. "First-row forces gathered into the Chariot's ego" off the tarot
    # book. Drop any that reference a removed node (else they dangle + keep the
    # book's reading-trivia framing on the public graph).
    page = _sub_json_array(
        page,
        "hyperedges",
        lambda hs: [
            h for h in hs
            if not any(nid in drop_ids for nid in h.get("nodes", []))
        ],
    )
    return page


def _drop_graph_book_nodes(page: str) -> str:
    """Remove every RAW_NODES entry whose source_file is under the tarot book
    dir (and its dangling references). No-op if RAW_NODES is absent/unparseable
    or nothing matched."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return page
    drop_ids = {
        n.get("id")
        for n in nodes
        if str(n.get("source_file") or "").startswith(_GRAPH_DROP_SOURCE_PREFIX)
    }
    return _prune_graph_nodes(page, drop_ids)


def _drop_graph_vendor_nodes(page: str) -> str:
    """Remove every RAW_NODES entry under the vendored-lib dir (and its dangling
    references). Strips the minified vis-network function nodes (Kv(), _f(), ...)
    from the public graph. No-op if RAW_NODES is absent or nothing matched."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return page
    drop_ids = {
        n.get("id")
        for n in nodes
        if str(n.get("source_file") or "").startswith(_GRAPH_DROP_VENDOR_PREFIX)
    }
    return _prune_graph_nodes(page, drop_ids)


# Short tokens that read better fully uppercased in a derived community name
# (acronyms / domain terms) than title-cased ("Routes Api" -> "Routes API").
_NAME_ACRONYMS = {
    "api", "css", "js", "html", "llm", "mtg", "gcal", "sse", "ui", "id",
    "json", "cv", "rd", "hq", "ics", "oauth", "svg", "etag", "ip", "ts",
    "tsx", "md", "sh", "url", "sql", "http", "dag",
}


def _friendly_from_source(src: str) -> str:
    """Title-case name from a source path's basename: strip dir + extension,
    split on _-. separators, capitalize each word (acronyms fully upper)."""
    base = src.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    words = []
    for w in re.split(r"[_\-.]+", base):
        if not w:
            continue
        words.append(w.upper() if w.lower() in _NAME_ACRONYMS else w.capitalize())
    return " ".join(words)


def _dominant_community_name(nodes, cid) -> str:
    """Friendly name for community `cid` from its members' most common source
    file, or "" if the community has no source-backed nodes."""
    srcs = Counter(
        str(n.get("source_file"))
        for n in nodes
        if n.get("community") == cid and n.get("source_file")
    )
    if not srcs:
        return ""
    return _friendly_from_source(srcs.most_common(1)[0][0])


_GENERIC_COMMUNITY_RE = re.compile(r"^Community \d+$")


def _community_renames(nodes, legend) -> dict:
    """Map of cid -> friendly name for every legend row still labeled generically
    ("Community N") that has a source-backed dominant file."""
    renames = {}
    for row in legend:
        if _GENERIC_COMMUNITY_RE.match(str(row.get("label") or "")):
            name = _dominant_community_name(nodes, row.get("cid"))
            if name:
                renames[row.get("cid")] = name
    return renames


def _apply_legend_renames(rows, renames):
    for r in rows:
        if r.get("cid") in renames:
            r["label"] = renames[r["cid"]]
    return rows


def _apply_node_renames(nodes, renames):
    for n in nodes:
        name = renames.get(n.get("community"))
        if name:
            n["community_name"] = name
    return nodes


def _name_graph_communities(page: str) -> str:
    """Replace generic "Community N" labels with a name derived from each
    community's dominant source file. Updates both the LEGEND label (legend
    list) and member nodes' community_name (node-info panel) — both render. Best
    effort: communities with no source files keep their generic label. Run AFTER
    the drop passes so the dominant-source vote reflects only surviving nodes."""
    nodes = _read_array(page, "RAW_NODES")
    legend = _read_array(page, "LEGEND")
    if not nodes or not legend:
        return page
    renames = _community_renames(nodes, legend)
    if not renames:
        return page
    page = _sub_json_array(page, "LEGEND", lambda rows: _apply_legend_renames(rows, renames))
    page = _sub_json_array(page, "RAW_NODES", lambda ns: _apply_node_renames(ns, renames))
    return page


def _drop_graph_moltbook_nodes(page: str) -> str:
    """Remove every RAW_NODES entry whose id/label/source mentions moltbook (and
    its dangling references). No-op if RAW_NODES is absent or nothing matched."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return page
    drop_ids = {
        n.get("id")
        for n in nodes
        if _GRAPH_DROP_NAME_SUBSTR in (
            str(n.get("id") or "")
            + str(n.get("label") or "")
            + str(n.get("source_file") or "")
        ).lower()
    }
    return _prune_graph_nodes(page, drop_ids)


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
