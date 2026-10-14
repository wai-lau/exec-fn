"""A poll that does not exist yet.

"create poll" on the owner page stores NOTHING: it gets a fresh slug and a
token for it (which also says whether the poll will be end-to-end) -- an HMAC of the slug under a server secret -- and opens the page
as a draft. The host's first commit (settings or vote) carries the token back,
and only then is the poll written. So an abandoned "create" leaves no poll
behind, and nobody can mint polls on a slug of their own choosing: without
the owner's token for that exact slug the server does not create anything.

An END-TO-END draft's token also binds the creator's CLAIM key (web/
noodle-claim.js): its public half is in the token, and the poll's first vote
must be signed by its private half, which only the creator's browser holds
(e2e.py). The token alone -- which the server, its logs and anyone watching
them all see -- therefore cannot take the host's seat.

The secret is NOODLE_SECRET if set, else 32 random bytes kept in
DATA_DIR/secret.key (0600), made on first use.
"""
import hashlib
import hmac
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime

from noodle import config, sig, store

UNTITLED = "title"   # the placeholder the host types over (was "untitled noodle")
_secret: bytes | None = None


def _key() -> bytes:
    global _secret
    if _secret is None:
        env = os.environ.get("NOODLE_SECRET")
        if env:
            _secret = env.encode()
        else:
            path = config.DATA_DIR / "secret.key"
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(secrets.token_bytes(32))
            _secret = path.read_bytes()
    return _secret


# One kind of draft is accepted: `<claim>.<mac>`, minted since 2026-10-12, which
# becomes an END-TO-END poll (e2e.py) whose first vote only the claim key's
# holder can cast. Both older kinds are refused -- the bare mac over the slug
# (plain drafts, before 2026-10-09; retired 2026-10-14) and the bare mac over
# b"e2e\0" + slug (2026-10-09..12): whoever had seen such a token (the access
# log keeps them) could commit it first and take the host's seat. Polls already
# made from either are unaffected -- only an uncommitted draft link stops.
_CLAIMED = b"e2e-claim\0"


def _mac(msg: bytes) -> str:
    return hmac.new(_key(), msg, hashlib.sha256).hexdigest()[:32]


def valid_claim(claim) -> bool:
    """A claim is an Ed25519 public key, url-safe base64 as WebCrypto exports it."""
    try:
        return isinstance(claim, str) and len(claim) == 43 and len(sig.b64d(claim, 32)) == 32
    except ValueError:
        return False


def token(slug: str, claim: str | None = None) -> str:
    """An END-TO-END draft's token for this claim key. With no claim: the
    retired PLAIN token (kept so tests can show it is refused)."""
    if claim is None:
        return _mac(slug.encode())
    return f"{claim}.{_mac(_CLAIMED + slug.encode() + b'\0' + claim.encode())}"


def kind(slug: str, tok) -> str | None:
    """'e2e' for this slug's own token, else None."""
    if not isinstance(tok, str) or not tok.isascii() or not store.valid_slug(slug):
        return None
    claim, dot, _ = tok.partition(".")
    if dot:
        return "e2e" if valid_claim(claim) and hmac.compare_digest(tok, token(slug, claim)) else None
    # a bare mac is a PLAIN draft handed out before 2026-10-09: retired
    # 2026-10-14 -- whoever had seen one (the access log keeps them) could
    # commit it first and host. Polls already made from one are unaffected.
    return None


def claim_of(tok: str) -> str:
    """The claim key an END-TO-END token carries (check kind() first)."""
    return tok.partition(".")[0]


def valid(slug: str, tok) -> bool:
    return kind(slug, tok) is not None


def new(claim: str) -> dict:
    """A slug nobody holds yet, and its end-to-end token bound to `claim`.
    Nothing is stored. ValueError for a claim that is not a public key."""
    if not valid_claim(claim):
        raise ValueError("claim must be a public key")
    while True:
        slug = secrets.token_urlsafe(config.SLUG_BYTES)
        if store.valid_slug(slug) and not store.exists(slug):
            return {"slug": slug, "token": token(slug, claim)}


class TooFast(Exception):
    pass


_starts: dict[str, deque] = defaultdict(deque)
_START_LOCK = threading.Lock()


def new_for(ip: str, claim: str, now: float | None = None) -> dict:
    """new(), at most NEW_RATE per NEW_WINDOW_S per client IP: the page that
    starts polls is public, and a draft is a poll anyone holding it may create."""
    if not valid_claim(claim):   # refused before it costs the caller a start
        raise ValueError("claim must be a public key")
    now = time.monotonic() if now is None else now
    with _START_LOCK:
        q = _starts[ip]
        while q and q[0] <= now - config.NEW_WINDOW_S:
            q.popleft()
        if len(q) >= config.NEW_RATE:
            raise TooFast(f"too many new polls -- try again in {int(q[0] + config.NEW_WINDOW_S - now) + 1}s")
        q.append(now)
        # an address whose window has emptied is forgotten, or every client
        # that ever started a poll stays in memory
        for gone in [k for k, v in _starts.items() if not v or v[-1] <= now - config.NEW_WINDOW_S]:
            del _starts[gone]
    return new(claim)


def ensure(slug: str, body: dict, e2e_ok: bool = True) -> bool:
    """Before a commit: write the (end-to-end) poll if it is still a draft and
    the body carries its token. A poll that exists is left alone; one without a
    valid token stays missing (and the commit 404s). e2e_ok=False: this request
    cannot create it (its first write is always the host's vote, never the
    settings). -> whether THIS call created it."""
    if store.exists(slug):
        return False
    tok = body.get("draft")
    if e2e_ok and kind(slug, tok) == "e2e":
        now = datetime.now().isoformat(timespec="seconds")
        return store.try_create(slug, UNTITLED, now, e2e=True, claim=claim_of(tok))
    return False
