// Offline parser tests for the fintech-platform scrapers. Mirrors
// test/flexible-parse.test.mjs; see that file for the fixture format.
// Refresh fixtures with `node scripts/capture-fintech-fixtures.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { SCRAPERS, slugFor } from '../scrapers/fintech/index.mjs';

// Deliberately NOT under test/fixtures/ - that directory is scanned by
// test/parse.test.mjs, which treats every subdirectory name as a term-deposit
// bank slug and would crash trying to load a scraper from there.
const FIXTURES_DIR = new URL('./fixtures-fintech/', import.meta.url);
const DATA = JSON.parse(readFileSync(new URL('../data/fintech-accounts.json', import.meta.url), 'utf8'));

function loadInputs(slug) {
  const dir = new URL(`${slug}/`, FIXTURES_DIR);
  const inputs = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.gz')) continue;
    inputs[file.replace(/\.gz$/, '')] = gunzipSync(readFileSync(new URL(file, dir))).toString('utf8');
  }
  return inputs;
}

function loadExpected(slug) {
  return JSON.parse(readFileSync(new URL(`${slug}/expected.json`, FIXTURES_DIR), 'utf8'));
}

const slugs = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test('every platform in fintech-accounts.json has fixtures', () => {
  for (const account of DATA.accounts) {
    assert.ok(slugs.includes(slugFor(account.platform)), `missing fixtures for ${account.platform}`);
  }
});

for (const slug of slugs) {
  test(`${slug}: parses its fixture into the expected rate`, async () => {
    const { parseRates } = await SCRAPERS[slug]();
    const actual = parseRates(loadInputs(slug));
    assert.deepEqual(actual, loadExpected(slug));
  });

  test(`${slug}: parsed output is structurally sound`, async () => {
    const { parseRates } = await SCRAPERS[slug]();
    const { rateEur, rateEurMin, tiers, ratesEffectiveFrom } = parseRates(loadInputs(slug));

    assert.equal(typeof rateEur, 'number');
    assert.ok(rateEur >= 0 && rateEur <= 10, `implausible rate: ${rateEur}`);

    if (rateEurMin !== undefined) {
      assert.ok(rateEurMin >= 0 && rateEurMin <= rateEur, `implausible rateEurMin: ${rateEurMin}`);
    }
    if (tiers !== undefined) {
      assert.ok(tiers.length > 0, 'tiers must not be empty when present');
      for (const tier of tiers) {
        assert.equal(typeof tier.plan, 'string');
        assert.ok(tier.rateEur >= 0 && tier.rateEur <= rateEur, `tier rate exceeds headline rate: ${tier.rateEur}`);
      }
    }
    // Platforms that publish no effective date report null rather than omitting it.
    assert.ok(ratesEffectiveFrom === null || /^\d{4}-\d{2}-\d{2}$/.test(ratesEffectiveFrom));
  });

  test(`${slug}: a broken page is rejected rather than parsed into nothing`, async () => {
    const { parseRates } = await SCRAPERS[slug]();
    const gutted = Object.fromEntries(
      Object.entries(loadInputs(slug)).map(([name, value]) => [
        name,
        value.replace(/<table[\s\S]*?<\/table>/gi, '').replace(/<title[^>]*>[^<]*<\/title>/gi, '').replace(/\d/g, ''),
      ]),
    );
    assert.throws(() => parseRates(gutted), /.*/, 'expected a clear error, not empty data');
  });
}
