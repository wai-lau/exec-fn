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
# graphify REFUSES to emit graph.html past this many nodes and logs a skip that
# is easy to miss -- which is exactly what happened on 2026-09-22: the repo
# crossed the 5000 default (5057 nodes), graph.html was silently not written,
# /graph 404'd all day, and the layout bake then sat on that 404 page until its
# 600s playwright timeout. The node count is the repo's own growth, not a
# regression, so the ceiling moves with it. The real guard is the RLIMIT above:
# if the viz ever gets genuinely too big, it must die of MemoryError and log it
# rather than be skipped into a 404.
export GRAPHIFY_VIZ_NODE_LIMIT=8000

mkdir -p "$(dirname "$LOG")"

if [ ! -x "$PY" ]; then
    echo "[graphify daily] $(date '+%F %T') graphify python missing at $PY" >> "$LOG"
    exit 0        # a missing tool is not a cron failure worth mailing about
fi

cd "$REPO" || exit 0

log() { echo "[graphify daily] $(date '+%F %T') $*" >> "$LOG"; }

# -n: if yesterday's run somehow still holds the lock, skip rather than stack a
# second rebuild on top of it. graphify has its own flock on
# graphify-out/.rebuild.lock; this one also covers the process around it.
#
# Held on FD 9 rather than by exec'ing flock, because the publish step below has
# to run after the rebuild returns -- an exec'd flock replaces this shell and
# there is nothing left to run.
exec 9>"$LOCK"
if ! flock -n 9; then
    log "another run holds the lock; skipped"
    exit 0
fi

# Stamped BEFORE the rebuild so the assert below can ask "did this run write it?"
# rather than comparing graph.html against graph.json -- their relative write
# order is graphify's business and a version bump could reverse it, which would
# turn the assert into a nightly false positive.
start_epoch=$(date +%s)

"$PY" -c "
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
rebuilt=$?
[ "$rebuilt" -eq 0 ] || exit "$rebuilt"

# --- assert the artifact this whole job exists to produce -----------------
#
# graphify does NOT fail a rebuild that could not write graph.html. Past
# GRAPHIFY_VIZ_NODE_LIMIT it logs one "Skipped graph.html" line, writes
# graph.json + GRAPH_REPORT.md anyway, reports "Rebuilt: N nodes" and returns
# SUCCESS. On 2026-09-22 the repo crossed the 5000 default and all three steps
# downstream believed it:
#
#   - /graph served "404 graph.html not found" for the whole day;
#   - the bake below drove that 404 page and sat on wait_for_function for its
#     full 600s playwright timeout before failing "non-fatally" -- ten minutes
#     of headless WebKit on a 1967MB box, for nothing;
#   - and the publish step stages with `git add -A`, so it committed the
#     DELETION of a tracked file and pushed it (0f1d78e, 307 deletions).
#
# That last one is why this sits ahead of BOTH of them and exits non-zero: a
# rebuild that did not produce the file /graph serves is a failed rebuild, and
# the one thing it must never do is get recorded as a green nightly and leave
# the box. The previous graph.html is restored from git on the way out, because
# /graph on yesterday's graph is a working page and 404 is not -- the same
# argument the bake makes for itself two blocks down, where slow beats broken.
VIZ=graphify-out/graph.html
viz_epoch=$(stat -c %Y "$VIZ" 2>/dev/null || echo 0)
if [ ! -s "$VIZ" ] || [ "$viz_epoch" -lt "$start_epoch" ]; then
    log "FAILED: this run wrote no graphify-out/graph.html, and the rebuild above still reported success"
    log "  grep the rebuild output in this log for 'Skipped graph.html' -- that is the only place graphify says so"
    log "  most likely the node count passed GRAPHIFY_VIZ_NODE_LIMIT=$GRAPHIFY_VIZ_NODE_LIMIT; raise it here and re-run"
    if git checkout -- "$VIZ" 2>>"$LOG" && [ -s "$VIZ" ]; then
        log "  restored the committed graph.html; /graph serves a stale graph instead of a 404"
    else
        log "  and git has no copy to restore -- /graph IS A 404 until this is fixed by hand"
    fi
    log "  nothing baked, nothing committed, nothing pushed"
    exit 1
fi

# The ceiling is a cliff with no warning on the approach, so measure the
# approach: the node count is the repo's own growth and it only goes one way.
nodes=$(grep -ao 'Rebuilt: [0-9]* nodes' "$LOG" | tail -1 | tr -dc '0-9')
if [ -n "$nodes" ]; then
    pct=$(( nodes * 100 / GRAPHIFY_VIZ_NODE_LIMIT ))
    log "viz headroom: $nodes nodes, ${pct}% of the $GRAPHIFY_VIZ_NODE_LIMIT ceiling"
    if [ "$pct" -ge 90 ]; then
        log "  WARNING: within 10% of the ceiling -- raise GRAPHIFY_VIZ_NODE_LIMIT before it skips graph.html again"
    fi
