import hashlib
import os
from typing import Optional

from fastapi import Cookie, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

API_KEY = os.environ["API_KEY"]
GUEST_KEY = os.environ["GUEST_KEY"]

SESSION_TOKEN = hashlib.sha256(f"session:{API_KEY}".encode()).hexdigest()
GUEST_SESSION_TOKEN = hashlib.sha256(f"guest:{GUEST_KEY}".encode()).hexdigest()

bearer = HTTPBearer(auto_error=False)


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
    if credentials and credentials.credentials in (API_KEY, GUEST_KEY):
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
