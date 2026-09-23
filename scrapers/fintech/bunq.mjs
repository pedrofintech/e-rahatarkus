// bunq (Easy Savings) - the marketing site (a Framer app) only publishes the
// bonus headline rate in server-rendered text: "Earn up to 3.01% annual
// interest". The FIRST such match on the page is what matters; further down
// the same page quotes a much higher promotional rate for an unrelated
// currency/plan combination, so this must not just grab any "up to X%" match.
// The 1.51% base rate (below the personal bonus threshold) is not published
// on this page and is tracked by hand in data/fintech-accounts.json instead.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'bunq';

export function parseRates({ html }) {
  const match = html.match(/Earn up to ([\d.,]+)%\s*annual interest/i);
  if (!match) throw new Error(`${PLATFORM}: could not find the Easy Savings headline rate`);
  const rateEur = assertPlausibleRate(PLATFORM, parseRate(match[1]));
  return { rateEur, ratesEffectiveFrom: null };
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, PLATFORM, scrape, loadFintechAccount, { key: 'platform' });
