"""noodle polls are encrypted at rest, keyed by their link (noodle/store.py)."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle import config, store  # noqa: E402

SLUG = "AbCdEfGhIjKlMnOpQrStUv"   # 22 chars, the generated shape
WEB = Path(__file__).resolve().parent.parent / "web"


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    return tmp_path


def _files():
    return list(store.polls_dir().glob("*.json"))


def test_nothing_readable_on_disk():
    store.create_at(SLUG, "secret board games", "2026-10-08T00:00:00")
    with store.edit(SLUG) as p:
        p["voters"]["ada"] = {"name": "ada", "pub": "x", "slots": ["2026-10-09:d"], "ts": 1, "order": 0}
    [f] = _files()
    raw = f.read_text()
    for plain in (SLUG, "secret", "board", "ada", "2026-10-09", "voters"):
        assert plain not in raw and plain not in f.name
    assert set(json.loads(raw)) == {"v", "nonce", "ct"}
    assert store.load(SLUG)["voters"]["ada"]["slots"] == ["2026-10-09:d"]


def test_a_fresh_nonce_every_write():
    store.create_at(SLUG, "t", "2026-10-08T00:00:00")
    first = json.loads(_files()[0].read_text())
    with store.edit(SLUG):
        pass
    second = json.loads(_files()[0].read_text())
    assert first["nonce"] != second["nonce"] and first["ct"] != second["ct"]


def test_tampered_or_swapped_file_refuses_to_open():
    other = "ZyXwVuTsRqPoNmLkJiHgFe"
    store.create_at(SLUG, "a", "2026-10-08T00:00:00")
    store.create_at(other, "b", "2026-10-08T00:00:00")
    a, b = store._path(SLUG), store._path(other)
    a.write_text(b.read_text())   # b's blob under a's name: the AAD catches it
    with pytest.raises(ValueError):
        store.load(SLUG)
    blob = json.loads(b.read_text())
    blob["ct"] = blob["ct"][:-4] + ("AAAA" if blob["ct"][-4:] != "AAAA" else "BBBB")
    b.write_text(json.dumps(blob))
    with pytest.raises(ValueError):
        store.load(other)


def test_a_plain_poll_is_encrypted_on_first_touch():
    legacy = store.polls_dir() / f"{SLUG}.json"
    legacy.write_text(json.dumps({"slug": SLUG, "title": "old", "voters": {}}))
    assert store.exists(SLUG)
    assert store.load(SLUG)["title"] == "old"
    assert not legacy.exists() and [f.stem for f in _files()] == [store.poll_id(SLUG)]


def test_list_shows_ids_only_and_migrates():
    (store.polls_dir() / f"{SLUG}.json").write_text(json.dumps({"slug": SLUG, "title": "old", "voters": {}}))
    polls = store.all_polls()
    assert [p["id"] for p in polls] == [store.poll_id(SLUG)]
    assert set(polls[0]) == {"id", "modified"}


def test_delete_by_id_and_by_slug():
    store.create_at(SLUG, "t", "2026-10-08T00:00:00")
    assert store.delete_id(store.poll_id(SLUG)) is True
    assert store.delete_id(store.poll_id(SLUG)) is False
    store.create_at(SLUG, "t", "2026-10-08T00:00:00")
    assert store.delete(SLUG) is True and not store.exists(SLUG)
    with pytest.raises(KeyError):
        store.delete_id("../" + "0" * 61)


def test_browser_derives_the_same_id():
    """web/noodle-admin.js maps a remembered slug to its file id with WebCrypto
    HKDF; it must agree with store.poll_id byte for byte."""
    src = (WEB / "noodle-admin.js").read_text()
    start = src.index("async function ndmIdOf")
    fn = src[start:src.index("\n}\n", start) + 2]
    js = fn + f"ndmIdOf({json.dumps(SLUG)}).then(function (h) {{ console.log(h); }});"
    try:
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        pytest.skip("node not installed")
    assert out.stdout.strip() == store.poll_id(SLUG), out.stderr
