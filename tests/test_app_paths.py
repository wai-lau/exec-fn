"""App submodules (apps/<name>) resolve the way the parent's own files do.

apps/README.md: an app mirrors the parent layout, and the parent's static
mount, template loader and sys.path all search the app dirs AFTER the
parent's. "After" only stays harmless while names never collide -- a clash is
decided silently by search order -- so these pin uniqueness, plus the two
loaders' order, plus the reload-walk guard (no node_modules under apps/).
"""
import os
import sys
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.staticfiles import StaticFiles
from starlette.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

import app_paths  # noqa: E402
import pages  # noqa: E402


def _apps():
    return [d for d in (ROOT / "apps").iterdir() if d.is_dir()] if (ROOT / "apps").is_dir() else []


def _names(d: Path, pattern: str) -> set[str]:
    return {p.name for p in d.glob(pattern)} if d.is_dir() else set()


def _modules(d: Path) -> set[str]:
    """Top-level importable names in an api dir: *.py stems + package dirs."""
    if not d.is_dir():
        return set()
    return {p.stem for p in d.glob("*.py")} | {
        p.name for p in d.iterdir() if p.is_dir() and (p / "__init__.py").exists()}


@pytest.mark.parametrize("rel,pattern", [("web", "*"), ("api/templates", "*.html")])
def test_no_file_name_in_both_parent_and_an_app(rel, pattern):
    seen = {n: "parent" for n in _names(ROOT / rel, pattern)}
    for app in _apps():
        for n in _names(app / rel, pattern):
            assert n not in seen, f"{rel}/{n} is in both {seen[n]} and {app.name}"
            seen[n] = app.name


def test_no_module_name_in_both_parent_and_an_app():
    seen = {n: "parent" for n in _modules(ROOT / "api")}
    for app in _apps():
        for n in _modules(app / "api"):
            assert n not in seen, f"module {n!r} is in both {seen[n]} and {app.name}"
            seen[n] = app.name


def test_no_node_modules_under_apps():
    """uvicorn --reload walks /app (incl. /app/apps) four times a second; a
    node_modules there is the nightfall-src CPU burn again (ARCHITECTURE §17e)."""
    for app in _apps():
        for dirpath, dirnames, _ in os.walk(app):
            assert "node_modules" not in dirnames, f"{dirpath}/node_modules"
            dirnames[:] = [d for d in dirnames if d != ".git"]


@pytest.fixture
def fake_apps(tmp_path, monkeypatch):
    parent_tmpl = tmp_path / "templates"
    parent_web = tmp_path / "static"
    app = tmp_path / "apps" / "demo"
    for d in (parent_tmpl, parent_web, app / "api" / "templates", app / "web"):
        d.mkdir(parents=True)
    monkeypatch.setattr(app_paths, "APPS_DIR", tmp_path / "apps")
    monkeypatch.setattr(pages, "_TMPL", parent_tmpl)
    return parent_tmpl, parent_web, app


def test_tmpl_finds_an_app_template_and_parent_wins(fake_apps):
    parent_tmpl, _, app = fake_apps
    (app / "api/templates/only-app.html").write_text("app")
    (app / "api/templates/both.html").write_text("app")
    (parent_tmpl / "both.html").write_text("parent")
    assert pages._tmpl("only-app.html") == "app"
    assert pages._tmpl("both.html") == "parent"
    with pytest.raises(FileNotFoundError):
        pages._tmpl("nowhere.html")


def test_static_mount_serves_app_web_after_parent(fake_apps):
    """The same construction as main.py's "/" mount."""
    _, parent_web, app = fake_apps
    (app / "web/only-app.js").write_text("app")
    (app / "web/both.js").write_text("app")
    (parent_web / "both.js").write_text("parent")
    static = StaticFiles(directory=str(parent_web), html=True)
    static.all_directories += [str(p) for p in app_paths.app_subdirs("web")]
    web = Starlette()
    web.mount("/", static)
    c = TestClient(web)
    assert c.get("/only-app.js").text == "app"
    assert c.get("/both.js").text == "parent"
    assert c.get("/nowhere.js").status_code == 404
