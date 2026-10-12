"""/spire slow logs (api/spire_perflog.py): small JSON summaries kept in a temp folder, capped, newest first."""
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))


def _mod(tmp_path, monkeypatch):
    monkeypatch.setenv("SPIRE_PERFLOG_DIR", str(tmp_path / "perf"))
    import spire_perflog
    return importlib.reload(spire_perflog)


def test_save_and_recent(tmp_path, monkeypatch):
    m = _mod(tmp_path, monkeypatch)
    assert m.save({"avgMs": 20, "brave": True}, "Mozilla/5.0 Brave")
    assert m.save({"avgMs": 40}, "UA")
    got = m.recent(10)
    assert [g["avgMs"] for g in got] == [40, 20]  # newest first
    assert got[1]["ua"].startswith("Mozilla") and "at" in got[1]


def test_rejects_non_objects_and_big(tmp_path, monkeypatch):
    m = _mod(tmp_path, monkeypatch)
    assert not m.save([1, 2], "UA")
    assert not m.save({"x": "y" * (m.MAX_BYTES + 10)}, "UA")
    assert m.recent() == []


def test_cap_drops_oldest(tmp_path, monkeypatch):
    m = _mod(tmp_path, monkeypatch)
    m.MAX_FILES = 3
    for i in range(5):
        m.save({"i": i}, "UA")
    assert [g["i"] for g in m.recent(10)] == [4, 3, 2]
