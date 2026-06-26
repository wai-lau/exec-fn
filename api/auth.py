import hashlib
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
    if session == SESSION_TOKEN:
        return
    if credentials and credentials.credentials == API_KEY:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def require_guest_auth(
    session: Optional[str] = Cookie(default=None),
    guest_session: Optional[str] = Cookie(default=None),
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer),
):
    if session == SESSION_TOKEN:
        return
    if guest_session == GUEST_SESSION_TOKEN:
        return
    if credentials and credentials.credentials == API_KEY:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
