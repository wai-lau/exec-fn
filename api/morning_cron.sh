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

# BOTH lines tee into $DAY_LOG. They used to land only in the container's own
# /var/log/exec-fn.log, which /debug cannot read -- so DAY_LOG was computed, its
# directory created, and then written by nothing but the API_KEY branch above.
# No __morning.log was ever produced: of the five nightly jobs, the one whose
# silent failure matters most was the one invisible on the page built to catch
# exactly that. Found 2026-09-21, from the other four jobs' logs being there.
curl -sf -X POST http://localhost:8080/api/morning \
    -H "Authorization: Bearer $API_KEY" \
    2>&1 | tee -a "$DAY_LOG" >> /var/log/exec-fn.log

# ${PIPESTATUS[0]} is curl's status, NOT tee's. Through the pipe above, $? is
# tee, which succeeds whatever the POST did -- that is how a failed morning
# would log "exit 0" and read as a clean night.
STATUS=${PIPESTATUS[0]}
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] morning build exit $STATUS" | tee -a "$DAY_LOG" >> /var/log/exec-fn.log
