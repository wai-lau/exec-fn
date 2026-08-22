"""Unit tests for rd.json write-serialization (helpers._RD_LOCK).

Pure unit tests against the api modules — no live app, no container. They
monkeypatch helpers.DATA_DIR to a tmp dir, so the pre-commit fast gate can run
them anywhere.

The race being guarded: rd.json read-modify-write cycles run on genuinely
parallel OS threads (asyncio.to_thread nudge scans, sync-def routes on
Starlette's thread pool, chat-tool dispatch), so two unlocked cycles can
interleave and the last _save_rd silently drops the other thread's changes.
"""
import copy
import json
import sys
import threading
import time
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


def test_load_rd_returns_private_copy(data_dir):
    """Two callers must get independent objects — the mtime cache must never
    hand the same mutable dict to two threads (one thread's in-progress edits
    would leak into the other's snapshot)."""
    _seed(data_dir, [{"id": "c1", "title": "one", "column": "rd"}])
    a = helpers._load_rd()
    a["cards"].append({"id": "evil", "title": "leak", "column": "rd"})
    a["cards"][0]["title"] = "mutated"
    b = helpers._load_rd()
    assert [c["id"] for c in b["cards"]] == ["c1"]
    assert b["cards"][0]["title"] == "one"


def test_save_rd_atomic_no_tmp_residue(data_dir):
    """_save_rd must replace the file atomically (no partial file readable,
    no .tmp left behind)."""
    _seed(data_dir, [])
    rd = helpers._load_rd()
    rd["cards"].append({"id": "c1", "title": "x", "column": "rd"})
    helpers._save_rd(rd)
    assert json.loads((data_dir / "rd.json").read_text())["cards"][0]["id"] == "c1"
    assert not list(data_dir.glob("*.tmp"))


def test_concurrent_rmw_no_lost_update(data_dir, monkeypatch):
    """The finding's exact failure path: thread A (chat tool create_card) loads
    rd.json, is held mid-cycle; thread B (PATCH /api/hq bulk update) completes
    its own load-modify-save. Without the lock, whichever write lands last
    silently drops the other's change. With it, B blocks until A commits and
    both changes survive."""
    import chat_tools
    import hq

    _seed(data_dir, [{"id": "card-x", "title": "seed", "column": "hq",
                      "order": 0, "scheduled_day": None}])

    loaded = threading.Event()
    real_load = chat_tools._load_rd

    def slow_load():
        rd = copy.deepcopy(real_load())
        loaded.set()
        time.sleep(0.4)  # hold A mid-cycle; B's whole RMW fits in this window
        return rd

    monkeypatch.setattr(chat_tools, "_load_rd", slow_load)

    errors = []

    def create():
        try:
            chat_tools._tool_create_card({"title": "new card"})
        except Exception as e:  # pragma: no cover - surfaced via assert below
            errors.append(e)

    t = threading.Thread(target=create)
    t.start()
    assert loaded.wait(2), "thread A never reached its load"
    hq.bulk_update_scheduled_days([{"id": "card-x", "order": 5}])
    t.join(5)
    assert not t.is_alive() and not errors

    final = json.loads((data_dir / "rd.json").read_text())
    titles = [c.get("title") for c in final["cards"]]
    orders = {c["id"]: c.get("order") for c in final["cards"]}
    assert "new card" in titles, "thread A's created card was lost"
    assert orders["card-x"] == 5, "thread B's order update was lost"
