"""One-off build step: subset the two Iosevka weights the /recruiter page
actually uses (Medium 500, Bold 700) down to the Latin + handful-of-symbol
glyph set the résumé renders, and emit woff2. The shipped Nerd-Font TTFs are
~11MB each (thousands of icon glyphs in the PUA/high planes); subsetting to the
glyphs below drops each to tens of KB so first paint is sub-1s.

Runs inside the api container (only host with pip). Writes into
/app/static/fonts, which is the volume mount for web/fonts/ — so the woff2
files land on the host and get committed. Re-runnable.
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

JOBS = [
    ("Iosevka Mayukai Monolite Medium Nerd Font Complete.ttf", "iosevka-cv-500.woff2"),
    ("Iosevka Mayukai Monolite Bold Nerd Font Complete.ttf", "iosevka-cv-700.woff2"),
]


def run() -> None:
    for src, out in JOBS:
        subset_main([
            f"{FONTS}/{src}",
            f"--text={TEXT}",
            "--flavor=woff2",
            "--layout-features=*",
            "--no-hinting",
            "--desubroutinize",
            f"--output-file={FONTS}/{out}",
        ])
        print(f"wrote {out}")


if __name__ == "__main__":
    run()
