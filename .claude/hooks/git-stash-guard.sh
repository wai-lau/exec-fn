#!/usr/bin/env bash
# PreToolUse(Bash) guard: deny a tree-mutating `git stash` in this repo.
#
# Why: /exec-fn has bind-mounted untracked/nested dirs (./nightfall-incident ->
# /app/nightfall, ./graphify-out). `git stash [push|save|-u|...]` removes+restores
# those from the working tree, which STALES the Docker bind mount -> the worker
# crashes on its next --reload (or 502s on a request that reads the mount). Both
# `stash -u` and plain `stash` have taken the site down. The safe way to clear a
# rebase blocker (the regenerated graphify-out artifacts) is `git checkout --`,
# not stash.
#
# Read-only subcommands (`git stash list` / `git stash show`) don't touch the
# tree, so they're allowed. Everything that creates or restores a stash is denied.
#
# Input: tool-call JSON on stdin. Output: nothing (exit 0 = allow) or a PreToolUse
# deny JSON. Fail-open on any error — never block on a hook bug.
set -u

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

payload="$(cat)"
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  cmd="$(printf '%s' "$payload" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')"
fi

# Only care about git stash. (The hook's `if` filter narrows to these, but
# re-check so the script is correct if invoked directly.)
case "$cmd" in
  *"git stash"*) ;;
  *) exit 0 ;;
esac

# Allow the pure read-only forms — they don't mutate the working tree.
rest="$(printf '%s' "${cmd#*git stash}" | sed 's/^[[:space:]]*//')"
case "$rest" in
  list*|show*) exit 0 ;;
esac

reason="git stash is blocked in /exec-fn. It removes+restores the bind-mounted untracked dirs (nightfall-incident -> /app/nightfall, graphify-out), staling the Docker mount, which crashes the worker on the next --reload (502 across every route). To integrate when 'git push' is rejected, clear the rebase blocker by discarding the regenerated graphify-out artifacts instead: 'git checkout -- graphify-out/' then 'git pull --rebase && git push'. If the worker is already crashed, recover with 'docker compose up -d --force-recreate api'. (git stash list / git stash show are allowed.)"

if command -v jq >/dev/null 2>&1; then
  jq -n --arg r "$reason" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
fi
exit 0
