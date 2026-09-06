# פריסה — המזכירה של פז ויאיר

שלושה חלקים: **(1) WAHA** (וואטסאפ) על שרת ה-Oracle · **(2) האפליקציה** על Render · **(3) חיווט ביניהם**.

הכול רץ 24/7. עלות: Render starter (~$7/חודש לשירות web + ~$1 לדיסק) + Oracle (חינם, always-free). ה-cron של Render חינם.

---

## 0. מה צריך ביד לפני שמתחילים

- גישה ל-**Oracle Cloud Shell** (הדפדפן — כמו שפורסים את אפליקציית התורים)
- ה-IP של שרת ה-Oracle: `151.145.91.37`
- חשבון **Render** (render.com)
- **המספר וואטסאפ של יאיר** + הטלפון שלו ליד לסריקת QR
- מפתח **GOOGLE_API_KEY** (Gemini) או **ANTHROPIC_API_KEY** — כבר קיים ב-`.env.local` המקומי
- לבחור **סיסמת גישה** לאפליקציה (משהו שקל לזכור — שניכם תשתמשו בה כדי להיכנס)

---

## 1. WAHA על שרת ה-Oracle

ב-**Oracle Cloud Shell**, התחבר לשרת:

```bash
ssh -i ~/.ssh/dalor_key ubuntu@151.145.91.37
```

### 1a. Docker (אם עוד אין)

```bash
docker --version || (curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && newgrp docker)
```

### 1b. הרצת WAHA

```bash
# מפתח API חזק — שמור אותו, צריך אותו גם ב-Render
WAHA_KEY=$(openssl rand -hex 24); echo "WAHA_API_KEY=$WAHA_KEY"

mkdir -p ~/waha-sessions
docker run -d --name waha --restart unless-stopped \
  -p 3000:3000 \
  -v ~/waha-sessions:/app/.sessions \
  -e WAHA_API_KEY="$WAHA_KEY" -e WHATSAPP_API_KEY="$WAHA_KEY" \
  -e WAHA_DASHBOARD_ENABLED=false \
  -e WHATSAPP_DEFAULT_ENGINE=WEBJS \
  devlikeapro/waha
```

> **ARM?** אם `uname -m` מחזיר `aarch64`, החלף את התמונה ל-`devlikeapro/waha:arm`.

### 1c. פתיחת פורט 3000

בקונסולת Oracle → Networking → ה-VCN → Security List → **Add Ingress Rule**: Source `0.0.0.0/0`, TCP, port `3000`.
וגם על השרת עצמו:

```bash
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true
```

### 1d. קישור המספר של יאיר

```bash
curl -s -X POST http://localhost:3000/api/sessions \
  -H "X-Api-Key: $WAHA_KEY" -H "content-type: application/json" \
  -d '{"name":"default","start":true}'

# הבא את ה-QR כתמונה, פתח אותו, וסרוק מהטלפון של יאיר → WhatsApp → מכשירים מקושרים
curl -s "http://localhost:3000/api/default/auth/qr?format=image" \
  -H "X-Api-Key: $WAHA_KEY" -o ~/wa-qr.png
# הורד את wa-qr.png דרך תפריט ה-Cloud Shell (Download) וסרוק
```

בדיקה שהסתדר:

```bash
curl -s http://localhost:3000/api/sessions/default -H "X-Api-Key: $WAHA_KEY"
# צריך "status":"WORKING"
```

---

## 2. האפליקציה על Render

### 2a. דחיפה ל-GitHub

הריפו כבר נדחף (פרטי): `github.com/pazatiya/executive-assistant`. עדכונים עתידיים: `git push`.

### 2b. Blueprint

1. render.com → **New → Blueprint** → בחר את הריפו `executive-assistant`.
2. Render קורא את `render.yaml` ומקים 2 שירותים: `executive-assistant` (web) + `executive-assistant-tick` (cron).
3. אשר. הבנייה הראשונה תיכשל בחלקה — זה בסדר, חסרים משתני סביבה. נמלא ונריץ שוב.

### 2c. משתני סביבה (Render → executive-assistant → Environment)

