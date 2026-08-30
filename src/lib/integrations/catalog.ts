import { BaseConnector, type Capability, type Connector } from "./connector";

/** Metadata for every provider the architecture anticipates. */
export interface ProviderSpec {
  provider: string;
  displayName: string;
  category: Connector["category"];
  phase: 1 | 3 | 4 | 5;
  capabilities: Capability[];
  authKind: "oauth2" | "api_key" | "webhook" | "none";
  setupHint: string;
}

const cap = (key: string, label: string, risk: Capability["risk"]): Capability => ({ key, label, risk });

export const PROVIDER_CATALOG: ProviderSpec[] = [
  {
    provider: "gmail",
    displayName: "Gmail",
    category: "email",
    phase: 3,
    authKind: "oauth2",
    setupHint: "Google Cloud OAuth client + scope gmail.modify. הטמעה ב-src/lib/integrations/gmail.ts",
    capabilities: [
      cap("read_email", "קריאת תיבה", "green"),
      cap("summarize_email", "סיכום מיילים", "green"),
      cap("draft_reply", "הכנת טיוטת תשובה", "green"),
      cap("send_email", "שליחת מייל", "yellow"),
      cap("archive_email", "ארכוב", "yellow"),
    ],
  },
  {
    provider: "google_calendar",
    displayName: "Google Calendar",
    category: "calendar",
    phase: 3,
    authKind: "oauth2",
    setupHint: "אותו OAuth client, scope calendar.events",
    capabilities: [
      cap("list_events", "קריאת אירועים", "green"),
      cap("check_availability", "בדיקת זמינות", "green"),
      cap("create_event", "יצירת אירוע", "yellow"),
      cap("update_event", "עדכון אירוע", "yellow"),
      cap("cancel_event", "ביטול אירוע", "red"),
    ],
  },
  {
    provider: "google_drive",
    displayName: "Google Drive",
    category: "storage",
    phase: 3,
    authKind: "oauth2",
    setupHint: "scope drive.file",
    capabilities: [cap("list_files", "רשימת קבצים", "green"), cap("read_file", "קריאת קובץ", "green"), cap("upload_file", "העלאת קובץ", "yellow")],
  },
  {
    provider: "google_sheets",
    displayName: "Google Sheets",
    category: "storage",
    phase: 3,
    authKind: "oauth2",
    setupHint: "scope spreadsheets",
    capabilities: [cap("read_sheet", "קריאת גיליון", "green"), cap("append_row", "הוספת שורה", "yellow")],
  },
  {
    provider: "instagram",
    displayName: "Instagram",
    category: "social",
    phase: 4,
    authKind: "oauth2",
    setupHint: "Meta Graph API + Instagram Business account",
    capabilities: [cap("read_dm", "קריאת הודעות", "green"), cap("read_comments", "קריאת תגובות", "green"), cap("reply_dm", "מענה להודעה", "yellow"), cap("reply_comment", "מענה לתגובה", "yellow"), cap("publish_post", "פרסום", "yellow")],
  },
  {
    provider: "facebook",
    displayName: "Facebook",
    category: "social",
    phase: 4,
    authKind: "oauth2",
    setupHint: "Meta Graph API + Page access token",
    capabilities: [cap("read_messages", "קריאת הודעות", "green"), cap("reply_message", "מענה", "yellow"), cap("publish_post", "פרסום", "yellow")],
  },
  {
    provider: "tiktok",
    displayName: "TikTok",
    category: "social",
    phase: 4,
    authKind: "oauth2",
    setupHint: "TikTok for Developers — Content Posting API",
    capabilities: [cap("read_comments", "קריאת תגובות", "green"), cap("reply_comment", "מענה לתגובה", "yellow")],
  },
  {
    provider: "whatsapp",
    displayName: "WhatsApp",
    category: "messaging",
    phase: 4,
    authKind: "api_key",
    setupHint: "WhatsApp Cloud API (Meta) או ספק צד ג׳",
    capabilities: [cap("read_messages", "קריאת הודעות", "green"), cap("send_message", "שליחת הודעה", "yellow")],
  },
  {
    provider: "telegram",
    displayName: "Telegram",
    category: "messaging",
    phase: 4,
    authKind: "api_key",
    setupHint: "Bot token מ-@BotFather",
    capabilities: [cap("read_messages", "קריאת הודעות", "green"), cap("send_message", "שליחת הודעה", "yellow")],
  },
  {
    provider: "slack",
    displayName: "Slack",
    category: "messaging",
    phase: 4,
    authKind: "oauth2",
    setupHint: "Slack app + bot token",
    capabilities: [cap("read_messages", "קריאת הודעות", "green"), cap("post_message", "שליחת הודעה", "yellow")],
  },
  {
    provider: "wordpress",
    displayName: "WordPress",
    category: "commerce",
    phase: 4,
    authKind: "api_key",
    setupHint: "Application Password + REST API",
    capabilities: [cap("list_posts", "רשימת פוסטים", "green"), cap("create_post", "יצירת פוסט", "yellow"), cap("update_post", "עדכון פוסט", "yellow")],
  },
  {
    provider: "woocommerce",
    displayName: "WooCommerce",
    category: "commerce",
    phase: 4,
    authKind: "api_key",
    setupHint: "Consumer key/secret",
    capabilities: [cap("list_orders", "הזמנות", "green"), cap("list_products", "מוצרים", "green"), cap("update_product", "עדכון מוצר", "yellow"), cap("update_price", "שינוי מחיר", "red")],
  },
  {
    provider: "shopify",
    displayName: "Shopify",
    category: "commerce",
    phase: 4,
    authKind: "oauth2",
    setupHint: "Custom app + Admin API access token",
    capabilities: [cap("list_orders", "הזמנות", "green"), cap("list_products", "מוצרים", "green"), cap("update_price", "שינוי מחיר", "red")],
  },
  {
    provider: "stripe",
    displayName: "Stripe",
    category: "commerce",
    phase: 4,
    authKind: "api_key",
    setupHint: "Restricted API key (read-only מומלץ)",
    capabilities: [cap("list_payments", "תשלומים", "green"), cap("list_invoices", "חשבוניות", "green"), cap("issue_refund", "החזר", "red")],
  },
  {
    provider: "crm",
    displayName: "CRM (generic)",
    category: "database",
    phase: 4,
    authKind: "api_key",
    setupHint: "REST endpoint + token; מיפוי שדות ב-config",
    capabilities: [cap("read_contacts", "אנשי קשר", "green"), cap("upsert_contact", "עדכון ליד", "yellow")],
  },
  {
    provider: "airtable",
    displayName: "Airtable",
    category: "database",
    phase: 4,
    authKind: "api_key",
    setupHint: "Personal access token + base id",
    capabilities: [cap("list_records", "רשומות", "green"), cap("create_record", "יצירת רשומה", "yellow")],
  },
  {
    provider: "supabase",
    displayName: "Supabase",
    category: "database",
    phase: 4,
    authKind: "api_key",
    setupHint: "Project URL + service role key",
    capabilities: [cap("query", "שאילתה", "green"), cap("insert", "הוספה", "yellow")],
  },
  {
    provider: "firebase",
    displayName: "Firebase",
    category: "database",
    phase: 4,
    authKind: "api_key",
    setupHint: "Service account JSON",
    capabilities: [cap("read", "קריאה", "green"), cap("write", "כתיבה", "yellow")],
  },
  {
    provider: "github",
    displayName: "GitHub",
    category: "dev",
    phase: 4,
    authKind: "oauth2",
    setupHint: "PAT או GitHub App",
    capabilities: [cap("list_issues", "Issues", "green"), cap("create_issue", "יצירת Issue", "yellow")],
  },
  {
    provider: "cloudflare",
    displayName: "Cloudflare",
    category: "dev",
    phase: 4,
    authKind: "api_key",
    setupHint: "API token",
    capabilities: [cap("list_deployments", "פריסות", "green")],
  },
  {
    provider: "render",
    displayName: "Render",
    category: "dev",
    phase: 4,
    authKind: "api_key",
    setupHint: "API key",
    capabilities: [cap("list_services", "שירותים", "green"), cap("trigger_deploy", "פריסה", "yellow")],
  },
  {
    provider: "zapier",
    displayName: "Zapier",
    category: "automation",
    phase: 4,
    authKind: "webhook",
    setupHint: "Catch Hook URL",
    capabilities: [cap("trigger_zap", "הפעלת Zap", "yellow")],
  },
  {
    provider: "custom_rest",
    displayName: "Custom REST API",
    category: "custom",
    phase: 4,
    authKind: "api_key",
    setupHint: "Base URL + auth header; הגדרת endpoints ב-config",
    capabilities: [cap("request", "קריאת API", "yellow")],
  },
];

/** A generic catalog-backed connector: knows its capabilities, reports not-connected. */
export class CatalogConnector extends BaseConnector {
  provider: string;
  displayName: string;
  category: Connector["category"];
  private spec: ProviderSpec;

  constructor(spec: ProviderSpec) {
    super();
    this.spec = spec;
    this.provider = spec.provider;
    this.displayName = spec.displayName;
    this.category = spec.category;
    this.status = "not_connected";
  }
  listCapabilities() {
    return this.spec.capabilities;
  }
  async connect() {
    return {
      fields:
        this.spec.authKind === "api_key"
          ? [{ key: "api_key", label: "API Key", secret: true }]
          : undefined,
      message: `${this.displayName}: ${this.spec.setupHint}`,
    };
  }
}

export function specFor(provider: string): ProviderSpec | undefined {
  return PROVIDER_CATALOG.find((p) => p.provider === provider);
}
