from functools import lru_cache
from pathlib import Path

from tarot.cards import CARDS_BY_ID

BOOK_DIR = Path(__file__).parent / "book"
CARDS_DIR = BOOK_DIR / "cards"
SUITS_DIR = BOOK_DIR / "suits"


@lru_cache(maxsize=1)
def load_numerology_text() -> str:
    path = BOOK_DIR / "numerology.md"
    if not path.exists():
        return ""
    return path.read_text().strip()


@lru_cache(maxsize=1)
def load_suits_text() -> str:
    if not SUITS_DIR.exists():
        return ""
    parts: list[str] = []
    for suit in ("cups", "wands", "swords", "pentacles"):
        path = SUITS_DIR / f"{suit}.md"
        if path.exists():
            parts.append(f"## {suit.title()}\n\n{path.read_text().strip()}")
    return "\n\n".join(parts)


@lru_cache(maxsize=128)
def _load_card_chapter(card_id: str) -> str | None:
    path = CARDS_DIR / f"{card_id}.md"
    if path.exists():
        return path.read_text().strip()
    return None


def lookup_card_meaning(card_id: str) -> dict:
    card = CARDS_BY_ID.get(card_id)
    if not card:
        return {"error": f"unknown card_id: {card_id}", "count": 0}

    if card["arcana"] != "major":
        return {
            "error": (
                f"{card['name']} is a Minor Arcana card. The lookup tool covers "
                f"Major Arcana only. Read this card from the suit and numerology "
                f"context already provided in the system prompt, modulated by "
                f"position and orientation."
            ),
            "name": card["name"],
            "arcana": card["arcana"],
            "count": 0,
        }

    chapter = _load_card_chapter(card_id)
    if not chapter:
        return {
            "error": f"no chapter file for {card_id}",
            "name": card["name"],
            "arcana": card["arcana"],
            "count": 0,
        }

    return {
        "name": card["name"],
        "arcana": card["arcana"],
        "text": chapter,
        "count": 1,
    }


_FRAMEWORK_FILES = {
    "core": "framework_core.md",
    "minor": "framework_minor.md",
    "three": "framework_three.md",
}


@lru_cache(maxsize=8)
def _load_framework_file(key: str) -> str:
    path = BOOK_DIR / _FRAMEWORK_FILES[key]
    if not path.exists():
        return ""
    return path.read_text().strip()


_PHASE1_CHEATSHEET = """# Private rank/suit cheatsheet (Phase 1 only)

Use silently to map the querent's plain-language answers to a court card. Do not surface any of this to the querent.

Ranks
- Page: beginner, learning, receiving, new to this territory
- Knight: active pursuit, restless motion, single-minded
- Queen: inward mastery, integrated, holding from the centre
- King: outward authority, established responsibility

Suits
- Wands: drive, will, ambition, project energy
- Cups: feeling, relationship, longing, imagination
- Swords: thought, decision, conflict, hard clarity
- Pentacles: body, work, money, material building
"""


def load_framework(spread_type: str | None) -> str:
    # Phase 1 / 1b / 1c — no spread drawn yet. Keep the prompt small so the
    # model doesn't treat the framework as material to recite. Just the
    # private cheatsheet for silent mapping.
    if spread_type is None:
        return _PHASE1_CHEATSHEET.strip()

    parts = [_load_framework_file("core"), _load_framework_file("minor")]
    if spread_type in _FRAMEWORK_FILES and spread_type not in ("core", "minor"):
        extra = _load_framework_file(spread_type)
        if extra:
            parts.append(extra)
    parts.append("# Suit Reference\n\n" + load_suits_text())
    parts.append(load_numerology_text())
    return "\n\n---\n\n".join(p for p in parts if p)
