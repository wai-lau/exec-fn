# One-time Google Calendar OAuth2 setup.
#
# Prerequisites:
#   1. Create a Google Cloud project, enable Calendar API
#   2. Create OAuth2 credentials (Desktop app type), download as credentials.json
#   3. Copy credentials.json into the gcal-auth volume:
#      docker compose cp credentials.json api:/root/.config/gcal/credentials.json
#
# Run auth (needs port 8765 reachable — SSH tunnel or temporary port mapping):
#   docker compose exec -it api python3 gcal_auth.py
#
# SSH tunnel from WSL: ssh -L 8765:localhost:8765 root@wai-lau.net
# Then visit the printed URL in your browser.

from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
CONFIG_DIR = Path("/root/.config/gcal")
CREDS_FILE = CONFIG_DIR / "credentials.json"
TOKEN_FILE = CONFIG_DIR / "token.json"

CONFIG_DIR.mkdir(parents=True, exist_ok=True)

if not CREDS_FILE.exists():
    raise SystemExit(f"Missing {CREDS_FILE} — copy your credentials.json there first.")

flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
creds = flow.run_local_server(port=8765, open_browser=False, bind_addr="0.0.0.0")
TOKEN_FILE.write_text(creds.to_json())
print(f"Saved token to {TOKEN_FILE}")
