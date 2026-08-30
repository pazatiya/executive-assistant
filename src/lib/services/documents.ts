import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentChunks, documents } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { ModelRouter } from "@/lib/ai/model-router";
import { extractText } from "@/lib/documents/extract";
import { logActivity } from "./activity";

const UPLOAD_DIR = join(process.cwd(), "data", "uploads");

export type Document = typeof documents.$inferSelect;

function detectKind(mime: string, name: string): Document["kind"] {
  const n = name.toLowerCase();
  if (mime.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (mime.includes("word") || n.endsWith(".docx")) return "docx";
  if (mime.includes("sheet") || n.endsWith(".xlsx")) return "xlsx";
  if (mime.includes("csv") || n.endsWith(".csv")) return "csv";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  return "other";
}

export interface IngestInput {
  userId: string;
  workspaceId: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  /** Raw file bytes — extracted server-side (pdf/docx/xlsx/csv/txt). */
  buffer?: ArrayBuffer;
  /** Or supply already-extracted text directly (e.g. pasted email body). */
  text?: string;
}

export async function ingestDocument(input: IngestInput): Promise<Document> {
  const kind = detectKind(input.mimeType, input.title);
  const docId = id("doc");

  let extractedText = input.text ?? "";
  let storagePath: string | null = null;
  let note: string | undefined;

  if (input.buffer) {
    await mkdir(UPLOAD_DIR, { recursive: true });
    storagePath = join(UPLOAD_DIR, `${docId}-${input.title}`.replace(/[^\w.\-א-ת]+/g, "_"));
    await writeFile(storagePath, Buffer.from(input.buffer));
    const res = await extractText(input.buffer, input.mimeType, input.title);
    extractedText = res.text;
    note = res.note;
  }

  const row: Document = {
    id: docId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    title: input.title,
    kind,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storagePath,
    extractedText,
    summary: note && !extractedText ? note : null,
    analysis: {},
    status: extractedText.trim() ? "processing" : "uploaded",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(documents).values(row);
  await logActivity({
    userId: input.userId,
    workspaceId: input.workspaceId,
    agent: "documents",
    action: `הועלה מסמך: ${input.title}${note ? ` (${note})` : ""}`,
    tool: "documents",
    target: row.id,
    result: extractedText.trim() || !input.buffer ? "success" : "info",
  });

  if (extractedText.trim().length > 0) {
    await analyzeDocument(input.userId, row.id);
  }
  return (await db.query.documents.findFirst({ where: eq(documents.id, docId) })) ?? row;
}

const CHUNK = 1200;

export async function analyzeDocument(userId: string, documentId: string) {
  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.userId, userId)),
  });
  if (!doc || !doc.extractedText) return null;

  // chunk (vector-ready — embeddings filled when an embedding provider is added)
  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  const text = doc.extractedText;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
  if (chunks.length) {
    await db.insert(documentChunks).values(
      chunks.map((content, idx) => ({
        id: id("chunk"),
        documentId,
        workspaceId: doc.workspaceId,
        chunkIndex: idx,
        content,
        embedding: null,
        tokens: Math.ceil(content.length / 4),
      })),
    );
  }

  let parsed: Record<string, unknown> = {};
  try {
    const res = await ModelRouter.complete("documents", {
      system:
        "אתה מנתח מסמכים עבור מזכירה אישית. החזר JSON בלבד: " +
        '{"summary": string, "actionItems": string[], "dates": [{"label","date"}], ' +
        '"financials": [{"label","amount"}], "parties": string[], "anomalies": string[]}',
      json: true,
      messages: [{ role: "user", content: `נתח את המסמך "${doc.title}":\n\n${text.slice(0, 12000)}` }],
    });
    try {
      parsed = JSON.parse(res.text);
    } catch {
      parsed = { summary: res.text.slice(0, 500) };
    }
  } catch {
    // no AI provider available — heuristic extraction so the doc is still useful
    parsed = heuristicAnalysis(text, doc.title);
  }

  await db
    .update(documents)
    .set({
      summary: (parsed.summary as string) ?? null,
      analysis: {
        actionItems: (parsed.actionItems as string[]) ?? [],
        dates: (parsed.dates as { label: string; date: string }[]) ?? [],
        financials: (parsed.financials as { label: string; amount: string }[]) ?? [],
        parties: (parsed.parties as string[]) ?? [],
        anomalies: (parsed.anomalies as string[]) ?? [],
      },
      status: "ready",
      updatedAt: nowIso(),
    })
    .where(eq(documents.id, documentId));

  return db.query.documents.findFirst({ where: eq(documents.id, documentId) });
}

/** Regex-based extraction used when no LLM provider is available. */
function heuristicAnalysis(text: string, title: string): Record<string, unknown> {
  const firstLines = text.split("\n").filter((l) => l.trim()).slice(0, 3).join(" ");
  const dates = Array.from(
    text.matchAll(/(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}|ה-?\d{1,2}\s+ב?[א-ת]+)/g),
  )
    .slice(0, 6)
    .map((m) => ({ label: "תאריך שאותר", date: m[1] }));
  const financials = Array.from(
    text.matchAll(/(₪|ש"ח|שח|\$|€)\s?[\d,]+(\.\d+)?|[\d,]+(\.\d+)?\s?(₪|ש"ח|שח|\$|€)/g),
  )
    .slice(0, 8)
    .map((m) => ({ label: "סכום", amount: m[0].trim() }));
  const emails = Array.from(text.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)).slice(0, 5).map((m) => m[0]);

  return {
    summary: `(ניתוח מקומי ללא AI) ${title}: ${firstLines.slice(0, 200)}`,
    actionItems: /נא לאשר|נדרש אישור|יש להשיב|deadline|תוקף/i.test(text) ? ["המסמך דורש תגובה/אישור — ראי תוכן"] : [],
    dates,
    financials,
    parties: emails,
    anomalies: [],
  };
}

export async function listDocuments(userId: string, opts: { workspaceId?: string } = {}) {
  const conds = [eq(documents.userId, userId)];
  if (opts.workspaceId) conds.push(eq(documents.workspaceId, opts.workspaceId));
  return db.select().from(documents).where(and(...conds)).orderBy(desc(documents.createdAt));
}

export async function getDocument(userId: string, documentId: string) {
  return db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.userId, userId)),
  });
}
