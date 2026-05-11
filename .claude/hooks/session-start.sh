#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs Python deps + lint tooling so ruff / eslint can run in-session.
# Idempotent; safe to re-run.
set -euo pipefail

# Local sessions already have the user's full env — only run in the remote sandbox.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "[session-start] installing Python deps..."
python3 -m pip install --quiet --no-cache-dir \
  fastapi uvicorn anthropic pillow reportlab python-multipart \
  google-api-python-client google-auth-httplib2 google-auth-oauthlib \
  pymupdf icalendar pydantic

echo "[session-start] installing lint tooling..."
python3 -m pip install --quiet --no-cache-dir ruff

if command -v npm >/dev/null 2>&1 && [ -f package.json ]; then
  echo "[session-start] installing npm devDependencies for ESLint..."
  npm install --silent --no-audit --no-fund --no-progress
fi

echo "export PYTHONPATH=\"$CLAUDE_PROJECT_DIR/api:\${PYTHONPATH:-}\"" >> "$CLAUDE_ENV_FILE"

echo "[session-start] complete"
