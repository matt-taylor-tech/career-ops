import path from "node:path";
import { pathToFileURL } from "node:url";
import { BASE_CV_TEMPLATE } from "../run-prompts.mjs";

/**
 * ACL for the core's CV-template resolver (cv-templates.mjs), so a dashboard pdf
 * run fills the same template the CLI fills (#4034).
 *
 * The worker cannot resolve this itself. pdf lost Bash in #2172 and must never
 * regain it, so it can neither run cv-templates.mjs nor list templates/, and the
 * prompt named the base template outright as a result. That silently overrode
 * cv.template for anyone who had set one: same report, two different CVs,
 * depending only on where the run was started.
 *
 * Resolution stays the core's. We call resolveTemplate with no `dir` override, so
 * it uses cv-templates.mjs's own default relative to the user's checkout and
 * template packs (#3202) resolve here exactly as they do on the CLI.
 * Reimplementing the lookup in the web app would be a second source of truth that
 * drifts.
 *
 * `root` is an ARGUMENT, not a value this module reaches for, for the reason
 * data-root.mjs spells out at length: `process.cwd()` is `<core>/web` here and
 * `<core>` on the CLI, so anything resolved against the cwd points one directory
 * too deep on exactly one of the two. Passing the root in also makes this testable
 * against a real checkout — `careerOpsRoot()` lives in a `@/`-aliased TS module
 * that `node --test` cannot resolve (#3879).
 *
 * CAREER_OPS_PROFILE is the case that made it matter. cv-templates.mjs resolves a
 * RELATIVE value against the cwd, so `CAREER_OPS_PROFILE=config/profile.yml` means
 * `<core>/config/profile.yml` to the CLI and `<core>/web/config/profile.yml` here
 * — the dashboard finds no profile, falls back to the base template, and the two
 * disagree with nothing reporting it. Resolving it against `root` first is the same
 * fix, and the same reasoning, as resolveDataRoot()'s `resolve(coreRoot, fromEnv)`.
 * An absolute override is returned unchanged by path.resolve, so it is unaffected.
 *
 * Never throws: a template that cannot be resolved yields the base template, and
 * the run still produces a CV. `fallback: true` already covers a name that does
 * not exist; the catch is for a checkout too old to export resolveTemplate, and
 * for a template whose placeholders fail validation.
 *
 * `codeRoot` is the engine checkout holding cv-templates.mjs and templates/.
 * It equals `root` in the default single-checkout layout and is a different
 * directory under the Custom Data Directory layout (DATA_CONTRACT.md), where
 * `root` holds user data only and has no scripts or templates at all. The
 * returned path is relative to `codeRoot`, since that is where templates live,
 * and a relative CAREER_OPS_PROFILE resolves against it too (the CLI's cwd).
 *
 * @param {string} root Absolute path to the career-ops data root (careerOpsRoot()).
 * @param {string} [codeRoot] Absolute path to the engine checkout; defaults to `root`.
 * @returns {Promise<string>} Checkout-relative template path, forward-slashed.
 */
export async function resolveCvTemplate(root, codeRoot = root) {
  const file = path.join(codeRoot, "cv-templates.mjs");
  try {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(file).href);
    if (typeof mod?.resolveTemplate !== "function") return BASE_CV_TEMPLATE;
    const profile = process.env.CAREER_OPS_PROFILE?.trim();
    const abs = mod.resolveTemplate("cv", null, {
      fallback: true,
      // undefined keeps cv-templates.mjs's own default, rather than restating it
      // here where it would drift.
      // A relative value means what it means on the CLI, whose cwd is the
      // checkout — the same base path-resolver.mjs uses for CAREER_OPS_ROOT.
      profilePath: profile ? path.resolve(codeRoot, profile) : undefined,
    });
    if (typeof abs !== "string" || !abs) return BASE_CV_TEMPLATE;
    // The prompt names a repo-relative path, and always with forward slashes:
    // path.relative gives backslashes on Windows, which is not how any of the
    // agent-facing paths in this prompt are written.
    const rel = path.relative(codeRoot, abs).split(path.sep).join("/");
    return rel || BASE_CV_TEMPLATE;
  } catch {
    return BASE_CV_TEMPLATE;
  }
}