fi

# --- bake the layout -----------------------------------------------------
#
# /graph's node layout is ~270 forceAtlas2 iterations over ~2700 nodes. Left to
# the browser that is a few seconds on a desktop and measured around THIRTY on a
# phone, on every single visit, for a layout that comes out the same every time.
# So it is computed here, once, against the graph that was just rebuilt, and the
# page serves the baked positions with physics switched off entirely.
#
# It drives a real vis-network in a headless browser (see scripts/graph-layout.py
# for why), so it is capped like every other browser launch on this box -- a
# WebKit start is 200-400MB against ~650MB free at rest, and the global OOM
# killer picks by badness score rather than by culprit.
#
# A failure here is NOT fatal: the layout file simply stays as it was, its key no
# longer matches the rebuilt graph, and every visitor falls back to stabilising
# in the browser exactly as before. Slow is not broken, so this must never take
# the nightly down with it.
# cron has no session bus, so systemd-run --user cannot find one and the cap
# would silently never apply -- it fails with "Failed to connect to bus: No
# medium found" and the bake would take the failure branch every night. The
# runtime dir is there, it is only unexported, so name it.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if systemd-run --user --scope -q -p MemoryMax=700M \
        "$REPO/.venv/bin/python" "$REPO/scripts/graph-layout.py" >> "$LOG" 2>&1; then
    log "baked the graph layout"
else
    log "layout bake failed; /graph falls back to stabilising in the browser"
fi

# --- publish -------------------------------------------------------------
#
# graphify-out is a GENERATED artifact but a TRACKED one in this repo: /graph
# serves it, and a rebuild that only ever lives on the droplet is one disk away
# from being lost. So the nightly commits its own output and pushes it.
#
# Everything here is scoped to graphify-out and nothing else. This working tree
# is production and routinely carries live edits, so the job must be incapable
# of committing someone's half-finished change: it stages only graphify-out, and
# it refuses outright if the index already holds anything else.
#
# cron has no ssh-agent, so the key is named explicitly. BatchMode turns a
# passphrase prompt into an error instead of a job that hangs until the next one
# skips on the lock.
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519 -o BatchMode=yes"

branch=$(git symbolic-ref --short -q HEAD)
if [ "$branch" != master ]; then
    log "on '${branch:-a detached HEAD}', not master; leaving the rebuild uncommitted"
    exit 0
fi

if git diff --cached --name-only | grep -qv '^graphify-out/'; then
    log "the index holds non-graph changes; leaving the rebuild uncommitted"
    exit 0
fi

git add -A graphify-out || { log "git add failed"; exit 1; }
if git diff --cached --quiet; then
    log "graph unchanged; nothing to commit"
    exit 0
fi

files=$(git diff --cached --name-only | wc -l)
if ! git commit -q -m "chore(graph): nightly graphify rebuild $(date +%F)" \
        -m "Generated by scripts/graphify-daily.sh. Regenerate with /graphify." >> "$LOG" 2>&1; then
    log "commit failed (pre-commit hook?); left staged"
    exit 1
fi
log "committed $files file(s)"

if git push -q origin master >> "$LOG" 2>&1; then
    log "pushed"
    exit 0
fi

# Rejected means the remote moved. A rebase needs a clean tree for TRACKED
# files, and this one often has live edits, so that is checked rather than
# assumed -- and a stash is never the answer here (an untracked dir under a bind
# mount has taken the site down twice going that route).
if ! git diff --quiet; then
    log "push rejected and the tree has other local edits; commit left unpushed"
    exit 1
fi
git fetch -q origin master >> "$LOG" 2>&1
if git rebase -q origin/master >> "$LOG" 2>&1; then
    if git push -q origin master >> "$LOG" 2>&1; then
        log "rebased onto origin/master and pushed"
    else
        log "push failed after rebase; commit left unpushed"
    fi
    exit 0
fi

# The only file that can really conflict is the regenerated graph, and the
# fresh build is the one that should survive: --theirs during a rebase is the
# commit being replayed, i.e. tonight's. Anything else conflicting is somebody's
# real work and the job backs out of it entirely.
if git diff --name-only --diff-filter=U | grep -qv '^graphify-out/'; then
    git rebase --abort >> "$LOG" 2>&1
    log "rebase conflicted outside graphify-out; aborted, commit left unpushed"
    exit 1
fi
git checkout --theirs -- graphify-out >> "$LOG" 2>&1
git add -A graphify-out
if GIT_EDITOR=true git rebase --continue >> "$LOG" 2>&1 \
        && git push -q origin master >> "$LOG" 2>&1; then
    log "resolved a graph conflict in favour of tonight's build and pushed"
else
    git rebase --abort >> "$LOG" 2>&1 || true
    log "could not finish the rebase; commit left unpushed"
    exit 1
fi
