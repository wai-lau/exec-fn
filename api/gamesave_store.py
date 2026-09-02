"""Per-caller /nightfall save-slot resolution -- stdlib only, no FastAPI/httpx.

Dependency-free for the same reason as tts_routing.py: the dev venv can import
and unit-test the path/identity logic without dragging the whole app graph
(auth/pages/routers -> anthropic, etc.). routes_nightfall.py imports these and
keeps only the plumbing.

WHY THIS EXISTS
The three save slots used to be three GLOBAL files -- every caller read and
wrote the same `gamesave_<slot>.json`. That was harmless while the API sat on
the owner-only tier, but 005e26c moved it to `guest_protected` so guests could
save, without giving the slots a per-caller identity. Since wai-save-sync.js
restores server->IndexedDB on load ("server is source of truth") and uploads
IDB->server on every put, the two halves compose into a full swap: any visitor
who solved Turnstile pulled the owner's save into their browser, played it, and
pushed their progress back over it. Observed in the wild 2026-09-01 17:15.

THE SCOPING
Owner keeps the original `gamesave_<slot>.json` paths -- no migration, an
existing save stays exactly where it is, permanently. Every guest gets their own
file set under `gamesave_guests/`, keyed by an opaque id the server mints into a
cookie: their save follows their browser, not the site.

The guest id NEVER reaches the filesystem verbatim. The path component is
sha256(id) truncated to 32 hex chars, so it is `[0-9a-f]{32}` by construction --
a hostile cookie value cannot traverse out of the guest dir, contain a
separator, or collide with an owner file, no matter what it holds. That is a
structural guarantee, not a validation rule that a later edit could drop.
"""
import hashlib
import secrets
import time
from pathlib import Path

VALID_SLOTS = ("save1", "save2", "save3")

# Subdir holding every guest's slots. Sits inside DATA_DIR beside the owner's
# files; the owner's own paths are unchanged (no migration).
GUEST_DIR_NAME = "gamesave_guests"

# Cookie carrying the opaque guest save id. Distinct from `guest_session` (the
# Turnstile attestation): that one says "not a bot", this one says "which
# guest". Rotating the Turnstile secret invalidates the former without
# orphaning anybody's save.
GUEST_COOKIE = "nf_save"

# A guest save id is url-safe base64 from secrets.token_urlsafe. Length is not
# pinned (token_urlsafe's output length varies with the entropy encoding), only
# a sane floor/ceiling and the charset.
_ID_ALPHABET = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
)
_ID_MIN_LEN = 16
_ID_MAX_LEN = 128


def is_valid_slot(slot: str) -> bool:
    """True iff `slot` is one of the three real save slots."""
    return slot in VALID_SLOTS


def new_guest_id() -> str:
    """Mint an opaque, unguessable guest save id for the nf_save cookie."""
    return secrets.token_urlsafe(24)


def is_valid_guest_id(raw: object) -> bool:
    """True iff `raw` looks like an id this server minted.

    Rejecting a malformed cookie (rather than hashing it anyway) keeps a caller
    from parking saves under an arbitrarily long or non-ascii key; the hash
    below would contain the damage regardless, but a mint-fresh id on a garbage
    cookie is the friendlier behaviour -- the guest gets a working save instead
    of silently sharing a bucket with every other sender of that garbage.
    """
    return (
        isinstance(raw, str)
        and _ID_MIN_LEN <= len(raw) <= _ID_MAX_LEN
        and not (set(raw) - _ID_ALPHABET)
    )


def guest_id_or_new(raw: object) -> tuple[str, bool]:
    """Resolve the cookie to a usable id. Returns (id, minted) -- `minted` True
    when the caller arrived without a valid one and the route must set the
    cookie on its response."""
    if is_valid_guest_id(raw):
        return str(raw), False
    return new_guest_id(), True


def _gid_hash(guest_id: str) -> str:
    """Filesystem-safe stand-in for a guest id: 32 hex chars, always."""
    return hashlib.sha256(guest_id.encode()).hexdigest()[:32]


def slot_path(data_dir: Path, slot: str, guest_id: str | None) -> Path:
    """Where one caller's `slot` lives. `guest_id is None` means the owner.

    Callers MUST have checked is_valid_slot(slot) first -- an unknown slot is a
    400 at the route, not a path this function invents.
    """
    if guest_id is None:
        return data_dir / f"gamesave_{slot}.json"
    return data_dir / GUEST_DIR_NAME / f"{_gid_hash(guest_id)}_{slot}.json"


def sweep_stale_guest_saves(data_dir: Path, max_age_days: float = 90.0) -> int:
    """Delete guest slot files untouched for `max_age_days`; return the count.

    Guests are now writers to the owner's disk, and a guest that never returns
    would otherwise leave its three files there forever. One-touch-per-N-writes
    housekeeping (see routes_nightfall) keeps the dir proportional to ACTIVE
    guests rather than to every visitor since deploy. Never touches the owner's
    files -- they live one level up, outside GUEST_DIR_NAME, so the owner's save
    is permanent regardless of how long it sits untouched.
    """
    gdir = data_dir / GUEST_DIR_NAME
    cutoff = time.time() - max_age_days * 86400
    removed = 0
    try:
        entries = list(gdir.iterdir())
    except OSError:
        return 0
    for p in entries:
        try:
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink()
                removed += 1
        except OSError:
            continue  # raced with another write; the next sweep gets it
    return removed
