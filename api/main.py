import os
from fastapi import FastAPI, Security, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles

API_KEY = os.environ["API_KEY"]
bearer = HTTPBearer()

def require_auth(credentials: HTTPAuthorizationCredentials = Security(bearer)):
    if credentials.credentials != API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")

app = FastAPI()

app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
