#!/usr/bin/env python3
"""Render mermaid sources (`.mmd`) to an SVG beside each one.

A doc is read in places that do not render a ```mermaid fence (the Claude Code
app's markdown viewer prints it as a code block; GitHub renders it), so the
source lives in `docs/arch/<name>.mmd` and the doc embeds the rendered
`docs/arch/<name>.svg` as an image. Re-run after editing a `.mmd`:

    .venv/bin/python scripts/render-mermaid.py apps/spire/docs/arch/*.mmd

Needs exec-fn's .venv (playwright + WebKit, the browser tests' stack); mermaid
itself is fetched from jsdelivr. Labels are rendered as SVG text, not HTML
(`htmlLabels: false`), so the file works inside an <img> everywhere.
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs"
CONFIG = {
    "startOnLoad": False, "theme": "dark", "securityLevel": "strict",
    "htmlLabels": False, "flowchart": {"htmlLabels": False, "curve": "basis"},
    "themeVariables": {"fontFamily": "ui-monospace, Menlo, Consolas, monospace", "fontSize": "14px"},
}


def intrinsic_size(svg: str) -> str:
    """mermaid emits width="100%" and no height: inside an <img> that is no size at all.
    Give the root the viewBox's pixel size so every viewer lays it out."""
    m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    if not m:
        return svg
    w, h = (int(float(v)) + 1 for v in m.groups())
    return svg.replace(' width="100%"', f' width="{w}" height="{h}"', 1)


def main(paths: list[str]) -> int:
    if not paths:
        print(__doc__)
        return 2
    with sync_playwright() as p:
        browser = p.webkit.launch()
        page = browser.new_page()
        page.goto("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/package.json")  # a real origin: dynamic import() from about:blank is refused
        page.evaluate("async ([url, cfg]) => { const m = (await import(url)).default; m.initialize(cfg); window.__mermaid = m; }", [MERMAID, CONFIG])
        for path in map(pathlib.Path, paths):
            svg = page.evaluate("async ([id, src]) => (await window.__mermaid.render(id, src)).svg", ["m" + path.stem.replace("-", ""), path.read_text()])
            svg = intrinsic_size(svg)
            out = path.with_suffix(".svg")
            out.write_text(svg + "\n")
            print(f"{out}  {len(svg)} bytes")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
