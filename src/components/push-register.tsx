"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return buf;
}

type State = "unsupported" | "off" | "on" | "denied" | "working";

/**
 * Push opt-in. Sits in the top bar. First tap asks the OS for permission and
 * registers the service worker + subscription. Silent when already on.
 */
export function PushRegister() {
  const [state, setState] = useState<State>("working");

  const sync = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") return setState("denied");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    sync();
  }, [sync]);

  async function enable() {
    setState("working");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const res = await fetch("/api/push");
      const { key } = (await res.json()) as { key: string | null };
      if (!key) return setState("off");

      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        }));

      await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setState("on");
    } catch {
      setState("off");
    }
  }

  if (state === "unsupported" || state === "on") return null;

  const label =
    state === "denied" ? "התראות חסומות" : state === "working" ? "…" : "הפעל התראות";
  const Icon = state === "denied" ? BellOff : state === "working" ? BellRing : Bell;

  return (
    <button
      type="button"
      onClick={state === "denied" ? undefined : enable}
      disabled={state === "denied" || state === "working"}
      title={state === "denied" ? "אפשרי התראות בהגדרות הדפדפן" : "קבל תזכורות והתראות גם כשהאפליקציה סגורה"}
      className="hidden h-10 items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 text-xs font-semibold text-primary transition-all hover:bg-primary/10 disabled:opacity-60 xl:flex"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
