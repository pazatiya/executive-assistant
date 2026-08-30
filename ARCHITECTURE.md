# Architecture

## תמונה גדולה

```
┌────────────────────────────────────────────────────────────────┐
│  Next.js 15 (App Router) — פרויקט אחד: UI + API + server logic  │
├───────────────┬────────────────────────────────────────────────┤
│  app/(app)/*  │  מסכים (RSC) — קוראים ישירות מ-services          │
│  app/api/*    │  mutations + assistant + webhooks                │
├───────────────┴────────────────────────────────────────────────┤
│  lib/agents/orchestrator  ──►  ModelRouter  ──►  provider        │
│        │                         (anthropic / openai / google / mock)
│        ├─► tools.ts  ─────────┬─► services/*  (CRUD + business logic)
│        └─► approval/engine ───┤
│                               └─► action-executor ─► integrations/*
├────────────────────────────────────────────────────────────────┤
│  Drizzle ORM  ──►  libSQL (data/app.db)   |  Supabase Postgres   │
│                    ── DB_DRIVER switch ──                         │
└────────────────────────────────────────────────────────────────┘
```

## Agent orchestration

מבחינת המשתמשת — עוזרת אחת. בפועל:

- **Orchestrator** (`lib/agents/orchestrator.ts`) — נקודת הכניסה היחידה. בונה system
  prompt (persona + מדיניות אישורים + brand voice של ה-workspace + זיכרון), מריץ
  לולאת tool-use מול `ModelRouter`, מפרסם תוצאות, שומר trace.
- **mock-orchestrator** — כשאין מפתח AI. זיהוי intent דטרמיניסטי (regex) שקורא לאותם
  tools. מבטיח שכל האפליקציה עובדת בלי תלות חיצונית.
- **Sub-agents** (`AGENT_REGISTRY`) — Email / Calendar / Documents / Social / Research
  / Task / Browser / Business Advisor / QA-Safety. חלקם מודולים ממשיים
  (`business-advisor.ts`, `documents.ts` service), חלקם namespace לפעולות ב-`tools.ts`
  שה-Orchestrator מפעיל. `agent_settings` מחזיק autonomy + override של provider/model
  לכל סוכן לכל workspace.
- **QA / Safety** — לא סוכן LLM נפרד אלא `approval/engine.ts` שכל פעולה יוצאת עוברת דרכו.

## Model Router

`ModelRouter.resolve(taskType, override)` בוחר provider+model לפי:
`task type → cost/quality policy → user/agent override → fallback chain → mock`.

מדיניות ברירת מחדל: `documents → Claude Sonnet`, `classification → fast model`,
`orchestration/writing → AI_DEFAULT_PROVIDER`.

## Approval flow

```
orchestrator/automation → classifyAction() ──► green + autonomy allows ─► executeAction() now
                                          └──► otherwise ─► approvals row (pending)
                                                              │
                                       user: approve / edit+approve / reject / always-allow
                                                              │
                                                approve ─► executeAction() ─► activity_log
```

`executeAction` משתמש ב-connector אמיתי אם `status=connected`, אחרת מעדכן את הרשומה
המקומית ומחזיר `simulated: true` — שום דבר לא מתחזה לפעולה שקרתה.

## Data layer

- **מקומי:** Drizzle + libSQL (`src/lib/db/schema.ts`). קובץ אחד, אפס תלויות.
- **ענן:** `supabase/migrations/` — אותה סכימה ב-Postgres + RLS (owner-per-row,
  workspace membership, `integration_credentials` = service-role בלבד, `document_chunks`
  עם pgvector).
- ה-service layer תלוי רק ב-`db` המיוצא — החלפת driver לא נוגעת בלוגיקה.

## Integrations

`Connector` interface אחיד: `connect / disconnect / testConnection / listCapabilities /
executeAction / fetchData / webhookHandler`. `catalog.ts` מגדיר 24 ספקים עם capabilities
ו-risk לכל capability. `registry.getConnector()` מחזיר connector אמיתי אם רשום, אחרת
`CatalogConnector` שמדווח not-connected. הוספת ספק אמיתי = קובץ אחד + שורה ב-`realConnectors`.

## מה עוד לא מחובר (מסומן במפורש ב-UI)

| רכיב | מצב | מה נדרש |
|------|-----|---------|
| Gmail / Calendar / Drive | interface מוכן | Google OAuth client + handshake ב-`lib/integrations/gmail.ts` |
| Social (IG/FB/TikTok/WA/TG) | catalog + interface | tokens + מימוש `fetchData`/`executeAction` |
| Browser Agent | placeholder | חיבור למנוע דפדפן; פעולות מסוכנות כבר עוברות approval |
| OpenAI / Google LLM | interface מוכן | SDK + מימוש `complete()` ב-`stub-providers.ts` |
| PDF/DOCX/XLSX parsing | טקסט/CSV עובד | parser library ב-`services/documents.ts` |
| Supabase Auth | dev auth פעיל | `@supabase/ssr` ב-`lib/auth/index.ts` |
