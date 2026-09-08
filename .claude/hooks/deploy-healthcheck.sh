#!/usr/bin/env bash
# PostToolUse(Bash) — after anything that deploys, prove the live site answers.
#
# Standing rule (memory: feedback_check_after_deploy): Wai asked "is the server
# down?" right after a deploy. He wants the change confirmed live, not "pushed".
# Doing the curl here means the evidence is always in hand before the report.
#
# Triggers: commit / push (on the droplet the working tree IS production),
# `docker compose up|restart`, and the local-claude SSH deploy.
#
# A 200 from the public landing page is healthy. Retries a few times because a
# --reload worker swap can briefly 502 mid-request.
#
# Fail-open: any error exits 0. Never block on a hook bug.
set -u

payload="$(cat)"
# cmdscan strips heredoc bodies, so a script that merely MENTIONS a deploy
# command is not mistaken for one. Falls back to raw if python is missing.
cmd="$(printf '%s' "$payload" | python3 "$(dirname "$0")/cmdscan.py" 2>/dev/null)"
[ -n "$cmd" ] || cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0

deploying=0
case "$cmd" in
  *"git commit"*|*"git push"*) deploying=1 ;;
  *"docker compose up"*|*"docker compose restart"*|*"docker-compose up"*) deploying=1 ;;
  *"wai-root@wai-lau.net"*) deploying=1 ;;
esac
[ "$deploying" -eq 1 ] || exit 0
case "$cmd" in *--dry-run*) exit 0 ;; esac

url="https://wai-lau.net/"
code=""
timing=""
for _ in 1 2 3 4 5; do
  read -r code timing <<<"$(curl -s -o /dev/null -m 8 -w '%{http_code} %{time_total}' "$url" 2>/dev/null)"
  case "$code" in
    200|301|302) break ;;
  esac
  sleep 2
done

case "$code" in
  200|301|302)
    msg="[hook] live check: $url -> $code in ${timing}s. Site is up; you may report the deploy as verified (this check is already done — no need to curl again)."
    ;;
  000|"")
    msg="[hook] live check FAILED: $url did not answer (curl 000) after 5 tries. Do not report success. Check 'docker compose ps' and 'docker compose logs --tail 30 api' — the two known causes are the SSE graceful-shutdown drain hang and a staled /app/nightfall bind mount; both recover with 'docker compose up -d --force-recreate api'."
    ;;
  *)
    msg="[hook] live check: $url -> $code (unexpected). Investigate before reporting the deploy done: 'docker compose logs --tail 30 api'. Note a 401 on an AUTH-GATED route is healthy, but the landing page should be 200."
    ;;
esac

jq -n --arg c "$msg" \
  '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
exit 0
