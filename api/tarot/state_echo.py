"""Keep the reader's private `[State: ...]` note away from the querent.

routes._build_spread_preamble hands the reader a per-turn `[State: ...]` note
(the Phase 1 turn count); the model sometimes parrots it as the first line of
its reply. StateEchoFilter strips it from the live stream (agent.stream_chat);
scrub_state_echo strips it from replies already stored in a querent's
localStorage before they go back as history, where they would teach the reader
to keep echoing it.
"""
import re

_STATE_TAG = "[State:"
_STATE_ECHO_RE = re.compile(r"^\s*\[State:[^\]]*\]\s*")


class StateEchoFilter:
    """Swallow a leading `[State: ...]` from one round of streamed text.

    Text is held only while it could still BE that prefix, so a normal reply
    streams with no added latency beyond its first few characters."""

    def __init__(self):
        self._held = ""
        self._decided = False
        self._trim = False  # after a swallowed note, drop whitespace until prose

    def feed(self, text: str) -> str:
        if self._decided:
            if self._trim:
                text = text.lstrip()
                self._trim = not text
            return text
        self._held += text
        head = self._held.lstrip()
        if head.startswith(_STATE_TAG):
            end = head.find("]")
            if end < 0:
                return ""
            self._decided, self._held, self._trim = True, "", True
            return self.feed(head[end + 1:])
        if _STATE_TAG.startswith(head):
            return ""
        self._decided = True
        out, self._held = self._held, ""
        return out

    def flush(self) -> str:
        # A round that ended mid-candidate: a bare "[Sta" is prose, an
        # unterminated "[State: ..." is still the note.
        out, self._held = self._held, ""
        if self._decided or out.lstrip().startswith(_STATE_TAG):
            return ""
        return out


def scrub_state_echo(messages: list) -> list:
    """Drop a parroted `[State: ...]` from the start of past reader turns."""
    out = []
    for m in messages:
        c = m.get("content")
        if m.get("role") == "assistant" and isinstance(c, str) and _STATE_ECHO_RE.match(c):
            m = {**m, "content": _STATE_ECHO_RE.sub("", c, count=1)}
        out.append(m)
    return out
