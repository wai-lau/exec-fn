#!/usr/bin/env python3
"""Scale-discipline linter -- no new off-scale structural values.

The sibling of lint-colors.py. Where the palette lint guards colour/alpha, this
guards every OTHER design choice: spacing, radius, type size/weight/line-height/
letter-spacing, and font-family. The scale tokens live in web/chrome.css
(`--space-*`, `--radius-*`, `--fs-*`, `--fw-*`, `--lh-*`, `--tracking-*`,
`--font-*`); every governed property must reference one, not a raw literal.

A GOVERNED property using a raw value (`padding: 5px`, `font-size: 0.63rem`,
`font-family: 'Some Font'`) is rejected -- snap it to the nearest token, or run
scripts/scale-codemod.py. Allowed raw, per property: `0`, `var(...)`,
`calc()/min()/max()/clamp()` (deliberate one-offs), `%` + viewport units, and
the CSS-wide keywords (`inherit/auto/none/normal/unset/...`). font-family also
allows a bare generic (`monospace/sans-serif/serif`).

NOT governed (intentionally left raw): border-width (lives in the `border`
shorthand with style+colour), transition/animation durations, z-index (semantic
+ local stacking), box-shadow, and width/height/inset layout dimensions. Those
have tokens available in chrome.css but aren't enforced here.

Scope: web/*.css (the stylesheet layer). Inline one-liner styles in templates
are a separate, minor surface already constrained by the no-inline-CSS rule.

Run: python3 scripts/lint-scale.py            (exit 1 on any violation)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Governed property -> the token family a raw value should have snapped to.
LENGTH_LIST = {"padding", "padding-top", "padding-right", "padding-bottom",
               "padding-left", "margin", "margin-top", "margin-right",
               "margin-bottom", "margin-left", "gap", "row-gap", "column-gap",
               "border-radius"}
SINGLE = {"font-size": "--fs-*", "line-height": "--lh-*",
          "letter-spacing": "--tracking-*", "font-weight": "--fw-*"}
GOVERNED = LENGTH_LIST | set(SINGLE) | {"font-family"}
# a positive fixed length (px/rem) — the thing that must become a token. `em`
# (relative) and negatives (deliberate pull-ups) are NOT matched here.
FIXED_LEN = re.compile(r"^[\d.]+(px|rem)$")

# CSS-wide + non-scale values allowed raw in any governed property.
KEYWORDS = {"0", "auto", "none", "inherit", "initial", "unset", "revert",
            "normal", "bold", "bolder", "lighter", "transparent", "currentcolor",
            "baseline", "center", "start", "end", "stretch", "left", "right",
            "top", "bottom", "middle", "space-between", "space-around"}
GENERIC_FONTS = {"monospace", "sans-serif", "serif", "cursive", "fantasy",
                 "system-ui", "ui-monospace", "inherit", "unset"}
# raw dimensions that are NOT on the spacing/type scale (layout, not design step)
OK_UNIT = re.compile(r"^-?[\d.]+(%|vw|vh|vmin|vmax|vvh|fr|deg|ch|ex)$")
DECL = re.compile(r"([\w-]+)\s*:\s*([^;{}]+)")
PROTECTED = re.compile(r"(:root\s*\{[^}]*\}|@font-face\s*\{[^}]*\})")


def _v_font_family(low, v):
    if "var(" in low:
        return None
    parts = [p.strip().strip("'\"") for p in low.split(",")]
    if all(p in GENERIC_FONTS for p in parts):
        return None
    return f"font-family: '{v}' -- use a --font-* token"


def _v_letter_spacing(low, v):
    if low.startswith("var(") or low in KEYWORDS:
        return None
    if re.match(r"^-?[\d.]+(em|px|rem)$", low):  # tokens ARE em; any raw is a miss
        return f"letter-spacing: {v} -- use a --tracking-* token"
    return None


def _v_line_height(low, v):
    if low.startswith("var(") or low in KEYWORDS:
        return None
    if re.match(r"^[\d.]+$", low):  # unitless ratio
        return f"line-height: {v} -- use a --lh-* token"
    return None


def _v_font_weight(low, v):
    if low.startswith("var(") or low in ("inherit", "initial", "unset", "revert"):
        return None
    if low.isdigit() or low in ("bold", "normal", "bolder", "lighter"):
        return f"font-weight: {v} -- use a --fw-* token"
    return None


def _v_font_size(low, v):
    if low.startswith("var(") or low in KEYWORDS or OK_UNIT.match(low):
        return None
    if FIXED_LEN.match(low):  # em (relative) + negatives fall through -> raw ok
        return f"font-size: {v} -- use a --fs-* token"
    return None


def _v_length_list(prop, v):
    """padding/margin/gap/border-radius: each part must be a token, keyword,
    non-scale unit, em, or negative. A bare positive px/rem is the miss."""
    fam = "--radius-*" if prop == "border-radius" else "--space-*"
    for part in v.split():
        p = part.lower()
        if p.startswith("var(") or p in KEYWORDS or OK_UNIT.match(p):
            continue
        if FIXED_LEN.match(p):
            return f"{prop}: {v} -- '{part}' should be a {fam} token"
    return None


_SINGLE_HANDLERS = {
    "letter-spacing": _v_letter_spacing, "line-height": _v_line_height,
    "font-weight": _v_font_weight, "font-size": _v_font_size,
}


def _raw_violation(prop, value):
    """Return a reason string if this declaration uses a raw scale value.

    `em` (font-relative) and negative lengths stay raw for size/spacing — only
    fixed positive px/rem must become a token. letter-spacing is the exception:
    its tokens ARE em, so raw em/px/rem tracking is a violation."""
    v = re.sub(r"\s*!important\s*$", "", value).strip()
    low = v.lower()
    if prop == "font-family":
        return _v_font_family(low, v)
    # deliberate one-off math/fallbacks: left to the author.
    if any(fn in low for fn in ("calc(", "min(", "max(", "clamp(", "env(")):
        return None
    handler = _SINGLE_HANDLERS.get(prop)
    return handler(low, v) if handler else _v_length_list(prop, v)


def check():
    errors = []
    for path in sorted(ROOT.glob("web/*.css")):
        # skip token DEFINITIONS + @font-face descriptors (raw by necessity)
        text = "".join(
            "" if (seg.startswith(":root") or seg.startswith("@font-face"))
            else seg
            for seg in PROTECTED.split(path.read_text())
        )
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)  # drop comments
        for m in DECL.finditer(text):
            prop = m.group(1).strip().lower()
            if prop not in GOVERNED:
                continue
            reason = _raw_violation(prop, m.group(2))
            if reason:
                errors.append(f"{path.name}: {reason}")

    if errors:
        print("scale lint: %d violation(s)" % len(errors))
        for e in errors:
            print("  " + e)
        return 1
    print("scale lint: ok (every governed value is a scale token)")
    return 0


if __name__ == "__main__":
    sys.exit(check())
