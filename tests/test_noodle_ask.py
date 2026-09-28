"""Ask noodle: the model is faked (noodle.llm.call), so these pin the rate
limits and the schema validation without spending a token -- and that noodle
works on the PAGE's state alone: it never reads or writes a poll.

Limits are ROLLING WINDOWS, never lifetime caps. Every rate is a config
constant the tests read, and time is a monkeypatched clock, so a window
refilling is tested directly rather than slept through.
"""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from noodle_helpers import make_poll  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
pytest.importorskip("anthropic")


def _pub(i: int) -> str:
    return base64.b64encode(bytes([i]) * 32).decode()


@pytest.fixture
def env(monkeypatch, tmp_path):
    from noodle import ask, config, llm, store
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    ask._hits.clear()
    clock = [1000.0]
    monkeypatch.setattr(ask.time, "monotonic", lambda: clock[0])
    calls = []

    def fake(system, user):
        calls.append((system, user))
        return fake.reply
    fake.reply = {"reading": "Friday nights.",
                  "rules": [{"action": "add", "blocks": ["night"], "where": {"weekday": ["friday"]}}]}
    monkeypatch.setattr(llm, "call", fake)
    slug = make_poll(store, "t", "2026-10-01", "2026-10-10")
    return {"ask": ask, "config": config, "slug": slug, "calls": calls, "fake": fake, "clock": clock}


OCT = [f"2026-10-{d:02d}" for d in range(1, 11)]


def go(env, text="thursday night", pub=None, ip="203.0.113.1", current=None, dates=None, halves=True):
    return env["ask"].ask(env["slug"], {"text": text, "pub": pub, "current": current or [],
                                        "dates": OCT if dates is None else dates, "halves": halves}, ip)


def status(env, **kw):
    with pytest.raises(env["ask"].AskError) as e:
        go(env, **kw)
    return e.value


def test_valid_output_fills(env):
    out = go(env)
    assert out == {"slots": ["2026-10-02:n", "2026-10-09:n"], "reading": "Friday nights.",
                   "dropped": 0, "crop": None, "split": False}
    assert len(env["calls"]) == 1


def test_rules_apply_only_inside_the_view_and_bad_rules_are_dropped(env):
    env["fake"].reply = {"reading": "x", "rules": [
        {"action": "add", "blocks": ["midday"], "where": {"date": ["2026-09-30", "2026-10-06"]}},
        {"action": "add", "blocks": ["night"], "where": {"weekday": ["funday"]}},       # bad
        {"action": "add", "blocks": ["evening"], "where": {"every": True}},             # bad
        {"action": "wipe", "blocks": ["night"], "where": {"every": True}},              # bad
        {"action": "add", "blocks": ["night"], "where": {"day": [7]}},
    ]}
    out = go(env)
    assert out["slots"] == ["2026-10-06:m", "2026-10-07:n"] and out["dropped"] == 3


@pytest.mark.parametrize("reply", [None, {}, {"rules": "all"}, {"rules": [1, 2]}, "junk",
                                   {"days": ["2026-10-02 Friday: yes -> n"]}])
def test_schema_invalid_output_discarded(env, reply):
    env["fake"].reply = reply
    out = go(env)
    assert out["slots"] == [] and out["reading"] == ""


def test_input_length_cap_spends_nothing(env):
    cap = env["config"].ASK_MAX_CHARS
    assert status(env, text="x" * (cap + 1)).status == 400
    assert status(env, text="   ").status == 400
    assert env["calls"] == []
    assert go(env, text="x" * cap)["slots"]


def test_needs_no_name(env):
    # asking needs no key at all: without one the asker is simply not the host
    assert go(env, pub="not-a-key")["slots"]
    assert go(env, pub=None)["slots"]


def test_there_is_no_per_person_limit(env):
    assert not hasattr(env["config"], "ASK_VOTER_RATE")


def test_retry_after_is_the_time_until_the_oldest_ask_expires(env, monkeypatch):
    c = env["config"]
    monkeypatch.setattr(c, "ASK_POLL_RATE", 3)
    for i in range(3):
        go(env, ip=f"198.51.100.{i}")
        env["clock"][0] += 10
    e = status(env, ip="198.51.100.200")
    assert e.status == 429 and e.retry_after == c.ASK_POLL_WINDOW_S - 30 and "try again in" in e.msg


def test_poll_rate(env, monkeypatch):
    monkeypatch.setattr(env["config"], "ASK_POLL_RATE", 3)
    for i in range(3):
        go(env, pub=_pub(10 + i), ip=f"198.51.100.{i}")
    assert status(env, pub=_pub(50), ip="198.51.100.99").status == 429
    env["clock"][0] += env["config"].ASK_POLL_WINDOW_S
    go(env, pub=_pub(50), ip="198.51.100.99")
    assert len(env["calls"]) == 4


def test_ip_rate(env, monkeypatch):
    monkeypatch.setattr(env["config"], "ASK_IP_RATE", 2)
    go(env, pub=_pub(1))
    go(env, pub=_pub(2))
    assert status(env, pub=_pub(3)).status == 429
    go(env, pub=_pub(3), ip="203.0.113.2")      # a different address is fine
    assert len(env["calls"]) == 3


