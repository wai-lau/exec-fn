"""Serve-time scrubbing of graphify's /graph page.

graph.html is regenerated wholesale by /graphify, so anything we want kept out
of the public graph is applied per request against its embedded RAW_NODES /
RAW_EDGES / LEGEND arrays (same survives-rebuild rationale as the improvedLayout
patch in routes_views). Two transforms live here:

- `_redact_graph_nodes`: blank a few leaky per-node summaries to "[redacted]".
- `_drop_graph_book_nodes`: cut the Pollack tarot reference book wholesale.
"""
import re
import json

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


def _redact_graph_nodes(page: str) -> str:
    """Blank the label+title of every _GRAPH_REDACT_IDS node to "[redacted]" in
    graphify's embedded RAW_NODES array. No-op if the array is absent/unparseable
    or nothing matched."""
    m = re.search(r"RAW_NODES = (\[.*?\]);", page, re.DOTALL)
    if not m:
        return page
    try:
        nodes = json.loads(m.group(1))
    except ValueError:
        return page
    changed = False
    for n in nodes:
        if n.get("id") in _GRAPH_REDACT_IDS:
            n["label"] = n["title"] = "[redacted]"
            changed = True
    if not changed:
        return page
    return page.replace(
        m.group(0),
        "RAW_NODES = " + json.dumps(nodes, ensure_ascii=False) + ";",
        1,
    )


def _sub_json_array(page: str, prefix: str, transform) -> str:
    """Find `<prefix> = [...];`, json-parse the array, apply `transform` to it,
    and splice the result back. No-op if the array is absent or unparseable."""
    m = re.search(re.escape(prefix) + r" = (\[.*?\]);", page, re.DOTALL)
    if not m:
        return page
    try:
        arr = json.loads(m.group(1))
    except ValueError:
        return page
    return page.replace(
        m.group(0),
        prefix + " = " + json.dumps(transform(arr), ensure_ascii=False) + ";",
        1,
    )


def _drop_graph_book_nodes(page: str) -> str:
    """Remove every RAW_NODES entry whose source_file is under the tarot book
    dir, drop RAW_EDGES touching them, and prune the now-empty community rows
    from LEGEND. No-op if RAW_NODES is absent/unparseable or nothing matched."""
    m = re.search(r"RAW_NODES = (\[.*?\]);", page, re.DOTALL)
    if not m:
        return page
    try:
        nodes = json.loads(m.group(1))
    except ValueError:
        return page
    drop_ids = {
        n.get("id")
        for n in nodes
        if str(n.get("source_file") or "").startswith(_GRAPH_DROP_SOURCE_PREFIX)
    }
    if not drop_ids:
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
        "const LEGEND",
        lambda rows: [r for r in rows if r.get("cid") in live_cids],
    )
    return page
