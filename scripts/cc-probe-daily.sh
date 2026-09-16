#!/usr/bin/env bash
# Re-probe the /cc sandbox whenever the Agent SDK changes underneath it.
#
# CLAUDE.md says to run probe-tools.mjs "after any @anthropic-ai/claude-agent-sdk
# bump". Doing that by hand has a poor record here: the probe was referenced in
# the docs for months without existing as a file, and three harness tools
# (AskUserQuestion, EnterPlanMode, ExitPlanMode) were live the whole time.
#
# THE TRIGGER IS THE INSTALLED VERSION, NOT A COMMIT. package.json pins
# "^0.3.265", so any `npm install` -- a setup.sh re-run, a rebuild -- can pull a
# new minor with no repo change at all. A git-triggered check would miss the
# likeliest path to the exact bug this guards against.
#
# So: compare the installed version against a stamp, and only spend an API call
# when it moved. Normal nights cost one file read and exit silently.
#
# The probe's exit codes carry the distinction that matters:
#   0  the tool set is exactly ALLOWED_TOOLS
#   1  an UNEXPECTED tool reached the model  -> a real finding, shout
#   2  the probe could not run (auth, network, SDK shape) -> noise, retry tomorrow
# Escalating on 2 would cry wolf every time the box had a bad night.
set -uo pipefail

REPO=/exec-fn
APPDIR=/srv/cc-agent
CRON_DIR="$REPO/api/data/cron"
STAMP="$APPDIR/.sdk-probed"
# Overridable so the drift path can be exercised with a stub. The branch that
# shouts is the one that must never be first tried in anger.
PROBE="${CC_PROBE_BIN:-$APPDIR/probe-tools.mjs}"
PKG="$APPDIR/node_modules/@anthropic-ai/claude-agent-sdk/package.json"
LOCK=/tmp/exec-fn-ccprobe.lock

mkdir -p "$CRON_DIR"
LOG="$CRON_DIR/$(date +%F)__ccprobe.log"
say() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

exec 9>"$LOCK"
if ! flock -n 9; then
  say "another run holds the lock; skipping"
  exit 0
fi

if [[ ! -r "$PKG" ]]; then
  say "SDK not installed at $PKG -- nothing to probe"
  exit 0
fi

# node, not jq: node is already a hard dependency of the thing being probed.
VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$PKG" 2>/dev/null)"
if [[ -z "$VERSION" ]]; then
  say "could not read a version out of $PKG -- skipping"
  exit 0
fi

PREV="$(cat "$STAMP" 2>/dev/null || true)"
FORCE="${1:-}"
if [[ "$VERSION" == "$PREV" && "$FORCE" != "--force" ]]; then
  # The quiet path, and the common one. Logged so the absence of a line is
  # itself a signal that the job stopped running.
  say "sdk $VERSION unchanged; probe skipped"
  exit 0
fi

say "sdk ${PREV:-<none>} -> $VERSION -- probing"
OUT="$(sudo -u cc-agent -H timeout 180 node "$PROBE" 2>&1)"
RC=$?
printf '%s\n' "$OUT" >>"$LOG"

case "$RC" in
  0)
    say "OK: tool set matches ALLOWED_TOOLS at sdk $VERSION"
    printf '%s' "$VERSION" >"$STAMP"
    ;;
  1)
    # Do NOT stamp: an unfixed drift must re-report every night rather than
    # going quiet because it was seen once.
    say "!!! TOOL DRIFT after sdk bump to $VERSION -- a tool outside ALLOWED_TOOLS"
    say "!!! /cc hands out a shell; review claude-box/server.mjs BUILTIN_TOOLS now"
    ;;
  *)
    say "probe could not run (exit $RC) -- not a finding; retrying tomorrow"
    ;;
esac
exit 0
