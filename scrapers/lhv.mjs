// LHV - server-rendered page with a single EUR/USD rate table.
// Layout: | Periood | Intressimäär (EUR) | Intressimäär (USD) |
// LHV does not publish a rates-effective date, so ratesEffectiveFrom stays null.

import { fetchText } from '../lib/http.mjs';
import { assertPlausibleTiers, extractTables, findTable, normalizeTiers, parsePeriod, parseRate, toText } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'LHV';

export function parseRates({ html }) {
  const table = findTable(extractTables(html), /Intressim..r \(EUR\)/i);
  if (!table) throw new Error(`${BANK}: no table with an "Intressimäär (EUR)" column found`);

  const tiers = [];
  for (const [periodCell, eurCell, usdCell] of table.rows) {
    const period = parsePeriod(periodCell);
    const rateEur = parseRate(eurCell);
    if (!period || rateEur === null) continue;
    const tier = { months: period.months, rateEur };
    const rateUsd = parseRate(usdCell);
    if (rateUsd !== null) tier.rateUsd = rateUsd;
    tiers.push(tier);
  }

  assertPlausibleTiers(BANK, tiers, { minCount: 6 });

  // Minimums live in the table footer: "Min. tähtajalise hoiuse summa on 100 €".
  const text = toText(table.text);
  const eurMin = text.match(/Min\.[^.]*?summa on\s*([\d\s]+)\s*€/i);
  const usdMin = text.match(/Min\.[^.]*?summa on\s*([\d\s]+)\s*\$/i);

  const result = { tiers: normalizeTiers(tiers), ratesEffectiveFrom: null };
  if (eurMin) result.minDeposit = Number(eurMin[1].replace(/\s/g, ''));
  if (usdMin) result.minDepositUsd = Number(usdMin[1].replace(/\s/g, ''));
  return result;
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape);
