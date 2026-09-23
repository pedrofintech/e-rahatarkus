// Platform name -> scraper module, for the foreign fintech platforms in
// data/fintech-accounts.json. Separate from scrapers/index.mjs and
// scrapers/flexible/index.mjs because these are neither Estonian banks nor
// term-tiered products: each publishes one rate (sometimes plan-tiered) on
// its own marketing site rather than a regulated Estonian rates page, so the
// pages are less stable and several block plain fetch() outright.

export const SCRAPERS = {
  'trade-republic': () => import('./trade-republic.mjs'),
  'trading-212': () => import('./trading212.mjs'),
  'lightyear': () => import('./lightyear.mjs'),
  'revolut': () => import('./revolut.mjs'),
  'wise': () => import('./wise.mjs'),
  'n26': () => import('./n26.mjs'),
  'bunq': () => import('./bunq.mjs'),
  'interactive-brokers': () => import('./interactive-brokers.mjs'),
};

/** "Trade Republic" -> "trade-republic", "N26" -> "n26" */
export function slugFor(platformName) {
  return platformName.toLowerCase().replace(/\s+/g, '-');
}
