// Coop Pank Rahasahtel - flexible savings account: variable rate, no term,
// free withdrawal to the next banking day (a fee applies for instant payout,
// per the price list). The product page renders no <table> for the rate; it
// is a plain hero stat instead. No minimum deposit or rates-effective date is
// published for this product.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFlexibleAccount } from '../../lib/cli.mjs';

const BANK = 'Coop Pank';

export function parseRates({ html }) {
  const text = toText(html);
  // "Ava Rahasahtel Intress 2,0%" - the CTA button label anchors this to the
  // Rahasahtel stat specifically, not any other Coop Pank product on the page.
  const rateMatch = text.match(/Ava Rahasahtel\s*Intress\s*([\d,]+)\s*%/i);
  if (!rateMatch) throw new Error(`${BANK}: could not find the Rahasahtel interest rate`);
  const rateEur = assertPlausibleRate(BANK, parseRate(rateMatch[1]));
  return { rateEur, ratesEffectiveFrom: null };
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape, loadFlexibleAccount);
