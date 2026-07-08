from mtg.lookup import lookup_card, lookup_rule, lookup_rulings

TOOLS = [
    {
        "name": "lookup_card",
        "description": "Look up a Magic card by name. Returns ALL of the card's info in one call: oracle text, type line, mana cost, keywords, oracle_id, AND the card's official WotC rulings (bundled inline as `rulings` — no separate lookup_rulings call needed). Read the rulings every time; they often decide the interaction and override reasoning from oracle text alone.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Card name, e.g. 'Lightning Bolt', 'Deathtouch'"}
            },
            "required": ["name"],
        },
    },
    {
        "name": "lookup_rulings",
        "description": "Fallback only — lookup_card already bundles a card's rulings. Use this solely when you hold a bare oracle_id (from context, not a fresh lookup_card). Returns official WotC judge rulings for that oracle_id.",
        "input_schema": {
            "type": "object",
            "properties": {
                "oracle_id": {"type": "string", "description": "oracle_id from lookup_card result"}
            },
            "required": ["oracle_id"],
        },
    },
    {
        "name": "lookup_rule",
        "description": "Search the MTG Comprehensive Rules. Pass a rule number (e.g. '702.2', '702') to get that rule and subrules. Pass keywords (e.g. 'deathtouch', 'trample combat damage') to find matching rules.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Rule number (e.g. '702', '702.2') or keywords to search"}
            },
            "required": ["query"],
        },
    },
]

TOOL_FNS = {
    "lookup_card": lambda inp: lookup_card(inp.get("name", "")),
    "lookup_rulings": lambda inp: lookup_rulings(inp.get("oracle_id", "")),
    "lookup_rule": lambda inp: lookup_rule(inp.get("query", "")),
}
