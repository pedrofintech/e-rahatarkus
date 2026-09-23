// Refreshes data/flexible-accounts.json from the bank websites.
//
//   node scripts/update-flexible-accounts.mjs             # scrape and write
//   node scripts/update-flexible-accounts.mjs --dry-run    # report, write nothing
//
// Mirrors scripts/update-accounts.mjs, simplified for this data's shape: one
// flat variable rate per bank instead of a term-tiered table, so there is no
// tier diffing to do - just compare the one number.
//
// One bank's site being down must not stop the rest; each scraper runs inside
// its own try/catch and a failure leaves that bank's stored data untouched.
//
// Known gap: product, minDeposit, withdrawal, payoutFrequency, guaranteeScheme,
// taxNote and notes are hand-authored and never re-verified here - only
// rateEur and ratesEffectiveFrom come from the scrapers. See each module in
// scrapers/flexible/ for what it actually reads off the page.

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { SCRAPERS, slugFor } from '../scrapers/flexible/index.mjs';

const DATA_PATH = new URL('../data/flexible-accounts.json', import.meta.url);
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

  const slug = slugFor(account.bank);
  const loadScraper = SCRAPERS[slug];

  let scraped;
  try {
    if (!loadScraper) throw new Error(`no flexible scraper module registered for slug "${slug}"`);
    const { scrape } = await loadScraper();
    scraped = await scrape(account);
  } catch (error) {
    failureCount += 1;
    account.consecutiveFailures += 1;
    log(`${account.bank} ${account.product}: FAILED (${account.consecutiveFailures}x) - ${error.message}`);
    if (account.consecutiveFailures >= STALE_AFTER_FAILURES && account.status !== 'stale') {
      account.status = 'stale';
      log(`    ~ status: confirmed -> stale (${account.consecutiveFailures} consecutive failures)`);
    }
    continue;
  }

  const changes = [];
  if (account.rateEur !== scraped.rateEur) {
    changes.push(`~ rateEur: ${account.rateEur} -> ${scraped.rateEur}`);
  }
  if (scraped.minDeposit !== undefined && account.minDeposit !== scraped.minDeposit) {
    changes.push(`~ minDeposit: ${account.minDeposit} -> ${scraped.minDeposit}`);
  }
  const scrapedEffectiveFrom = scraped.ratesEffectiveFrom ?? null;
  if (scrapedEffectiveFrom !== account.ratesEffectiveFrom) {
    changes.push(`~ ratesEffectiveFrom: ${account.ratesEffectiveFrom ?? '(none)'} -> ${scrapedEffectiveFrom ?? '(none)'}`);
  }

  if (account.consecutiveFailures > 0) {
    log(`${account.bank} ${account.product}: recovered after ${account.consecutiveFailures} failure(s)`);
    account.consecutiveFailures = 0;
  }
  if (account.status === 'stale') {
    account.status = 'confirmed';
    changes.push('~ status: stale -> confirmed');
  }
  account.checkedOn = TODAY;

  if (changes.length === 0) {
    log(`${account.bank} ${account.product}: no change (${scraped.rateEur}%)`);
    continue;
  }

  account.rateEur = scraped.rateEur;
  account.ratesEffectiveFrom = scrapedEffectiveFrom;
  if (scraped.minDeposit !== undefined) account.minDeposit = scraped.minDeposit;

  updatedCount += 1;
  log(`${account.bank} ${account.product}: UPDATED`);
  for (const change of changes) log(`    ${change}`);
}

const scrapedOk = data.accounts.length - failureCount;
log('');
log(`Summary: ${scrapedOk}/${data.accounts.length} scraped, ${updatedCount} updated, ${failureCount} failed`);

if (failureCount === data.accounts.length) {
  log('Every bank failed - not writing data/flexible-accounts.json.');
  process.exit(1);
}

if (scrapedOk > 0) data.lastUpdated = TODAY;

const output = JSON.stringify(data, null, 2) + '\n';

if (DRY_RUN) {
  log('Dry run - data/flexible-accounts.json left unchanged.');
} else if (output === originalText) {
  log('data/flexible-accounts.json already up to date - nothing written.');
} else {
  await writeFile(DATA_PATH, output, 'utf8');
  log('Wrote data/flexible-accounts.json.');
}

const hasCommitWorthyChanges = commitWorthySnapshot(data) !== snapshotBefore;
log(`changes=${hasCommitWorthyChanges}`);
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changes=${hasCommitWorthyChanges}\n`);
}
