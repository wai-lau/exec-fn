"""Generate the pre-rendered /tarot openings: the text, then its audio.

One opus call per HOUR (not per clip) produces that hour's whole batch at once,
which is both cheaper and better: asked for ten at a time the model varies them
against each other instead of converging on the same lamp and the same siren.
Each accepted opening is then synthesized once through voice_synth and stored
as a .wav beside the index (openings.py).

The system prompt here is the reader's VOICE preamble only -- not the whole
reading system (the framework chapters, the phase machinery, the tools). A
first turn needs the register and the time-of-day table; the rest would be ~10K
tokens of context the model never uses. It is also under opus's 4096-token
minimum cacheable prefix, so there is deliberately no cache_control marker:
below that floor it silently would not cache anyway (CLAUDE.md § Prompt caching).

CLI (run in the container, which has the SDK and the tunnel):
    docker compose exec api python -m tarot.openings_gen stats
    docker compose exec api python -m tarot.openings_gen backfill [--target 10] [--hour 3]
    docker compose exec api python -m tarot.openings_gen refresh --n 1
    docker compose exec api python -m tarot.openings_gen check
"""
import argparse
import asyncio
import json
import re
import uuid
from datetime import datetime

from tarot import openings, voice_synth
from tarot.prompt import voice_preamble

MODEL = "claude-opus-4-8"

# Must match tarotTimeMarker() in web/tarot-chat.js -- the band is what the
# reader's time-of-day table keys off, so a mismatch here reads as the wrong
# weather at the right hour.
_BANDS = [(5, "late-night"), (8, "predawn"), (11, "morning"), (14, "midday"),
          (17, "afternoon"), (20, "dusk"), (23, "evening"), (24, "late-night")]

# An opening is an image and a question. Longer than this and it is a monologue
# -- and the audio stops being a file the page can pull down in one breath.
MAX_CHARS = 420


def band_for(hour: int) -> str:
    return next(name for edge, name in _BANDS if hour < edge)


def _ask(hour: int, n: int) -> str:
    marker = f"[opened /tarot; no Significator yet, no spread; time={hour:02d}:17 {band_for(hour)}]"
    return f"""Write {n} ALTERNATIVE versions of your very first turn of a reading, for a querent who opened the terminal at this moment:

{marker}

Each one is exactly the first-turn shape: one or two short lines of image -- the terminal and the room around it at THIS hour, in your register -- then a blank line, then one open Phase 1 question (under 30 words, ending in `?`) about the querent's life, mood or present situation.

No greeting. No "Welcome". No mention of cards, spreads, Significator, tarot, or what is about to happen. Never name the hour or quote the marker; let the light, the sound and the weather of the room say it.

The {n} must be genuinely different from each other -- different object, different sound, different question. Do not reuse an image across two of them.

Return ONLY a JSON array of {n} strings, each string one complete opening with the blank line inside it as `\\n\\n`. No prose around the JSON."""


def _parse_batch(raw: str) -> list[str]:
    """Pull the JSON array out of the reply and keep the openings that are
    actually first-turn shaped. A malformed or off-shape variant is DROPPED, not
    repaired -- the next top-up run fills the gap, and a bad opening would be
    frozen into audio and played for months."""
    m = re.search(r"\[.*\]", raw, re.S)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    out = []
    for it in items:
        if not isinstance(it, str):
            continue
        text = it.strip()
        if "\n\n" not in text or not text.endswith("?") or len(text) > MAX_CHARS:
            continue
        if text.startswith("[") or "time=" in text:
            continue
        out.append(text)
    return out


async def generate_texts(hour: int, n: int) -> list[str]:
    import anthropic

    client = anthropic.AsyncAnthropic()
    msg = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        # No `temperature`: it is REMOVED on opus 4.8 (the SDK raises
        # TypeError, the API 400s). The variety that would have come from
        # sampling comes from asking for the whole batch in one call instead --
        # ten at a time, the model varies them against each other.
        system=voice_preamble(),
        messages=[{"role": "user", "content": _ask(hour, n)}],
    )
    raw = "".join(b.text for b in msg.content if b.type == "text")
    return _parse_batch(raw)[:n]


