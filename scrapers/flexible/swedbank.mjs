// Swedbank Rahakoguja - flexible savings account: variable rate, no term,
// instant free withdrawal. Same as the term-deposit page, the rate table is
// filled in by client-side JavaScript, so this needs Playwright rather than a
// plain fetch. No rates-effective date is published for this product.

import { renderHtml } from '../../lib/http.mjs';
import { assertPlausibleRate, extractTables, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFlexibleAccount } from '../../lib/cli.mjs';

const BANK = 'Swedbank';

export function parseRates({ html }) {
  const table = extractTables(html).find((candidate) =>
    candidate.rows.some((row) => /Valuuta/i.test(row[0]) && /\bEUR\b/i.test(row[1] ?? '')),
  );
  if (!table) throw new Error(`${BANK}: could not find the Rahakoguja EUR rate table`);
  const rateRow = table.rows.find((row) => /Intressim..r/i.test(row[0]));
  if (!rateRow) throw new Error(`${BANK}: Rahakoguja table has no "Intressimäär" row`);
  const rateEur = assertPlausibleRate(BANK, parseRate(rateRow[1]));

  const result = { rateEur, ratesEffectiveFrom: null };
  // "Rahakogujal puudub miinimum summa" - stated as plain text, not a table row.
  if (/Rahakogujal puudub miinimum summa/i.test(toText(html))) result.minDeposit = 0;
  return result;
}

export async function fetchInputs(account) {
  return { html: await renderHtml(account.sourceUrl, { waitForSelector: 'table:has-text("Intressimäär")' }) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape, loadFlexibleAccount);
