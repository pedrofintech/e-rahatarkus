// Offline parser tests. These run against saved fixtures rather than the live
// bank sites, so they catch parser regressions without a network and without
// waiting on nine websites.
//
// Refresh the fixtures with `node scripts/capture-fixtures.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { SCRAPERS, slugFor } from '../scrapers/index.mjs';

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url);
const DATA = JSON.parse(readFileSync(new URL('../data/data.json', import.meta.url), 'utf8'));

/** Rebuild a scraper's inputs object from its saved fixture files. */
function loadInputs(slug) {
  const bankDir = new URL(`${slug}/`, FIXTURES_DIR);
  const inputs = {};
  for (const file of readdirSync(bankDir)) {
    if (!file.endsWith('.gz')) continue;
    inputs[file.replace(/\.gz$/, '')] = gunzipSync(readFileSync(new URL(file, bankDir))).toString('utf8');
  }
  return inputs;
}

function loadExpected(slug) {
  return JSON.parse(readFileSync(new URL(`${slug}/expected.json`, FIXTURES_DIR), 'utf8'));
}

const slugs = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test('every bank in data.json has fixtures', () => {
  for (const account of DATA.accounts) {
    assert.ok(slugs.includes(slugFor(account.bank)), `missing fixtures for ${account.bank}`);
  }
});

for (const slug of slugs) {
  test(`${slug}: parses its fixture into the expected rates`, async () => {
    const { parseRates } = await SCRAPERS[slug]();
    const actual = parseRates(loadInputs(slug));
    assert.deepEqual(actual, loadExpected(slug));
  });

  test(`${slug}: parsed output is structurally sound`, async () => {
    const { parseRates } = await SCRAPERS[slug]();
    const { tiers, minDeposit, ratesEffectiveFrom } = parseRates(loadInputs(slug));

    assert.ok(tiers.length > 0, 'expected at least one tier');

    const months = tiers.map((tier) => tier.months);
    assert.deepEqual(months, [...months].sort((a, b) => a - b), 'tiers must be sorted by term');
    assert.equal(new Set(months).size, months.length, 'tier terms must be unique');

    for (const tier of tiers) {
      assert.ok(Number.isInteger(tier.months) && tier.months >= 1, `bad term: ${tier.months}`);
      assert.equal(typeof tier.rateEur, 'number');
      assert.ok(tier.rateEur >= 0 && tier.rateEur <= 10, `implausible rate: ${tier.rateEur}`);
    }

    if (minDeposit !== undefined) {
      assert.ok(Number.isFinite(minDeposit) && minDeposit > 0, `bad minDeposit: ${minDeposit}`);
    }
    // Banks that publish no effective date report null rather than omitting it.
    assert.ok(ratesEffectiveFrom === null || /^\d{4}-\d{2}-\d{2}$/.test(ratesEffectiveFrom));
  });

  test(`${slug}: a broken page is rejected rather than parsed into nothing`, async () => {
    const { parseRates } = await SCRAPERS[slug]();
    const gutted = Object.fromEntries(
      Object.entries(loadInputs(slug)).map(([name, value]) => [
        name,
        value.replace(/<table[\s\S]*?<\/table>/gi, '').replace(/\d/g, ''),
      ]),
    );
    assert.throws(() => parseRates(gutted), /.*/, 'expected a clear error, not empty data');
  });
}
