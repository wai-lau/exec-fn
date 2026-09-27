"""Every Noodle knob in one place. The KDF block is shipped to the browser as
data-* attributes, so the page and this file cannot disagree."""
import os
from pathlib import Path

# ── storage ──────────────────────────────────────────────────────────────────
# Noodle's ONE directory. Nothing outside it is ever read or written
# (tests/test_noodle_isolation.py audits every open/replace).
DATA_DIR = Path(os.environ.get("NOODLE_DIR", "/app/data/noodle"))

# secrets.token_urlsafe(16) -> 22 chars of [A-Za-z0-9_-]. The slug IS the
# access control for voting, so it is validated to exactly this shape before
# it is ever used as a path component.
SLUG_BYTES = 16
SLUG_LEN = 22

# ── poll shape ───────────────────────────────────────────────────────────────
TITLE_MAX = 80
NAME_MAX = 40
MAX_WINDOW_DAYS = 120
BLOCKS = ("midday", "night")
BLOCK_CODES = {"midday": "m", "night": "n"}

# ── request bodies (bytes) ───────────────────────────────────────────────────
BODY_MAX_CREATE = 1024
BODY_MAX_VOTE = 8192
BODY_MAX_ASK = 1024

# ── identity ─────────────────────────────────────────────────────────────────
# Argon2id, run in a Web Worker in the browser. m is KiB (hash-wasm's unit).
# Tune t so a mid-range phone lands around 50-250ms; node on the droplet
# measured ~360ms at m=64MiB t=2.
KDF_M_KIB = 65536
KDF_T = 2
KDF_P = 1
KDF_LEN = 32          # bytes -> the Ed25519 seed
KDF_DEBOUNCE_MS = 1000

# A signed vote's timestamp must be this close to server time, AND strictly
# newer than the voter's last accepted one (so a captured request cannot be
# replayed even inside the window).
TS_SKEW_MS = 120_000

# ── ask noodle (Claude Haiku) ───────────────────────────────────────────────
ASK_MODEL = "claude-haiku-4-5"
ASK_MAX_CHARS = 280
ASK_MAX_TOKENS = 400
ASK_POLL_CAP = 60        # total calls per poll, ever
ASK_VOTER_CAP = 6        # per voter public key, per poll
ASK_IP_CAP = 10          # per client IP ...
ASK_IP_WINDOW_S = 3600   # ... per this many seconds (in memory)
