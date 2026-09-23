// Refreshes data/fintech-accounts.json from the platforms' own sites.
//
//   node scripts/update-fintech-accounts.mjs             # scrape and write
//   node scripts/update-fintech-accounts.mjs --dry-run    # report, write nothing
//
// Mirrors scripts/update-flexible-accounts.mjs. These pages are marketing
// sites rather than regulated Estonian rates pages, so they move and change
// layout more often - a failure here is not unusual and, as with the other
// two pipelines, leaves that platform's stored data untouched rather than
// stopping the run.
//
// Known gap: product, rateNote, protectionScheme, taxNote and notes are
// hand-authored and never re-verified here - only rateEur, rateEurMin (where
// a scraper reports one), tiers and ratesEffectiveFrom come from the
// scrapers. See each module in scrapers/fintech/ for what it actually reads.
//
// rateAutoUpdate: false (bunq) opts an account OUT of having the scraped
// number auto-applied as its headline rateEur. bunq's marketing page only
// ever publishes its bonus-tier ceiling ("up to 3.01%"), not the 1.51% base
// rate that actually applies to a typical balance - letting the scraper
// overwrite rateEur with that ceiling would misrepresent it as the realistic
// headline number again. The scraper still runs and any drift is logged for
// a human to review; it just isn't written automatically.

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { SCRAPERS, slugFor } from '../scrapers/fintech/index.mjs';

const DATA_PATH = new URL('../data/fintech-accounts.json', import.meta.url);
const DRY_RUN = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().slice(0, 10);

const STALE_AFTER_FAILURES = 3;

const log = (message) => process.stdout.write(`${message}\n`);

/**
 * Everything except checkedOn. checkedOn advances on every successful run
 * regardless of whether a rate moved, so a checkedOn-only diff is not worth
 * a commit - the workflow's own run history already records that we looked.
 */
function commitWorthySnapshot(data) {
  return JSON.stringify(data.accounts.map(({ checkedOn, ...rest }) => rest));
}

const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const originalText = JSON.stringify(data, null, 2) + '\n';
const snapshotBefore = commitWorthySnapshot(data);

let updatedCount = 0;
let failureCount = 0;

for (const account of data.accounts) {
  account.consecutiveFailures ??= 0;

  const slug = slugFor(account.platform);
  const loadScraper = SCRAPERS[slug];

  let scraped;
  try {
    if (!loadScraper) throw new Error(`no fintech scraper module registered for slug "${slug}"`);
    const { scrape } = await loadScraper();
    scraped = await scrape(account);
  } catch (error) {
    failureCount += 1;
    account.consecutiveFailures += 1;
    log(`${account.platform} ${account.product}: FAILED (${account.consecutiveFailures}x) - ${error.message}`);
    if (account.consecutiveFailures >= STALE_AFTER_FAILURES && account.status !== 'stale') {
      account.status = 'stale';
      log(`    ~ status: confirmed -> stale (${account.consecutiveFailures} consecutive failures)`);
    }
    continue;
  }

  const autoUpdateRate = account.rateAutoUpdate !== false;
  const changes = [];
  if (account.rateEur !== scraped.rateEur) {
    if (autoUpdateRate) {
      changes.push(`~ rateEur: ${account.rateEur} -> ${scraped.rateEur}`);
    } else {
      log(`${account.platform} ${account.product}: NOTE - scraped rate is ${scraped.rateEur}% but rateEur (${account.rateEur}%) is hand-maintained (rateAutoUpdate: false) - review manually.`);
    }
  }
  if (scraped.rateEurMin !== undefined && account.rateEurMin !== scraped.rateEurMin) {
    changes.push(`~ rateEurMin: ${account.rateEurMin} -> ${scraped.rateEurMin}`);
  }
  if (scraped.tiers !== undefined && JSON.stringify(account.tiers) !== JSON.stringify(scraped.tiers)) {
    changes.push(`~ tiers: ${JSON.stringify(account.tiers)} -> ${JSON.stringify(scraped.tiers)}`);
  }
  const scrapedEffectiveFrom = scraped.ratesEffectiveFrom ?? null;
  if (scrapedEffectiveFrom !== account.ratesEffectiveFrom) {
    changes.push(`~ ratesEffectiveFrom: ${account.ratesEffectiveFrom ?? '(none)'} -> ${scrapedEffectiveFrom ?? '(none)'}`);
  }

  if (account.consecutiveFailures > 0) {
    log(`${account.platform} ${account.product}: recovered after ${account.consecutiveFailures} failure(s)`);
    account.consecutiveFailures = 0;
  }
  if (account.status === 'stale') {
    account.status = 'confirmed';
    changes.push('~ status: stale -> confirmed');
  }
  account.checkedOn = TODAY;

  if (changes.length === 0) {
    log(`${account.platform} ${account.product}: no change (${scraped.rateEur}%)`);
    continue;
  }

  if (autoUpdateRate) account.rateEur = scraped.rateEur;
  account.ratesEffectiveFrom = scrapedEffectiveFrom;
  if (scraped.rateEurMin !== undefined) account.rateEurMin = scraped.rateEurMin;
  if (scraped.tiers !== undefined) account.tiers = scraped.tiers;

  updatedCount += 1;
  log(`${account.platform} ${account.product}: UPDATED`);
  for (const change of changes) log(`    ${change}`);
}

const scrapedOk = data.accounts.length - failureCount;
log('');
log(`Summary: ${scrapedOk}/${data.accounts.length} scraped, ${updatedCount} updated, ${failureCount} failed`);

if (failureCount === data.accounts.length) {
  log('Every platform failed - not writing data/fintech-accounts.json.');
  process.exit(1);
}

if (scrapedOk > 0) data.lastUpdated = TODAY;

const output = JSON.stringify(data, null, 2) + '\n';

if (DRY_RUN) {
  log('Dry run - data/fintech-accounts.json left unchanged.');
} else if (output === originalText) {
  log('data/fintech-accounts.json already up to date - nothing written.');
} else {
  await writeFile(DATA_PATH, output, 'utf8');
  log('Wrote data/fintech-accounts.json.');
}

const hasCommitWorthyChanges = commitWorthySnapshot(data) !== snapshotBefore;
log(`changes=${hasCommitWorthyChanges}`);
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changes=${hasCommitWorthyChanges}\n`);
}
