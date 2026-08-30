# המזכירה — Personal AI Executive Assistant

עוזרת אישית אחת מבחינת המשתמשת; מאחורי הקלעים Orchestrator שמנתב לכלים ולסוכנים.
לא צ'אט בלבד — אפליקציה מלאה: frontend, backend, DB, auth, integrations, permissions,
memory, activity logs, agent orchestration.

## הרצה מהירה

```bash
npm install
npm run db:push        # יוצר את מסד הנתונים המקומי (SQLite ב-data/app.db)
npm run db:seed        # 4 workspaces + נתוני דמו
npm run dev            # http://localhost:4310
```

פתחי את הדפדפן ב-http://localhost:4310 — הכל עובד מיד במצב לוקאלי.

### חיבור מפתח AI (מומלץ)

בלי מפתח, המזכירה עובדת ב-**mock mode** דטרמיניסטי (יצירת משימות/תזכורות/אישורים, סיווג
בסיסי, חילוץ מידע ממסמכים בהיוריסטיקה). עם מפתח — הבנת intent, תכנון multi-step וניסוח מלאים.

הוסיפי ל-`.env.local` מפתח אחד או יותר:

```
ANTHROPIC_API_KEY=sk-ant-...       # console.anthropic.com
GOOGLE_API_KEY=...                 # aistudio.google.com/apikey  (Gemini)
OPENAI_API_KEY=sk-...              # platform.openai.com
```

שלושת הספקים ממומשים במלואם (REST, כולל function-calling). ב-**Settings › מודל AI**
בוחרים ספק+מודל, או משאירים "אוטומטי": המערכת מתחילה מ-`AI_DEFAULT_PROVIDER` ו**עוברת
לספק הבא הזמין באמצע הבקשה** אם הנוכחי נכשל (אין קרדיט / rate limit), ורק אם כולם נכשלו —
נופלת למצב לוקאלי עם הודעה מוסברת.

## מבנה

```
src/
  app/
    (app)/            כל המסכים (dashboard, assistant, approvals, tasks, ...)
    api/              REST endpoints
  components/         UI (shadcn-style primitives + panels לכל מסך)
  lib/
    db/               Drizzle schema + client (libSQL מקומי)
    auth/             dev auth (מוחלף ב-Supabase Auth)
    ai/               provider abstraction + ModelRouter (Anthropic / OpenAI / Google / mock)
    agents/           Orchestrator + mock-orchestrator + tools + Business Advisor
    approval/         engine.ts — סיווג GREEN/YELLOW/RED + אכיפת כללי זיכרון
    services/         tasks, reminders, approvals, activity, memory, contacts,
                      goals, workspaces, documents, conversations, brief, action-executor
    integrations/     Connector interface + catalog (24 ספקים) + registry
supabase/migrations/  סכימת Postgres זהה + RLS (למעבר לענן)
scripts/              seed, reset, migrate, reminders-tick
```

## מנוע האישורים

כל פעולה כלפי חוץ עוברת דרך `classifyAction()`:

| רמה | דוגמאות | ברירת מחדל |
|-----|---------|------------|
| **GREEN** | קריאה, סיכום, חיפוש, ניתוח מסמך, טיוטה, יצירת משימה/תזכורת | מבוצע אוטומטית |
| **YELLOW** | שליחת מייל/הודעה, פרסום, שינוי אירוע, follow-up, עדכון CRM, ארכוב | דורש אישור (או הרשאה שהוגדרה) |
| **RED** | כסף, רכישה, החזר, שינוי מחיר, תשלום, מחיקת מידע, שינוי הרשאות | **תמיד** אישור מפורש — לא ניתן לכבות |

- כללי זיכרון (`memories` עם `rule_kind`) יכולים רק **להחמיר**, לא להקל על RED.
- תלונה / סנטימנט שלילי → תמיד אישור.
- "תמיד לאשר מסוג זה" שומר כלל ב-permanent memory (לא זמין ל-RED).

## מנוע התזכורות

```bash
npm run reminders:tick          # ידני
# או cron:
*/5 * * * *  cd /path/to/app && npm run reminders:tick
# או scheduler חיצוני → POST /api/reminders/tick
```

תומך: חד-פעמי, חוזר (daily/weekdays/weekly/monthly), follow-up, מותנה, דדליין, לפני אירוע.

## מעבר ל-Supabase (רב-משתמשים)

1. צרי פרויקט Supabase, מלאי `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` ב-`.env.local`.
2. הריצי `supabase/migrations/0001_initial_schema.sql` ואז `0002_rls_policies.sql`.
3. `DB_DRIVER=supabase` + `AUTH_DRIVER=supabase`.
4. חברי את `createSupabaseDb()` ב-`src/lib/db/index.ts` (drizzle-orm/postgres-js) ואת
   `getCurrentUser()` ב-`src/lib/auth/index.ts` (@supabase/ssr).

הסכימה, ה-RLS וה-service layer כבר בנויים לזה — אין שכתוב.

## סטטוס Phases

- **Phase 1 ✅** — app shell, auth, workspaces, DB, assistant chat, tasks, approvals, activity
- **Phase 2 ✅** — memory, contacts, goals, documents, reminders, daily brief
- **Phase 3 ✅** — Gmail OAuth אמיתי (קריאה + שליחה + סנכרון), חילוץ PDF/DOCX/XLSX, Automation
  Rules + Sender Rules, מסכי Brief, פאנל התראות + עדכון חי, צרופות בצ'אט ("תטפלי בזה"),
  3 ספקי AI + failover. Calendar / Drive — interface מוכן, ה-connector עדיין catalog-stub.
- **Phase 4 ⏳** — Social connectors (catalog + interface מוכנים; dev-toggle לבדיקת זרימות)
- **Phase 5 ⏳** — Browser agent (interface + placeholder; פעולות מסוכנות כבר עוברות approval)

### Gmail (Phase 3)

1. Google Cloud Console → OAuth client (Web). Redirect URI: `http://localhost:4310/api/integrations/google/callback`
2. `.env.local`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `ENCRYPTION_KEY` (32+ תווים)
3. Integrations › Gmail › "חיבור עם Google" → אישור → "סנכרן" מושך מיילים, מסווג, ומריץ Automation Rules.
   טוקנים נשמרים מוצפנים (AES-256-GCM) ב-`integration_credentials`.

### Automation Rules

מסך "אוטומציות": תבניות מוכנות (ליד → טיוטת תשובה, תלונה → משימה, חשבונית → מעקב).
כל חוק רץ על אירוע (`email.received` וכו'), מעריך תנאי פשוט, ומייצר approval או מבצע —
תמיד דרך מנוע האישורים (RED לעולם לא אוטומטי). Sender Rules בטאב נפרד.

מה שלא מחובר מסומן במסך Integrations כ־**Not Connected** עם ה-`setupHint` הדרוש.
