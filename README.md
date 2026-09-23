# e-rahatarkus savings & deposit comparator

Data pipeline + embeddable widget that powers the term deposit / savings
account comparator on e-rahatarkus.ee. Scrapers collect rates directly from
each bank's or platform's own page, a GitHub Action refreshes them weekly and
commits whatever changed, and the frontend widget reads the resulting JSON
straight from this repo via jsDelivr - no backend, no build step for the
consumer, no API keys anywhere in the pipeline.

This repo is also the reference pattern for the two tools that will follow
it (EUPF comparator, broker comparator): same layout, same scraper/lib split,
same GitHub Action shape. See "Adding a new scraper / reusing this pattern"
below before starting either.

## How it fits together

```
scrapers/*.mjs        one file per bank/platform - fetches + parses its page
      |
lib/parse.mjs          shared parsing helpers (rate tables, tier extraction)
lib/serialize.mjs       writes the merged result back to data/*.json, stable formatting
lib/http.mjs            fetch wrapper (timeout, UA, optional Playwright fallback)
lib/cli.mjs              shared `node scrapers/xxx.mjs` entrypoint boilerplate
      |
scripts/update-*.mjs    runs every scraper in a pipeline, diffs against the
                        committed data/*.json, writes only if something moved
      |
data/*.json             the three committed datasets (see below) - this is
                        the actual product: everything else exists to keep
                        it accurate
      |
web/comparator.js       the widget: fetches data/*.json from jsDelivr at
                        runtime and renders the comparator, filters,
                        calculator and compare table
```

`.github/workflows/update-rates.yml` runs `scripts/update-*.mjs` weekly
(and on demand via `workflow_dispatch`), and commits `data/*.json` only when
a rate actually changed - a `checkedOn`-only diff is not committed, since the
workflow run history already proves we looked.

## Data model

Three JSON files, merged at runtime by `mergeAccounts()` in
`web/comparator.js`:

- **`data/data.json`** - Estonian term deposits (locked, tiered by month).
- **`data/flexible-accounts.json`** - Estonian flexible savings accounts
  (kogumiskonto/kogumishoius, one flat variable rate).
- **`data/fintech-accounts.json`** - foreign fintech platforms (Trade
  Republic, Trading 212, Lightyear, Wise, N26, Revolut, bunq, Interactive
  Brokers).

Full field-level documentation (what each property means, the guarantee-
scheme logic, the ID-collision handling for banks with two products, etc.)
lives in `web/README.md` next to the code that reads it.

## Setup

```
npm ci
npx playwright install --with-deps chromium   # only needed for scrapers that require a real browser
npm test                                      # offline parser tests against test/fixtures
```

Node 22 (see the GitHub Action for the pinned version).

## Running a scraper locally

```
node scripts/update-accounts.mjs          # term deposits -> data/data.json
node scripts/update-flexible-accounts.mjs # flexible accounts -> data/flexible-accounts.json
node scripts/update-fintech-accounts.mjs  # fintech platforms -> data/fintech-accounts.json
```

Each of these runs every scraper in its category, diffs the result against
the committed file, and only rewrites it if a rate or fact actually changed.
A single bank/platform failing does not block the others - see the comment
at the top of `update-rates.yml` for how that's surfaced in CI.

To debug one scraper in isolation:

```
node scrapers/lhv.mjs
```

## Frontend build

`web/comparator.js` + `web/comparator.css` + `data/*.json` are the only
hand-edited frontend sources. Everything else under `web/` (the Webflow
embed HTML, the self-contained test page, the head-CSS snippet) is
generated from them:

```
npm run build:web
```

Run that after any change to `comparator.js`, `comparator.css`, or any of
the three data files. See `web/README.md` for what each generated file is
for and where it gets pasted in Webflow.

## No secrets in this repo

Every scraper reads a public page over plain HTTP(S) - there is nothing here
that needs an API key, and nothing should ever be hardcoded into the
scrapers or committed to this repo. If a future scraper genuinely needs a
credential, it must come from a GitHub Actions secret (`secrets.X`, injected
as an env var in `update-rates.yml`) - never a literal in the source.

## Adding a new scraper / reusing this pattern

1. Add `scrapers/<name>.mjs` (or `scrapers/<category>/<name>.mjs` for a
   flexible/fintech-style product) following an existing file in the same
   category as a template - it exports a `scrape()` that returns the parsed
   account shape, and uses `lib/cli.mjs`'s `runAsScript()` for the standalone
   `node scrapers/<name>.mjs` entrypoint.
2. Register it in that category's `scrapers/index.mjs` (or
   `scrapers/<category>/index.mjs`).
3. Add a fixture under `test/fixtures*/` (captured via
   `scripts/capture-fixtures.mjs` and friends) and a parser test in `test/`
   so CI catches a broken page layout before it ever reaches `data/*.json`.
4. Run `npm test`, then `node scripts/update-*.mjs` locally to confirm it
   writes the expected shape.

For a new tool (EUPF, broker comparator) in its own repo, copy this same
`lib/` + `scrapers/` + `scripts/` + `test/` + `.github/workflows/update-*.yml`
layout rather than inventing a new one - `lib/http.mjs`, `lib/parse.mjs`,
`lib/serialize.mjs` and `lib/cli.mjs` are written to be product-agnostic and
should be reusable close to as-is.

## Frontend delivery (jsDelivr)

The widget and its data are served straight from this repo via jsDelivr's
GitHub CDN (`cdn.jsdelivr.net/gh/<org>/<repo>@main/...`) - see `BASE_URL` in
`web/comparator.js` and the `<script src>` in `web/webflow-loader.html`. If
this repo is ever renamed or moved, both of those need updating, and the
GitHub Action's own jsDelivr cache-purge step (`update-rates.yml`) uses
`${{ github.repository }}` so it never needs a manual change.

Because jsDelivr caches the raw file, `update-rates.yml` purges the CDN
cache for all three `data/*.json` files after every commit it makes - so a
new rate is live within seconds of the Action running, not whenever the CDN
cache would otherwise expire.
