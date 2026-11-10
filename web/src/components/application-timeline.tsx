import { ChevronDown, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { KIND_LABELS } from "@/lib/application-timeline.mjs";
import type { ApplicationTimeline as Timeline } from "@/lib/application-timeline-server";

// One application's history, oldest first. Read-only: every line comes from a
// file the core already writes (status log, follow-up log, assessment log,
// reports, scan history), so nothing here can drift from the CLI.

const TONES: Record<string, "good" | "warn" | "bad" | "info" | "muted"> = {
  scan: "muted",
  report: "info",
  status: "good",
  assessment: "warn",
  followup: "info",
};

export function ApplicationTimeline({ timeline }: { timeline: Timeline }) {
  const { events, warnings, empty } = timeline;
  return (
    <details open className="group mt-6 overflow-hidden rounded-2xl border border-border bg-surface/30">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-5 py-3 transition-colors hover:bg-surface-hover">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Timeline</span>
        {!empty && <span className="text-xs text-muted">{events.length} {events.length === 1 ? "event" : "events"}</span>}
        <ChevronDown className="ml-auto size-4 shrink-0 text-faint transition-transform group-open:rotate-180 print:hidden" />
      </summary>
      <div className="border-t border-border px-5 py-4">
        {warnings.map((w) => (
          <p key={w} className="mb-3 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
          </p>
        ))}
        {empty ? (
          <p className="text-sm text-muted">
            Nothing recorded for this application yet. Status changes, logged follow-ups, assessments and reports appear here as they happen.
          </p>
        ) : (
          <ol className="space-y-3">
            {events.map((e, i) => (
              <li key={i} className="grid grid-cols-[6.5rem_1fr] gap-x-3 text-sm max-sm:grid-cols-1">
                <span className="pt-0.5 font-mono text-xs tabular-nums text-faint">{e.day ?? "undated"}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONES[e.kind] ?? "muted"}>{KIND_LABELS[e.kind as keyof typeof KIND_LABELS] ?? e.kind}</Badge>
                    <span className="font-medium text-foreground">{e.title}</span>
                    {e.meta && <span className="truncate font-mono text-[11px] text-faint">{e.meta}</span>}
                  </div>
                  {e.detail && <p className="mt-1 break-words text-xs leading-relaxed text-muted">{e.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
