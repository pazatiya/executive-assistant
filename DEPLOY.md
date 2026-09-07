# פריסה — המזכירה של פז ויאיר

**הארכיטקטורה הסופית (עלות: $0/חודש):**

| שירות | איפה | תוכנית |
|---|---|---|
| האפליקציה (`executive-assistant`) | Render web | **Free** (נשמרת ערה ע"י UptimeRobot) |
| בסיס נתונים | **Turso** (`dalor-mazkira`) | Free |
| וואטסאפ | **Meta Cloud API** (רשמי) | Free לשיחות שלקוח יזם |
| תזמון (tick כל 5 דק') | **UptimeRobot** | Free |

Oracle — נזנח (חסימת הרשמה חוזרת). WAHA — נזנח (Meta רשמי, בלי סיכון חסימה).

---

## 0. מה צריך ביד

- חשבון **Render** (render.com) — של פז, workspace קיים
- חשבון **Turso** — קיים, org `pazatiya`, DB `dalor-mazkira` כבר נוצר
- **מספר וואטסאפ פנוי** לבוט (לא רשום כרגע בוואטסאפ הרגיל)
- כל המפתחות — בקובץ הזמני של הסשן (`scratchpad/render-env.md`)

---

## 1. Blueprint

1. render.com → **New → Blueprint** → בחר את הריפו `executive-assistant`.
2. Render קורא את `render.yaml` ומקים שירות אחד: `executive-assistant` (web, free).
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
| `ANTHROPIC_API_KEY` | מפתח Claude (אופציונלי, גיבוי) |
| `DALOR_BARBER_ADMIN_KEY` | `2810` |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` | מפתחות Web Push (`npx web-push generate-vapid-keys`) |
| `OWNER_WHATSAPP` | `yair@dalor.co.il:972507983306,pazyairat@gmail.com:972547734708` — פקודות בעלים + התראות בוואטסאפ |
| `META_WA_TOKEN` · `META_WA_PHONE_NUMBER_ID` · `META_WA_VERIFY_TOKEN` · `META_APP_SECRET` | ראה §4 |

`AUTH_SESSION_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` — Render מייצר לבד (`generateValue`).

אחרי מילוי → **Manual Deploy**.

> הסכימה כבר נדחפה ל-Turso והבסיס הוזרע מהמחשב המקומי. שינויי סכימה עתידיים:
> `LIBSQL_URL=… LIBSQL_AUTH_TOKEN=… npm run db:push` מקומית.

## 3. תזמון + שמירה על ער — UptimeRobot

מוניטור HTTP(s) יחיד עושה את שתי העבודות (מפעיל את ה-tick כל 5 דק' וגם שומר את
ה-instance החינמי ער):

1. UptimeRobot → **Add New Monitor** → סוג **HTTP(s)**.
2. URL: `https://executive-assistant-nihe.onrender.com/api/scheduler/tick?secret=<CRON_SECRET>`
   (`CRON_SECRET` — Render → executive-assistant → Environment → "Show secret". ה-`=` בסוף חייב `%3D` ב-URL.)
3. Monitoring Interval: **5 minutes**.

## 4. וואטסאפ — Meta Cloud API (הערוץ היחיד)

רשמי = אפס סיכון חסימה, בחינם לשיחות שלקוח יזם. WAHA נזנח (אין שירות $7).
עד שמטה מאשרים אין ערוץ בוט חי — וזה בסדר בשבוע של `draft_only`.

1. **מספר** — צריך מספר שאינו רשום כרגע בוואטסאפ הרגיל. אם הוא רשום: וואטסאפ →
   הגדרות → חשבון → מחק חשבון, ואז הוא פנוי ל-API.
2. **Meta Business** — business.facebook.com → Business Portfolio.
3. **אפליקציה** — developers.facebook.com → Create App → סוג **Business** → הוסף מוצר **WhatsApp**.
4. **WhatsApp → API Setup**: הוסף את המספר, אמת ב-SMS. רשום את **Phone number ID**.
5. **טוקן קבוע** — Business Settings → System Users → משתמש מערכת (Admin) → Generate token →
   בחר את האפליקציה + הרשאות `whatsapp_business_messaging` ו-`whatsapp_business_management`. הטוקן לא פג.
6. **App Secret** — App → Settings → Basic → App Secret (Show).
7. **Webhook** — App → WhatsApp → Configuration:
   - Callback URL: `https://executive-assistant-nihe.onrender.com/api/webhooks/meta`
   - Verify token: מחרוזת שאתה בוחר (= `META_WA_VERIFY_TOKEN`)
   - Subscribe: שדה **messages**.
8. **Render → executive-assistant → Environment**: `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`,
   `META_WA_VERIFY_TOKEN`, `META_APP_SECRET` → Save (מפעיל דפלוי).
9. בדיקה: שלח וואטסאפ למספר → ההודעה נכנסת ל-**הודעות** באפליקציה. עלות: **$0**.

> אימות עסקי (Business Verification) ב-Security Center פותח מכסות גבוהות + וי ירוק —
> רץ ברקע, לא חוסם התחלה. עד אז המספר יכול לענות ללקוחות שכתבו אליו, במגבלת נפח יומית.

## 5. הרצה ראשונה — `draft_only`

המערכת עולה במצב `ASSISTANT_MODE=draft_only`: המזכירה **לא שולחת כלום** אוטומטית, רק מכינה טיוטות ב-`/messages`. אחרי שבוע של מעקב → `/settings` → החלפה ל-`active` (whitelist בלבד: שעות/כתובת/מחירון/זמינות תור).
