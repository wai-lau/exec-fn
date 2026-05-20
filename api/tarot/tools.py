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
            "Deal a Three-Card spread for the querent. Call this at the end "
            "of Phase 2 once the query is understood and you have named back "
            "the heart of it plus the chosen frame. MANDATORY — without this "
            "tool call the spread never gets dealt and the reading stalls. "
            "Narrating 'let me set the cards' is not a substitute. You MUST "
            "pass the `frame` argument and it MUST match the frame you just "
            "named to the querent. The frontend uses this to label the "
            "positions correctly in the UI."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "frame": {
                    "type": "string",
                    "enum": ["past_present_future", "situation_obstacle_advice"],
                    "description": (
                        "Which frame the three positions speak in. "
                        "`situation_obstacle_advice` is the default — use it "
                        "for any live deliberation, weighing, stuckness, fork, "
                        "implied next move, or actionable question. "
                        "`past_present_future` ONLY for explicitly "
                        "retrospective or closure-shaped questions: grief, "
                        "mourning, a chapter already ended, 'what was that'. "
                        "Must match the frame you named in the same response."
                    ),
                }
            },
            "required": ["frame"],
        },
    },
    {
        "name": "set_significator",
        "description": (
            "Set the querent's Significator. Call this on the Phase 1 exit "
            "turn — after asking at least five narrowing questions and the "
            "answers have given you enough to confidently pick one of the 16 "
            "court cards. MANDATORY on the exit turn — without this call the "
            "Significator is never set and the flow stalls. The frontend "
            "fills the Significator slot automatically when this returns. Do "
            "not announce the call as a tool — narrate it naturally ('I'm "
            "picking the Queen of Swords for you'). Then proceed to the "
            "Phase 2 opening question in the same response."
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


def _deal_spread(inp: dict) -> dict:
    frame = inp.get("frame")
    if frame not in ("past_present_future", "situation_obstacle_advice"):
        return {
            "error": (
                f"frame is required and must be one of "
                f"'past_present_future' or 'situation_obstacle_advice'; got {frame!r}. "
                "Retry deal_spread with the frame matching what you just named to the querent."
            ),
            "count": 0,
        }
    return {"ok": True, "frame": frame, "count": 1}


TOOL_FNS = {
    "lookup_card_meaning": lambda inp: lookup_card_meaning(inp.get("card_id", "")),
    "set_significator": _set_significator,
    "deal_spread": _deal_spread,
}
