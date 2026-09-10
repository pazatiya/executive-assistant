"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Mail, Phone, Star, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

interface Contact {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  relationshipType: string;
  importance: string;
  communicationStyle: string;
  notes: string;
  openThreads: string[];
  tags: string[];
  lastInteractionAt: string | null;
}

const REL: Record<string, string> = {
  client: "לקוח", lead: "ליד", supplier: "ספק", partner: "שותף", family: "משפחה", professional: "איש מקצוע", other: "אחר",
};

export function ContactsPanel({ initial }: { initial: Contact[] }) {
  const router = useRouter();
  const [contacts, setContacts] = useState(initial);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", company: "", role: "", email: "", phone: "", relationshipType: "client", importance: "normal" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function importFile(file: File) {
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/contacts/import", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setImportMsg(data?.error ?? "הייבוא נכשל");
        return;
      }
      setImportMsg(`נוספו ${data.added} אנשי קשר${data.skipped ? ` · ${data.skipped} כבר קיימים` : ""}`);
      router.refresh();
    } finally {
      setImporting(false);
    }
  }

  async function create() {
    if (!form.name.trim()) return;
    const r = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const c = await r.json();
    setContacts((p) => [c, ...p]);
    setOpen(false);
    setForm({ name: "", company: "", role: "", email: "", phone: "", relationshipType: "client", importance: "normal" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setOpen((o) => !o)}>
          <Plus className="size-4" /> איש קשר חדש
        </Button>
        <Button size="sm" variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} ייבוא מהטלפון (vCard)
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".vcf,text/vcard,text/x-vcard"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        {importMsg && <span className="text-xs text-muted-foreground">{importMsg}</span>}
      </div>

      {open && (
        <Card className="grid gap-2 p-4 sm:grid-cols-2">
          <Input placeholder="שם" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="חברה" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          <Input placeholder="תפקיד" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          <Input placeholder="אימייל" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="טלפון" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <div className="flex gap-2">
            <select className="h-9 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm" value={form.relationshipType} onChange={(e) => setForm({ ...form, relationshipType: e.target.value })}>
              {Object.entries(REL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select className="h-9 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm" value={form.importance} onChange={(e) => setForm({ ...form, importance: e.target.value })}>
              <option value="low">נמוך</option>
              <option value="normal">רגיל</option>
              <option value="high">גבוה</option>
              <option value="vip">VIP</option>
            </select>
          </div>
          <Button size="sm" className="sm:col-span-2" onClick={create}>
            שמור
          </Button>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {contacts.map((c) => (
          <Card key={c.id} className="p-4 text-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5 font-semibold">
                  {c.name}
                  {c.importance === "vip" && <Star className="size-3.5 fill-warning text-warning" />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[c.role, c.company].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Badge variant={c.relationshipType === "lead" ? "primary" : "default"}>{REL[c.relationshipType]}</Badge>
            </div>

            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {c.email && (
                <div className="flex items-center gap-1.5">
                  <Mail className="size-3" /> {c.email}
                </div>
              )}
              {c.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone className="size-3" /> {c.phone}
                </div>
              )}
            </div>

            {c.communicationStyle && <p className="mt-2 text-xs">סגנון: {c.communicationStyle}</p>}
            {c.notes && <p className="mt-1 text-xs text-muted-foreground">{c.notes}</p>}
            {c.openThreads?.length > 0 && (
              <div className="mt-2 rounded bg-secondary/50 p-1.5 text-xs">
                נושאים פתוחים: {c.openThreads.join(" · ")}
              </div>
            )}
            {c.lastInteractionAt && (
              <div className="mt-2 text-[11px] text-muted-foreground">אינטראקציה אחרונה: {timeAgo(c.lastInteractionAt)}</div>
            )}
          </Card>
        ))}
        {contacts.length === 0 && <p className="text-sm text-muted-foreground">אין אנשי קשר.</p>}
      </div>
    </div>
  );
}
