#!/usr/bin/env bash
# הצגת QR מחדש לקישור הוואטסאפ (אם הקודם פג תוקף)
set -euo pipefail
source "$HOME/.mazkira.secrets"
command -v qrencode >/dev/null || sudo apt-get install -y qrencode
curl -s -X POST "http://localhost:3000/api/sessions/default/start" -H "X-Api-Key: $WAHA_API_KEY" >/dev/null 2>&1 || true
sleep 3
ST=$(curl -s "http://localhost:3000/api/sessions/default" -H "X-Api-Key: $WAHA_API_KEY" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
if [ "$ST" = "WORKING" ]; then echo "✅ הוואטסאפ כבר מקושר (status: WORKING)"; exit 0; fi
QR=$(curl -s "http://localhost:3000/api/default/auth/qr?format=raw" -H "X-Api-Key: $WAHA_API_KEY" | sed -n 's/.*"value":"\([^"]*\)".*/\1/p')
[ -z "$QR" ] && { echo "אין QR עדיין (status: ${ST:-?}). נסה שוב בעוד דקה."; exit 1; }
qrencode -t ANSIUTF8 "$QR"
echo "סרוק מהטלפון של יאיר: WhatsApp → מכשירים מקושרים → קשר מכשיר"
