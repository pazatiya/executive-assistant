export interface AgentContext {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  conversationId: string;
  timezone: string;
}

export interface OrchestratorInput {
  userId: string;
  workspaceId: string;
  conversationId: string;
  message: string;
  /** attachment refs — document ids, pasted email json, urls */
  attachments?: { kind: "document" | "email" | "url" | "text"; ref: string }[];
}

export interface OrchestratorResult {
  reply: string;
  trace: {
    intent: string;
    workspaceGuess: string;
    agents: string[];
    toolCalls: { tool: string; input: unknown; output?: unknown }[];
    approvalIds: string[];
    taskIds: string[];
    reminderIds: string[];
    provider: string;
    model: string;
    mock: boolean;
  };
}

export const AGENT_REGISTRY = [
  { key: "orchestrator", name: "Orchestrator", category: "core", description: "מקבל כל בקשה, מזהה כוונה ו-workspace, מפעיל את הכלים והסוכנים הנכונים ומרכיב תשובה אחת." },
  { key: "email", name: "Email Agent", category: "channel", description: "קריאה, סיווג, סיכום והכנת טיוטות תשובה למיילים. שליחה תמיד דרך אישור בהתחלה." },
  { key: "calendar", name: "Calendar Agent", category: "channel", description: "בדיקת זמינות, הצעת זמנים, יצירה ועדכון של אירועים, זיהוי התנגשויות." },
  { key: "documents", name: "Documents Agent", category: "channel", description: "חילוץ תוכן, סיכום, השוואה, זיהוי משימות/תאריכים/מידע פיננסי ממסמכים." },
  { key: "social", name: "Social Agent", category: "channel", description: "קריאת הודעות ותגובות, זיהוי לידים/תלונות, הכנת תשובות בסגנון המותג." },
  { key: "research", name: "Research Agent", category: "utility", description: "איסוף מידע, בדיקת עובדות, סיכום מקורות." },
  { key: "task", name: "Task Agent", category: "utility", description: "יצירת משימות ותת-משימות, מעקב אחרי follow-up, סגירה כשמושגת תוצאה." },
  { key: "browser", name: "Browser Agent", category: "utility", description: "ניווט, מילוי טפסים, העלאה/הורדה במערכות web. פעולות מסוכנות עוברות אישור. עדיין לא מופעל." },
  { key: "business_advisor", name: "Business Advisor", category: "utility", description: "זיהוי צווארי בקבוק, הזדמנויות, אוטומציות, רעיונות להגדלת מכירות והורדת עלויות." },
  { key: "qa_safety", name: "QA / Safety Agent", category: "safety", description: "בודק כל פעולה מול מדיניות ההרשאות והסיכון לפני ביצוע; חוסם פעולות RED ללא אישור." },
] as const;
