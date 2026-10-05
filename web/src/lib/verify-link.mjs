/**
 * verify-link.mjs — the `verify-link` worker's output channel and report writer.
 *
 * Same shape as cv-envelope.mjs (#2185): the worker holds no write tool. It
 * fetches the report's posting URL, then emits ONE `<<verify-link>>` envelope
 * carrying a small JSON object; the backend parses it here, fail-closed, and
 * rewrites the report's `**Verification:**` header line itself.
 *
 * The posting is untrusted input that reaches the worker, so everything that
 * comes back through the envelope is treated as attacker-influenced: known keys
 * only, string values only, length-capped, and stripped of newlines and the
 * markdown characters (`*`, `|`, backticks, `<`, `>`) that could forge a second
 * header line or a table row once interpolated into the report.
 *
 * Tracker status is never touched. A "closed" verdict only rewrites the
 * Verification line and tells the user to review — the same "never silently
 * discard" rule AGENTS.md states for aggregator listings.
 *
 * Plain .mjs so `node --test` can import it with no build step.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { postingUrl } from "./inbox-skip.mjs";

export const VERIFY_OPEN_MARK = "<<verify-link>>";
export const VERIFY_CLOSE_MARK = "<</verify-link>>";

export const VERIFY_STATUSES = Object.freeze(["live", "closed", "unknown"]);
export const WORKPLACES = Object.freeze(["remote", "hybrid", "onsite", "unknown"]);

/** Every key the envelope may carry, with its cap after sanitizing. */
const FIELD_CAPS = Object.freeze({
  title: 160,
  company: 120,
  location: 160,
  workplace: 16,
  employment: 80,
  pay: 120,
  posted: 40,
  evidence: 200,
});
const ALLOWED_KEYS = new Set(["status", ...Object.keys(FIELD_CAPS)]);

/** Raw JSON body larger than this is refused outright rather than truncated. */
export const MAX_ENVELOPE_BODY = 8_000;

// The opener must start a line and the closer must end one, so an agent (or a
// CLI echoing the prompt, as `codex exec` does) that merely MENTIONS the markers
// mid-sentence never opens an envelope. Both one-line and multi-line forms parse.
const OPENER_LINE = /^<<verify-link>>/gm;
const ENVELOPE = /^<<verify-link>>([\s\S]*?)<<\/verify-link>>[ \t]*$/m;

/**
 * The contract as the worker is told it. Markers are described MID-LINE inside
 * backticks for the reason cv-envelope.mjs gives: a CLI echoing its prompt must
 * not produce a line-start marker.
 */
export const VERIFY_ENVELOPE_INSTRUCTION =
  `Do NOT save or edit any file — the platform records the result itself. Output your result as ONE envelope: a line that begins with \`${VERIFY_OPEN_MARK}\`, immediately followed by a single JSON object, immediately followed by \`${VERIFY_CLOSE_MARK}\` at the end of that same line. Emit it exactly once, with nothing else on that line. ` +
  `The JSON object may contain ONLY these keys: "status" (required; one of "live", "closed", "unknown"), "title", "company", "location", "workplace" (one of "remote", "hybrid", "onsite", "unknown"), "employment" (e.g. "Full-time"), "pay" (copied verbatim from the page), "posted" (the posted date as the page states it), "evidence" (a short verbatim quote from the page, at most 200 characters, supporting the status). ` +
  `Every value is a plain one-line string. Omit any key the page does not state — never guess, infer, or fill from memory or from other sites.`;

