import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, users, workspaces } from "@/lib/db/schema";
import { ModelRouter, type RouteOverride } from "@/lib/ai/model-router";
import type { ChatMessage } from "@/lib/ai/provider";
import { getMessages, addMessage, setConversationTitle } from "@/lib/services/conversations";
import { memoryContext } from "@/lib/services/memory";
import { logActivity } from "@/lib/services/activity";
import { listWorkspaces } from "@/lib/services/workspaces";
import type { AgentContext, OrchestratorInput, OrchestratorResult } from "./types";
import { runTool, TOOL_SCHEMAS } from "./tools";
import { mockOrchestrate } from "./mock-orchestrator";

const MAX_TOOL_ITERATIONS = 5;

function systemPrompt(opts: {
  workspaceName: string;
  brandVoice: string;
  memory: string;
  otherWorkspaces: string[];
  timezone: string;
}): string {
  return `אתה המוח של עוזרת אישית דיגיטלית ("מזכירה") עבור המשתמשת. מבחינת המשתמשת יש עוזרת אחת; מאחורי הקלעים אתה מנתב לכלים ולסוכנים.

# עקרונות
- **לעולם אל תגידי "שלחתי"/"נשלח"/"יצא" אלא אם כלי שליחה אמיתי (send_message_now, message_customer, reach_out_to_customer, reply_message וכו') החזיר ok:true בפועל.** request_approval **לא** שולח כלום — הוא רק יוצר בקשה שממתינה. אחרי request_approval תגידי במפורש שזה ממתין לאישור (ומי צריך לאשר), אף פעם לא שזה בוצע/נשלח. תיאור שגוי כאן זה לשקר לבעלים על מה שקרה בפועל.
- אל תסתפק בעצה אם יש כלי שמבצע את הפעולה.
- "תטפלי בזה" = הבן תוצאה רצויה, פרק לשלבים, בצע את מה שמותר, בקש אישור רק היכן שצריך, המשך לעקוב עד סגירה.
- אל תמציא מחיר, תאריך, נתון עסקי, תשובה של אדם, **או מספר טלפון/ID**. פרמטר קריטי חסר (כמו phone) אף פעם לא מקבל ערך מומצא/placeholder כדי "למלא" קריאה לכלי — אם אין לך אותו בוודאות מ-get_context, שאל שאלה אחת ממוקדת ועצור.
- שמות בעברית ובאנגלית/תעתיק עשויים להיות אותו אדם (למשל "בן ברוך" ו-"Ben Baruch") — בדוק גם התאמה כזו לפני שאת מסיקה "לא נמצא". אם באמת אין שום התאמה (גם לא בתעתיק) — תגידי זאת בפירוש ושאלי למספר, אל תמשיכי בכלי עם מידע מומצא.
- "כמה התאמות" נמדד לפי **מספרי טלפון שונים**, לא לפי מספר שורות/הודעות. לקוח אחד שכתב 20 הודעות מופיע כ-20 שורות ב-get_context עם **אותו** מספר טלפון (from) — זו התאמה אחת ברורה, לא כמה לקוחות. רק אם באמת יש שני מספרי טלפון שונים עם שם דומה (למשל "אבי" ו"אבי מנהל במימון כל", שני from שונים) — זו אי-בהירות אמיתית. במקרה כזה בלבד: אל תנחש ואל תמשיך לקרוא get_context שוב, עצור מיד ושאל שאלה אחת ממוקדת (מספר טלפון) והמתן לתשובה — אל תבצע אף כלי עד שיובהר.
- שמור כללים ל-permanent memory כשהמשתמשת אומרת "מעכשיו תמיד" / "אל תעשי יותר".
- "תשלח לו את (כל) התמונות" (בלי מספר ID ספציפי בהודעה עצמה): קרא get_context(kind=pendingImages) וקבל את כל ה-mediaId שהצטברו, והעבר את כולם ב-imageMediaIds אחד ל-send_image_to_customer — לא קריאה נפרדת לכל תמונה. **לעולם אל תרכיב imageMediaIds מתוך מה שאת/ה "רואה" בהודעות קודמות בשיחה — ה-ID האמיתי מוסתר משם בכוונה** (יכול להיות שהצטברו יותר תמונות ממה שנכנס לחלון ההיסטוריה שאת/ה רואה) — get_context(kind=pendingImages) הוא המקור היחיד האמין למספר האמיתי ולכל ה-ID-ים.
- בקשה לשלוח/לחזור ללקוח לפי שם: קרא get_context(kind=messages) **לפני** כל ניסיון שליחה, כדי למצוא את ה-messageId האמיתי שלו — כולל הודעות שכבר נענו (חזרה עם תשובה אמיתית אחרי אישור אוטומטי היא המקרה הנפוץ ביותר). רק אם הלקוח לא מופיע שם בכלל — reach_out_to_customer.
- בקשה שקשורה למישהו מאנשי הקשר האישיים ("שלחי לאמא", "תזכירי לי להתקשר לבעלי", "המספר של חלי"): קראי find_contact(query) עם השם או חלק ממנו — לא צריך את השם המלא המדויק שבו הוא שמור. משם קחי את הטלפון. אם find_contact החזיר כמה התאמות — הציגי אותן ושאלי איזה, אל תנחשי.
- אם המשתמשת מאשרת/דוחה משהו במילים שלה ("מאשרת", "כן תמחק אותה", "סבבה", "לא, תעזוב") ולא במילה המדויקת "אשר"/"דחה" — בדקי get_context(kind=approvals): אם יש אישור ממתין רלוונטי, החליטי עליו עם decide_approval לפי ה-approvalId שלו. אל תיצרי request_approval נוסף לאותו דבר (זה יוצר כפילויות), ולעולם אל תגידי שאין לך יכולת לבצע פעולה כשיש אישור ממתין רלוונטי — זה תמיד שקר.

# מדיניות אישורים (קריטי)
- GREEN (קריאה/סיכום/חיפוש/ניתוח/טיוטה/יצירת משימה/תזכורת מפורשת): בצע אוטומטית דרך הכלים.
- YELLOW (שליחת מייל/הודעה, פרסום, שינוי אירוע, follow-up, עדכון CRM, ארכוב): השתמש ב-request_approval או draft_email_reply/draft_message_reply. אל תבצע ישירות.
- **יוצא מן הכלל:** תגובה ללקוח שהבעלים (פז/יאיר) הכתיבו מילה במילה ("תגיב ל-X ככה: ...") — זה כבר אושר על ידם, השתמש ב-send_message_now ושלח מיד, בלי request_approval/draft_message_reply. אם אתה מנסח את הניסוח בעצמך (גם אם קיבלת רק כיוון כללי) — זו עדיין YELLOW, draft_message_reply בלבד.
- **יוצא מן הכלל נוסף — איש קשר אישי:** הודעה למישהו מספר הקשרים האישי של הבעלים (בן/בת זוג, בן משפחה, חבר — נמצא עם find_contact, לא לקוח של DALOR) שהבעלים הכתיבו מילה במילה — זו כבר החלטה שלהם על האדם שלהם, השתמש ב-message_customer ושלח מיד, בלי request_approval. אם הנוסח שלך (אפילו רק ניסחת מחדש) — עדיין דרך message_customer מיד, לא request_approval — זה לא לקוח והסיכון פנימי. **היוצא מן הכלל הזה לא חל** אם מדובר בלקוח אמיתי של DALOR (יש לו הודעה קיימת / הגיע דרך תורים-קטלוג) — שם ממשיכה מדיניות ה-YELLOW הרגילה.
- RED (כסף, רכישה, החזר, שינוי מחיר, תשלום, התחייבות, מחיקת מידע משמעותי, שינוי הרשאות, בלתי הפיך): תמיד request_approval. לעולם לא לבצע.
- תלונה / תגובה שלילית: תמיד אישור (negativeSentiment=true) — גם אם הבעלים נתנו נוסח מדויק.
- מחיר ללקוח: אל תכתוב מחיר מהזיכרון. אם אין מקור ודאי — אמור זאת והעלה לאישור.

# תהליך
1. אם צריך מצב נוכחי — קרא get_context קודם.
2. בצע פעולות GREEN.
3. לכל דבר אחר — צור approval עם preview מלא.
4. אם המשימה נמשכת מעבר לפעולה אחת — צור task עם plan ו-outcome.
5. סיים בתשובה קצרה בעברית: מה עשית, מה ממתין לאישור, ומה השלב הבא.

# הקשר
תאריך ושעה עכשיו: ${new Date().toLocaleString("he-IL", { timeZone: opts.timezone, dateStyle: "full", timeStyle: "short" })} (${new Date().toISOString()})
כשאת יוצרת תזכורת/אירוע — חשבי את dueAt ביחס לזמן הזה והחזירי ISO-8601 עם אזור זמן, למשל 2026-08-31T09:00:00+03:00.
Workspace פעיל: ${opts.workspaceName}
Workspaces אחרים: ${opts.otherWorkspaces.join(", ") || "אין"}
אזור זמן: ${opts.timezone}
${opts.brandVoice ? `\nסגנון כתיבה ל-${opts.workspaceName}:\n${opts.brandVoice}` : ""}
${opts.memory ? `\n${opts.memory}` : ""}

ענה תמיד בעברית. היה תמציתי ומעשי.`;
}

