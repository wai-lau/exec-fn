"""Name normalization must agree BYTE FOR BYTE between the browser
(noodleNormName in web/noodle-kdf.js, which salts the key) and the server
(noodle.slots.normalize_name, which binds the name). A disagreement means the
same typed name gets a key the server files under a different identity -- or
two names collide on the server that the browser keeps apart.

The strings are the known places lowercasing and NFKC differ between
implementations: final sigma, dotted capital I, sharp s, fullwidth and
compatibility forms, ligatures, odd whitespace, and format characters.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from noodle.slots import normalize_name  # noqa: E402

_JS = os.path.join(os.path.dirname(__file__), "..", "web", "noodle-kdf.js")

CASES = [
    "Wai", "WAI", "wai", "  Wai   Lau ", "Wai\tLau", "Wai Lau", "Wai　Lau",
    "ＷＡＩ",            # fullwidth WAI
    "ΟΔΟΣ",      # GREEK capital ODOS: final sigma
    "ΣΣ",                  # sigma sigma
    "İstanbul",                 # dotted capital I
    "Straße", "STRASSE", "ẞ",  # sharp s, capital sharp s
    "ﬁsh",                      # fi ligature
    "①", "½",              # circled one, one half
    "José", "José",       # composed vs combining accent
    "ЅІЈ",            # Cyrillic lookalikes stay distinct
    "a​b", "a‍b", "a﻿b", "a\u0007b",  # format / control: refused
    "", "   ", "x" * 40, "x" * 41,
]


def py(s):
    try:
        return normalize_name(s)
    except ValueError:
        return None


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_browser_and_server_normalize_identically():
    out = subprocess.run(
        ["node", "-e", f"global.window={{}};require({json.dumps(os.path.abspath(_JS))});"
                       f"console.log(JSON.stringify({json.dumps(CASES)}.map(s => window.noodleNormName(s))))"],
        capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    diffs = {repr(c): (p, j) for c, p, j in zip(CASES, map(py, CASES), js) if p != j}
    assert not diffs, f"browser vs server name normalization differs: {diffs}"


def test_case_and_width_collapse_to_one_identity():
    assert py("Wai") == py("WAI") == py("  wai ") == py("ＷＡＩ") == "wai"
    assert py("José") == py("José")
    assert py("ЅІЈ") != py("SIJ")    # lookalikes are NOT merged
    assert py("a​b") is None and py("   ") is None
