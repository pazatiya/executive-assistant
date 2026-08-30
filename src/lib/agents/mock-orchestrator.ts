import type { AgentContext, OrchestratorResult } from "./types";
import { runTool } from "./tools";
import { parseWhen, detectRecurrence } from "./date-parse";

/**
 * Deterministic orchestration for when no LLM provider is connected. Covers the
 * common intents so the whole app (tasks, reminders, approvals, activity) is
 * demonstrably working with zero API keys. Connect a key for real reasoning.
 */
export async function mockOrchestrate(
  ctx: AgentContext,
  message: string,
  trace: OrchestratorResult["trace"],
): Promise<string> {
  // separate the user's actual instruction from any appended attachment context
  const [instruction, ...attachParts] = message.split("\n\n[צרופות לטיפול]\n");
  const t = instruction.trim();
  const hasAttachments = attachParts.length > 0;
  const lower = t.toLowerCase();
  const say: string[] = [];

  const push = async (tool: string, input: Record<string, unknown>) => {
    const r = await runTool(tool, ctx, input);
    trace.toolCalls.push({ tool, input, output: r });
    if (r.agent && !trace.agents.includes(r.agent)) trace.agents.push(r.agent);
    if (r.approvalId) trace.approvalIds.push(r.approvalId);
    if (r.taskId) trace.taskIds.push(r.taskId);
    if (r.reminderId) trace.reminderIds.push(r.reminderId);
    return r;
  };

  // ── reminder ─────────────────────────────────────────────
  if (/(תזכיר|תזכור|remind|תזכורת)/.test(t)) {
    const dueAt = parseWhen(t) ?? new Date(Date.now() + 24 * 3600_000).toISOString();
    const recurrence = detectRecurrence(t);
    const title =
      t
        .replace(/^.*?(תזכיר[יו]?\s+לי|תזכיר[יו]?|תזכורת|remind me to|remind me)\s*/i, "")
        .replace(/(מחרתיים|מחר|היום|בעוד\s+\d+\s*\S+|בשעה\s*\d{0,2}:?\d{0,2}|ב-?\s?\d{1,2}:\d{2}|בשבוע הבא|כל יום|כל שבוע|כל חודש|יומי|שבועי|חודשי)/g, "")
        .replace(/^[\s,־-]+/, "")
        .replace(/\s{2,}/g, " ")
        .trim() || "תזכורת";
    const r = await push("create_reminder", {
      title,
      dueAt,
      recurrence,
      kind: recurrence ? "recurring" : "one_time",
    });
    trace.intent = "create_reminder";
    say.push(r.summary + (recurrence ? " (חוזרת)" : "") + ".");
  }

  // ── "handle this" / follow / take care ───────────────────
  else if (hasAttachments || /(תטפל|תטפלי|תדאג|תדאגי|תעקוב|תעקבי|handle this|take care)/.test(t)) {
    const task = await push("create_task", {
      title: (t.replace(/^תטפלי? ב?זה\s*/i, "").trim() || attachParts.join(" ").split("\n").find((l) => l.includes("צרופה:"))?.replace(/.*צרופה:\s*/, "") || "טיפול בפנייה").slice(0, 80),
      description: message,
      priority: /דחוף|urgent|מיד/.test(t) ? "high" : "normal",
      plan: [
        "להבין מה נדרש ומה נחשב לתוצאה מוצלחת",
        "לבצע את מה שאפשר אוטומטית",
        "להעלות לאישור כל פעולה שאינה GREEN",
        "לעקוב עד שהתוצאה הושגה",
      ],
      outcome: "המשימה נסגרת רק כשהתוצאה הושגה או שהמשתמשת סוגרת אותה",
    });
    trace.intent = "handle_this";
    say.push(`${task.summary}. בניתי תוכנית ב-4 שלבים ואעקוב עד סגירה.`);
    say.push("במצב לוקאלי (ללא מפתח AI) אני מבצעת את השלבים הניתנים לאוטומציה ומעלה כל שאר הפעולות לאישור.");
  }

  // ── email reply ─────────────────────────────────────────
  else if (/(תעני למייל|תשיבי למייל|reply to.*email|תשובה למייל)/.test(t)) {
    trace.intent = "email_reply";
    say.push("כדי לענות על מייל ספציפי צריך לחבר את Gmail (Integrations › Gmail).");
    say.push("בינתיים אפשר להדביק את גוף המייל כאן ואכין טיוטת תשובה שתעבור אישור לפני שליחה.");
  }

  // ── calendar ────────────────────────────────────────────
  else if (/(פגישה|יומן|תמצאי זמן|calendar|meeting|תקבעי)/.test(t)) {
    trace.intent = "calendar";
    say.push("Google Calendar עדיין לא מחובר (Integrations › Google Calendar).");
    say.push("ברגע שיחובר אבדוק זמינות, אציע חלונות ואצור את האירוע אחרי אישור.");
  }

  // ── goal ────────────────────────────────────────────────
  else if (/(מטרה|יעד|goal|להגדיל מכירות|רעיונות ל)/.test(t)) {
    trace.intent = "advice";
    if (/מטרה|יעד|goal/.test(lower)) {
      const g = await push("create_goal", { title: t.slice(0, 80), description: t });
      say.push(g.summary + ".");
    }
    const adv = await push("business_advice", { topic: t });
    const items = (adv.data?.advice as { observation: string; recommendation: string }[]) ?? [];
    say.push("המלצות ראשוניות:");
    for (const it of items.slice(0, 3)) say.push(`• ${it.observation} → ${it.recommendation}`);
  }

  // ── remember a rule ─────────────────────────────────────
  else if (/(מעכשיו תמיד|מעכשיו|אל תעשי יותר|תזכרי ש|זכרי ש)/.test(t)) {
    trace.intent = "save_rule";
    const m = await push("save_memory", {
      subject: t.slice(0, 60),
      content: t,
      type: "permanent",
      ruleKind: /אישור/.test(t) ? "always_require_approval" : /תמחק|תמחקי/.test(t) ? "do_not" : "custom",
      importance: "high",
      global: true,
    });
    say.push(m.summary + ". הכלל ייאכף מעכשיו.");
  }

  // ── plain chat / status ─────────────────────────────────
  else {
    trace.intent = "chat";
    const c = await push("get_context", { kind: "overview" });
    const d = c.data as Record<string, unknown[]>;
    say.push(
      `סקירה מהירה של ${ctx.workspaceName}: ${d.openTasks?.length ?? 0} משימות פתוחות, ` +
        `${d.pendingApprovals?.length ?? 0} אישורים ממתינים, ${d.inboxEmails?.length ?? 0} מיילים בתיבה.`,
    );
    say.push('כתבי לי מה לעשות ("תטפלי בזה", "תזכירי לי מחר...", "תכיני תשובה ל...") ואבצע ואעלה לאישור מה שצריך.');
  }

  return say.join("\n");
}
