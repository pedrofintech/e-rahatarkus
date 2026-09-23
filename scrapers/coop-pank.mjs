// Coop Pank - server-rendered rates page, one EUR table of month ranges.
// Ranges are stored by their upper bound ("1 - 2 kuud" -> 2 months).
//
// The rates page quotes only a per-client maximum, so the minimum deposit is
// read from the product page instead.

import { fetchText } from '../lib/http.mjs';
import { assertPlausibleTiers, extractTables, findEffectiveDate, findTable, normalizeTiers, parsePeriod, parseRate, toText } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'Coop Pank';
const PRODUCT_URL = 'https://www.cooppank.ee/eraklient/raha-kasvatamine/tahtajaline-hoius';

// The longest tier is published open-ended ("60 - kuud"). data/data.json records
// that tier as 120 months, so keep using the same bound here.
const OPEN_ENDED_MONTHS = 120;

export function parseRates({ ratesHtml, productHtml }) {
  // Anchor on the product heading: the page also lists Rahasahtel and
  // Lastehoius rates, which must not be picked up instead.
  const table = findTable(extractTables(ratesHtml), /Tähtajaline hoius/i);
  if (!table) throw new Error(`${BANK}: no "Tähtajaline hoius" rate table found`);

  const tiers = [];
  for (const [periodCell, rateCell] of table.rows) {
    const period = parsePeriod(periodCell);
    const rateEur = parseRate(rateCell);
    if (!period || rateEur === null) continue;
    tiers.push({ months: period.openEnded ? OPEN_ENDED_MONTHS : period.months, rateEur });
  }

  assertPlausibleTiers(BANK, tiers, { minCount: 8 });

  const result = {
    tiers: normalizeTiers(tiers),
    // "Tähtajaline hoius Aasta baasil, kehtivad alates 09.07.2026" - the other
    // products on the page carry their own, different dates.
    ratesEffectiveFrom: findEffectiveDate(
      ratesHtml,
      /Tähtajaline hoius[^.]{0,40}kehtivad alates \d{1,2}\.\d{1,2}\.\d{4}/i,
    ),
  };

  const minDeposit = productHtml ? parseMinDeposit(productHtml) : undefined;
  if (minDeposit !== undefined) result.minDeposit = minDeposit;
  return result;
}

/** "Minimaalne summa 100 €" on the product page. */
export function parseMinDeposit(html) {
  const match = toText(html).match(/Minimaalne summa\s*([\d\s]+?)\s*€/i);
  return match ? Number(match[1].replace(/\s/g, '')) : undefined;
}

export async function fetchInputs(account) {
  const ratesHtml = await fetchText(account.sourceUrl);

  // The minimum deposit is supplementary: failing to reach the product page
  // must not lose the rates we already parsed successfully.
  let productHtml = null;
  try {
    productHtml = await fetchText(PRODUCT_URL);
  } catch {
    // Leave it null; the orchestrator keeps the stored minDeposit.
  }

  return { ratesHtml, productHtml };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape);
