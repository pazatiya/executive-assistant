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
- אל תסתפק בעצה אם יש כלי שמבצע את הפעולה.
- "תטפלי בזה" = הבן תוצאה רצויה, פרק לשלבים, בצע את מה שמותר, בקש אישור רק היכן שצריך, המשך לעקוב עד סגירה.
- אל תמציא מחיר, תאריך, נתון עסקי, או תשובה של אדם. אם חסר מידע קריטי — שאל שאלה אחת ממוקדת.
- שמור כללים ל-permanent memory כשהמשתמשת אומרת "מעכשיו תמיד" / "אל תעשי יותר".

# מדיניות אישורים (קריטי)
- GREEN (קריאה/סיכום/חיפוש/ניתוח/טיוטה/יצירת משימה/תזכורת מפורשת): בצע אוטומטית דרך הכלים.
- YELLOW (שליחת מייל/הודעה, פרסום, שינוי אירוע, follow-up, עדכון CRM, ארכוב): השתמש ב-request_approval או draft_email_reply/draft_message_reply. אל תבצע ישירות.
- RED (כסף, רכישה, החזר, שינוי מחיר, תשלום, התחייבות, מחיקת מידע משמעותי, שינוי הרשאות, בלתי הפיך): תמיד request_approval. לעולם לא לבצע.
- תלונה / תגובה שלילית: תמיד אישור (negativeSentiment=true).
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
      const fallback = await mockOrchestrate(ctx, effectiveMessage, trace);
      const hint = /credit balance|billing|quota|insufficient/i.test(msg)
        ? "\n\n⚠️ אין יתרת קרדיט בחשבון ה-AI (הועברתי גם דרך ספקים חלופיים). הוסיפי קרדיט או חברי מפתח נוסף ב-Settings › מודל AI."
        : "\n\n⚠️ ספקי ה-AI לא זמינים כרגע — עברתי למצב לוקאלי.";
      reply = fallback + hint;
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

  const priorTurns = (await getMessages(ctx.conversationId))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10, -1)
    .map<ChatMessage>((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const messages: ChatMessage[] = [...priorTurns, { role: "user", content: message }];

  let finalText = "";
  const seenCalls = new Set<string>();
  let readOnlyStreak = 0;
  const READ_ONLY = new Set(["get_context"]);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await ModelRouter.complete("orchestration", { system, messages, tools: TOOL_SCHEMAS }, aiOverride);
    trace.provider = res.provider;
    trace.model = res.model;
    if (res.text) finalText = res.text;

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
      const result = await runTool(call.name, ctx, call.input);
      if (!READ_ONLY.has(call.name)) didMutate = true;
      trace.toolCalls.push({ tool: call.name, input: call.input, output: result });
      if (result.agent && !trace.agents.includes(result.agent)) trace.agents.push(result.agent);
      if (result.approvalId) trace.approvalIds.push(result.approvalId);
      if (result.taskId) trace.taskIds.push(result.taskId);
      if (result.reminderId) trace.reminderIds.push(result.reminderId);
      outcomes.push(`- ${call.name}: ${result.summary}${result.data ? ` ${JSON.stringify(result.data).slice(0, 500)}` : ""}`);
    }

    readOnlyStreak = didMutate ? 0 : readOnlyStreak + 1;
    const nudge =
      readOnlyStreak >= 2
        ? "\n\nכבר יש לך מספיק מידע. עכשיו בצע פעולה קונקרטית (create_task / create_reminder / draft_email_reply / request_approval) או סכם למשתמשת. אל תקרא שוב get_context."
        : "\n\nהמשך: בצע את הפעולות הנדרשות או סכם למשתמשת בעברית.";

    messages.push({ role: "assistant", content: res.text || "(מפעיל כלים)" });
    messages.push({ role: "user", content: `תוצאות הכלים:\n${outcomes.join("\n")}${nudge}` });
  }

  trace.intent = trace.toolCalls.filter((t) => !t.tool.startsWith("_")).length ? "action" : "chat";
  if (finalText) return finalText;

  // model ran tools but never wrote a summary — build one from what happened
  const done = trace.toolCalls
    .filter((t) => !t.tool.startsWith("_") && t.tool !== "get_context")
    .map((t) => (t.output as { summary?: string })?.summary)
    .filter(Boolean);
  return done.length
    ? `בוצע:\n${done.map((d) => `• ${d}`).join("\n")}`
    : "עברתי על הבקשה. אם צריך פעולה ספציפית — כתבי לי מה בדיוק לבצע.";
}
