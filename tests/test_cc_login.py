"""Run the sidecar's panel sign-in tests (claude-box/login.test.mjs) in the suite.

Same wrapper shape as test_cc_sandbox_paths.py, and the same NOTE: point
`node --test` at the test FILE, never the directory -- that would execute
server.mjs (binds a port) and probe-tools.mjs (spends a real API call).
"""
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TEST_FILE = REPO / "claude-box" / "login.test.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_panel_sign_in():
    assert TEST_FILE.is_file(), f"{TEST_FILE} is missing"
    proc = subprocess.run(
        ["node", "--test", str(TEST_FILE)],
        cwd=REPO, capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
    # A green run that executed nothing would also return 0.
    passed = int(proc.stdout.split("# pass ")[1].split("\n")[0])
    assert passed >= 4, f"only {passed} sign-in tests ran — did one vanish?"
