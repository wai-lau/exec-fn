"""noodle's header/row toggle rules (web/noodle-toggle.js) and calendar
geometry (web/noodle-cal.js), unit-tested in isolation through node.

Rules under test: the group buttons are a MODE (pencil = fill, eraser =
clear), flipped all at once by the corner -- never a reading of the cells.
"""
import json
import os
import shutil
import subprocess

import pytest

_WEB = os.path.join(os.path.dirname(__file__), "..", "web")
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def js(expr: str, module: str = "noodle-toggle.js", glob: str = "NoodleToggle"):
    # the repo's package.json is "type":"module", so these browser scripts load
    # as ESM with no CommonJS exports -- read what they hang on `window` instead
    path = os.path.abspath(os.path.join(_WEB, module))
    out = subprocess.run(
        ["node", "-e", f"global.window={{}};require({json.dumps(path)});const M=window.{glob};"
                       f"console.log(JSON.stringify((()=>{{{expr}}})()))"],
        capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


G = '["a:m","a:n","b:m","b:n"]'


@pytest.mark.parametrize("mode,action", [("fill", "on"), ("clear", "off")])
def test_a_button_does_what_its_MODE_says_whatever_the_cells_hold(mode, action):
    assert js(f"return M.modeAction({json.dumps(mode)})") == action
    for sel in ("[]", "['a:m']", G):   # empty, mixed, full: never consulted
        got = js(f"return [...M.apply({G}, new Set({sel}), M.modeAction({json.dumps(mode)}))].sort()")
        assert got == (["a:m", "a:n", "b:m", "b:n"] if action == "on" else [])


def test_the_corner_flips_the_mode_back_and_forth():
    assert js("return [M.flipMode('fill'), M.flipMode('clear'), M.flipMode(M.flipMode('fill'))]") == \
        ["clear", "fill", "fill"]


def test_apply_leaves_other_slots_and_does_not_mutate():
    assert js(f"const s=new Set(['x:n']); const r=M.apply({G}, s, 'on'); return [[...s], r.has('x:n')]") == [["x:n"], True]


@pytest.mark.parametrize("mode,label", [("fill", "Available Wednesdays"), ("clear", "Not available Wednesdays")])
def test_labels_name_the_action(mode, label):
    assert js(f"return M.label(M.colSubject(3), {json.dumps(mode)})") == label
    assert js(f"return M.label(M.rowSubject('2026-03-01'), {json.dumps(mode)})").endswith("week of Mar 1")


# ── calendar geometry ─────────────────────────────────────────────────────
def cal(expr):
    return js(expr, "noodle-cal.js", "NoodleCalParts")


def test_weeks_run_from_a_sunday_and_go_on():
    assert cal("return M.sunday('2026-10-14')") == "2026-10-11"
    assert cal("return M.sunday('2026-10-11')") == "2026-10-11"
    w = cal("return M.weeksFrom('2026-12-27', 3)")
    assert w[0] == [f"2026-12-{d}" for d in range(27, 32)] + ["2027-01-01", "2027-01-02"]
    assert w[2][6] == "2027-01-16" and all(len(r) == 7 for r in w)


def test_a_row_carries_its_month_and_year_for_the_watermark():
    html = cal("return M.rowHtml(M.weeksFrom('2026-12-27', 1)[0], 0, {from: '2026-01-01', to: null}, 'x')")
    # a week belongs to the month of its Wednesday: Dec 30 2026
    assert 'data-month="12"' in html and 'data-year="2026"' in html
    assert "nd-edge" not in html   # boundaries are one SVG path, drawn by the view


def test_past_days_and_days_outside_a_crop_are_out():
    html = cal("return M.rowHtml(M.weeksFrom('2026-10-11', 1)[0], 0, {from: '2026-10-13', to: '2026-10-15'}, 'x')")
    days = __import__("re").findall(r'class="([^"]*)" data-day="([\d-]+)"', html)
    assert [d for cls, d in days if "out" not in cls] == ["2026-10-13", "2026-10-14", "2026-10-15"]


def test_groups_grow_week_by_week_and_hold_only_open_slots():
    g = cal("""const g={cols:[[],[],[],[],[],[],[]],rows:[]}, b={from:'2026-10-14',to:null};
      M.weeksFrom('2026-10-11', 2).forEach(w => M.groupAdd(g, w, b, false)); return g""")
    assert g["cols"][3] == ["2026-10-14:d", "2026-10-21:d"]    # Wednesdays, both loaded weeks
    assert g["cols"][0] == ["2026-10-18:d"]                    # the 11th is before 'from'
    assert [len(r) for r in g["rows"]] == [4, 7]
    split = cal("""const g={cols:[[],[],[],[],[],[],[]],rows:[]};
      M.groupAdd(g, M.weeksFrom('2026-10-11',1)[0], {from:'2026-10-17',to:null}, true); return g.rows[0]""")
    assert split == ["2026-10-17:m", "2026-10-17:n"]


@pytest.mark.parametrize("x,y,half", [
    (5, 5, "m"), (95, 55, "n"),        # the corners
    (50, 20, "m"), (50, 40, "n"),      # straight above / below the centre
    (80, 25, "n"), (20, 35, "m"),      # either side of a 30deg "/" line, not a 45deg one
])
def test_half_hit_test_follows_the_30deg_line(x, y, half):
    # a 100x60 cell, centre (50,30). On the line at x=80: y = 30 - 30*tan30 = 12.7,
    # so (80,25) is BELOW it (night) -- a 45deg split would have called it midday.
    assert cal(f"return M.half({x},{y},100,60)") == half
