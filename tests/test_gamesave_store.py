"""Per-caller gamesave scoping — the pure path/identity logic.

Regression suite for the 2026-09-01 leak: the slots were three GLOBAL files on
the guest tier, so any Turnstile-solving visitor read the owner's save into
their browser and pushed their own progress back over it. Every test here is a
property that had to hold to prevent that.

The model: the owner's save is permanent at the original paths; each guest's
save is tied to their nf_save cookie.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from pathlib import Path  # noqa: E402

from gamesave_store import (  # noqa: E402
    GUEST_DIR_NAME,
    VALID_SLOTS,
    guest_id_or_new,
    is_valid_guest_id,
    is_valid_slot,
    new_guest_id,
    slot_path,
    sweep_stale_guest_saves,
)

DATA = Path("/data")


# ── the leak itself ──────────────────────────────────────────────────────────


def test_guest_never_shares_a_path_with_the_owner():
    """THE bug. A guest's slot must not resolve to the owner's file."""
    for slot in VALID_SLOTS:
        owner = slot_path(DATA, slot, None)
        guest = slot_path(DATA, slot, "guest-abcdefghijklmnop")
        assert owner != guest


def test_two_guests_never_share_a_path():
    for slot in VALID_SLOTS:
        a = slot_path(DATA, slot, "aaaaaaaaaaaaaaaaaaaa")
        b = slot_path(DATA, slot, "bbbbbbbbbbbbbbbbbbbb")
        assert a != b


def test_same_guest_is_stable_across_calls():
    """A returning guest must land on the same file, or their save 'vanishes'."""
    gid = "stable-id-0123456789"
    assert slot_path(DATA, "save1", gid) == slot_path(DATA, "save1", gid)


def test_one_guest_keeps_three_distinct_slots():
    gid = "one-guest-0123456789"
    paths = {slot_path(DATA, s, gid) for s in VALID_SLOTS}
    assert len(paths) == len(VALID_SLOTS)


# ── owner paths are unmigrated and permanent ─────────────────────────────────


def test_owner_paths_are_unchanged():
    """The owner's existing saves stay exactly where they already are — the fix
    must not orphan a save that predates it."""
    assert slot_path(DATA, "save1", None) == DATA / "gamesave_save1.json"
    assert slot_path(DATA, "save2", None) == DATA / "gamesave_save2.json"
    assert slot_path(DATA, "save3", None) == DATA / "gamesave_save3.json"


def test_guest_saves_live_under_the_guest_dir():
    p = slot_path(DATA, "save1", "somebody-0123456789")
    assert p.parent == DATA / GUEST_DIR_NAME


# ── traversal: the guest id never reaches the filesystem verbatim ────────────


def test_hostile_guest_ids_cannot_escape_the_guest_dir():
    for hostile in [
        "../../etc/passwd",
        "..",
        "../gamesave_save1",
        "/etc/shadow",
        "a/../../b",
        "\\..\\..\\win",
        "x" * 5000,
        "nul\x00byte",
    ]:
        p = slot_path(DATA, "save1", hostile)
        assert p.parent == DATA / GUEST_DIR_NAME
        assert ".." not in p.parts


def test_guest_path_component_is_always_hex():
    """Structural guarantee: whatever the cookie holds, the filename is
    [0-9a-f]{32}_<slot>.json."""
    for gid in ["../../x", "hello", "x" * 500, "üñïçø∂é", ""]:
        name = slot_path(DATA, "save1", gid).name
        digest, _, rest = name.partition("_")
        assert len(digest) == 32
        assert all(c in "0123456789abcdef" for c in digest)
        assert rest == "save1.json"


def test_hostile_guest_id_cannot_reach_an_owner_file():
    """Even a cookie crafted to look like an owner filename stays contained."""
    for gid in ["gamesave_save1.json", "../gamesave_save1", "gamesave_save1"]:
        assert slot_path(DATA, "save1", gid) != slot_path(DATA, "save1", None)


# ── slot allowlist ───────────────────────────────────────────────────────────


def test_is_valid_slot():
    assert all(is_valid_slot(s) for s in VALID_SLOTS)
    for bad in ["save4", "../rd", "", "SAVE1", "save1.json", "profile"]:
        assert not is_valid_slot(bad)


# ── guest id minting / validation ────────────────────────────────────────────


def test_new_guest_id_is_valid_and_unguessable():
    a, b = new_guest_id(), new_guest_id()
    assert a != b
    assert is_valid_guest_id(a) and is_valid_guest_id(b)


def test_guest_id_or_new_keeps_a_good_cookie():
    gid = new_guest_id()
    got, minted = guest_id_or_new(gid)
    assert got == gid and minted is False


def test_guest_id_or_new_mints_on_junk():
    for junk in [None, "", "short", "../../etc", "x" * 500, 12345, b"bytes", {"a": 1}]:
        got, minted = guest_id_or_new(junk)
        assert minted is True
        assert is_valid_guest_id(got)


def test_junk_cookies_do_not_share_a_bucket():
    """Two callers sending different garbage each get a fresh id, so they don't
    collide in one shared 'invalid' bucket."""
    a, _ = guest_id_or_new("../../etc/passwd")
    b, _ = guest_id_or_new("../../etc/passwd")
    assert a != b


# ── stale-save sweep ─────────────────────────────────────────────────────────


def test_sweep_removes_old_guest_saves_and_spares_fresh_ones(tmp_path):
    gdir = tmp_path / GUEST_DIR_NAME
    gdir.mkdir()
    old = gdir / "deadbeef_save1.json"
    new = gdir / "cafebabe_save1.json"
    old.write_text("{}")
    new.write_text("{}")
    stale = time.time() - 200 * 86400
    os.utime(old, (stale, stale))

    assert sweep_stale_guest_saves(tmp_path, max_age_days=90) == 1
    assert not old.exists()
    assert new.exists()


def test_sweep_never_touches_owner_files(tmp_path):
    """The owner's save is PERMANENT — no age sweeps it."""
    owner = tmp_path / "gamesave_save1.json"
    owner.write_text('{"numCredits":3850}')
    stale = time.time() - 9000 * 86400
    os.utime(owner, (stale, stale))
    (tmp_path / GUEST_DIR_NAME).mkdir()

    sweep_stale_guest_saves(tmp_path, max_age_days=1)
    assert owner.exists()
    assert owner.read_text() == '{"numCredits":3850}'


def test_sweep_is_a_noop_when_no_guest_dir_exists(tmp_path):
    assert sweep_stale_guest_saves(tmp_path) == 0
