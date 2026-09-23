// Refreshes the offline test fixtures for the fintech scrapers from the live
// platform sites. Mirrors scripts/capture-flexible-fixtures.mjs.
//
//   node scripts/capture-fintech-fixtures.mjs            # every platform
//   node scripts/capture-fintech-fixtures.mjs wise n26
//
// Refreshing fixtures is a deliberate act: review the expected.json diff. A
// change there means either the platform moved its rate or a parser changed
// behaviour, and those need telling apart by eye.

import { gzipSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { SCRAPERS, slugFor } from '../scrapers/fintech/index.mjs';

const DATA_PATH = new URL('../data/fintech-accounts.json', import.meta.url);
// Deliberately NOT under test/fixtures/ - see test/fintech-parse.test.mjs.
const FIXTURES_DIR = new URL('../test/fixtures-fintech/', import.meta.url);

const requested = process.argv.slice(2);
const { accounts } = JSON.parse(await readFile(DATA_PATH, 'utf8'));

for (const account of accounts) {
  const slug = slugFor(account.platform);
  if (requested.length > 0 && !requested.includes(slug)) continue;

  const bankDir = new URL(`${slug}/`, FIXTURES_DIR);
  await mkdir(bankDir, { recursive: true });

  try {
    const { fetchInputs, parseRates } = await SCRAPERS[slug]();
    const inputs = await fetchInputs(account);

    const saved = [];
    for (const [name, value] of Object.entries(inputs)) {
      if (typeof value !== 'string') continue;
      await writeFile(new URL(`${name}.gz`, bankDir), gzipSync(value));
      saved.push(`${name} (${(value.length / 1024).toFixed(0)}kB)`);
    }

    const expected = parseRates(inputs);
    await writeFile(new URL('expected.json', bankDir), `${JSON.stringify(expected, null, 2)}\n`);

    console.log(`${account.platform} ${account.product}: saved ${saved.join(', ')} -> ${expected.rateEur}%`);
  } catch (error) {
    console.log(`${account.platform} ${account.product}: FAILED - ${error.message}`);
    process.exitCode = 1;
  }
}
