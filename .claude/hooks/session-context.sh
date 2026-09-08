#!/usr/bin/env bash
# SessionStart — state which of the two contexts this session is, and keep the
# graphify commit hooks installed.
#
# CLAUDE.md opens with "TWO CONTEXTS — know which you are before deploying":
# droplet claude edits the LIVE tree (no SSH, no pull, never `git reset --hard`),
# local claude edits a mirror that reaches production only over SSH. Getting that
# backwards is an outage, so it is answered here from the machine itself rather
# than inferred each session.
#
# Also enforces memory feedback_graphify_commit_hook: every graphified repo keeps
# `graphify hook install` (post-commit) so the graph never goes silently stale.
#
# Fail-open: any error exits 0 with no context. Never block on a hook bug.
set -u

root="${CLAUDE_PROJECT_DIR:-/exec-fn}"
cd "$root" 2>/dev/null || exit 0

host="$(hostname 2>/dev/null || echo unknown)"
if [ "$host" = "main" ] && [ "$root" = "/exec-fn" ]; then
  ctx="DROPLET CLAUDE — cwd /exec-fn on the live server (host '$host'). This working tree IS production: api/ is volume-mounted with uvicorn --reload and web/ + api/templates/ are read per request, so every edit is live on save. No SSH, no git pull, no docker cp, NEVER 'git reset --hard' (it would discard your own uncommitted edits). Commit + push; the push happens automatically via the push-after-commit hook."
else
  ctx="LOCAL CLAUDE — cwd '$root' on host '$host' is a dev MIRROR. Nothing is live until you commit, push, and deploy over SSH: ssh wai-root@wai-lau.net 'cd /exec-fn && sudo git fetch origin && sudo git reset --hard origin/master && sudo docker compose up -d --force-recreate api'. Auto-deploy is the expected workflow — run it yourself, don't hand it back."
fi

# Keep graphify's post-commit rebuild installed in this repo and the nested one.
graph=""
if command -v graphify >/dev/null 2>&1; then
  for repo in "$root" "$root/nightfall-incident"; do
    [ -d "$repo/.git" ] || continue
    status="$(cd "$repo" && timeout 15 graphify hook status 2>/dev/null)"
    case "$status" in
      *"post-commit: installed"*) continue ;;
    esac
    if (cd "$repo" && timeout 30 graphify hook install >/dev/null 2>&1); then
      graph="${graph}
[hook] graphify commit hook was missing in $repo — reinstalled (git hooks are local, so a fresh clone loses them)."
    fi
  done
fi

jq -n --arg c "$ctx$graph" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
exit 0
