// Revolut (Instant Access Savings) - reads Revolut's Estonian Deposit
// Information Sheet (pre-contractual information), which lists the EUR rate
// for each plan: "Standard: 1.18% p.a. (gross rate) Plus: ... Ultra: - Up to
// EUR 100,000: 2.36% p.a.". The marketing page only states a range, and the
// Irish one used before showed rates that do not apply in Estonia.
// rateEur is the Standard (free plan) rate - the comparator ranks by it; the
// paid plans are kept in `tiers` and shown next to it. The page blocks plain
// fetch() with an HTTP 403, so this needs a rendered browser.

import { renderHtml } from '../../lib/http.mjs';
import { assertPlausibleRate, parseRate, toText } from '../../lib/parse.mjs';
import { runAsScript, loadFintechAccount } from '../../lib/cli.mjs';

const PLATFORM = 'Revolut';

const PLANS = [
  ['Standard', /Standard:\s*([\d.,]+)\s*% p\.a\./i],
  ['Plus', /Plus:\s*([\d.,]+)\s*% p\.a\./i],
  ['Premium', /Premium:\s*([\d.,]+)\s*% p\.a\./i],
  ['Metal', /Metal:\s*([\d.,]+)\s*% p\.a\./i],
  ['Ultra (kuni 100 000 €)', /Ultra:\s*-?\s*Up to EUR 100[.,]000:\s*([\d.,]+)\s*% p\.a\./i],
];

export function parseRates({ html }) {
  // Scripts and styles hold page data and CSS, not the document text.
  const text = toText(String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' '));
  const start = text.search(/Interest rate, EUR/i);
  if (start < 0) throw new Error(`${PLATFORM}: could not find the "Interest rate, EUR" section`);
  const end = text.slice(start).search(/Promotional rate|Interest rate, USD/i);
  const section = text.slice(start, end > 0 ? start + end : start + 600);

  const tiers = PLANS.map(([plan, re]) => {
    const match = section.match(re);
    if (!match) throw new Error(`${PLATFORM}: could not find the EUR rate for the ${plan} plan`);
    return { plan, rateEur: assertPlausibleRate(PLATFORM, parseRate(match[1])) };
  });

  return {
    rateEur: tiers[0].rateEur,
    tiers,
    ratesEffectiveFrom: null,
  };
}

export async function fetchInputs(account) {
  return { html: await renderHtml(account.sourceUrl, { timeoutMs: 45000 }) };
}

export async function scrape(account) {
  return parseRates(await fetchInputs(account));
}

await runAsScript(import.meta.url, PLATFORM, scrape, loadFintechAccount, { key: 'platform' });
