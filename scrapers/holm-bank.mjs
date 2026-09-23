// Holm Bank - transposed rate table: the first row holds the periods and the
// second row the matching rates.
//   | Periood (kuud) | 1-2  | 3-5  | ... |
//   | Intress (%)    | 2,30 | 2,40 | ... |
// Rendering mode was unverified when this was written, so it tries fetch first
// and falls back to a rendered page; in practice fetch has been enough.

import { fetchOrRender } from '../lib/http.mjs';
import { assertPlausibleTiers, extractTables, findEffectiveDate, findTable, normalizeTiers, parsePeriod, parseRate, toText } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'Holm Bank';

export function parseRates({ html }) {
  const table = findTable(extractTables(html), /Periood \(kuud\)/i);
  if (!table) throw new Error(`${BANK}: no "Periood (kuud)" table found`);

  const periodRow = table.rows.find((row) => /Periood/i.test(row[0]));
  const rateRow = table.rows.find((row) => /Intress/i.test(row[0]));
  if (!periodRow || !rateRow) throw new Error(`${BANK}: rate table is missing its period or interest row`);

  const tiers = [];
  // Column 0 is the row label, so the period and rate columns line up from index 1.
  for (let column = 1; column < periodRow.length; column += 1) {
    const period = parsePeriod(`${periodRow[column]} kuud`);
    const rateEur = parseRate(rateRow[column]);
    if (!period || rateEur === null) continue;
    tiers.push({ months: period.months, rateEur });
  }

  assertPlausibleTiers(BANK, tiers, { minCount: 8 });

  const result = {
    tiers: normalizeTiers(tiers),
    // "Intressimäärad on tabelis toodud aasta baasil ja kehtivad alates 31.08.2026"
    ratesEffectiveFrom: findEffectiveDate(html, /kehtivad alates \d{1,2}\.\d{1,2}\.\d{4}/i),
  };

  // Product summary above the table: "Hoiusumma alates 100 €".
  const minMatch = toText(html).match(/Hoiusumma alates\s*([\d\s]+?)\s*€/i);
  if (minMatch) result.minDeposit = Number(minMatch[1].replace(/\s/g, ''));
  return result;
}

export async function fetchInputs(account) {
  const { result, method } = await fetchOrRender(account.sourceUrl, (html) => {
    // Parsing here is what decides whether this rendering mode actually worked.
    parseRates({ html });
    return html;
  });
  return { html: result, method };
}

export async function scrape(account) {
  const { html, method } = await fetchInputs(account);
  return { ...parseRates({ html }), detectedScrapeMethod: method };
}

await runAsScript(import.meta.url, BANK, scrape);
