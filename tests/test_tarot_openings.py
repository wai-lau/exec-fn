"""Pre-generated /tarot opening turns — the pure store logic.

The clips are served by id as a PATH COMPONENT (`/api/tarot/opening/<id>.wav`),
so the id shape is the whole traversal defence: these pin that `clip_id_ok`
rejects anything that is not `h<HH>-<8 hex>`, the same structural guarantee
gamesave_store makes with its sha256 path component.

The rest is the pick and the top-up arithmetic the nightly check runs on.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from tarot.openings import (clip_id_ok, drop_oldest, empty_index, hour_key,  # noqa: E402
                            pick_clip, shortfall, total_clips)
from tarot.openings_loop import _verdict  # noqa: E402


def _index(**hours):
    idx = empty_index()
    for k, clips in hours.items():
        idx["hours"][k] = clips
    return idx


def _clip(i, created="2026-09-19T00:00:00"):
    return {"id": f"h03-{i:08x}", "text": f"opening {i}", "created": created}


# ── the id is the traversal defence ──────────────────────────────────────────
def test_well_formed_id_accepted():
    assert clip_id_ok("h03-9b499eeb")
    assert clip_id_ok("h00-00000000")
    assert clip_id_ok("h23-ffffffff")


def test_traversal_rejected():
    assert not clip_id_ok("../../etc/passwd")
    assert not clip_id_ok("h03-9b499eeb/../../rd")
    assert not clip_id_ok("h03-9b499eeb.json")


def test_off_shape_ids_rejected():
    assert not clip_id_ok("")
    assert not clip_id_ok(None)
    assert not clip_id_ok("h24-9b499eeb")      # not an hour
    assert not clip_id_ok("h3-9b499eeb")       # hour not zero-padded
    assert not clip_id_ok("h03-9B499EEB")      # hex is lower-case by construction
    assert not clip_id_ok("h03-9b499ee")       # too short
    assert not clip_id_ok("h03-9b499eebb")     # too long


# ── the pick ─────────────────────────────────────────────────────────────────
def test_empty_hour_picks_nothing():
    """None is the signal the page falls back to generating the opening live."""
    assert pick_clip(empty_index(), 3) is None


def test_pick_comes_from_the_asked_hour():
    idx = _index(**{"03": [_clip(1), _clip(2)]})
    for _ in range(20):
        assert pick_clip(idx, 3)["id"] in {_clip(1)["id"], _clip(2)["id"]}
    assert pick_clip(idx, 4) is None


def test_hour_wraps_rather_than_raising():
    """The hour arrives from a client clock; a wrapped hour beats a 500."""
    idx = _index(**{"03": [_clip(1)]})
    assert hour_key(27) == "03"
    assert pick_clip(idx, 27)["id"] == _clip(1)["id"]
    assert hour_key(-1) == "23"


# ── the top-up arithmetic ────────────────────────────────────────────────────
def test_shortfall_counts_every_hour_under_target():
    idx = _index(**{"03": [_clip(i) for i in range(10)], "04": [_clip(99)]})
    short = dict(shortfall(idx, target=10))
    assert "03" not in short          # full
    assert short["04"] == 9
    assert short["00"] == 10
    assert len(short) == 23


def test_total_counts_all_hours():
    idx = _index(**{"03": [_clip(1), _clip(2)], "04": [_clip(3)]})
    assert total_clips(idx) == 3


def test_drop_oldest_drops_by_creation_order():
    idx = _index(**{"03": [
        _clip(1, "2026-01-01T00:00:00"),
        _clip(2, "2026-06-01T00:00:00"),
        _clip(3, "2026-09-01T00:00:00"),
    ]})
    dropped = drop_oldest(idx, 3, 2)
    assert dropped == [_clip(1)["id"], _clip(2)["id"]]
    assert [c["id"] for c in idx["hours"]["03"]] == [_clip(3)["id"]]


# ── the nightly verdict: three ways to be quiet, not one ─────────────────────
def _probe(ok=False, error="tts upstream unreachable", first_ms=None):
    return {"ok": ok, "error": error, "first_ms": first_ms, "total_ms": 500, "audio_s": 2.2}


def test_a_working_voice_reads_ok():
    assert _verdict(_probe(ok=True, error=None, first_ms=362), "idle").startswith("OK  ")


def test_slow_first_audio_is_flagged_but_still_ok():
    """A synth that worked is not a failure — but 4s to first audio on a box
    that should be warm is the cold load this whole feature exists to avoid."""
    assert _verdict(_probe(ok=True, error=None, first_ms=4000), "homo").startswith("OK  SLOW")


def test_a_deliberately_stopped_server_is_not_a_fault():
    assert _verdict(_probe(), "idle").startswith("voice down (mode=idle)")
    assert _verdict(_probe(), "emo").startswith("voice down (mode=emo)")


def test_an_unreachable_box_is_reported_as_unreachable_not_as_stopped():
    """`gone` means the box never answered — asleep, off, or its tunnel down.
    Calling that a deliberate stop sends the reader looking in the wrong place."""
    line = _verdict(_probe(), "gone")
    assert line.startswith("voice unreachable (mode=gone)")
    assert "tunnel" in line


def test_homo_serving_nothing_is_the_loud_one():
    assert _verdict(_probe(), "homo").startswith("FAIL (mode=homo)")