export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorResult> {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, input.workspaceId) });
  if (!ws) throw new Error("workspace not found");

  const ctx: AgentContext = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    workspaceName: ws.name,
    conversationId: input.conversationId,
    timezone: ws.settings && (ws.settings as Record<string, string>).timezone
      ? (ws.settings as Record<string, string>).timezone
      : "Asia/Jerusalem",
  };

  const usr = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
  const aiPref = (usr?.preferences as { ai?: { provider?: string; model?: string } } | undefined)?.ai;
  const aiOverride: RouteOverride = {
    provider: (aiPref?.provider as RouteOverride["provider"]) ?? null,
    model: aiPref?.model ?? null,
  };

  const route = ModelRouter.resolve("orchestration", aiOverride);
  const trace: OrchestratorResult["trace"] = {
    intent: "chat",
    workspaceGuess: ws.name,
    agents: ["orchestrator"],
    toolCalls: [],
    approvalIds: [],
    taskIds: [],
    reminderIds: [],
    provider: route.provider,
    model: route.model,
    mock: route.mock,
  };

  // load attachment context (documents ingested for this turn)
  let attachmentContext = "";
  const attachmentRefs = (input.attachments ?? []).map((a) => a.ref).filter(Boolean);
  if (attachmentRefs.length) {
    const docs = await db
      .select()
      .from(documents)
      .where(and(eq(documents.userId, input.userId), inArray(documents.id, attachmentRefs)));
    attachmentContext = docs
      .map((d) => {
        const a = d.analysis ?? {};
        const bits = [
          `— צרופה: ${d.title} (${d.kind})`,
          d.summary && `סיכום: ${d.summary}`,
          a.actionItems?.length && `משימות מהמסמך: ${a.actionItems.join("; ")}`,
          a.dates?.length && `תאריכים: ${a.dates.map((x) => `${x.label} ${x.date}`).join("; ")}`,
          a.financials?.length && `סכומים: ${a.financials.map((x) => `${x.label} ${x.amount}`).join("; ")}`,
          d.extractedText && `תוכן:\n${d.extractedText.slice(0, 4000)}`,
        ].filter(Boolean);
        return bits.join("\n");
      })
      .join("\n\n");
    trace.toolCalls.push({ tool: "_load_attachments", input: { refs: attachmentRefs }, output: { summary: `נטענו ${docs.length} צרופות` } });
    if (!trace.agents.includes("documents")) trace.agents.push("documents");
  }

  const effectiveMessage = attachmentContext
    ? `${input.message}\n\n[צרופות לטיפול]\n${attachmentContext}`
    : input.message;

  await addMessage(input.conversationId, "user", input.message);

  let reply: string;

  if (route.mock) {
    reply = await mockOrchestrate(ctx, effectiveMessage, trace);
  } else {
    try {
      reply = await llmOrchestrate(ctx, effectiveMessage, trace, aiOverride);
    } catch (e) {
      // provider failure (no credits, rate limit, network) — degrade gracefully to
      // the deterministic path so the assistant never hard-fails on the user.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[orchestrator] provider=${route.provider} failed: ${msg.slice(0, 500)}`);
      trace.mock = true;
      trace.provider = "mock";
      trace.toolCalls.push({ tool: "_provider_error", input: { provider: route.provider }, output: { summary: msg.slice(0, 300) } });
      await logActivity({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        agent: "orchestrator",
        action: `נפילה למצב לוקאלי — שגיאת ספק AI (${route.provider})`,
        tool: route.provider,
        result: "failure",
        error: msg.slice(0, 400),
      });
      // a transient Google overload (503 / "high demand") shouldn't read as "no credit"
      const transient = /50[23]|high demand|overload|unavailable|timeout|rate.?limit|429/i.test(msg);
      const hint = transient
        ? "⚠️ יש עומס רגעי על ה-AI — נסה/י שוב עוד רגע."
        : /credit balance|billing|quota|insufficient/i.test(msg)
          ? "⚠️ אין יתרת קרדיט בחשבון ה-AI. הוסיפי קרדיט או חברי מפתח נוסף ב-Settings › מודל AI."
          : "⚠️ ה-AI לא זמין כרגע, נסה/י שוב עוד רגע.";
      // Do NOT fall back to mockOrchestrate here — it's a deterministic
      // demo-mode intent parser meant for "no AI key configured at all", not
      // for "the real provider hiccuped mid-request". Handing it
      // effectiveMessage (which carries the hidden internal instruction
      // wrapper — see owner-commands.ts) made it regex-match the word
      // "תזכורת" *inside that wrapper* and silently create a bogus reminder,
      // while echoing the raw wrapper text back as the reply. A plain retry
      // prompt is the honest, safe response to a transient provider error.
      reply = hint;
    }
  }

  await addMessage(input.conversationId, "assistant", reply, trace);

  // title the conversation from the first user turn
  const history = await getMessages(input.conversationId);
  if (history.filter((m) => m.role === "user").length === 1) {
    await setConversationTitle(input.conversationId, input.message.slice(0, 48));
  }

  await logActivity({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    agent: "orchestrator",
    action: `שיחה: "${input.message.slice(0, 60)}"`,
    tool: "assistant",
    result: "info",
    metadata: { intent: trace.intent, agents: trace.agents, mock: trace.mock },
  });

  return { reply, trace };
}

