"""Ask Noodle: the model is faked (noodle.llm.call), so these pin the caps,
the schema validation and the window clamp without spending a token.

Every budget is a config constant; the tests read them from config rather
than hard-coding numbers, so retuning a cap cannot silently skip a test.
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
    ask._ip_hits.clear()
    calls = []

    def fake(system, user):
        calls.append((system, user))
        return fake.reply
    fake.reply = {"days": ["2026-10-01 Thursday: no -> -", "2026-10-02 Friday: friday night -> n"]}
    monkeypatch.setattr(llm, "call", fake)
    slug = store.create("t", "2026-10-01", "2026-10-10", "x")["slug"]
    return {"ask": ask, "config": config, "slug": slug, "calls": calls, "fake": fake}


def go(env, text="thursday night", pub=None, ip="203.0.113.1", current=None):
    return env["ask"].ask(env["slug"], {"text": text, "pub": pub or _pub(1),
                                        "current": current or []}, ip)


def status(env, **kw):
    with pytest.raises(env["ask"].AskError) as e:
        go(env, **kw)
    return e.value


def test_valid_output_fills_and_counts(env):
    out = go(env)
    assert out["slots"] == ["2026-10-02:n"]
    assert out["remaining"] == env["config"].ASK_VOTER_CAP - 1
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


def test_per_voter_cap(env):
    cap = env["config"].ASK_VOTER_CAP
    for i in range(cap):
        go(env, ip=f"198.51.100.{i}")
    e = status(env, ip="198.51.100.250")
    assert e.status == 429 and e.remaining == 0
    assert len(env["calls"]) == cap
    go(env, pub=_pub(2), ip="198.51.100.251")    # someone else still can


def test_per_poll_cap(env, monkeypatch):
    monkeypatch.setattr(env["config"], "ASK_POLL_CAP", 3)
    for i in range(3):
        go(env, pub=_pub(10 + i), ip=f"198.51.100.{i}")
    e = status(env, pub=_pub(50), ip="198.51.100.99")
    assert e.status == 429 and e.remaining == 0
    assert len(env["calls"]) == 3


def test_per_ip_cap(env, monkeypatch):
    monkeypatch.setattr(env["config"], "ASK_IP_CAP", 2)
    go(env, pub=_pub(1))
    go(env, pub=_pub(2))
    assert status(env, pub=_pub(3)).status == 429
    go(env, pub=_pub(3), ip="203.0.113.2")      # a different address is fine
    assert len(env["calls"]) == 3


def test_model_failure_still_spends_and_reports(env):
    def boom(system, user):
        raise RuntimeError("upstream down")
    env["ask"].llm.call = boom
    e = status(env)
    assert e.status == 502 and e.remaining == env["config"].ASK_VOTER_CAP - 1


def test_truncated_answer_is_an_error_not_an_empty_grid(env):
    """A partial tool call (stop_reason max_tokens) arrives as {} -- parsing it
    silently filled the grid with nothing. It must say so instead."""
    def cut(system, user):
        raise env["ask"].llm.Truncated()
    env["ask"].llm.call = cut
    e = status(env)
    assert e.status == 422 and e.remaining == env["config"].ASK_VOTER_CAP - 1


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


def test_current_selection_is_validated_and_sent(env):
    go(env, current=["2026-10-01:m"])
    assert "2026-10-01:m" in env["calls"][0][0]
    assert status(env, current=["2026-12-01:m"]).status == 400


def test_client_bounds_tokens_and_forces_the_tool():
    from noodle import config, llm
    # one reasoned line per date (~15 tokens) for the longest window must fit
    assert 15 * config.MAX_WINDOW_DAYS <= config.ASK_MAX_TOKENS <= 4096
    assert llm.SLOT_TOOL["input_schema"]["required"] == ["days"]
    src = Path(llm.__file__).read_text()
    assert "max_tokens=config.ASK_MAX_TOKENS" in src and '"type": "tool"' in src
    assert 'stop_reason == "max_tokens"' in src
