// Refreshes data/data.json from the bank websites.
//
//   node scripts/update-accounts.mjs             # scrape and write
//   node scripts/update-accounts.mjs --dry-run   # scrape and report, write nothing
//
// One bank's site being down must not stop the rest, so every scraper runs
// inside its own try/catch and a failure leaves that bank's stored data
// untouched. The process only exits non-zero when every single bank failed,
// which is the signal that something systemic (network, CI image) is broken
// rather than one bank redesigning a page.
//
// Known gap: product, salaryRequired, monthlyFee, guaranteeScheme and taxNote
// are never verified against the bank pages - they change rarely and nothing
// here will notice when they do.

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { SCRAPERS, slugFor } from '../scrapers/index.mjs';
import { detectEol, measureTierWidths, serializeAccounts } from '../lib/serialize.mjs';

const DATA_PATH = new URL('../data/data.json', import.meta.url);
const DRY_RUN = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().slice(0, 10);

// A single blip should not mark a bank stale, so staleness needs a run of
// failures. checkedOn keeps advancing on every successful run regardless.
const STALE_AFTER_FAILURES = 3;

// Canonical field order, so fields added later land somewhere sensible rather
// than being appended to the end of the object.
const KEY_ORDER = [
  'bank', 'product', 'status', 'consecutiveFailures', 'checkedOn', 'ratesEffectiveFrom',
  'scrapeMethod', 'tiers', 'minDeposit', 'minDepositUsd', 'salaryRequired', 'monthlyFee',
  'guaranteeScheme', 'taxNote', 'sourceUrl', 'notes',
];

const log = (message) => process.stdout.write(`${message}\n`);

function orderKeys(account) {
  const ordered = {};
  for (const key of KEY_ORDER) {
    if (key in account) ordered[key] = account[key];
  }
  for (const key of Object.keys(account)) {
    if (!(key in ordered)) ordered[key] = account[key];
  }
  return ordered;
}

function formatRates(tier) {
  return Object.entries(tier)
    .filter(([key]) => key !== 'months')
    .map(([key, value]) => `${key}=${value.toFixed(2)}`)
    .join(' ');
}

/** Human-readable list of what changed between two tier arrays. */
function diffTiers(storedTiers = [], scrapedTiers = []) {
  const stored = new Map(storedTiers.map((tier) => [tier.months, tier]));
  const scraped = new Map(scrapedTiers.map((tier) => [tier.months, tier]));
  const changes = [];

  for (const [months, next] of scraped) {
    const previous = stored.get(months);
    if (!previous) {
      changes.push([months, `+ ${months}m added (${formatRates(next)})`]);
      continue;
    }
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)].filter((key) => key !== 'months'));
    for (const key of keys) {
      if (previous[key] !== next[key]) {
        const before = previous[key] === undefined ? '(none)' : previous[key].toFixed(2);
        const after = next[key] === undefined ? '(none)' : next[key].toFixed(2);
        changes.push([months, `~ ${months}m ${key}: ${before} -> ${after}`]);
      }
    }
  }
  for (const [months, previous] of stored) {
    if (!scraped.has(months)) changes.push([months, `- ${months}m removed (was ${formatRates(previous)})`]);
  }

  return changes.sort((a, b) => a[0] - b[0]).map(([, line]) => line);
}

/**
 * Everything except checkedOn. A run that only advanced checkedOn means "we
 * looked and nothing moved", which the workflow's own run history already
 * records - it should not produce a commit.
 */
function commitWorthySnapshot(data) {
  return JSON.stringify(data.accounts.map(({ checkedOn, ...rest }) => rest));
}

const originalText = await readFile(DATA_PATH, 'utf8');
const data = JSON.parse(originalText);
const snapshotBefore = commitWorthySnapshot(data);

let updatedCount = 0;
let failureCount = 0;
const warnings = [];

