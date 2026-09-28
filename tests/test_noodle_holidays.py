"""noodle/holidays.py is a Python MIRROR of web/qc-holidays.js (noodle may not
import the app). Pin the two against each other, year by year, through node."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle.holidays import qc_holidays  # noqa: E402

_JS = os.path.join(os.path.dirname(__file__), "..", "web", "qc-holidays.js")


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_python_mirror_matches_the_js_for_decades():
    years = list(range(2024, 2061))
    out = subprocess.run(
        ["node", "-e", f"global.window={{}};require({json.dumps(os.path.abspath(_JS))});"
                       f"console.log(JSON.stringify({json.dumps(years)}.map(y => [...window.QcHolidays.qcHolidays(y)].sort())))"],
        capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    for y, want in zip(years, js):
        assert sorted(d.isoformat() for d in qc_holidays(y)) == want, y


def test_known_2026_dates():
    names = {d.isoformat(): n for d, n in qc_holidays(2026).items()}
    assert names["2026-10-12"] == "Action de grace"
    assert names["2026-04-03"] == "Vendredi saint"
    assert names["2026-05-18"] == "Journee nationale des patriotes"
    assert "2026-11-11" not in names   # Remembrance Day is not a Quebec holiday
