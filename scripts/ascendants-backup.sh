#!/bin/bash
# THE ASCENDANTS' daily copy OFF the repo tree (owner, 2026-10-11: the first
# winner - "make sure we never lose it"). /spire's board (api/spire_board.py)
# keeps a journal + board in api/data/; this copies both, dated, to
# /var/backups/spire-ascendants/ - out of reach of anything that resets or
# cleans the checkout. Every day kept (the files are tiny). Host cron:
# /etc/cron.d/exec-fn-ascendants (root, 05:30 - after the other nightly jobs).
set -euo pipefail
SRC=/exec-fn/api/data
DST=/var/backups/spire-ascendants/$(date +%F)
mkdir -p "$DST"
for f in spire_ascendants.json spire_ascendants.jsonl; do
  if [ -f "$SRC/$f" ]; then cp -p "$SRC/$f" "$DST/$f"; fi
done
LOG=/exec-fn/api/data/cron/$(date +%F)__ascendants.log
mkdir -p "$(dirname "$LOG")"
echo "$(date -Is) backed up to $DST: $(ls "$DST" | tr '\n' ' ')" >> "$LOG"
