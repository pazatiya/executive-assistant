import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { exchangeCode, storeGoogleTokens } from "@/lib/integrations/google";
import { logActivity } from "@/lib/services/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const home = `${url.origin}/integrations`;

  if (err) return NextResponse.redirect(`${home}?error=${encodeURIComponent(err)}`);
  if (!code || !state) return NextResponse.redirect(`${home}?error=missing_code`);

  let parsed: { userId: string; provider: string };
  try {
    parsed = JSON.parse(decryptSecret(state));
  } catch {
    return NextResponse.redirect(`${home}?error=bad_state`);
  }

  try {
    const tokens = await exchangeCode(code);
    // fetch the account email
    const profile = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const { email = "google account" } = (await profile.json()) as { email?: string };

    await storeGoogleTokens(parsed.userId, parsed.provider, tokens, email);
    await logActivity({
      userId: parsed.userId,
      action: `חובר ${parsed.provider}: ${email}`,
      tool: parsed.provider,
      riskLevel: "yellow",
      approvalStatus: "approved",
      approvedBy: email,
      result: "success",
      autoExecuted: false,
    });
    return NextResponse.redirect(`${home}?connected=${parsed.provider}`);
  } catch (e) {
    return NextResponse.redirect(`${home}?error=${encodeURIComponent(e instanceof Error ? e.message : "oauth_failed")}`);
  }
}
