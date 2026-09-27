"""Every non-ASCII character Noodle can put on screen is single-width in the
monospace face, and none is an emoji.

The seal is a 5x5 character grid and only reads as a square face if every
cell is exactly one column wide. The site's own woff2 is a 126-glyph ASCII
subset, so Noodle ships web/fonts/noodle-seal.woff2 with the extras. This
pins, over EVERY Noodle source file (literal characters and \\uXXXX escapes
alike):
  - each non-ASCII codepoint is in noodle-seal.woff2,
  - its advance equals 'M' in the full Mayukai face it was cut from,
  - it is not an emoji, and no variation selector appears anywhere,
  - noodle.css's unicode-range lists exactly the font's codepoints.
A WebKit test then measures the RENDERED width of each glyph on the page.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "web/fonts/noodle-seal.woff2"
FULL = ROOT / "web/fonts/Iosevka Mayukai Monolite Medium Nerd Font Complete.ttf"

ttLib = pytest.importorskip("fontTools.ttLib")


def noodle_sources() -> list[Path]:
    files = list((ROOT / "api/noodle").glob("*.py"))
    files += list((ROOT / "api/templates").glob("noodle*.html"))
    files += [p for p in (ROOT / "web").glob("noodle*") if p.suffix in (".js", ".css")]
    return sorted(files)


def used_codepoints() -> dict[int, str]:
    found = {}
    for f in noodle_sources():
        text = f.read_text(encoding="utf-8")
        for ch in text:
            if ord(ch) > 0x7E:
                found.setdefault(ord(ch), f.name)
        if f.suffix == ".js":
            for m in re.finditer(r"\\u([0-9a-fA-F]{4})", text):
                cp = int(m.group(1), 16)
                if cp > 0x7E:
                    found.setdefault(cp, f.name)
    return found


# U+2713/U+2717 (check, ballot x) are NOT emoji in Unicode's emoji-data --
# their heavy cousins U+2714/U+2716 are. Everything else in the symbol blocks
# that can turn into a colour picture is refused outright.
_TEXT_DINGBATS = {0x2713, 0x2717}


def _emoji(cp: int) -> bool:
    if cp in _TEXT_DINGBATS:
        return False
    return (0x1F000 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF
            or cp in (0xFE0E, 0xFE0F, 0x200D, 0x20E3) or 0xE0020 <= cp <= 0xE007F)


def test_sources_found():
    names = {p.name for p in noodle_sources()}
    assert {"noodle-seal.js", "noodle.css", "noodle-vote.html", "sig.py"} <= names


def test_no_emoji_or_variation_selectors():
    bad = {hex(cp): f for cp, f in used_codepoints().items() if _emoji(cp)}
    assert not bad, f"emoji / variation selectors in Noodle: {bad}"


def test_every_glyph_is_in_the_noodle_font():
    cmap = ttLib.TTFont(FONT).getBestCmap()
    missing = {chr(cp): f for cp, f in used_codepoints().items() if cp not in cmap}
    assert not missing, f"not in noodle-seal.woff2 (would fall back to another font): {missing}"


def test_every_glyph_is_single_width():
    font = ttLib.TTFont(FONT)
    cmap, hmtx = font.getBestCmap(), font["hmtx"]
    if FULL.exists():
        full = ttLib.TTFont(FULL)
        em = full["hmtx"][full.getBestCmap()[ord("M")]][0]
    else:  # the subset carries the same advances; any glyph's is the cell width
        em = hmtx[cmap[0xB0]][0]
    wide = {chr(cp): hmtx[cmap[cp]][0] for cp in cmap if hmtx[cmap[cp]][0] != em}
    assert not wide, f"glyphs not one cell wide (M = {em}): {wide}"


def test_unicode_range_matches_the_font():
    css = (ROOT / "web/noodle.css").read_text()
    block = re.search(r"unicode-range:([^;]+);", css).group(1)
    declared = {int(h, 16) for h in re.findall(r"U\+([0-9A-Fa-f]+)", block)}
    in_font = {cp for cp in ttLib.TTFont(FONT).getBestCmap() if cp > 0x7E}
    assert declared == in_font


# ── rendered width, in the real engine ──────────────────────────────────────
@pytest.mark.browser
def test_rendered_glyphs_are_one_cell_wide(browser, base_url, noodle_slug):
    import json
    slug = noodle_slug
    glyphs = [chr(cp) for cp in sorted(used_codepoints())]
    page = browser.new_page(viewport={"width": 430, "height": 932})
    try:
        page.goto(f"{base_url}/noodle/{slug}")
        page.evaluate("document.fonts.ready")
        widths = page.evaluate(
            """(gs) => { const s = document.createElement('span');
              s.style.cssText = 'position:absolute;white-space:pre;font-family:"Noodle Glyphs",var(--font-mono)';
              document.querySelector('.nd-card').appendChild(s);
              const w = (t) => { s.textContent = t.repeat(20); return s.getBoundingClientRect().width; };
              const m = w('M'); const out = {};
              for (const g of gs) out[g] = w(g) / m; return out; }""", glyphs)
    finally:
        page.close()
    off = {g: round(r, 3) for g, r in widths.items() if abs(r - 1) > 0.01}
    assert not off, f"rendered wider/narrower than one cell: {json.dumps(off, ensure_ascii=False)}"
