#!/usr/bin/env bash
# Daily graphify rebuild — replaces the per-commit hook.
#
# Rebuilding on every commit was the wrong trigger for something this heavy: it
# fired dozens of times a day on a 1967MB box, and while broken (see below) it
# peaked ~780MB and invoked the GLOBAL oom-killer, which picks a victim by
# badness score rather than by culprit — it took out dbus-daemon and, three
# times, the uvicorn-side python serving the site. A graph that is a few hours
# stale costs nothing; a 502 does.
#
# The per-commit path is disabled via GRAPHIFY_SKIP_HOOK=1 in ~/.zshenv rather
# than by deleting .git/hooks/post-commit, because that hook is untracked and
# session-context.sh reinstalls it — the env var survives a reinstall, a deleted
# hook does not.
#
# Measured 2026-09-10: a full rebuild is 4089 nodes / 6105 edges in 25s at a
# 366MB peak, so the 600MB cap has real headroom. The cap is not decoration —
# if graphify ever regresses, it must die of MemoryError and log it instead of
# taking the site down with it.
set -uo pipefail

REPO=/exec-fn
# Into the data volume, one file per day: it is what /debug can read, and a log
# nobody can see is how a nightly job fails quietly for weeks.
CRON_DIR="$REPO/api/data/cron"
mkdir -p "$CRON_DIR" 2>/dev/null || true
LOG="$CRON_DIR/$(date +%F)__graphify.log"
LOCK=/tmp/graphify-daily.lock
PY=/home/wai-root/.local/share/uv/tools/graphifyy/bin/python

export PYTHONHASHSEED=0                      # deterministic community numbering
export GRAPHIFY_REBUILD_MEMORY_LIMIT_MB=600  # RLIMIT_AS; see the note above
export GRAPHIFY_REBUILD_TIMEOUT=1800

mkdir -p "$(dirname "$LOG")"

if [ ! -x "$PY" ]; then
    echo "[graphify daily] $(date '+%F %T') graphify python missing at $PY" >> "$LOG"
    exit 0        # a missing tool is not a cron failure worth mailing about
fi

cd "$REPO" || exit 0

# -n: if yesterday's run somehow still holds the lock, skip rather than stack a
# second rebuild on top of it. graphify has its own flock on
# graphify-out/.rebuild.lock; this one also covers the process around it.
exec flock -n "$LOCK" "$PY" -c "
import signal, sys, time
from pathlib import Path
from graphify.watch import _rebuild_code, _apply_resource_limits

_apply_resource_limits()          # nice(10) + the RLIMIT from the env above
signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('rebuild exceeded 1800s')))
signal.alarm(1800)

t = time.time()
try:
    # changed_paths=None is the FULL rebuild. An empty list is not the same
    # thing -- it reads as 'no tracked code files' and skips silently.
    _rebuild_code(Path('.'), changed_paths=None, force=True)
    print(f'[graphify daily] {time.strftime(\"%F %T\")} rebuilt in {time.time()-t:.0f}s')
except MemoryError:
    print(f'[graphify daily] {time.strftime(\"%F %T\")} hit the 600MB cap and stopped; site unaffected')
    sys.exit(1)
except Exception as exc:
    print(f'[graphify daily] {time.strftime(\"%F %T\")} failed: {type(exc).__name__}: {exc}')
    sys.exit(1)
" >> "$LOG" 2>&1
