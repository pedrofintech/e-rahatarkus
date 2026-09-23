// Inbank - the rate table is rendered by client-side JavaScript, so a plain
// fetch returns the page without any numbers in it.
// Layout: | 3 kuud | 2.20 % | with no header row.
// Inbank does not publish a rates-effective date.

import { renderHtml } from '../lib/http.mjs';
import { assertPlausibleTiers, extractTables, findTable, normalizeTiers, parsePeriod, parseRate, toText } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'Inbank';

export function parseRates({ html }) {
  const table = findTable(extractTables(html), /T.htajalise hoiuse intressim..rad/i);
  if (!table) throw new Error(`${BANK}: could not find the "Tähtajalise hoiuse intressimäärad" table`);

  const tiers = [];
  for (const [periodCell, rateCell] of table.rows) {
    const period = parsePeriod(periodCell);
    const rateEur = parseRate(rateCell);
    if (!period || rateEur === null) continue;
    tiers.push({ months: period.months, rateEur });
  }

  assertPlausibleTiers(BANK, tiers, { minCount: 7 });

  const result = { tiers: normalizeTiers(tiers), ratesEffectiveFrom: null };
  // The product summary states the accepted range: "Hoiuse summa 500 - 300 000 €".
  const minMatch = toText(html).match(/Hoiuse summa\s*([\d\s]+?)\s*-\s*[\d\s]+\s*€/i);
  if (minMatch) result.minDeposit = Number(minMatch[1].replace(/\s/g, ''));
  return result;
}

export async function fetchInputs(account) {
  return { html: await renderHtml(account.sourceUrl, { waitForSelector: 'table:has-text("kuud")' }) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape);
