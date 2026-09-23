// Manual sanity-check tool: run one or all scrapers and print what they found
// next to what data/data.json currently stores. Writes nothing.
//
//   node scripts/run-scraper.mjs           # every bank
//   node scripts/run-scraper.mjs lhv seb   # selected slugs

import { readFile } from 'node:fs/promises';
import { SCRAPERS, slugFor } from '../scrapers/index.mjs';

const DATA_PATH = new URL('../data/data.json', import.meta.url);

function formatTiers(tiers = []) {
  return tiers
    .map((tier) => {
      const usd = tier.rateUsd === undefined ? '' : `/${tier.rateUsd.toFixed(2)}`;
      return `${tier.months}m=${tier.rateEur.toFixed(2)}${usd}`;
    })
    .join(' ');
}

const requested = process.argv.slice(2);
const { accounts } = JSON.parse(await readFile(DATA_PATH, 'utf8'));

for (const account of accounts) {
  const slug = slugFor(account.bank);
  if (requested.length > 0 && !requested.includes(slug)) continue;

  process.stdout.write(`\n=== ${account.bank} (${slug}) ===\n`);
  try {
    const { scrape } = await SCRAPERS[slug]();
    const started = Date.now();
    const scraped = await scrape(account);
    process.stdout.write(`  ok in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    process.stdout.write(`  stored  : ${formatTiers(account.tiers)}\n`);
    process.stdout.write(`  scraped : ${formatTiers(scraped.tiers)}\n`);
    process.stdout.write(
      `  minDeposit stored=${account.minDeposit} scraped=${scraped.minDeposit ?? '(not read)'}\n`,
    );
    if (scraped.minDepositUsd !== undefined || account.minDepositUsd !== undefined) {
      process.stdout.write(
        `  minDepositUsd stored=${account.minDepositUsd} scraped=${scraped.minDepositUsd ?? '(not read)'}\n`,
      );
    }
    if (scraped.detectedScrapeMethod) {
      process.stdout.write(
        `  scrapeMethod stored=${account.scrapeMethod} detected=${scraped.detectedScrapeMethod}\n`,
      );
    }
  } catch (error) {
    process.stdout.write(`  FAILED: ${error.message}\n`);
  }
}
