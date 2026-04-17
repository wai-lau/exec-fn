import os
import re
import secrets
from fastapi import FastAPI, Depends, HTTPException, status, Cookie, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Security
from typing import Optional

API_KEY = os.environ["API_KEY"]
bearer = HTTPBearer(auto_error=False)
SESSION_TOKEN = secrets.token_urlsafe(32)

GREEN_OVERLAY = """
<style>
  html { filter: hue-rotate(150deg); }
</style>
"""

with open("/app/static/index.html") as f:
    _INDEX = f.read()

_NO_FORM = re.sub(r'<form class="login-box".*?</form>', '', _INDEX, flags=re.DOTALL)
EXEC_HTML = _NO_FORM.replace("</head>", GREEN_OVERLAY + "</head>", 1)

app = FastAPI()


def require_auth(
    session: Optional[str] = Cookie(default=None),
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer),
):
    if session == SESSION_TOKEN:
        return
    if credentials and credentials.credentials == API_KEY:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@app.post("/login")
async def login(request: Request):
    form = await request.form()
    key = form.get("key", "")
    if not secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid key")
    resp = RedirectResponse(url="/exec", status_code=303)
    resp.set_cookie("session", SESSION_TOKEN, httponly=True, samesite="lax", secure=False)
    return resp


@app.get("/exec", response_class=HTMLResponse, dependencies=[Depends(require_auth)])
async def exec_page():
    return EXEC_HTML


app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
