#!/usr/bin/env bash
# PostToolUse(Bash) — push to origin after a commit, without being asked.
#
# Standing rule (memory: feedback_always_push_after_commit): "push after every
# commit, never ask". Doing it here makes it deterministic instead of something
# the model has to remember at the end of a long turn.
#
# The test is the invariant, not this command's exit status: if HEAD is ahead of
# its upstream, push. A rejected push is integrated the way this repo requires —
# discard the regenerated graphify-out artifacts, `pull --rebase`, push again.
# NEVER `git stash` (it stales the bind mounts; see git-stash-guard.sh).
#
# Fail-open: any error exits 0 with a note. Never block on a hook bug.
set -u

cd "${CLAUDE_PROJECT_DIR:-/exec-fn}" 2>/dev/null || exit 0

payload="$(cat)"
# cmdscan strips heredoc bodies, so a script that merely MENTIONS "git commit"
# is not mistaken for one. Falls back to the raw command if python is missing.
cmd="$(printf '%s' "$payload" | python3 "$(dirname "$0")/cmdscan.py" 2>/dev/null)"
[ -n "$cmd" ] || cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
case "$cmd" in
  *--dry-run*) exit 0 ;;
esac

note() {
  jq -n --arg c "$1" \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
  exit 0
}

git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0
gitdir="$(git rev-parse --git-dir 2>/dev/null)"
if [ -d "$gitdir/rebase-merge" ] || [ -d "$gitdir/rebase-apply" ]; then
  exit 0  # mid-rebase — leave the tree alone
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[ "$branch" = "HEAD" ] && exit 0  # detached

if ! upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  note "[hook] '$branch' has no upstream — nothing pushed. Publishing a new remote branch is a deliberate act; set it up yourself if that is intended (\`git push -u origin $branch\`)."
fi

ahead="$(git rev-list --count "$upstream"..HEAD 2>/dev/null || echo 0)"
[ "$ahead" -gt 0 ] 2>/dev/null || exit 0

if out="$(git push 2>&1)"; then
  note "[hook] pushed $ahead commit(s) to $upstream automatically — do NOT run git push again. Say it is pushed when you report back."
fi

# Rejected: remote moved. Discard the regenerated graph artifacts, rebase, retry.
git checkout -- graphify-out/ 2>/dev/null
if pull="$(git pull --rebase 2>&1)"; then
  if out2="$(git push 2>&1)"; then
    note "[hook] push was rejected (remote had moved); rebased onto $upstream and pushed $ahead commit(s). Already done — do NOT push again."
  fi
  note "[hook] rebase succeeded but the push still failed. Do NOT git stash (it stales the bind mounts and 502s the site). Push output:
$out2"
fi
note "[hook] auto-push failed and the rebase did not apply cleanly — resolve it by hand. Do NOT git stash (it stales the bind mounts and 502s the site); clear tracked drift with 'git checkout -- <path>'. Push output:
$out
Pull output:
$pull"
