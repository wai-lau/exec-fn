"""One-off build step: subset the two Iosevka weights (Medium 500, Bold 700)
down to the glyphs the site actually renders, and emit woff2. The shipped
Nerd-Font TTFs are ~11MB each (thousands of icon glyphs in the PUA/high
planes); subsetting drops each to tens of KB so first paint is sub-1s.

Two output pairs:
  - iosevka-cv-{500,700}.woff2  — narrow Latin set the /recruiter résumé needs
  - iosevka-{500,700}.woff2     — the whole site: Latin + every box-drawing /
    arrow / geometric / Greek glyph the chrome UI renders (chat, rd, emet,
    hq). chrome.css + exec-bubble.css @font-face point here.

Runs inside the api container (only host with pip — `pip install fonttools
brotli` first; brotli is the woff2 codec). Writes into /app/static/fonts,
the volume mount for web/fonts/ — so the woff2 files land on the host and get
committed. Re-runnable.
"""
from fontTools.subset import main as subset_main

FONTS = "/app/static/fonts"

# every glyph the recruiter page can render: full printable ASCII, the accented
# letters in the copy (résumé / Montréal / Dean's curly quote), and the symbol
# glyphs used by CSS content + the recruiter.js controls / theme toggle.
ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
EXTRAS = (
    "é"   # é  résumé / Montréal
    "è"   # è
    "’"   # ’  Dean’s
    "–"   # –  date ranges
    "—"   # —
    "·"   # ·  middot separators
    "…"   # …  decoy ellipsis
    "✦"   # ✦  (favicon is SVG, kept for safety)
    "⏾"   # ⏾  dark-mode moon glyph
    "⋆"   # ⋆  theme-toggle frame
    "₊"   # ₊  theme-toggle frame
    "⁺"   # ⁺  theme-toggle frame
    "▸"   # ▸  CSS bullet (cv-job li::before)
    "⏩"   # ⏩  skip control
    "⟳"   # ⟳  replay control
)
TEXT = ASCII + EXTRAS

# Every non-ASCII glyph the chrome UI renders beyond the recruiter set, gathered
# from templates + web/*.{css,js}: box-drawing, geometric shapes, arrows, Greek,
# the few math/dingbat symbols in CSS `content:` and JS-built text. CJK + the
# fullwidth kaomoji chars are deliberately omitted — Iosevka Monolite has no
# glyph for them, so they already fall back; subsetting can't add what's absent.
SITE_EXTRAS = EXTRAS + (
    "×"   # ×  multiply / close
    "α"   # α  alpha (graph node)
    "↑"   # ↑  up arrow
    "→"   # →  right arrow
    "↺"   # ↺  reload glyph
    "─"   # ─  box-drawing horizontal
    "▲"   # ▲  emet parent link
    "▴"   # ▴
    "▶"   # ▶  emet child link
    "▼"   # ▼
    "▽"   # ▽
    "▾"   # ▾
    "◂"   # ◂
    "☼"   # ☼  sun (timeline day band)
    "✓"   # ✓  check
    "✕"   # ✕  close
)
SITE_TEXT = ASCII + SITE_EXTRAS

# (text, [(src_ttf, out_woff2), ...])
PAIRS = [
    (TEXT, [
        ("Iosevka Mayukai Monolite Medium Nerd Font Complete.ttf", "iosevka-cv-500.woff2"),
        ("Iosevka Mayukai Monolite Bold Nerd Font Complete.ttf", "iosevka-cv-700.woff2"),
    ]),
    # The full family the chrome UI actually renders: weights 400/500/600/700
    # normal + 400/500 italic (600/700 italic never occur -- italic text is all
    # 400-500 context). index.html's @font-face points at these; the source TTFs
    # for the non-500/700 weights are NOT committed (deleted to save ~67MB) --
    # restore the Iosevka Mayukai Monolite Nerd Font pack to web/fonts/ to
    # re-subset those rows. Medium + Bold (500/700) sources ARE kept.
    (SITE_TEXT, [
        ("Iosevka Mayukai Monolite Nerd Font Complete.ttf", "iosevka-400.woff2"),
        ("Iosevka Mayukai Monolite Italic Nerd Font Complete.ttf", "iosevka-400-italic.woff2"),
        ("Iosevka Mayukai Monolite Medium Nerd Font Complete.ttf", "iosevka-500.woff2"),
        ("Iosevka Mayukai Monolite Medium Italic Nerd Font Complete.ttf", "iosevka-500-italic.woff2"),
        ("Iosevka Mayukai Monolite Semibold Nerd Font Complete.ttf", "iosevka-600.woff2"),
        ("Iosevka Mayukai Monolite Bold Nerd Font Complete.ttf", "iosevka-700.woff2"),
    ]),
]


def run() -> None:
    for text, jobs in PAIRS:
        for src, out in jobs:
            subset_main([
                f"{FONTS}/{src}",
                f"--text={text}",
                "--flavor=woff2",
                "--layout-features=*",
                "--no-hinting",
                "--desubroutinize",
                f"--output-file={FONTS}/{out}",
            ])
            print(f"wrote {out}")


if __name__ == "__main__":
    run()
