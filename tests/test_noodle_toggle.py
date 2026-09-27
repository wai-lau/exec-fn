"""Noodle's header/row toggle rules (web/noodle-toggle.js) and calendar
geometry (web/noodle-cal.js), unit-tested in isolation through node.

Rules under test (ONE button per group):
  click: all off -> all on (check); all on OR mixed -> all off (cross)
  label: all off "Available X" / on or mixed "Not available X"
  out-of-window days never belong to a group
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


@pytest.mark.parametrize("sel,state", [
    ('["a:m","a:n","b:m","b:n"]', "on"),
    ("[]", "off"),
    ('["a:m"]', "mixed"),
    ('["a:m","a:n","b:m","zz:m"]', "mixed"),   # a slot outside the group does not count
])
def test_group_state(sel, state):
    assert js(f"return M.groupState({G}, new Set({sel}))") == state


def test_empty_group_is_inert():
    assert js("return M.groupState([], new Set(['a:m']))") == "none"
    assert js("return M.label('Wednesdays', 'none')") == ""


@pytest.mark.parametrize("state,action", [("on", "off"), ("off", "on"), ("mixed", "off")])
def test_click_rule(state, action):
    assert js(f"return M.clickAction({json.dumps(state)})") == action


def test_click_applies_to_whole_group_and_leaves_others():
    on = js(f"return [...M.apply({G}, new Set(['a:m','x:n']), 'on')].sort()")
    assert on == ["a:m", "a:n", "b:m", "b:n", "x:n"]
    off = js(f"return [...M.apply({G}, new Set(['a:m','b:n','x:n']), 'off')]")
    assert off == ["x:n"]


def test_apply_does_not_mutate_input():
    assert js(f"const s=new Set(['a:m']); M.apply({G}, s, 'on'); return [...s]") == ["a:m"]


@pytest.mark.parametrize("state,label", [
    ("on", "Not available Wednesdays"),
    ("off", "Available Wednesdays"),
    ("mixed", "Not available Wednesdays"),
])
def test_column_labels(state, label):
    assert js(f"return M.label(M.colSubject(3), {json.dumps(state)})") == label


def test_row_labels():
    assert js("return M.label(M.rowSubject('2026-03-01'), 'on')") == "Not available week of Mar 1"
    assert js("return M.label(M.rowSubject('2026-03-01'), 'off')") == "Available week of Mar 1"
    assert js("return M.label(M.rowSubject('2026-03-01'), 'mixed')") == "Not available week of Mar 1"


def test_full_cycle_from_mixed():
    # mixed -> click -> all off -> click -> all on -> click -> all off
    r = js(f"""let s=new Set(['a:m']); const out=[];
      for (let i=0;i<3;i++) {{ s=M.apply({G}, s, M.clickAction(M.groupState({G}, s)));
        out.push(M.groupState({G}, s)); }} return out""")
    assert r == ["off", "on", "off"]


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
    g = cal("const w=M.weeks('2026-10-14','2026-10-16'); return M.groups(w,'2026-10-14','2026-10-16')")
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
