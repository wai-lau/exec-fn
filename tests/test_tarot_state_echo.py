"""The reader must never show the querent its private `[State: ...]` note."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

from tarot.state_echo import StateEchoFilter, scrub_state_echo  # noqa: E402

ECHO = "[State: Phase 1 turn count = 5.] You've said enough."


def _run(chunks):
    f = StateEchoFilter()
    return "".join(f.feed(c) for c in chunks) + f.flush()


def test_leading_state_note_swallowed_across_chunks():
    chunks = ["[St", "ate: Phase 1 turn ", "count = 5.]", " You've said", " enough."]
    assert _run(chunks) == "You've said enough."


def test_whole_note_in_one_chunk():
    assert _run([ECHO]) == "You've said enough."


def test_normal_prose_untouched():
    assert _run(["When the ground ", "gave, [the face] came back."]) == "When the ground gave, [the face] came back."


def test_short_bracket_prose_survives_flush():
    assert _run(["[St"]) == "[St"


def test_unterminated_note_dropped():
    assert _run(["[State: Phase 1 turn"]) == ""


def test_history_scrubbed_only_on_assistant():
    msgs = [
        {"role": "user", "content": "[opened /tarot]"},
        {"role": "assistant", "content": ECHO},
        {"role": "user", "content": "[State: user text stays]"},
    ]
    out = scrub_state_echo(msgs)
    assert out[1]["content"] == "You've said enough."
    assert out[2]["content"] == "[State: user text stays]"
    assert msgs[1]["content"] == ECHO  # input not mutated
