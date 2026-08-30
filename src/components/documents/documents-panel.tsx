"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Loader2, CalendarDays, ListChecks, Banknote, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

interface Doc {
  id: string;
  title: string;
  kind: string;
  sizeBytes: number;
  status: string;
  summary: string | null;
  createdAt: string;
  analysis: {
    actionItems?: string[];
    dates?: { label: string; date: string }[];
    financials?: { label: string; amount: string }[];
    parties?: string[];
    anomalies?: string[];
  };
}

export function DocumentsPanel({ initial }: { initial: Doc[] }) {
  const router = useRouter();
  const [docs, setDocs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/documents", { method: "POST", body: fd });
      const doc = await r.json();
      setDocs((prev) => [doc, ...prev]);
      // re-fetch shortly for analysis result
      setTimeout(async () => {
        const list = await (await fetch("/api/documents")).json();
        setDocs(list);
        router.refresh();
      }, 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card
        className="flex flex-col items-center justify-center gap-2 border-dashed p-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6 text-muted-foreground" />}
        <div className="text-sm">גררי קובץ לכאן או</div>
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          בחירת קובץ
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <div className="text-xs text-muted-foreground">PDF, DOCX, XLSX, CSV, TXT, תמונות</div>
      </Card>

      <div className="grid gap-3">
        {docs.map((d) => (
          <Card key={d.id} className="p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                <span className="font-medium">{d.title}</span>
                <Badge variant="outline">{d.kind}</Badge>
                <Badge variant={d.status === "ready" ? "green" : d.status === "failed" ? "red" : "yellow"}>
                  {d.status === "ready" ? "נותח" : d.status === "processing" ? "בעיבוד" : d.status === "failed" ? "נכשל" : "הועלה"}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">{formatDateTime(d.createdAt)}</span>
            </div>

            {d.summary && <p className="mt-2 rounded bg-secondary/50 p-2 text-xs">{d.summary}</p>}

            {d.analysis && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <AnalysisList icon={ListChecks} title="משימות" items={d.analysis.actionItems} />
                <AnalysisList
                  icon={CalendarDays}
                  title="תאריכים"
                  items={d.analysis.dates?.map((x) => `${x.label}: ${x.date}`)}
                />
                <AnalysisList
                  icon={Banknote}
                  title="מידע פיננסי"
                  items={d.analysis.financials?.map((x) => `${x.label}: ${x.amount}`)}
                />
                <AnalysisList icon={Users} title="צדדים" items={d.analysis.parties} />
                {d.analysis.anomalies && d.analysis.anomalies.length > 0 && (
                  <div className="sm:col-span-2 rounded risk-yellow px-2 py-1.5 text-xs">
                    ⚠️ חריגות: {d.analysis.anomalies.join(" · ")}
                  </div>
                )}
              </div>
            )}

            {d.status === "uploaded" && d.kind !== "text" && d.kind !== "csv" && (
              <p className="mt-2 text-xs text-muted-foreground">
                חילוץ טקסט מ-{d.kind.toUpperCase()} ייכנס בשלב 2 (parser). המסמך נשמר עם metadata.
              </p>
            )}
          </Card>
        ))}
        {docs.length === 0 && <p className="text-sm text-muted-foreground">אין מסמכים עדיין.</p>}
      </div>
    </div>
  );
}

function AnalysisList({
  icon: Icon,
  title,
  items,
}: {
  icon: typeof ListChecks;
  title: string;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded border p-2">
      <div className="mb-1 flex items-center gap-1 text-xs font-medium">
        <Icon className="size-3" /> {title}
      </div>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {items.map((it, i) => (
          <li key={i}>• {it}</li>
        ))}
      </ul>
    </div>
  );
}
