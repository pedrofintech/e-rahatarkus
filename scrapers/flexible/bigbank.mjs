// Bigbank Säästuhoius - flexible savings account: variable rate, no term,
// withdraw any time. Lives on the same page as the fixed-rate Tähtajaline
// hoius (see ../bigbank.mjs), so this reads the Säästuhoius hero stat block
// instead of the term-deposit table.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, findEffectiveDate, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFlexibleAccount } from '../../lib/cli.mjs';

const BANK = 'Bigbank';

export function parseRates({ html }) {
  const text = toText(html);

  // "Aastane intress 2,20%" - the FIRST occurrence on the page is always the
  // Säästuhoius hero stat. Later occurrences belong to the page's own
  // cross-bank comparison table (which quotes every competitor's rate too,
  // Coop Pank's 2% among them) and must not be picked up instead.
  const rateMatch = text.match(/Aastane intress\s*([\d,]+)\s*%/i);
  if (!rateMatch) throw new Error(`${BANK}: could not find the "Aastane intress" rate on the Säästuhoius page`);
  const rateEur = assertPlausibleRate(BANK, parseRate(rateMatch[1]));

  const minMatch = text.match(/Minimaalne hoiusumma\s*([\d\s]+)\s*€/i);

  const result = {
    rateEur,
    // "Muutuv intress Viimati muudetud 18.05.2026" sits right next to the
    // Säästuhoius stat block; the term deposit's own "Fikseeritud intress
    // Viimati muudetud ..." line further up carries a different date.
    ratesEffectiveFrom: findEffectiveDate(html, /Muutuv intress\s*Viimati muudetud \d{1,2}\.\d{1,2}\.\d{4}/i),
  };
  if (minMatch) result.minDeposit = Number(minMatch[1].replace(/\s/g, ''));
  return result;
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape, loadFlexibleAccount);
