"""A poll that does not exist yet (noodle/drafts.py): "create poll" stores
nothing; the host's first commit, carrying the owner's token for that exact
slug, creates it -- and nothing else can."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))


@pytest.fixture
def d(monkeypatch, tmp_path):
    from noodle import config, drafts, store
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(drafts, "_secret", None)
    monkeypatch.delenv("NOODLE_SECRET", raising=False)
    return drafts, store


def test_a_new_draft_stores_nothing(d):
    drafts, store = d
    n = drafts.new()
    assert store.valid_slug(n["slug"]) and not store.exists(n["slug"])
    assert store.all_polls() == []


def test_only_the_slugs_own_token_creates_it(d):
    drafts, store = d
    a, b = drafts.new(), drafts.new()
    drafts.ensure(a["slug"], {"draft": b["token"]})     # someone else's token
    drafts.ensure(a["slug"], {"draft": "x" * 32})
    drafts.ensure(a["slug"], {})
    assert not store.exists(a["slug"])
    drafts.ensure(a["slug"], {"draft": a["token"]})
    poll = store.load(a["slug"])
    assert poll["title"] == drafts.UNTITLED and poll["voters"] == {}


def test_a_second_first_commit_does_not_recreate(d):
    drafts, store = d
    a = drafts.new()
    drafts.ensure(a["slug"], {"draft": a["token"]})
    with store.edit(a["slug"]) as p:
        p["title"] = "board games"
    drafts.ensure(a["slug"], {"draft": a["token"]})
    assert store.load(a["slug"])["title"] == "board games"


def test_the_secret_is_kept_private(d):
    drafts, store = d
    from noodle import config
    drafts.token("A" * 22)
    mode = (config.DATA_DIR / "secret.key").stat().st_mode & 0o777
    assert mode == 0o600
