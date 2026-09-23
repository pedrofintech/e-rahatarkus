// Trading 212 - the interest-on-cash page blocks plain fetch() with an HTTP
// 403 (basic bot filtering), so this needs a real rendered browser. The rate
// is shown as a per-currency hero strip ("EUR 2.5 % USD 3.4 % GBP 3.55 % ..."),
// repeated a few times on the page; the first EUR figure is used. No
// rates-effective date is published on this page.

import { renderHtml } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'Trading 212';

export function parseRates({ html }) {
  const text = toText(html);
  const rateMatch = text.match(/EUR\s*([\d.,]+)\s*%/);
  if (!rateMatch) throw new Error(`${PLATFORM}: could not find the EUR interest rate`);
  const rateEur = assertPlausibleRate(PLATFORM, parseRate(rateMatch[1]));
  return { rateEur, ratesEffectiveFrom: null };
}

export async function fetchInputs(account) {
  return { html: await renderHtml(account.sourceUrl, { timeoutMs: 45000 }) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, PLATFORM, scrape, loadFintechAccount, { key: 'platform' });
