#!/usr/bin/env python3
"""Every staged web asset must have its ?v= bumped in the same commit.

Static assets are served `public, max-age=31536000, immutable` whenever the
URL carries a query (api/main.py CacheControlMiddleware), so a browser that
cached `/hq.css?v=17` keeps that copy for a YEAR. Editing web/hq.css without
bumping the `?v=` in api/templates/hq.html doesn't reach those browsers at
all -- and the device most likely to be holding an old copy is the phone,
which is the one place the layout is never checked.

That is exactly how /hq shipped its row layout to desktop and left the phone
rendering the pre-rows CSS: commits b2ecadd + 9adaaef changed web/hq.css and
neither touched `hq.css?v=17`.

So: if a commit stages `web/<asset>`, it must also stage a change to every
`<asset>?v=N` reference under api/. Run standalone to audit the whole tree
against git history (`--all`).
"""
import re
import subprocess
import sys
from pathlib import Path

REF_RE = re.compile(r'([\w.-]+\.(?:css|js))\?v=(\d+)')
ASSET_RE = re.compile(r'^web/(?!vendor/)[\w./-]+\.(?:css|js)$')


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def ref_files():
    return [Path(p) for p in sh("git", "ls-files", "api").split()
            if p.endswith((".html", ".py"))]


def refs_to(asset_name):
    """[(file, version)] -- every `<asset>?v=N` reference under api/."""
    out = []
    for f in ref_files():
        for m in REF_RE.finditer(f.read_text()):
            if m.group(1) == asset_name:
                out.append((f, int(m.group(2))))
    return out


def staged_versions(path):
    """The `<asset>?v=N` pairs in a file as staged vs. as committed."""
    def pairs(text):
        return set(REF_RE.findall(text))
    head = sh("git", "show", f"HEAD:{path}")
    staged = sh("git", "show", f":{path}")
    return pairs(head), pairs(staged)


def check_staged():
    staged = [p for p in sh("git", "diff", "--cached", "--name-only",
                            "--diff-filter=ACMR").split() if ASSET_RE.match(p)]
    problems = []
    for path in staged:
        name = Path(path).name
        uses = refs_to(name)
        if not uses:
            continue  # loaded some other way (nightfall bundle, direct link)
        for f, ver in uses:
            before, after = staged_versions(str(f))
            if (name, str(ver)) in before and (name, str(ver)) in after:
                problems.append((path, f, ver))
    return problems


def check_all():
    """Audit history: asset committed more recently than its ?v= last moved."""
    problems = []
    for f in ref_files():
        for m in REF_RE.finditer(f.read_text()):
            name, ver = m.group(1), m.group(2)
            asset = Path("web") / name
            if not asset.exists():
                continue
            a_ts = sh("git", "log", "-1", "--format=%ct", "--", str(asset)).strip()
            r_ts = sh("git", "log", "-1", "--format=%ct", "-S", f"{name}?v={ver}",
                      "--", str(f)).strip()
            if a_ts and r_ts and int(a_ts) > int(r_ts):
                problems.append((str(asset), f, int(ver)))
    return problems


def main():
    problems = check_all() if "--all" in sys.argv else check_staged()
    if not problems:
        print("cache-bust lint: ok (every changed asset has a bumped ?v=)")
        return 0
    print("cache-bust lint: asset changed without bumping its ?v=")
    for asset, ref, ver in problems:
        print(f"  {asset}  <-  {ref} still says ?v={ver} (bump to {ver + 1})")
    print("")
    print("Versioned assets are cached `immutable` for a year -- an unbumped")
    print("edit never reaches a browser that already has the old copy.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
