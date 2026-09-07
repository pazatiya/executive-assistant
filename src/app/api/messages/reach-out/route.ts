import { apiContext, bad, ok, readJson } from "@/lib/api";
import { reachOutToCustomer } from "@/lib/services/messages";
import { resolveWhatsAppTarget } from "@/lib/integrations/whatsapp-context";

export const dynamic = "force-dynamic";

/**
 * Owner hands a customer to the assistant: the customer wrote to a private
 * line, the owner drops the number here, and the bot opens a WhatsApp thread
 * from the business number.
 */
export async function POST(req: Request) {
  const { user } = await apiContext(req);
  const body = await readJson<{ phone?: string; context?: string; name?: string }>(req);
  const phone = (body.phone ?? "").trim();
  if (!phone) return bad("חסר מספר טלפון");

  const target = await resolveWhatsAppTarget();
  const r = await reachOutToCustomer({
    userId: user.id,
    workspaceId: target?.workspaceId ?? null,
    phone,
    context: body.context ?? "",
    customerName: body.name?.trim() || undefined,
  });
  if (!r.ok) return bad(r.error ?? "שליחה נכשלה");
  return ok({ messageId: r.messageId, via: r.via });
}
