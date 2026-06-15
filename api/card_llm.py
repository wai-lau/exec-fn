"""Card-creation LLM helpers: classify a new card's category + importance, and
parse a natural-language due date into ISO. Used by the card API endpoints —
kept out of chat.py because they're one-shot card utilities, not part of the
exec-chat conversation."""
from datetime import datetime

from helpers import _parse_json, ET


def classify_card(title: str) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=256,
        messages=[{"role": "user", "content": (
            f'Categorize this personal task for Wai: "{title}"\n\n'
            "Categories (pick one):\n"
            "- Interfacing: personal admin, organization, home improvement, taking care of parents or partner, work, productivity systems, tech tools\n"
            "- Hobby: crafts, creative projects, making things, cosplay, gaming, art\n"
            "- Social: events, social plans, gatherings, helping friends\n"
            "- Self: self-care, self-improvement, personal wellness, mental health, reading, studying, long-form learning, research\n\n"
            "Importance (pick one):\n"
            "- wisp: trivial, quick, low-stakes\n"
            "- idea: ordinary, moderate importance\n"
            "- plan: significant, matters\n"
            "- commitment: critical, high-stakes\n\n"
            'JSON only: {"category": "...", "size": "..."}'
        )}],
    )
    try:
        parsed = _parse_json(msg.content[0].text)
    except Exception:
        parsed = {}
    return {
        "category": parsed.get("category", "Self"),
        "size": parsed.get("size", "idea"),
    }


def parse_date_natural(text: str, size: str | None = None, estimated_minutes: int | None = None) -> str | None:
    import anthropic
    now = datetime.now(ET)
    today = now.strftime("%Y-%m-%d %H:%M")
    duration_hint = ""
    if estimated_minutes:
        duration_hint = f" The task takes ~{estimated_minutes} minutes."
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=64,
        system=(
            f"Now is {today} ET.{duration_hint} "
            "Parse the due date from user input. "
            "All dates MUST be in the future (after today). If a relative term like 'this weekend' or 'Monday' refers to a date already passed, use the NEXT occurrence. "
            "Reply with ONLY one ISO 8601 string: the due date/datetime. "
            "Use YYYY-MM-DD or YYYY-MM-DDTHH:MM format. Reply 'null' if not applicable."
        ),
        messages=[{"role": "user", "content": text}],
    )
    import re as _re
    _iso_pat = _re.compile(r'^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$')

    def _valid(s: str) -> str | None:
        s = s.strip()
        return s if s and s != "null" and _iso_pat.match(s) else None

    lines = msg.content[0].text.strip().splitlines()
    due = _valid(lines[0]) if lines else None
    return due
