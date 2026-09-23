// LHV Kogumiskonto - flexible savings account: variable rate, no term,
// withdraw any time for free. The page carries a small dedicated rate table
// under its "Hinnakiri" tab: | Kehtiv intressimäär (EUR) | 1,75% |.
// LHV publishes no rates-effective date or minimum deposit for this product.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, extractTables, findTable, parseRate } from '../../lib/parse.mjs';
import { runAsScript, loadFlexibleAccount } from '../../lib/cli.mjs';

const BANK = 'LHV';

export function parseRates({ html }) {
  const table = findTable(extractTables(html), /Kehtiv intressim..r/i);
  if (!table) throw new Error(`${BANK}: no "Kehtiv intressimäär" table found on the Kogumiskonto page`);
  const row = table.rows.find((cells) => /\(EUR\)/i.test(cells[0]));
  if (!row) throw new Error(`${BANK}: Kogumiskonto rate table has no EUR row`);
  const rateEur = assertPlausibleRate(BANK, parseRate(row[1]));
  return { rateEur, ratesEffectiveFrom: null };
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape, loadFlexibleAccount);
