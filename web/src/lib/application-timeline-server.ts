import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCodeRoot, resolveRootScript } from "@/lib/core/code-root.mjs";
import { normalizeUrl } from "@/lib/core/url-key.mjs";
import { careerOpsRoot, readApplications, readApplicationStatusLog, readScanDates, reportFilesForNumber } from "@/lib/career-ops";
import { followupsLogPath } from "@/lib/followups-server";
import { parseStatusLog } from "@/lib/pipeline-sankey.mjs";
import { buildApplicationTimeline } from "@/lib/application-timeline.mjs";

// Reads the files the timeline merges. Parsing is the core's wherever the core
// has a parser (follow-ups, assessments): this module only finds the files and
// hands their text over, so the web and the CLI cannot disagree about a row.
// Every source distinguishes "not there" (null, omitted) from "there but
// unreadable" ({ error }, shown as a warning) — web/AGENTS.md.

type Source<T> = T | { error: string } | null;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function source<T>(read: () => T | null | Promise<T | null>): Promise<Source<T>> {
  try {
    return await read();
  } catch (err) {
    return { error: message(err) };
  }
}

/** File text, null when absent. Any other failure throws. */
function readOptional(file: string): string | null {
  try {
    return fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** A root engine module, loaded at runtime from the checkout (same pattern as apply/session.ts). */
async function core<T>(name: string): Promise<T> {
  const file = resolveRootScript(resolveCodeRoot(process.cwd(), process.env), name);
  return import(/* webpackIgnore: true */ pathToFileURL(file).href) as Promise<T>;
}

type FollowupEntry = { appNum: number; date: string; channel: string; contact: string; notes: string };
type AssessmentRow = { reportNum: string | null; date: string; platform: string; subject: string; kind: string };
type InterviewRow = Record<string, string>;
type TrackerEntry = { num: number; company: string; role: string };
type InterviewMatch = { entry: TrackerEntry | null };

/** data/active-interviews.md, or the root-level file older installs kept —
 *  the same fallback the core readers (rejection-latency, close-stale) use. */
function activeInterviewsPath(root: string): string {
  const inData = path.join(root, "data", "active-interviews.md");
  return fs.existsSync(/* turbopackIgnore: true */ inData) ? inData : path.join(root, "active-interviews.md");
}

/** Every interview round, each tagged with the tracker # the core's matcher
 *  paired it to (null when it could not pair it confidently). Matching runs
 *  against the whole tracker, as tracker-sync-check does, so a fuzzy match is
 *  only taken when it is unambiguous across all rows. */
async function readInterviewRounds(root: string) {
  const text = readOptional(activeInterviewsPath(root));
  if (text === null) return null;
  const [{ parseActiveInterviews }, { matchInterviewRow }] = await Promise.all([
    core<{ parseActiveInterviews: (s: string) => InterviewRow[] }>("process-quality"),
    core<{ matchInterviewRow: (row: InterviewRow, entries: TrackerEntry[]) => InterviewMatch }>("tracker-sync-check"),
  ]);
  const entries: TrackerEntry[] = readApplications()
    .map((a) => ({ num: Number.parseInt(a.n, 10), company: a.company, role: a.role }))
    .filter((e) => Number.isInteger(e.num));
  return parseActiveInterviews(text).map((row) => ({ row, matchedNum: matchInterviewRow(row, entries).entry?.num ?? null }));
}

function firstSeenFor(url: string | null | undefined): string | null {
  if (!url) return null;
  const dates = readScanDates();
  const exact = dates.get(url);
  if (exact) return exact;
  const key = normalizeUrl(url);
  if (!key) return null;
  for (const [seen, day] of dates) if (normalizeUrl(seen) === key) return day;
  return null;
}

export type ApplicationTimeline = ReturnType<typeof buildApplicationTimeline>;

export async function readApplicationTimeline(opts: {
  appNum: number;
  reportNum: number | null;
  postingUrl?: string | null;
}): Promise<ApplicationTimeline> {
  const root = careerOpsRoot();
  const [statusLog, followups, assessments, interviews, reports, firstSeen] = await Promise.all([
    source(() => {
      const text = readApplicationStatusLog();
      return text === null ? null : parseStatusLog(text);
    }),
    source(async () => {
      const text = readOptional(followupsLogPath());
      if (text === null) return null;
      const { parseFollowups } = await core<{ parseFollowups: (s: string) => FollowupEntry[] }>("followup-cadence");
      return parseFollowups(text);
    }),
    source(async () => {
      const text = readOptional(path.join(root, "data", "assessments.tsv"));
      if (text === null) return null;
      const { parseAssessments } = await core<{ parseAssessments: (s: string) => { rows: AssessmentRow[] } }>("assessment-log");
      return parseAssessments(text).rows;
    }),
    source(() => readInterviewRounds(root)),
    // The report number, not the row number: they usually match, but when they
    // don't, the row number names some other row's report.
    source(() => reportFilesForNumber(opts.reportNum ?? opts.appNum)),
    source(() => firstSeenFor(opts.postingUrl)),
  ]);
  return buildApplicationTimeline({
    appNum: opts.appNum,
    reportNum: opts.reportNum,
    statusLog,
    followups,
    assessments,
    interviews,
    reports,
    firstSeen,
  });
}
