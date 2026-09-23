// Bank name -> scraper module, for the flexible-savings (kogumiskonto /
// kogumishoius) products in data/flexible-accounts.json. Kept separate from
// scrapers/index.mjs because these are a different product per bank (e.g.
// Bigbank's slug there already means its term deposit) and a different data
// shape (one flat rate, not term tiers) - see lib/parse.mjs assertPlausibleRate.

export const SCRAPERS = {
  'bigbank': () => import('./bigbank.mjs'),
  'coop-pank': () => import('./coop-pank.mjs'),
  'lhv': () => import('./lhv.mjs'),
  'swedbank': () => import('./swedbank.mjs'),
  'seb': () => import('./seb.mjs'),
};

export { slugFor } from '../index.mjs';
