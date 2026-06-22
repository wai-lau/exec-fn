#!/usr/bin/env bash
# PreToolUse(Bash) guard: when a `git commit` stages API source (api/*.py or
# api/templates/*.html) without staging CLAUDE.md / ARCHITECTURE.md, deny the
# tool call and tell Claude to update the docs first (or ack [skip-docs]).
#
# Only the agent-driven path: this is a Claude Code hook, so it fires when
# committing THROUGH Claude, not on a bare terminal `git commit`. Deterministic
# detection here; the doc *writing* is done by Claude acting on the deny reason.
#
# Input: tool-call JSON on stdin. Output: nothing (exit 0 = allow) or a
# PreToolUse deny JSON. Fail-open on any error — never block on a hook bug.
set -u

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Pull the command being run. jq if present, else a tolerant grep fallback.
payload="$(cat)"
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  cmd="$(printf '%s' "$payload" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')"
fi

# Only care about git commits. (The hook's `if` filter already narrows to these,
# but re-check so the script is correct if invoked directly.)
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Explicit opt-out token in the commit message.
case "$cmd" in
  *"[skip-docs]"*) exit 0 ;;
esac

staged="$(git diff --cached --name-only 2>/dev/null)"
[ -n "$staged" ] || exit 0

has_src="$(printf '%s\n' "$staged" | grep -E '^api/.*\.py$|^api/templates/.*\.html$' || true)"
[ -n "$has_src" ] || exit 0

has_docs="$(printf '%s\n' "$staged" | grep -E '^CLAUDE\.md$|^ARCHITECTURE\.md$' || true)"
[ -n "$has_docs" ] && exit 0

reason="This commit stages API source (api/*.py or api/templates/*.html) but does not stage CLAUDE.md or ARCHITECTURE.md. Before committing: review the staged diff (git diff --cached) and, if routes / pipelines / schemas / data files / naming changed, update CLAUDE.md (and ARCHITECTURE.md if it exists) and \`git add\` them. If no docs change is warranted, add the literal token [skip-docs] to the commit message. Then re-run the commit."

if command -v jq >/dev/null 2>&1; then
  jq -n --arg r "$reason" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
else
  # jq absent — emit the JSON directly (reason has no embedded quotes/newlines).
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
fi
exit 0
