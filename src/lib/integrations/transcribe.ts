/**
 * Voice-note transcription: download the WhatsApp audio from Meta, send it to
 * Gemini, get back plain text. The pipeline then treats it like a typed message.
 */
import { env } from "@/lib/env";
import { fetchInboundMediaBytes } from "./meta-whatsapp";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_BYTES = 15 * 1024 * 1024; // inline-data limit headroom; a voice note is ~100KB–2MB

export async function transcribeVoiceMessage(
  mediaId: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!env.googleApiKey) return { ok: false, error: "GOOGLE_API_KEY לא מוגדר" };
  try {
    const dl = await fetchInboundMediaBytes(mediaId);
    if (!dl.ok) return { ok: false, error: dl.error };
    if (dl.bytes.byteLength > MAX_BYTES) return { ok: false, error: "הקובץ גדול מדי" };
    // Meta sends "audio/ogg; codecs=opus" — Gemini wants the bare type
    const mimeType = dl.mimeType.split(";")[0].trim() || "audio/ogg";
    const res = await fetch(`${BASE}/models/${env.googleModel}:generateContent?key=${env.googleApiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "תמלל את ההודעה הקולית הזאת מילה במילה, בשפה שבה היא נאמרה (בדרך כלל עברית). " +
                  "החזר רק את הטקסט המתומלל, בלי הקדמה ובלי הערות. אם אין דיבור ברור, החזר: [לא ברור]",
              },
              { inline_data: { mime_type: mimeType, data: Buffer.from(dl.bytes).toString("base64") } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return { ok: false, error: `Gemini ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) return { ok: false, error: "תמלול ריק" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
