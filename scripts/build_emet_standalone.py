#!/usr/bin/env python3
"""Build emet_gen.py — a portable, self-contained generator for the /emet UI.

Reads the live emet assets (the emet.html renderer, the vendored vis-network
bundle, chrome.css, emet.css, the Iosevka woff2 fonts, the favicon), inlines all
of them into a single standalone HTML template (CSS in <style>, vis-network +
fonts + favicon as data: URIs, an <!--EMET_DATA--> placeholder left intact), then
base64-bakes that template into ./emet_gen.py.

emet_gen.py is a ONE-FILE generator: copy it to any machine, feed it an
emet-graph.json, and it writes the EXACT /emet graph UI as one self-contained
.html — no FastAPI, no network, no sibling files.

    python3 scripts/build_emet_standalone.py          # writes ./emet_gen.py
    python3 emet_gen.py emet-graph.json > emet.html    # on any machine

The bottom nav + exec bubble are intentionally dropped (app chrome, dead
off-server). Everything else — palette, cyber-fx, fonts, vis-network, the
node-info strip, camera/zoom behaviour — is the live renderer, byte-for-byte.

Re-run this after changing any emet asset (emet.html, chrome.css, emet.css,
the vis bundle, or the fonts) to refresh emet_gen.py.
"""
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
TPL = ROOT / "api" / "templates"


def datauri(rel_path: pathlib.Path, mime: str) -> str:
    return "data:" + mime + ";base64," + base64.b64encode(rel_path.read_bytes()).decode()


# chrome.css: inline the two Iosevka woff2 as data: URIs; drop the unused ttf
# @font-face blocks (BitLight / 04b25 — nightfall-only, would 404 off-server).
chrome = (WEB / "chrome.css").read_text(encoding="utf-8")
chrome = chrome.replace(
    "url('/fonts/iosevka-500.woff2?v=1')",
    "url('" + datauri(WEB / "fonts" / "iosevka-500.woff2", "font/woff2") + "')")
chrome = chrome.replace(
    "url('/fonts/iosevka-700.woff2?v=1')",
    "url('" + datauri(WEB / "fonts" / "iosevka-700.woff2", "font/woff2") + "')")
chrome = re.sub(r"@font-face\s*\{[^}]*\.ttf[^}]*\}", "", chrome)
emet_css = (WEB / "emet.css").read_text(encoding="utf-8")

# emet.html is a full document with <!--EMET_DATA-->, </head>, </body>. Mirror
# emet_page() (routes_views.py): inline vis-network, add the metas + favicon +
# both stylesheets to the head, and the cyber-fx layers before </body>.
page = (TPL / "emet.html").read_text(encoding="utf-8")
page = page.replace(
    '<script src="/vendor/vis-network-9.1.9.min.js?v=1"></script>',
    '<script src="' + datauri(WEB / "vendor" / "vis-network-9.1.9.min.js", "text/javascript") + '"></script>')
head = (
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<meta name="apple-mobile-web-app-capable" content="yes">'
    '<meta name="mobile-web-app-capable" content="yes">'
    '<link rel="icon" type="image/png" href="' + datauri(WEB / "favicon.png", "image/png") + '">'
    '<style>' + chrome + '</style>'
    '<style>' + emet_css + '</style>')
page = page.replace("</head>", head + "</head>", 1)
page = page.replace(
    "</body>", '<div class="cyber-bg"></div><div class="cyber-scan"></div></body>', 1)

template_b64 = base64.b64encode(page.encode("utf-8")).decode()

# The generated one-file tool. Data injection mirrors emet_page(): escape `<` to
# < so a "</script>" inside the JSON can't close the tag, then drop it into
# the placeholder. chr(92) is a backslash (keeps this builder escape-free).
BODY = '''import base64, sys

TEMPLATE = base64.b64decode(_TEMPLATE_B64).decode("utf-8")


def build(data_json):
    data = data_json.replace("<", chr(92) + "u003c")
    return TEMPLATE.replace(
        "<!--EMET_DATA-->",
        "<script>window.EMET_GRAPH=" + data + ";</script>", 1)


if __name__ == "__main__":
    src = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    sys.stdout.write(build(src))
'''

header = (
    '#!/usr/bin/env python3\n'
    '"""Standalone /emet generator (auto-built by scripts/build_emet_standalone.py).\n\n'
    'Turn an emet-graph.json into the exact /emet graph UI as one self-contained\n'
    'HTML file -- no FastAPI, no network, no other files needed.\n\n'
    '    python3 emet_gen.py emet-graph.json > emet.html\n'
    '    cat emet-graph.json | python3 emet_gen.py > emet.html\n\n'
    'Then open emet.html in any browser."""\n'
)

out = ROOT / "emet_gen.py"
out.write_text(header + '_TEMPLATE_B64 = "' + template_b64 + '"\n\n' + BODY, encoding="utf-8")
print("wrote %s  (%.2f MB)" % (out, out.stat().st_size / 1e6))
