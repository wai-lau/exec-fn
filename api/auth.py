import hashlib
import hmac
import os
from typing import Optional

import httpx
from fastapi import Cookie, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

API_KEY = os.environ["API_KEY"]
TURNSTILE_SITE_KEY = os.environ["TURNSTILE_SITE_KEY"]
TURNSTILE_SECRET = os.environ["TURNSTILE_SECRET"]

SESSION_TOKEN = hashlib.sha256(f"session:{API_KEY}".encode()).hexdigest()
# Guest cookie value. Derived from the Turnstile secret now that the shared
# GUEST_KEY is gone — a fixed, server-only token a browser can't forge. A guest
# earns it by solving a Cloudflare Turnstile challenge at POST /guest.
GUEST_SESSION_TOKEN = hashlib.sha256(f"guest:{TURNSTILE_SECRET}".encode()).hexdigest()

# How long a login sticks. Both tokens above are DERIVED from server env, so they
# already survive every restart — what was ending the session was the cookie
# itself: set with no max-age, it is a browser-session cookie the browser drops
# when its session ends (a phone evicting the tab, a standalone PWA being killed),
# which reads as "the server logged me out". 400 days is the ceiling Chrome and
# Safari clamp any cookie to, and the same value the nightfall `nf_save` cookie
# already uses. Safari's 7-day ITP cap applies to script-written cookies, not to
# these — they are HttpOnly, set by the server.
SESSION_MAX_AGE = 400 * 86400

_TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

bearer = HTTPBearer(auto_error=False)


async def verify_turnstile(token: str, remoteip: Optional[str] = None) -> bool:
    """True iff Cloudflare attests the Turnstile token. Empty token short-circuits
    (no network call) so a missing/blank field is a fast 401."""
    if not token:
        return False
    data = {"secret": TURNSTILE_SECRET, "response": token}
    if remoteip:
        data["remoteip"] = remoteip
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(_TURNSTILE_VERIFY_URL, data=data)
        return bool(r.json().get("success"))
    except (httpx.HTTPError, ValueError):
        return False


def require_auth(
    session: Optional[str] = Cookie(default=None),
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer),
):
    if hmac.compare_digest(session or "", SESSION_TOKEN):
        return
    if credentials and hmac.compare_digest(credentials.credentials, API_KEY):
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def require_guest_auth(
    session: Optional[str] = Cookie(default=None),
    guest_session: Optional[str] = Cookie(default=None),
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer),
):
    if hmac.compare_digest(session or "", SESSION_TOKEN):
        return
    if hmac.compare_digest(guest_session or "", GUEST_SESSION_TOKEN):
        return
    if credentials and hmac.compare_digest(credentials.credentials, API_KEY):
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
