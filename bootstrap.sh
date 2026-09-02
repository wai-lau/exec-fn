#!/bin/bash
# Droplet bootstrap — run once on a fresh Ubuntu 24.04 DigitalOcean droplet.
# Idempotent: safe to re-run after partial failures or to update the install.
set -euo pipefail

REPO_DIR=/exec-fn
DOMAIN=wai-lau.net
EMAIL=wl.wailau@gmail.com

echo "=== exec-fn bootstrap ==="

# ── system ────────────────────────────────────────────────────────────────────
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ca-certificates gnupg

# ── docker ────────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# ── nginx + certbot + fail2ban ────────────────────────────────────────────────
apt-get install -y nginx certbot python3-certbot-nginx fail2ban

# Basic HTTP config (certbot will upgrade to HTTPS)
cat > /etc/nginx/sites-available/exec-fn << 'NGINXEOF'
# The app runs under `uvicorn --reload` on purpose: editing api/*.py on the
# droplet IS the deploy. The reloader holds the listen socket in the parent and
# swaps the worker underneath, so a new connection is never refused -- but a
# request that lands on the OLD worker while it drains gets its connection
# closed with no response, and nginx turns that into a 502. Measured on the live
# box: 20 of 220 requests to / across two reloads came back 502, while the same
# probe straight at 127.0.0.1:8080 saw none.
#
# Hence an explicit upstream listed TWICE -- nginx allows one try per peer, so a
# single-server upstream can never retry -- never marked down, with a retry on a
# dropped or timed-out connection. Same probe after the change: 220/220 200s.
upstream execfn_app {
    server 127.0.0.1:8080 max_fails=0;
    server 127.0.0.1:8080 max_fails=0;
}

server {
    listen 80;
    server_name wai-lau.net;
    location / {
        proxy_pass http://execfn_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;

        # Ride out a worker swap instead of surfacing it as a 502.
        # `non_idempotent` is deliberately NOT set: a retried POST/PATCH would
        # apply a mutation twice, so this covers the GETs that serve pages and
        # assets, which is where the 502 was visible. NOT http_503 either --
        # this app returns a real 503 when the home box or the printer is
        # unreachable, and retrying that would only delay an honest answer.
        proxy_connect_timeout 3s;
        proxy_next_upstream error timeout http_502;
        proxy_next_upstream_tries 3;
        proxy_next_upstream_timeout 20s;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/exec-fn /etc/nginx/sites-enabled/exec-fn
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# SSL (skip if cert already exists)
if [ ! -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ]; then
    certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email ${EMAIL}
fi

# ── ssh hardening ─────────────────────────────────────────────────────────────
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# ── hosaka reverse-tunnel sshd config ─────────────────────────────────────────
# The home GPU box reverse-tunnels its TTS server to 172.17.0.1:8123 here.
# GatewayPorts: let the -R forward bind the docker-bridge IP (not just loopback).
# ClientAlive*: probe idle tunnel clients so a dead home box's session is reaped
#   (~90s) and its port frees — without this a home-box reboot leaves an orphaned
#   sshd squatting :8123 and the respawning tunnel flaps forever, unable to rebind.
cat > /etc/ssh/sshd_config.d/10-gatewayports.conf <<'EOF'
GatewayPorts clientspecified
EOF
cat > /etc/ssh/sshd_config.d/20-hosaka-keepalive.conf <<'EOF'
# Reap dead reverse-tunnel sessions so a stale -R bind frees its port.
ClientAliveInterval 30
ClientAliveCountMax 3
EOF
sshd -t && systemctl reload ssh

# ── enable services on boot ───────────────────────────────────────────────────
systemctl enable docker nginx fail2ban
systemctl start docker nginx fail2ban

# ── repo ──────────────────────────────────────────────────────────────────────
if [ ! -d ${REPO_DIR} ]; then
    git clone https://github.com/wai-lau/exec-fn ${REPO_DIR}
else
    # Deterministic update (matches the deploy pattern in CLAUDE.md): a plain
    # `git pull` can hit a merge conflict on a droplet with local drift and
    # abort the whole script under set -e. fetch + reset --hard never
    # conflicts, keeping a partial-failure re-run idempotent.
    git -C ${REPO_DIR} fetch origin
    git -C ${REPO_DIR} reset --hard origin/master
fi

# ── .env check ────────────────────────────────────────────────────────────────
if [ ! -f ${REPO_DIR}/.env ]; then
    echo ""
    echo "  .env not found. Create ${REPO_DIR}/.env with:"
    echo ""
    echo "    API_KEY=<your-web-auth-key>"
    echo "    ANTHROPIC_API_KEY=sk-ant-..."
    echo ""
    echo "  Then run: cd ${REPO_DIR} && docker compose up --build -d"
    echo ""
    exit 0
fi

# ── launch ────────────────────────────────────────────────────────────────────
cd ${REPO_DIR}
docker compose up --build -d

echo ""
echo "=== bootstrap complete ==="
echo "    site:  https://${DOMAIN}"
echo "    logs:  docker compose logs -f"
echo "    cron:  docker compose exec api tail -f /var/log/exec-fn.log"
