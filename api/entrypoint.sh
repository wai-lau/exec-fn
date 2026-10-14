#!/bin/bash
set -e

# Write Docker env vars to a file so cron jobs can read them
# (cron doesn't inherit the container's environment)
printenv | grep -E '^(API_KEY|ANTHROPIC_API_KEY)=' > /run/cron_env
chmod 600 /run/cron_env

cron

# --timeout-graceful-shutdown: long-lived SSE streams (/api/monitor/stream) never
# close on their own, so without a cap a --reload (any .py edit) hangs forever
# "Waiting for connections to close" and the site goes down. Cap the drain so a
# reload force-closes streams after 5s; EventSource clients auto-reconnect.
# --reload-exclude: the app submodules (apps/<name>) sit inside /app, so without
# it editing an app's TEST or a script (aspira-sim's applyfit.py) would reload
# the live worker. Their api/ still reloads like ours. FILE globs, not dirs:
# uvicorn 0.53 matches a non-directory exclude against each changed file with
# Path.match (right-anchored, no **), so `apps/*/tests` alone matched nothing --
# hence one pattern per depth. ARCHITECTURE.md §1e.
exec uvicorn main:app --host 0.0.0.0 --port 8080 --reload --timeout-graceful-shutdown 5 \
  --reload-exclude 'apps/*/tests/*.py' \
  --reload-exclude 'apps/*/scripts/*.py' --reload-exclude 'apps/*/scripts/*/*.py'
