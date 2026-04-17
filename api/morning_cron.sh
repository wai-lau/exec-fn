#!/bin/bash
[ -f /run/cron_env ] && source /run/cron_env

if [ -z "$API_KEY" ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: API_KEY not set" >> /var/log/exec-fn.log
    exit 1
fi

curl -sf -X POST http://localhost:8080/api/morning \
    -H "Authorization: Bearer $API_KEY" \
    >> /var/log/exec-fn.log 2>&1

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] morning build exit $?" >> /var/log/exec-fn.log