/** Strip everything that could break out of a one-line markdown header value. */
export function sanitizeValue(value, cap) {
  const cleaned = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/[*|`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= cap) return cleaned;
  return cleaned.slice(0, cap - 1).trimEnd() + "…";
}

/**
 * @typedef {Object} VerifyEnvelope
 * @property {true} ok
 * @property {"live"|"closed"|"unknown"} status
 * @property {Record<string, string>} fields - Sanitized, non-empty values only.
 */

/**
 * Parse the worker's full output. Never throws.
 *
 * @param {string} text
 * @returns {VerifyEnvelope | {ok: false, error: string}}
 */
export function parseVerifyEnvelope(text) {
  if (typeof text !== "string" || !text) {
    return { ok: false, error: "The verify worker produced no output." };
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const openers = normalized.match(OPENER_LINE) ?? [];
  if (openers.length === 0) {
    return { ok: false, error: "The verify worker emitted no <<verify-link>> envelope." };
  }
  if (openers.length > 1) {
    return { ok: false, error: `Found ${openers.length} <<verify-link>> envelopes; refusing to guess which is real.` };
  }
  const m = ENVELOPE.exec(normalized);
  if (!m) {
    return { ok: false, error: "The <<verify-link>> envelope was never closed." };
  }
  let body = m[1].trim();
  // Tolerate the agent wrapping the JSON in a code fence inside the envelope.
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (body.length > MAX_ENVELOPE_BODY) {
    return { ok: false, error: "The <<verify-link>> envelope is too large." };
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, error: "The <<verify-link>> envelope is not valid JSON." };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "The <<verify-link>> envelope must hold a JSON object." };
  }
  const unknown = Object.keys(data).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) {
    return { ok: false, error: `The <<verify-link>> envelope has unknown keys: ${unknown.slice(0, 5).map((k) => sanitizeValue(k, 30)).join(", ")}.` };
  }
  const status = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
  if (!VERIFY_STATUSES.includes(status)) {
    return { ok: false, error: "The <<verify-link>> envelope has no valid status (live, closed or unknown)." };
  }
  /** @type {Record<string, string>} */
  const fields = {};
  for (const [key, cap] of Object.entries(FIELD_CAPS)) {
    const v = data[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") {
      return { ok: false, error: `The <<verify-link>> field "${key}" must be a string.` };
    }
    const clean = sanitizeValue(v, cap);
    if (clean) fields[key] = clean;
  }
  if (fields.workplace !== undefined) {
    const w = fields.workplace.toLowerCase().replace(/[\s-]/g, "");
    fields.workplace = WORKPLACES.includes(w) ? w : "unknown";
  }
  return { ok: true, status: /** @type {"live"|"closed"|"unknown"} */ (status), fields };
}

/** `unknown`, empty and placeholder values are not page statements. */
function stated(v) {
  return typeof v === "string" && v !== "" && !/^(unknown|n\/a|none|not stated|-|—)$/i.test(v.trim());
}

const WORKPLACE_LABEL = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

/**
 * The `**Verification:**` header line for a parsed envelope.
 *
 * @param {VerifyEnvelope} env
 * @param {{date: string, url: string}} ctx - server-side values, never the worker's
 * @returns {string}
 */
export function buildVerificationLine(env, { date, url }) {
  const where = `(${url})`;
  if (env.status === "closed") {
    return `**Verification:** closed or not found at employer per Claude verify ${date} ${where}. Not auto-discarded — review and set status.`;
  }
  if (env.status !== "live") {
    return `**Verification:** unconfirmed: Claude verify ${date} could not read the posting ${where}.`;
  }
  const f = env.fields;
  const parts = [];
  if (stated(f.pay)) parts.push(`Pay ${f.pay}`);
  if (stated(f.workplace) && WORKPLACE_LABEL[f.workplace]) parts.push(WORKPLACE_LABEL[f.workplace]);
  if (stated(f.employment)) parts.push(f.employment);
  if (stated(f.posted)) parts.push(`posted ${f.posted}`);
  const states = parts.length ? ` Page states: ${parts.join("; ")}.` : "";
  return `**Verification:** live at employer per Claude verify ${date} ${where}.${states}`;
}

/** Short label for the job stream / worker card. */
export function verifyStatusLabel(env) {
  if (env.status === "live") return stated(env.fields.pay) ? `Verified: live — ${env.fields.pay}` : "Verified: live";
  if (env.status === "closed") return "Verified: closed or not found — review status";
  return "Unconfirmed: could not read the posting";
}

const URL_HEADER = /^\*\*URL:\*\*[ \t]*(.*)$/;
const PREV_URL_HEADER = /^\*\*Previous URL:\*\*/;
const VERIFICATION_HEADER = /^\*\*Verification:\*\*/;
const PREV_VERIFICATION_HEADER = /^\*\*Previous verification:\*\*/;

function splitLines(text) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const endedWithNl = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (endedWithNl && lines[lines.length - 1] === "") lines.pop();
  return { lines, join: (ls) => ls.join(nl) + (endedWithNl ? nl : "") };
}

/** The report's posting URL, validated as plain http(s); null when absent/invalid. */
export function reportPostingUrl(text) {
  if (typeof text !== "string") return null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(URL_HEADER);
    if (m) return postingUrl(m[1].trim());
  }
  return null;
}

/** Company/role from the report title `# Evaluation: Company — Role` (fallback only). */
export function reportTitleParts(text) {
  const m = typeof text === "string" ? text.match(/^#\s+(?:Evaluation:\s*)?(.+)$/m) : null;
  if (!m) return { company: "", role: "" };
  const [company, ...rest] = m[1].split(/\s+[—–-]\s+/);
  return { company: (company ?? "").trim(), role: rest.join(" — ").trim() };
}

/**
 * Replace the `**Verification:**` header line, or insert one after `**URL:**`
 * (and after a `**Previous URL:**` line directly below it). Line endings kept.
 *
 * @returns {{ok: true, text: string} | {ok: false, error: string}}
 */
export function applyVerificationLine(text, line) {
  const { lines, join } = splitLines(text);
  const existing = lines.findIndex((l) => VERIFICATION_HEADER.test(l));
  if (existing !== -1) {
    // Keep the line being replaced one level back: a hand-confirmed detail (pay
    // read off a JS-only portal, say) must not vanish because the fetched page
    // states less. Only the most recent previous line is kept.
    const old = lines[existing].replace(VERIFICATION_HEADER, "").trim();
    const prevAt = existing + 1;
    const hasPrev = prevAt < lines.length && PREV_VERIFICATION_HEADER.test(lines[prevAt]);
    lines[existing] = line;
    if (old && `**Verification:** ${old}` !== line) {
      const prev = `**Previous verification:** ${old}`;
      if (hasPrev) lines[prevAt] = prev;
      else lines.splice(prevAt, 0, prev);
    }
    return { ok: true, text: join(lines) };
  }
  const urlIdx = lines.findIndex((l) => URL_HEADER.test(l));
  if (urlIdx === -1) return { ok: false, error: "no-url-header" };
  let at = urlIdx + 1;
  while (at < lines.length && PREV_URL_HEADER.test(lines[at])) at += 1;
  lines.splice(at, 0, line);
  return { ok: true, text: join(lines) };
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Re-read the report and write the Verification line. Refuses when the report's
 * URL changed while the worker ran (a Replace link mid-run): the verdict would
 * describe a link the report no longer points at.
 *
 * @param {string} reportPath - already resolved and contained (findReportFile)
 * @param {VerifyEnvelope} env
 * @param {{date: string, url: string}} ctx - url is the one the worker was given
 * @returns {{ok: true, line: string} | {ok: false, error: string}}
 */
export function writeVerification(reportPath, env, { date, url }) {
  let md;
  try {
    md = fs.readFileSync(reportPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: false, error: "not-found" };
    throw err;
  }
  if (reportPostingUrl(md) !== url) return { ok: false, error: "url-changed" };
  const line = buildVerificationLine(env, { date, url });
  const result = applyVerificationLine(md, line);
  if (!result.ok) return result;
  atomicWrite(path.resolve(reportPath), result.text);
  return { ok: true, line };
}
