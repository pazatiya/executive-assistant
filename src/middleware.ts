import { NextResponse, type NextRequest } from "next/server";

/**
 * Access gate. When APP_PASSWORD is set (i.e. deployed), every page and
 * data API requires a session cookie — which /login only issues after the
 * password check. Webhooks and the cron tick carry their own secrets and are
 * exempt. With no APP_PASSWORD (local dev) the gate is off.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/webhooks/",
  "/api/scheduler/tick",
  "/api/reminders/tick",
  "/_next/",
  "/favicon",
  "/sw.js",
  "/manifest.webmanifest",
  "/icon-",
  "/badge.png",
];

export function middleware(req: NextRequest) {
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (req.cookies.get("ea_session")?.value) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
