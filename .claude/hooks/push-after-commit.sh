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
# SUBMODULES (apps/<name>, nightfall-incident): the commit is pushed in the repo
# it RAN in (commit_repo.py), and then the parent's pointer is bumped and pushed
# too — submodule FIRST, because push.recurseSubmodules=check refuses a parent
# that points at an unpushed commit. The bump commits ONLY the gitlink path, so
# another session's staged files stay staged, and only ever moves the pointer
# FORWARD: after a `pull --rebase` the recorded SHA can be newer than this
# checkout's, and bumping then would roll the submodule back.
#
# Fail-open: any error exits 0 with a note. Never block on a hook bug.
set -u

project="${CLAUDE_PROJECT_DIR:-/exec-fn}"
cd "$project" 2>/dev/null || exit 0
project="$(pwd -P)"

payload="$(cat)"
# cmdscan strips heredoc bodies, so a script that merely MENTIONS "git commit"
# is not mistaken for one. Falls back to the raw command if python is missing.
cmd="$(printf '%s' "$payload" | python3 "$(dirname "$0")/cmdscan.py" 2>/dev/null)"
[ -n "$cmd" ] || cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"

# `git commit` or `git -C <dir> commit` (a submodule commit from the parent).
[[ $cmd =~ git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit ]] || exit 0
case "$cmd" in
  *--dry-run*) exit 0 ;;
esac

note() {
  jq -n --arg c "$1" \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
  exit 0
}

repo="$(printf '%s' "$payload" | python3 "$(dirname "$0")/commit_repo.py" "$project" 2>/dev/null)"
[ -n "$repo" ] || repo="$project"

# push_repo <dir>: push <dir>'s branch if it is ahead. Sets MSG; returns 0 when
# pushed or nothing to push, 1 when it needs a human.
MSG=""
push_repo() {
  local dir="$1" gitdir branch upstream ahead out out2 pull
  cd "$dir" 2>/dev/null || { MSG="cannot cd $dir"; return 1; }
  git rev-parse --verify HEAD >/dev/null 2>&1 || { MSG=""; return 0; }
  gitdir="$(git rev-parse --git-dir 2>/dev/null)"
  if [ -d "$gitdir/rebase-merge" ] || [ -d "$gitdir/rebase-apply" ]; then
    MSG=""; return 0  # mid-rebase — leave the tree alone, say nothing
  fi
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ "$branch" = "HEAD" ]; then
    MSG="[hook] $dir is on a detached HEAD — nothing pushed. In a submodule, \`git -C $dir switch master\` and commit there."
    return 1
  fi
  if ! upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    MSG="[hook] '$branch' in $dir has no upstream — nothing pushed. Publishing a new remote branch is a deliberate act; set it up yourself if that is intended (\`git push -u origin $branch\`)."
    return 1
  fi
  ahead="$(git rev-list --count "$upstream"..HEAD 2>/dev/null || echo 0)"
  [ "$ahead" -gt 0 ] 2>/dev/null || { MSG=""; return 0; }

  if out="$(git push 2>&1)"; then
    MSG="[hook] pushed $ahead commit(s) in $dir to $upstream automatically — do NOT run git push again. Say it is pushed when you report back."
    return 0
  fi
  # Rejected: remote moved. Discard the regenerated graph artifacts, rebase, retry.
  git checkout -- graphify-out/ 2>/dev/null
  if pull="$(git pull --rebase 2>&1)"; then
    if out2="$(git push 2>&1)"; then
      MSG="[hook] push in $dir was rejected (remote had moved); rebased onto $upstream and pushed $ahead commit(s). Already done — do NOT push again."
      return 0
    fi
    MSG="[hook] rebase in $dir succeeded but the push still failed. Do NOT git stash (it stales the bind mounts and 502s the site). Push output:
$out2"
    return 1
  fi
  MSG="[hook] auto-push in $dir failed and the rebase did not apply cleanly — resolve it by hand. Do NOT git stash (it stales the bind mounts and 502s the site); clear tracked drift with 'git checkout -- <path>'. Push output:
$out
Pull output:
$pull"
  return 1
}

push_repo "$repo" || note "${MSG:-[hook] nothing pushed in $repo.}"
[ "$repo" = "$project" ] && { [ -n "$MSG" ] && note "$MSG"; exit 0; }

# ── A submodule commit: bump the parent's pointer, forward only. ──
sub_msg="$MSG"
rel="${repo#"$project"/}"
[ "$rel" != "$repo" ] || { [ -n "$sub_msg" ] && note "$sub_msg"; exit 0; }
cd "$project" || exit 0
mode="$(git ls-files -s -- "$rel" 2>/dev/null | awk '{print $1; exit}')"
[ "$mode" = "160000" ] || { [ -n "$sub_msg" ] && note "$sub_msg"; exit 0; }

recorded="$(git rev-parse "HEAD:$rel" 2>/dev/null)"
new="$(git -C "$repo" rev-parse HEAD 2>/dev/null)"
if [ -z "$new" ] || [ "$recorded" = "$new" ]; then
  [ -n "$sub_msg" ] && note "$sub_msg"; exit 0
fi
if [ -n "$recorded" ] && ! git -C "$repo" merge-base --is-ancestor "$recorded" "$new" 2>/dev/null; then
  note "$sub_msg
[hook] parent pointer NOT bumped: $rel is recorded at ${recorded:0:7}, which is not an ancestor of the checkout's ${new:0:7} (the parent moved ahead, or the submodule diverged). Update the submodule (\`git -C $rel pull --rebase\`) and bump by hand."
fi
if ! out="$(git commit -q -m "chore(apps): bump $rel to ${new:0:7}" -- "$rel" 2>&1)"; then
  note "$sub_msg
[hook] parent pointer bump for $rel failed — commit it by hand (\`git commit -m 'bump $rel' -- $rel\`):
$out"
fi
push_repo "$project"
note "$sub_msg
[hook] bumped the parent's $rel pointer to ${new:0:7} in its own commit. ${MSG:-}"
