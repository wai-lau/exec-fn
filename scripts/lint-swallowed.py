#!/usr/bin/env python3
"""Flag CODE swallowed by a mid-line // comment in web/*.js (it bit /spire three times: a scripted edit put
`// note` in the middle of a line and everything after it - an assignment, a GLSL uniform - silently stopped running).
A line is flagged when it has code before a // comment and the comment's text holds a statement: `; name = ...`, `) name = ...`,
`; name.field += ...`, `; name(...);`, or a GLSL declaration. Usage: lint-swallowed.py [files...] (default: web/*.js)."""
import re, sys, glob

STMT = re.compile(r"(;|(?<=\)))\s*[A-Za-z_$][\w$]*(\.[\w$]+|\[[^\]]*\])*\s*([+\-*/|&]?=)(?!=)\s*\S"
                  r"|;\s*[A-Za-z_$][\w$.]*\([^()]*\)\s*;"
                  r"|\b(uniform|attribute|varying)\s+(float|vec[234]|mat[234]|sampler2D)\s+\w+\s*[;,]")

def comment_start(line):
    """index of a // that starts a comment (outside strings and regex-free code), or -1"""
    q = None
    i = 0
    while i < len(line) - 1:
        c = line[i]
        if q:
            if c == "\\": i += 2; continue
            if c == q: q = None
        elif c in "\"'`": q = c
        elif line.startswith("/*", i):
            j = line.find("*/", i + 2)
            if j < 0: return -1
            i = j + 2; continue
        elif line.startswith("//", i) and (i == 0 or line[i - 1] != ":"): return i
        i += 1
    return -1

def main():
    files = sys.argv[1:] or sorted(glob.glob("web/*.js"))
    bad = 0
    for f in files:
        for n, line in enumerate(open(f, encoding="utf-8"), 1):
            i = comment_start(line)
            if i <= 0 or not line[:i].strip(): continue  # no comment, or a whole-line one
            text = line[i + 2:]
            m = next((m for m in STMT.finditer(text) if text[:m.start()].count("(") <= text[:m.start()].count(")")), None)  # (not inside a parenthesis: prose)
            if m:
                print(f"{f}:{n}: code inside a // comment? {line[i:i + 140].strip()}"); bad += 1
    if bad:
        print(f"lint-swallowed: {bad} line(s) - put the comment on its own line or use /* */ so the code after it runs")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
