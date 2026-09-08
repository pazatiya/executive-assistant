import { apiContext } from "@/lib/api";
import { fetchInboundMediaBytes } from "@/lib/integrations/meta-whatsapp";

export const dynamic = "force-dynamic";

/**
 * Streams an inbound WhatsApp photo (owner or customer) to the app's UI.
 *
 * Meta media ids aren't URLs — they're only downloadable with our own access
 * token, which the browser doesn't have. This proxies that download behind
 * our own auth (apiContext throws for a logged-out request), so <img> tags
 * in the app can just point here directly.
 */
export async function GET(req: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  await apiContext(req); // logged-in owners only — throws/redirects otherwise
  const { mediaId } = await params;
  const dl = await fetchInboundMediaBytes(mediaId);
  if (!dl.ok) return new Response(dl.error, { status: 502 });
  return new Response(dl.bytes, {
    headers: {
      "content-type": dl.mimeType,
      // Meta's own download link is short-lived, but the media id → bytes are
      // stable — safe to let the browser cache this for a while.
      "cache-control": "private, max-age=86400",
    },
  });
}
