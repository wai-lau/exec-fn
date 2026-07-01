#!/usr/bin/env python3
"""One-off: rewrite raw structural lengths in web/*.css onto the chrome.css
scale tokens (--space-*/--radius-*/--fs-*/...). Property-aware: the same
literal `4px` maps to a different token under `padding` vs `border-radius`.

Snap scales mirror the palette move — values derived from real usage, anchored
on RD+HQ, outliers snap to nearest (ties round DOWN to the smaller step).
Dry-run by default (prints unified diffs); --write to apply.

Skips: chrome.css :root token defs, values containing ( ) — calc/hsl/var/
color-mix/url are left raw, box-shadow (bespoke, colour-coupled), width/height/
inset (layout dims, not the spacing scale), and bare 0.
"""
import re
import sys
import difflib
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"

# token name -> literal value; snap picks nearest by numeric key.
SPACE = {"--space-px": 1, "--space-0-5": 2, "--space-1": 3, "--space-1-5": 4,
         "--space-2": 6, "--space-2-5": 8, "--space-3": 10, "--space-4": 12,
         "--space-5": 14, "--space-6": 16, "--space-7": 20, "--space-8": 24,
         "--space-10": 32}
RADIUS = {"--radius-1": 2, "--radius-2": 4, "--radius-3": 6, "--radius-4": 8}
FS = {"--fs-micro": 0.5, "--fs-2xs": 0.6, "--fs-xs": 0.68, "--fs-sm": 0.72,
      "--fs-base": 0.78, "--fs-md": 0.85, "--fs-lg": 0.9, "--fs-xl": 1.0,
      "--fs-2xl": 1.3, "--fs-3xl": 1.7, "--fs-4xl": 2.05}
FW = {"--fw-normal": 400, "--fw-medium": 500, "--fw-semibold": 600, "--fw-bold": 700}
LH = {"--lh-none": 1.0, "--lh-tight": 1.2, "--lh-snug": 1.35, "--lh-normal": 1.45,
      "--lh-relaxed": 1.6, "--lh-loose": 1.7}
TRACK = {"--tracking-tight": -0.01, "--tracking-wide": 0.05, "--tracking-wider": 0.08,
         "--tracking-x": 0.1, "--tracking-widest": 0.12, "--tracking-caps": 0.15,
         "--tracking-mega": 0.18}
BORDER = {"--border": 1, "--border-2": 2, "--border-3": 3}
BLUR = {"--blur-sm": 6, "--blur": 14}
# z-index + duration + easing + font-family map on EXACT value only (no snap).
Z_EXACT = {2: "--z-raised", 10: "--z-sticky", 60: "--z-nav", 100: "--z-overlay",
           8999: "--z-bubble", 9990: "--z-modal", 9999: "--z-top", 10000: "--z-max"}
DUR_EXACT = {"0.15s": "--dur", "0.2s": "--dur-med"}
FONT_EXACT = {
    "'iosevka mayukai monolite',monospace": "--font-mono",
    "'iosevka mayukai monolite'": "--font-mono",
    '"04b25",monospace': "--font-pixel", "'04b25',monospace": "--font-pixel",
    '"04b25"': "--font-pixel",
    "bitlight,monospace": "--font-bit", "bitlight": "--font-bit",
    "system-ui,sans-serif": "--font-ui",
}
# keys normalized (whitespace-stripped) so multi-word families match the same
# way use-site values are normalized before lookup.
FONT_NORM = {re.sub(r"\s+", "", k): v for k, v in FONT_EXACT.items()}


PX_PER_REM = 16  # root font-size; 0.5rem == 8px, so rem<->px snap is exact-ish


def snap(val, scale):
    """Nearest token by numeric distance; tie rounds DOWN (smaller value)."""
    best = min(scale.items(), key=lambda kv: (abs(kv[1] - val), kv[1]))
    return best[0]


def num(tok):
    m = re.match(r"^(-?[0-9.]+)(px|rem|em)?$", tok)
    return (float(m.group(1)), m.group(2)) if m else (None, None)


def _to(v, u, target):
    """Convert a length to the target unit; None if incompatible. `em` is
    relative-by-design and never converts to a fixed unit (px/rem)."""
    if u == target:
        return v
    if target == "px" and u == "rem":
        return v * PX_PER_REM
    if target == "rem" and u == "px":
        return v / PX_PER_REM
    return None  # em<->fixed blocked; leaves em raw


