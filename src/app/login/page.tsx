import { redirect } from "next/navigation";
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
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        action={signIn}
        className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-8 text-center"
      >
        <div>
          <h1 className="text-xl font-semibold">המזכירה</h1>
          <p className="mt-1 text-sm text-muted-foreground">מי נכנס/ת?</p>
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
            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
          />
        )}

        <div className="space-y-3">
          {DEV_USERS.map((u) => (
            <button
              key={u.key}
              type="submit"
              name="key"
              value={u.key}
              className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-right transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
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
