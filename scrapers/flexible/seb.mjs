// SEB Digikassa - flexible savings account: variable rate, no term. SEB calls
// this product family "Kogumishoius" on its rates page (the same page the
// term-deposit scraper reads, see ../seb.mjs) and Digikassa is its digital
// self-service variant, sharing the one published rate. No rates-effective
// date or minimum deposit is published for this product.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFlexibleAccount } from '../../lib/cli.mjs';

const BANK = 'SEB';

export function parseRates({ html }) {
  const text = toText(html);
  // "Kogumishoius (k.a Digikassa) ... Intressimäär on aastas 1.65%"
  const rateMatch = text.match(/Kogumishoius[^%]*?Intressim..r on aastas\s*([\d.,]+)\s*%/i);
  if (!rateMatch) throw new Error(`${BANK}: could not find the Kogumishoius (Digikassa) interest rate`);
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
