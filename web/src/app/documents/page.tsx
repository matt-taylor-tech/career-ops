"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText, File, Calendar, FolderOpen, Loader2, Search } from "lucide-react";

type DocumentItem = {
  id: string;
  filename: string;
  folder: string | null;
  kind: "cv" | "cover" | "unknown";
  date: string | null;
  reportId: string | null;
  format: string | null;
  mtimeMs: number;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/documents")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load documents");
        return res.json();
      })
      .then((data) => {
        setDocuments(data);
        setError(null);
      })
      .catch((err) => {
        setError(err.message || "Something went wrong");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-full bg-red-500/10 p-3 text-red-500">
          <File className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-medium text-foreground">Failed to load</h2>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-full bg-surface-hover p-3 text-muted">
          <FileText className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-medium text-foreground">No documents found</h2>
        <p className="mt-1 text-sm text-muted">
          Generated CVs and cover letters will appear here.
        </p>
      </div>
    );
  }

  // One group per job folder ("{Company} - {Role}"); flat files in output/
  // each form their own group, titled by filename.
  const groups = new Map<string, DocumentItem[]>();
  for (const doc of documents) {
    const key = doc.folder ?? doc.filename;
    const list = groups.get(key) ?? [];
    list.push(doc);
    groups.set(key, list);
  }
  const q = query.trim().toLowerCase();
  const shown = [...groups.entries()]
    .filter(([title]) => !q || title.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Math.max(...b[1].map((d) => d.mtimeMs)) - Math.max(...a[1].map((d) => d.mtimeMs)),
    );

  const open = (doc: DocumentItem) => window.open(`/api/documents?id=${doc.id}`, "_blank");
  const label = (doc: DocumentItem) =>
    doc.kind === "cv" ? "CV" : doc.kind === "cover" ? "Cover Letter" : "Document";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Documents
        </h1>
        <p className="mt-1 text-sm text-muted">
          Your CVs and cover letters, one card per job.
        </p>
      </div>

      <div className="flex max-w-md items-center gap-2 rounded-full border border-border bg-surface/70 px-4 py-1.5 shadow-sm focus-within:border-brand/50">
        <Search className="size-4 shrink-0 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company or role…"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-faint"
        />
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-muted">No documents match "{query}".</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(([title, docs]) => {
          const [company, ...rest] = title.split(" - ");
          const role = rest.join(" - ");
          const sorted = [...docs].sort((a, b) => (a.kind === "cv" ? -1 : b.kind === "cv" ? 1 : 0));
          const date = docs.map((d) => d.date).filter(Boolean).sort().pop();
          return (
            <Card key={title} className="flex flex-col justify-between p-4">
              <div className="flex items-start space-x-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand/10 text-brand-text">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium text-foreground" title={title}>
                    {role ? company : title}
                  </h3>
                  {role && <p className="text-sm text-muted">{role}</p>}
                  {date && (
                    <Badge tone="muted" className="mt-2 flex w-fit items-center gap-1 font-normal">
                      <Calendar className="h-3 w-3" />
                      {date}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                {sorted.map((doc) => (
                  <Button
                    key={doc.id}
                    variant="outline"
                    className="flex-1 justify-between"
                    onClick={() => open(doc)}
                    title={doc.filename}
                  >
                    {doc.kind === "cv" ? <FileText className="h-4 w-4" /> : <File className="h-4 w-4" />}
                    {label(doc)}
                    <ExternalLink className="h-4 w-4 text-muted" />
                  </Button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