| מפתח | ערך |
|---|---|
| `APP_URL` | ה-URL של Render, למשל `https://executive-assistant.onrender.com` |
| `APP_PASSWORD` | סיסמת הגישה שבחרת |
| `GOOGLE_API_KEY` | מפתח Gemini (מ-`.env.local`) |
| `ANTHROPIC_API_KEY` | מפתח Claude (מ-`.env.local`) — לגיבוי |
| `DALOR_BARBER_ADMIN_KEY` | `2810` |
| `WAHA_BASE_URL` | `http://151.145.91.37:3000` |
| `WAHA_API_KEY` | ה-`WAHA_API_KEY` משלב 1b |
| `WAHA_WEBHOOK_URL` | `https://<APP_URL>/api/webhooks/waha?secret=<ערך WAHA_WEBHOOK_SECRET>` |
| `OWNER_WHATSAPP` | `yair@dalor.co.il:<מספר יאיר>,pazyairat@gmail.com:<מספר פז>` |

`WAHA_WEBHOOK_SECRET`, `CRON_SECRET`, `AUTH_SESSION_SECRET`, `ENCRYPTION_KEY` — Render מייצר לבד. אחרי שהם קיימים, העתק את הערך של `WAHA_WEBHOOK_SECRET` לתוך `WAHA_WEBHOOK_URL` למעלה.

### 2d. משתני ה-cron (Render → executive-assistant-tick → Environment)

| `TICK_URL` | אותו ערך כמו `APP_URL` |
| `CRON_SECRET` | אותו ערך כמו ב-web service |

### 2e. Manual Deploy

Render → executive-assistant → **Manual Deploy → Deploy latest commit**. אמור לעלות ירוק (`/api/ai/status`).

---

## 3. חיווט WAHA → האפליקציה

על שרת ה-Oracle, הפנה את ה-webhook של WAHA לאפליקציה:

```bash
curl -s -X PUT http://localhost:3000/api/sessions/default \
  -H "X-Api-Key: $WAHA_KEY" -H "content-type: application/json" \
  -d '{"config":{"webhooks":[{"url":"https://<APP_URL>/api/webhooks/waha?secret=<WAHA_WEBHOOK_SECRET>","events":["message"]}]}}'
```

(או פשוט להיכנס לאפליקציה → אינטגרציות → WhatsApp → "חיבור" — זה עושה את זה אוטומטית.)

---

## 4. בדיקת עשן

1. פתח `https://<APP_URL>` → מסך התחברות → סיסמה + בחר משתמש.
2. אינטגרציות: WhatsApp ו-"DALOR — תורים" מסומנים "מחובר".
3. שלח הודעת בדיקה **ממספר אחר** למספר של יאיר: "מה שעות הפתיחה?" → אמורה להגיע תשובה אוטומטית, ולהופיע במסך "הודעות".
4. שלח "יש חולצה במידה L?" → **לא** אמורה לענות; אמורה לקפוץ בקשת אישור בוואטסאפ של יאיר ופז עם קוד.
5. ענה "אשר <קוד>" → התשובה נשלחת ללקוח.
6. יאיר כותב לעצמו "תזכיר לי מחר ב-9 להתקשר לספק" → אמור לקבל אישור "✅ תזכורת ל-...".

---

## תחזוקה

- **עדכון קוד:** `git push` → Render בונה אוטומטית.
- **WAHA התנתק:** `docker restart waha` על שרת Oracle; אם צריך QR מחדש — שלב 1d.
- **לוגים:** Render → Logs. WAHA: `docker logs waha` על השרת.
- **גיבוי ה-DB:** קובץ `/var/data/app.db` על הדיסק של Render (נשמר בין פריסות).

## אבטחה — פתוח

- `WAHA_BASE_URL` על `:3000` חשוף לאינטרנט עם מפתח API בלבד. אפשר להצר ל-IP של Render (Security List) אם רוצים.
- `APP_PASSWORD` הוא שער יחיד משותף — לא סיסמה אישית. מספיק לזוג משתמשים על רשת מהימנה.
- קבצי `.env` של אפליקציית התורים (`~/DALOR/yair_barber_booking`) עדיין מכילים מפתח Firebase + סיסמת Gmail בטקסט גלוי — להחליף בהזדמנות.
