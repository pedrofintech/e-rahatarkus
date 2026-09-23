# Hoiuste ja säästukontode võrdlus — frontend

Interactive savings comparator for e-rahatarkus.ee, same GitHub + jsDelivr +
Webflow-embed pattern as the Euribor tool. Covers three genuinely different
product shapes in one merged, filterable list - see "Data model" below.

## Source of truth vs. generated files
Only five files are hand-edited. Everything else under `web/` is generated
from them by `node scripts/build-web.mjs` (`npm run build:web`) — **run that
after any change** to one of these:
- `comparator.js` — app logic + HTML templates + the calculator/simulator.
- `comparator.css` — styles (scoped under `#rt-hoius`).
- `../data/data.json` — Estonian term deposit rates and account facts.
- `../data/flexible-accounts.json` — Estonian flexible-savings (kogumiskonto/
  kogumishoius) rates and facts.
- `../data/fintech-accounts.json` — foreign fintech platform rates and facts.

Generated (do not hand-edit, they get overwritten):
- `comparator.js`'s own `STYLES` variable (re-inlined from `comparator.css`).
- `webflow-embed-nocss-1.html` + `webflow-embed-nocss-2.html` — comparator.js's
  logic with data baked in and no CSS injection (styles come from
  `webflow-head-css.html` pasted into Webflow's page `<head>` instead). Split
  across **two** HTML Embed blocks because Webflow caps each Embed at 50,000
  characters and everything no longer fits in one. Embed 1 (~37 KB) carries
  the three datasets AND, in a second `<script>` tag, every pure model/data
  function comparator.js has (formatting helpers, the rate model, filter
  predicates, `mergeAccounts()`) as `window.RT_MODEL` - see the "Model/UI
  split" gotcha below for why. Embed 2 (~43 KB) has the mount point and the
  UI layer (rendering, event binding, boot), which destructures what it needs
  off `window.RT_MODEL`. **Paste both, Embed 1 immediately followed by
  Embed 2, in that order** — the build script warns if either ever grows past
  50,000 chars.
- `webflow-head-css.html` — `comparator.css` wrapped in a `<style>` tag.
- `self-contained-test.html` — comparator.js's logic + all three datasets +
  CSS, all in one standalone HTML file you can open straight from disk, no
  server needed (not subject to the 50,000-char limit or the model/UI split
  since it's a full page, not a Webflow Embed).

Previously these were separate hand-maintained copies of the whole script and
they drifted from each other (e.g. `comparator.preview.js` had a bugfix that
`comparator.js` didn't). `comparator.preview.js` has been removed; `preview.html`
now loads `comparator.js` directly via `window.RT_DATA_URL_OVERRIDE`.

- `webflow-loader.html` — paste ONCE into the page's HTML Embed in Webflow.
  This is the live production path: it pulls `comparator.js` from jsDelivr,
  which fetches `data/data.json` at runtime and injects its own CSS. It needs
  no regeneration.
- `preview.html` — open locally in a browser to see the tool without Webflow
  (reads all three `../data/*.json` files, loads `comparator.js` directly).

## How the page is built in Webflow
1. Native Webflow hero (breadcrumb, H1, lead, stats, author byline) — same as the
   eToro / article pages. NOT in the embed.
2. One HTML Embed block with the contents of `webflow-loader.html`.
3. Native Webflow FAQ / Sõnastik block below (recommended, like the loan calculators).

## Data model
Three JSON files, merged into one `ACCOUNTS` list at runtime by
`mergeAccounts()` in comparator.js, tagged by `kind`:

- **`data/data.json`** (`kind: 'term'`, `locked: true`) → `{ lastUpdated,
  accounts: [...] }`. Each account has term-based `tiers: [{ months, rateEur,
  rateUsd? }]`. The simulator picks the best-rate tier whose term ≤ the
  user's chosen months and computes simple interest **over that tier's own
  term**, net of 22% tulumaks — never over the term the user typed, since a
  bank has no product that pays an 11-month rate for 12 months. When the
  applied term differs from what the user entered, the card shows an
  explicit alert saying so. Balance tiers (the Portuguese "escalões" model)
  are NOT used here.
- **`data/flexible-accounts.json`** (`kind: 'flexible'`, `locked: false`) —
  Estonian kogumiskonto/kogumishoius products. One flat variable `rateEur`
  instead of tiers; `withdrawal: { speed, fee }` and `payoutFrequency`
  instead of the term-deposit-specific `earlyWithdrawal`/`autoRenewal`/
  `payoutTiming` fields.
- **`data/fintech-accounts.json`** (`kind: 'fintech'`, `locked: false`) —
  foreign platforms (Trade Republic, Trading 212, Lightyear, Wise, N26,
  Revolut, bunq, Interactive Brokers). Keyed by `platform` instead of `bank`
  (mergeAccounts() copies it over). One flat `rateEur`, occasionally
  `rateEurMin` for a published range or `tiers: [{ plan, rateEur }]` for a
  plan-tiered product like N26. `protectionScheme`/`taxNote` describe a
  materially different reality from the Estonian banks: most of these do
  NOT withhold Estonian tulumaks (self-declare instead) and several only
  carry investor-compensation cover (20 000 €), not a real deposit guarantee
  (100 000 €) - see `guaranteeCountry` below.

All three share a `guaranteeCountry` field (`'EE'`, `'LV'`, `'DE'`, `'LT'`,
`'NL'`, or `null`) used for both the "Tagatis" fact/filter AND the
`gTagatisfond`/`gLati` filter predicates in comparator.js. This is
deliberately a separate structured field, not sniffed out of the free-text
`guaranteeScheme` description: several fintech accounts describe a FOREIGN
scheme using the same Estonian word "Tagatisfond(i)" that Eesti Tagatisfond
itself uses (it's the generic Estonian term for "deposit guarantee fund"),
so a `/Tagatisfond/i` regex on the prose would wrongly count them as Eesti
Tagatisfond cover. `null` means investor-compensation cover only (typically
20 000 €), not a real per-institution deposit guarantee (100 000 €).

We intentionally do NOT claim a product has "no extra conditions" anywhere: cards
say exactly what we checked ("Palgakontot pole vaja", "Kuutasu puudub") and point
to the bank's own page for the rest. For term deposits, early withdrawal,
auto-renewal, interest payout timing, maximum deposit and account-opening
requirements ARE verified per bank (sourced directly from each bank's published
deposit contract terms, not just the marketing page) and shown in each card's
expanded details - see `earlyWithdrawal`, `autoRenewal`, `payoutTiming`,
`maxDeposit` and `accountOpening` in data.json. Where a bank doesn't publish a
figure (e.g. no stated maximum deposit), the field is `null` and the row is
simply omitted rather than guessed.

**ID collision note:** several banks sell both a term deposit AND a flexible
product under the SAME bank name (e.g. SEB's Tähtajaline hoius and Digikassa),
so `bank` alone is not a unique key once the three datasets are merged. Every
account gets `id = kind + ':' + bank + ':' + product` in `mergeAccounts()`, and
all DOM/state keying (`data-id`, `data-compare`, `state.expanded`,
`state.compare`, compare-table lookups) uses `a.id`, never `a.bank`, on
purpose - reintroducing a bank-keyed lookup would silently conflate two
different products from the same bank.

## Compare
Cards have a "Võrdle" checkbox (max 3 at once, `COMPARE_MAX` in comparator.js).
Selecting one or more shows a sticky bottom tray; "Võrdle N hoiust" opens a
side-by-side table above the results, using the user's entered amount/term when
a simulation is active. Any mix of kinds can be compared together (a term
deposit against a flexible account against a fintech platform) - the compare
tray/table label each entry as "Bank · Product", not just the bank name, since
the same bank can appear twice (its term deposit and its flexible product).

## Webflow gotchas hit in production
- **`svg{width:100%}`**: Webflow's own global stylesheet ships an unscoped
  rule that stretches every `<svg>` to fill its container. CSS cascades
  per-property, so our scoped `#rt-hoius .foo svg{flex:...}` rules didn't
  block it since they never set `width` themselves - every icon (chevrons,
  checkmarks) was stretching to 100% of its row, squeezing sibling text to
  0px and wrapping it (this is what made "Kulu ja tingimused" wrap onto 3
  lines and chevrons look centered instead of right-aligned). Fixed by
  `#rt-hoius svg{width:auto;height:auto}` in comparator.css, which wins on
  specificity and reverts every icon to its own `width`/`height` attribute.
  If a future icon looks stretched again, this rule (or its `#rt-hoius`
  specificity) is the first thing to check.
- **Sticky sidebar under Webflow's navbar**: `.rt-filters` uses plain CSS
  `position:sticky` (not a JS scroll handler - an earlier version toggled
  position:fixed/absolute on every scroll frame, forced synchronous layout
  reads, and could visibly desync the scrollbar). `initStickySidebar()` in
  comparator.js only computes the one `--rt-sticky-top` offset (how tall the
  site's fixed navbar is) and lets the browser do the actual pinning.
  Detection does NOT rely on tag/class naming (`<nav>`, `.navbar`, etc.) -
  on this live site the actual fixed element is `<div class="nav_fixed">`
  wrapping a `.nav_component` that is itself `position:relative`, matching
  none of those patterns. Instead it scans every element for whichever ones
  are *actually* computed `fixed`/`sticky`, flush against the top, and wide
  enough to be chrome rather than a small widget - a behavioural check, not
  a naming guess. It only runs a few times total (init/resize/fonts-ready),
  never per scroll frame, so the full-page scan is not a perf concern. If it
  ever still picks the wrong height, set this **before** the embed script
  runs (e.g. in Webflow's page-level custom code, above the embed):
  ```html
  <script>window.RT_HEADER_OFFSET = 81;</script>
  ```
  (81 is this site's measured navbar height at the time of writing.)
- **Sticky sidebar silently not sticking at all**: any ancestor with a
  non-visible `overflow` (`overflow`/`overflow-x`/`overflow-y` other than
  `visible`) permanently disables native `position:sticky` for everything
  inside it - confirmed on the live site, where a Webflow section
  (`section_hero-calculadora`) wraps the whole embed in `overflow:hidden`.
  `initStickySidebar()` in comparator.js walks the ancestor chain once on
  load; if it finds a blocker, it adds `.rt-js-sticky` to `#rtLayout` and
  switches to a JS-driven `position:fixed`/`absolute` pin (immune to
  ancestor overflow, since fixed/absolute positioning is computed against
  the viewport / a chosen containing block, not clipped by it). It only
  ever writes to the DOM on an actual flow→pinned→settled transition, never
  on every scroll frame, which is what keeps it jitter-free. Ordinary pages
  without a clipping ancestor never load this fallback at all.
- **Tooltip bubbles clipped inside the filters sidebar**: `.rt-tip__bubble`
  used to be `position:absolute`, which got clipped by
  `.rt-filters__scroll`'s own `overflow-y:auto` for any tip near the bottom
  of the list. Same fix as the sidebar: it's `position:fixed` now, with its
  top/left computed in JS (`positionTipBubble()`) from the trigger button's
  real viewport position on hover/focus/open, flipping below the button and
  clamping to viewport edges when there's no room above.
- **A literal `</script>` string inside JS breaks the generated embeds**:
  see `assertScriptTagsBalanced()` in `scripts/build-web.mjs` - the HTML
  tokenizer closes a `<script>` element the instant it sees that character
  sequence, even inside a JS comment or string, dumping everything after it
  onto the page as plain visible text. The build now fails loudly if this
  ever happens again; if you see raw JS source rendering as page text, this
  is almost certainly why - `grep -n '</script' web/comparator.js`.
- **The sort control is a real custom dropdown (`.rt-select`), not a native
  `<select>`**: a native select's open option list is rendered by the
  OS/browser chrome and cannot be restyled by CSS in any browser, so no
  amount of CSS on it will ever match a real Webflow dropdown component
  once it's open - only its closed/idle state can be styled. `renderSortSelect()`
  in comparator.js renders the toggle + option list from `SORT_LABELS`/`SORT_ORDER`;
  `bind()` handles opening, selecting, closing on outside click (both an
  in-root listener and a `document`-level one, since a click on real page
  content outside `#rt-hoius` never reaches the in-root listener), and
  Escape. If you add a new sort mode, it only needs an entry in
  `SORT_LABELS`/`SORT_ORDER` - don't reintroduce a `<select>`.
  `.rt-select__option`'s default/active colors (`#222`/`#0082f3`) are
  hardcoded literal hex, not design tokens, on purpose - they're the real
  computed values read directly off palgakalkulaator's live dropdown
  (captured via Playwright, including forcing `:hover`), not our own brand
  palette. The active option is NOT bold there (still `font-weight:400`),
  which looked like an odd choice until it was verified against the real
  page. Hover deliberately deviates from that reference on request: it uses
  our own `var(--brand)` instead of their slightly different hover blue, so
  it reads as "this app's brand color" rather than a mismatched second blue.
- **`webflow-embed-nocss-2.html` strips comments** (`stripComments()` in
  `scripts/build-web.mjs`) to keep headroom under Webflow's 50,000-char
  limit. `comparator.js` and `self-contained-test.html` keep full comments;
  only the Webflow embed output is stripped. If you add a lot of new code,
  check the build's logged char count for `webflow-embed-nocss-2.html` (it
  warns past 50,000) - and see the next entry if comment-stripping alone
  isn't enough headroom anymore.
- **Model/UI split, when comment-stripping alone isn't enough**: adding the
  flexible/fintech products pushed the app script itself (not the data -
  that was already split out in embed 1) past 50,000 chars even with every
  comment stripped. Webflow's limit is per Embed BLOCK, not per `<script>`
  tag though, so `scripts/build-web.mjs` now finds the `/* ---------- state
  ---------- */` marker comment in comparator.js's body and splits
  everything BEFORE it (formatting helpers, the rate model, filter
  predicates, `BANK_STYLE`, `mergeAccounts()` - no dependency on `state`,
  `ACCOUNTS`/`META` or the DOM) into a second `<script>` inside embed 1,
  exposed as `window.RT_MODEL`. Embed 2 destructures what it needs off that
  at the top of its own IIFE. The export/import list is auto-detected (every
  top-level `function name(` / `var name =` before the marker), specifically
  so nobody has to hand-maintain it as the app grows - **but this means every
  top-level model-layer declaration must use its own `var name = ...;`
  statement, never a comma-joined `var a = ..., b = ...;`**, since the
  detector regex only captures the first name in a compound declaration (a
  real bug caught during review: `KEY_GROUP` silently failed to export until
  split into its own `var` line).
  **The single most important invariant this split depends on**: `state`,
  `ACCOUNTS` and `META` (and everything that reads them - `filtered()`,
  `sorted()`, `accountById()`, etc.) MUST stay in the UI layer, physically
  AFTER the marker. A `var` destructured from `window.RT_MODEL` is a fresh
  binding - reassigning it in the UI script (e.g. `ACCOUNTS =
  mergeAccounts(...)` in `init()`) would never be visible back in the model
  script if any model-layer code still read the *old* `ACCOUNTS` binding.
  If you move code across the marker, keep this one-directional
  (UI-depends-on-model, never the reverse) constraint in mind.
- **Filter checkboxes: OR within a group, AND across groups**: `filtered()`
  groups active filter keys by `KEY_GROUP` (built from `GROUPS` in
  comparator.js) and requires at least one match per group with any active
  keys, not every active key everywhere. Without this, checking BOTH
  "Tähtajaline (raha lukus)" and "Paindlik (raha kättesaadav)" - a real thing
  a user would do to explicitly ask for both kinds - ANDs them together and
  matches literally nothing, since no account is both locked and unlocked.
  Caught via an automated Playwright smoke test of the actual generated
  embed files (not just comparator.js in isolation) before this shipped; the
  same latent bug already existed for the original `gTagatisfond`/`gLati`
  pair (checking both used to also yield zero results) and is fixed by the
  same change.

## Matching the site's shared input/select styling
`.rt-input input` and `.rt-sort` are deliberately styled to match the site's
own form components (e.g. the amount/period fields on `/palgakalkulaator`):
44px height, 1px `#ced5df` border, 12px radius, and a `0 0 0 4px hsla(220,100%,91%,.24)`
focus ring. These were pulled from the Webflow site's actual `.form_input`
and `.dropdown-toggle-2` style definitions via the Webflow MCP connection
(`data_style_tool` → `query_styles`) rather than guessed from a screenshot -
prefer that over eyeballing computed styles if it's available, since Webflow
class definitions are the real source of truth and a computed-style probe
can miss things like `-moz-appearance` gaps.

## Design tokens
Rahatarkus blue brand `#0072ce` (NOT the Portuguese orange), Inter + Tiempos
Headline, pulled from the live Webflow site. All classes are prefixed `rt-` to
avoid collisions with Webflow's own styles.

## Changing the repo/owner
If the repo isn't `pedrofintech/savings-comparator`, update the URL in two places:
`comparator.js` (`BASE_URL`, which all three `*_DATA_URL` constants derive from)
and `webflow-loader.html` (script src).

## After any change
```
node scripts/build-web.mjs
```
Then, after pushing to `@main`, purge jsDelivr:
`https://purge.jsdelivr.net/gh/USER/REPO@main/web/comparator.js`
