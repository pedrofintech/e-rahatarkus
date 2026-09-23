// Lets any scraper module be run on its own: `node scrapers/lhv.mjs`.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DATA_PATH = new URL('../data/data.json', import.meta.url);
const FLEXIBLE_DATA_PATH = new URL('../data/flexible-accounts.json', import.meta.url);
const FINTECH_DATA_PATH = new URL('../data/fintech-accounts.json', import.meta.url);

async function loadAccountFrom(dataPath, name, { key = 'bank' } = {}) {
  const { accounts } = JSON.parse(await readFile(dataPath, 'utf8'));
  const account = accounts.find((entry) => entry[key] === name);
  if (!account) throw new Error(`No account named "${name}" in ${dataPath.pathname.split('/').pop()}`);
  return account;
}

/** Look up one bank's stored record so scrapers always use the sourceUrl from data.json. */
export async function loadAccount(bankName) {
  return loadAccountFrom(DATA_PATH, bankName);
}

/** Same lookup, for the flexible-savings (kogumiskonto/kogumishoius) products in data/flexible-accounts.json. */
export async function loadFlexibleAccount(bankName) {
  return loadAccountFrom(FLEXIBLE_DATA_PATH, bankName);
}

/** Same lookup, for the fintech/foreign platforms in data/fintech-accounts.json (keyed by "platform", not "bank"). */
export async function loadFintechAccount(platformName) {
  return loadAccountFrom(FINTECH_DATA_PATH, platformName, { key: 'platform' });
}

/** True when `moduleUrl` is the file node was invoked with. */
export function isMain(moduleUrl) {
  return process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href;
}

/** Standard standalone entry point: scrape one bank and print the result. */
export async function runAsScript(moduleUrl, bankName, scrape, loader = loadAccount, { key = 'bank' } = {}) {
  if (!isMain(moduleUrl)) return;
  try {
    const account = await loader(bankName);
    const result = await scrape(account);
    console.log(JSON.stringify({ [key]: bankName, ...result }, null, 2));
  } catch (error) {
    console.error(`${bankName} FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
