"""Lateness recalibration.

Consumes the `late` telemetry that lands on archive moves (see
`_log_entries_for_patch` in main.py) and learns a per-category *lateness factor*:
how much longer tasks in a category actually take than planned. Chronically-late
categories get a factor > 1.0; the nudge loop reads it (`factor_for`) to fire
earlier, widen the stall window, and reserve more time — so similar future tasks
start sooner without Wai touching a single estimate.

The factor is an EMA over completions in that category: late completions push it
up (proportional to how late, normalised by the estimate), on-time completions
pull it back toward 1.0. Self-correcting, bounded [FACTOR_MIN, FACTOR_MAX].

State lives in data/recalibration.json. The consumer runs once a day in the
morning pipeline over the day's activity log, before it is archived.
"""
import json

from helpers import DATA_DIR, _load_json, _now_et

# ── tuning ────────────────────────────────────────────────────────────────────
# Off until there's enough real late-completion data to learn from. Telemetry
# (the `late`/`minutes_late` tags on archive moves) keeps accruing regardless;
# flip this on once the archived logs hold a meaningful sample.
# Late card-action ("late" button) shipped 2026-06-09 (commit dbfe999) — data
# only accrues from then.
ENABLED = False

EMA_ALPHA = 0.25       # weight of each new completion against running factor
FACTOR_MIN = 1.0       # never under-reserve relative to the raw estimate
FACTOR_MAX = 2.0       # cap so one disastrous day can't double everything twice
TARGET_MAX = 2.0       # per-event target ceiling (a single very-late task)
_DEFAULT_EST = 90      # minutes, when a completion entry carries no estimate

_STORE = "recalibration"


def _load() -> dict:
    return _load_json(_STORE, {"categories": {}})


def _save(data: dict) -> None:
    (DATA_DIR / f"{_STORE}.json").write_text(json.dumps(data, indent=2))


def factor_for(card: dict) -> float:
    """Lateness factor for a card's category (1.0 if unknown / never late)."""
    if not ENABLED:
        return 1.0
    cat = card.get("category")
    if not cat:
        return 1.0
    rec = _load().get("categories", {}).get(cat)
    if not rec:
        return 1.0
    f = rec.get("factor", 1.0)
    return min(FACTOR_MAX, max(FACTOR_MIN, f))


def _target(entry: dict) -> float:
    """Per-completion target the EMA pulls toward."""
    if not entry.get("late"):
        return 1.0
    est = entry.get("estimated_time") or _DEFAULT_EST
    late = entry.get("minutes_late") or 0
    return min(TARGET_MAX, max(1.0, 1.0 + late / max(1, est)))


def recalibrate(log_entries: list) -> bool:
    """Fold a day's completions into the per-category factors. A completion is a
    `moved -> archives` entry tagged with a category (see _log_entries_for_patch).
    Returns True if anything changed (so the caller can decide to log it)."""
    if not ENABLED:
        return False
    completions = [
        e for e in log_entries
        if e.get("action") == "moved" and e.get("to_col") == "archives"
        and e.get("category")
    ]
    if not completions:
        return False
    data = _load()
    cats = data.setdefault("categories", {})
    today = _now_et().strftime("%Y-%m-%d")
    for e in completions:
        cat = e["category"]
        rec = cats.setdefault(cat, {"factor": 1.0, "samples": 0, "updated": today})
        tgt = _target(e)
        rec["factor"] = round(
            min(FACTOR_MAX, max(FACTOR_MIN,
                rec["factor"] * (1 - EMA_ALPHA) + tgt * EMA_ALPHA)),
            3,
        )
        rec["samples"] = rec.get("samples", 0) + 1
        rec["updated"] = today
    _save(data)
    return True
