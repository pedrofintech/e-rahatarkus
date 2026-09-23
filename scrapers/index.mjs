// Bank name -> scraper module. Imports are lazy so running a single bank does
// not pull Playwright in for the ones that do not need it.

export const SCRAPERS = {
  'lhv': () => import('./lhv.mjs'),
  'coop-pank': () => import('./coop-pank.mjs'),
  'bigbank': () => import('./bigbank.mjs'),
  'holm-bank': () => import('./holm-bank.mjs'),
  'inbank': () => import('./inbank.mjs'),
  'swedbank': () => import('./swedbank.mjs'),
  'seb': () => import('./seb.mjs'),
  'luminor': () => import('./luminor.mjs'),
  'citadele': () => import('./citadele.mjs'),
};

/** "Coop Pank" -> "coop-pank" */
export function slugFor(bankName) {
  return bankName.toLowerCase().replace(/\s+/g, '-');
}
