// Accounts flagged `scrapeLocalOnly: true` sit behind a Cloudflare bot check
// that blocks GitHub Actions' shared datacenter IPs (Luminor, Trading 212,
// Revolut - see the scrape-debug screenshots from a CI run). They scrape fine
// from a normal home connection, so CI skips them and a person runs
// `npm run update:local` instead. We deliberately do not try to get past the
// bot check.
//
// Skipping must not hide ageing data: with nobody re-scraping them, a stored
// rate would otherwise look current forever. So a skipped account that has not
// been checked for STALE_AFTER_DAYS is marked stale ("Kontrollimata" on the
// card); the next successful local run flips it back to confirmed.

export const STALE_AFTER_DAYS = 14;

export function shouldSkipInCi(account) {
  return Boolean(process.env.CI) && account.scrapeLocalOnly === true;
}

export function ageOutLocalOnly(account, today, label, log) {
  log(`${label}: skipped in CI (blocked by bot check, run "npm run update:local" locally)`);
  const days = Math.floor((Date.parse(today) - Date.parse(account.checkedOn)) / 86400000);
  if (Number.isFinite(days) && days > STALE_AFTER_DAYS && account.status !== 'stale') {
    account.status = 'stale';
    log(`    ~ status: confirmed -> stale (last checked ${days} days ago)`);
  }
}
