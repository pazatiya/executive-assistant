import { AI_MOCK_MODE, env } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { GoogleProvider } from "./google";
import { MockProvider } from "./stub-providers";
import type { CompletionRequest, CompletionResult, LLMProvider } from "./provider";

export type TaskType = "orchestration" | "documents" | "writing" | "classification" | "advice";
export type ProviderName = LLMProvider["name"];

/** Models offered per provider in the UI switcher. */
export const MODEL_CATALOG: Record<Exclude<ProviderName, "mock">, { id: string; label: string; tier: "fast" | "balanced" | "deep" }[]> = {
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", tier: "balanced" },
    { id: "claude-opus-5", label: "Claude Opus 5", tier: "deep" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "fast" },
  ],
  google: [
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", tier: "fast" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", tier: "balanced" },
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", tier: "balanced" },
    { id: "gemini-pro-latest", label: "Gemini Pro (latest)", tier: "deep" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini", tier: "fast" },
    { id: "gpt-4o", label: "GPT-4o", tier: "balanced" },
    { id: "gpt-4.1", label: "GPT-4.1", tier: "deep" },
  ],
};

const providers: Record<ProviderName, LLMProvider> = {
  anthropic: new AnthropicProvider(),
  openai: new OpenAIProvider(),
  google: new GoogleProvider(),
  mock: new MockProvider(),
};

const DEFAULT_MODEL: Record<Exclude<ProviderName, "mock">, string> = {
  anthropic: env.aiOrchestratorModel,
  google: process.env.GOOGLE_MODEL || "gemini-3.5-flash-lite",
  openai: process.env.OPENAI_MODEL || "gpt-4o",
};

const FAST_MODEL: Record<Exclude<ProviderName, "mock">, string> = {
  anthropic: env.aiFastModel,
  google: "gemini-3.5-flash-lite",
  openai: "gpt-4o-mini",
};

export interface RouteOverride {
  provider?: ProviderName | null;
  model?: string | null;
}

/** Ordered preference of real providers to try. First = the user/env default. */
function providerChain(preferred: ProviderName): Exclude<ProviderName, "mock">[] {
  const all: Exclude<ProviderName, "mock">[] = ["anthropic", "google", "openai"];
  const head = all.filter((p) => p === preferred);
  return [...head, ...all.filter((p) => p !== preferred)].filter((p) => providers[p].available);
}

export class ModelRouter {
  static resolve(task: TaskType, override?: RouteOverride): { provider: ProviderName; model: string; mock: boolean } {
    if (AI_MOCK_MODE) return { provider: "mock", model: "mock-1", mock: true };
    const preferred = override?.provider ?? env.aiDefaultProvider;
    const chain = providerChain(preferred as ProviderName);
    const first = chain[0];
    if (!first) return { provider: "mock", model: "mock-1", mock: true };
    const model =
      override?.model ??
      (task === "classification" ? FAST_MODEL[first] : DEFAULT_MODEL[first]);
    return { provider: first, model, mock: false };
  }

  /**
   * Runs the completion, failing over to the next available provider on a
   * runtime error (no credits / rate limit / network). Only falls to mock when
   * every real provider is exhausted.
   */
  static async complete(task: TaskType, req: CompletionRequest, override?: RouteOverride): Promise<CompletionResult> {
    if (AI_MOCK_MODE) return providers.mock.complete("mock-1", req);

    const preferred = (override?.provider ?? env.aiDefaultProvider) as ProviderName;
    const chain = providerChain(preferred);
    const errors: string[] = [];

    for (let i = 0; i < chain.length; i++) {
      const p = chain[i];
      const model =
        i === 0 && override?.model
          ? override.model
          : task === "classification"
            ? FAST_MODEL[p]
            : DEFAULT_MODEL[p];
      try {
        const result = await providers[p].complete(model, req);
        if (errors.length) result.stopReason = `failover_from:${errors.join("|")};${result.stopReason ?? ""}`;
        return result;
      } catch (e) {
        errors.push(`${p}:${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      }
    }
    throw new Error(`כל ספקי ה-AI נכשלו — ${errors.join(" · ")}`);
  }

  static status() {
    return {
      mockMode: AI_MOCK_MODE,
      defaultProvider: env.aiDefaultProvider,
      providers: (["anthropic", "google", "openai"] as const).map((name) => ({
        name,
        available: providers[name].available,
        models: MODEL_CATALOG[name],
        defaultModel: DEFAULT_MODEL[name],
      })),
    };
  }
}
