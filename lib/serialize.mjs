// Writes data/data.json back out in the hand-maintained house style:
// two-space indent, one line per rate tier, rates to two decimals.
//
// Tier lines are column-aligned, and the padding differs from bank to bank in
// the existing file. Rather than reformatting everything, the current width is
// measured per bank and reused, so banks whose rates did not change come out
// byte-identical and the diff only shows real updates.

const TIER_LINE = /^\s*\{ "months": (\d+,\s*)"rate/;

/** Measure the existing "<months>," column width for each bank. */
export function measureTierWidths(originalText) {
  const widths = new Map();
  let currentBank = null;
  for (const line of originalText.split('\n')) {
    const bankMatch = line.match(/"bank":\s*"([^"]+)"/);
    if (bankMatch) {
      currentBank = bankMatch[1];
      continue;
    }
    const tierMatch = line.match(TIER_LINE);
    if (tierMatch && currentBank && !widths.has(currentBank)) {
      widths.set(currentBank, tierMatch[1].length);
    }
  }
  return widths;
}

/** Detect the line ending already used by the file so it is not rewritten. */
export function detectEol(originalText) {
  return /\r\n/.test(originalText) ? '\r\n' : '\n';
}

function formatTier(tier, width) {
  const months = `${tier.months},`.padEnd(width);
  const rates = Object.entries(tier)
    .filter(([key]) => key !== 'months')
    .map(([key, value]) => `"${key}": ${value.toFixed(2)}`)
    .join(', ');
  return `{ "months": ${months}${rates} }`;
}

function defaultWidth(tiers) {
  const longest = Math.max(...tiers.map((tier) => String(tier.months).length));
  return longest + 2;
}

export function serializeAccounts(data, { tierWidths = new Map(), eol = '\n', trailingNewline = true } = {}) {
  const lines = ['{', `  "lastUpdated": ${JSON.stringify(data.lastUpdated)},`, '  "accounts": ['];

  data.accounts.forEach((account, accountIndex) => {
    const accountComma = accountIndex === data.accounts.length - 1 ? '' : ',';
    lines.push('    {');
    const keys = Object.keys(account);
    keys.forEach((key, keyIndex) => {
      const comma = keyIndex === keys.length - 1 ? '' : ',';
      if (key === 'tiers') {
        const measured = tierWidths.get(account.bank);
        const needed = defaultWidth(account.tiers);
        // Keep the file's existing column unless a longer term no longer fits.
        const width = measured && measured >= needed - 1 ? measured : needed;
        lines.push('      "tiers": [');
        account.tiers.forEach((tier, tierIndex) => {
          const tierComma = tierIndex === account.tiers.length - 1 ? '' : ',';
          lines.push(`        ${formatTier(tier, width)}${tierComma}`);
        });
        lines.push(`      ]${comma}`);
      } else {
        lines.push(`      ${JSON.stringify(key)}: ${JSON.stringify(account[key])}${comma}`);
      }
    });
    lines.push(`    }${accountComma}`);
  });

  lines.push('  ]', '}');
  return lines.join(eol) + (trailingNewline ? eol : '');
}
