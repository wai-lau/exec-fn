#!/usr/bin/env bash
# Home GPU box watchdog for the exec-fn TTS upstream (Kokoro/Chatterbox).
#
# The droplet reaches this server over an SSH reverse tunnel. When the server
# process dies, the tunnel port still ACCEPTS then resets the connection, so the
# droplet sees "Connection reset by peer" and /hosaka shows "TTS server offline".
# This script restarts the server whenever its local port stops answering --
# covering both a crash (process gone) and a hang (alive but unresponsive, which
# systemd Restart=always does NOT catch).
#
# Run every minute from cron, or via exec-fn-tts-watchdog.timer. Configure:
#   TTS_PORT   local port the model server listens on (matches the tunnel target)
#   START_CMD  exact command that launches the server (REQUIRED, or the script
#              only logs and exits)
set -euo pipefail

TTS_PORT="${TTS_PORT:-8123}"
START_CMD="${START_CMD:-}"   # e.g. "conda run -n tts python -m tts_server --port 8123"
HEALTH_URL="http://127.0.0.1:${TTS_PORT}/v1/voices"
LOG="${TTS_WATCHDOG_LOG:-$HOME/.local/state/exec-fn-tts-watchdog.log}"

mkdir -p "$(dirname "$LOG")"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

# Healthy -> nothing to do. (A real response, not just a bound port.)
if curl -fsS --max-time 4 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

if [ -z "$START_CMD" ]; then
  echo "$(ts) upstream down on :$TTS_PORT but START_CMD unset -- edit this script" >>"$LOG"
  exit 1
fi

echo "$(ts) upstream down on :$TTS_PORT -- restarting" >>"$LOG"
# Best-effort kill of a hung instance still holding the port (no-op if gone).
pkill -f "$START_CMD" 2>/dev/null || true
sleep 1
nohup bash -lc "$START_CMD" >>"$LOG" 2>&1 &
echo "$(ts) restart launched (pid $!)" >>"$LOG"
