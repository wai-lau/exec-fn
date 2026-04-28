import re

from helpers import DATA_DIR

RULES_PATH = DATA_DIR / "mtg_rules.txt"

_RULE_NUM_RE = re.compile(r"^(\d{3})(\.\d+[a-z]?)?$")


def lookup_rule(query: str) -> dict:
    query = query.strip()
    if not RULES_PATH.exists():
        return {"error": "Rules file not found. Copy the original rules txt to /app/data/mtg_rules.txt"}

    lines = RULES_PATH.read_text(errors="ignore").splitlines()

    m = _RULE_NUM_RE.match(query)
    if m:
        section, sub = m.group(1), m.group(2)
        if sub is None:
            # e.g. "702" — return section header + direct children only (not sub-subrules)
            prefix = section + "."
            results = [line for line in lines if line.startswith(prefix)]
        elif not re.search(r"[a-z]$", sub):
            # e.g. "702.2" — return 702.2. and 702.2a. through 702.2z.
            pat = re.compile(r"^" + re.escape(query) + r"[a-z]?\.")
            results = [line for line in lines if pat.match(line)]
        else:
            # e.g. "702.2a" — exact rule
            results = [line for line in lines if line.startswith(query + ".")]

        return {"query": query, "rules": results[:60], "count": len(results)}

    # Keyword search — return rule lines containing all keywords
    keywords = query.lower().split()
    rule_line = re.compile(r"^\d{3}\.")
    results = [line for line in lines if rule_line.match(line) and all(k in line.lower() for k in keywords)]
    return {"query": query, "rules": results[:30], "count": len(results)}
