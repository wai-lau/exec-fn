"""exec-fn owns every lint, hook and check; a sub repo carries only the shim
(ARCHITECTURE.md §1e). These pin the three things that make that true:

1. each shimmed sub repo's scripts/pre-commit is a VERBATIM copy of
   scripts/subrepo-pre-commit (a drifted copy is a second methodology);
2. each one gitignores .exec-fn/, where a standalone clone pulls the tooling;
3. every path in scripts/tooling-paths.txt exists here -- a lint that reads a
   file not on the list fails only in a standalone clone, far from this repo.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SHIM = ROOT / "scripts" / "subrepo-pre-commit"
SHIMMED = ["apps/spire", "apps/noodle", "claude-box"]


def _repo(rel):
    d = ROOT / rel
    if not (d / ".git").exists():
        pytest.skip(f"{rel} not initialised (git submodule update --init)")
    return d


@pytest.mark.parametrize("rel", SHIMMED)
def test_shim_is_the_canonical_copy(rel):
    copy = _repo(rel) / "scripts" / "pre-commit"
    assert copy.is_file(), f"{rel} has no scripts/pre-commit shim"
    assert copy.read_bytes() == SHIM.read_bytes(), (
        f"{rel}/scripts/pre-commit drifted from exec-fn scripts/subrepo-pre-commit "
        "-- copy it over verbatim; checks belong in exec-fn's scripts/pre-commit")


@pytest.mark.parametrize("rel", SHIMMED)
def test_tooling_copy_is_gitignored(rel):
    ignore = (_repo(rel) / ".gitignore").read_text().split()
    assert "/.exec-fn/" in ignore or ".exec-fn/" in ignore, f"{rel}/.gitignore lacks /.exec-fn/"


def test_tooling_paths_exist():
    lines = (ROOT / "scripts" / "tooling-paths.txt").read_text().splitlines()
    paths = [ln.strip() for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]
    assert paths
    missing = [p for p in paths if not (ROOT / p.lstrip("/")).exists()]
    assert not missing, f"tooling-paths.txt names files exec-fn does not have: {missing}"
