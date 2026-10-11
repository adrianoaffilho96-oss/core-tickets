#!/usr/bin/env bash
# Atualiza o site com a ultima versao do GitHub. Uso: sudo bash /opt/core-tickets/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/core-tickets
sudo -u corex /usr/bin/node "$APP_DIR/deploy/backup.js" /var/lib/core-tickets/festa.db /var/backups/core-tickets 30
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git -C "$APP_DIR" pull --ff-only
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
chown -R corex:corex "$APP_DIR"
systemctl restart core-tickets
sleep 2
curl -fsS http://127.0.0.1:8000/api/health && echo && echo "Atualizado."
