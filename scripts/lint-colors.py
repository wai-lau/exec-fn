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
  5. NO RAW LITERAL -- no hardcoded colour literal (rgb/rgba/hex, or an
     hsl()/hsla() NOT of the token form hsl(var(--X-hsl))). The current set is
     grandfathered in scripts/raw-color-baseline.json; a NEW raw literal is
     rejected.
  6. NO NAMED COLOUR -- a CSS named colour (red/white/gold/...) in a colour
     property is rejected outright (there are none to grandfather). Checked in
     web/*.css declarations + template inline style="" attrs; token names like
     --green-hsl are NOT misread (var()/functions/url()/hex stripped first).
     `transparent`/`currentcolor` stay allowed (CSS-wide keywords, not names).

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
RAW_BASELINE = ROOT / "scripts/raw-color-baseline.json"
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

# Raw colour literals: rgb/rgba/hex, and hsl/hsla NOT of the token form
# hsl(var(--X-hsl) ...). Named colours are not matched (transparent/currentcolor
# are keywords; other names are rare + low-risk).
_RAW_COLOR = re.compile(
    r"#[0-9a-fA-F]{3,8}\b"
    r"|rgba?\(\s*(?!var\()[^)]*\)"
    r"|hsla?\(\s*(?!var\()[^)]*\)"
)

# CSS named colours (the 148 keywords). A bare one in a colour property is a raw
# literal; there are ZERO in the tree, so they're banned outright (no baseline).
# `transparent`/`currentcolor` are CSS-wide keywords, deliberately NOT included.
NAMED_COLORS = {
    "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque",
    "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood",
    "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk",
    "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray",
    "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen",
    "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
    "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise",
    "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue",
    "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite",
    "gold", "goldenrod", "gray", "green", "greenyellow", "grey", "honeydew",
    "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush",
    "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
    "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink",
    "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
    "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen",
    "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid",
    "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen",
    "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose",
    "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
    "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise",
    "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue",
    "purple", "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown",
    "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue",
    "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue", "tan",
    "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white",
    "whitesmoke", "yellow", "yellowgreen",
}
# properties whose value carries a colour (so a bare named colour there is real).
COLOR_PROPS = {
    "color", "background", "background-color", "background-image", "border",
    "border-color", "border-top", "border-right", "border-bottom", "border-left",
    "border-top-color", "border-right-color", "border-bottom-color",
    "border-left-color", "outline", "outline-color", "box-shadow", "text-shadow",
    "fill", "stroke", "caret-color", "text-decoration-color", "column-rule-color",
}
_DECL = re.compile(r"([\w-]+)\s*:\s*([^;{}]+)")
_STYLE_ATTR = re.compile(r'style\s*=\s*"([^"]*)"')
# strip token refs + colour/maths functions + url() + hex so only bare words remain
_STRIP_FUNCS = re.compile(
    r"var\([^)]*\)|url\([^)]*\)|#[0-9a-fA-F]{3,8}"
    r"|(?:hsla?|rgba?|hwb|lab|lch|oklab|oklch|color-mix|calc|min|max|clamp)\([^)]*\)"
)


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


def _norm_color(lit):
    return re.sub(r"\s+", "", lit).lower()  # "rgba(0, 0, 0, .5)" -> "rgba(0,0,0,.5)"


def raw_colors():
    """Normalized raw colour literals across the scanned files."""
    out = set()
    for p in _scan_paths():
        for m in _RAW_COLOR.finditer(_strip_comments(p.read_text())):
            out.add(_norm_color(m.group(0)))
    return out


def _named_in(value):
    """A bare CSS named colour left in a value once tokens/functions/url()/hex
    are stripped (so `hsl(var(--green-hsl))` is NOT read as the colour 'green')."""
    for w in re.findall(r"[a-z]+", _STRIP_FUNCS.sub("", value.lower())):
        if w in NAMED_COLORS:
            return w
    return None


def named_color_errors():
    """CSS named colour in a colour property -- web/*.css declarations + template
    inline style="" attrs. There are none in the tree, so any hit is new."""
    errors = []
    for p in sorted(ROOT.glob("web/*.css")):
        for m in _DECL.finditer(_strip_comments(p.read_text())):
            if m.group(1).strip().lower() in COLOR_PROPS and (w := _named_in(m.group(2))):
                errors.append(f"{p.name}: {m.group(1).strip()}: named colour '{w}' "
                              f"-- use a palette token hsl(var(--X-hsl) / α).")
    for p in sorted(ROOT.glob("api/templates/*.html")):
        for sm in _STYLE_ATTR.finditer(p.read_text()):
            for m in _DECL.finditer(sm.group(1)):
                if m.group(1).strip().lower() in COLOR_PROPS and (w := _named_in(m.group(2))):
                    errors.append(f"{p.name}: inline style named colour '{w}' "
                                  f"-- use a palette token.")
    return errors


def _load_baseline():
    data = json.loads(BASELINE.read_text())
    return {k: set(v) for k, v in data.items()}


def update():
    cur = usage()
    payload = {k: sorted(v, key=float) for k, v in sorted(cur.items())}
    BASELINE.write_text(json.dumps(payload, indent=2) + "\n")
    raw = sorted(raw_colors())
    RAW_BASELINE.write_text(json.dumps({"raw_colors": raw}, indent=2) + "\n")
    pairs = sum(len(v) for v in cur.values())
    print(f"wrote {BASELINE.relative_to(ROOT)}: {len(cur)} colors, {pairs} (color, alpha) pairs")
    print(f"wrote {RAW_BASELINE.relative_to(ROOT)}: {len(raw)} grandfathered raw colour literals")
    return 0


def _token_errors(baseline, defined, cur):
    """Guards 1-4: per-token alpha count, on-scale, in-baseline, and defined."""
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
                    f"baseline. If intended, eyeball /UI then re-run with --update."
                )
        if token not in defined:
            errors.append(
                f"--{token}: referenced but not defined in chrome.css or LOCAL_ACCENTS."
            )
    return errors


def _raw_color_errors():
    """Guard 5: the current raw-colour literals are frozen; reject any new one."""
    allowed = set()
    if RAW_BASELINE.exists():
        allowed = set(json.loads(RAW_BASELINE.read_text()).get("raw_colors", []))
    return [
        f"raw colour literal '{lit}' -- use a palette token hsl(var(--X-hsl) / α). "
        f"If deliberate, re-run with --update."
        for lit in sorted(raw_colors()) if lit not in allowed
    ]


def check():
    if not BASELINE.exists():
        print(f"no baseline at {BASELINE.relative_to(ROOT)} -- run: "
              f"python3 scripts/lint-colors.py --update")
        return 1
    errors = _token_errors(_load_baseline(), _defined_tokens(), usage())
    errors += _raw_color_errors()
    errors += named_color_errors()
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
