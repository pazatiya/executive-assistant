#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  המזכירה — התקנה מלאה על שרת Oracle (חינם, רץ 24/7)
#  מריצים על השרת (אחרי ssh):   bash <(curl -fsSL <url>)   או מדביקים ידנית
#  מריצים שוב בכל עדכון — הסקריפט idempotent.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="https://github.com/pazatiya/executive-assistant.git"
APP_DIR="$HOME/executive-assistant"
APP_PORT=8080
WAHA_PORT=3000
SECRETS="$HOME/.mazkira.secrets"

say() { printf '\n\033[1;33m▶ %s\033[0m\n' "$1"; }

# ── 1. סודות — נוצרים פעם אחת, נשמרים ─────────────────────────────────
if [ -f "$SECRETS" ]; then
  # shellcheck disable=SC1090
  source "$SECRETS"
else
  say "יוצר סודות חדשים"
  APP_PASSWORD=$(openssl rand -hex 5)
  AUTH_SESSION_SECRET=$(openssl rand -hex 24)
  ENCRYPTION_KEY=$(openssl rand -hex 24)
  CRON_SECRET=$(openssl rand -hex 24)
  WAHA_WEBHOOK_SECRET=$(openssl rand -hex 24)
  WAHA_API_KEY=$(openssl rand -hex 24)
  cat > "$SECRETS" <<EOF
APP_PASSWORD=$APP_PASSWORD
AUTH_SESSION_SECRET=$AUTH_SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
CRON_SECRET=$CRON_SECRET
WAHA_WEBHOOK_SECRET=$WAHA_WEBHOOK_SECRET
WAHA_API_KEY=$WAHA_API_KEY
EOF
  chmod 600 "$SECRETS"
fi

# ── 2. מפתח AI ───────────────────────────────────────────────────────
if [ -z "${GOOGLE_API_KEY:-}" ] && [ -f "$HOME/.mazkira.ai" ]; then source "$HOME/.mazkira.ai"; fi
if [ -z "${GOOGLE_API_KEY:-}" ]; then
  read -rp "הדבק מפתח Google Gemini API: " GOOGLE_API_KEY
  read -rp "הדבק מפתח Anthropic (Enter לדלג): " ANTHROPIC_API_KEY
  printf 'GOOGLE_API_KEY=%s\nANTHROPIC_API_KEY=%s\n' "$GOOGLE_API_KEY" "${ANTHROPIC_API_KEY:-}" > "$HOME/.mazkira.ai"
  chmod 600 "$HOME/.mazkira.ai"
fi

PUBIP=$(curl -fsS https://api.ipify.org 2>/dev/null || echo "151.145.91.37")
ARCH=$(uname -m)

# ── 3. swap אם צריך ─────────────────────────────────────────────────
RAM=$(free -m | awk '/^Mem:/{print $2}')
if [ "$RAM" -lt 1900 ] && [ ! -f /swapfile ]; then
  say "מוסיף 2GB swap (זיכרון קטן: ${RAM}MB)"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# ── 4. Node 20 ──────────────────────────────────────────────────────
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 18 ]; then
  say "מתקין Node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# ── 5. pm2 + qrencode ──────────────────────────────────────────────
command -v pm2 >/dev/null || { say "מתקין pm2"; sudo npm install -g pm2; }
command -v qrencode >/dev/null || sudo apt-get install -y qrencode

# ── 6. Docker ──────────────────────────────────────────────────────
if ! command -v docker >/dev/null; then
  say "מתקין Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
D="sudo docker"

# ── 7. הקוד ────────────────────────────────────────────────────────
say "מוריד/מעדכן קוד"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 8. .env ────────────────────────────────────────────────────────
say "כותב הגדרות"
cat > "$APP_DIR/.env" <<EOF
DB_DRIVER=libsql
LIBSQL_URL=file:$APP_DIR/data/app.db
AUTH_DRIVER=dev
AUTH_SESSION_SECRET=$AUTH_SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
APP_PASSWORD=$APP_PASSWORD
APP_URL=http://$PUBIP:$APP_PORT
APP_TIMEZONE=Asia/Jerusalem
AI_DEFAULT_PROVIDER=google
GOOGLE_API_KEY=$GOOGLE_API_KEY
GOOGLE_MODEL=gemini-3.5-flash-lite
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
CRON_SECRET=$CRON_SECRET
WAHA_BASE_URL=http://localhost:$WAHA_PORT
WAHA_API_KEY=$WAHA_API_KEY
WAHA_SESSION=default
WAHA_WEBHOOK_SECRET=$WAHA_WEBHOOK_SECRET
WAHA_WEBHOOK_URL=http://localhost:$APP_PORT/api/webhooks/waha?secret=$WAHA_WEBHOOK_SECRET
WA_COUNTRY_CODE=972
WHATSAPP_OWNER_EMAIL=yair@dalor.co.il
WHATSAPP_WORKSPACE_SLUG=dalor
OWNER_WHATSAPP=yair@dalor.co.il:972507983306,pazyairat@gmail.com:972547734708
DALOR_BARBER_URL=https://dalorbook.duckdns.org
DALOR_BARBER_ADMIN_KEY=2810
EOF

