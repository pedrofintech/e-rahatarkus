// Refreshes the offline test fixtures for the flexible-savings scrapers from
// the live bank sites. Mirrors scripts/capture-fixtures.mjs.
//
//   node scripts/capture-flexible-fixtures.mjs            # every bank
//   node scripts/capture-flexible-fixtures.mjs seb lhv
//
// Refreshing fixtures is a deliberate act: review the expected.json diff. A
// change there means either the bank moved its rate or a parser changed
// behaviour, and those need telling apart by eye.

import { gzipSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { SCRAPERS, slugFor } from '../scrapers/flexible/index.mjs';

const DATA_PATH = new URL('../data/flexible-accounts.json', import.meta.url);
// Deliberately NOT under test/fixtures/ - see test/flexible-parse.test.mjs.
const FIXTURES_DIR = new URL('../test/fixtures-flexible/', import.meta.url);

const requested = process.argv.slice(2);
const { accounts } = JSON.parse(await readFile(DATA_PATH, 'utf8'));

for (const account of accounts) {
  const slug = slugFor(account.bank);
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

    console.log(`${account.bank} ${account.product}: saved ${saved.join(', ')} -> ${expected.rateEur}%`);
  } catch (error) {
    console.log(`${account.bank} ${account.product}: FAILED - ${error.message}`);
    process.exitCode = 1;
  }
}
