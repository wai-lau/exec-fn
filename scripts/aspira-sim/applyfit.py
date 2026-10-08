#!/usr/bin/env python3
"""Write a tierfit.mjs result (FIT_JSON) into the game's tables (owner, 2026-10-08 overnight loop).
Each axis's fitted tier values replace tiers I..V of its own lever table; a tier never ends below the
one before it (fit noise), and only tiers whose fit landed closer to target than the current value move.
usage: python3 applyfit.py fit.json [--skip breach,...]"""
import json, re, sys
ROOT = "/home/wai/src/exec-fn/"
# axis -> (file, table name, field or None for a plain array)
TABLES = {
    "conductivity": ("web/aspira-skills.js", "ARC_CONDUCTIVITY", "d"), "voltage": ("web/aspira-skills.js", "ARC_VOLTAGE_DMG", None),
    "capacitance": ("web/aspira-skills.js", "ARC_CAPACITANCE", "frac"), "rime": ("web/aspira-skills.js", "FRZ_RIME", None),
    "temp": ("web/aspira-skills.js", "FRZ_TEMP_SLOW", None), "moons": ("web/aspira-skills.js", "FRZ_MOON_BY", None),
    "focus": ("web/aspira-skills.js", "SOL_FOCUS_DMG", None), "refraction": ("web/aspira-skills.js", "SOL_HOP", None),
    "breach": ("web/aspira-skills.js", "SOL_BREACH_ARMOR", None), "corrosion": ("web/aspira-acid.js", "ACD_CORROSION_DMG", None),
    "spray": ("web/aspira-acid.js", "ACD_SPRAY_MUL", None), "contagion": ("web/aspira-acid.js", "ACD_PUDDLE_HEAT", None),
}
def array_span(src, name):
    m = re.search(r"\b" + name + r"\s*=\s*\[", src); assert m, name
    i = m.end() - 1; depth = 0
    for j in range(i, len(src)):
        if src[j] == "[": depth += 1
        elif src[j] == "]":
            depth -= 1
            if depth == 0: return i, j + 1
    raise ValueError(name)
fit = json.load(open(sys.argv[1])); skip = set(sys.argv[3].split(",")) if len(sys.argv) > 3 and sys.argv[2] == "--skip" else set()
by = {}
for c in fit: by.setdefault(c["axis"], []).append(c)
changed = []
for axis, cs in by.items():
    if axis in skip or axis not in TABLES: continue
    path, name, field = TABLES[axis]; src = open(ROOT + path).read(); a, b = array_span(src, name); lit = src[a:b]
    cs.sort(key=lambda c: c["k"]); vals = []
    for c in cs:  # keep the current value where the fit did not land closer to target
        better = abs(c["pct"] - c["target"]) < abs(c["now"] - c["target"])
        vals.append(c["v"] if better else c["cur"])
    if field is None:
        items = [x.strip() for x in lit[1:-1].split(",")]
        base = float(items[0]); out = [items[0]]; prev = base
        for v in vals: v = max(v, prev); out.append(str(round(v, 3))); prev = v
        new = "[" + ", ".join(out) + "]"
    else:
        objs = re.findall(r"\{[^}]*\}|null", lit); assert len(objs) == 6, (name, len(objs))
        prev = None; out = [objs[0]]
        m0 = re.search(field + r":\s*([0-9.]+)", objs[0]); prev = float(m0.group(1)) if m0 else 0
        for o, v in zip(objs[1:], vals):
            v = max(v, prev); prev = v
            out.append(re.sub(field + r":\s*[0-9.]+", f"{field}: {round(v, 3)}", o))
        new = "[" + ", ".join(out) + "]"
    if new != lit:
        src = src[:a] + new + src[b:]; open(ROOT + path, "w").write(src); changed.append(f"{name}: {lit} -> {new}")
for line in changed: print(line)
# cache-bust every file touched
tmpl = open(ROOT + "api/templates/aspira.html").read()
for f in sorted({TABLES[a][0] for a in by if a not in skip and a in TABLES}):
    base = f.split("/")[-1]
    if any(TABLES[a][0] == f for a in by if any(base in l for l in []) or True):
        tmpl = re.sub(re.escape(base) + r"\?v=(\d+)", lambda m: base + "?v=" + str(int(m.group(1)) + 1), tmpl)
open(ROOT + "api/templates/aspira.html", "w").write(tmpl)
print(f"{len(changed)} tables changed")
