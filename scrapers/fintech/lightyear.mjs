// Lightyear (Kasvufond / Savings Vaults) - the EUR vault's yield is the
// default-selected tab on the Savings Vaults page: "2.39 % APY Euros Dollars
// Pounds". Anchoring on the word "Euros" right after the number is what
// guarantees this is the EUR figure and not the USD/GBP tabs next to it.
// No rates-effective date is published; the 1-day yield changes with the ECB
// rate and Lightyear does not date-stamp it.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'Lightyear';

export function parseRates({ html }) {
  const text = toText(html);
  const rateMatch = text.match(/([\d.,]+)\s*%\s*APY\s*Euros/i);
  if (!rateMatch) throw new Error(`${PLATFORM}: could not find the EUR vault's APY`);
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
