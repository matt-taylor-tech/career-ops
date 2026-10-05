/**
 * Map posting URLs → the evaluation report that scored them, read from the
 * reports themselves. The inbox used to know a row was scored only from the
 * browser's job history (capped at 40 entries), so older scores vanished from
 * the inbox while their reports were intact.
 *
 * A report claims a URL through its header lines only: `**URL:**`,
 * `**Previous URL:**` (written by Replace link) and a `Source` / `Source listing`
 * line, optionally block-quoted (the aggregator copy an evaluation started from).
 */
import fs from "node:fs";
import path from "node:path";
import { postingUrl } from "./inbox-skip.mjs";

const HEADER_LINES = 40;
const CLAIM_LINE = /^(?:>\s*)?(?:\*\*URL:\*\*|\*\*Previous URL:\*\*|\**Source(?: listing)?:?\**)/i;
const URL_IN_LINE = /https?:\/\/[^\s)<>|"']+/g;
const SCORE = /^\*\*Score:\*\*\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*5/m;
const REPORT_FILE = /^(\d+)-.+\.md$/;

/** Posting URLs a report's header claims, validated as plain http(s). */
export function reportPostingUrls(text) {
  const urls = new Set();
  if (typeof text !== "string") return urls;
  for (const line of text.split(/\r?\n/).slice(0, HEADER_LINES)) {
    if (!CLAIM_LINE.test(line.trim())) continue;
    for (const raw of line.match(URL_IN_LINE) ?? []) {
      const u = postingUrl(raw.replace(/[.,;:]+$/, ""));
      if (u) urls.add(u);
    }
  }
  return urls;
}

/** The report's `**Score:**` value, or null when absent / not numeric. */
export function reportScore(text) {
  const m = typeof text === "string" ? text.match(SCORE) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Build url → { n, score } over every report in `reportsDir`. When two reports
 * claim the same URL, the higher report number (the newer evaluation) wins.
 *
 * @returns {Map<string, { n: string, score: number | null }>}
 */
export function buildReportUrlIndex(reportsDir) {
  const index = new Map();
  let files;
  try {
    files = fs.readdirSync(reportsDir);
  } catch {
    return index;
  }
  for (const f of files) {
    const m = f.match(REPORT_FILE);
    if (!m || /RESERVED/i.test(f)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(reportsDir, f), "utf8");
    } catch {
      continue;
    }
    const entry = { n: String(parseInt(m[1], 10)), score: reportScore(text) };
    for (const url of reportPostingUrls(text)) {
      const ex = index.get(url);
      if (!ex || parseInt(ex.n, 10) < parseInt(entry.n, 10)) index.set(url, entry);
    }
  }
  return index;
}

const DECIDED = new Set(["skip", "discarded", "rejected", "applied", "responded", "interview", "offer", "hired"]);

/**
 * Has the user already acted on this tracker status? Everything past
 * "Evaluated" means the posting is decided and no longer needs triage.
 * Unknown/blank statuses count as undecided, so nothing is hidden by accident.
 */
export function isDecidedStatus(status) {
  return DECIDED.has(String(status ?? "").replace(/\*/g, "").trim().toLowerCase());
}
