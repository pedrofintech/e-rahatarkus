// Dependency-free helpers for pulling rate tables out of bank HTML.

const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  euro: '€', shy: '', ndash: '-', mdash: '-', minus: '-',
};

function decodeEntities(input) {
  return input
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** Strip tags, decode entities and collapse whitespace into a single line. */
export function toText(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/[   ]/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract every <table> as { rows, text, context }.
 * `context` is the plain text immediately preceding the table, which is how
 * most of these pages label which rate table you are looking at.
 */
export function extractTables(html) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let match;
  while ((match = tableRe.exec(html)) !== null) {
    const inner = match[1];
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(inner)) !== null) {
      const cells = [...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
        .map((cell) => toText(cell[1]));
      if (cells.length > 0) rows.push(cells);
    }
    const endIndex = match.index + match[0].length;
    tables.push({
      rows,
      text: toText(inner),
      context: toText(html.slice(Math.max(0, match.index - 1500), match.index)).slice(-300),
      after: toText(html.slice(endIndex, endIndex + 1500)).slice(0, 300),
    });
  }
  return tables;
}

/** Find the first table whose text or preceding context matches `pattern`. */
export function findTable(tables, pattern) {
  return tables.find((table) => pattern.test(table.context) || pattern.test(table.text));
}

/**
 * Parse an Estonian-formatted percentage into a number.
 * Accepts "2,20%", "2.20 %", "2,20" and "0". Returns null when there is no number.
 */
export function parseRate(value) {
  const text = toText(value).replace('%', '').replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number.parseFloat(text);
}

/**
 * Convert an Estonian period label into a month count.
 *
 * Ranges collapse to their upper bound ("1 - 2 kuud" -> 2), which is the
 * convention data.json already uses. Open-ended ranges ("60 -") come back as
 * { openEnded: true } so the caller decides what bound to store.
 * Sub-month labels ("< 1 kuu") and non-period text return null.
 */
export function parsePeriod(label) {
  const text = toText(label).toLowerCase();
  if (!text || /^</.test(text) || /\balla\b/.test(text)) return null;

  const isYears = /\ba\.|\baasta/.test(text);
  const isMonths = /\bkuu/.test(text);
  if (!isYears && !isMonths) return null;

  const numbers = [...text.matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((m) => Number.parseFloat(m[0].replace(',', '.')))
    .filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return null;

  const openEnded = /\d\s*[-–]\s*(?:kuud?|aastat?|a\.)?\s*$/.test(text) && numbers.length === 1;
  const bound = numbers[numbers.length - 1];
  const months = isYears ? Math.round(bound * 12) : Math.round(bound);
  if (!Number.isInteger(months) || months < 1 || months > 600) return null;
  return { months, openEnded };
}

/** Sort tiers by term and drop duplicate month values (first one wins). */
export function normalizeTiers(tiers) {
  const seen = new Map();
  for (const tier of tiers) {
    if (!seen.has(tier.months)) seen.set(tier.months, tier);
  }
  return [...seen.values()].sort((a, b) => a.months - b.months);
}

/**
 * Guard against a silently-broken parse: a layout change usually shows up as
 * zero tiers, a suspiciously short table, or nonsense rates.
 */
export function assertPlausibleTiers(bank, tiers, { minCount = 3, maxRate = 10 } = {}) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error(`${bank}: parsed zero rate tiers - page structure has probably changed`);
  }
  if (tiers.length < minCount) {
    throw new Error(
      `${bank}: only ${tiers.length} tier(s) parsed, expected at least ${minCount} - page structure has probably changed`,
    );
  }
  for (const tier of tiers) {
    if (!Number.isInteger(tier.months) || tier.months < 1) {
      throw new Error(`${bank}: bogus term "${tier.months}" months`);
    }
    for (const [key, value] of Object.entries(tier)) {
      if (key === 'months') continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maxRate) {
        throw new Error(`${bank}: bogus ${key} value "${value}" for ${tier.months} months`);
      }
    }
  }
  if (tiers.every((tier) => Object.keys(tier).every((k) => k === 'months' || tier[k] === 0))) {
    throw new Error(`${bank}: every rate parsed as 0 - page probably rendered without data`);
  }
  return tiers;
}

/**
 * Same guard as assertPlausibleTiers, for flexible-savings products that
 * publish a single variable rate rather than a term-tiered table.
 */
export function assertPlausibleRate(bank, rateEur, { maxRate = 10 } = {}) {
  if (typeof rateEur !== 'number' || !Number.isFinite(rateEur) || rateEur < 0 || rateEur > maxRate) {
    throw new Error(`${bank}: bogus rate value "${rateEur}" - page structure has probably changed`);
  }
  return rateEur;
}

/**
 * Convert an Estonian date ("27.05.2026") into ISO form ("2026-05-27").
 * Returns null when the text holds no such date.
 */
export function parseEstonianDate(text) {
  const match = toText(text).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * Pull a rates-effective date out of `text` using a bank-specific anchor.
 * Banks that do not publish one simply return null - that is not an error.
 */
export function findEffectiveDate(text, anchor) {
  const match = toText(text).match(anchor);
  return match ? parseEstonianDate(match[0]) : null;
}
