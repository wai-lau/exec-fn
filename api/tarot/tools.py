from tarot.cards import CARDS_BY_ID
from tarot.lookup import lookup_card_meaning

TOOLS = [
    {
        "name": "lookup_card_meaning",
        "description": (
            "Fetch Pollack's per-card chapter for a Major Arcana card. "
            "MAJOR ARCANA ONLY — the 22 trumps (the_fool, the_magician, "
            "the_high_priestess, the_empress, the_emperor, the_hierophant, "
            "the_lovers, the_chariot, strength, the_hermit, wheel_of_fortune, "
            "justice, the_hanged_man, death, temperance, the_devil, the_tower, "
            "the_star, the_moon, the_sun, judgement, the_world). For Minor "
            "Arcana cards (cups/wands/swords/pentacles), do NOT call this — "
            "read the card from the suit and numerology context already in "
            "the system prompt. Always call this tool for each revealed Major "
            "Arcana card before interpreting it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "description": "Major Arcana snake-case id, e.g. 'the_fool', 'death', 'the_world'.",
                }
            },
            "required": ["card_id"],
        },
    },
    {
        "name": "deal_spread",
        "description": (
            "Deal a Three-Card spread for the querent. Call this once you have "
            "moved through Phase 1b — the query is understood, the heart of "
            "what they're asking has been named back, and you are ready to "
            "draw. The frontend will deal the three cards face-down. After "
            "this you'll receive [drew a Three-Card spread; ...] and proceed "
            "to Phase 2 (frame + first-flip instruction)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "set_significator",
        "description": (
            "Set the querent's Significator. Call this ONLY after asking at "
            "least 3 narrowing questions in Phase 1 and the querent's answers "
            "have given you enough information to confidently pick one of the "
            "16 court cards. The frontend will fill the Significator slot "
            "automatically when this call returns. Do not announce the call "
            "as a tool — narrate it naturally ('I'm picking the Queen of "
            "Swords for you'). Then proceed to Phase 1b in the same response."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "description": (
                        "Court card snake-case id — exactly one of: "
                        "page_of_cups, knight_of_cups, queen_of_cups, king_of_cups, "
                        "page_of_wands, knight_of_wands, queen_of_wands, king_of_wands, "
                        "page_of_swords, knight_of_swords, queen_of_swords, king_of_swords, "
                        "page_of_pentacles, knight_of_pentacles, queen_of_pentacles, king_of_pentacles."
                    ),
                }
            },
            "required": ["card_id"],
        },
    },
]


def _set_significator(inp: dict) -> dict:
    card_id = inp.get("card_id", "")
    card = CARDS_BY_ID.get(card_id)
    if not card or card.get("arcana") != "minor" or card.get("number", 0) < 11:
        return {"error": f"not a court card: {card_id}", "count": 0}
    return {
        "ok": True,
        "card_id": card_id,
        "name": card["name"],
        "image": card["image"],
        "count": 1,
    }


def _deal_spread(_inp: dict) -> dict:
    return {"ok": True, "count": 1}


TOOL_FNS = {
    "lookup_card_meaning": lambda inp: lookup_card_meaning(inp.get("card_id", "")),
    "set_significator": _set_significator,
    "deal_spread": _deal_spread,
}
