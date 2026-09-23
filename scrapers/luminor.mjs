// Luminor - the rates page renders empty without JavaScript.
// Two tables carry the same EUR rates: one for the internet bank and one for
// the customer service centre. data/data.json tracks the internet bank rates.
// Layout: | Periood kuudes | EUR | USD | GBP | NOK | with bare month numbers.
//
// Luminor publishes no effective date for the deposit table (the dated entries
// on that page belong to the Prime base rate), so ratesEffectiveFrom stays null.

import { renderHtml } from '../lib/http.mjs';
import { assertPlausibleTiers, extractTables, findTable, normalizeTiers, parseRate, toText } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'Luminor';

export function parseRates({ html }) {
  const table = findTable(extractTables(html), /Internetipangas kehtivad intressim..rad/i);
  if (!table) throw new Error(`${BANK}: could not find the internet bank ("Internetipangas") rate table`);

  const header = table.rows[0] ?? [];
  const eurColumn = header.findIndex((cell) => /^EUR$/i.test(cell));
  if (eurColumn === -1) throw new Error(`${BANK}: rate table has no EUR column`);

  const tiers = [];
  for (const row of table.rows.slice(1)) {
    // The period column is a bare month count, e.g. "12".
    const months = Number.parseInt(row[0], 10);
    const rateEur = parseRate(row[eurColumn]);
    if (!Number.isInteger(months) || rateEur === null) continue;
    tiers.push({ months, rateEur });
  }

  assertPlausibleTiers(BANK, tiers, { minCount: 6 });

  const result = { tiers: normalizeTiers(tiers), ratesEffectiveFrom: null };
  // Stated in prose below the table: "Intressimäärad kehtivad summadele 100 € kuni 1 000 000 €".
  const minMatch = toText(html).match(/kehtivad summadele\s*([\d\s]+?)\s*€/i);
  if (minMatch) result.minDeposit = Number(minMatch[1].replace(/\s/g, ''));
  return result;
}

export async function fetchInputs(account) {
  return { html: await renderHtml(account.sourceUrl, {
    waitForSelector: 'table:has-text("Periood kuudes")',
  }) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape);
