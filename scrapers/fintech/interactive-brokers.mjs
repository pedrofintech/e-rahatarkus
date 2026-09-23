// Interactive Brokers - the official rate page carries one big table:
// | Currency | Tier | Rate Paid: IBKR Pro | Rate Paid: IBKR Lite |, sorted
// alphabetically by currency, with a currency's row spanning several tiers
// (the tier rows after the first repeat an empty currency cell). EUR pays 0%
// up to €10,000 and a real rate above that; rateEur is the IBKR Pro rate for
// the "> 10,000" tier, which is what the article's own headline number
// tracks. No rates-effective date is published on this page.
//
// The table is matched by its DATA (a row whose first cell is literally
// "EUR"), not by finding a "Currency"/"Tier" header row - IBKR restructured
// the page so the visible header is no longer inside the same <table> as the
// body rows (likely a sticky-header split), which broke the earlier
// header-text match even though the data table itself was unchanged.
// Matching on the data directly is more robust to that kind of cosmetic
// restructuring since it doesn't care where (or whether) a header row lives.

import { fetchText } from '../../lib/http.mjs';
import { assertPlausibleRate, extractTables, parseRate } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'Interactive Brokers';

export function parseRates({ html }) {
  const table = extractTables(html).find((candidate) => candidate.rows.some((row) => row[0] === 'EUR'));
  if (!table) throw new Error(`${PLATFORM}: could not find a table with an EUR row`);

  // Find the EUR row, then look ahead for its "> 10,000" tier row (currency
  // cell is blank on continuation rows, per the table's own layout).
  const eurIndex = table.rows.findIndex((row) => row[0] === 'EUR');
  if (eurIndex === -1) throw new Error(`${PLATFORM}: no EUR row in the interest-rate table`);
  const tierRow = table.rows
    .slice(eurIndex, eurIndex + 4)
    .find((row) => /^>/.test(row[1] ?? ''));
  if (!tierRow) throw new Error(`${PLATFORM}: EUR row has no "> ..." tier`);

  const rateMatch = tierRow[2].match(/([\d.,-]+)\s*%/);
  if (!rateMatch) throw new Error(`${PLATFORM}: EUR tier rate cell has no percentage ("${tierRow[2]}")`);
  const rateEur = assertPlausibleRate(PLATFORM, parseRate(rateMatch[1]));

  return { rateEur, ratesEffectiveFrom: null };
}

export async function fetchInputs(account) {
  return { html: await fetchText(account.sourceUrl) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, PLATFORM, scrape, loadFintechAccount, { key: 'platform' });
