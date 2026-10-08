// Refreshes ALL data files from this machine, including the accounts CI has to
// skip because Cloudflare blocks GitHub's datacenter IPs (Luminor, Trading 212,
// Revolut: `scrapeLocalOnly: true`).
//
//   npm run update:local            # scrape, then show what changed
//   npm run update:local -- --push  # ...and commit, pull --rebase, push, purge the CDN
//
// Run it about once a week. The CI run on Mondays still covers every other
// account; if this is skipped for 14 days the local-only accounts show up as
// "Kontrollimata" on the page (see lib/local-only.mjs).

import { spawnSync } from 'node:child_process';

const PUSH = process.argv.includes('--push');
const FILES = ['data/data.json', 'data/flexible-accounts.json', 'data/fintech-accounts.json'];
const PURGE_BASE = 'https://purge.jsdelivr.net/gh/pedrofintech/e-rahatarkus@main/data/';

// CI must be unset so the local-only accounts are not skipped.
const env = { ...process.env, CI: '', GITHUB_OUTPUT: '' };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: false, ...options });
  return result.status ?? 1;
}

const scripts = ['update-accounts.mjs', 'update-flexible-accounts.mjs', 'update-fintech-accounts.mjs'];
let allFailed = true;
for (const script of scripts) {
  console.log(`\n=== ${script}`);
  // Each script only exits non-zero when EVERY account in it failed.
  if (run(process.execPath, [`scripts/${script}`]) === 0) allFailed = false;
}
if (allFailed) {
  console.error('\nEvery pipeline failed - check your network connection.');
  process.exit(1);
}

const diff = spawnSync('git', ['diff', '--stat', '--', ...FILES], { encoding: 'utf8' }).stdout.trim();
console.log(`\n=== git diff --stat\n${diff || '(no changes)'}`);

if (!diff) {
  console.log('\nNothing to commit.');
  process.exit(0);
}

if (!PUSH) {
  console.log('\nTo publish this: npm run update:local -- --push');
  process.exit(0);
}

const steps = [
  ['git', ['add', ...FILES]],
  ['git', ['commit', '-m', 'chore(data): refresh savings account rates (local)']],
  ['git', ['pull', '--rebase']],
  ['git', ['push']],
];
for (const [command, args] of steps) {
  if (run(command, args) !== 0) {
    console.error(`\n"${command} ${args.join(' ')}" failed - stopping. Nothing was purged.`);
    process.exit(1);
  }
}

console.log('\n=== purging jsDelivr cache');
for (const file of ['data.json', 'flexible-accounts.json', 'fintech-accounts.json']) {
  try {
    const response = await fetch(PURGE_BASE + file);
    const body = await response.json().catch(() => ({}));
    const throttled = Object.values(body.paths ?? {}).some((entry) => entry.throttled);
    console.log(`${file}: HTTP ${response.status}${throttled ? ' (throttled - purge was NOT done, retry later)' : ''}`);
  } catch (error) {
    console.log(`${file}: purge failed (${error.message})`);
  }
}
