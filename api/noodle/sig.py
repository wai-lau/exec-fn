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
    ).encode("utf-8", "surrogatepass")


# Ed25519 points of SMALL ORDER (the identity and the 7 torsion points) verify
# signatures nobody made: with A = identity, R = identity and S = 0 pass for
# EVERY message, and OpenSSL checks nothing here. Every noodle key is chosen by
# the party it protects, so this only ever made one's own seat forgeable --
# refused anyway (security audit 2026-10-14). Pure integer math: decode the
# point, double it three times, see whether it is the identity.
_P = 2**255 - 19
_D = (-121665 * pow(121666, -1, _P)) % _P
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)


def _decode(raw: bytes):
    """RFC 8032 5.1.3 -> extended coordinates, or None if not a point."""
    y = int.from_bytes(raw, "little") & ((1 << 255) - 1)
    sign = raw[31] >> 7
    if y >= _P:
        return None
    u, v = (y * y - 1) % _P, (_D * y * y + 1) % _P
    x = u * pow(v, 3, _P) * pow(u * pow(v, 7, _P), (_P - 5) // 8, _P) % _P
    if v * x * x % _P == (-u) % _P:
        x = x * _SQRT_M1 % _P
    if v * x * x % _P != u:
        return None
    if x == 0 and sign:
        return None
    if x & 1 != sign:
        x = _P - x
    return x, y, 1, x * y % _P


def _double(pt):
    """dbl-2008-hwcd, a = -1."""
    x, y, z, _ = pt
    a, b, c = x * x % _P, y * y % _P, 2 * z * z % _P
    d = -a % _P
    e = ((x + y) * (x + y) - a - b) % _P
    g, h = (d + b) % _P, (d - b) % _P
    f = (g - c) % _P
    return e * f % _P, g * h % _P, f * g % _P, e * h % _P


def small_order(raw: bytes) -> bool:
    """True for an encoding that is no point at all, or a point of order <= 8."""
    pt = _decode(raw)
    if pt is None:
        return True
    for _ in range(3):
        pt = _double(pt)
    x, y, z, _ = pt
    return x == 0 and y == z


def valid_pub(pub_b64) -> bool:
    """A usable public key: 32 bytes of base64 that decode to a point of large order."""
    try:
        return not small_order(b64d(pub_b64, 32))
    except ValueError:
        return False


def verify(pub_b64: str, sig_b64: str, message: bytes) -> bool:
    if not valid_pub(pub_b64):
        return False
    try:
        key = Ed25519PublicKey.from_public_bytes(b64d(pub_b64, 32))
        key.verify(b64d(sig_b64, 64), message)
        return True
    except (ValueError, InvalidSignature):
        return False


def canonical_action(**fields) -> bytes:
    """Bytes a host signs for a SETTINGS or REMOVE action. The `kind` field is
    what stops a signed vote from ever being replayed as one of these (and vice
    versa): a vote's canonical form has no `kind` key at all."""
    assert "kind" in fields
    # surrogatepass: a lone surrogate ("\ud800" in the JSON) used to raise
    # here -- a 500 for anyone. Now it encodes, and simply never verifies.
    return json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8", "surrogatepass")
