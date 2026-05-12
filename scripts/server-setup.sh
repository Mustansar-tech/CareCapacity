#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-time server setup script for Hetzner / DigitalOcean
# Run as root on a fresh Ubuntu 22.04 server:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/YOUR_REPO/main/scripts/server-setup.sh | bash
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

echo "==> Installing nginx + certbot..."
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Cloning repository..."
DEPLOY_PATH="/opt/care-capacity-dashboard"
git clone https://github.com/YOUR_ORG/YOUR_REPO.git "$DEPLOY_PATH"
cd "$DEPLOY_PATH"

echo "==> Creating .env file (edit this before starting the service)..."
cp .env.example .env
echo ""
echo "  *** ACTION REQUIRED ***"
echo "  Edit $DEPLOY_PATH/.env and fill in all secrets, then run:"
echo "    docker compose up -d"
echo ""

echo "==> Writing nginx config..."
DOMAIN="api.yourdomain.com"   # <-- change this
cat > /etc/nginx/sites-available/care-api <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/care-api /etc/nginx/sites-enabled/care-api
nginx -t && systemctl reload nginx

echo ""
echo "==> Next: point your DNS A record for ${DOMAIN} to this server's IP,"
echo "    then run:  certbot --nginx -d ${DOMAIN}"
echo ""
echo "Setup complete."
