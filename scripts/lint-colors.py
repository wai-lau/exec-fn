#!/usr/bin/env python3
"""Palette-discipline linter -- no new colors or alphas.

The hued palette lives in web/chrome.css as `--<name>-hsl` channel tokens,
consumed everywhere as `hsl(var(--<name>-hsl) / <alpha>)` (a bare `var(--X-hsl)`
is alpha 1). The allowed `(colour, alpha)` pairs are NOT hand-listed -- they are
DERIVED from actual usage, the same extraction `/api/color/usage` feeds the
/color moodboard, and frozen into scripts/palette-baseline.json. This guards:

  1. ON-SCALE ALPHA -- every alpha is on chrome.css's snap scale
     {0, 0.06, 0.12, 0.25, 0.45, 0.6, 0.8, 1}; no freehand opacities.
  2. MAX 4 PER COLOUR -- each token uses at most 4 NON-ZERO alpha steps.
  3. NO NEW TUPLE   -- every `(token, alpha)` pair already exists in the baseline.
     A pair the baseline doesn't have (a brand-new alpha for a colour, or a
     brand-new colour token) is rejected.
  4. DEFINED TOKEN  -- every `var(--<name>-hsl)` referenced is defined in
     chrome.css :root (or a whitelisted page-local accent).

Adding a colour or an alpha is a deliberate act: make the change, eyeball it on
/color, then regenerate the baseline with `python3 scripts/lint-colors.py
--update` and commit it. The diff records exactly which (colour, alpha) pairs
entered the palette.

Run:     python3 scripts/lint-colors.py            (exit 1 on any violation)
Update:  python3 scripts/lint-colors.py --update   (rewrite the baseline)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "scripts/palette-baseline.json"
CHROME = "web/chrome.css"

# chrome.css's documented alpha snap scale (see its palette header). The one
# place a brand-new opacity *value* may originate; per-colour subsets are
# derived from usage, never hand-forced here.
SNAP_SCALE = {0.0, 0.06, 0.12, 0.25, 0.45, 0.6, 0.8, 1.0}

# Page-local `--*-hsl` accents allowed outside chrome.css (deliberate, recorded).
LOCAL_ACCENTS = {"ember-hsl"}

# Same file set + extraction as the /api/color/usage endpoint (routes_views.py):
# templates + web (the /app/static mount) + main.py, chrome.css :root stripped,
# bare `var(--X-hsl)` = alpha 1. Kept in lockstep so the baseline and the live
# moodboard never disagree.
_USE = re.compile(r"var\(--([\w-]+-hsl)\)(?:\s*/\s*([\d.]+))?")
_DEF = re.compile(r"--([a-z0-9-]+-hsl)\s*:")


def _scan_paths():
    paths = sorted(ROOT.glob("api/templates/*.html"))
    for g in ("web/*.html", "web/*.css", "web/*.js"):
        paths += sorted(ROOT.glob(g))
    paths.append(ROOT / "api/main.py")
    return [p for p in paths if "/vendor/" not in p.as_posix() and p.exists()]


def _akey(a):
    return f"{float(a):g}"  # "0.45", "1", "0" -- stable comparable alpha key


def _strip_comments(text):
    """Drop block + HTML comments so example/placeholder tokens in prose (e.g.
    chrome.css's `hsl(var(--X-hsl) / α)`) aren't counted as real usage. The one
    deliberate divergence from /api/color/usage, which scans raw; harmless since
    /color only renders tokens actually defined in chrome.css :root anyway."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def usage():
    """Per-token used alphas {token: {alpha_key}}, mirroring /api/color/usage."""
    out = {}
    for p in _scan_paths():
        text = _strip_comments(p.read_text())
        if p.name == "chrome.css":
            text = re.sub(r":root\s*\{[^}]*\}", "", text)  # drop definitions
        for m in _USE.finditer(text):
            a = m.group(2) if m.group(2) else "1"
            out.setdefault(m.group(1), set()).add(_akey(a))
    return out


def _defined_tokens():
    tokens = set()
    for p in _scan_paths():
        if p.suffix in (".css", ".html"):
            tokens.update(_DEF.findall(_strip_comments(p.read_text())))
    return tokens | LOCAL_ACCENTS


def _load_baseline():
    data = json.loads(BASELINE.read_text())
    return {k: set(v) for k, v in data.items()}


def update():
    cur = usage()
    payload = {k: sorted(v, key=float) for k, v in sorted(cur.items())}
    BASELINE.write_text(json.dumps(payload, indent=2) + "\n")
    pairs = sum(len(v) for v in cur.values())
    print(f"wrote {BASELINE.relative_to(ROOT)}: {len(cur)} colors, {pairs} (color, alpha) pairs")
    return 0


def check():
    if not BASELINE.exists():
        print(f"no baseline at {BASELINE.relative_to(ROOT)} -- run: "
              f"python3 scripts/lint-colors.py --update")
        return 1
    baseline = _load_baseline()
    defined = _defined_tokens()
    cur = usage()
    errors = []

    for token in sorted(cur):
        nonzero = sorted((a for a in cur[token] if float(a) != 0), key=float)
        if len(nonzero) > 4:
            errors.append(
                f"--{token}: {len(nonzero)} non-zero alphas {nonzero} -- a colour may "
                f"use at most 4. Merge one onto a neighbour."
            )
        for a in sorted(cur[token], key=float):
            if float(a) not in SNAP_SCALE:
                errors.append(
                    f"--{token} / {a}: freehand alpha (off the snap scale "
                    f"{sorted(SNAP_SCALE)})."
                )
            if a not in baseline.get(token, set()):
                errors.append(
                    f"--{token} / {a}: new (color, alpha) tuple, not in the palette "
                    f"baseline. If intended, eyeball /color then re-run with --update."
                )
        if token not in defined:
            errors.append(
                f"--{token}: referenced but not defined in chrome.css or LOCAL_ACCENTS."
            )

    if errors:
        print("palette lint: %d violation(s)" % len(errors))
        for e in errors:
            print("  " + e)
        return 1
    print("palette lint: ok (no new colors or alphas)")
    return 0


def main(argv):
    if "--update" in argv:
        return update()
    return check()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
