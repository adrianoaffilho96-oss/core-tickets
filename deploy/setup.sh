#!/usr/bin/env bash
# Instala o Core Tickets num servidor Ubuntu (Oracle Cloud Always Free).
# Uso: sudo bash setup.sh <dominio>      ex.: sudo bash setup.sh 129-146-10-20.sslip.io
# Pode ser executado de novo com seguranca (nao apaga banco nem .env).
set -euo pipefail

DOMAIN="${1:?Informe o dominio. Ex.: sudo bash setup.sh 1-2-3-4.sslip.io}"
REPO="https://github.com/adrianoaffilho96-oss/core-tickets.git"
APP_DIR=/opt/core-tickets
DATA_DIR=/var/lib/core-tickets
BACKUP_DIR=/var/backups/core-tickets
APP_USER=corex

echo "==> Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

echo "==> Memoria swap (ajuda na maquina de 1 GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Node.js 20"
if ! node -v 2>/dev/null | grep -q '^v2[0-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -q nodejs
fi

echo "==> Caddy (HTTPS automatico)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

echo "==> Firewall do Ubuntu: liberar portas 80 e 443"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport "$port" -j ACCEPT
done
netfilter-persistent save

echo "==> Usuario e pastas"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR" "$BACKUP_DIR"

echo "==> Codigo"
git config --global --add safe.directory "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)

echo "==> Configuracao (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
  cat > "$APP_DIR/.env" <<ENV
ADMIN_PASSWORD=$ADMIN_PASSWORD
PUBLIC_URL=https://$DOMAIN
DATABASE_PATH=$DATA_DIR/festa.db
SESSION_SECRET=$(openssl rand -hex 32)
PAYMENT_EXPIRATION_MINUTES=30
MP_ACCESS_TOKEN=
MP_WEBHOOK_SECRET=
ENV
  echo ">>> Senha da equipe: $ADMIN_PASSWORD  (guardada em $APP_DIR/.env)"
else
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$DOMAIN|" "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

echo "==> Servico (liga sozinho e reinicia se cair)"
cat > /etc/systemd/system/core-tickets.service <<UNIT
[Unit]
Description=Core Tickets
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=8000
ExecStart=/usr/bin/node backend/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR $BACKUP_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8000
}
CADDY

echo "==> Backup diario do banco (03:30, guarda 30 dias)"
cat > /etc/cron.d/core-tickets-backup <<CRON
30 3 * * * $APP_USER cd $APP_DIR && /usr/bin/node deploy/backup.js $DATA_DIR/festa.db $BACKUP_DIR 30 >> $BACKUP_DIR/backup.log 2>&1
CRON

systemctl daemon-reload
systemctl enable --now core-tickets
systemctl restart core-tickets
systemctl reload caddy || systemctl restart caddy

sleep 3
curl -fsS http://127.0.0.1:8000/api/health && echo
echo "==> Pronto: https://$DOMAIN"
