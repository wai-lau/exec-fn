"""Regression tests for the PATCH /api/rd merge-patch contract.

`api_rd_patch` (api/routes_api.py) used to REPLACE the whole `cards` array
with whatever the client sent. Every client (rd.js, hq-groups.js,
hq-board.js, card-dialog.js) works off a snapshot of ALL cards and PATCHes
that snapshot back after touching one (or a few) — meanwhile the in-process
nudge loop writes SERVER-OWNED state (`card["nudge"]`) to cards on disk
roughly every 30s. A stale client snapshot silently reverted those writes.

The fix: `helpers._merge_cards` shallow-merges incoming cards onto disk by
id — an omitted field is preserved from disk, only fields the client
actually sends win. `api_rd_patch` is unimportable here (it pulls in
`fastapi`, not part of this lightweight dev environment — see
test_rd_lock.py's note on the same constraint), so these tests exercise the
merge function directly, plus a full disk round-trip through the real
`_load_rd`/`_save_rd` persistence path to prove the on-disk nudge subtree
survives a merge-patch the way rd.js's `save()` now sends one.

Pure unit tests — no live app, no container, no fastapi. Monkeypatch
helpers.DATA_DIR to a tmp dir like test_rd_lock.py.
"""
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import helpers  # noqa: E402


def _seed(data_dir: Path, cards: list) -> None:
    (data_dir / "rd.json").write_text(json.dumps(
        {"columns": ["rd", "hq", "archives", "exile"], "cards": cards}))


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(helpers, "DATA_DIR", tmp_path)
    monkeypatch.setattr(helpers, "_ACTIVITY_LOG", tmp_path / "activity_log.json")
    helpers._json_cache.clear()
    yield tmp_path
    helpers._json_cache.clear()


_NUDGE = {
    "stage": "nudging",
    "graph": {
        "nodes": [{"id": "n1", "label": "step one", "done": False, "est_min": 15}],
        "edges": [],
    },
    "active_node": "n1",
    "next_nudge_at": "2026-08-21T10:00:00",
}


# ── pure _merge_cards unit tests ────────────────────────────────────────────

def test_merge_preserves_omitted_nudge_field():
    """The core bug: a client that omits `nudge` on a card it didn't touch
    must not erase the server-owned nudge subtree already on disk."""
    disk = [{"id": "card-x", "title": "X", "column": "hq", "order": 0, "nudge": copy.deepcopy(_NUDGE)}]
    # rd.js's new save() shape: only {id, column, order}, no nudge at all.
    incoming = [{"id": "card-x", "column": "hq", "order": 0}]
    merged = helpers._merge_cards(disk, incoming)
    assert len(merged) == 1
    assert merged[0]["nudge"] == _NUDGE
    assert merged[0]["title"] == "X"  # untouched field preserved too


def test_merge_applies_incoming_field_changes():
    disk = [{"id": "card-y", "title": "Y", "column": "rd", "order": 0}]
    incoming = [{"id": "card-y", "column": "hq", "order": 5}]
    merged = helpers._merge_cards(disk, incoming)
    assert merged[0]["column"] == "hq"
    assert merged[0]["order"] == 5
    assert merged[0]["title"] == "Y"


def test_merge_incoming_nudge_wins_wholesale_not_deep_merged():
    """Only a nudge-authoring client (card-dialog.js) sends `nudge`, and it
    must replace the disk value wholesale — never deep-merged node-by-node."""
    disk = [{"id": "card-z", "column": "hq", "nudge": copy.deepcopy(_NUDGE)}]
    new_nudge = {"stage": "idle", "graph": {"nodes": [], "edges": []}, "active_node": None}
    incoming = [{"id": "card-z", "column": "hq", "nudge": new_nudge}]
    merged = helpers._merge_cards(disk, incoming)
    assert merged[0]["nudge"] == new_nudge


def test_merge_new_card_kept_as_is():
    disk = [{"id": "card-a", "column": "rd"}]
    incoming = [{"id": "card-new", "title": "brand new", "column": "rd"}]
    merged = helpers._merge_cards(disk, incoming)
    ids = {c["id"] for c in merged}
    assert ids == {"card-a", "card-new"}
    new = next(c for c in merged if c["id"] == "card-new")
    assert new["title"] == "brand new"


def test_merge_order_incoming_first_then_untouched_disk_order():
    disk = [{"id": "a", "column": "rd"}, {"id": "b", "column": "rd"}, {"id": "c", "column": "rd"}]
    incoming = [{"id": "b", "column": "hq"}]
    merged = helpers._merge_cards(disk, incoming)
    assert [c["id"] for c in merged] == ["b", "a", "c"]


def test_merge_empty_incoming_returns_disk_unchanged():
    disk = [{"id": "a", "column": "rd", "nudge": copy.deepcopy(_NUDGE)}]
    merged = helpers._merge_cards(disk, [])
    assert merged == disk


# ── full disk round-trip through the real _load_rd/_save_rd path ───────────

def _simulate_patch(incoming_cards: list) -> None:
    """Mirrors api_rd_patch's write path minus the routes_api-only
    scheduling/log side-effects (those operate on the merged list and don't
    change what gets persisted for an untouched card's nudge subtree)."""
    with helpers._RD_LOCK:
        rd = helpers._load_rd()
        rd["cards"] = helpers._merge_cards(rd.get("cards", []), incoming_cards)
        helpers._save_rd(rd)


def test_patch_round_trip_leaves_untouched_cards_nudge_intact(data_dir):
    """The exact scenario in the finding: rd.js drags a card on the board and
    PATCHes {id, column, order} for every card — including card X, which it
    never decomposed and knows nothing about. X's nudge (written by the
    server-side nudge loop) must survive; Y's column change must land."""
    card_x = {"id": "card-x", "title": "X", "column": "hq", "order": 0,
              "nudge": copy.deepcopy(_NUDGE)}
    card_y = {"id": "card-y", "title": "Y", "column": "rd", "order": 0}
    _seed(data_dir, [card_x, card_y])

    # rd.js's save(): the whole board's {id, column, order} triples, no nudge.
    _simulate_patch([
        {"id": "card-x", "column": "hq", "order": 0},
        {"id": "card-y", "column": "hq", "order": 1},
    ])

    on_disk = {c["id"]: c for c in json.loads((data_dir / "rd.json").read_text())["cards"]}
    assert on_disk["card-x"]["nudge"] == _NUDGE
    assert on_disk["card-y"]["column"] == "hq"
    assert on_disk["card-y"]["order"] == 1


def test_patch_round_trip_card_x_omitted_entirely(data_dir):
    """A client that only sends the one card it touched (hq-groups.js /
    hq-board.js / card-dialog.js shape) must not disturb any other card."""
    card_x = {"id": "card-x", "title": "X", "column": "hq",
              "nudge": copy.deepcopy(_NUDGE)}
    card_y = {"id": "card-y", "title": "Y", "column": "hq", "dir_start_min": 600}
    _seed(data_dir, [card_x, card_y])

    _simulate_patch([{"id": "card-y", "title": "Y", "column": "hq", "dir_start_min": 630}])

    on_disk = {c["id"]: c for c in json.loads((data_dir / "rd.json").read_text())["cards"]}
    assert on_disk["card-x"] == card_x  # completely untouched
    assert on_disk["card-y"]["dir_start_min"] == 630
