"""Nightly: is the reader's voice working, and is every hour still stocked.

WHY IT EXISTS. The reader's narration is the one part of /tarot with a
dependency outside this box -- the home GPU over an SSH tunnel -- and it fails
SILENTLY: the page falls back to the guessed-pace typewriter and reads fine, so
a dead voice is only noticed the next time someone sits down for a reading.
This checks it once a night, at an hour nobody is reading, and writes the answer
where a failure is visible: data/cron/YYYY-MM-DD__tarotvoice.log, which /debug
renders through GET /api/debug/cron.

It is an in-process asyncio loop, not a cron line -- same reason as the nudge
loop: a baked /etc/cron.d entry needs an image rebuild to change, while this
re-arms itself on the next --reload.

The same pass tops every hour back up to its ten openings (openings_gen), which
normally costs nothing because nothing is missing.
"""
import asyncio
import traceback
from datetime import datetime

from gpu_mode_client import GPU_MODE_TOKEN, GPU_MODE_UPSTREAM, fetch_mode
from helpers import DATA_DIR, _now_et
from tarot import openings, openings_gen, voice_synth

# 05:45 ET: after morning (4:30), graphify (5:00), security (5:10) and the cc
# probe (5:20), so the four never contend for a 1967MB box.
RUN_AT = (5, 45)
POLL_S = 300

# First audio slower than this on a WARM box means something is wrong even
# though the synth succeeded (a cold load is ~4.6s, loaded ~0.36s).
SLOW_MS = 2500


def _log_path(now: datetime):
    return DATA_DIR / "cron" / f"{now.date().isoformat()}__tarotvoice.log"


def _verdict(probe: dict, mode: str) -> str:
    """One line, leading with the word a tired reader needs to see first.

    Three ways to be quiet, and they are not the same thing. Under emo/idle
    hosaka-server is deliberately stopped and a failing probe is the EXPECTED
    state, not a fault (gpu_mode_client.effective_mode says the same from the
    other direction). `gone` is not that: the box did not decline, it did not
    answer at all -- it is asleep, off, or its reverse tunnel is down, and the
    line says so rather than calling it a deliberate stop. Under homo the box
    claims loaded models and served nothing, the failure worth shouting about."""
    if probe["ok"]:
        slow = "  SLOW" if (probe["first_ms"] or 0) > SLOW_MS else ""
        return (f"OK{slow}  first_audio={probe['first_ms']}ms total={probe['total_ms']}ms "
                f"audio={probe['audio_s']}s")
    if mode == "gone":
        return f"voice unreachable (mode=gone) -- home box or its tunnel is down: {probe['error']}"
    if mode in ("idle", "emo"):
        return f"voice down (mode={mode}) -- hosaka-server stopped, expected: {probe['error']}"
    return f"FAIL (mode={mode}): {probe['error']}"


async def run_check(top_up: bool = True) -> list[str]:
    """The nightly pass. Returns the log lines (also used by the CLI)."""
    now = _now_et()
    mode = await fetch_mode(GPU_MODE_UPSTREAM, GPU_MODE_TOKEN)
    probe = await voice_synth.probe(openings.VOICE, openings.BACKEND)
    lines = [
        f"[{now.isoformat(timespec='seconds')}] /tarot reader voice check",
        f"voice={openings.VOICE} backend={openings.BACKEND} mode={mode}",
        _verdict(probe, mode),
    ]

    st = openings_gen.stats()
    lines.append(f"openings: {st['total']} clips, {len(st['short'])} hour(s) short of "
                 f"{openings.TARGET_PER_HOUR}")
    if st["short"] and top_up:
        if not probe["ok"]:
            lines.append("top-up skipped: no voice to render audio with")
        else:
            res = await openings_gen.backfill()
            lines.append(f"top-up: +{res['made']} clips -> {res['total']} total")
    return lines


async def _run_once() -> None:
    now = _now_et()
    path = _log_path(now)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        lines = await run_check()
    except Exception:
        lines = [f"[{now.isoformat(timespec='seconds')}] /tarot reader voice check",
                 "FAIL: check raised", traceback.format_exc()]
    path.write_text("\n".join(lines) + "\n")


def _due(now: datetime, path) -> bool:
    """Past the run time today, and today's log not written yet. The LOG is the
    stamp -- one file, written once, and the thing that proves it ran."""
    return (now.hour, now.minute) >= RUN_AT and not path.exists()


async def run_openings_loop() -> None:
    while True:
        await asyncio.sleep(POLL_S)
        try:
            now = _now_et()
            if _due(now, _log_path(now)):
                await _run_once()
        except Exception as e:
            print(f"[tarot] nightly voice check error: {e}")