# ── 9. בנייה + DB ─────────────────────────────────────────────────
say "מתקין תלויות (כמה דקות)"
npm ci --no-audit --no-fund
say "בונה (5-15 דקות)"
NODE_OPTIONS=--max-old-space-size=1536 npm run build
say "מכין בסיס נתונים"
mkdir -p data
npm run db:push
SEED_DEMO=0 npm run db:seed

# ── 10. WAHA ─────────────────────────────────────────────────────
say "מפעיל WAHA (וואטסאפ)"
mkdir -p "$HOME/waha-sessions"
$D rm -f waha 2>/dev/null || true
IMG="devlikeapro/waha"; [ "$ARCH" = "aarch64" ] && IMG="devlikeapro/waha:arm"
$D run -d --name waha --restart unless-stopped \
  -p 127.0.0.1:$WAHA_PORT:3000 \
  -v "$HOME/waha-sessions:/app/.sessions" \
  -e WAHA_API_KEY="$WAHA_API_KEY" -e WHATSAPP_API_KEY="$WAHA_API_KEY" \
  -e WAHA_DASHBOARD_ENABLED=false -e WHATSAPP_DEFAULT_ENGINE=WEBJS \
  "$IMG"

# ── 11. שירות האפליקציה ──────────────────────────────────────────
say "מפעיל את המזכירה"
pm2 delete mazkira 2>/dev/null || true
PORT=$APP_PORT pm2 start npm --name mazkira -- start
pm2 save
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" 2>/dev/null | grep -E '^sudo' | bash || true

# ── 12. תזמון (סיכומים + תזכורות כל 5 דק') ───────────────────────
say "מגדיר תזמון"
( crontab -l 2>/dev/null | grep -v 'scheduler/tick' ; \
  echo "*/5 * * * * curl -s -X POST 'http://localhost:$APP_PORT/api/scheduler/tick?secret=$CRON_SECRET' >/dev/null 2>&1" ) | crontab -

# ── 13. firewall (מקומי) ─────────────────────────────────────────
sudo iptables -C INPUT -p tcp --dport $APP_PORT -j ACCEPT 2>/dev/null || \
  sudo iptables -I INPUT 6 -p tcp --dport $APP_PORT -j ACCEPT || true
sudo bash -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || \
  sudo netfilter-persistent save 2>/dev/null || true

# ── 14. חיבור וואטסאפ + QR ──────────────────────────────────────
say "מכין קישור וואטסאפ"
sleep 6
curl -s -X POST "http://localhost:$WAHA_PORT/api/sessions" \
  -H "X-Api-Key: $WAHA_API_KEY" -H 'content-type: application/json' \
  -d '{"name":"default","start":true}' >/dev/null 2>&1 || true
sleep 4
QR=$(curl -s "http://localhost:$WAHA_PORT/api/default/auth/qr?format=raw" -H "X-Api-Key: $WAHA_API_KEY" | sed -n 's/.*"value":"\([^"]*\)".*/\1/p')

cat <<BANNER

═══════════════════════════════════════════════════════════════
  ✅ המזכירה רצה!

  כתובת:   http://$PUBIP:$APP_PORT
  סיסמה:   $APP_PASSWORD   (שמור אותה!)

  נשאר 2 דברים:
  1) בקונסולת Oracle: Networking → VCN → Security List →
     Add Ingress Rule:  Source 0.0.0.0/0 , TCP , port $APP_PORT
  2) לקשר את הוואטסאפ של יאיר — סרוק את ה-QR למטה מהטלפון:
     WhatsApp → הגדרות → מכשירים מקושרים → קשר מכשיר
═══════════════════════════════════════════════════════════════
BANNER

if [ -n "$QR" ]; then
  qrencode -t ANSIUTF8 "$QR"
  echo "  (אם ה-QR פג תוקף — הרץ:  bash $APP_DIR/deploy/wa-qr.sh )"
else
  echo "  ה-QR עוד לא מוכן. הרץ בעוד דקה:  bash $APP_DIR/deploy/wa-qr.sh"
fi
