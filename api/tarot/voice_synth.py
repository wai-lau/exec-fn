"""Server-side TTS client: render a line of reader prose to PCM, once.

The browser talks to the voice backend over the same-origin WS proxy in
routes_tts.py. This is the other caller -- the droplet itself, synthesizing
with no browser in the loop: it renders the pre-generated /tarot openings
(openings_gen.py), probes the voice on the nightly check (openings_loop.py),
and warms the models when a reading opens.

It speaks the upstream's own protocol directly (one JSON utterance in,
`{"type":"start"}` -> binary float32 frames -> `{"type":"end"}` back) rather
than going through /ws/hosaka, because there is no cookie to carry and no
client to fan out to.

WARMING IS THE POINT OF THE THIRD ENTRY POINT. Under GPU mode `idle` the models
load on demand, so the first utterance of a session pays ~4.6s of cold load
against 0.36s loaded (measured 2026-09-10). A canned opening removes that wait
from the reader's FIRST turn; `warm()` fired when the page opens removes it from
the second one too, since the querent spends the opening reading it.
"""
import array
import asyncio
import json
import sys
import time
import wave
from pathlib import Path

from tts_routing import TTS_UPSTREAM

SAMPLE_RATE = 24000   # upstream PCM rate (float32 mono), see hosaka-audio.js

# A synth of a whole opening runs a few seconds on a warm box and can take
# considerably longer on a cold one; a probe/warm is one word.
SYNTH_TIMEOUT_S = 120
WARM_TIMEOUT_S = 30

# Warm is fired by any /tarot page load (and every reload). One synth per this
# many seconds is enough to hold the models up through a reading without
# turning a refresh loop into GPU load.
WARM_COOLDOWN_S = 300
_last_warm = 0.0


async def synthesize(text: str, voice: str, backend: str, timeout: float = SYNTH_TIMEOUT_S) -> dict:
    """Render one utterance. Returns
    {ok, pcm (float32 bytes), first_ms, total_ms, audio_s, error}.

    Never raises: every caller here is a background job or a fire-and-forget
    route, and a home box that is asleep is an ordinary state, not an error.
    """
    import websockets

    t0 = time.monotonic()
    out = {"ok": False, "pcm": b"", "first_ms": None, "total_ms": None, "audio_s": 0.0, "error": None}
    chunks: list[bytes] = []
    try:
        async with asyncio.timeout(timeout):
            async with websockets.connect(f"ws://{TTS_UPSTREAM}/v1/audio/stream", max_size=None) as up:
                await up.send(json.dumps({
                    "input": text, "backend": backend, "voice": voice, "params": {"speed": 1.0},
                }))
                async for msg in up:
                    if isinstance(msg, (bytes, bytearray)):
                        if out["first_ms"] is None:
                            out["first_ms"] = round((time.monotonic() - t0) * 1000)
                        chunks.append(bytes(msg))
                        continue
                    kind = json.loads(msg).get("type")
                    if kind == "error":
                        out["error"] = json.loads(msg).get("detail") or "tts error"
                        break
                    if kind == "end":
                        break
    except TimeoutError:
        out["error"] = f"timeout after {timeout}s"
    except Exception as e:  # unreachable tunnel, home box down, protocol change
        out["error"] = f"{type(e).__name__}: {e}"

    out["pcm"] = b"".join(chunks)
    out["total_ms"] = round((time.monotonic() - t0) * 1000)
    out["audio_s"] = round(len(out["pcm"]) / 4 / SAMPLE_RATE, 2)
    out["ok"] = not out["error"] and out["audio_s"] > 0
    if out["ok"] is False and not out["error"]:
        out["error"] = "no audio"
    return out


def write_wav(path: Path, pcm_f32: bytes) -> float:
    """float32 PCM -> a 16-bit mono WAV the browser can decodeAudioData().

    16-bit because the container has no encoder (ffmpeg is on the HOST only, and
    adding one would mean a new pinned dep + an image rebuild for a file served
    a handful of times a day). An opening is ~12-16s = ~600-800KB, fetched once
    while the page waits for its first tap and then cached immutable.
    """
    samples = array.array("f")
    samples.frombytes(pcm_f32[: len(pcm_f32) - len(pcm_f32) % 4])
    if sys.byteorder != "little":
        samples.byteswap()  # the wire is little-endian; array is native
    pcm16 = array.array("h", (max(-32768, min(32767, int(s * 32767))) for s in samples))
    if sys.byteorder != "little":
        pcm16.byteswap()  # WAV is little-endian
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".wav.tmp")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm16.tobytes())
    tmp.replace(path)
    return round(len(samples) / SAMPLE_RATE, 2)


async def probe(voice: str, backend: str, text: str = "The cards are ready.") -> dict:
    """One short synth, audio discarded -- the nightly 'is the reader's voice
    working' check. Same call shape as a real utterance, so a green probe means
    the path a querent uses is green, not merely that a port is bound."""
    r = await synthesize(text, voice, backend, timeout=WARM_TIMEOUT_S)
    r.pop("pcm", None)
    return r


async def warm(voice: str, backend: str) -> dict:
    """Load the models now so the reading's next turn doesn't pay for it.
    Cooldown-guarded: a reload storm must not become GPU load."""
    global _last_warm
    now = time.monotonic()
    if now - _last_warm < WARM_COOLDOWN_S:
        return {"ok": True, "skipped": "cooldown"}
    _last_warm = now
    r = await probe(voice, backend, text="Mm.")
    return {"ok": r["ok"], "first_ms": r["first_ms"], "error": r["error"]}