for (const [index, storedAccount] of data.accounts.entries()) {
  // Fill in fields added after the file was first written, then put the keys
  // back into canonical order so they land next to their relatives.
  storedAccount.consecutiveFailures ??= 0;
  storedAccount.ratesEffectiveFrom ??= null;
  const account = orderKeys(storedAccount);
  data.accounts[index] = account;

  const slug = slugFor(account.bank);
  const loadScraper = SCRAPERS[slug];

  let scraped;
  try {
    if (!loadScraper) throw new Error(`no scraper module registered for slug "${slug}"`);
    const { scrape } = await loadScraper();
    scraped = await scrape(account);
  } catch (error) {
    // Keep the stored data exactly as it was and carry on to the next bank.
    failureCount += 1;
    account.consecutiveFailures += 1;
    log(`${account.bank}: FAILED (${account.consecutiveFailures}x) - ${error.message}`);
    if (account.consecutiveFailures >= STALE_AFTER_FAILURES && account.status !== 'stale') {
      account.status = 'stale';
      log(`    ~ status: confirmed -> stale (${account.consecutiveFailures} consecutive failures)`);
    }
    continue;
  }

  const changes = diffTiers(account.tiers, scraped.tiers);
  const tiersChanged = changes.length > 0;

  for (const field of ['minDeposit', 'minDepositUsd']) {
    if (scraped[field] === undefined) continue;
    if (account[field] !== scraped[field]) {
      changes.push(`~ ${field}: ${account[field] ?? '(none)'} -> ${scraped[field]}`);
    }
  }

  // Early warning: the bank restated its rates but we parsed the same numbers.
  // Either they republished unchanged rates, or the parser is reading a stale
  // part of the page.
  const scrapedEffectiveFrom = scraped.ratesEffectiveFrom ?? null;
  if (scrapedEffectiveFrom !== account.ratesEffectiveFrom) {
    changes.push(
      `~ ratesEffectiveFrom: ${account.ratesEffectiveFrom ?? '(none)'} -> ${scrapedEffectiveFrom ?? '(none)'}`,
    );
    if (!tiersChanged && account.ratesEffectiveFrom !== null) {
      warnings.push(
        `${account.bank}: effective date moved to ${scrapedEffectiveFrom} but the parsed rates did not change`,
      );
    }
  }

  if (scraped.detectedScrapeMethod && account.scrapeMethod !== scraped.detectedScrapeMethod) {
    changes.push(`~ scrapeMethod: ${account.scrapeMethod} -> ${scraped.detectedScrapeMethod}`);
  }

  // A successful scrape clears the failure streak and re-confirms the record.
  if (account.consecutiveFailures > 0) {
    log(`${account.bank}: recovered after ${account.consecutiveFailures} failure(s)`);
    account.consecutiveFailures = 0;
  }
  if (account.status === 'stale') {
    account.status = 'confirmed';
    changes.push('~ status: stale -> confirmed');
  }

  account.checkedOn = TODAY;

  if (changes.length === 0) {
    log(`${account.bank}: no change (${scraped.tiers.length} tiers)`);
    continue;
  }

  account.tiers = scraped.tiers;
  account.ratesEffectiveFrom = scrapedEffectiveFrom;
  for (const field of ['minDeposit', 'minDepositUsd']) {
    if (scraped[field] !== undefined) account[field] = scraped[field];
  }
  if (scraped.detectedScrapeMethod) account.scrapeMethod = scraped.detectedScrapeMethod;

  updatedCount += 1;
  log(`${account.bank}: UPDATED`);
  for (const change of changes) log(`    ${change}`);
}

const scrapedOk = data.accounts.length - failureCount;
log('');
for (const warning of warnings) log(`WARNING: ${warning}`);
if (warnings.length > 0) log('');
log(`Summary: ${scrapedOk}/${data.accounts.length} scraped, ${updatedCount} updated, ${failureCount} failed`);

if (failureCount === data.accounts.length) {
  log('Every bank failed - not writing data/data.json.');
  process.exit(1);
}

if (scrapedOk > 0) data.lastUpdated = TODAY;

// Any field a scraper added along the way (minDepositUsd, say) gets slotted in
// rather than trailing off the end of the object.
data.accounts = data.accounts.map(orderKeys);

const hasCommitWorthyChanges = commitWorthySnapshot(data) !== snapshotBefore;
const eol = detectEol(originalText);
const output = serializeAccounts(data, {
  tierWidths: measureTierWidths(originalText),
  eol,
  trailingNewline: originalText.endsWith(eol),
});

if (DRY_RUN) {
  log('Dry run - data/data.json left unchanged.');
} else if (output === originalText) {
  log('data/data.json already up to date - nothing written.');
} else {
  await writeFile(DATA_PATH, output, 'utf8');
  log('Wrote data/data.json.');
}

// Tells the workflow whether this run is worth committing. A checkedOn-only
// change is not: the Action's run history already records that we looked.
log(`changes=${hasCommitWorthyChanges}`);
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changes=${hasCommitWorthyChanges}\n`);
}
