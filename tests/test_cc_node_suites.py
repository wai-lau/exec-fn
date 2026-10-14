"""Run the sidecar's node test suites (claude-box/*.test.mjs) inside exec-fn's pytest.

exec-fn owns the test harness; the sidecar repo (submodule claude-box/) owns
only its suites (ARCHITECTURE.md §1e).

One test per suite, discovered, so a new `foo.test.mjs` is covered the day it
lands (uploads.test.mjs had no wrapper and never ran in the suite until this
replaced exec-fn's two per-file wrappers, 2026-10-14).

Each suite is passed EXPLICITLY: `node --test <dir>` would treat every .mjs in
the dir as a test file and execute server.mjs, which listens on a port.

The two suites below must never vanish quietly -- the sandbox path gate and
the panel sign-in are the sidecar's security edge (ARCHITECTURE.md).
"""
import shutil
import subprocess
from pathlib import Path

import pytest

BOX = Path(__file__).resolve().parents[1] / "claude-box"
SUITES = sorted(BOX.glob("*.test.mjs"))
MUST_HAVE = {"sandbox-paths.test.mjs", "login.test.mjs"}


def test_security_suites_present():
    missing = MUST_HAVE - {p.name for p in SUITES}
    assert not missing, f"{sorted(missing)} missing from {BOX} — the gate lost its tests (uninitialised submodule? `git submodule update --init`)"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
@pytest.mark.parametrize("suite", SUITES, ids=lambda p: p.name)
def test_node_suite(suite):
    r = subprocess.run(["node", "--test", str(suite)], cwd=BOX,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]