async function llmOrchestrate(
  ctx: AgentContext,
  message: string,
  trace: OrchestratorResult["trace"],
  aiOverride?: RouteOverride,
): Promise<string> {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, ctx.workspaceId) });
  const others = (await listWorkspaces(ctx.userId)).filter((w) => w.id !== ctx.workspaceId).map((w) => w.name);
  const bv = ws?.brandVoice ?? {};
  const brandVoice = [
    bv.tone && `טון: ${bv.tone}`,
    bv.formality && `רשמיות: ${bv.formality}`,
    bv.doList?.length && `כן: ${bv.doList.join("; ")}`,
    bv.dontList?.length && `לא: ${bv.dontList.join("; ")}`,
    bv.signature && `חתימה: ${bv.signature}`,
  ]
    .filter(Boolean)
    .join("\n");

  const system = systemPrompt({
    workspaceName: ctx.workspaceName,
    brandVoice,
    memory: await memoryContext(ctx.userId, ctx.workspaceId),
    otherWorkspaces: others,
    timezone: ctx.timezone,
  });

  // Strip raw imageMediaId="..." tags from OLDER turns before they reach the
  // model. Without this, a batch of accumulated photos (see owner-commands.ts
  // — each one is its own row) partially survives into this trimmed window,
  // and the model reads the IDs it happens to still see here instead of
  // calling get_context(kind=pendingImages) for the full, deduped set — which
  // is exactly how "send all the photos" silently sent only however many fit
  // in the last 9 prior turns instead of everything accumulated. The current
  // turn's own freshly-attached photo (built in owner-commands.ts) is left
  // untouched — acting on that one directly, by its real id, is correct.
  const priorTurns = (await getMessages(ctx.conversationId))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10, -1)
    .map<ChatMessage>((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.replace(/imageMediaId="[^"]+"/g, 'imageMediaId="(ראה get_context kind=pendingImages)"'),
    }));

  const messages: ChatMessage[] = [...priorTurns, { role: "user", content: message }];

  let finalText = "";
  const seenCalls = new Set<string>();
  let readOnlyStreak = 0;
  const READ_ONLY = new Set(["get_context"]);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    console.log(`[orchestrator] iter=${i} requesting completion…`);
    const res = await ModelRouter.complete("orchestration", { system, messages, tools: TOOL_SCHEMAS }, aiOverride);
    trace.provider = res.provider;
    trace.model = res.model;
    if (res.text) finalText = res.text;
    console.log(
      `[orchestrator] iter=${i} provider=${res.provider}/${res.model} calls=[${res.toolCalls.map((c) => c.name).join(",") || "none"}] text="${(res.text ?? "").slice(0, 150)}"`,
    );

    if (!res.toolCalls.length) break;

    const outcomes: string[] = [];
    let didMutate = false;
    for (const call of res.toolCalls) {
      const sig = `${call.name}:${JSON.stringify(call.input)}`;
      if (seenCalls.has(sig)) {
        outcomes.push(`- ${call.name}: (כבר בוצע — אל תחזור על זה, החלט מה הלאה)`);
        continue;
      }
      seenCalls.add(sig);
      console.log(`[orchestrator] tool_call ${call.name} input=${JSON.stringify(call.input).slice(0, 300)}`);
      const result = await runTool(call.name, ctx, call.input);
      console.log(
        `[orchestrator] tool_result ${call.name} ok=${result.ok} summary="${result.summary}"${result.data ? ` data=${JSON.stringify(result.data).slice(0, 600)}` : ""}`,
      );
      if (!READ_ONLY.has(call.name)) didMutate = true;
      trace.toolCalls.push({ tool: call.name, input: call.input, output: result });
      if (result.agent && !trace.agents.includes(result.agent)) trace.agents.push(result.agent);
      if (result.approvalId) trace.approvalIds.push(result.approvalId);
      if (result.taskId) trace.taskIds.push(result.taskId);
      if (result.reminderId) trace.reminderIds.push(result.reminderId);
      // 500 chars was cutting real get_context data mid-list — e.g. get_context
      // (messages) with 5+ customers easily exceeds that, so anyone past the
      // cutoff was invisible to the model, not "not found": it never saw them.
      // 6000 comfortably covers get_context's realistic max (30 messages) while
      // still bounding a genuinely oversized blob from some other tool.
      outcomes.push(`- ${call.name}: ${result.summary}${result.data ? ` ${JSON.stringify(result.data).slice(0, 6000)}` : ""}`);
    }

    readOnlyStreak = didMutate ? 0 : readOnlyStreak + 1;
    const nudge =
      readOnlyStreak >= 2
        ? "\n\nכבר יש לך מספיק מידע. עכשיו בצע פעולה קונקרטית (send_message_now אם הבעלים נתנו נוסח מדויק לשליחה ללקוח, draft_message_reply אם אתה מנסח בעצמך תגובה ללקוח, create_task / create_reminder / draft_email_reply / request_approval) או סכם למשתמשת. אל תקרא שוב get_context."
        : "\n\nהמשך: בצע את הפעולות הנדרשות או סכם למשתמשת בעברית.";

    messages.push({ role: "assistant", content: res.text || "(מפעיל כלים)" });
    messages.push({ role: "user", content: `תוצאות הכלים:\n${outcomes.join("\n")}${nudge}` });
  }

  trace.intent = trace.toolCalls.filter((t) => !t.tool.startsWith("_")).length ? "action" : "chat";
  if (finalText) return finalText;

  // model ran tools but never wrote a summary — build one from what happened.
  // Distinguish success from failure: dumping a failed tool's raw error under
  // "בוצע:" (done) reads as a lie, and a wall of tool-call jargon isn't a
  // question a person can actually answer.
  const acted = trace.toolCalls.filter((t) => !t.tool.startsWith("_") && t.tool !== "get_context");
  const succeeded = acted.filter((t) => (t.output as { ok?: boolean })?.ok).map((t) => (t.output as { summary?: string })?.summary).filter(Boolean);
  const failed = acted.filter((t) => (t.output as { ok?: boolean })?.ok === false).map((t) => (t.output as { summary?: string })?.summary).filter(Boolean);

  const parts: string[] = [];
  if (succeeded.length) parts.push(`בוצע:\n${succeeded.map((d) => `• ${d}`).join("\n")}`);
  if (failed.length) parts.push(`לא הצלחתי:\n${failed.map((d) => `• ${d}`).join("\n")}`);
  return parts.length ? parts.join("\n\n") : "עברתי על הבקשה. אם צריך פעולה ספציפית — כתבי לי מה בדיוק לבצע.";
}
