"""Re-expressing picks when the host splits or joins the days must agree
between the browser (ndhConvert in web/noodle-host.js, which redraws the page
before Commit) and the server (noodle.slots.convert, which rewrites every
stored vote on the settings change). A disagreement shows one set of dots
before Commit and another after.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle.slots import convert  # noqa: E402

_JS = os.path.join(os.path.dirname(__file__), "..", "web", "noodle-host.js")

CASES = [
    [], ["2026-10-01:d"], ["2026-10-01:d", "2026-10-02:d"],
    ["2026-10-01:m"], ["2026-10-01:n"], ["2026-10-01:m", "2026-10-01:n"],
    ["2026-10-01:m", "2026-10-01:n", "2026-10-02:m"],
    # mixed forms never come from the page, but the two must still agree
    ["2026-10-01:d", "2026-10-02:m"], ["2026-10-01:d", "2026-10-01:m", "2026-10-02:n"],
]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
@pytest.mark.parametrize("halves", [True, False])
def test_browser_and_server_convert_identically(halves):
    # a global eval, so the file's top-level functions become globals as in a
    # page; the stubs let its setup code find no split box and return
    js = (f"global.window={{addEventListener(){{}}}};global.document={{getElementById(){{return null}}}};"
          f"(0,eval)(require('fs').readFileSync({json.dumps(os.path.abspath(_JS))},'utf8'));"
          f"console.log(JSON.stringify({json.dumps(CASES)}.map(c => "
          f"[...ndhConvert(new Set(c), {json.dumps(halves)})].sort())))")
    out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    diffs = {json.dumps(c): (convert(c, halves), j) for c, j in zip(CASES, out) if convert(c, halves) != j}
    assert not diffs, f"browser vs server split conversion differs: {diffs}"
