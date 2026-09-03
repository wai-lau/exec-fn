"""Regression tests for the Exec turn that announces an action it never takes.

Observed 2026-09-02: Wai said "shadowdark hosting sept 15", Exec called
`create_card` once, and its follow-up turn then claimed a duplicate card had
"already been in the pool from earlier this turn" and said it would exile it.
`rd.json` held exactly ONE Shadowdark card and the activity log carried no
exile — both halves of that sentence were wrong.

Two independent defects:

1. The follow-up turn is offered the tools, but both send paths (the web SSE
   route and the Discord bridge) kept only its TEXT — any `tool_use` it emitted
   was dropped on the floor, never dispatched, never stored. So "I'll exile the
   duplicate" could never become an exile. `assistant_content_blocks` is the
   shared helper that now preserves those blocks so the caller can run another
   round.

2. `create_card` with a due_date logs BOTH a `created` and an `updated` entry
   for the one card. Rendered into the prompt's activity log by title alone,
   that reads as two cards — the phantom duplicate. Entries now carry the card
   id, and the actions block says outright that entries sharing an id are one
   card.

Pure unit tests: no fastapi, no live app.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

from chat_actions import _actions_taken_block  # noqa: E402
from chat_store import assistant_content_blocks  # noqa: E402


class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Msg:
    def __init__(self, content):
        self.content = content


def test_followup_tool_use_survives():
    """A follow-up turn's tool_use must be kept, or the announced action is lost."""
    msg = _Msg([
        _Block(type="text", text="Exiling the duplicate."),
        _Block(type="tool_use", id="tu_1", name="exile_card", input={"card_id": "card-1"}),
    ])
    blocks = assistant_content_blocks(msg)
    assert blocks == [
        {"type": "text", "text": "Exiling the duplicate."},
        {"type": "tool_use", "id": "tu_1", "name": "exile_card", "input": {"card_id": "card-1"}},
    ]


def test_non_text_tool_blocks_dropped():
    """Thinking/other block types are not storable content."""
    msg = _Msg([_Block(type="thinking", thinking="..."), _Block(type="text", text="hi")])
    assert assistant_content_blocks(msg) == [{"type": "text", "text": "hi"}]


def test_actions_block_names_the_created_card():
    block = _actions_taken_block([{
        "name": "create_card",
        "input": {"title": "Host Shadowdark session"},
        "result": {"ok": True, "title": "Host Shadowdark session"},
    }])
    assert "created a NEW card 'Host Shadowdark session'" in block
    assert "because you just made it" in block


def test_actions_block_warns_that_repeat_log_entries_are_one_card():
    """The created+updated pair from ONE create must not read as two cards."""
    block = _actions_taken_block([{
        "name": "create_card", "input": {"title": "X"}, "result": {"ok": True, "title": "X"},
    }])
    assert "[id:...]" in block
    assert "same card, never two" in block


def test_failed_action_is_not_reported_as_taken():
    assert _actions_taken_block([{
        "name": "create_card", "input": {"title": "X"}, "result": {"error": "boom"},
    }]) == ""
    assert _actions_taken_block([]) == ""
