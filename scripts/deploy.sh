#!/usr/bin/env bash
# Deploy origin/master into the live tree (/exec-fn on the droplet) with the
# least downtime. Local claude runs it over ssh after a push:
#
#   ssh wai-root@wai-lau.net 'bash /exec-fn/scripts/deploy.sh'
#
# Why a script and not the old one-liner: that ended in
# `docker compose up -d --force-recreate api` EVERY time, i.e. a container
# restart (the nginx loading page) on every deploy, though api/ hot-reloads
# (uvicorn --reload) and web/ + templates are read per request. A restart is
# only needed when what the container is BUILT or CONFIGURED from changes:
#
#   Dockerfile / requirements.txt / entrypoint.sh / exec-fn.cron -> rebuild
#   docker-compose.yml                                           -> recreate
#   anything else                                                -> nothing
#
# The old --force-recreate also re-made the mount namespace, which mattered
# while nightfall-incident was an UNTRACKED dir a pull could replace (a stale
# bind 502s). It is a submodule now (updated in place, never replaced), but
# the script still checks the binds after the update and recreates if one went
# stale — the safety, without paying for it every time.
#
# Refuses to run over uncommitted TRACKED changes (another session's live
# work, or a submodule whose commit the parent has not recorded yet): a reset
# would discard the first and the submodule update would rewind the second.
# `--discard` overrides, for when that work is known to be expendable.
#
# The whole body is one function called on ONE line: the reset below rewrites
# this very file, and bash reads a script as it runs, so nothing may be left
# to read after the reset.
set -euo pipefail

main() {
  local discard=0 root old new dirty
  [ "${1:-}" = "--discard" ] && discard=1
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$root"

  dirty="$(git status --porcelain --untracked-files=no --ignore-submodules=dirty)"
  if [ -n "$dirty" ] && [ "$discard" -eq 0 ]; then
    echo "deploy: REFUSED — uncommitted tracked changes in $root:"
    echo "$dirty" | sed 's/^/  /'
    echo "Commit them (droplet session), or re-run with --discard to throw them away."
    return 1
  fi

  old="$(git rev-parse HEAD)"
  git fetch -q origin
  git reset -q --hard origin/master
  git submodule update -q --init
  new="$(git rev-parse HEAD)"
  echo "deploy: ${old:0:8} -> ${new:0:8}"

  local build="api/Dockerfile api/requirements.txt api/entrypoint.sh api/exec-fn.cron"
  # shellcheck disable=SC2086
  if ! git diff --quiet "$old" "$new" -- $build; then
    echo "deploy: image inputs changed -> rebuild + recreate api"
    sudo docker compose up -d --build api
  elif ! git diff --quiet "$old" "$new" -- docker-compose.yml; then
    echo "deploy: compose changed -> recreate api"
    sudo docker compose up -d api
  elif [ -z "$(sudo docker compose ps -q --status running api)" ]; then
    echo "deploy: api not running -> start it"
    sudo docker compose up -d api
  elif ! sudo docker compose exec -T api test -e /app/nightfall/index.html -a -e /app/apps/README.md; then
    echo "deploy: a bind mount is stale -> recreate api"
    sudo docker compose up -d --force-recreate api
  else
    echo "deploy: no restart (api/ hot-reloads; web/ + templates are read per request)"
  fi
}

{ main "$@"; exit $?; }
