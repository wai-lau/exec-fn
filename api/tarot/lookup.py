from functools import lru_cache
from pathlib import Path

from tarot.cards import CARDS_BY_ID

BOOK_DIR = Path(__file__).parent / "book"
CARDS_DIR = BOOK_DIR / "cards"
SUITS_DIR = BOOK_DIR / "suits"


@lru_cache(maxsize=1)
def _load_numerology() -> dict[str, str]:
    path = BOOK_DIR / "numerology.md"
    if not path.exists():
        return {}
    text = path.read_text()
    blurbs: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("- **"):
            continue
        body = line[len("- **"):]
        try:
            name, _, rest = body.partition("**")
            blurbs[name.strip().lower()] = rest.lstrip(" —-").strip()
        except Exception:
            pass
    return blurbs


@lru_cache(maxsize=1)
def _load_suits() -> dict[str, str]:
    out: dict[str, str] = {}
    if not SUITS_DIR.exists():
        return out
    for path in SUITS_DIR.glob("*.md"):
        out[path.stem] = path.read_text().strip()
    return out


@lru_cache(maxsize=128)
def _load_card_chapter(card_id: str) -> str | None:
    path = CARDS_DIR / f"{card_id}.md"
    if path.exists():
        return path.read_text().strip()
    return None


_PIP_KEYS_BY_NUMBER = {
    1: "ace", 2: "two", 3: "three", 4: "four", 5: "five",
    6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten",
    11: "page", 12: "knight", 13: "queen", 14: "king",
}


def lookup_card_meaning(card_id: str) -> dict:
    card = CARDS_BY_ID.get(card_id)
    if not card:
        return {"error": f"unknown card_id: {card_id}", "count": 0}

    chapter = _load_card_chapter(card_id)
    if chapter:
        return {
            "name": card["name"],
            "arcana": card["arcana"],
            "text": chapter,
            "count": 1,
        }

    if card["arcana"] == "minor":
        suit = card["suit"]
        suits = _load_suits()
        numerology = _load_numerology()
        pip_key = _PIP_KEYS_BY_NUMBER.get(card["number"], "")
        parts: list[str] = []
        if suits.get(suit):
            parts.append(f"## Suit: {suit.title()}\n\n{suits[suit]}")
        if pip_key and numerology.get(pip_key):
            parts.append(f"## Rank: {pip_key.title()}\n\n{numerology[pip_key]}")
        if not parts:
            parts.append(f"({card['name']} — no chapter available; read from suit and number alone.)")
        return {
            "name": card["name"],
            "arcana": card["arcana"],
            "text": "\n\n".join(parts),
            "count": 1,
        }

    return {
        "name": card["name"],
        "arcana": card["arcana"],
        "text": f"({card['name']} — no chapter available.)",
        "count": 1,
    }


_FRAMEWORK_FILES = {
    "core": "framework_core.md",
    "three": "framework_three.md",
    "celtic_cross": "framework_celtic_cross.md",
}


@lru_cache(maxsize=8)
def _load_framework_file(key: str) -> str:
    path = BOOK_DIR / _FRAMEWORK_FILES[key]
    if not path.exists():
        return ""
    return path.read_text().strip()


def load_framework(spread_type: str | None) -> str:
    core = _load_framework_file("core")
    if spread_type in _FRAMEWORK_FILES and spread_type != "core":
        extra = _load_framework_file(spread_type)
        if extra:
            return f"{core}\n\n---\n\n{extra}"
    return core
