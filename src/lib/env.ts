/** Centralised environment access. Server-only values must never reach the client. */

function get(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const env = {
  // data
  dbDriver: get("DB_DRIVER", "libsql") as "libsql" | "supabase",
  libsqlUrl: get("LIBSQL_URL", "file:./data/app.db"),
  databaseUrl: get("DATABASE_URL"),
  supabaseUrl: get("SUPABASE_URL"),
  supabaseAnonKey: get("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),

  // auth
  authDriver: get("AUTH_DRIVER", "dev") as "dev" | "supabase",
  authSessionSecret: get("AUTH_SESSION_SECRET", "dev-insecure-secret-change-me-please!!"),

  // ai
  anthropicApiKey: get("ANTHROPIC_API_KEY"),
  openaiApiKey: get("OPENAI_API_KEY"),
  googleApiKey: get("GOOGLE_API_KEY"),
  aiDefaultProvider: get("AI_DEFAULT_PROVIDER", "anthropic") as "anthropic" | "openai" | "google",
  aiOrchestratorModel: get("AI_ORCHESTRATOR_MODEL", "claude-sonnet-4-5"),
  aiFastModel: get("AI_FAST_MODEL", "claude-haiku-4-5-20251001"),
  googleModel: get("GOOGLE_MODEL", "gemini-2.0-flash"),
  openaiModel: get("OPENAI_MODEL", "gpt-4o"),

  // Google OAuth (Gmail / Calendar / Drive connectors)
  googleOauthClientId: get("GOOGLE_OAUTH_CLIENT_ID"),
  googleOauthClientSecret: get("GOOGLE_OAUTH_CLIENT_SECRET"),
  encryptionKey: get("ENCRYPTION_KEY", get("AUTH_SESSION_SECRET", "dev-insecure-secret-change-me-please!!")),

  // app
  appUrl: get("APP_URL", "http://localhost:4310"),
  appTimezone: get("APP_TIMEZONE", "Asia/Jerusalem"),
} as const;

/** True when no real LLM provider key is configured — the system falls back to
 *  deterministic local reasoning so the app stays fully usable offline. */
export const AI_MOCK_MODE =
  !env.anthropicApiKey && !env.openaiApiKey && !env.googleApiKey;
