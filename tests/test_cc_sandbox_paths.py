"""Run the sidecar's sandbox path-gate tests as part of the normal suite.

The gate itself is JS (it runs inside the sidecar), and its tests are
`node --test`. Without this wrapper they would only ever run when someone
remembered to, which for a containment check is the same as not having them.

NOTE the explicit file argument: `node --test claude-box/` treats every .mjs in
the directory as a test file, which means EXECUTING server.mjs (binds a port)
and probe-tools.mjs (spends a real API call). Point it at the test file.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TEST_FILE = REPO / "claude-box" / "sandbox-paths.test.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_sandbox_path_gate():
    assert TEST_FILE.is_file(), f"{TEST_FILE} is missing — the gate lost its tests"
    proc = subprocess.run(
        ["node", "--test", str(TEST_FILE)],
        cwd=REPO, capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, (
        "sidecar sandbox path gate FAILED — an escape case is passing.\n"
        + proc.stdout[-4000:] + proc.stderr[-2000:]
    )
    # A green run that executed nothing would also return 0.
    assert "# pass " in proc.stdout, f"no test counts in output:\n{proc.stdout[-2000:]}"
    passed = int(proc.stdout.split("# pass ")[1].split("\n")[0])
    assert passed >= 13, f"only {passed} path-gate assertions ran — did a test vanish?"
