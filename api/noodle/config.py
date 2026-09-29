"""Every noodle knob in one place. The KDF block is shipped to the browser as
data-* attributes, so the page and this file cannot disagree."""
import os
from pathlib import Path

# ── storage ──────────────────────────────────────────────────────────────────
# noodle's ONE directory. Nothing outside it is ever read or written
# (tests/test_noodle_isolation.py audits every open/replace).
DATA_DIR = Path(os.environ.get("NOODLE_DIR", "/app/data/noodle"))

# Link previews (Open Graph) need ABSOLUTE urls, and the page is rendered with
# no request in hand, so the public origin is configuration.
ORIGIN = os.environ.get("NOODLE_ORIGIN", "https://wai-lau.net")
OG_IMAGE = "/noodle-card.jpg?v=1"   # web/noodle-card.jpg, 1200x630
OG_DESC = "pick the times you're free"

# secrets.token_urlsafe(16) -> 22 chars of [A-Za-z0-9_-]. The slug IS the
# access control for voting, so it is validated to exactly this shape before
# it is ever used as a path component.
SLUG_BYTES = 16
SLUG_LEN = 22

# ── poll shape ───────────────────────────────────────────────────────────────
TITLE_MAX = 80
NAME_MAX = 40
# There is no date range on a poll: the calendar is endless and the host's
# picks decide what is on offer. These only bound what a request may carry.
# Per vote. NOT the binding limit through the API: BODY_MAX_VOTE (below) caps
# the whole request first, at roughly 500 slots (~15 bytes each plus the name,
# key and signature). This is the second guard, for any caller that skips the
# body cap -- raise BODY_MAX_VOTE alone and this starts to matter.
MAX_SLOTS = 800
SLOT_YEARS_AHEAD = 3             # no slot further out than this
VIEW_MAX_DAYS = 186              # the longest range Ask noodle will consider
VIEW_DEFAULT_DAYS = 91           # ... and the one it uses with no crop
BLOCKS = ("midday", "night")
BLOCK_CODES = {"midday": "m", "night": "n"}
# A poll is either SPLIT (midday + night per day, codes m/n) or not (one slot
# per day, code d -- the default for new polls; the host can split it).
DAY_CODE = "d"

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
ASK_MAX_TOKENS = 1024   # a reading + a handful of rules; dates are applied by code
# Rate limits, never lifetime caps: `RATE` asks per rolling `WINDOW_S` seconds.
ASK_POLL_RATE = 60       # per poll, everyone together ...
ASK_POLL_WINDOW_S = 3600  # ... per hour
ASK_IP_RATE = 60         # per client IP ...
ASK_IP_WINDOW_S = 3600   # ... per this many seconds (in memory)

# Starting a poll (the public /noodle page): drafts per client IP.
NEW_RATE = 20
NEW_WINDOW_S = 3600

# The host's note under the poll's title.
NOTE_MAX = 280
