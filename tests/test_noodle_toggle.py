"""Noodle's header/row toggle rules (web/noodle-toggle.js) and calendar
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


def test_weeks_are_the_minimum_sunday_first():
    w = cal("return M.weeks('2026-10-14','2026-11-03')")
    assert w[0][0] == "2026-10-11" and w[0][3] == "2026-10-14"   # Oct 14 2026 is a Wednesday
    assert w[-1][0] == "2026-11-01" and w[-1][-1] == "2026-11-07"
    assert len(w) == 4
    assert cal("return M.weeks('2026-10-11','2026-10-17').length") == 1
    assert all(len(r) == 7 for r in w)
    flat = [d for r in w for d in r]
    assert len(flat) == len(set(flat))


def test_groups_hold_only_in_window_slots():
    g = cal("const w=M.weeks('2026-10-14','2026-10-16'); return M.groups(w,'2026-10-14','2026-10-16',true)")
    assert g["cols"][3] == ["2026-10-14:m", "2026-10-14:n"]   # the one in-window Wednesday
    assert g["cols"][0] == []
    assert sum(len(r) for r in g["rows"]) == 6


@pytest.mark.parametrize("x,y,half", [
    (5, 5, "m"), (95, 55, "n"),        # the corners
    (50, 20, "m"), (50, 40, "n"),      # straight above / below the centre
    (80, 25, "n"), (20, 35, "m"),      # either side of a 30deg "/" line, not a 45deg one
])
def test_half_hit_test_follows_the_30deg_line(x, y, half):
    # a 100x60 cell, centre (50,30). On the line at x=80: y = 30 - 30*tan30 = 12.7,
    # so (80,25) is BELOW it (night) -- a 45deg split would have called it midday.
    assert cal(f"return M.half({x},{y},100,60)") == half
