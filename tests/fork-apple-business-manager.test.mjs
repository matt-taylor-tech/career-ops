// tests/fork-apple-business-manager.test.mjs — fork guard (2026-11-02).
// IT reports write "ABM" for Apple Business Manager. A CV that spells it out
// must collapse to the same display name, or upskill logs a false ABM gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSkills } from '../skill-extract.mjs';

test('Apple Business Manager in a CV cancels a report\'s bare ABM', () => {
  const known = extractSkills('Federated Apple Business Manager with Entra ID.');
  const reportGap = extractSkills('Apple experience is ABM plus Meraki Systems Manager');
  assert.ok(known.has('ABM'));
  assert.ok(reportGap.has('ABM'));
});
