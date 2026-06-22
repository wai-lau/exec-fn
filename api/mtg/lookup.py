import json
import re
from functools import lru_cache
from pathlib import Path

MTG_DATA_DIR = Path("/app/mtg/data")

RULES_PATH = MTG_DATA_DIR / "mtg_rules.txt"
CARDS_PATH = MTG_DATA_DIR / "oracle-cards-slim.json"
RULINGS_PATH = MTG_DATA_DIR / "rulings-slim.json"

_RULE_NUM_RE = re.compile(r"^(\d{3})(\.\d+[a-z]?)?$")


def _card_summary(card: dict) -> dict:
    if "card_faces" in card and not card.get("oracle_text"):
        faces = card["card_faces"]
        oracle_text = " // ".join(f.get("oracle_text", "") for f in faces)
        type_line = " // ".join(f.get("type_line", "") for f in faces)
        mana_cost = " // ".join(f.get("mana_cost", "") for f in faces)
        power = faces[0].get("power")
        toughness = faces[0].get("toughness")
    else:
        oracle_text = card.get("oracle_text", "")
        type_line = card.get("type_line", "")
        mana_cost = card.get("mana_cost", "")
        power = card.get("power")
        toughness = card.get("toughness")

    out = {
        "name": card["name"],
        "oracle_id": card["oracle_id"],
        "mana_cost": mana_cost,
        "type_line": type_line,
        "oracle_text": oracle_text,
        "keywords": card.get("keywords", []),
    }
    if power is not None:
        out["power"] = power
        out["toughness"] = toughness
    return out


@lru_cache(maxsize=1)
def _load_cards() -> tuple[dict, dict]:
    if not CARDS_PATH.exists():
        return {}, {}
    cards = json.loads(CARDS_PATH.read_text())
    by_name = {}
    by_oracle = {}
    for card in cards:
        key = card["name"].lower()
        by_name[key] = card
        by_oracle[card["oracle_id"]] = card
    return by_name, by_oracle


@lru_cache(maxsize=1)
def _load_rulings() -> dict:
    if not RULINGS_PATH.exists():
        return {}
    rulings = json.loads(RULINGS_PATH.read_text())
    by_oracle: dict[str, list[str]] = {}
    for r in rulings:
        oid = r["oracle_id"]
        by_oracle.setdefault(oid, []).append(r["comment"])
    return by_oracle


def lookup_card(name: str) -> dict:
    by_name, _ = _load_cards()
    if not by_name:
        return {"error": "Cards file not found at /app/data/oracle-cards-slim.json"}

    key = name.lower().strip()

    # Exact match
    if key in by_name:
        return {"match": "exact", "cards": [_card_summary(by_name[key])]}

    # Substring match
    matches = [card for k, card in by_name.items() if key in k]
    if matches:
        return {"match": "partial", "cards": [_card_summary(c) for c in matches[:5]]}

    return {"match": "none", "cards": []}


def lookup_rulings(oracle_id: str) -> dict:
    by_oracle = _load_rulings()
    if not by_oracle:
        return {"error": "Rulings file not found at /app/data/rulings-slim.json"}
    comments = by_oracle.get(oracle_id.strip(), [])
    return {"oracle_id": oracle_id, "rulings": comments, "count": len(comments)}


def lookup_rule(query: str) -> dict:
    query = query.strip()
    if not RULES_PATH.exists():
        return {"error": "Rules file not found. Copy the original rules txt to /app/mtg/data/mtg_rules.txt"}

    lines = RULES_PATH.read_text(errors="ignore").splitlines()

    m = _RULE_NUM_RE.match(query)
    if m:
        section, sub = m.group(1), m.group(2)
        if sub is None:
            # section: every rule + subrule under it ("113." -> "113.7.", "113.7a ...")
            prefix = section + "."
            results = [line for line in lines if line.startswith(prefix)]
        elif re.search(r"[a-z]$", sub):
            # lettered subrule "113.7a": the CR line is "113.7a <text>" (letter then a
            # space, NO trailing dot), so anchor the number and require a non-alnum
            # boundary. (The old "startswith(query + '.')" expected a dot and never matched.)
            pat = re.compile(r"^" + re.escape(query) + r"(?![a-z0-9])")
            results = [line for line in lines if pat.match(line)]
        else:
            # numbered rule "113.7": the rule itself ("113.7. ...") plus its lettered
            # subrules ("113.7a ...", "113.7b ..."), but not "113.70"/"113.71".
            pat = re.compile(r"^" + re.escape(query) + r"(\.|[a-z])")
            results = [line for line in lines if pat.match(line)]
        return {"query": query, "rules": results[:60], "count": len(results)}

    keywords = query.lower().split()
    rule_line = re.compile(r"^\d{3}\.")
    results = [line for line in lines if rule_line.match(line) and all(k in line.lower() for k in keywords)]
    return {"query": query, "rules": results[:30], "count": len(results)}
