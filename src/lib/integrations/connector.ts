/**
 * Unified connector interface. Every integration (Gmail, Calendar, Instagram,
 * WordPress, Stripe, custom REST …) implements this shape so the orchestrator
 * and action-executor never special-case a provider.
 */

export type ConnectorStatus =
  | "not_connected"
  | "connecting"
  | "connected"
  | "error"
  | "coming_soon";

export interface Capability {
  key: string; // read_email | send_email | list_events | create_event | read_dm | post | ...
  label: string;
  risk: "green" | "yellow" | "red";
}

export interface ConnectorActionResult {
  ok: boolean;
  detail: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ConnectorContext {
  userId: string;
  workspaceId: string | null;
  integrationId: string | null;
  /** decrypted credentials, or {} when not connected */
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface Connector {
  readonly provider: string;
  readonly displayName: string;
  readonly category: "email" | "calendar" | "storage" | "social" | "messaging" | "commerce" | "dev" | "automation" | "database" | "custom";
  /** live status for this user/workspace */
  status: ConnectorStatus;

  /** OAuth / API-key handshake. Returns a redirect URL or a fields spec. */
  connect(ctx: ConnectorContext, params?: Record<string, unknown>): Promise<{ redirectUrl?: string; fields?: { key: string; label: string; secret?: boolean }[]; message: string }>;
  disconnect(ctx: ConnectorContext): Promise<{ ok: boolean }>;
  testConnection(ctx: ConnectorContext): Promise<{ ok: boolean; detail: string }>;
  listCapabilities(): Capability[];
  executeAction(action: string, payload: Record<string, unknown>, ctx?: ConnectorContext): Promise<ConnectorActionResult>;
  fetchData(resource: string, params?: Record<string, unknown>, ctx?: ConnectorContext): Promise<{ ok: boolean; items: unknown[]; detail?: string }>;
  webhookHandler(payload: unknown, ctx?: ConnectorContext): Promise<{ ok: boolean; handled: string }>;
}

/** Base class that returns "not wired yet" for everything — subclasses override. */
export abstract class BaseConnector implements Connector {
  abstract provider: string;
  abstract displayName: string;
  abstract category: Connector["category"];
  status: ConnectorStatus = "not_connected";

  abstract listCapabilities(): Capability[];

  async connect(): Promise<{ redirectUrl?: string; fields?: { key: string; label: string; secret?: boolean }[]; message: string }> {
    return {
      message: `החיבור ל-${this.displayName} עדיין לא הוגדר. נדרש: OAuth client / API key + הטמעת ה-handshake ב-src/lib/integrations/${this.provider}.ts`,
    };
  }
  async disconnect() {
    return { ok: true };
  }
  async testConnection() {
    return { ok: false, detail: `${this.displayName} לא מחובר` };
  }
  async executeAction(
    action: string,
    _payload?: Record<string, unknown>,
    _ctx?: ConnectorContext,
  ): Promise<ConnectorActionResult> {
    return { ok: false, detail: "", error: `${this.displayName}: פעולה "${action}" לא זמינה עד לחיבור` };
  }
  async fetchData(
    resource: string,
    _params?: Record<string, unknown>,
    _ctx?: ConnectorContext,
  ): Promise<{ ok: boolean; items: unknown[]; detail?: string }> {
    return { ok: false, items: [], detail: `${this.displayName}: אין חיבור פעיל (${resource})` };
  }
  async webhookHandler(_payload?: unknown, _ctx?: ConnectorContext) {
    return { ok: false, handled: "none" };
  }
}
