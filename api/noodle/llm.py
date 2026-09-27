"""The minimal Haiku client Ask Noodle uses. Swappable in tests (`call`)."""
import anthropic

from noodle import config

_client = None

# The model writes RULES, not dates (noodle/rules.py applies them). Judging
# each date itself put it through ~50 small arithmetic problems per answer and
# some always slipped; a rule like {"day": [2, 3, 5, 13]} asks it to list a
# number set ONCE, and code does the checking. `reading` is its one-sentence
# restatement of what it understood, shown to the voter, so a misreading of
# ambiguous wording ("prime and fibonacci": both? either?) is visible.
SLOT_TOOL = {
    "name": "select_slots",
    "description": "Restate the availability in one sentence, then express it as ordered rules.",
    "input_schema": {
        "type": "object",
        "properties": {
            "reading": {
                "type": "string",
                "description": ("One plain sentence of what you understood, naming any number "
                                "sets you used, e.g. 'Friday nights, plus all day on days that are "
                                "both prime and Fibonacci (2, 3, 5, 13)'."),
            },
            "rules": {
                "type": "array",
                "description": "Applied in order to an EMPTY calendar: add unions, remove subtracts.",
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": ["add", "remove"]},
                        "blocks": {"type": "array", "items": {"type": "string", "enum": ["midday", "night"]}},
                        "where": {
                            "type": "object",
                            "description": (
                                'Exactly one key: {"every": true} | {"weekday": ["friday"]} | '
                                '{"day": [day-of-month ints]} | {"month": [ints]} | '
                                '{"date": ["YYYY-MM-DD"]} | {"holiday": true} | '
                                '{"holiday_within": n} (a holiday in the next n days) | '
                                '{"holiday_since": n} (a holiday in the previous n days) | '
                                '{"all": [conds]} | {"any": [conds]} | {"not": cond}'),
                        },
                    },
                    "required": ["action", "blocks", "where"],
                },
            },
            "crop": {
                "type": "object",
                "description": ("ONLY when they ask to see or limit the calendar to a span "
                                "('just october', 'the next three weeks'): the first and last "
                                "date to show. Omit otherwise."),
                "properties": {"from": {"type": "string"}, "to": {"type": "string"}},
                "required": ["from", "to"],
            },
        },
        "required": ["reading", "rules"],
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
