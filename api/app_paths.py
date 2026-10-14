"""Where the app submodules live, and the import path that reaches them.

Each app (spire, noodle) is a git submodule under apps/<name>/ whose layout
MIRRORS the parent: apps/<name>/api (python), api/templates, web, tests. So the
parent finds an app's pieces by the same relative paths it uses for its own.

Two places the apps dir can be: /app/apps in the container (compose mounts
./apps there, beside the ./api bind that is /app), and <repo>/apps on the host
(tests import api/ modules directly). The first that is non-empty wins: the
compose bind leaves an EMPTY api/apps mount point on the host, which must not
shadow the real <repo>/apps.

Importing this module APPENDS every apps/*/api to sys.path, so `import noodle`
or `import routes_aspira` resolve the same whether the code sits in api/ or in
a submodule. Append, never prepend: a parent module always wins a name clash
(tests/test_app_paths.py fails on one rather than letting the order decide)."""
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _apps_dir() -> Path | None:
    for cand in (_HERE / "apps", _HERE.parent / "apps"):
        if cand.is_dir() and any(cand.iterdir()):
            return cand
    return None


APPS_DIR = _apps_dir()


def app_dirs() -> list[Path]:
    """Every initialised app submodule, sorted by name. An uninitialised
    submodule is an empty dir and is skipped."""
    if APPS_DIR is None:
        return []
    return sorted(d for d in APPS_DIR.iterdir() if d.is_dir() and any(d.iterdir()))


def app_subdirs(rel: str) -> list[Path]:
    """apps/*/<rel> that exist, e.g. app_subdirs("web")."""
    return [d / rel for d in app_dirs() if (d / rel).is_dir()]


for _p in app_subdirs("api"):
    if str(_p) not in sys.path:
        sys.path.append(str(_p))


def web_dirs() -> list[Path]:
    """Every dir the "/" static mount serves from, in its order: the parent's
    web/ (/app/static in the container, <repo>/web on the host), then each
    app's web/. The one list main.py, pages, the lints and asset_version use."""
    container = Path("/app/static")
    parent = container if container.is_dir() else _HERE.parent / "web"
    return [parent, *app_subdirs("web")]
