// Offline parser tests for the flexible-savings (kogumiskonto/kogumishoius)
// scrapers. Mirrors test/parse.test.mjs; see that file for the fixture
// format. Refresh fixtures with `node scripts/capture-flexible-fixtures.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { SCRAPERS, slugFor } from '../scrapers/flexible/index.mjs';

// Deliberately NOT under test/fixtures/ - that directory is scanned by
// test/parse.test.mjs, which treats every subdirectory name as a term-deposit
// bank slug and would crash trying to load a "flexible" scraper from there.
const FIXTURES_DIR = new URL('./fixtures-flexible/', import.meta.url);
const DATA = JSON.parse(readFileSync(new URL('../data/flexible-accounts.json', import.meta.url), 'utf8'));

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

test('every bank in flexible-accounts.json has fixtures', () => {
  for (const account of DATA.accounts) {
    assert.ok(slugs.includes(slugFor(account.bank)), `missing fixtures for ${account.bank}`);
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
    const { rateEur, minDeposit, ratesEffectiveFrom } = parseRates(loadInputs(slug));

    assert.equal(typeof rateEur, 'number');
    assert.ok(rateEur >= 0 && rateEur <= 10, `implausible rate: ${rateEur}`);

    if (minDeposit !== undefined) {
      assert.ok(Number.isFinite(minDeposit) && minDeposit >= 0, `bad minDeposit: ${minDeposit}`);
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
