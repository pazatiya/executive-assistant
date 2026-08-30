import { env } from "@/lib/env";
import type { CompletionRequest, CompletionResult, LLMProvider, ToolSchema } from "./provider";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Convert our JSON-schema-ish tool params to Gemini's OpenAPI subset. */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const t = schema.type;
  if (typeof t === "string") out.type = t.toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties && typeof schema.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [
        k,
        toGeminiSchema(v),
      ]),
    );
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  if (schema.items && typeof schema.items === "object") out.items = toGeminiSchema(schema.items as Record<string, unknown>);
  return out;
}

function toGeminiTools(tools?: ToolSchema[]) {
  if (!tools?.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: toGeminiSchema(t.parameters),
      })),
    },
  ];
}

export class GoogleProvider implements LLMProvider {
  readonly name = "google" as const;
  readonly available = Boolean(env.googleApiKey);

  async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.3,
        maxOutputTokens: req.maxTokens ?? 2048,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    const tools = toGeminiTools(req.tools);
    if (tools) body.tools = tools;

    let res = await fetch(`${BASE}/models/${model}:generateContent?key=${env.googleApiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    // one retry on transient overload / rate limit
    if ((res.status === 503 || res.status === 429) ) {
      await new Promise((r) => setTimeout(r, 1200));
      res = await fetch(`${BASE}/models/${model}:generateContent?key=${env.googleApiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${res.status} ${errText}`);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args: Record<string, unknown> } }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    let text = "";
    const toolCalls: CompletionResult["toolCalls"] = [];
    let idx = 0;
    for (const part of data.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) text += part.text;
      if (part.functionCall)
        toolCalls.push({
          id: `gem_${Date.now()}_${idx++}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        });
    }

    return {
      text: text.trim(),
      toolCalls,
      provider: this.name,
      model,
      mock: false,
      stopReason: data.candidates?.[0]?.finishReason,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
