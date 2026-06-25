"""Second-pass persona restyle for the tarot reader.

The reader (opus) produces the canonical reading text; for a non-default
persona this re-voices that text in the persona's voice via a cheap haiku
call, streamed. The card SUBSTANCE is locked by the preservation rules below
-- a persona changes the telling, never the reading.
"""
from typing import AsyncGenerator

_RESTYLE_MODEL = "claude-haiku-4-5"

# Appended after the persona's voice brief. Locks substance; voice is free.
_PRESERVE = """=== YOUR TASK ===

Re-voice the CANONICAL READING TEXT below in your persona voice. This is a
performance skin over a real tarot reading: the voice is yours, the content is
not. Often the text is a full card reading. Just as often it is a single
question to the querent, or a line of dialogue with no cards at all.

HARD RULE -- INVENT NOTHING (most important rule here):
You may reference ONLY the cards, positions, orientations, and meanings that
literally appear in the text below. If the text names no card, your output names
no card. NEVER introduce a card, a spread, a draw, a position, or a tarot meaning
that is not already in the text. If the text is just a question or just dialogue,
re-voice ONLY that and invent nothing. Manufacturing cards or readings that were
not handed to you is the single worst thing you can do in this task.

PRESERVE (must survive exactly):
- Every card named stays named, kept in **bold** exactly as written.
- Each named card's position, orientation (upright/reversed), and core meaning --
  which card is saying what -- stays true. Re-voice the interpretation; never
  swap it, soften it into something else, or invent a different meaning.
- If the text ends by inviting the querent to turn a named position (e.g. "turn
  the **Present**"), keep that same invite and that same position in your voice.
- If the WHOLE text is a single short question to the querent, output a single
  short question, under ~30 words, ending in `?` -- and naming no cards.
- If the text otherwise ends in a question to the querent, your version still
  ends by asking that question (ending in `?`).
- Keep the paragraph breaks. Markdown only. No emoji. No links.

FREE (this is where your persona lives):
- Wrap whatever you were given in your characteristic attitude, asides, framing.
- Add persona flavor AROUND the substance -- but invent no tarot content.

Output ONLY the re-voiced text. No preamble, no "here is", no quotation marks
around it, no notes about what you changed.

=== CANONICAL READING TEXT ===
"""

# Opening turn: deliver the persona's own opening (not the reader's atmospheric
# image). The opening may be written as literal lines OR as a set of beats /
# instructions; this prompt handles both. Source = the opener, so the card
# scaffold above is bypassed entirely (an opening is not a card reading).
_OPENER_PRESERVE = """=== YOUR TASK: OPEN THE READING ===

Below is your opening for the very first turn of a reading. Deliver it in your
voice. If it is written as a set of BEATS or INSTRUCTIONS, follow that shape and
fill it in your own words, varying the changeable parts so two visits never read
the same. If it is written as LITERAL lines, keep them, varying only small
wording. Either way: this opens the reading and MUST end by asking the querent a
question (ending in "?"). Add no tarot cards. Keep it short.

Output ONLY the spoken opening. No preamble, no quotation marks, no notes.

=== YOUR OPENING ===
"""


async def restyle_stream(
    text: str, brief: str, opener: str | None = None
) -> AsyncGenerator[str, None]:
    """Yield the persona-voiced rewrite of `text` as text deltas. With `opener`
    set, the opening turn delivers the persona's own opener (varied) instead of
    re-voicing the reader's atmospheric image."""
    import anthropic

    client = anthropic.AsyncAnthropic()
    if opener:
        system = brief + "\n\n" + _OPENER_PRESERVE
        source = opener
    else:
        system = brief + "\n\n" + _PRESERVE
        source = text
    try:
        async with client.messages.stream(
            model=_RESTYLE_MODEL,
            max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": source}],
        ) as stream:
            async for delta in stream.text_stream:
                yield delta
    except Exception:
        # Restyle failed -- fall back to the persona opener / canonical reader
        # text so the reading is never lost to a persona-layer error.
        yield opener or text
