"""Ed25519 vote signatures. The browser derives the key from the passphrase
(Argon2id -> seed) and signs; the server only ever holds the public half."""
import base64
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def b64d(s: str, n: int) -> bytes:
    """Decode standard or url-safe base64 to exactly n bytes, or raise."""
    if not isinstance(s, str) or len(s) > 128:
        raise ValueError("bad base64")
    s = s.replace("-", "+").replace("_", "/")
    raw = base64.b64decode(s + "=" * (-len(s) % 4), validate=True)
    if len(raw) != n:
        raise ValueError(f"expected {n} bytes")
    return raw


def canonical(poll: str, name: str, slots: list[str], ts: int) -> bytes:
    """The exact bytes that are signed. Keys sorted, no whitespace, UTF-8 --
    web/noodle-vote.js builds the same string by writing the keys in this
    order into JSON.stringify, which escapes the same characters."""
    return json.dumps(
        {"name": name, "poll": poll, "slots": slots, "ts": ts},
        sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode("utf-8")


def verify(pub_b64: str, sig_b64: str, message: bytes) -> bool:
    try:
        key = Ed25519PublicKey.from_public_bytes(b64d(pub_b64, 32))
        key.verify(b64d(sig_b64, 64), message)
        return True
    except (ValueError, InvalidSignature):
        return False
