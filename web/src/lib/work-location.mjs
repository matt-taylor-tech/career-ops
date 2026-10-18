// Remote / local split for the pipeline views (inbox and tracker alike).
//
// "Local" is the user's commute area, taken from the place names they already
// keep in portals.yml `location_filter` (allow + always_allow), so there is one
// list to maintain. Work-arrangement and country tokens in that list ("Remote",
// "Anywhere", "United States") are not places and are dropped.
//
// Plain .mjs so `node --test` exercises the real classifier.

/** @typedef {"remote" | "local" | "other"} WorkLocation */

export const WORK_LOCATION_FILTERS = /** @type {const} */ (["all", "remote", "local"]);

const NOT_A_PLACE = /^(remote|anywhere|worldwide|global|united states|usa|us|u\.s\.?|north america)$/i;

// "Remote Sensing" / "Remote Support Engineer" name a domain, not a work arrangement.
const REMOTE_RE = /(?<![a-z])remote(?![a-z])(?!\s+(?:sensing|monitoring|support|access|desktop|diagnostics|patient)\b)|work from (?:home|anywhere)|(?<![a-z])anywhere(?![a-z])/;
// Stated outright, full remote wins over an incidental "onsite" elsewhere in
// the same sentence ("fully remote; onsite visits twice a year").
const FULL_REMOTE_RE = /(?<![a-z])(?:fully|full|100%)[\s-]+remote(?![a-z])|remote[\s-]first(?![a-z])/;
const ONSITE_RE = /(?<![a-z])(?:hybrid|on[\s-]?site|in[\s-]office|in[\s-]person)(?![a-z])/;
// One option in a list of options: "Remote or Hybrid · Johnston, IA",
// "Remote · NYC · New York City (Hybrid)", "TX - Remote", "Remote (US)".
// Prose such as "Remote with a residency requirement" is not an option list.
const OPTION_SPLIT = /\s*(?:·|\||;|\/|\bor\b)\s*/;
const REMOTE_OPTION_RE = /^(?:[a-z .,]{0,30}[-–]\s*)?remote(?:\s*(?:[-–(,:].*)?)?$/;

/**
 * Local place names from a parsed portals.yml, with the profile city as a
 * fallback when no location filter is configured.
 * @param {any} portals parsed portals.yml (or null)
 * @param {string} [profileCity] e.g. "Huntersville, NC"
 * @returns {string[]}
 */
export function localPlaces(portals, profileCity = "") {
  const lf = portals && typeof portals === "object" ? portals.location_filter : null;
  const raw = [...listOf(lf?.always_allow), ...listOf(lf?.allow)];
  const places = [];
  const seen = new Set();
  for (const entry of raw) {
    const place = entry.trim();
    const key = place.toLowerCase();
    if (!place || NOT_A_PLACE.test(place) || seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }
  if (places.length === 0 && profileCity.trim()) places.push(profileCity.split(",")[0].trim());
  return places;
}

function listOf(v) {
  if (typeof v === "string") return [v];
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile place names into one word-bounded matcher ("Davidson" must not
 * match "Davidsonville"; "Concord, NC" matches "Concord, NC 28027").
 * @param {string[]} places
 * @returns {(text: string) => boolean}
 */
export function placeMatcher(places) {
  if (places.length === 0) return () => false;
  const re = new RegExp(`(?<![a-z])(?:${places.map((p) => escapeRe(p.toLowerCase())).join("|")})(?![a-z])`);
  return (text) => re.test(text.toLowerCase());
}

/**
 * Classify one posting's location text.
 * - remote: says remote (and, unless "fully remote", not hybrid/onsite)
 * - local:  hybrid/onsite (or unstated arrangement) in a local place
 * - other:  onsite elsewhere, or nothing to go on
 * @param {string} text
 * @param {(text: string) => boolean} isLocal
 * @returns {WorkLocation}
 */
export function classifyWorkLocation(text, isLocal) {
  return locationSignal(text, isLocal) ?? "other";
}

/**
 * Like classifyWorkLocation, but null when the text says nothing about where
 * the work happens ("IT Systems Engineer"), so a caller can try another source.
 * @param {string} text
 * @param {(text: string) => boolean} isLocal
 * @returns {WorkLocation | null}
 */
function locationSignal(text, isLocal) {
  const t = String(text ?? "").replace(/[*"“”]+/g, "").toLowerCase().trim();
  if (!t) return null;
  if (FULL_REMOTE_RE.test(t)) return "remote";
  if (t.split(OPTION_SPLIT).some((part) => REMOTE_OPTION_RE.test(part.trim()))) return "remote";
  const local = isLocal(t);
  if (ONSITE_RE.test(t)) return local ? "local" : "other";
  if (REMOTE_RE.test(t)) return "remote";
  return local ? "local" : null;
}

/**
 * The report's own "| Remote | … |" row from its Role Summary table — the
 * evaluator's reading of the posting, more reliable than the tracker's role text.
 * @param {string} reportText
 * @returns {string}
 */
export function reportRemoteField(reportText) {
  const m = String(reportText ?? "").match(/^\|\s*(?:Remote(?:\s*\/\s*work mode)?|Remoto|Work mode|Work model|Location)\s*\|\s*(.*?)\s*\|\s*$/im);
  return m ? m[1] : "";
}

/**
 * Sources best first; the first one that says anything about location wins.
 * Not mixed: an incidental "remote" in the notes must not override a report
 * that says "on-site in Austin".
 * @param {string[]} sources
 * @param {(text: string) => boolean} isLocal
 * @returns {WorkLocation}
 */
export function classifyFirst(sources, isLocal) {
  for (const s of sources) {
    if (typeof s !== "string") continue;
    const signal = locationSignal(s, isLocal);
    if (signal) return signal;
  }
  return "other";
}

/**
 * @param {string | null | undefined} raw
 * @returns {(typeof WORK_LOCATION_FILTERS)[number]}
 */
export function workLocationFilter(raw) {
  const v = String(raw ?? "").toLowerCase();
  return /** @type {any} */ (WORK_LOCATION_FILTERS.includes(/** @type {any} */ (v)) ? v : "all");
}
