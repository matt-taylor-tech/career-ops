/**
 * "Not interested" list for postings hidden from Today / Explore.
 *
 * Postings on those pages come from scan history or live discovery, and many
 * are not rows in data/pipeline.md, so the inbox Skip (a pipeline checkbox) has
 * nowhere to record them. This is a small append-only user-layer file:
 *
 *   data/dismissed-postings.tsv   url \t date \t company \t title
 *
 * The URL is a matcher, never a path; postingUrl() refuses anything that is not
 * a plain http(s) URL, and free-text cells are stripped of tabs/newlines so a
 * title can never forge a second row.
 */
import fs from "node:fs";
import path from "node:path";
import { postingUrl } from "./inbox-skip.mjs";

export const DISMISSED_FILE = path.join("data", "dismissed-postings.tsv");
const HEADER = "url\tdate\tcompany\ttitle";
const MAX_TEXT = 200;

function cellText(v) {
  return String(v ?? "").replace(/[\t\r\n\u2028\u2029]+/g, " ").trim().slice(0, MAX_TEXT);
}

/** Parse the file's text into the set of dismissed posting URLs. */
export function parseDismissed(text) {
  const urls = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const url = postingUrl(line.split("\t")[0]);
    if (url) urls.add(url);
  }
  return urls;
}

/** Dismissed URLs for a career-ops root (empty when the file does not exist). */
export function readDismissed(root) {
  try {
    return parseDismissed(fs.readFileSync(path.join(root, DISMISSED_FILE), "utf8"));
  } catch {
    return new Set();
  }
}

/**
 * Record a posting as dismissed. Idempotent: an already-dismissed URL is not
 * appended twice.
 *
 * @returns {{ ok: true, added: boolean } | { ok: false, error: "invalid-url" }}
 */
export function dismissPosting(root, { url, company, title }, today) {
  const u = postingUrl(url);
  if (!u) return { ok: false, error: "invalid-url" };
  const file = path.join(root, DISMISSED_FILE);
  if (readDismissed(root).has(u)) return { ok: true, added: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const needsHeader = !fs.existsSync(file) || fs.statSync(file).size === 0;
  const row = [u, cellText(today), cellText(company), cellText(title)].join("\t");
  fs.appendFileSync(file, (needsHeader ? HEADER + "\n" : "") + row + "\n", "utf8");
  return { ok: true, added: true };
}
