/** Provider-agnostic LLM interface. Every provider adapter implements this. */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON schema for the tool input. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompletionRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** Force a JSON object response (best-effort per provider). */
  json?: boolean;
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCall[];
  provider: string;
  model: string;
  mock: boolean;
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LLMProvider {
  readonly name: "anthropic" | "openai" | "google" | "mock";
  readonly available: boolean;
  complete(model: string, req: CompletionRequest): Promise<CompletionResult>;
}
