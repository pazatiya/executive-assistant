import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import type { CompletionRequest, CompletionResult, LLMProvider } from "./provider";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  readonly available = Boolean(env.anthropicApiKey);
  private client: Anthropic | null = null;

  private get sdk() {
    if (!this.client) this.client = new Anthropic({ apiKey: env.anthropicApiKey });
    return this.client;
  }

  async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
    // No timeout here would mean a stalled connection hangs forever — the SDK
    // has no default. 25s matches the other providers' bound.
    const msg = await this.sdk.messages.create(
      {
        model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.3,
        system: req.system,
        messages: req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        tools: req.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
      },
      { timeout: 25_000 },
    );

    let text = "";
    const toolCalls: CompletionResult["toolCalls"] = [];
    for (const block of msg.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use")
        toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }

    return {
      text: text.trim(),
      toolCalls,
      provider: this.name,
      model,
      mock: false,
      stopReason: msg.stop_reason ?? undefined,
      usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
    };
  }
}
