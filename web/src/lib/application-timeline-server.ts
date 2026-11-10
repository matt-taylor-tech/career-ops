import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCodeRoot, resolveRootScript } from "@/lib/core/code-root.mjs";
import { normalizeUrl } from "@/lib/core/url-key.mjs";
import { careerOpsRoot, readApplications, readApplicationStatusLog, readScanDates, reportFilesForNumber } from "@/lib/career-ops";
import { followupsLogPath } from "@/lib/followups-server";
import { parseStatusLog } from "@/lib/pipeline-sankey.mjs";
import { parsePdfManifestRows } from "@/lib/apply/cv-selection.mjs";
import { resolvePdfIndexPath } from "@/lib/core/pdf-index";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { resolveTrackerPath } from "@/lib/core/tracker-files.mjs";
import { buildApplicationTimeline, contactLinkIndex, resolveEmailApplication } from "@/lib/application-timeline.mjs";

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

/** generate-pdf.mjs's manifest, located by the core's resolvePdfIndexPath (it
 *  honours CAREER_OPS_PDF_INDEX) and parsed by the web's existing manifest
 *  parser. An older checkout without that resolver reads as "not there". */
async function readDocuments() {
  const file = await resolvePdfIndexPath();
  if (file === null) return null;
  const text = readOptional(file);
  return text === null ? null : parsePdfManifestRows(text);
}

type ReplyCandidate = { message_id?: string; from?: string; subject?: string; body_snippet?: string; date?: string };
type ReplyMatch = { message_id?: string; application_num: number | null; confidence?: string };

/** reply-watch's intake file (same path rule: CAREER_OPS_REPLY_CANDIDATES, else
 *  data/reply-candidates.json), each email paired by the core's matchCandidates
 *  — the matcher reply-watch itself uses — against the tracker rows and
 *  follow-up domains it is given. Only a single, non-low-confidence match
 *  pairs: a tie, a company-wide rejection, or a role-only hit is left out. */
async function readEmails(root: string) {
  const file = process.env.CAREER_OPS_REPLY_CANDIDATES || path.join(root, "data", "reply-candidates.json");
  const text = readOptional(file);
  if (text === null) return null;
  const candidates: unknown = JSON.parse(text);
  if (!Array.isArray(candidates)) throw new Error("expected a JSON array of emails");
  const [{ matchCandidates }, { resolveColumns, parseTrackerRow }, { parseFollowups }] = await Promise.all([
    core<{ matchCandidates: (c: ReplyCandidate[], apps: unknown[], f: unknown[]) => ReplyMatch[] }>("reply-matcher"),
    core<{ resolveColumns: (l: string[]) => unknown; parseTrackerRow: (l: string, c: unknown) => unknown }>("tracker-parse"),
    core<{ parseFollowups: (s: string) => unknown[] }>("followup-cadence"),
  ]);
  // The tracker as reply-watch loads it (resolveColumns + parseTrackerRow).
  const lines = (readOptional(resolveTrackerPath(root)) ?? "").split("\n");
  const colmap = resolveColumns(lines);
  const apps = lines.map((l) => parseTrackerRow(l, colmap)).filter(Boolean);
  const followupsText = readOptional(followupsLogPath());
  const followups = followupsText === null ? [] : parseFollowups(followupsText);
  const byId = new Map<string, ReplyMatch>();
  for (const m of matchCandidates(candidates as ReplyCandidate[], apps, followups)) if (m.message_id) byId.set(m.message_id, m);
  // Contacts the candidate linked to a row settle what the matcher left
  // unpaired (contacts.mjs parseContacts; contact-extract.mjs parseFromHeader).
  const contactsText = readOptional(path.join(root, "data", "contacts.tsv"));
  let contactIndex = new Map<string, number>();
  let senderEmail: (from: string) => string | null = () => null;
  if (contactsText !== null) {
    const [{ parseContacts }, { parseFromHeader }] = await Promise.all([
      core<{ parseContacts: (s: string) => { contacts: { email?: string | null; tracker?: string | null }[] } }>("contacts"),
      core<{ parseFromHeader: (f: string) => { email: string | null } }>("contact-extract"),
    ]);
    contactIndex = contactLinkIndex(parseContacts(contactsText).contacts);
    senderEmail = (from) => parseFromHeader(from).email;
  }
  const knownNums = new Set(readApplications().map((a) => Number(a.n)).filter(Number.isInteger));
  return (candidates as ReplyCandidate[]).map((candidate) => {
    const m = candidate.message_id ? byId.get(candidate.message_id) : undefined;
    const paired = m && m.application_num !== null && m.confidence !== "low";
    const matchedNum = resolveEmailApplication({
      matchedNum: paired ? m!.application_num : null,
      senderEmail: senderEmail(candidate.from ?? ""),
      contactIndex,
      knownNums,
    });
    return { candidate, matchedNum };
  });
}

/** The candidate's own addresses, read by the core's loadSelfIdentities from
 *  config/profile.yml (candidate.email + alternate_emails). Fails open. */
async function readSelfAddresses(root: string): Promise<string[]> {
  try {
    const { loadSelfIdentities } = await core<{ loadSelfIdentities: (p: string) => Set<string> }>("followup-cadence");
    return [...loadSelfIdentities(getProfilePath(root))];
  } catch {
    return [];
  }
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
  const [statusLog, followups, assessments, interviews, reports, firstSeen, documents, emails, selfAddresses] = await Promise.all([
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
    source(readDocuments),
    source(() => readEmails(root)),
    readSelfAddresses(root),
  ]);
  const currentStatus = readApplications().find((a) => Number.parseInt(a.n, 10) === opts.appNum)?.status ?? null;
  return buildApplicationTimeline({
    appNum: opts.appNum,
    reportNum: opts.reportNum,
    statusLog,
    followups,
    assessments,
    interviews,
    reports,
    firstSeen,
    documents,
    emails,
    selfAddresses,
    currentStatus,
  });
}
