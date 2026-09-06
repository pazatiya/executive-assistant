# פריסה — המזכירה של פז ויאיר

**הארכיטקטורה הסופית (עלות: $7/חודש בלבד):**

| שירות | איפה | תוכנית |
|---|---|---|
| האפליקציה (`executive-assistant`) | Render web | **Free** (נשמרת ערה ע"י cron-job.org) |
| בסיס נתונים | **Turso** (`dalor-mazkira`) | Free |
| וואטסאפ (`dalor-waha`) | Render, Docker `devlikeapro/waha` | **Starter $7** + דיסק 1GB |
| תזמון (tick כל 5 דק') | **cron-job.org** | Free |

Oracle — נזנח (חסימת הרשמה חוזרת).

---

## 0. מה צריך ביד

- חשבון **Render** (render.com) — של פז, workspace קיים
- חשבון **Turso** — קיים, org `pazatiya`, DB `dalor-mazkira` כבר נוצר
- **הטלפון של יאיר** (972507983306) לסריקת QR — רק בשלב האחרון
- כל המפתחות — בקובץ הזמני של הסשן (`scratchpad/render-env.md`)

---

## 1. Blueprint

1. render.com → **New → Blueprint** → בחר את הריפו `executive-assistant`.
2. Render קורא את `render.yaml` ומקים 2 שירותים: `executive-assistant` (web, free) + `dalor-waha` (Docker, starter).
3. אשר. הבנייה הראשונה תיכשל — חסרים משתני סביבה עם `sync: false`. נמלא ונריץ שוב.

## 2. משתני סביבה

**`executive-assistant` → Environment:**

| מפתח | ערך |
|---|---|
| `LIBSQL_URL` | `libsql://dalor-mazkira-pazatiya.aws-eu-west-1.turso.io` |
| `LIBSQL_AUTH_TOKEN` | הטוקן מ-Turso (Create Token) |
| `APP_URL` | כתובת ה-web service אחרי שנוצר (`https://executive-assistant-XXXX.onrender.com`) |
| `APP_PASSWORD` | סיסמת כניסה משותפת |
| `GOOGLE_API_KEY` | מפתח Gemini |
| `ANTHROPIC_API_KEY` | מפתח Claude (אופציונלי, לאיכות טובה יותר) |
| `DALOR_BARBER_ADMIN_KEY` | `2810` |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` | מפתחות Web Push (`npx web-push generate-vapid-keys`) |
| `WAHA_API_KEY` | אותו ערך כמו ב-`dalor-waha` |
| `WAHA_WEBHOOK_SECRET` | מחרוזת אקראית חזקה |

`AUTH_SESSION_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` — Render מייצר לבד (`generateValue`).
`WAHA_BASE_URL` — מתמלא אוטומטית מ-`dalor-waha` (רשת פרטית).

**`dalor-waha` → Environment:**

| מפתח | ערך |
|---|---|
| `WAHA_API_KEY` | מחרוזת חזקה — **אותו ערך** ב-`executive-assistant` |
| `WHATSAPP_API_KEY` | = `WAHA_API_KEY` |

אחרי מילוי → **Manual Deploy** לשני השירותים. ה-`preDeployCommand` דוחף את הסכימה ל-Turso ומזריע.

## 3. תזמון — cron-job.org

1. cron-job.org → הרשמה חינם → **Create cronjob**.
2. URL: `https://<app>.onrender.com/api/scheduler/tick?secret=<CRON_SECRET>`
   (`CRON_SECRET` — מ-Render → executive-assistant → Environment, אחרי הדפלוי הראשון)
3. Method: **POST**. Schedule: **every 5 minutes**.
4. זה גם שומר את ה-instance החינמי ער — אין צורך ב-UptimeRobot נפרד.

## 4. קישור וואטסאפ (יאיר)

ב-Render → `dalor-waha` → **Shell** (או דרך ה-API עם `WAHA_API_KEY`):

```bash
curl -s -X POST http://localhost:3000/api/sessions \
  -H "X-Api-Key: $WAHA_API_KEY" -H "content-type: application/json" \
  -d '{"name":"default","start":true}'

curl -s "http://localhost:3000/api/default/auth/qr?format=image" \
  -H "X-Api-Key: $WAHA_API_KEY" -o /tmp/wa-qr.png
```

סורקים את ה-QR מהטלפון של **יאיר** → WhatsApp → מכשירים מקושרים → קשר מכשיר.

בדיקה: `curl -s http://localhost:3000/api/sessions/default -H "X-Api-Key: $WAHA_API_KEY"` → `"status":"WORKING"`.

אז באפליקציה → **Integrations → WhatsApp → Connect** — זה רושם את ה-webhook.

## 5. הרצה ראשונה — `draft_only`

המערכת עולה במצב `ASSISTANT_MODE=draft_only`: המזכירה **לא שולחת כלום** אוטומטית, רק מכינה טיוטות ב-`/messages`. אחרי שבוע של מעקב → `/settings` → החלפה ל-`active` (whitelist בלבד: שעות/כתובת/מחירון/זמינות תור).
