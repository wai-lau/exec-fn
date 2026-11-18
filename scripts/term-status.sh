#!/bin/bash
# Host-side half of the Exec panel's status bar: the two figures on the
# terminal status line (~/.claude/statusline-command.sh) that only the HOST can
# see. The container cannot read ~wai-root or count host processes, and the
# sidecar's sandbox must stay sealed (claude-box ARCHITECTURE S-3), so this
# writes them where the app can read them: api/data/term_status.json.
#
#   alts          interactive Claude Code sessions on this box (cc-agent's
#                 own CLI runs are the panel itself, so they are not counted)
#   snooze_until  the pace-cap snooze expiry (~/bin/pace-snooze), epoch secs
#
# Run every minute by /etc/cron.d/exec-fn-termstatus as wai-root. Logs only
# when it fails (to data/cron/<day>__termstatus.log): a line a minute would
# bury the /debug cron viewer.
set -uo pipefail

DATA=/exec-fn/api/data

write_status() {
  set -e
  local out=$DATA/term_status.json alts snooze
  alts=$(pgrep -xc claude --euid "$(id -u wai-root),$(id -u root)" || true)
  snooze=$(cat /home/wai-root/.claude/cache/pace-snooze 2>/dev/null || true)
  snooze=${snooze%%.*}
  [[ "$snooze" =~ ^[0-9]+$ ]] || snooze=0
  printf '{"at":%s,"alts":%s,"snooze_until":%s}\n' "$(date +%s)" "${alts:-0}" "$snooze" > "$out.tmp"
  mv "$out.tmp" "$out"
}

if ! err=$(write_status 2>&1); then
  printf '%s FAIL %s\n' "$(date '+%F %T')" "$err" >> "$DATA/cron/$(date +%F)__termstatus.log"
  exit 1
fi
