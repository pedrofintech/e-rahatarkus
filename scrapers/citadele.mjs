// Citadele - the rates page lists several deposit products. The term deposit
// table tracked in data/data.json is the one headed "intressimaksega perioodi
// lõpus"; a second table below it holds the monthly-payout rates, which are
// slightly lower and must not be picked up by mistake.
//
// Layout: header row holds the periods, then one row per currency:
//   | Min. hoiuse summa | 1 kuu  | 3 kuud | ... |
//   | 100 EUR           | 1,80 % | 2,05 % | ... |
//   | 200 USD           | 0,00 % | 0,00 % | ... |
//
// data.json tracks EUR only, so the USD row is read past deliberately.

import { fetchOrRender } from '../lib/http.mjs';
import { assertPlausibleTiers, extractTables, findEffectiveDate, normalizeTiers, parsePeriod, parseRate } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'Citadele';
const END_OF_PERIOD_HEADING = /intressimaksega perioodi l.pus/i;
const MONTHLY_HEADING = /intressimaksega, taotledes/i;

/**
 * The page repeats "Määrad kehtivad alates ..." once per product, so the date
 * is taken from the slice of the page that belongs to the end-of-period block.
 */
function findBlockEffectiveDate(html) {
  const start = html.search(END_OF_PERIOD_HEADING);
  if (start === -1) return null;
  const relativeEnd = html.slice(start + 1).search(MONTHLY_HEADING);
  const block = relativeEnd === -1 ? html.slice(start) : html.slice(start, start + 1 + relativeEnd);
  return findEffectiveDate(block, /M..rad kehtivad alates \d{1,2}\.\d{1,2}\.\d{4}/i);
}

export function parseRates({ html }) {
  // Take the widest end-of-period table: the page ships the same data twice in
  // desktop and stacked-mobile layouts, and the desktop one has periods as columns.
  const table = extractTables(html)
    .filter((candidate) => END_OF_PERIOD_HEADING.test(candidate.context))
    .filter((candidate) => candidate.rows.some((row) => /Min\. hoiuse summa/i.test(row[0])))
    .sort((a, b) => b.rows[0].length - a.rows[0].length)[0];
  if (!table) throw new Error(`${BANK}: no "intressimaksega perioodi lõpus" rate table found`);

  const periodRow = table.rows.find((row) => /Min\. hoiuse summa/i.test(row[0]));
  const eurRow = table.rows.find((row) => /\bEUR\b/i.test(row[0]));
  if (!periodRow || !eurRow) throw new Error(`${BANK}: rate table is missing its period header or EUR row`);

  const tiers = [];
  // Column 0 holds the minimum deposit label, so periods start at index 1.
  for (let column = 1; column < periodRow.length; column += 1) {
    const period = parsePeriod(periodRow[column]);
    const rateEur = parseRate(eurRow[column]);
    if (!period || rateEur === null) continue;
    tiers.push({ months: period.months, rateEur });
  }

  assertPlausibleTiers(BANK, tiers, { minCount: 7 });

  const result = { tiers: normalizeTiers(tiers), ratesEffectiveFrom: findBlockEffectiveDate(html) };
  // The EUR row label doubles as the minimum deposit, e.g. "100 EUR".
  const minMatch = eurRow[0].match(/([\d\s]+)\s*EUR/i);
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
