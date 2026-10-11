# Maaklerite võrdlus (broker comparator)

Broker comparator for e-rahatarkus.ee. It is the Estonian version of the EU Personal Finance
comparator (`franklinsilvapt-arch/corretoras-comparator`, folder `eu/`), with Estonian banks added
and an Estonian layer on top: Baltic stocks, investeerimiskonto, VAT on bank custody fees.
Same GitHub + jsDelivr + Webflow embed pattern as the savings comparator in `web/`.

## Files

| File | What it is |
|---|---|
| `data/brokers.json` | Everything shown in the table: fees, interest, protection, offers, links. Edit here. |
| `broker-comparator.js` | Rendering and the cost formulas (`CALC`) for the four scenarios at the top. |
| `broker-comparator.css` | Styles, all scoped under `#rt-bc`. Colours and fonts follow `web/comparator.css`. |
| `webflow-embed.html` | What goes into the HTML Embed on the Webflow page. |
| `preview.html` | Local preview without Webflow (reads `data/brokers.json` from this folder). |

The script loads its CSS from the folder it was loaded from, so the Webflow embed is two lines.
Data comes from `@main`, so a data edit goes live without touching Webflow.

Logos: a broker's `"logo"` (a URL) in the JSON wins. Without one, the script uses the EU comparator's
`logos.js` (data URIs, pinned to a commit of `franklinsilvapt-arch/corretoras-comparator`), and
without that the broker's initials on its `color`. Add `"logoBare": true` for a logo that must be
shown as it is, with no frame (Lightyear, same as on the savings comparator).

## Editing data

Each broker in `data/brokers.json` has:

- `t` with one entry per table row: `{"v": "value", "s": "small note under it"}`.
  Add `"c": true` to show the yellow "Kinnitamata" tag. A row missing from `t` shows only that tag.
- `cta.href` for the "Ava konto" button (affiliate links get `rel="sponsored"`, add `"plain": true` for a normal link).
  `cta.probe` and `cta.fallback`: if the probe URL is blocked in the reader's browser (ad blockers block
  Impact's `sjv.io`), the button uses the fallback instead. Only Trade Republic needs this today.
- `offer` for the blue sign-up box: `{"t": "text", "c": "CODE", "a": "link to the article"}`.
- `review` for the "Loe ülevaadet" link, `src` for the price list link in the Allikad row.
- `verified`: date shown under the price list link.

Top level: `lastUpdated` (ISO date) fills the "Viimati uuendatud ..." text in the page hero
(element with ID `rt-last-updated`, same as the savings comparator). `verified` is the date range
shown in the notes. `pairs` maps two broker ids to an article slug under `/artiklid/`.

After pushing a data change, purge the CDN so it shows within minutes:
`https://purge.jsdelivr.net/gh/pedrofintech/e-rahatarkus@main/brokers/data/brokers.json`

## Editing formulas

`CALC` in `broker-comparator.js` has four functions per broker: `etf(amount)`, `us(amount)`,
`plan(monthly)` (cost over a year) and `custody(portfolio)` (cost over a year). Each returns
`{v, s}`: the cost in euros and a one-line explanation. Two optional flags:

- `extra: '+ valuutavahetus'` when part of the cost is not published (the banks' FX margin).
  The cell then shows the text after the number and never gets the "Odavaim" tag.
- `c: true` to show "Kinnitamata".

A broker in the JSON without a `CALC` entry is not shown. `TOP` sets the brokers selected on load.

The banks use the cheapest route the price list offers: LHV Kasvukonto and SEB mikroinvesteerimine
(0,5% with no minimum) beat the 0,14% (min 5 €) securities account for small ETF purchases.
Custody above 100 000 € includes VAT (`assumptions.VAT`, 24%).

## Deploying a code change

1. Push to `main`.
2. In Webflow, change the commit in the embed's script URL to the new commit SHA
   (`@<sha>/brokers/broker-comparator.js`). The CSS follows the script's commit.
3. Publish.

Pinning the script to a commit means a code change never reaches the live page before it is published.

## Local preview

From the repo root: `python3 -m http.server 8080`, then open
`http://localhost:8080/brokers/preview.html`.

## Open points for v1

- Luminor is missing: its price list sits behind a Cloudflare check.
- SEB interest on the current account is not in the data (shows "Kinnitamata").
- Revolut's commission for Estonia, Interactive Brokers' Baltic fee and Bitpanda as an
  investeerimiskonto are marked "Kinnitamata".
- Affiliate links: Trade Republic and eToro use the same tracking links as the Rahatarkus articles.
  DEGIRO and Interactive Brokers use the EU Personal Finance tracking links (`/kulasta/ib` lands on
  IBKR with no tracking code).
- Sign-up offers left out on purpose: DEGIRO's fee refund (sign-ups until 31.10.2026) and XTB's free
  share. Neither is confirmed for Estonian residents. Trade Republic has no sign-up offer.
- Trading 212: the data shows both entities (EU GmbH and Markets Ltd). Check which one serves Estonian clients.
