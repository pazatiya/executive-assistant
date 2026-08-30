import type { CompletionRequest, CompletionResult, LLMProvider } from "./provider";

/** Deterministic offline provider. Understands the small JSON contract the
 *  orchestrator asks for so the app is fully usable with zero API keys. */
export class MockProvider implements LLMProvider {
  readonly name = "mock" as const;
  readonly available = true;

  async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const text = req.json
      ? JSON.stringify(mockJson(lastUser, req.system ?? ""))
      : mockProse(lastUser);
    return { text, toolCalls: [], provider: "mock", model, mock: true };
  }
}

function mockJson(userText: string, system: string): unknown {
  if (system.includes("INTENT_CLASSIFIER") || system.includes("plan")) {
    const wantsReminder = /(תזכיר|תזכור|remind|מחר|בעוד)/.test(userText);
    const wantsEmail = /(מייל|תעני|תשיב|email|reply)/.test(userText);
    const wantsCalendar = /(פגישה|יומן|זמן|calendar|meeting)/.test(userText);
    const wantsTask = /(תטפל|תדאג|תעש|task|משימה|תעקוב)/.test(userText);
    return {
      intent: wantsReminder ? "create_reminder" : wantsEmail ? "email_reply" : wantsCalendar ? "calendar" : wantsTask ? "handle_this" : "chat",
      summary: userText.slice(0, 120),
      draft: wantsEmail ? "שלום,\n\nתודה על פנייתך. אחזור אליך עם פרטים מלאים בהקדם.\n\nבברכה" : null,
      needsApproval: wantsEmail,
    };
  }
  return { note: "mock" };
}

function mockProse(userText: string): string {
  return [
    "אני עובדת במצב לוקאלי (ללא מפתח AI מחובר).",
    "רשמתי את הבקשה, וכל פעולה שמצריכה אישור תופיע במרכז האישורים.",
    userText.trim() ? `הבקשה שקלטתי: "${userText.trim().slice(0, 140)}"` : "",
    "לניסוח והבנה מלאים — חברי מפתח Anthropic או Google (Gemini) ב-Settings.",
  ]
    .filter(Boolean)
    .join(" ");
}
