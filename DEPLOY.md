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

אחרי מילוי → **Manual Deploy** לשני השירותים.

> הסכימה כבר נדחפה ל-Turso והבסיס הוזרע מהמחשב המקומי. שינויי סכימה עתידיים:
> `LIBSQL_URL=… LIBSQL_AUTH_TOKEN=… npm run db:push` מקומית.

## 3. תזמון + שמירה על ער — UptimeRobot

מוניטור HTTP(s) יחיד עושה את שתי העבודות (מפעיל את ה-tick כל 5 דק' וגם שומר את
ה-instance החינמי ער):

1. UptimeRobot → **Add New Monitor** → סוג **HTTP(s)**.
2. URL: `https://executive-assistant-nihe.onrender.com/api/scheduler/tick?secret=<CRON_SECRET>`
   (`CRON_SECRET` — Render → executive-assistant → Environment → "Show secret". ה-`=` בסוף חייב `%3D` ב-URL.)
3. Monitoring Interval: **5 minutes**.

## 4. קישור וואטסאפ (יאיר)

ה-session `default` כבר נוצר ב-`dalor-waha` עם ה-webhook מוטמע. נשאר רק לסרוק QR
מהטלפון של **יאיר** (972507983306). ה-QR מתחלף כל ~60 שניות — צריך שיאיר יהיה נוכח.

מהמחשב:

```bash
curl -s "https://dalor-waha.onrender.com/api/default/auth/qr?format=image" \
  -H "X-Api-Key: <WAHA_API_KEY>" -o qr.png && open qr.png
```

יאיר: WhatsApp → הגדרות → מכשירים מקושרים → קשר מכשיר → סורק.

בדיקה: `curl -s https://dalor-waha.onrender.com/api/sessions/default -H "X-Api-Key: <WAHA_API_KEY>"` → `"status":"WORKING"`.

ה-webhook כבר מוטמע ב-session, אבל אפשר גם לוודא באפליקציה → **אינטגרציות → WhatsApp**.

## 5. הרצה ראשונה — `draft_only`

המערכת עולה במצב `ASSISTANT_MODE=draft_only`: המזכירה **לא שולחת כלום** אוטומטית, רק מכינה טיוטות ב-`/messages`. אחרי שבוע של מעקב → `/settings` → החלפה ל-`active` (whitelist בלבד: שעות/כתובת/מחירון/זמינות תור).
