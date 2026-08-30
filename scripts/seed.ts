/**
 * Seed: creates the local user, demo workspaces and demo data so the app is
 * immediately explorable. Idempotent-ish — run `npm run db:reset` first for a
 * clean slate.
 */
import "dotenv/config";
import { db } from "../src/lib/db/index.ts";
import {
  agents,
  approvals,
  contacts,
  emails,
  goals,
  memories,
  messages,
  reminders,
  senderRules,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "../src/lib/db/schema.ts";
import { AGENT_REGISTRY } from "../src/lib/agents/types.ts";
import { ensureIntegrationRows } from "../src/lib/integrations/registry.ts";
import { id } from "../src/lib/ids.ts";
import { eq } from "drizzle-orm";

const nowIso = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const hoursAhead = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function main() {
  console.log("→ seeding…");

  // ── user ───────────────────────────────────────────────
  let user = await db.query.users.findFirst({ where: eq(users.email, "pazyairat@gmail.com") });
  if (!user) {
    const uid = id("user");
    await db.insert(users).values({
      id: uid,
      email: "pazyairat@gmail.com",
      fullName: "פז",
      timezone: "Asia/Jerusalem",
      locale: "he",
      preferences: { morningBriefAt: "07:30", endOfDayBriefAt: "18:30" },
    });
    user = await db.query.users.findFirst({ where: eq(users.id, uid) });
  }
  if (!user) throw new Error("user seed failed");
  const userId = user.id;

  // ── agents registry ────────────────────────────────────
  for (const a of AGENT_REGISTRY) {
    const exists = await db.query.agents.findFirst({ where: eq(agents.key, a.key) });
    if (!exists)
      await db.insert(agents).values({
        id: id("agent"),
        key: a.key,
        name: a.name,
        description: a.description,
        category: a.category as "core" | "channel" | "utility" | "safety",
        isSystem: true,
      });
  }

  // ── workspaces ─────────────────────────────────────────
  const wsSpecs = [
    { name: "Personal", type: "personal" as const, color: "#0ea5e9", icon: "user", desc: "אישי — משפחה, בריאות, כספים פרטיים" },
    { name: "DALOR", type: "business" as const, color: "#6366f1", icon: "briefcase", desc: "DALOR — מספרה, מועדון לקוחות, קמפיינים, וואטסאפ" },
    { name: "SHIRAOS", type: "business" as const, color: "#ec4899", icon: "gift", desc: "SHIRAOS — מארזי מתנה, אתר שיווקי, אינסטגרם" },
    { name: "Other Projects", type: "project" as const, color: "#10b981", icon: "layers", desc: "פרויקטים נוספים ומשימות שלא שייכות ל-workspace ספציפי" },
  ];
  const wsIds: Record<string, string> = {};
  for (const spec of wsSpecs) {
    let ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, spec.name.toLowerCase().replace(/\s+/g, "-")) });
    if (!ws) {
      const wid = id("ws");
      await db.insert(workspaces).values({
        id: wid,
        ownerId: userId,
        name: spec.name,
        slug: spec.name.toLowerCase().replace(/\s+/g, "-"),
        type: spec.type,
        description: spec.desc,
        color: spec.color,
        icon: spec.icon,
        brandVoice:
          spec.name === "DALOR"
            ? { tone: "חם, ישיר, שירותי", formality: "casual", language: "he", doList: ["לפנות בשם הפרטי", "אימוג'י בודד מותר"], dontList: ["לא לכתוב מחיר בלי אישור"], signature: "צוות DALOR" }
            : spec.name === "SHIRAOS"
              ? { tone: "אלגנטי, חמים", formality: "neutral", language: "he", signature: "SHIRAOS" }
              : {},
      });
      await db.insert(workspaceMembers).values({ id: id("wm"), workspaceId: wid, userId, role: "owner" });
      ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, wid) });
    }
    wsIds[spec.name] = ws!.id;
  }
  const dalor = wsIds["DALOR"];
  const shiraos = wsIds["SHIRAOS"];

  await ensureIntegrationRows(userId);

  // Always seed the permanent rules (real, not demo). Skip fake content when
  // SEED_DEMO=0 — use that for a clean production system.
  const seedDemo = process.env.SEED_DEMO !== "0";

  const hasRules = await db.query.memories.findFirst({ where: eq(memories.userId, userId) });
  if (!hasRules) {
    await db.insert(memories).values([
      {
        id: id("mem"), userId, workspaceId: null, type: "permanent",
        subject: "אישור לפני שינוי מחיר", content: "תמיד לבקש אישור מפורש לפני כל שינוי מחיר או מסירת מחיר ללקוח.",
        ruleKind: "always_require_approval", ruleTarget: "change_price", importance: "critical", source: "user",
      },
      {
        id: id("mem"), userId, workspaceId: null, type: "knowledge",
        subject: "שעות פעילות", content: "המשרד פעיל א׳–ה׳ 9:00–18:00. לא לקבוע פגישות מחוץ לחלון הזה בלי לשאול.",
        importance: "normal", source: "user",
      },
    ]);
  }

  const already = await db.query.tasks.findFirst({ where: eq(tasks.userId, userId) });
  if (!seedDemo || already) {
    console.log(seedDemo ? "✓ demo data already present — skipping content seed" : "✓ clean seed (SEED_DEMO=0) — workspaces + rules only");
    console.log("✓ seed complete");
    return;
  }

  // ── demo memory (workspace-specific style) ─────────────
  await db.insert(memories).values([
    {
      id: id("mem"), userId, workspaceId: dalor, type: "permanent",
      subject: "סגנון מול לקוחות DALOR", content: "כתיבה קלילה וישירה, פנייה בשם פרטי, אפשר אימוג'י בודד. לא רשמי.",
      ruleKind: "writing_style", ruleTarget: "dalor", importance: "high", source: "user",
    },
  ]);

  // ── sender rules ───────────────────────────────────────
  await db.insert(senderRules).values([
    { id: id("sr"), userId, workspaceId: null, sender: "newsletter@", category: "newsletter", priority: "low", autoArchive: true, autoReplyAllowed: false, approvalRequired: false, notes: "ניוזלטרים — לארכב אוטומטית" },
    { id: id("sr"), userId, workspaceId: dalor, sender: "orders@dalor.co.il", category: "business", priority: "high", autoArchive: false, autoReplyAllowed: false, approvalRequired: true, notes: "הזמנות — תמיד לעבור עליי" },
  ]);

  // ── contacts ───────────────────────────────────────────
  await db.insert(contacts).values([
    {
      id: id("con"), userId, workspaceId: dalor, name: "יאיר", role: "בעל המספרה", company: "DALOR",
      email: "yair@dalor.co.il", phone: "+972500000001", relationshipType: "partner", importance: "vip",
      communicationStyle: "ישיר וקצר", notes: "שותף. מעדיף וואטסאפ.", tags: ["dalor", "partner"], lastInteractionAt: hoursAgo(20),
    },
    {
      id: id("con"), userId, workspaceId: dalor, name: "מיכל לוי", role: "לקוחה", email: "michal.levi@example.com",
      phone: "+972500000002", relationshipType: "client", importance: "high",
      communicationStyle: "אוהבת פירוט", notes: "לקוחה קבועה במועדון VIP.", tags: ["vip"], lastInteractionAt: hoursAgo(50),
    },
  ]);

  // ── goal ───────────────────────────────────────────────
  const goalId = id("goal");
  await db.insert(goals).values({
    id: goalId, userId, workspaceId: dalor,
    title: "להגדיל מכירות מועדון DALOR ב-20% ברבעון", description: "יעד רבעוני להגדלת הכנסות המועדון.",
    metric: "הכנסות חודשיות מהמועדון (₪)", target: "72,000", currentValue: "60,000",
    deadline: hoursAhead(24 * 75), status: "active", progress: 15,
    strategy: {
      nextActions: ["קמפיין SMS לחברי מועדון רדומים", "הטבת חבר מביא חבר", "באנר באתר"],
      experiments: [{ hypothesis: "תזכורת אחרי 30 יום ללא ביקור מחזירה 15% מהלקוחות" }],
    },
  });

  // ── tasks ──────────────────────────────────────────────
  await db.insert(tasks).values([
    {
      id: id("task"), userId, workspaceId: dalor, title: "לחזור ללקוחה מיכל לוי לגבי מנוי VIP",
      description: "מיכל פנתה באינסטגרם ושאלה על שדרוג המנוי. לא קיבלה מענה כבר יומיים.",
      status: "in_progress", priority: "high", createdBy: "assistant", assignedTo: "assistant",
      source: "message:seed", goalId, followUpAt: hoursAhead(24),
      plan: [
        { step: "לאסוף פרטי מנוי נוכחי", status: "done" },
        { step: "להכין תשובה עם אפשרויות שדרוג (בלי מחיר סופי — צריך אישור)", status: "pending" },
        { step: "לשלוח אחרי אישור", status: "pending" },
      ],
      outcome: "מיכל קיבלה תשובה ויודעת מה האפשרויות",
    },
    {
      id: id("task"), userId, workspaceId: dalor, title: "לתאם צילומים לקמפיין חבר מביא חבר",
      description: "צריך לתאם עם יאיר תאריך צילום למספרה.", status: "waiting", priority: "normal",
      createdBy: "user", assignedTo: "assistant", source: "manual", followUpAt: hoursAhead(48),
      plan: [{ step: "לשלוח ליאיר 3 תאריכים אפשריים", status: "done" }, { step: "לחכות לאישור תאריך", status: "blocked", note: "יאיר לא חזר" }],
      outcome: "תאריך צילום נקבע ומסונכרן ליומן",
    },
    {
      id: id("task"), userId, workspaceId: shiraos, title: "להעלות 3 פוסטים לאינסטגרם לקראת ראש השנה",
      description: "סדרת פוסטים למארזי ראש השנה.", status: "planned", priority: "normal",
      createdBy: "user", assignedTo: "assistant", source: "manual", dueDate: hoursAhead(24 * 4),
      plan: [
        { step: "לכתוב טקסטים ל-3 פוסטים", status: "pending" },
        { step: "להעלות לאישור", status: "pending" },
        { step: "לתזמן פרסום", status: "pending" },
      ],
      outcome: "3 פוסטים מתוזמנים ומאושרים",
    },
  ]);

  // ── emails ─────────────────────────────────────────────
  await db.insert(emails).values([
    {
      id: id("email"), userId, workspaceId: dalor, fromAddress: "michal.levi@example.com", fromName: "מיכל לוי",
      toAddresses: ["pazyairat@gmail.com"], subject: "שדרוג מנוי VIP – כמה עולה?",
      snippet: "היי, רציתי לדעת מה ההבדל בין המנוי שלי למנוי ה-VIP ומה המחיר…",
      bodyText: "היי,\nרציתי לדעת מה ההבדל בין המנוי שלי למנוי ה-VIP ומה המחיר.\nתודה, מיכל",
      receivedAt: hoursAgo(5), category: "lead", priority: "high", isRead: false, replyRequired: true,
      status: "inbox", source: "seed", aiSummary: "לקוחה מבקשת פרטים ומחיר על מנוי VIP. דורש תשובה; מחיר צריך אישור.",
    },
    {
      id: id("email"), userId, workspaceId: dalor, fromAddress: "orders@dalor.co.il", fromName: "מערכת הזמנות",
      toAddresses: ["pazyairat@gmail.com"], subject: "הזמנה חדשה #4821",
      snippet: "התקבלה הזמנה חדשה מס' 4821 בסך 340 ₪…", bodyText: "התקבלה הזמנה חדשה מס' 4821.\nסכום: 340 ₪\nלקוח: דנה כהן",
      receivedAt: hoursAgo(9), category: "business", priority: "normal", isRead: false, replyRequired: false, status: "inbox", source: "seed",
    },
    {
      id: id("email"), userId, workspaceId: null, fromAddress: "newsletter@marketingweekly.com", fromName: "Marketing Weekly",
      toAddresses: ["pazyairat@gmail.com"], subject: "10 טרנדים לשיווק ברבעון הבא",
      snippet: "הטרנדים החמים…", bodyText: "תוכן שיווקי.", receivedAt: hoursAgo(14),
      category: "newsletter", priority: "low", isRead: false, replyRequired: false, status: "inbox", source: "seed",
    },
  ]);

  // ── social messages ────────────────────────────────────
  await db.insert(messages).values([
    {
      id: id("smsg"), userId, workspaceId: dalor, channel: "instagram", kind: "dm", authorHandle: "@michal_l",
      authorName: "מיכל לוי", text: "היי! אפשר לתאם תור לצבע לשבוע הבא? ואיך משדרגים ל-VIP?",
      receivedAt: hoursAgo(48), classification: "lead", sentiment: "positive", priority: "high", status: "new", source: "seed",
    },
    {
      id: id("smsg"), userId, workspaceId: dalor, channel: "instagram", kind: "comment", authorHandle: "@dana_k",
      authorName: "דנה כהן", text: "חיכיתי 40 דקות מעבר לתור שקבעתי, ממש לא נעים 😕",
      receivedAt: hoursAgo(6), classification: "complaint", sentiment: "negative", priority: "urgent", status: "new", source: "seed",
    },
    {
      id: id("smsg"), userId, workspaceId: shiraos, channel: "instagram", kind: "dm", authorHandle: "@events_sarit",
      authorName: "שרית", text: "מעניין אותי מארז ל-15 עובדים, אפשר הצעת מחיר?",
      receivedAt: hoursAgo(30), classification: "lead", sentiment: "neutral", priority: "high", status: "new", source: "seed",
    },
  ]);

  // ── reminders ──────────────────────────────────────────
  await db.insert(reminders).values([
    {
      id: id("rem"), userId, workspaceId: dalor, title: "לבדוק אם יאיר חזר לגבי תאריך צילום",
      description: "follow-up על תיאום צילומי הקמפיין", kind: "follow_up", dueAt: hoursAhead(20),
      timezone: "Asia/Jerusalem", status: "scheduled",
    },
    {
      id: id("rem"), userId, workspaceId: null, title: "Morning Brief", description: "סקירת בוקר יומית",
      kind: "recurring", dueAt: hoursAhead(12), timezone: "Asia/Jerusalem", recurrence: "weekdays", status: "scheduled",
    },
    {
      id: id("rem"), userId, workspaceId: shiraos, title: "דדליין: פוסטים לראש השנה",
      description: "הפוסטים צריכים להיות מתוזמנים", kind: "deadline", dueAt: hoursAhead(24 * 3),
      timezone: "Asia/Jerusalem", status: "scheduled",
    },
  ]);

  // ── approvals ──────────────────────────────────────────
  await db.insert(approvals).values([
    {
      id: id("apr"), userId, workspaceId: dalor, title: "תשובה למיכל לוי – פרטי מנוי VIP (ללא מחיר)",
      context: "מ: מיכל לוי <michal.levi@example.com>\nנושא: שדרוג מנוי VIP – כמה עולה?",
      actionType: "send_email", targetSystem: "gmail",
      actionPayload: { emailId: "seed", to: "michal.levi@example.com", body: "היי מיכל,\nמנוי ה-VIP כולל תור מובטח תוך 24 שעות, טיפול פינוק פעם בחודש והנחה קבועה על מוצרים.\nלגבי המחיר המדויק — אחזור אלייך עם הצעה מסודרת היום.\nתודה!" },
      riskLevel: "yellow", reason: "שליחת מייל ללקוח (YELLOW). בנוסף: כלל קבוע — מחיר דורש אישור, לכן הטיוטה בלי מחיר.",
      preview: "היי מיכל,\nמנוי ה-VIP כולל תור מובטח תוך 24 שעות, טיפול פינוק פעם בחודש והנחה קבועה על מוצרים.\nלגבי המחיר המדויק — אחזור אלייך עם הצעה מסודרת היום.\nתודה!",
      proposedBy: "email", status: "pending", relatedConversationId: null,
    },
    {
      id: id("apr"), userId, workspaceId: dalor, title: "תגובה לתלונה של דנה כהן באינסטגרם",
      context: "תגובה (@dana_k): חיכיתי 40 דקות מעבר לתור… סנטימנט שלילי.",
      actionType: "reply_message", targetSystem: "instagram",
      actionPayload: { messageId: "seed", text: "היי דנה, אני ממש מצטערת על ההמתנה — זה לא הסטנדרט שלנו. שלחתי לך הודעה פרטית כדי לפצות ולתאם את הביקור הבא. תודה שהבאת את זה לידיעתנו 🙏" },
      riskLevel: "yellow", reason: "תגובה לפנייה שלילית / תלונה — תמיד עוברת אישור.",
      preview: "היי דנה, אני ממש מצטערת על ההמתנה — זה לא הסטנדרט שלנו. שלחתי לך הודעה פרטית כדי לפצות ולתאם את הביקור הבא. תודה שהבאת את זה לידיעתנו 🙏",
      proposedBy: "social", status: "pending",
    },
    {
      id: id("apr"), userId, workspaceId: dalor, title: "עדכון מחיר מנוי VIP במערכת ל-249 ₪",
      context: "בקשה לעדכן את מחיר מנוי ה-VIP באתר ובמערכת ההזמנות.",
      actionType: "change_price", targetSystem: "woocommerce",
      actionPayload: { product: "VIP membership", newPrice: 249, currency: "ILS" },
      riskLevel: "red", reason: "שינוי מחיר — פעולה ברמת RED. תמיד דורשת אישור מפורש. השפעה: מחיר חדש באתר ובמערכת.",
      preview: "מוצר: מנוי VIP\nמחיר נוכחי: 219 ₪\nמחיר חדש: 249 ₪\nמערכת: WooCommerce + אתר",
      proposedBy: "orchestrator", status: "pending",
    },
  ]);

  console.log("✓ seed complete — 4 workspaces, 3 tasks, 3 approvals, 3 emails, 3 messages, 3 reminders, 1 goal, 2 contacts");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
