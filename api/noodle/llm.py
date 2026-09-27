"""The minimal Haiku client Ask Noodle uses. Swappable in tests (`call`)."""
import anthropic

from noodle import config

_client = None

SLOT_TOOL = {
    "name": "select_slots",
    "description": "Return the full set of (date, block) slots the voter is available for.",
    "input_schema": {
        "type": "object",
        "properties": {
            "slots": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "date": {"type": "string", "description": "YYYY-MM-DD"},
                        "block": {"type": "string", "enum": list(config.BLOCKS)},
                    },
                    "required": ["date", "block"],
                },
            },
        },
        "required": ["slots"],
    },
}


def call(system: str, user: str) -> dict:
    """One forced tool call; returns the tool input dict (unvalidated -- the
    caller validates and clamps). Reads ANTHROPIC_API_KEY from the env."""
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    msg = _client.messages.create(
        model=config.ASK_MODEL,
        max_tokens=config.ASK_MAX_TOKENS,
        system=system,
        tools=[SLOT_TOOL],
        tool_choice={"type": "tool", "name": SLOT_TOOL["name"]},
        messages=[{"role": "user", "content": user}],
    )
    for block in msg.content:
        if getattr(block, "type", "") == "tool_use":
            return block.input if isinstance(block.input, dict) else {}
    return {}
