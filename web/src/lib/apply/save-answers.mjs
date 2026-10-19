/**
 * save-answers.mjs — keep the apply flow's answers on disk (Matt's fork).
 *
 * Pre-fill answers used to live only in the browser tab and the server's
 * in-memory apply session, so closing the tab or restarting the server lost
 * them. This writes them next to the tailored CV, in the per-job folder
 * (`output/{Company} - {Role}/application_answers.md`, see modes/_custom.md):
 * once as the AI draft after pre-fill, then again with the reviewed answers
 * when the form is filled.
 *
 * A file the flow did not write (a hand-written answers file from a chat
 * session) is never overwritten: the flow writes `application_answers.web.md`
 * beside it instead. Plain .mjs so tests can import it directly under Node.
 */
import fs from "node:fs";
import path from "node:path";

export const ANSWERS_MARKER = "<!-- career-ops web apply flow: rewritten on each pre-fill and fill -->";
export const ANSWERS_FILE = "application_answers.md";
export const ANSWERS_FALLBACK_FILE = "application_answers.web.md";

/**
 * @typedef {{ id: string, label?: string, type?: string, required?: boolean }} AnswerField
 */

/**
 * Answers arrive as strings (fill) or planner JSON `{ value, needs_confirmation }`
 * (pre-fill), which is untyped at the call site, so any value is accepted.
 * @typedef {unknown} AnswerValue
 */

/**
 * @param {{ title?: string, url?: string, stage: "prefill" | "filled", date: string,
 *   fields: AnswerField[], answers: Record<string, AnswerValue> }} opts
 * @returns {string}
 */
export function formatAnswersMarkdown({ title, url, stage, date, fields, answers }) {
  const status =
    stage === "filled"
      ? `Filled into the form on ${date} with the answers as reviewed. Not submitted by career-ops.`
      : `AI pre-fill draft from ${date}, not yet reviewed. Filling the form replaces this with the reviewed answers.`;
  const lines = [ANSWERS_MARKER, `# ${title || "Application"}: application answers`, ""];
  if (url) lines.push(`Source: ${url}`);
  lines.push(status, "");
  fields.forEach((f, i) => {
    const raw = /** @type {{ value?: unknown, needs_confirmation?: unknown } | string | undefined} */ (answers[f.id]);
    const obj = typeof raw === "object" && raw !== null ? raw : null;
    const value = String((obj ? obj.value : raw) ?? "").trim();
    const flagged = obj?.needs_confirmation === true;
    const label = String(f.label ?? "").replace(/\s+/g, " ").trim() || f.id;
    lines.push(`## ${i + 1}. ${label}`, "");
    const notes = [f.required ? "required" : "", flagged ? "needs your confirmation" : ""].filter(Boolean);
    if (notes.length) lines.push(`(${notes.join("; ")})`, "");
    lines.push(value || "_(blank)_", "");
  });
  return lines.join("\n");
}

/**
 * Write the answers into the job folder that holds the tailored CV. Skips when
 * there is no CV, or when the CV sits directly in output/ (the legacy flat
 * layout has no per-job folder to put answers in).
 *
 * @param {{ root: string, cvPath?: string | null, title?: string, url?: string,
 *   stage: "prefill" | "filled", date?: string, fields: AnswerField[],
 *   answers: Record<string, AnswerValue> }} opts
 * @returns {{ path: string } | { skipped: string }}
 */
export function saveApplicationAnswers({ root, cvPath, date, ...rest }) {
  if (!cvPath) return { skipped: "no tailored CV found, so there is no job folder to save answers in" };
  const outputDir = path.resolve(root, "output");
  const dir = path.dirname(path.resolve(root, cvPath));
  if (path.dirname(dir) !== outputDir) return { skipped: "the tailored CV is not in a per-job output folder" };
  if (!rest.fields?.length) return { skipped: "the form has no fields" };
  const primary = path.join(dir, ANSWERS_FILE);
  let target = primary;
  try {
    if (!fs.readFileSync(primary, "utf8").startsWith(ANSWERS_MARKER)) target = path.join(dir, ANSWERS_FALLBACK_FILE);
  } catch {
    /* no file yet: write the primary name */
  }
  const md = formatAnswersMarkdown({ ...rest, date: date ?? new Date().toISOString().slice(0, 10) });
  fs.writeFileSync(target, md);
  return { path: path.relative(root, target) };
}
