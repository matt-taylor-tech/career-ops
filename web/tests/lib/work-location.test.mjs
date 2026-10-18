// Remote / local classifier behind the pipeline's location filter.
//
// Run:  node --test tests/lib/work-location.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFirst,
  classifyWorkLocation,
  localPlaces,
  placeMatcher,
  reportRemoteField,
  workLocationFilter,
} from "../../src/lib/work-location.mjs";

const portals = {
  location_filter: {
    always_allow: ["Huntersville", "Charlotte", "Davidson"],
    allow: ["Remote", "Anywhere", "Charlotte", "Cornelius", "Concord, NC", "United States"],
    block: ["India"],
  },
};
const isLocal = placeMatcher(localPlaces(portals));

test("localPlaces keeps place names and drops arrangement and country tokens", () => {
  assert.deepEqual(localPlaces(portals), ["Huntersville", "Charlotte", "Davidson", "Cornelius", "Concord, NC"]);
});

test("localPlaces falls back to the profile city without a location filter", () => {
  assert.deepEqual(localPlaces(null, "Huntersville, NC"), ["Huntersville"]);
  assert.deepEqual(localPlaces({}, ""), []);
});

test("scanner location strings", () => {
  assert.equal(classifyWorkLocation("Remote · United States", isLocal), "remote");
  assert.equal(classifyWorkLocation("Charlotte, NC", isLocal), "local");
  assert.equal(classifyWorkLocation("Charlotte, NC · Hybrid", isLocal), "local");
  assert.equal(classifyWorkLocation("Austin, TX", isLocal), "other");
  assert.equal(classifyWorkLocation("", isLocal), "other");
  // remote is one of the listed options
  assert.equal(classifyWorkLocation("Remote or Hybrid · Johnston, IA, USA · Spokane, WA, USA", isLocal), "remote");
  assert.equal(classifyWorkLocation("Remote · NYC · United States · New York City (Hybrid)", isLocal), "remote");
  assert.equal(classifyWorkLocation("TX - Remote", isLocal), "remote");
  assert.equal(classifyWorkLocation("RALEIGH, NC · IRVING, TX · CHARLOTTE, NC", isLocal), "local");
});

test("newer reports: the Remote / work mode row", () => {
  const md = "| Remote / work mode | Hybrid; Raleigh NC, Irving TX, or Charlotte NC; \"Telecommuting is not an option\" |\n";
  assert.equal(classifyWorkLocation(reportRemoteField(md), isLocal), "local");
});

test("report Remote rows", () => {
  assert.equal(classifyWorkLocation("Full remote, United States", isLocal), "remote");
  assert.equal(classifyWorkLocation("Hybrid, Huntersville, NC: 4 days onsite (may move to 3)", isLocal), "local");
  assert.equal(classifyWorkLocation("On site, Concord, NC (\"Systems Administrator - Onsite\")", isLocal), "local");
  assert.equal(classifyWorkLocation("On-site/hybrid at 300 S Tryon St, Charlotte (also listed London)", isLocal), "local");
  assert.equal(classifyWorkLocation("Not stated. Location is the Valerie C. Woodard Center, Charlotte.", isLocal), "local");
  assert.equal(classifyWorkLocation("Fully remote, United States (location field: \"Remote, North Carolina, United States\")", isLocal), "remote");
  assert.equal(classifyWorkLocation("Remote (location field: Atlanta, GA 30339, Remote)", isLocal), "remote");
  // remote in name only: residency plus onsite duties elsewhere
  assert.equal(classifyWorkLocation("Remote with a residency requirement: must live in Hampton Roads, VA; onsite support in Newport News", isLocal), "other");
  assert.equal(classifyWorkLocation("**Remote** per location field", isLocal), "remote");
});

test("role text fallbacks", () => {
  assert.equal(classifyWorkLocation("Senior System Engineer, Cornelius NC", isLocal), "local");
  assert.equal(classifyWorkLocation("Microsoft Platform Engineer, Remote", isLocal), "remote");
  assert.equal(classifyWorkLocation("Remote Sensing Program Manager", isLocal), "other");
  assert.equal(classifyWorkLocation("Senior Microsoft Platform Engineer, Dallas TX", isLocal), "other");
});

test("place matching is word-bounded", () => {
  assert.equal(isLocal("davidsonville, md"), false);
  assert.equal(isLocal("concord, nc 28027"), true);
  assert.equal(isLocal("concord, ma"), false);
});

test("classifyFirst takes the first source with a location signal", () => {
  assert.equal(classifyFirst(["Hybrid, 3 days onsite, Charlotte, NC", "", "IT Engineer, Remote"], isLocal), "local");
  assert.equal(classifyFirst(["", "—", "IT Engineer, Remote"], isLocal), "remote");
  // a role with no location falls through to the notes
  assert.equal(classifyFirst(["", "", "Senior Lead Systems Operations Engineer", "Hands-on IC role, Charlotte hybrid option"], isLocal), "local");
  // a definite "elsewhere" stops the search: notes cannot override it
  assert.equal(classifyFirst(["On-site in Austin, TX", "", "Engineer", "could ask about remote"], isLocal), "other");
  assert.equal(classifyFirst(["", ""], isLocal), "other");
});

test("reportRemoteField reads the Role Summary row", () => {
  const md = "| Field | Value |\n|---|---|\n| Seniority | Senior IC |\n| Remote | Full remote (location field \"Remote\") |\n| Team size | 4 |\n";
  assert.equal(reportRemoteField(md), "Full remote (location field \"Remote\")");
  assert.equal(reportRemoteField("no table here"), "");
});

test("workLocationFilter defaults to all", () => {
  assert.equal(workLocationFilter("remote"), "remote");
  assert.equal(workLocationFilter("LOCAL"), "local");
  assert.equal(workLocationFilter("elsewhere"), "all");
  assert.equal(workLocationFilter(null), "all");
});
