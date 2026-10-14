"""What the repo's lints share: where the files are, comment stripping, baseline
I/O, and the `--update` entry point (scripts/lint-colors.py, lint-scale.py).

File discovery goes through api/app_paths.py -- the SAME dir lists the server
uses (`web_dirs`, `template_dirs`) -- so a lint scans exactly what is served:
the parent's web/ + api/templates, then every app submodule's (apps/<name>/,
ARCHITECTURE.md §1e). One baseline covers all of it. Kept out of the lints so
a new app, or a new kind of served dir, is one edit here, not one per lint.
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import app_paths  # noqa: E402


def _glob(dirs, *exts):
    return [p for d in dirs for ext in exts for p in sorted(d.glob(f"*.{ext}"))]


def _with_app_root(dirs: list[Path], rel: str) -> list[Path]:
    """Add the committing sub repo's own dir (LINT_APP_ROOT, set by
    scripts/pre-commit) unless it is already one of exec-fn's: a sub repo
    cloned on its own lints its files against exec-fn's tooling copy in its
    gitignored .exec-fn/, where app_paths finds no apps."""
    extra = os.environ.get("LINT_APP_ROOT")
    if extra:
        d = Path(extra) / rel
        if d.is_dir() and d.resolve() not in {x.resolve() for x in dirs if x.is_dir()}:
            dirs = [*dirs, d]
    return [d for d in dirs if d.is_dir()]


def _web_dirs() -> list[Path]:
    return _with_app_root(app_paths.web_dirs(), "web")


def css_files() -> list[Path]:
    """Every served stylesheet (top level of each web dir; vendor/ excluded)."""
    return _glob(_web_dirs(), "css")


def template_files() -> list[Path]:
    return _glob(_with_app_root(app_paths.template_dirs(), "api/templates"), "html")


def web_files(*exts: str) -> list[Path]:
    return _glob(_web_dirs(), *exts)


def strip_comments(text: str, html: bool = True) -> str:
    """Drop /* block */ comments (and <!-- html --> ones), so tokens written in
    prose are not counted as usage."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL) if html else text


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_json(path: Path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n")


def main(check, update, argv=None) -> int:
    """`--update` rewrites the baseline; otherwise check. Returns the exit code."""
    argv = sys.argv[1:] if argv is None else argv
    return update() if "--update" in argv else check()
