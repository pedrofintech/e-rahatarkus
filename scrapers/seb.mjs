// SEB - the rates page shows only EURIBOR base rates in HTML; the term deposit
// rates live in the "term-deposit-calc" web component. Reading the component's
// own data files is steadier than driving its shadow DOM, but it takes two of
// them, because neither is sufficient alone:
//
//   intress/eur-privi.csv          "<term in days>; <rate>", e.g. "365; 2,20".
//                                  Carries more terms than SEB actually offers
//                                  (60, 120, 150, 210, 240, 300, 330 days).
//   term-deposit/js/calculate.js   Holds the termsToShow whitelist deciding
//                                  which of those terms are published, and the
//                                  deposit amount limits used for validation.
//
// Taking the CSV on its own would invent tiers that SEB does not quote, so the
// whitelist is read from the calculator rather than hardcoded here - if SEB
// adds or drops a term, this picks it up instead of going quietly stale.
//
// SEB publishes no effective date for the deposit rates.

import { fetchText } from '../lib/http.mjs';
import { assertPlausibleTiers, normalizeTiers, parseRate } from '../lib/parse.mjs';
import { runAsScript } from '../lib/cli.mjs';

const BANK = 'SEB';
const RATES_CSV_PATH = '/sites/default/files/calc/intress/eur-privi.csv';
const CALCULATOR_JS_PATH = '/sites/default/files/calc/term-deposit/js/calculate.js';

/**
 * The calculator treats a month as 30 days, except for the round year terms it
 * quotes as 365/730/1095 days.
 */
function daysToMonths(days) {
  const byExactTerm = { 365: 12, 730: 24, 1095: 36 };
  if (byExactTerm[days]) return byExactTerm[days];
  return days % 30 === 0 ? days / 30 : null;
}

export function parseRates({ calculatorJs, csv }) {
  const whitelistMatch = calculatorJs.match(/termsToShow\s*=\s*\[([\d,\s]+)\]/);
  if (!whitelistMatch) {
    throw new Error(`${BANK}: could not find the termsToShow whitelist in calculate.js`);
  }
  const publishedTerms = new Set(
    whitelistMatch[1].split(',').map((value) => Number.parseInt(value, 10)).filter(Number.isInteger),
  );
  if (publishedTerms.size === 0) throw new Error(`${BANK}: termsToShow whitelist parsed as empty`);

  const tiers = [];
  for (const line of csv.split('\n')) {
    const [termCell, rateCell] = line.split(';');
    const days = Number.parseInt(termCell, 10);
    const rateEur = parseRate(rateCell ?? '');
    if (!Number.isInteger(days) || rateEur === null || !publishedTerms.has(days)) continue;
    const months = daysToMonths(days);
    if (months === null) continue;
    tiers.push({ months, rateEur });
  }

  if (tiers.length !== publishedTerms.size) {
    throw new Error(
      `${BANK}: rate CSV covers ${tiers.length} of the ${publishedTerms.size} published terms`,
    );
  }
  assertPlausibleTiers(BANK, tiers, { minCount: 7 });

  const result = { tiers: normalizeTiers(tiers), ratesEffectiveFrom: null };
  // The calculator validates against the product minimum: "depositAmount < 100".
  // The CSV's leading "500-100000" row is stale and is deliberately ignored.
  const minMatch = calculatorJs.match(/depositAmount\s*<\s*(\d+)\s*\)/);
  if (minMatch) result.minDeposit = Number.parseInt(minMatch[1], 10);
  return result;
}

export async function fetchInputs(account) {
  const calculatorJs = await fetchText(new URL(CALCULATOR_JS_PATH, account.sourceUrl).href);
  // Cache-bust the same way the calculator itself does.
  const csvUrl = new URL(RATES_CSV_PATH, account.sourceUrl);
  csvUrl.search = String(Date.now());
  const csv = await fetchText(csvUrl.href);
  return { calculatorJs, csv };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, BANK, scrape);
