from tarot.lookup import lookup_card_meaning

TOOLS = [
    {
        "name": "lookup_card_meaning",
        "description": "Look up Rachel Pollack's interpretation of a tarot card. Returns the per-card chapter from Seventy-Eight Degrees of Wisdom (or, for Minor Arcana without a dedicated chapter, the suit and number summary). Always call this for each revealed card before interpreting it.",
        "input_schema": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "description": "The card's snake-case id, e.g. 'the_fool', 'ace_of_cups', 'two_of_swords'.",
                }
            },
            "required": ["card_id"],
        },
    },
]

TOOL_FNS = {
    "lookup_card_meaning": lambda inp: lookup_card_meaning(inp.get("card_id", "")),
}
