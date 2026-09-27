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
    fake.reply = {"slots": [{"date": "2026-10-02", "block": "night"}]}
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
    env["fake"].reply = {"slots": [
        {"date": "2026-09-30", "block": "night"},    # before window
        {"date": "2026-10-11", "block": "midday"},   # after window
        {"date": "2026-10-03", "block": "evening"},  # not a block
        {"date": "Oct 4", "block": "midday"},        # not a date
        "2026-10-05:m",                              # wrong shape
        {"date": "2026-10-06", "block": "midday"},   # the one good slot
        {"date": "2026-10-06", "block": "midday"},   # duplicate
    ]}
    assert go(env)["slots"] == ["2026-10-06:m"]


@pytest.mark.parametrize("reply", [None, {}, {"slots": "all"}, {"slots": [1, 2]}, "junk"])
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


def test_current_selection_is_validated_and_sent(env):
    go(env, current=["2026-10-01:m"])
    assert "2026-10-01:m" in env["calls"][0][0]
    assert status(env, current=["2026-12-01:m"]).status == 400


def test_client_uses_small_max_tokens_and_forced_tool():
    from noodle import config, llm
    assert config.ASK_MAX_TOKENS <= 512
    assert llm.SLOT_TOOL["input_schema"]["properties"]["slots"]["items"]["properties"]["block"]["enum"] == ["midday", "night"]
    src = Path(llm.__file__).read_text()
    assert "max_tokens=config.ASK_MAX_TOKENS" in src and '"type": "tool"' in src
