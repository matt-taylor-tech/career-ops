/**
 * pdf-paths.mjs — deterministic scratch + final paths for a web "pdf" run (#2172).
 *
 * Plain .mjs (same pattern as clean-chips.mjs / tracker-table.mjs) so this can
 * be unit-tested with `node --test`, no TypeScript build step. `careerOpsRoot`
 * and `findReportFile` are passed in rather than imported from career-ops.ts,
 * keeping this module free of TypeScript dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

/**
 * Lowercase, non-alphanumeric runs -> single hyphen, trimmed.
 * @param {string} s
 * @returns {string}
 */
export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * @typedef {Object} PdfPaths
 * @property {string} reportNum - Canonical report number, used for filenames and the PDF manifest.
 * @property {string} reportFile - Resolved report path relative to the data root, used by the tailoring prompt.
 * @property {string} html - Where the backend writes the tailored HTML it parsed out of the agent's envelope (#2185).
 * @property {string} finalPdf - Where the backend renders the final PDF (output/cv-{candidate}-{report}-{company}-{date}.pdf).
 */

/**
 * Precompute the scratch HTML and final PDF paths for a
 * "pdf" run, so the agent never chooses its own filenames — the backend owns
 * naming, writing (#2185) and rendering. Resolves the report for its identity
 * and company slug, and config/profile.yml for the candidate slug. Including
 * the report number keeps same-company CVs generated on one day separate.
 *
 * Framework-agnostic: returns a result instead of constructing a Response, so
 * the caller (a Next.js route today) decides how to surface `ok: false`.
 *
 * Side effect: creates `.career-ops-web/pdf-tmp/` under `root` if it doesn't
 * exist yet (the backend writes the parsed envelope there, #2185) — this is
 * NOT a pure path computation, despite the name.
 *
 * @param {string} input - The application/report selector (e.g. "018").
 * @param {string} today - YYYY-MM-DD.
 * @param {string} root - careerOpsRoot().
 * @param {(input: string) => string | null} findReportFile - career-ops.ts's findReportFile.
 * @returns {{ok: true, paths: PdfPaths} | {ok: false, error: string}}
 */
export function resolvePdfPaths(input, today, root, findReportFile) {
  // Reject anything but a bare report number before it ever reaches a path.
  // findReportFile()'s parseInt-based matching can still resolve a crafted
  // selector like "123/../../etc/passwd" to a legitimate report file, but the
  // selector must never become a path segment unless it is purely numeric.
  if (!/^\d+$/.test(input)) {
    return { ok: false, error: `Invalid report selector: "${input}"` };
  }
  const reportFile = findReportFile(input);
  if (!reportFile) {
    return { ok: false, error: `No report #${input} found — evaluate this posting first.` };
  }
  const reportName = path.basename(reportFile);
  // A tracker application can point to a differently numbered report. Use
  // that resolved report's number, not the selector, for the file and manifest.
  // Normalize padding without converting to Number, which can lose digits.
  const reportNum = (reportName.match(/^(\d+)-/)?.[1] ?? input)
    .replace(/^0+(?=\d)/, "")
    .padStart(3, "0");
  const companyMatch = reportName.match(/^\d+-(.+)-\d{4}-\d{2}-\d{2}\.md$/);
  const companySlug = companyMatch ? companyMatch[1] : "company";
  let candidateSlug = "candidate";
  let candidateName = "";
  let perJobFolders = false;
  try {
    // js-yaml v4's load() uses the safe default schema (no arbitrary type
    // construction, unlike Python's PyYAML) — same pattern already used in
    // web/src/app/api/profile/route.ts and portals/route.ts.
    const profile = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
    if (profile?.candidate?.full_name) {
      candidateName = String(profile.candidate.full_name);
      candidateSlug = slugify(candidateName);
    }
    perJobFolders = profile?.cv?.per_job_folders === true;
  } catch (err) {
    // A missing profile.yml is expected (not every checkout has one yet) and
    // falls back silently. Anything else — a real YAML syntax error in the
    // user's own file — should not fail silently forever; it would otherwise
    // produce a wrong-but-plausible-looking filename with zero signal.
    if (err?.code !== "ENOENT") {
      console.warn(`resolvePdfPaths: could not read/parse config/profile.yml, defaulting candidate slug: ${err.message}`);
    }
  }
  const scratchDir = path.join(root, ".career-ops-web", "pdf-tmp");
  fs.mkdirSync(scratchDir, { recursive: true });
  return {
    ok: true,
    paths: {
      reportNum,
      reportFile: path.relative(root, reportFile).split(path.sep).join("/"),
      html: path.join(scratchDir, `cv-web-${reportNum}.html`),
      finalPdf:
        (perJobFolders && perJobFolderPdf(root, reportFile, reportNum, candidateName)) ||
        path.join(root, "output", `cv-${candidateSlug}-${reportNum}-${companySlug}-${today}.pdf`),
    },
  };
}

/**
 * Opt-in per-job folder layout (`cv.per_job_folders: true` in config/profile.yml):
 * output/{Company} - {Role}/cv_{first_last}.pdf. Company and role come from the
 * report's "# Evaluation: {Company} — {Role}" heading. When that folder already
 * holds a PDF indexed to a DIFFERENT report (the same title applied to twice),
 * " (#NNN)" is appended so an earlier submitted CV is never overwritten.
 * Returns null when the heading can't be read, so the caller falls back to the
 * flat default name.
 *
 * @param {string} root
 * @param {string} reportFile
 * @param {string} reportNum
 * @param {string} candidateName
 * @returns {string | null}
 */
export function perJobFolderPdf(root, reportFile, reportNum, candidateName) {
  let heading = "";
  try {
    heading = fs.readFileSync(reportFile, "utf8").split(/\r?\n/, 1)[0] ?? "";
  } catch {
    return null;
  }
  const m = heading.match(/^#\s*Evaluation:\s*(.+?)\s+[—–]\s+(.+?)\s*$/);
  if (!m) return null;
  const clean = (/** @type {string} */ t) => t.replace(/[\/\\:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  const company = clean(m[1]);
  const role = clean(m[2]);
  if (!company || !role) return null;
  const nameSlug = candidateName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "candidate";
  const outputDir = path.join(root, "output");
  let folder = `${company} - ${role}`;
  if (folderBelongsToOtherReport(root, folder, reportNum)) folder += ` (#${reportNum})`;
  const dir = path.join(outputDir, folder);
  // Containment: the cleaned name has no separators, but never trust that alone.
  if (path.dirname(dir) !== outputDir) return null;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `cv_${nameSlug}.pdf`);
}

/** True when data/pdf-index.tsv lists a PDF in output/{folder}/ for another report. */
function folderBelongsToOtherReport(root, folder, reportNum) {
  let tsv = "";
  try {
    tsv = fs.readFileSync(path.join(root, "data", "pdf-index.tsv"), "utf8");
  } catch {
    return false;
  }
  const prefix = `output/${folder}/`;
  return tsv.split(/\r?\n/).some((line) => {
    if (!line || line.startsWith("#")) return false;
    const [rep, pdf] = line.split("\t");
    return Boolean(pdf?.startsWith(prefix)) && /^\d+$/.test(rep ?? "") && Number(rep) !== Number(reportNum);
  });
}
