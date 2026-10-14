"""Serve-time cache-busting (api/asset_version.py): the `?v=` an HTML page
carries is the served file's content hash, whatever the source wrote."""
import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
import app_paths  # noqa: E402
import asset_version  # noqa: E402


@pytest.fixture
def web(tmp_path, monkeypatch):
    parent, app = tmp_path / "parent", tmp_path / "app"
    (parent / "fonts").mkdir(parents=True)
    app.mkdir()
    (parent / "a.css").write_text("body{}")
    (parent / "fonts" / "f.woff2").write_bytes(b"\0font")
    (app / "b.js").write_text("x=1")
    monkeypatch.setattr(app_paths, "web_dirs", lambda: [parent, app])
    asset_version._cache.clear()
    return parent, app


def _h(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:8]


def test_rewrites_parent_app_and_subdir_assets(web):
    html = ('<link href="/a.css?v=84"><script src="/b.js?v=3"></script>'
            "<link href='/fonts/f.woff2?v=1'>")
    out = asset_version.rewrite(html)
    assert f'"/a.css?v={_h(b"body{}")}"' in out
    assert f'"/b.js?v={_h(b"x=1")}"' in out
    font = _h(b"\0font")
    assert f"'/fonts/f.woff2?v={font}'" in out


def test_unknown_and_unversioned_left_alone(web):
    html = '<a href="/nope.css?v=9"><link href="/a.css"><img src="x/a.css?v=2">'
    assert asset_version.rewrite(html) == html


def test_site_absolute_url_rewritten(web):
    out = asset_version.rewrite('<meta content="https://wai-lau.net/a.css?v=1">')
    assert f"https://wai-lau.net/a.css?v={_h(b'body{}')}" in out


def test_hash_follows_an_edit(web):
    parent, _ = web
    first = asset_version.rewrite('"/a.css?v=1"')
    (parent / "a.css").write_text("body{color:red}")
    assert asset_version.rewrite('"/a.css?v=1"') != first


def test_path_traversal_not_resolved(web):
    html = '"/../parent/a.css?v=1"'
    assert asset_version.rewrite(html) == html
