// Revolut (Instant Access Savings) - the EUR rate depends on your plan tier
// and Revolut states it as a range rather than a table: "Get from 2% to 2.5%
// (AER) variable interest on your money." rateEur is the upper end of that
// range (the best obtainable rate, matching the article's headline number);
// the range itself is preserved so the plan-dependence is not lost. The page
// blocks plain fetch() with an HTTP 403, so this needs a rendered browser.

import { renderHtml } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'Revolut';

export function parseRates({ html }) {
  const text = toText(html);
  const match = text.match(/Get from ([\d.,]+)% to ([\d.,]+)% \(AER\) variable interest/i);
  if (!match) throw new Error(`${PLATFORM}: could not find the Instant Access Savings EUR rate range`);
  const rateMin = assertPlausibleRate(PLATFORM, parseRate(match[1]));
  const rateMax = assertPlausibleRate(PLATFORM, parseRate(match[2]));
  return { rateEur: rateMax, rateEurMin: rateMin, ratesEffectiveFrom: null };
}

export async function fetchInputs(account) {
  return { html: await renderHtml(account.sourceUrl, { timeoutMs: 45000 }) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, PLATFORM, scrape, loadFintechAccount, { key: 'platform' });
