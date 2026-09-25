"""The two-pass Exec turn (api/chat_passes.py): ACT with tools, then REPLY without.

Observed 2026-09-24: "hang out with Nick" / "hang out with Jesse" got "Added ...
to the ideas pool" with no tool call and an invented card id. These pin the
properties the split exists for, against a scripted fake client — no network,
no live app:

- act-pass text never reaches Wai; only the reply pass is streamed
- a reply that opens with [redo: ...] is never shown, and re-runs the act pass
  with the instruction
- the server's redo note is not saved as something Wai said
- the redo loop is bounded, and the last reply pass is told it cannot redo
"""
import asyncio
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import chat_passes  # noqa: E402


class _B:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Resp:
    def __init__(self, content):
        self.content = content


class _Stream:
    def __init__(self, chunks):
        self._chunks = chunks

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    @property
    def text_stream(self):
        async def gen():
            for c in self._chunks:
                yield c
        return gen()


class _Client:
    """Scripted: `acts` answers messages.create (act pass), `replies` answers
    messages.stream (reply pass), each in order. Records every call."""

    def __init__(self, acts, replies):
        self.acts, self.replies = list(acts), list(replies)
        self.calls = []
        self.messages = self

    async def create(self, **kw):
        self.calls.append(("act", copy.deepcopy(kw)))
        return self.acts.pop(0)

    def stream(self, **kw):
        self.calls.append(("reply", copy.deepcopy(kw)))
        return _Stream(self.replies.pop(0))


@pytest.fixture(autouse=True)
def _stub(monkeypatch):
    async def system(stage, actions, rules):
        return [{"type": "text", "text": "S"}, {"type": "text", "text": "V" + rules}]

    async def push(_):
        return None

    monkeypatch.setattr(chat_passes, "_system", system)
    monkeypatch.setattr(chat_passes, "push_to_monitor", push)
    monkeypatch.setattr(chat_passes, "schedule_monitor", lambda: None)
    monkeypatch.setattr(chat_passes, "_handle_tool",
                        lambda name, inp: {"ok": True, "id": "card-1", "title": inp.get("title")})


def _run(client, text="hang out with nick"):
    async def go():
        return [ev async for ev in chat_passes.run_turn(client, [{"role": "user", "content": text}])]
    return asyncio.run(go())


def _tool(title):
    return _B(type="tool_use", id="tu_" + title, name="create_card", input={"title": title})


def _shown(events):
    return "".join(e["delta"] for e in events if e["type"] == "text")


def test_act_text_is_discarded_and_reply_is_streamed():
    client = _Client(
        acts=[_Resp([_B(type="text", text="ACT TALK"), _tool("Nick")]), _Resp([])],
        replies=[["Added ", "Nick."]],
    )
    ev = _run(client)
    assert _shown(ev) == "Added Nick."
    assert [e["name"] for e in ev if e["type"] == "tool_call"] == ["create_card"]
    final = ev[-1]
    assert final["type"] == "final"
    saved = str(final["messages"])
    assert "ACT TALK" not in saved
    # reply pass ran with tools CLOSED
    reply_kw = [kw for kind, kw in client.calls if kind == "reply"][0]
    assert reply_kw["tool_choice"] == {"type": "none"}


def test_redo_is_hidden_and_reruns_the_act_pass():
    client = _Client(
        acts=[_Resp([]), _Resp([_tool("Jesse")]), _Resp([])],
        replies=[["[re", "do: create card Hang out with Jesse]"], ["Added Jesse."]],
    )
    ev = _run(client, "hang out with jesse")
    assert _shown(ev) == "Added Jesse."
    assert "redo" not in _shown(ev)
    # the second act pass saw the instruction
    second_act = [kw for kind, kw in client.calls if kind == "act"][1]
    assert "create card Hang out with Jesse" in str(second_act["messages"][-1])
    # ...but it is not saved as Wai's words
    assert chat_passes._NOTE not in str(ev[-1]["messages"])
    assert ev[-1]["messages"][0]["role"] == "user"


def test_redo_loop_is_bounded_and_last_pass_cannot_redo():
    n = chat_passes._MAX_REDOS
    client = _Client(
        acts=[_Resp([])] * (n + 1),
        replies=[["[redo: x]"]] * n + [["It was not done."]],
    )
    ev = _run(client)
    assert _shown(ev) == "It was not done."
    replies = [kw for kind, kw in client.calls if kind == "reply"]
    assert len(replies) == n + 1
    assert chat_passes._REDO not in replies[-1]["system"][1]["text"]
    assert chat_passes._REDO in replies[0]["system"][1]["text"]
    assert "Never claim it." in replies[-1]["system"][1]["text"]


def test_short_reply_that_is_not_a_redo_is_still_shown():
    client = _Client(acts=[_Resp([])], replies=[["[ok]"]])
    assert _shown(_run(client)) == "[ok]"
