# claude-box — sandboxed Claude Code sidecar

Serves `/cc` on the site. The api container is `python:3.12-slim` with no node,
no `claude` binary and no credentials, so Claude Code runs **host-side** as its
own unprivileged user and the container talks to it over the docker bridge —
the same shape as the hosaka / emet / printer upstreams, minus the SSH tunnel
(this one is already on the same box).

```
browser ──HTTPS──▶ nginx ──▶ api container ──172.17.0.1:8129──▶ cc-sidecar
                             (routes_cc.py)                     (cc-agent)
                                                                    │
                                                                cwd=/srv/cc-sandbox
```

## Blast radius

`cc-agent` has no sudo, no docker group, and no read access to `/exec-fn`. Its
cwd — `/srv/cc-sandbox` — is the entire writable world. Three independent layers
enforce that, because the in-process one is the weakest:

1. **`canUseTool`** in `server.mjs` — a deterministic allowlist
   (`Read/Write/Edit/Glob/Grep/Bash`). It answers every request, including
   denials: with no `canUseTool`, a non-allowlisted tool falls through to an
   interactive prompt that nobody is there to answer, and the run stalls until
   the idle timeout instead of failing cleanly. `WebFetch`/`WebSearch` are
   omitted on purpose — they are the one exfiltration path a mount namespace
   cannot close.
2. **`settingSources: []`** — no settings file is read at all. The agent has
   Bash and a writable `$HOME`, so a `settings.json` it wrote itself would
   otherwise come back as policy on the next run.
3. **systemd** (`ProtectSystem=strict` + `BindPaths`) — `/exec-fn`, `.env` and
   `docker.sock` are not merely unreadable by uid, they are absent from the
   mount namespace. This is the layer that still holds if the other two fail.

`/srv/cc-agent` (the sidecar code) is root-owned and group-readable, so the
agent cannot rewrite the server that constrains it.

## Install

```bash
sudo bash /exec-fn/claude-box/setup.sh
```

Idempotent. Creates `cc-agent`, `/srv/cc-sandbox`, installs the SDK into
`/srv/cc-agent`, generates `/etc/cc-sidecar.env` (shared secret — the bridge
port is host-only, but *any* container on the box can reach it), and installs
the unit.

## One-time login

The sidecar authenticates as **cc-agent's own** subscription login. Do not copy
`~wai-root/.claude/.credentials.json` into it: two processes on one OAuth
refresh token race, and the loser — usually the interactive session — is logged
out mid-refresh.

```bash
sudo -u cc-agent -H /usr/bin/claude     # then: /login, then /exit
```

`cc-agent`'s shell is `nologin`; `sudo -u` execs the binary directly, so this
works anyway. Verify:

```bash
sudo systemctl restart cc-sidecar
TOK=$(sudo grep -oP '(?<=^CC_SIDECAR_TOKEN=).*' /etc/cc-sidecar.env)
curl -sN -H "x-cc-token: $TOK" -H 'content-type: application/json' \
  -d '{"prompt":"reply with exactly: PONG"}' http://172.17.0.1:8129/query
```

A logged-out sidecar answers `{"type":"text","text":"Not logged in · Please run
/login"}` and then a `done` — it is a clean per-request failure, not a crash, so
the page degrades rather than 500s.

## Endpoints (bridge-only, `x-cc-token` required)

| Method | Path     | What |
|--------|----------|------|
| GET    | `/health`| `{ok, busy, active}` |
| POST   | `/query` | `{prompt, sessionId?}` → SSE of `session`/`text`/`thinking`/`tool`/`tool_result`/`done`/`error` |

Pass a previous run's `sessionId` to continue that conversation (`resume`).

## Limits

`MAX_CONCURRENT` is 1. That is a memory ceiling expressed as a queue depth: the
droplet has ~930MB free and each run spawns a CLI subprocess, so the unit also
carries `MemoryMax=700M`. A second concurrent request gets a 429, which
`routes_cc.py` surfaces as "busy" rather than an error.

Subscription rate limits are **per account** — wrapper traffic shares the same
budget as interactive `claude` sessions on this box.

## Ops

```bash
sudo systemctl status cc-sidecar
sudo journalctl -u cc-sidecar -f
sudo systemctl restart cc-sidecar        # after editing server.mjs, then re-run setup.sh
```

`setup.sh` copies `server.mjs` into `/srv/cc-agent`; editing the repo copy alone
changes nothing until you re-run it.
