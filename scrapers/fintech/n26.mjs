// N26 (Instant Savings) - unlike the other platforms here, N26 publishes a
// genuine plan-tiered rate table in plain text: "from 11/06/2025 onwards,
// 0.30% p.a. for Standard and Smart, 0.50% p.a. for N26 Go, and 1.50% p.a.
// for Metal". rateEur is the highest tier (Metal), matching what the article
// quotes for this product; the full breakdown is kept in `tiers` so a caller
// that cares which plan applies is not stuck with just the headline number.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'N26';

export function parseRates({ html }) {
  const match = html.match(
    /from (\d{1,2})\/(\d{1,2})\/(\d{4}) onwards, ([\d.,]+)% p\.a\. for Standard and Smart, ([\d.,]+)% p\.a\. for N26 Go, and ([\d.,]+)% p\.a\. for Metal/i,
  );
  if (!match) throw new Error(`${PLATFORM}: could not find the plan-tiered Instant Savings rate table`);
  const [, day, month, year, standardSmart, go, metal] = match;

  const tiers = [
    { plan: 'Standard & Smart', rateEur: assertPlausibleRate(PLATFORM, parseRate(standardSmart)) },
    { plan: 'N26 Go', rateEur: assertPlausibleRate(PLATFORM, parseRate(go)) },
    { plan: 'Metal', rateEur: assertPlausibleRate(PLATFORM, parseRate(metal)) },
  ];

  return {
    rateEur: Math.max(...tiers.map((t) => t.rateEur)),
    tiers,
    ratesEffectiveFrom: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
  };
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, PLATFORM, scrape, loadFintechAccount, { key: 'platform' });
