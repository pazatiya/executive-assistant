import { env } from "@/lib/env";
import type { CompletionRequest, CompletionResult, LLMProvider } from "./provider";

const BASE = "https://api.openai.com/v1";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly available = Boolean(env.openaiApiKey);

  async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
    const messages: Record<string, unknown>[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 2048,
    };
    if (req.json) body.response_format = { type: "json_object" };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.openaiApiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);

    const data = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = data.choices?.[0]?.message;

    return {
      text: (msg?.content ?? "").trim(),
      toolCalls: (msg?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: safeParse(tc.function.arguments),
      })),
      provider: this.name,
      model,
      mock: false,
      stopReason: data.choices?.[0]?.finish_reason,
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
    };
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
