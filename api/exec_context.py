"""Exec's prompt, split for the Claude Code sidecar.

Phase 2 of docs/plan-exec-cc-merge.md: the sidecar agent speaks as Exec. Its
system prompt must stay byte-stable across turns or the prefix stops caching,
so the prompt is split the same way the in-container chat splits it:

  system_prompt()  -- the static prefix (identity, GLaDOS voice, global rules),
                      served to the sidecar once per run by GET /api/exec/prompt.
  wrap(prompt)     -- everything that changes per turn (today, the board, open
                      nudges, known context), prepended to Wai's message inside
                      an <exec-context> block.

The block stays in the stored transcript -- that is where the SDK keeps user
turns -- so the sidecar strips it wherever the transcript is shown or archived
(historyFor in claude-box/server.mjs). The tag is the contract between the two:
change it in both places.
"""

import asyncio

from chat import _CHAT_STATIC_PREFIX, _turn_context

OPEN = "<exec-context>"
CLOSE = "</exec-context>"


def system_prompt() -> str:
    return _CHAT_STATIC_PREFIX


async def wrap(prompt: str) -> str:
    """Wai's message with the current board state in front of it. Reads rd.json
    and profile.json, so it runs off the event loop."""
    ctx = await asyncio.to_thread(_turn_context, "planning")
    return f"{OPEN}\n{ctx}\n{CLOSE}\n\n{prompt}"
