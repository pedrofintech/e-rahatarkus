// Trade Republic - the quoted rate is literally the page's <title>, e.g.
// "Trade Republic: 2.5 % p.a. on your cash". The rest of the page is a
// client-rendered Nuxt app with no other server-side text, so the title is
// the only reliably scrapable number; the new-client promo (3.00% up to
// €50,000) is not in server-rendered markup and is tracked by hand in
// data/fintech-accounts.json instead. No rates-effective date is published.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'Trade Republic';

export function parseRates({ html }) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!titleMatch) throw new Error(`${PLATFORM}: no <title> tag found`);
  const rateMatch = titleMatch[1].match(/([\d.,]+)\s*%/);
  if (!rateMatch) throw new Error(`${PLATFORM}: page title has no rate ("${titleMatch[1]}")`);
  const rateEur = assertPlausibleRate(PLATFORM, parseRate(rateMatch[1]));
  return { rateEur, ratesEffectiveFrom: null };
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, PLATFORM, scrape, loadFintechAccount, { key: 'platform' });
