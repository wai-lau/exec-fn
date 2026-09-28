"""noodle is standalone: it imports no other app module, and its storage
touches only its own directory.

1. Import graph -- every `import`/`from` in api/noodle/** is parsed (AST, not
   regex) and any that names an app module other than noodle fails. "App
   module" is DERIVED from the tree (every api/*.py stem and every package dir
   under api/), never hand-listed, so a module added later is covered.
2. Storage audit -- open/os.replace/mkstemp/mkdir/unlink are wrapped, a whole
   create -> vote -> edit -> reset -> ask cycle runs, and every path touched
   must sit under the tmp NOODLE dir.
"""
import ast
import base64
import builtins
import io
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from noodle_helpers import make_poll  # noqa: E402

API = Path(__file__).resolve().parent.parent / "api"
sys.path.insert(0, str(API))

cryptography = pytest.importorskip("cryptography")
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402


def _app_modules() -> set[str]:
    mods = {p.stem for p in API.glob("*.py")}
    mods |= {p.name for p in API.iterdir() if p.is_dir() and (p / "__init__.py").exists()}
    mods |= {p.name for p in API.iterdir() if p.is_dir() and any(p.glob("*.py"))}
    return mods - {"noodle"}


def _imports(path: Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(), filename=str(path))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out += [(node.lineno, a.name) for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:  # relative import: stays inside the noodle package
                continue
            out.append((node.lineno, node.module or ""))
    return out


def test_app_module_list_is_real():
    mods = _app_modules()
    # sanity: the derivation actually finds the planner, board and TTS modules
    for m in ("helpers", "chat", "nudge", "morning", "routes_tts", "auth", "pages", "tarot", "mtg"):
        assert m in mods, m


def test_noodle_imports_no_app_module():
    app = _app_modules()
    files = sorted((API / "noodle").rglob("*.py"))
    assert files, "api/noodle has no python files?"
    bad = []
    for f in files:
        for line, mod in _imports(f):
            top = mod.split(".")[0]
            if top in app:
                bad.append(f"{f.relative_to(API)}:{line} imports {mod}")
    assert not bad, "noodle must stay standalone:\n" + "\n".join(bad)


def test_nothing_named_or_voiced_as_exec():
    """No Exec persona, no GLaDOS, no TTS anywhere in noodle's surface."""
    roots = [API / "noodle", API / "templates", API.parent / "web"]
    files = [p for r in roots for p in r.rglob("*") if p.is_file()
             and p.name.startswith(("noodle", "__init__", "config", "ask", "llm", "pages",
                                    "routes", "sig", "slots", "store", "votes"))
             and (p.parent.name == "noodle" or p.name.startswith("noodle"))]
    assert files
    for f in files:
        if f.suffix == ".woff2":
            continue
        low = f.read_text(errors="ignore").lower()
        for word in ("glados", "exec-voice", "hosaka", "/ws/hosaka", "speechsynthesis"):
            assert word not in low, f"{f.name} mentions {word}"


# ── storage audit ───────────────────────────────────────────────────────────
class _Audit:
    def __init__(self):
        self.paths: list[str] = []

    def wrap(self, fn):
        def inner(*a, **k):
            if a and isinstance(a[0], (str, bytes, os.PathLike)) and not isinstance(a[0], int):
                self.paths.append(os.path.abspath(os.fsdecode(a[0])))
            return fn(*a, **k)
        return inner


@pytest.fixture
def noodle_env(monkeypatch, tmp_path):
    from noodle import config
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "noodle")
    return tmp_path / "noodle"


def _sign(priv, slug, name, slots, ts):
    from noodle import sig
    pub = base64.b64encode(priv.public_key().public_bytes_raw()).decode()
    s = base64.b64encode(priv.sign(sig.canonical(slug, name, slots, ts))).decode()
    return {"name": name, "pub": pub, "slots": slots, "ts": ts, "sig": s}


def test_storage_touches_only_its_own_dir(noodle_env, monkeypatch):
    from noodle import ask, llm, store, votes

    audit = _Audit()
    monkeypatch.setattr(builtins, "open", audit.wrap(builtins.open))
    monkeypatch.setattr(io, "open", audit.wrap(io.open))  # pathlib's read/write path
    monkeypatch.setattr(os, "mkdir", audit.wrap(os.mkdir))
    monkeypatch.setattr(os, "scandir", audit.wrap(os.scandir))
    monkeypatch.setattr(os, "replace", audit.wrap(os.replace))
    monkeypatch.setattr(os, "rename", audit.wrap(os.rename))
    monkeypatch.setattr(os, "remove", audit.wrap(os.remove))
    monkeypatch.setattr(os, "unlink", audit.wrap(os.unlink))
    real_mkstemp = tempfile.mkstemp

    def mkstemp(*a, **k):
        audit.paths.append(os.path.abspath(k.get("dir") or tempfile.gettempdir()))
        return real_mkstemp(*a, **k)
    monkeypatch.setattr(tempfile, "mkstemp", mkstemp)
    monkeypatch.setattr(llm, "call", lambda system, user: {"reading": "x", "rules": [
        {"action": "add", "blocks": ["night"], "where": {"date": ["2026-10-01"]}}]})

    slug = make_poll(store, "audit", "2026-10-01", "2026-10-07")
    key = Ed25519PrivateKey.generate()
    now = votes.now_ms()
    body = _sign(key, slug, "Ada", ["2026-10-01:m"], now)
    votes.submit(slug, body)
    votes.submit(slug, _sign(key, slug, "Ada", ["2026-10-02:n"], now + 1))
    ask.ask(slug, {"text": "thursday night", "dates": ["2026-10-01"]}, "203.0.113.9")
    store.all_polls()
    votes.reset_voter(slug, "ada")

    assert audit.paths, "audit recorded nothing -- the wrappers are not in the path"
    root = os.path.abspath(noodle_env)
    outside = [p for p in audit.paths if not (p == root or p.startswith(root + os.sep))]
    assert not outside, f"noodle touched paths outside its dir: {outside}"
    assert all(p.parent.name == "polls" for p in noodle_env.rglob("*.json"))
