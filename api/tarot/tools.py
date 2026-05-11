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
]

TOOL_FNS = {
    "lookup_card_meaning": lambda inp: lookup_card_meaning(inp.get("card_id", "")),
}
