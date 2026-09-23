// Bigbank - server-rendered page carrying three tables, one per interest
// payout schedule. data/data.json tracks the end-of-period schedule
// ("Intressimakse perioodi lõpus"), so select that one explicitly.

import { fetchText } from '../lib/http.mjs';
import { assertPlausibleTiers, extractTables, findEffectiveDate, findTable, normalizeTiers, parsePeriod, parseRate, toText } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'Bigbank';

export function parseRates({ html }) {
  const table = findTable(extractTables(html), /Intressimakse perioodi l.pus/i);
  if (!table) throw new Error(`${BANK}: could not find the "Intressimakse perioodi lõpus" rate table`);

  const tiers = [];
  for (const [periodCell, rateCell] of table.rows) {
    const period = parsePeriod(periodCell);
    const rateEur = parseRate(rateCell);
    if (!period || rateEur === null) continue;
    tiers.push({ months: period.months, rateEur });
  }

  assertPlausibleTiers(BANK, tiers, { minCount: 6 });

  const result = {
    tiers: normalizeTiers(tiers),
    // The term deposit is the fixed-rate product; Säästuhoius next to it is the
    // variable-rate one and carries its own "Viimati muudetud" date.
    ratesEffectiveFrom: findEffectiveDate(
      html,
      /Fikseeritud intress Viimati muudetud \d{1,2}\.\d{1,2}\.\d{4}/i,
    ),
  };

  // The product comparison block reads "Tähtajaline hoius Minimaalne hoiusumma 500 €".
  // Anchor on the product name - the Säästuhoius block next to it says 0 €.
  const minMatch = toText(html).match(/Tähtajaline hoius\s*Minimaalne hoiusumma\s*([\d\s]+)\s*€/i);
  if (minMatch) result.minDeposit = Number(minMatch[1].replace(/\s/g, ''));
  return result;
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape);
