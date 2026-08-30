"""Serve-time scrubbing of graphify's /graph page.

graph.html is regenerated wholesale by /graphify (and by the post-commit watch
rebuild), so anything we want kept out of the public graph is applied per
request against its embedded RAW_NODES / RAW_EDGES / LEGEND arrays (same
survives-rebuild rationale as the improvedLayout patch in routes_views). These
transforms live here:

- `_redact_graph_nodes`: blank a few leaky per-node summaries to "[redacted]".
- `_drop_graph_book_nodes`: cut the Pollack tarot reference book wholesale.
- `_drop_graph_moltbook_nodes`: cut the moltbook heartbeat plumbing.
- `_drop_graph_inferred_edges`: cut the dashed low-confidence edges (and
  recompute the baked per-node degree against what survives).

Everything about how the surviving graph LOOKS — community regrouping/colours,
the hexagon restyle, hover-tooltip removal, line-count node sizes, the header
count fixup — lives in graph_style.py, which builds on the array helpers here.

graphify emits each array as a single physical line, so we anchor on the line
(`^NAME = [...];$`, greedy within the line). A non-greedy `\\[.*?\\]` would stop
at the first `];` — which can occur *inside* a node title/docstring — and parse
a truncated, invalid array. The `const ` prefix is optional: the full /graphify
build emits `const LEGEND`, the watch rebuild emits bare `LEGEND`.
"""
import re
import json
from collections import Counter

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

# External library / framework symbols graphify lifts out of imports + type
# annotations (BaseModel, Request, WebSocket, FastAPI, Path, datetime, ...) —
# not exec-fn's own code, just clutter on the viz. In graph.html they carry NO
# source_file (no in-repo definition site); this label set backs that up for any
# that slip through with a mis-attributed source.
_GRAPH_LIB_LABELS = {
    "Request", "Response", "WebSocket", "WebSocketDisconnect", "BaseModel",
    "FastAPI", "APIRouter", "HTTPException", "JSONResponse", "HTMLResponse",
    "PlainTextResponse", "StreamingResponse", "FileResponse", "RedirectResponse",
    "Depends", "Security", "Cookie", "Query", "Path", "HTTPBearer",
    "HTTPAuthorizationCredentials", "BackgroundTasks", "Any", "Optional",
    "datetime", "date", "timedelta", "timezone",
}

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


def _drop_graph_library_nodes(page: str) -> str:
    """Drop external library/framework symbols from the viz — imported names like
    BaseModel / Request / WebSocket / FastAPI, not exec-fn code. Signal: a code
    node with no source_file (no in-repo definition) OR a known library label.
    Prunes their dangling edges too. No-op if RAW_NODES is absent."""
    nodes = _read_array(page, "RAW_NODES")
    if not nodes:
        return page
    drop_ids = {
        n.get("id")
        for n in nodes
        if n.get("file_type") == "code"
        and (
            not str(n.get("source_file") or "").strip()
            or n.get("label") in _GRAPH_LIB_LABELS
        )
    }
    return _prune_graph_nodes(page, drop_ids)


def _drop_graph_inferred_edges(page: str) -> str:
    """Drop the dashed (INFERRED, low-confidence) edges from RAW_EDGES — ~16% of
    edges, drawn at opacity 0.35. Removing them thins the edge set the physics
    sim + canvas have to chew, so the graph settles + renders faster, and only
    the EXTRACTED (solid) relationships remain.

    Also recomputes each surviving node's baked `degree` against the final
    edge set: graphify bakes degree pre-scrub, and by the time this runs the
    earlier node-drop passes (book/vendor/library/moltbook) have already
    pruned their own dangling edges too, so a stale degree would misreport the
    node-info sidebar's "Degree: N" and skew graph-overlay.js's
    highest-degree-node tour pick. No-op if RAW_EDGES/RAW_NODES is absent."""
    edges = _read_array(page, "RAW_EDGES")
    if edges is None:
        return page
    kept = [e for e in edges if not e.get("dashes")]
    page = _sub_json_array(page, "RAW_EDGES", lambda _es: kept)

    degree = Counter()
    for e in kept:
        if e.get("from") is not None:
            degree[e["from"]] += 1
        if e.get("to") is not None:
            degree[e["to"]] += 1

    return _sub_json_array(
        page,
        "RAW_NODES",
        lambda nodes: [{**n, "degree": degree.get(n.get("id"), 0)} for n in nodes],
    )


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
