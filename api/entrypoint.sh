#!/bin/bash
set -e

# Write Docker env vars to a file so cron jobs can read them
# (cron doesn't inherit the container's environment)
printenv | grep -E '^(API_KEY|ANTHROPIC_API_KEY)=' > /run/cron_env
chmod 600 /run/cron_env

cron

exec uvicorn main:app --host 0.0.0.0 --port 8080 --reload