def map_len(tok, scale, unit):
    """tok like '4px'/'0.5rem' -> var(--token) on `scale` (native unit `unit`).
    Fixed units convert into `unit` then snap; em (relative) + negatives + 0
    are left raw (return None)."""
    v, u = num(tok)
    if v is None or u is None or v == 0:
        return None
    if v < 0 and unit != "em":   # negative px/rem (pull-ups) stay raw; -em tracking maps
        return None
    conv = _to(v, u, unit)
    if conv is None:
        return None
    return f"var({snap(conv, scale)})"


def sub_lengths(value, scale, unit):
    """Rewrite each length in a (function-free) shorthand value."""
    out = []
    for part in value.split():
        r = map_len(part, scale, unit)
        out.append(r if r else part)
    return " ".join(out)


SPACE_PROPS = {"padding", "margin", "gap", "row-gap", "column-gap",
               "padding-top", "padding-right", "padding-bottom", "padding-left",
               "margin-top", "margin-right", "margin-bottom", "margin-left"}


def _m_font_weight(v):
    val = {"normal": 400, "bold": 700}.get(v.lower())
    if val is None and v.isdigit():
        val = int(v)
    return f"var({snap(val, FW)})" if val in FW.values() else None


def _m_line_height(v):
    fv, u = num(v)
    return f"var({snap(fv, LH)})" if fv is not None and u is None else None


def _m_z_index(v):
    return f"var({Z_EXACT[int(v)]})" if v.lstrip("-").isdigit() and int(v) in Z_EXACT else None


def _m_font_family(v):
    key = re.sub(r"\s+", "", v.lower())
    return f"var({FONT_NORM[key]})" if key in FONT_NORM else None


# property -> value mapper (returns a token string, or None to leave raw).
_MAPPERS = {
    "border-radius": lambda v: sub_lengths(v, RADIUS, "px"),
    "font-size": lambda v: map_len(v, FS, "rem"),
    "letter-spacing": lambda v: map_len(v, TRACK, "em"),
    "font-weight": _m_font_weight,
    "line-height": _m_line_height,
    "z-index": _m_z_index,
    "font-family": _m_font_family,
}


def rewrite_decl(prop, value):
    """Return new value string, or None to leave unchanged."""
    p = prop.strip().lower()
    v = value.strip()
    important = ""
    m = re.search(r"\s*!important\s*$", v)
    if m:
        important = " !important"
        v = v[:m.start()]
    v = v.strip()

    if "(" in v:  # calc/hsl/var/color-mix/url — skip, except blur() we tokenize
        if p in ("filter", "backdrop-filter"):
            nv = re.sub(r"blur\(([0-9.]+px)\)",
                        lambda mm: f"blur({map_len(mm.group(1), BLUR, 'px') or mm.group(1)})", v)
            return (nv + important) if nv != v else None
        return None

    new = sub_lengths(v, SPACE, "px") if p in SPACE_PROPS else \
        _MAPPERS.get(p, lambda _v: None)(v)
    if new is None or new == v:
        return None
    return new + important


DECL = re.compile(r"([\w-]+)\s*:\s*([^;{}]+)")


PROTECTED = re.compile(r"(:root\s*\{[^}]*\}|@font-face\s*\{[^}]*\})")


def process(text):
    def repl(m):
        prop, value = m.group(1), m.group(2)
        nv = rewrite_decl(prop, value)
        return f"{prop}: {nv}" if nv else m.group(0)

    # never rewrite inside :root{} (tokens are DEFINED there) or @font-face{}
    # (custom properties don't resolve in font descriptors — would break the
    # font registration).
    parts = PROTECTED.split(text)
    return "".join(p if (p.startswith(":root") or p.startswith("@font-face"))
                   else DECL.sub(repl, p) for p in parts)


def main():
    write = "--write" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    files = sorted(WEB.glob("*.css"))
    for f in files:
        if only and f.name not in only:
            continue
        src = f.read_text()
        out = process(src)
        if out == src:
            continue
        diff = difflib.unified_diff(src.splitlines(True), out.splitlines(True),
                                    fromfile=f.name, tofile=f.name + " (tokenized)")
        sys.stdout.writelines(diff)
        if write:
            f.write_text(out)
    print("\n[wrote changes]" if write else "\n[dry-run — pass --write to apply]")


if __name__ == "__main__":
    main()
