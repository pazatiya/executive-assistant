import { redirect } from "next/navigation";
import Image from "next/image";
import { DEV_USERS } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Sign-in: pick who you are. When APP_PASSWORD is set (deployed), a shared
 * password is required too.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const needsPassword = Boolean(env.appPassword);

  async function signIn(formData: FormData) {
    "use server";
    const key = String(formData.get("key") ?? "");
    const password = String(formData.get("password") ?? "");
    const next = String(formData.get("next") ?? "") || "/dashboard";
    if (env.appPassword && password !== env.appPassword) {
      redirect(`/login?error=1${next ? `&next=${encodeURIComponent(next)}` : ""}`);
    }
    const { signInAs } = await import("@/lib/auth");
    await signInAs(key);
    redirect(next.startsWith("/") ? next : "/dashboard");
  }

  return (
    <main className="app-canvas soft-grid flex min-h-screen items-center justify-center p-5 sm:p-6">
      <form
        action={signIn}
        className="w-full max-w-sm space-y-6 rounded-[1.5rem] border bg-card/95 p-6 text-center shadow-2xl shadow-slate-900/10 backdrop-blur sm:p-8"
      >
        <div>
          <div className="relative mx-auto mb-1 h-28 w-32">
            <div className="absolute inset-x-5 bottom-2 h-7 rounded-full bg-primary/15 blur-xl" />
            <Image
              src="/visuals/ai-secretary-mascot.webp"
              alt="המזכירה — דמות AI לא אנושית"
              width={1214}
              height={1295}
              priority
              className="relative h-full w-full object-contain drop-shadow-xl"
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">ברוכים הבאים למזכירה</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">בחרו משתמש כדי להיכנס לסביבת העבודה</p>
        </div>

        {sp.error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">סיסמה שגויה</p>
        )}

        <input type="hidden" name="next" value={sp.next ?? ""} />

        {needsPassword && (
          <input
            name="password"
            type="password"
            required
            placeholder="סיסמת גישה"
            className="h-11 w-full rounded-xl border bg-background px-3.5 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        )}

        <div className="space-y-3">
          {DEV_USERS.map((u) => (
            <button
              key={u.key}
              type="submit"
              name="key"
              value={u.key}
              className="flex min-h-[58px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-right transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/[0.035] hover:shadow-md"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                {u.fullName.slice(0, 1)}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{u.fullName}</span>
                <span className="block text-xs text-muted-foreground">{u.email}</span>
              </span>
            </button>
          ))}
        </div>
      </form>
    </main>
  );
}
