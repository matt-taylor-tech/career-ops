import { ChevronDown, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { KIND_LABELS } from "@/lib/application-timeline.mjs";
import type { ApplicationTimeline as Timeline } from "@/lib/application-timeline-server";

// One application's history, oldest first. Read-only: every line comes from a
// file the core already writes (status log, follow-up log, assessment log,
// interview log, reports, scan history), so nothing here can drift from the CLI.

// One hue per event kind so the column reads at a glance. Badge's tones are a
// grade scale (good/warn/bad), so kinds get their own categorical palette that
// stays clear of green/amber/red (grades) and orange (active/selected).
const KIND_CLASSES: Record<string, string> = {
  scan: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  report: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  status: "bg-teal-500/15 text-teal-800 dark:text-teal-300",
  assessment: "bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-300",
  interview: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
  followup: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  document: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-300",
  email: "bg-pink-500/15 text-pink-800 dark:text-pink-300",
  // Not an event but a gap in the record: neutral, outlined.
  marker: "bg-transparent text-muted ring-1 ring-inset ring-border",
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
            Nothing recorded for this application yet. Reports, generated resumes and cover letters, status changes, interview rounds, emails, logged follow-ups and assessments appear here as they happen.
          </p>
        ) : (
          <ol className="space-y-3">
            {events.map((e, i) => (
              <li key={i} className="grid grid-cols-[6.5rem_1fr] gap-x-3 text-sm max-sm:grid-cols-1">
                <span className="pt-0.5 font-mono text-xs tabular-nums text-faint">{e.day ?? "undated"}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={KIND_CLASSES[e.kind]}>{KIND_LABELS[e.kind as keyof typeof KIND_LABELS] ?? e.kind}</Badge>
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