async def render_clip(hour: int, text: str) -> dict | None:
    """Synthesize one opening and write its wav. None when the voice backend
    did not produce audio -- the text is then dropped too, because an opening
    with no audio is exactly the live-generation case it exists to avoid."""
    clip_id = f"h{hour:02d}-{uuid.uuid4().hex[:8]}"
    res = await voice_synth.synthesize(text, openings.VOICE, openings.BACKEND)
    if not res["ok"]:
        print(f"  ! synth failed ({res['error']})")
        return None
    path = openings.clip_file(clip_id)
    dur = voice_synth.write_wav(path, res["pcm"])
    return {
        "id": clip_id,
        "text": text,
        "dur": dur,
        "bytes": path.stat().st_size,
        "voice": openings.VOICE,
        "created": datetime.now().isoformat(timespec="seconds"),
    }


async def fill_hour(index: dict, hour: int, need: int) -> int:
    """Top one hour up by `need` clips. Returns how many landed."""
    texts = await generate_texts(hour, need)
    if not texts:
        print(f"  ! hour {hour:02d}: no usable openings came back")
        return 0
    made = 0
    for text in texts:
        clip = await render_clip(hour, text)
        if clip:
            openings.add_clip(index, hour, clip)
            made += 1
    return made


async def backfill(target: int = openings.TARGET_PER_HOUR, only_hour: int | None = None) -> dict:
    """Bring every hour (or one) up to `target` clips. Idempotent: an hour that
    is already full costs nothing, so this is safe to run nightly."""
    index = openings.load_index()
    if not index.get("hours"):
        index = openings.empty_index()
    todo = openings.shortfall(index, target)
    if only_hour is not None:
        todo = [(k, n) for k, n in todo if k == openings.hour_key(only_hour)]
    made = 0
    for key, need in todo:
        hour = int(key)
        print(f"hour {key}: need {need}")
        made += await fill_hour(index, hour, need)
    return {"made": made, "hours_touched": len(todo), "total": openings.total_clips(openings.load_index())}


async def refresh(n: int = 1) -> dict:
    """Rotate: drop the n oldest clips of every hour and generate replacements,
    so a set that has been playing for months keeps moving. Not run by the
    nightly job -- each rotation is a paid call, so it stays a deliberate act."""
    index = openings.load_index()
    dropped = 0
    for hour in range(24):
        for clip_id in openings.drop_oldest(index, hour, n):
            openings.clip_file(clip_id).unlink(missing_ok=True)
            dropped += 1
    openings.save_index(index)
    res = await backfill()
    res["dropped"] = dropped
    return res


def stats() -> dict:
    index = openings.load_index()
    per_hour = {k: len(v or []) for k, v in sorted((index.get("hours") or {}).items())}
    return {"total": openings.total_clips(index), "per_hour": per_hour,
            "short": openings.shortfall(index)}


async def _main() -> None:
    ap = argparse.ArgumentParser(description="pre-generate /tarot opening turns")
    ap.add_argument("command", choices=["backfill", "refresh", "check", "stats"])
    ap.add_argument("--target", type=int, default=openings.TARGET_PER_HOUR)
    ap.add_argument("--hour", type=int, default=None)
    ap.add_argument("--n", type=int, default=1)
    args = ap.parse_args()

    if args.command == "stats":
        print(json.dumps(stats(), indent=2))
    elif args.command == "check":
        print(json.dumps(await voice_synth.probe(openings.VOICE, openings.BACKEND), indent=2))
    elif args.command == "refresh":
        print(json.dumps(await refresh(args.n), indent=2))
    else:
        print(json.dumps(await backfill(args.target, args.hour), indent=2))


if __name__ == "__main__":
    asyncio.run(_main())
