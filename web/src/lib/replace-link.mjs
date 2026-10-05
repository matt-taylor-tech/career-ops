/**
 * Replace a posting's link with the employer's own (canonical) URL.
 *
 * Two targets, both plain text edits with no LLM involved:
 * - inbox: the job-URL cell of a `data/pipeline.md` checkbox row
 * - report: the `**URL:**` header line of `reports/{n}-*.md`, keeping the old
 *   value on a `**Previous URL:**` line so the aggregator source is not lost
 *
 * Both URLs are matchers/values, never filesystem paths; postingUrl() refuses
 * anything that is not a plain http(s) URL.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { postingUrl, jobUrlFromRest } from "./inbox-skip.mjs";

const CHECKBOX_LINE = /^(\s*-\s*\[[ xX]\])(\s*)(.*)$/;
const URL_HEADER = /^\*\*URL:\*\*[ \t]*(.*)$/;

function splitLines(text) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const endedWithNl = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (endedWithNl && lines[lines.length - 1] === "") lines.pop();
  return { lines, join: (ls) => ls.join(nl) + (endedWithNl ? nl : "") };
}

/**
 * Swap the job URL on every pipeline row whose URL equals `oldUrl`.
 * Company, role and the other cells stay byte-identical.
 *
 * @returns {{ ok: true, text: string, changed: number } | { ok: false, error: string }}
 */
export function applyInboxReplace(text, oldUrl, newUrl) {
  const from = postingUrl(oldUrl);
  const to = postingUrl(newUrl);
  if (!from || !to) return { ok: false, error: "invalid-url" };
  if (from === to) return { ok: false, error: "same-url" };

  const { lines, join } = splitLines(text);
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CHECKBOX_LINE);
    if (!m) continue;
    const jobUrl = jobUrlFromRest(m[3]);
    if (jobUrl === to) return { ok: false, error: "duplicate" };
    if (jobUrl !== from) continue;
    const at = m[3].indexOf(from);
    lines[i] = `${m[1]}${m[2]}${m[3].slice(0, at)}${to}${m[3].slice(at + from.length)}`;
    changed += 1;
  }
  if (changed === 0) return { ok: false, error: "unmatched" };
  return { ok: true, text: join(lines), changed };
}

/**
 * Point a report's `**URL:**` header at `newUrl`, recording the old value
 * on a `**Previous URL:**` line directly below it.
 *
 * @param {string} today YYYY-MM-DD, stamped on the Previous URL line
 * @returns {{ ok: true, text: string, previous: string } | { ok: false, error: string }}
 */
export function applyReportReplace(text, newUrl, today) {
  const to = postingUrl(newUrl);
  if (!to) return { ok: false, error: "invalid-url" };

  const { lines, join } = splitLines(text);
  const idx = lines.findIndex((l) => URL_HEADER.test(l));
  if (idx === -1) return { ok: false, error: "no-url-header" };
  const previous = lines[idx].match(URL_HEADER)[1].trim();
  if (previous === to) return { ok: false, error: "same-url" };

  lines[idx] = `**URL:** ${to}`;
  if (previous) lines.splice(idx + 1, 0, `**Previous URL:** ${previous} (replaced ${today})`);
  return { ok: true, text: join(lines), previous };
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

/** Read-modify-write pipeline.md under the core pipeline lock. */
export async function replaceInboxLink(pipelinePath, oldUrl, newUrl, options = {}) {
  const run = () => {
    let md;
    try {
      md = fs.readFileSync(pipelinePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return { ok: false, error: "not-found" };
      throw err;
    }
    const result = applyInboxReplace(md, oldUrl, newUrl);
    if (result.ok) atomicWrite(pipelinePath, result.text);
    return result;
  };
  if (!options.lockModule) return run();
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(options.lockModule).href);
  try {
    return await mod.withPipelineLock(pipelinePath, run, {
      timeoutMs: options.timeoutMs ?? 5_000,
      retryMs: 50,
    });
  } catch (err) {
    if (err && err.name === "LockTimeoutError") return { ok: false, error: "busy" };
    throw err;
  }
}

/** Rewrite one report file in place. `reportPath` must already be resolved and contained. */
export function replaceReportLink(reportPath, newUrl, today) {
  let md;
  try {
    md = fs.readFileSync(reportPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: false, error: "not-found" };
    throw err;
  }
  const result = applyReportReplace(md, newUrl, today);
  if (result.ok) atomicWrite(path.resolve(reportPath), result.text);
  return result;
}
