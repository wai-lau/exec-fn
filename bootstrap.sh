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
server {
    listen 80;
    server_name wai-lau.net;
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
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

# ── enable services on boot ───────────────────────────────────────────────────
systemctl enable docker nginx fail2ban
systemctl start docker nginx fail2ban

# ── repo ──────────────────────────────────────────────────────────────────────
if [ ! -d ${REPO_DIR} ]; then
    git clone https://github.com/wai-lau/exec-fn ${REPO_DIR}
else
    git -C ${REPO_DIR} pull
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
