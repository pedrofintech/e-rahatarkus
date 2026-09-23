// Swedbank - rates sit behind per-currency tabs rendered by JavaScript.
// Each currency gets its own table:
//   | Minimaalne hoiusumma | 190 EUR             |
//   | Periood              | Intressimäär aastas |
//   | 1 kuu                | 1.80                |
// Only the EUR table is tracked in data/data.json.

import { renderHtml } from '../lib/http.mjs';
import { assertPlausibleTiers, extractTables, findEffectiveDate, normalizeTiers, parsePeriod, parseRate } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'Swedbank';

export function parseRates({ html }) {
  const table = extractTables(html).find((candidate) => {
    const minRow = candidate.rows.find((row) => /Minimaalne hoiusumma/i.test(row[0]));
    return minRow !== undefined && /\bEUR\b/i.test(minRow[1] ?? '');
  });
  if (!table) throw new Error(`${BANK}: could not find the EUR term deposit table`);

  const tiers = [];
  for (const [periodCell, rateCell] of table.rows) {
    // "< 1 kuu" is quoted too but is shorter than a month, so parsePeriod drops it.
    const period = parsePeriod(periodCell);
    const rateEur = parseRate(rateCell);
    if (!period || rateEur === null) continue;
    tiers.push({ months: period.months, rateEur });
  }

  assertPlausibleTiers(BANK, tiers, { minCount: 6 });

  const result = {
    tiers: normalizeTiers(tiers),
    // A single "Alates 27.07.2026" line sits below the currency tab group. The
    // large-deposit tables further down carry their own "Muudetud" date instead.
    ratesEffectiveFrom: findEffectiveDate(html, /Alates \d{1,2}\.\d{1,2}\.\d{4}/i),
  };

  const minRow = table.rows.find((row) => /Minimaalne hoiusumma/i.test(row[0]));
  const minMatch = minRow[1].match(/([\d\s]+)\s*EUR/i);
  if (minMatch) result.minDeposit = Number(minMatch[1].replace(/\s/g, ''));
  return result;
}

export async function fetchInputs(account) {
  return { html: await renderHtml(account.sourceUrl, {
    waitForSelector: 'table:has-text("Minimaalne hoiusumma")',
  }) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape);
