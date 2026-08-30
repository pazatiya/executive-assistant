import { NextResponse } from "next/server";
import { apiContext } from "@/lib/api";
import { buildAuthUrl, googleConfigured } from "@/lib/integrations/google";
import { encryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user } = await apiContext();
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "gmail";

  if (!googleConfigured()) {
    return NextResponse.redirect(`${url.origin}/integrations?error=google_not_configured`);
  }

  // signed state carries user + provider through the round trip
  const state = encryptSecret(JSON.stringify({ userId: user.id, provider, t: Date.now() }));
  return NextResponse.redirect(buildAuthUrl(provider, state));
}
