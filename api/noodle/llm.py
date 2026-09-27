"""The minimal Haiku client Ask Noodle uses. Swappable in tests (`call`)."""
import anthropic

from noodle import config

_client = None

# One line per window date, decided ONE DATE AT A TIME:
#   "2026-10-13 tue: never tuesdays -> -"
# Returning two date LISTS instead let the model state the rule correctly and
# then list dates that broke it (Tuesdays and even days in an "odd days, never
# Tuesdays" answer, measured): writing each date's own reason next to its
# verdict is what makes it actually look at that date. Code parses the verdict
# off the end of each line (ask._pairs), so the reasoning costs nothing to trust.
SLOT_TOOL = {
    "name": "select_slots",
    "description": "Decide every listed date, one line each, in order.",
    "input_schema": {
        "type": "object",
        "properties": {
            "days": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    'One entry per listed date: "<YYYY-MM-DD> <weekday>: <why, a few '
                    'words> -> <verdict>", verdict one of m (midday), n (night), '
                    'mn (both), - (neither).'),
            },
        },
        "required": ["days"],
    },
}


class Truncated(Exception):
    """The answer did not fit in ASK_MAX_TOKENS -- a partial tool call is not
    an answer, and parsing one silently filled the grid with nothing."""


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
    if msg.stop_reason == "max_tokens":
        raise Truncated()
    for block in msg.content:
        if getattr(block, "type", "") == "tool_use":
            return block.input if isinstance(block.input, dict) else {}
    return {}
