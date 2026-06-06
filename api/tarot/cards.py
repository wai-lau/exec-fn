_MAJORS = [
    ("the_fool", "The Fool", 0),
    ("the_magician", "The Magician", 1),
    ("the_high_priestess", "The High Priestess", 2),
    ("the_empress", "The Empress", 3),
    ("the_emperor", "The Emperor", 4),
    ("the_hierophant", "The Hierophant", 5),
    ("the_lovers", "The Lovers", 6),
    ("the_chariot", "The Chariot", 7),
    ("strength", "Strength", 8),
    ("the_hermit", "The Hermit", 9),
    ("wheel_of_fortune", "Wheel of Fortune", 10),
    ("justice", "Justice", 11),
    ("the_hanged_man", "The Hanged Man", 12),
    ("death", "Death", 13),
    ("temperance", "Temperance", 14),
    ("the_devil", "The Devil", 15),
    ("the_tower", "The Tower", 16),
    ("the_star", "The Star", 17),
    ("the_moon", "The Moon", 18),
    ("the_sun", "The Sun", 19),
    ("judgement", "Judgement", 20),
    ("the_world", "The World", 21),
]

_SUITS = ["cups", "wands", "pentacles", "swords"]
_SUIT_LABEL = {"cups": "Cups", "wands": "Wands", "pentacles": "Pentacles", "swords": "Swords"}

_PIPS = [
    ("ace", "Ace", 1),
    ("two", "Two", 2),
    ("three", "Three", 3),
    ("four", "Four", 4),
    ("five", "Five", 5),
    ("six", "Six", 6),
    ("seven", "Seven", 7),
    ("eight", "Eight", 8),
    ("nine", "Nine", 9),
    ("ten", "Ten", 10),
]

_COURTS = [
    ("page", "Page", 11),
    ("knight", "Knight", 12),
    ("queen", "Queen", 13),
    ("king", "King", 14),
]


def _build_cards() -> list[dict]:
    out = []
    for cid, name, num in _MAJORS:
        out.append({
            "id": cid,
            "name": name,
            "arcana": "major",
            "suit": None,
            "number": num,
            "image": f"/tarot/cards/{cid}.jpg?v=3",
        })
    for suit in _SUITS:
        for pip_id, pip_name, pip_num in _PIPS + _COURTS:
            cid = f"{pip_id}_of_{suit}"
            out.append({
                "id": cid,
                "name": f"{pip_name} of {_SUIT_LABEL[suit]}",
                "arcana": "minor",
                "suit": suit,
                "number": pip_num,
                "image": f"/tarot/cards/{cid}.jpg?v=3",
            })
    return out


CARDS = _build_cards()
CARDS_BY_ID = {c["id"]: c for c in CARDS}

assert len(CARDS) == 78, f"expected 78 cards, got {len(CARDS)}"
