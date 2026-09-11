#!/usr/bin/env bash
# Provision the sandboxed Claude Code sidecar host-side. Idempotent.
#
# The sidecar runs as its OWN unprivileged user (cc-agent): no sudo, no docker
# group, no read access to /exec-fn. Its cwd is /srv/cc-sandbox and that is the
# whole blast radius -- Claude Code gets Bash/Write/Edit *inside* it and nothing
# else. Auth is cc-agent's own subscription login (see README): sharing
# wai-root's ~/.claude/.credentials.json would race the OAuth refresh between
# two processes and knock the interactive session offline.
set -euo pipefail

SANDBOX=/srv/cc-sandbox
APPDIR=/srv/cc-agent

id cc-agent >/dev/null 2>&1 || sudo useradd --system --create-home \
  --home-dir /home/cc-agent --shell /usr/sbin/nologin cc-agent

# Sandbox: the agent's working directory, and the only place it can write.
sudo install -d -o cc-agent -g cc-agent -m 0750 "$SANDBOX"
# Sidecar code + node_modules. Owned by root, readable by cc-agent -- the agent
# must not be able to rewrite the server that constrains it.
sudo install -d -o root -g cc-agent -m 0750 "$APPDIR"

sudo install -o root -g cc-agent -m 0640 \
  /exec-fn/claude-box/package.json /exec-fn/claude-box/server.mjs \
  /exec-fn/claude-box/cc-context.md "$APPDIR/"
sudo npm --prefix "$APPDIR" install --omit=dev --no-audit --no-fund
sudo chgrp -R cc-agent "$APPDIR" && sudo chmod -R g+rX "$APPDIR"

# Shared secret: the bridge port is host-only, but an unauthenticated listener
# on it would be reachable by ANY container on the box, not just ours.
if [ ! -f /etc/cc-sidecar.env ]; then
  sudo sh -c 'umask 077; printf "CC_SIDECAR_TOKEN=%s\n" "$(openssl rand -hex 32)" > /etc/cc-sidecar.env'
  sudo chown root:root /etc/cc-sidecar.env && sudo chmod 0640 /etc/cc-sidecar.env
fi

sudo install -m 0644 /exec-fn/claude-box/cc-sidecar.service \
  /etc/systemd/system/cc-sidecar.service
sudo systemctl daemon-reload
echo "provisioned. next: one-time login (see claude-box/README.md), then:"
echo "  sudo systemctl enable --now cc-sidecar"
