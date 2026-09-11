#!/bin/bash
[ -f /run/cron_env ] && source /run/cron_env

# Every cron job on this box writes ONE file per day per job, into the data
# volume -- which is the only filesystem both the container and the host can
# see, and the only one /debug can read. Per-JOB rather than one shared daily
# file because the three writers are three different uids (container root,
# host root, host wai-root) and the first one to create a shared file would
# lock the others out of appending to it.
CRON_DIR=/app/data/cron
mkdir -p "$CRON_DIR"
DAY_LOG="$CRON_DIR/$(date +%F)__morning.log"

if [ -z "$API_KEY" ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: API_KEY not set" | tee -a "$DAY_LOG" >> /var/log/exec-fn.log
    exit 1
fi

curl -sf -X POST http://localhost:8080/api/morning \
    -H "Authorization: Bearer $API_KEY" \
    >> /var/log/exec-fn.log 2>&1

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] morning build exit $?" >> /var/log/exec-fn.log
