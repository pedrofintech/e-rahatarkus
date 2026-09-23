// Refreshes the offline test fixtures from the live bank sites.
//
//   node scripts/capture-fixtures.mjs            # every bank
//   node scripts/capture-fixtures.mjs seb coop-pank
//
// For each bank this stores the raw inputs its parser consumes (gzipped, since
// some of these pages are over a megabyte) plus an expected.json snapshot of
// what the parser currently makes of them.
//
// Refreshing fixtures is a deliberate act: review the expected.json diff. A
// change there means either the bank moved its rates or a parser changed
// behaviour, and those need telling apart by eye.

import { gzipSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { SCRAPERS, slugFor } from '../scrapers/index.mjs';

// Returned by fetchInputs but not consumed by parseRates, so not fixture material.
const METADATA_FIELDS = new Set(['method']);

const DATA_PATH = new URL('../data/data.json', import.meta.url);
const FIXTURES_DIR = new URL('../test/fixtures/', import.meta.url);

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

    // Only the string inputs are fixture material; anything else (such as the
    // detected scrape method) is fetch-time metadata, not parser input.
    const saved = [];
    for (const [name, value] of Object.entries(inputs)) {
      if (typeof value !== 'string' || METADATA_FIELDS.has(name)) continue;
      await writeFile(new URL(`${name}.gz`, bankDir), gzipSync(value));
      saved.push(`${name} (${(value.length / 1024).toFixed(0)}kB)`);
    }

    const expected = parseRates(inputs);
    await writeFile(new URL('expected.json', bankDir), `${JSON.stringify(expected, null, 2)}\n`);

    console.log(`${account.bank}: saved ${saved.join(', ')} -> ${expected.tiers.length} tiers`);
  } catch (error) {
    console.log(`${account.bank}: FAILED - ${error.message}`);
    process.exitCode = 1;
  }
}
