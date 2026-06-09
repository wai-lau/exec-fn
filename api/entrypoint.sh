#!/bin/bash
set -e

# Write Docker env vars to a file so cron jobs can read them
# (cron doesn't inherit the container's environment)
printenv | grep -E '^(API_KEY|ANTHROPIC_API_KEY|RMAPI_FORCE_SCHEMA_VERSION)=' > /run/cron_env
chmod 600 /run/cron_env

cron

# --timeout-graceful-shutdown: long-lived SSE streams (/api/monitor/stream) never
# close on their own, so without a cap a --reload (any .py edit) hangs forever
# "Waiting for connections to close" and the site goes down. Cap the drain so a
# reload force-closes streams after 5s; EventSource clients auto-reconnect.
exec uvicorn main:app --host 0.0.0.0 --port 8080 --reload --timeout-graceful-shutdown 5
