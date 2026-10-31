import { resolveRootScript } from "./core/code-root.mjs";

/** Longest JD text handed to a worker; a real posting is a few thousand characters. */
export const MAX_POSTING_CHARS = 60_000;

/**
 * Fetch a posting's JD text through the core's `fetch-jd.mjs`, which reads it
 * straight from a known ATS API (Greenhouse, Lever, Ashby, Workday, …).
 *
 * The evaluation worker has no Bash (#2172), so it cannot run the script itself,
 * and WebFetch gets only an empty shell from ATS pages that render the job
 * client-side (Ashby, branded Workday fronts). Fetching here and handing the text
 * to the prompt is what lets those postings be evaluated at all.
 *
 * Best-effort: any failure (unsupported URL, network error, timeout) resolves to
 * null and the worker falls back to WebFetch, exactly as before.
 *
 * @param {{execFileFn: Function, execPath: string, coreRoot: string, cwd: string, url: string, timeoutMs?: number}} args
 * @returns {Promise<string | null>}
 */
export function fetchPostingText({ execFileFn, execPath, coreRoot, cwd, url, timeoutMs = 30_000 }) {
  if (!/^https?:\/\//i.test(String(url ?? ""))) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      execFileFn(
        execPath,
        [resolveRootScript(coreRoot, "fetch-jd"), url],
        { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          const text = err ? "" : String(stdout ?? "").trim();
          resolve(text ? text.slice(0, MAX_POSTING_CHARS) : null);
        },
      );
    } catch {
      resolve(null);
    }
  });
}
