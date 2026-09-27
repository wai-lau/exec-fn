"""Ask Noodle: the model is faked (noodle.llm.call), so these pin the rate
limits, the schema validation and the window clamp without spending a token.

Limits are ROLLING WINDOWS, never lifetime caps. Every rate is a config
constant the tests read, and time is a monkeypatched clock, so a window
refilling is tested directly rather than slept through.
"""
import base64
import sys
from pathlib import Path

import pytest

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
    fake.reply = {"days": ["2026-10-01 Thursday: no -> -", "2026-10-02 Friday: friday night -> n"]}
    monkeypatch.setattr(llm, "call", fake)
    slug = store.create("t", "2026-10-01", "2026-10-10", "x")["slug"]
    return {"ask": ask, "config": config, "slug": slug, "calls": calls, "fake": fake, "clock": clock}


def go(env, text="thursday night", pub=None, ip="203.0.113.1", current=None):
    return env["ask"].ask(env["slug"], {"text": text, "pub": pub or _pub(1),
                                        "current": current or []}, ip)


def status(env, **kw):
    with pytest.raises(env["ask"].AskError) as e:
        go(env, **kw)
    return e.value


def test_valid_output_fills(env):
    out = go(env)
    assert out == {"slots": ["2026-10-02:n"]}
    assert len(env["calls"]) == 1


def test_output_clamped_to_window_and_invalid_discarded(env):
    env["fake"].reply = {"days": [
        "2026-09-30 Wednesday: before the window -> mn",
        "2026-10-11 Sunday: after the window -> m",
        "2026-10-03 Saturday: not a verdict -> evening",
        "Oct 4: not a date -> m",
        "2026-10-05 Monday: no arrow m",
        {"date": "2026-10-06", "block": "midday"},
        "2026-10-06 Tuesday: ok -> m",
        "2026-10-06 Tuesday: duplicate -> m",
        "2026-10-07 Wednesday: both -> mn",
        "2026-10-08 Thursday: neither -> -",
    ]}
    assert go(env)["slots"] == ["2026-10-06:m", "2026-10-07:m", "2026-10-07:n"]


@pytest.mark.parametrize("reply", [None, {}, {"days": "all"}, {"days": [1, 2]}, "junk",
                                   {"slots": [{"date": "2026-10-02", "block": "night"}]}])
def test_schema_invalid_output_discarded(env, reply):
    env["fake"].reply = reply
    assert go(env)["slots"] == []


def test_input_length_cap_spends_nothing(env):
    cap = env["config"].ASK_MAX_CHARS
    assert status(env, text="x" * (cap + 1)).status == 400
    assert status(env, text="   ").status == 400
    assert env["calls"] == []
    assert go(env, text="x" * cap)["slots"]


def test_needs_a_key(env):
    assert status(env, pub="not-a-key").status == 400
    assert env["calls"] == []


def test_voter_rate_limits_then_refills(env):
    c = env["config"]
    for i in range(c.ASK_VOTER_RATE):
        go(env, ip=f"198.51.100.{i}")
    e = status(env, ip="198.51.100.250")
    assert e.status == 429 and e.retry_after == c.ASK_VOTER_WINDOW_S
    assert "try again in" in e.msg
    go(env, pub=_pub(2), ip="198.51.100.251")    # someone else still can
    env["clock"][0] += c.ASK_VOTER_WINDOW_S      # the window rolls on...
    go(env, ip="198.51.100.252")                  # ...and they can ask again: no lifetime cap
    assert len(env["calls"]) == c.ASK_VOTER_RATE + 2


def test_retry_after_is_the_time_until_the_oldest_ask_expires(env):
    c = env["config"]
    for i in range(c.ASK_VOTER_RATE):
        go(env, ip=f"198.51.100.{i}")
        env["clock"][0] += 10
    assert status(env, ip="198.51.100.200").retry_after == c.ASK_VOTER_WINDOW_S - 10 * c.ASK_VOTER_RATE


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


def test_ip_allowance_covers_one_voters_own(env):
    c = env["config"]
    per_hour = c.ASK_VOTER_RATE * (c.ASK_IP_WINDOW_S // c.ASK_VOTER_WINDOW_S)
    assert c.ASK_IP_RATE >= c.ASK_VOTER_RATE, "one voter must not trip their own IP first"
    assert per_hour >= c.ASK_VOTER_RATE


def test_a_limited_ask_does_not_count(env, monkeypatch):
    monkeypatch.setattr(env["config"], "ASK_POLL_RATE", 1)
    go(env, pub=_pub(1))
    for _ in range(5):
        status(env, pub=_pub(2))                # refused asks are not recorded...
    env["clock"][0] += env["config"].ASK_POLL_WINDOW_S
    go(env, pub=_pub(2))                        # ...so the window refills on time


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


def test_prompt_labels_every_date(env):
    go(env)
    system = env["calls"][0][0]
    assert "2026-10-01 Thursday the 1 (odd)" in system
    assert "2026-10-10 Saturday the 10 (even)" in system


def test_prompt_names_quebec_holidays(env, monkeypatch):
    from noodle import store
    slug = store.create("h", "2026-10-10", "2026-10-14", "x")["slug"]
    env["ask"].ask(slug, {"text": "x", "pub": _pub(9), "current": []}, "192.0.2.1")
    assert "2026-10-12 Monday the 12 (even) (Quebec statutory holiday: Action de grace)" in env["calls"][-1][0]


def test_every_ask_starts_from_a_blank_calendar(env):
    # a client's current picks are neither sent nor read: the answer replaces the grid
    go(env, current=["2026-10-01:m"])
    assert "2026-10-01:m" not in env["calls"][0][0]
    assert "starting from nothing selected" in env["calls"][0][0]


def test_client_bounds_tokens_and_forces_the_tool():
    from noodle import config, llm
    # one reasoned line per date (~15 tokens) for the longest window must fit
    assert 15 * config.MAX_WINDOW_DAYS <= config.ASK_MAX_TOKENS <= 4096
    assert llm.SLOT_TOOL["input_schema"]["required"] == ["days"]
    src = Path(llm.__file__).read_text()
    assert "max_tokens=config.ASK_MAX_TOKENS" in src and '"type": "tool"' in src
    assert 'stop_reason == "max_tokens"' in src
