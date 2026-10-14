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
  ctx="LOCAL CLAUDE — cwd '$root' on host '$host' is a dev MIRROR. Nothing is live until you commit, push, and deploy over SSH: ssh wai-root@wai-lau.net 'bash /exec-fn/scripts/deploy.sh'. Auto-deploy is the expected workflow — run it yourself, don't hand it back."
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

# Submodules (apps/<name>, nightfall-incident). Two things a fresh clone or a
# deploy's `git submodule update` leave wrong:
#  - a DETACHED HEAD: a commit made there belongs to no branch and is lost at the
#    next update. Re-attach to master when HEAD is exactly origin/master (never
#    move a HEAD that carries its own work).
#  - no pre-commit: hooks are per-repo. An app (apps/*) mirrors the parent, so
#    it gets the PARENT's scripts/pre-commit (shared lints/tests, then the app's
#    own scripts/pre-commit). Any other submodule (claude-box, nightfall) is laid
#    out differently and gets ITS OWN scripts/pre-commit, if it has one.
subs=""
paths="$(git config --file .gitmodules --get-regexp '\.path$' 2>/dev/null | awk '{print $2}')"
for p in $paths; do
  [ -e "$p/.git" ] || continue
  head="$(git -C "$p" rev-parse HEAD 2>/dev/null)"
  if [ "$(git -C "$p" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "HEAD" ] \
     && [ "$head" = "$(git -C "$p" rev-parse origin/master 2>/dev/null)" ]; then
    # Local master must be absent (create it) or AT this commit — a master that
    # points elsewhere holds work this must not move or drop.
    lm="$(git -C "$p" rev-parse -q --verify refs/heads/master 2>/dev/null)"
    if { [ -z "$lm" ] && git -C "$p" switch -q -c master --track origin/master 2>/dev/null; } \
       || { [ "$lm" = "$head" ] && git -C "$p" switch -q master 2>/dev/null; }; then
      subs="${subs}
[hook] $p was on a detached HEAD — switched it to master (same commit)."
    fi
  fi
  case "$p" in
    apps/*) src="$root/scripts/pre-commit" ;;
    *) src="$root/$p/scripts/pre-commit" ;;
  esac
  [ -x "$src" ] || continue
  hookdir="$(git -C "$p" rev-parse --path-format=absolute --git-path hooks 2>/dev/null)" || continue
  if [ -n "$hookdir" ] && [ ! -e "$hookdir/pre-commit" ]; then
    mkdir -p "$hookdir" && ln -s "$src" "$hookdir/pre-commit" \
      && subs="${subs}
[hook] installed ${src#"$root"/} as $p's pre-commit."
  fi
done

jq -n --arg c "$ctx$graph$subs" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
exit 0
