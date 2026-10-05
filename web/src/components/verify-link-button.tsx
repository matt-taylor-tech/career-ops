"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { cn } from "@/lib/cn";

/** Fired by ReplaceLinkButton after a report's link is replaced. */
export const LINK_REPLACED_EVENT = "co-link-replaced";

// Runs the `verify-link` worker (read-only, fetches the report's own URL) and lets
// the backend rewrite the report's **Verification:** line. The client sends only
// the report number; the URL is read server-side. Never changes tracker status.
export function VerifyLinkButton({ n, company }: { n: string; company: string }) {
  const router = useRouter();
  const { jobs, startJob } = useJobs();
  const [highlight, setHighlight] = useState(false);
  const job = useMemo(
    () => jobs.filter((j) => j.kind === "verify-link" && j.input === n).sort((a, b) => b.startedAt - a.startedAt)[0],
    [jobs, n],
  );

  // A fresh link deserves a fresh check: offer it prominently after Replace link.
  useEffect(() => {
    const onReplaced = (e: Event) => {
      const detail = (e as CustomEvent<{ report?: string }>).detail;
      if (detail?.report === n) setHighlight(true);
    };
    const onDone = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: string; input?: string }>).detail;
      if (detail?.kind === "verify-link" && detail.input === n) router.refresh();
    };
    window.addEventListener(LINK_REPLACED_EVENT, onReplaced);
    window.addEventListener("co-job-done", onDone);
    return () => {
      window.removeEventListener(LINK_REPLACED_EVENT, onReplaced);
      window.removeEventListener("co-job-done", onDone);
    };
  }, [n, router]);

  const verify = () => {
    setHighlight(false);
    startJob({ title: `Verify ${company}`, subtitle: "is the posting still live?", kind: "verify-link", input: n, page: `/pipeline/${n}` });
  };

  if (job?.status === "running") {
    return (
      <Link
        href={`/jobs/${job.id}`}
        className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand max-sm:min-h-[44px]"
      >
        <Loader2 className="size-4 animate-spin" /> Verifying…
      </Link>
    );
  }

  const last = job?.steps[job.steps.length - 1]?.label;
  const outcome =
    job?.status === "done" ? job.result?.summary : job?.status === "error" ? last : undefined;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={verify}
        title="Ask your AI CLI to fetch the posting link and record whether it is live"
        className={cn(
          "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px]",
          highlight
            ? "border border-brand/50 bg-brand-soft text-brand hover:bg-brand-soft/70"
            : "text-muted hover:bg-surface-hover hover:text-brand",
        )}
      >
        <ShieldCheck className="size-4" />
        <span>{highlight ? "Link saved — verify with Claude" : "Verify with Claude"}</span>
      </button>
      {outcome && job && (
        <Link
          href={`/jobs/${job.id}`}
          className={cn(
            "text-[11px] hover:underline",
            job.status === "error" ? "text-red-500" : job.result?.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "text-muted",
          )}
        >
          {outcome}
        </Link>
      )}
    </span>
  );
}