def test_a_limited_ask_does_not_count(env, monkeypatch):
    monkeypatch.setattr(env["config"], "ASK_POLL_RATE", 1)
    go(env, pub=_pub(1))
    for _ in range(5):
        status(env, pub=_pub(2))                # refused asks are not recorded...
    env["clock"][0] += env["config"].ASK_POLL_WINDOW_S
    go(env, pub=_pub(2))                        # ...so the window refills on time


def test_noodle_never_touches_the_poll(env, monkeypatch):
    """noodle answers from what the PAGE sends -- never the stored poll, whose
    crop, split or host offer can be older than the screen."""
    from noodle import store

    def forbidden(*a, **k):
        raise AssertionError("Ask noodle touched the stored poll")
    for name in ("load", "edit", "create", "delete", "all_polls", "_write"):
        monkeypatch.setattr(store, name, forbidden)
    env["fake"].reply = {"reading": "all", "rules": [
        {"action": "add", "blocks": ["midday", "night"], "where": {"every": True}}]}
    out = go(env, dates=["2026-10-02", "2026-10-05"])
    assert out["slots"] == ["2026-10-02:m", "2026-10-02:n", "2026-10-05:m", "2026-10-05:n"]
    assert go(env, dates=["2026-10-02"], halves=False)["slots"] == ["2026-10-02:d"]


def test_only_the_days_the_page_sent(env):
    go(env, dates=["2026-10-04", "2026-10-06"])
    system = env["calls"][-1][0]
    assert "2026-10-04 " in system and "2026-10-06 " in system and "2026-10-05 " not in system
    assert status(env, dates=[]).status == 400
    assert status(env, dates=["october"]).status == 400
    assert status(env, dates=[f"2026-{m:02d}-01" for m in range(1, 13)] * 20).status == 400


@pytest.mark.parametrize("crop,want", [
    ({"from": "2026-10-01", "to": "2026-10-31"}, {"from": "2026-10-01", "to": "2026-10-31"}),
    ({"from": "2026-10-31", "to": "2026-10-01"}, None),     # backwards
    ({"from": "october", "to": "2026-10-31"}, None),         # not a date
    ({"from": "2026-01-01", "to": "2030-01-01"}, None),      # absurdly long
    ("october", None), (None, None),
])
def test_noodle_can_crop_the_view_but_only_validly(env, crop, want):
    env["fake"].reply = {"reading": "x", "rules": [], "crop": crop}
    assert go(env)["crop"] == want


def test_model_failure_reports(env):
    def boom(system, user):
        raise RuntimeError("upstream down")
    env["ask"].llm.call = boom
    assert status(env).status == 502


def test_truncated_answer_is_an_error_not_an_empty_grid(env):
    """A partial tool call (stop_reason max_tokens) arrives as {} -- parsing it
    silently filled the grid with nothing. It must say so instead."""
    def cut(system, user):
        raise env["ask"].llm.Truncated()
    env["ask"].llm.call = cut
    assert status(env).status == 422


def test_prompt_lists_every_date_and_forbids_deciding_them(env):
    go(env)
    system = env["calls"][0][0]
    assert "2026-10-01 Thursday" in system and "2026-10-10 Saturday" in system
    assert "Do NOT decide dates yourself" in system


def test_prompt_names_quebec_holidays(env, monkeypatch):
    go(env, dates=["2026-10-10", "2026-10-12", "2026-10-14"])
    assert "2026-10-12 Monday (Quebec statutory holiday: Action de grace)" in env["calls"][-1][0]


def test_every_ask_starts_from_a_blank_calendar(env):
    # a client's current picks are neither sent nor read: the answer replaces the grid
    go(env, current=["2026-10-01:m"])
    assert "2026-10-01:m" not in env["calls"][0][0]
    assert "on an EMPTY calendar" in env["calls"][0][0]


def test_client_bounds_tokens_and_forces_the_tool():
    from noodle import config, llm
    # a reading plus a few rules: small, whatever the window length
    assert config.ASK_MAX_TOKENS <= 2048
    assert llm.SLOT_TOOL["input_schema"]["required"] == ["reading", "rules"]
    src = Path(llm.__file__).read_text()
    assert "max_tokens=config.ASK_MAX_TOKENS" in src and '"type": "tool"' in src
    assert 'stop_reason == "max_tokens"' in src



def test_parts_of_a_day_split_the_calendar(env):
    env["fake"].reply = {"reading": "friday nights", "split": True, "rules": [
        {"action": "add", "blocks": ["night"], "where": {"weekday": ["friday"]}}]}
    out = go(env, halves=False)
    assert out["split"] is True and out["slots"] == ["2026-10-02:n", "2026-10-09:n"]
    env["fake"].reply = {"reading": "fridays", "rules": [
        {"action": "add", "blocks": ["midday", "night"], "where": {"weekday": ["friday"]}}]}
    out = go(env, halves=False, ip="198.51.100.3")
    assert out["split"] is False and out["slots"] == ["2026-10-02:d", "2026-10-09:d"]


def test_the_prompt_splits_the_day_at_six(env):
    go(env)
    assert "about 6pm" in env["calls"][-1][0]



def test_one_half_of_a_day_splits_even_without_the_flag(env):
    env["fake"].reply = {"reading": "friday nights", "rules": [
        {"action": "add", "blocks": ["night"], "where": {"weekday": ["friday"]}}]}
    out = go(env, halves=False, ip="198.51.100.4")
    assert out["split"] is True and out["slots"] == ["2026-10-02:n", "2026-10-09:n"]
