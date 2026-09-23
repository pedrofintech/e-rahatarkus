// Wise (Interest) - the Estonia-locale interest page quotes the EUR rate net
// of Wise's own annual fee: "2.02% on EUR After 0.26% annual fee", and dates
// it separately: "The rate was last updated 05/08/2026" (DD/MM/YYYY, unlike
// the DD.MM.YYYY the Estonian bank pages use).

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'Wise';

export function parseRates({ html }) {
  const text = toText(html);
  const rateMatch = text.match(/([\d.,]+)%\s*on EUR After ([\d.,]+)%\s*annual fee/i);
  if (!rateMatch) throw new Error(`${PLATFORM}: could not find the EUR interest rate`);
  const rateEur = assertPlausibleRate(PLATFORM, parseRate(rateMatch[1]));

  const dateMatch = text.match(/rate was last updated (\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  const ratesEffectiveFrom = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`
    : null;

  return { rateEur, ratesEffectiveFrom };
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, PLATFORM, scrape, loadFintechAccount, { key: 'platform' });
