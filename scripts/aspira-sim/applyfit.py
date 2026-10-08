#!/usr/bin/env python3
"""Write a tierfit.mjs result (FIT_JSON) into the game's tables (owner, 2026-10-08 overnight loop).

Each axis's fitted tier values replace tiers I..V of its own lever table. Only tiers whose fit landed
closer to target than the current value move. A tier is NOT forced above the one before it: a tier may
add more, weaker items (jets, beams, moons) and the fit's targets already rise.
usage: python3 applyfit.py fit.json [--skip breach,...]
"""
import json
import re
import sys

ROOT = "/home/wai/src/exec-fn/"
# axis -> (file, table name, field or None for a plain array)
TABLES = {
    "conductivity": ("web/aspira-skills.js", "ARC_CONDUCTIVITY", "d"),
    "voltage": ("web/aspira-skills.js", "ARC_VOLTAGE_DMG", None),
    "capacitance": ("web/aspira-skills.js", "ARC_CAPACITANCE", "frac"),
    "rime": ("web/aspira-skills.js", "FRZ_RIME", None),
    "temp": ("web/aspira-skills.js", "FRZ_TEMP_SLOW", None),
    "moons": ("web/aspira-skills.js", "FRZ_MOON_BY", None),
    "focus": ("web/aspira-skills.js", "SOL_FOCUS_DMG", None),
    "refraction": ("web/aspira-skills.js", "SOL_HOP", None),
    "breach": ("web/aspira-skills.js", "SOL_BREACH_ARMOR", None),
    "corrosion": ("web/aspira-acid.js", "ACD_CORROSION_DMG", None),
    "spray": ("web/aspira-acid.js", "ACD_SPRAY_MUL", None),
    "contagion": ("web/aspira-acid.js", "ACD_PUDDLE_HEAT", None),
    "refrcone": ("web/aspira-skills.js", "SOL_CONE_BY", None),
    "contslow": ("web/aspira-acid.js", "ACD_CONTAGION_SLOW", None),
}  # (tempreach, SKILL_MOVE.frz.temp, is a nested table: applied by hand)


def array_span(src, name):
    m = re.search(r"\b" + name + r"\s*=\s*\[", src)
    assert m, name
    depth = 0
    for j in range(m.end() - 1, len(src)):
        if src[j] == "[":
            depth += 1
        elif src[j] == "]":
            depth -= 1
            if depth == 0:
                return m.end() - 1, j + 1
    raise ValueError(name)


def main():
    fit = json.load(open(sys.argv[1]))
    skip = set(sys.argv[3].split(",")) if len(sys.argv) > 3 and sys.argv[2] == "--skip" else set()
    by = {}
    for c in fit:
        by.setdefault(c["axis"], []).append(c)
    changed, files = [], set()
    for axis, cs in by.items():
        if axis in skip or axis not in TABLES:
            continue
        path, name, field = TABLES[axis]
        src = open(ROOT + path).read()
        a, b = array_span(src, name)
        lit = src[a:b]
        cs.sort(key=lambda c: c["k"])
        vals = [c["v"] if abs(c["pct"] - c["target"]) < abs(c["now"] - c["target"]) else c["cur"] for c in cs]
        if field is None:
            items = [x.strip() for x in lit[1:-1].split(",")]
            new = "[" + ", ".join([items[0]] + [str(round(v, 3)) for v in vals]) + "]"
        else:
            objs = re.findall(r"\{[^}]*\}|null", lit)
            assert len(objs) == 6, (name, len(objs))
            out = [objs[0]] + [re.sub(field + r":\s*[0-9.]+", f"{field}: {round(v, 3)}", o) for o, v in zip(objs[1:], vals)]
            new = "[" + ", ".join(out) + "]"
        if new != lit:
            open(ROOT + path, "w").write(src[:a] + new + src[b:])
            changed.append(f"{name}: {lit} -> {new}")
            files.add(path.split("/")[-1])
    for line in changed:
        print(line)
    tmpl = open(ROOT + "api/templates/aspira.html").read()
    for base in files:  # cache-bust every file touched
        tmpl = re.sub(re.escape(base) + r"\?v=(\d+)", lambda m, b=base: b + "?v=" + str(int(m.group(1)) + 1), tmpl)
    open(ROOT + "api/templates/aspira.html", "w").write(tmpl)
    print(f"{len(changed)} tables changed")


if __name__ == "__main__":
    main()
