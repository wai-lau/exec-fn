#!/usr/bin/env bash
# Regenerate api/requirements.txt (the lock) from api/requirements.in (the direct
# deps). Resolves in a throwaway python:3.12-slim -- the same base api/Dockerfile
# uses -- so the pins match what the image will actually get, not what this host
# happens to have.
#
#   bash scripts/lock-requirements.sh
#
# This deliberately does a FRESH resolve: it moves versions forward. That is the
# point of running it. Nothing is verified by resolving, so ALWAYS finish with:
#
#   sudo docker compose build api && sudo docker compose up -d api
#   curl -s -o /dev/null -w '%{http_code}\n' https://wai-lau.net/
#
# because the failure this whole file exists to prevent -- anthropic and mcp
# moving to httpx2 and taking auth.py's httpx with them, 2026-09-17 -- looked
# perfectly fine until the container tried to import main.py.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IN="$ROOT/api/requirements.in"
OUT="$ROOT/api/requirements.txt"
BASE="python:3.12-slim"

[ -f "$IN" ] || { echo "missing $IN" >&2; exit 1; }

# The docker socket is root-owned on this box; fall back to sudo when the plain
# client cannot reach it.
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
fi

echo "resolving $IN against $BASE ..." >&2
freeze="$(
  "${DOCKER[@]}" run --rm -i "$BASE" sh -c '
    cat > /tmp/requirements.in
    pip install --quiet --no-cache-dir --disable-pip-version-check \
      -r /tmp/requirements.in >&2
    pip freeze --exclude-editable
  ' < "$IN"
)"

# pip/setuptools/wheel are the interpreter's own furniture, not app deps.
pinned="$(printf '%s\n' "$freeze" | grep -viE '^(pip|setuptools|wheel)==' | sort -f)"

count="$(printf '%s\n' "$pinned" | grep -c '==')"
[ "$count" -gt 0 ] || { echo "resolve produced nothing -- refusing to write" >&2; exit 1; }

{
  echo "# GENERATED -- DO NOT EDIT BY HAND. Edit api/requirements.in, then run:"
  echo "#     bash scripts/lock-requirements.sh"
  echo "#"
  echo "# A full lock: direct deps AND every transitive, pinned. Unpinned, each"
  echo "# rebuild re-resolved the whole tree -- which on 2026-09-17 swapped"
  echo "# anthropic + mcp onto httpx2, dropped the transitive httpx that"
  echo "# api/auth.py imports by name, and 502'd every route."
  echo "#"
  echo "# Locked $(date +%F) against $BASE."
  echo ""
  printf '%s\n' "$pinned"
} > "$OUT"

echo "wrote $OUT ($count packages pinned)" >&2
echo "NOW REBUILD AND VERIFY -- a resolve proves nothing:" >&2
echo "  sudo docker compose build api && sudo docker compose up -d api" >&2
