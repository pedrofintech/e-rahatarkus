/*
 * Rahatarkus - Hoiuste ja säästukontode võrdlus (savings comparator)
 * Served from GitHub + jsDelivr, injected into #rt-hoius by a tiny Webflow loader.
 *
 * Code, comments and identifiers are in English for reuse across the network's
 * other sites; all user-facing strings stay in Estonian.
 *
 * Data model note: this merges THREE differently-shaped datasets into one
 * ACCOUNTS list, tagged by `kind` (see mergeAccounts() below):
 *   'term'     - data/data.json. Estonian term deposits (tähtajaline hoius).
 *                Interest is tiered by TERM LENGTH in months:
 *                `tiers: [{ months, rateEur }]`. Money is locked for the
 *                term (`locked: true`).
 *   'flexible' - data/flexible-accounts.json. Estonian kogumiskonto/
 *                kogumishoius products: one flat variable `rateEur`, money
 *                available any time (`locked: false`).
 *   'fintech'  - data/fintech-accounts.json. Foreign fintech cash/savings
 *                products: one flat variable `rateEur` (occasionally
 *                `rateEurMin` for a published range, or `tiers: [{ plan,
 *                rateEur }]` for a plan-tiered product like N26). Also
 *                `locked: false`.
 * mergeAccounts() is the only place that reads each kind's raw field names;
 * it normalizes the handful of properties every kind needs in common (bank
 * name, guarantee scheme/country, minimum deposit, salary/fee requirements)
 * so filtering, sorting, the simulator and card rendering can treat every
 * product the same way except where a `kind`/`locked` check is genuinely
 * necessary (mainly: does this product have a term to mismatch, and does it
 * have a tier table to show).
 */
(function () {
  'use strict';

  var MOUNT_ID = 'rt-hoius';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/pedrofintech/e-rahatarkus@main/data/';
  var DATA_URL = BASE_URL + 'data.json';
  var FLEXIBLE_DATA_URL = BASE_URL + 'flexible-accounts.json';
  var FINTECH_DATA_URL = BASE_URL + 'fintech-accounts.json';
  if (typeof window !== 'undefined' && window.RT_DATA_URL_OVERRIDE) DATA_URL = window.RT_DATA_URL_OVERRIDE;
  if (typeof window !== 'undefined' && window.RT_FLEXIBLE_DATA_URL_OVERRIDE) FLEXIBLE_DATA_URL = window.RT_FLEXIBLE_DATA_URL_OVERRIDE;
  if (typeof window !== 'undefined' && window.RT_FINTECH_DATA_URL_OVERRIDE) FINTECH_DATA_URL = window.RT_FINTECH_DATA_URL_OVERRIDE;
  var TAX = 0.22; // Estonian income tax on interest (tulumaks)
  var PAGE = 8;

  /* ---------- formatting helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function d(n, c) { return n.toFixed(c).replace('.', ','); }
  function mil(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function eur(n) { return mil(n) + ' €'; }
  function eur2(n) {
    var s = d(n, 2).split(',');
    return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + s[1] + ' €';
  }
  function pct(n) { return d(n, 2) + '%'; }

  var CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
  var CROSS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
  var INFO = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.05967 5.99992C6.21641 5.55436 6.52578 5.17866 6.93298 4.93934C7.34018 4.70002 7.81894 4.61254 8.28446 4.69239C8.74998 4.77224 9.17222 5.01427 9.47639 5.3756C9.78057 5.73694 9.94705 6.19427 9.94634 6.66659C9.94634 7.99992 7.94634 8.66659 7.94634 8.66659M7.99967 11.3333H8.00634M14.6663 7.99992C14.6663 11.6818 11.6816 14.6666 7.99967 14.6666C4.31778 14.6666 1.33301 11.6818 1.33301 7.99992C1.33301 4.31802 4.31778 1.33325 7.99967 1.33325C11.6816 1.33325 14.6663 4.31802 14.6663 7.99992Z" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function yes() { return '<span class="rt-yes" role="img" aria-label="Jah">' + CHECK + '</span>'; }
  function no() { return '<span class="rt-no" role="img" aria-label="Ei">' + CROSS + '</span>'; }
  function bool(b) { return b ? yes() : no(); }
  function tip(t) {
    return t ? '<span class="rt-tip"><button type="button" class="rt-tip__btn" aria-label="Näita selgitust">' + INFO + '</button><span class="rt-tip__bubble" role="tooltip"><span class="rt-tip__arrow"></span>' + esc(t) + '</span></span>' : '';
  }
  function row(l, v, t) {
    return '<div class="rt-row"><div class="rt-row__label">' + esc(l) + tip(t) + '</div><div class="rt-row__value">' + v + '</div></div>';
  }
  function metric(l, v, sub, cls) {
    return '<div class="rt-metric"><dt>' + esc(l) + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + v + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</dd></div>';
  }
  function promo(a) {
    return a.promo ? '<span class="rt-promo"><span>' + esc(a.promo.text) + '</span>' + tip(a.promo.tip) + '</span>' : '';
  }

  /* ---------- rate model ---------- */
  // Highest rate offered. Term deposits: best tier across all terms.
  // Flexible/fintech products: their one published (variable) rate.
  function bestRate(a) {
    if (a.kind !== 'term') return a.rateEur;
    return a.tiers.reduce(function (m, t) { return Math.max(m, t.rateEur); }, 0);
  }
  // The term (months) at which bestRate() applies. Only meaningful for term
  // deposits - callers must check `a.kind === 'term'` before using this.
  function bestTermMonths(a) {
    var best = a.tiers[0];
    a.tiers.forEach(function (t) { if (t.rateEur > best.rateEur) best = t; });
    return best.months;
  }
  // Rate that applies for a chosen term: the highest-rate tier whose term is
  // <= the requested months (you can always place money for a shorter term).
  // If the requested term is shorter than the shortest tier, use the shortest.
  function rateForTerm(a, months) {
    var eligible = a.tiers.filter(function (t) { return t.months <= months; });
    if (!eligible.length) {
      // requested term shorter than any offered tier -> use shortest tier
      var shortest = a.tiers[0];
      a.tiers.forEach(function (t) { if (t.months < shortest.months) shortest = t; });
      return { rate: shortest.rateEur, months: shortest.months, shorter: true };
    }
    var pick = eligible[0];
    eligible.forEach(function (t) { if (t.rateEur > pick.rateEur) pick = t; });
    return { rate: pick.rate != null ? pick.rate : pick.rateEur, months: pick.months, shorter: false };
  }
  // Rate that applies for a chosen term, for ANY product kind. Term deposits
  // use rateForTerm() (a real term mismatch is possible there). Flexible and
  // fintech products have no term to mismatch - their current rate simply
  // applies over however many months the user asked about, which is why
  // `shorter`/`longer` are always false for them (termAlert() relies on
  // exactly that to stay silent for these products).
  function effectiveRate(a, months) {
    if (a.kind === 'term') return rateForTerm(a, months);
    return { rate: a.rateEur, months: months, shorter: false, longer: false };
  }

  // Simulate: simple interest over the applicable term, net of 22% tax.
  // Term deposits pay a fixed rate for the whole term. Flexible/fintech
  // products pay today's variable rate projected forward - the UI must make
  // clear this is an estimate that assumes the rate holds (see the
  // calculator's own note and the "hinnanguline" card labels).
  //
  // Crucial for term deposits: interest is earned for r.months (the ACTUAL
  // tier term that applies), never for pf.months (what the user typed). A
  // bank offering tiers at 8/11/17 months has no product that pays its
  // 11-month rate for 12 months.
  //
  // A term deposit whose SHORTEST tier is still longer than what the user
  // asked for (e.g. they want 1 month, the bank's minimum is 3) is not a
  // real option for that request at all, so it's blocked - the same
  // treatment as failing the minimum-deposit check, not shown with a
  // best-effort substitute term. Entering 0 months ("I might need this
  // money any time") blocks every term deposit this way and leaves only
  // flexible/fintech products, which is the intended effect, not a special
  // case: effectiveRate() never finds a tier <= 0.
  function simulate(a, pf) {
    var res = { blocked: null };
    if (pf.amount < a.minDeposit) { res.blocked = 'min'; return res; }
    var r = effectiveRate(a, pf.months);
    if (r.shorter) { res.blocked = 'term'; return res; }
    var years = r.months / 12;
    var gross = pf.amount * (r.rate / 100) * years;
    var net = gross * (1 - TAX);
    res.rate = r.rate;
    res.rateTermMonths = r.months;
    res.longer = r.months < pf.months;
    res.gross = gross;
    res.net = net;
    // effective annual net rate on the deposited amount, over the actual term
    res.effective = pf.amount > 0 ? (net / pf.amount) / years * 100 : 0;
    return res;
  }

  /* ---------- filters (grouped around real decisions, not raw fields) ---------- */
  var GROUPS = [
    {
      id: 'kind', title: 'Hoiuse tüüp', items: [
        { k: 'isLocked', l: 'Tähtajaline (raha lukus)', tip: 'Raha on kokkulepitud tähtajaks lukku pandud - ennetähtaegne väljavõtmine toob üldjuhul kaasa intressi kaotuse.' },
        { k: 'isFlexible', l: 'Paindlik (raha kättesaadav)', tip: 'Raha on igal ajal kättesaadav. Intressimäär on muutuv ja võib igal ajal muutuda.' }
      ]
    },
    {
      id: 'safety', title: 'Ohutus', items: [
        { k: 'gTagatisfond', l: 'Eesti Tagatisfond', tip: 'Eesti pangas hoiustatud raha on tagatud Eesti Tagatisfondi poolt kuni 100 000 € ulatuses kliendi kohta.' },
        { k: 'gLati', l: 'Läti tagatisskeem', tip: 'Citadele tegutseb Eestis Läti panga filiaalina, seega kehtib Läti hoiuste tagamise skeem, mitte Eesti Tagatisfond. Kaitse ulatus on samuti kuni 100 000 €.' },
        { k: 'gForeign', l: 'Muu ELi tagatisskeem', tip: 'Mõni välismaine platvorm on kaitstud oma koduriigi hoiuste tagamise skeemi kaudu (nt Saksamaa, Leedu, Holland) - ELi direktiivi alusel Eesti Tagatisfondiga samaväärne, kuni 100 000 €.' }
      ]
    },
    {
      id: 'conditions', title: 'Kulu ja tingimused', items: [
        { k: 'noSalary', l: 'Ei nõua palgakontot' },
        { k: 'noFee', l: 'Ilma kuutasuta' },
        { k: 'lowMin', l: 'Miinimum kuni 100 €', tip: 'Hoiuse avamiseks piisab kuni 100 eurost.' }
      ]
    },
    {
      id: 'term', title: 'Tähtaeg', items: [
        { k: 'shortTerm', l: 'Lühike tähtaeg (kuni 3 kuud)', tip: 'Pakub vähemalt ühe tähtaja, mis on 3 kuud või lühem.' },
        { k: 'longTerm', l: 'Pikk tähtaeg (üle 5 aasta)', tip: 'Pakub vähemalt ühe tähtaja, mis on üle 60 kuu.' }
      ]
    },
    { id: 'rate', title: 'Intress', items: [] }
  ];

  var RATE_PRESETS = [2, 2.5, 3];

  var PRED = {
    isLocked: function (a) { return a.locked; },
    isFlexible: function (a) { return !a.locked; },
    // Countries are read off the explicit `guaranteeCountry` field, not
    // sniffed out of the free-text guaranteeScheme description - several
    // fintech accounts describe a FOREIGN scheme using the same Estonian
    // word "Tagatisfond(i)" that Eesti Tagatisfond itself uses (it is the
    // generic Estonian term for "deposit guarantee fund"), so matching on
    // the word alone would wrongly count them as Eesti Tagatisfond cover.
    gTagatisfond: function (a) { return a.guaranteeCountry === 'EE'; },
    gLati: function (a) { return a.guaranteeCountry === 'LV'; },
    gForeign: function (a) { return !!a.guaranteeCountry && a.guaranteeCountry !== 'EE' && a.guaranteeCountry !== 'LV'; },
    noSalary: function (a) { return !a.salaryRequired; },
    noFee: function (a) { return !a.monthlyFee; },
    lowMin: function (a) { return a.minDeposit <= 100; },
    shortTerm: function (a) { return a.kind === 'term' && a.tiers.some(function (t) { return t.months <= 3; }); },
    longTerm: function (a) { return a.kind === 'term' && a.tiers.some(function (t) { return t.months > 60; }); }
  };

  var LABELS = {};
  var KEY_GROUP = {};
  GROUPS.forEach(function (g) { g.items.forEach(function (i) { LABELS[i.k] = i.l; KEY_GROUP[i.k] = g.id; }); });

  /* ---------- initials + colour for the logo chip ---------- */
  var BANK_STYLE = {
    'LHV': { ini: 'LHV', color: '#1a1a2e', domain: 'lhv.ee', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/be/Lhv-logo_2.svg/960px-Lhv-logo_2.svg.png' },
    'Coop Pank': { ini: 'Co', color: '#e30613', domain: 'cooppank.ee' },
    'Bigbank': { ini: 'Bb', color: '#004a99', domain: 'bigbank.ee' },
    'Holm Bank': { ini: 'Ho', color: '#00a19a', domain: 'holmbank.ee' },
    'Inbank': { ini: 'In', color: '#e94e24', domain: 'inbank.ee' },
    'Swedbank': { ini: 'Sw', color: '#fa5000', domain: 'swedbank.ee', logo: 'https://companieslogo.com/img/orig/SWED-A.ST-e1492133.png?t=1746207211' },
    'SEB': { ini: 'SEB', color: '#60cd18', domain: 'seb.ee' },
    'Luminor': { ini: 'Lu', color: '#0a1e46', domain: 'luminor.ee' },
    'Citadele': { ini: 'Ci', color: '#95c11f', domain: 'citadele.ee' },
    'Trade Republic': { ini: 'TR', color: '#111111', domain: 'traderepublic.com', logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRCUPVDUZjZ288oo_GgraSG6wP1hhngKpCzjda17FNkkg&s=10' },
    'Trading 212': { ini: '212', color: '#0a4bcf', domain: 'trading212.com' },
    'Lightyear': { ini: 'LY', color: '#141414', domain: 'lightyear.com', logo: 'https://cdn.prod.website-files.com/699f1009b6a8a1374b02926b/6ab29c30266ca45904de1710_lightyear-app-icon.png', bare: true, square: true },
    'Wise': { ini: 'Wi', color: '#163300', domain: 'wise.com' },
    'N26': { ini: 'N26', color: '#00745a', domain: 'n26.com' },
    'Revolut': { ini: 'Re', color: '#191c1f', domain: 'revolut.com' },
    'bunq': { ini: 'bq', color: '#f2552c', domain: 'bunq.com' },
    'Interactive Brokers': { ini: 'IB', color: '#b3121b', domain: 'interactivebrokers.com' }
  };
  function styleFor(a) { return BANK_STYLE[a.bank] || { ini: a.bank.slice(0, 2), color: '#0072ce' }; }

  /* ---------- logo chip markup ----------
     Renders the bank's real logo (an explicit `logo` URL override when one
     is set, otherwise the domain's favicon) on top of the colour+initials
     chip. Most favicons/logo PNGs aren't full-bleed opaque squares - they
     have transparent padding around the mark - so layering the <img> on
     top of always-visible initials isn't enough, the text shows through
     the transparent gaps. So whenever there's a logo URL to try, the
     initials start hidden (inline style, applied before the image even
     starts loading - no onload race, no flash of both at once) and only
     onerror reveals them, after also removing the broken <img>.
     Same reasoning applies to the brand-colour background: it's only
     there to sit behind the initials, so a real logo gets a plain white
     backing instead (via .rt-logo--img) - the colour is applied inline
     only in the initials-only fallback path, and restored by onerror.
     A logo can opt into `bare: true` when its source image is already a
     complete, self-contained icon (its own background, its own margin -
     e.g. a square social-share icon) - the usual white chip + contain +
     padding treatment would then just be a redundant frame around a frame.
     Bare drops the chip's own background/padding entirely and shows the
     image exactly as it is, at the same footprint as every other logo -
     no cropping, scaling or recolouring, since some partners (e.g.
     Lightyear's sponsored placement) require their logo shown completely
     unmodified. `square: true` alongside it makes the CHIP square too
     (object-fit:contain already preserves the image's own aspect ratio
     regardless of the chip's shape - this is purely about not leaving an
     odd empty strip on the sides of a square logo inside our normally
     wider chip). `wide: true` is the opposite case - a wordmark logo,
     wider than the standard chip, for a placement (the sponsored banner)
     that has room for it. */
  function logoHtml(a, st, extraClass) {
    var bare = !!st.bare;
    var cls = 'rt-logo' + (bare ? ' rt-logo--bare' : '') + (st.square ? ' rt-logo--square' : '') + (st.wide ? ' rt-logo--wide' : '') + (extraClass ? ' ' + extraClass : '');
    var src = st.logo || (st.domain ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(st.domain) + '&sz=64' : '');
    var ini = '<span class="rt-logo-ini"' + (src ? ' style="display:none"' : '') + '>' + esc(st.ini) + '</span>';
    var img = src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.remove();this.previousElementSibling.style.display=\'\';this.parentNode.style.background=\'' + st.color + '\'">' : '';
    var style = src && !bare ? '' : ' style="background:' + (bare ? 'transparent' : st.color) + '"';
    return '<span class="' + cls + (src && !bare ? ' rt-logo--img' : '') + '"' + style + ' aria-hidden="true">' + ini + img + '</span>';
  }

  /* ---------- merging the three product datasets into one list ----------
     See the file header for what each kind's raw JSON looks like. These
     normalize*() functions are the ONLY place that reads each kind's raw
     field names for properties every kind needs in common - everything
     downstream reads the normalized fields instead. */
  function normalizeTerm(a) {
    a.kind = 'term';
    a.locked = true;
    return a;
  }
  function normalizeFlexible(a) {
    a.kind = 'flexible';
    a.locked = false;
    a.salaryRequired = false;
    a.monthlyFee = 0;
    a.minDeposit = a.minDeposit || 0;
    a.withdrawalSpeed = a.withdrawal ? a.withdrawal.speed : null;
    a.withdrawalFee = a.withdrawal ? a.withdrawal.fee : null;
    return a;
  }
  function normalizeFintech(a) {
    a.kind = 'fintech';
    a.locked = false;
    a.bank = a.platform;
    a.salaryRequired = false;
    a.monthlyFee = 0;
    a.minDeposit = a.minDeposit || 0;
    a.guaranteeScheme = a.protectionScheme;
    // Foreign platforms are all liquid brokerage/e-money balances, not a
    // locked banking product - there is no lock-up to report a withdrawal
    // speed for beyond "available any time".
    a.withdrawalSpeed = 'Kohe';
    a.withdrawalFee = null;
    return a;
  }
  function mergeAccounts(termData, flexData, finData) {
    var list = [];
    (termData.accounts || []).forEach(function (a) { list.push(normalizeTerm(a)); });
    (flexData.accounts || []).forEach(function (a) { list.push(normalizeFlexible(a)); });
    (finData.accounts || []).forEach(function (a) { list.push(normalizeFintech(a)); });
    list.forEach(function (a) { a.id = a.kind + ':' + a.bank + ':' + a.product; });
    return list;
  }
  function maxDate(dates) {
    var valid = dates.filter(function (d) { return !!d; });
    if (!valid.length) return null;
    return valid.reduce(function (m, d) { return d > m ? d : m; });
  }

  /* ---------- state ---------- */
  var ACCOUNTS = [];
  var META = {};
  var COMPARE_MAX = 3;
  var state = { on: {}, minRate: null, profile: null, sort: 'rate', visible: PAGE, expanded: {}, compare: {}, compareOpen: false };

  function compareKeys() { return Object.keys(state.compare).filter(function (k) { return state.compare[k]; }); }
  // Keyed by a.id, not a.bank - several banks sell both a term deposit and a
  // flexible product (e.g. SEB's Tähtajaline hoius and Digikassa), so the
  // bank name alone is not unique across the merged list (see mergeAccounts()).
  function accountById(id) { return ACCOUNTS.filter(function (a) { return a.id === id; })[0]; }

  function activeKeys() { return Object.keys(state.on).filter(function (k) { return state.on[k]; }); }
  function nFilters() { return activeKeys().length + (state.minRate != null ? 1 : 0); }

  // Checked boxes within the SAME group are OR'd, different groups are
  // AND'd - the usual faceted-filter convention. Without this, checking both
  // "Tähtajaline" and "Paindlik" (mutually exclusive - every account is
  // exactly one) would AND them together and match nothing, which reads as
  // a broken filter rather than "show me both", the obviously intended
  // meaning of checking both boxes in one group.
  function filtered() {
    var byGroup = {};
    activeKeys().forEach(function (k) {
      var g = KEY_GROUP[k];
      (byGroup[g] = byGroup[g] || []).push(k);
    });
    return ACCOUNTS.filter(function (a) {
      if (state.minRate != null && bestRate(a) < state.minRate) return false;
      for (var g in byGroup) {
        if (!byGroup[g].some(function (k) { return PRED[k](a); })) return false;
      }
      return true;
    });
  }

  function sorted(list) {
    var pf = state.profile, s = state.sort;
    return list.slice().sort(function (a, b) {
      if (s === 'yield' && pf) {
        var sa = simulate(a, pf), sb = simulate(b, pf);
        if (!!sa.blocked !== !!sb.blocked) return sa.blocked ? 1 : -1;
        if (!sa.blocked && Math.abs(sb.net - sa.net) > 0.005) return sb.net - sa.net;
      }
      if (s === 'min') { if (a.minDeposit !== b.minDeposit) return a.minDeposit - b.minDeposit; }
      var ra = bestRate(a), rb = bestRate(b);
      if (ra !== rb) return rb - ra;
      return ACCOUNTS.indexOf(a) - ACCOUNTS.indexOf(b);
    });
  }

  /* ---------- render: filters ---------- */
  function checkHtml(i, type, name, val) {
    var on = type === 'radio' ? state[name] === val : !!state.on[i.k];
    return '<label class="rt-check' + (type === 'radio' ? ' rt-check--radio' : '') + '"><input type="' + type + '" ' +
      (type === 'radio' ? 'name="' + name + '" value="' + val + '"' : 'data-k="' + i.k + '"') + (on ? ' checked' : '') +
      '><span class="rt-check__box">' + CHECK + '</span><span class="rt-check__text">' + esc(i.l) + '</span>' + tip(i.tip) + '</label>';
  }
  function renderFilters(root) {
    var h = '';
    GROUPS.forEach(function (g) {
      h += '<div class="rt-group" data-open="true"><button type="button" class="rt-group__head" aria-expanded="true"><span>' + esc(g.title) + '</span>' + CHEV + '</button><div class="rt-group__body">';
      if (g.id === 'rate') {
        h += '<div class="rt-presets">' + RATE_PRESETS.map(function (p) {
          var on = state.minRate === p;
          return '<button type="button" class="rt-preset' + (on ? ' is-on' : '') + '" data-rate-preset="' + p + '">alates ' + d(p, 1) + '%</button>';
        }).join('') + '</div>';
        h += '<div class="rt-static">Või sisesta täpne väärtus' + tip('Filtreeri panga kõrgeima pakutava intressi järgi (enne maksu).') + '</div>';
        h += '<div class="rt-input rt-num"><input type="number" id="rtMinRate" inputmode="decimal" min="0" step="0.1" aria-label="Madalaim intress" value="' + (state.minRate != null ? state.minRate : '') + '"><span class="rt-input__unit">%</span></div>';
      }
      g.items.forEach(function (i) { h += checkHtml(i, 'checkbox'); });
      h += '</div></div>';
    });
    root.querySelector('#rtFilterGroups').innerHTML = h;
  }
  function renderActive(root) {
    var el = root.querySelector('#rtActiveFilters'), chips = [];
    if (state.minRate != null) chips.push({ t: 'Intress alates ' + d(state.minRate, 2) + '%', a: 'rate' });
    activeKeys().forEach(function (k) { chips.push({ t: LABELS[k], a: 'k', k: k }); });
    el.innerHTML = chips.length
      ? chips.map(function (c) { return '<span class="rt-chip">' + esc(c.t) + '<button type="button" data-remove="' + c.a + '" data-k="' + (c.k || '') + '" aria-label="Eemalda filter">&times;</button></span>'; }).join('')
      : 'Ühtegi filtrit pole valitud';
  }

  /* ---------- render: cards ---------- */
  // Explicit, factual chips instead of a blanket "no extra conditions" claim.
  // Early withdrawal / auto-renewal / payout timing are verified per bank and
  // shown in details() below; this chip only summarizes the monthly-fee
  // requirement, which is what fits as a compact badge. A "Palgakontot pole
  // vaja" chip used to sit here too, but salaryRequired is false for every
  // single account across all three datasets (flexible/fintech hardcode it
  // to false in normalize*(); the only kind where it's a real scraped field,
  // term deposits, happens to be false for all 9 current banks too) - it
  // carried zero information, same as the earlier "Kuutasu" metric removal.
  function condChips(a) {
    var out = [];
    out.push(a.locked
      ? '<span class="rt-cond rt-cond--info">Raha lukus tähtajaks</span>'
      : '<span class="rt-cond rt-cond--free">Raha kättesaadav</span>');
    out.push(a.monthlyFee
      ? '<span class="rt-cond rt-cond--req">Kuutasu ' + eur2(a.monthlyFee) + '</span>'
      : '<span class="rt-cond rt-cond--free">Kuutasu puudub</span>');
    if (a.status === 'stale') out.push('<span class="rt-cond rt-cond--warn">Kontrollimata</span>');
    return '<div class="rt-conds">' + out.join('') + '</div>';
  }
  // Only meaningful for term deposits - callers must check a.kind first (or
  // accept the {min:0,max:0} fallback, which callers that DO check never see).
  function termRange(a) {
    if (!a.tiers || a.kind !== 'term') return { min: 0, max: 0 };
    var min = a.tiers.reduce(function (m, x) { return Math.min(m, x.months); }, Infinity);
    var max = a.tiers.reduce(function (m, x) { return Math.max(m, x.months); }, 0);
    return { min: min, max: max };
  }
  function rateSummary(a) {
    if (a.kind !== 'term') {
      return a.rateEurMin != null
        ? 'muutuv, vahemikus ' + pct(a.rateEurMin) + '\u2013' + pct(a.rateEur)
        : 'muutuv määr';
    }
    var r = termRange(a);
    var t = [];
    t.push('parim ' + bestTermMonths(a) + ' kuu juures');
    t.push('tähtaeg ' + r.min + '\u2013' + r.max + ' kuud');
    return t.join(' · ');
  }
  // "Tagatis" fact/label: EE/LV/DE/LT/NL cover is a proper 100 000 €
  // per-institution deposit guarantee; accounts with no guaranteeCountry
  // (several fintech platforms) only carry investor-compensation cover,
  // which is a materially different, smaller (20 000 €) protection.
  var GUARANTEE_LABEL = { EE: 'Eesti Tagatisfond', LV: 'Läti skeem', DE: 'Saksa skeem', LT: 'Leedu skeem', NL: 'Hollandi skeem' };
  function guaranteeLabel(a) { return GUARANTEE_LABEL[a.guaranteeCountry] || 'Investorikaitse'; }
  function guaranteeSub(a) { return a.guaranteeCountry ? 'kuni 100 000 €' : 'kuni 20 000 €'; }
  function tierTable(a) {
    var rows = a.tiers.map(function (t) {
      return '<tr><td>' + t.months + ' kuud</td><td>' + pct(t.rateEur) + (t.rateUsd != null ? '<span class="rt-soft"> (USD ' + pct(t.rateUsd) + ')</span>' : '') + '</td></tr>';
    }).join('');
    return '<table class="rt-tiertable"><thead><tr><th>Tähtaeg</th><th>Intress aastas</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  // Plan-tiered rate table (currently only N26's Instant Savings) - same
  // markup/styling as tierTable(), just keyed by plan name instead of term.
  function planTierTable(a) {
    var rows = a.tiers.map(function (t) {
      return '<tr><td>' + esc(t.plan) + '</td><td>' + pct(t.rateEur) + '</td></tr>';
    }).join('');
    return '<table class="rt-tiertable"><thead><tr><th>Pakett</th><th>Intress aastas</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function isTaxSelfDeclared(a) { return /ei peeta kinni/i.test(a.taxNote || ''); }
  function taxRow(a) {
    var selfDeclared = isTaxSelfDeclared(a);
    return row(
      'Tulumaks',
      pct(TAX * 100) + '<span class="rt-soft">' + (selfDeclared ? 'ise deklareeritav' : 'automaatselt kinni peetud') + '</span>',
      a.taxNote
    );
  }
  // The card's compact 4-metric row used to show "Kuutasu" here, but no
  // account in any of the three datasets charges one - every card said
  // "Puudub", so the slot carried zero information. This tile used to show
  // "Väljamakse tasu" for flexible accounts instead, but those fee strings
  // are long, bank-specific sentences (e.g. Coop Pank's "Tasuta (kohese
  // väljamakse eest tasu vastavalt hinnakirjale)") that read badly crammed
  // into a compact tile and made flexible cards inconsistent with term/
  // fintech cards at a glance. All three kinds now show how tax works here
  // instead - "kinni peetud" vs "ise deklareeritav" is short, always true,
  // and is the one fact that genuinely differs between an Estonian bank and
  // a foreign platform; the full withdrawal-fee sentence still lives in the
  // expanded card (detailsFlexible()).
  function thirdMetric(a) {
    return metric('Tulumaks', isTaxSelfDeclared(a) ? 'Ise deklareeritav' : 'Kinnipeetud');
  }
  function detailsTerm(a) {
    var h = '<div class="rt-dgroup">Intressimäärad tähtaja järgi</div>';
    h += '<div class="rt-tierwrap">' + tierTable(a) + '</div>';
    h += row('Kõrgeim intress (bruto)', pct(bestRate(a)) + '<span class="rt-soft">' + bestTermMonths(a) + ' kuu juures</span>');
    h += row('Netointress kohe pärast maksu', pct(bestRate(a) * (1 - TAX)), 'Kui tulumaks tasutakse kohe. Investeerimiskonto kaudu avatud hoiusel saab maksu tasumist edasi lükata, mitte seda vältida.');
    h += '<div class="rt-dgroup">Tingimused</div>';
    h += row('Miinimumsumma', a.minDeposit === 0 ? 'Miinimumita' : eur(a.minDeposit));
    if (a.maxDeposit) h += row('Maksimumsumma', eur(a.maxDeposit));
    h += row('Nõuab palgakontot', bool(a.salaryRequired));
    h += row('Kuutasu', a.monthlyFee ? eur2(a.monthlyFee) + ' / kuus' : '0 €');
    h += row('Intressimakse ajastus', esc(a.payoutTiming.short), a.payoutTiming.note);
    h += row('Ennetähtaegne lõpetamine', esc(a.earlyWithdrawal.short), a.earlyWithdrawal.note);
    h += row('Automaatne pikenemine', esc(a.autoRenewal.short), a.autoRenewal.note);
    if (a.accountOpening) h += row('Hoiuse avamine', esc(a.accountOpening.short), a.accountOpening.note);
    h += '<div class="rt-dgroup">Maksud ja tagatis</div>';
    h += taxRow(a);
    h += row('Kapitali tagatis', '<span class="rt-flag"><b>' + esc(a.guaranteeScheme) + '</b></span>');
    return h;
  }
  function detailsFlexible(a) {
    var h = '<div class="rt-dgroup">Intress</div>';
    h += row('Praegune intress (bruto)', pct(a.rateEur), 'Muutuv määr, kehtib kogu hoiusel olevale summale ja võib igal ajal muutuda.');
    h += row('Netointress kohe pärast maksu', pct(a.rateEur * (1 - TAX)), 'Kui tulumaks tasutakse kohe. Investeerimiskonto kaudu avatud kontol saab maksu tasumist edasi lükata, mitte seda vältida.');
    h += '<div class="rt-dgroup">Tingimused</div>';
    h += row('Miinimumsumma', a.minDeposit === 0 ? 'Miinimumita' : eur(a.minDeposit));
    if (a.maxDeposit) h += row('Maksimumsumma', eur(a.maxDeposit));
    if (a.payoutFrequency) h += row('Intressimakse ajastus', esc(a.payoutFrequency));
    if (a.withdrawalSpeed) h += row('Raha kättesaadavus', esc(a.withdrawalSpeed));
    if (a.withdrawalFee) h += row('Väljamakse tasu', esc(a.withdrawalFee));
    h += '<div class="rt-dgroup">Maksud ja tagatis</div>';
    h += taxRow(a);
    h += row('Kapitali tagatis', '<span class="rt-flag"><b>' + esc(a.guaranteeScheme) + '</b></span>');
    return h;
  }
  function detailsFintech(a) {
    var h = '';
    if (a.tiers && a.tiers.length) {
      h += '<div class="rt-dgroup">Intress paketi järgi</div>';
      h += '<div class="rt-tierwrap">' + planTierTable(a) + '</div>';
    } else {
      h += '<div class="rt-dgroup">Intress</div>';
    }
    var rateLabel = a.rateEurMin != null ? pct(a.rateEurMin) + '\u2013' + pct(a.rateEur) : pct(a.rateEur);
    h += row('Praegune intress (bruto)', rateLabel, a.rateNote);
    h += row('Netointress kohe pärast maksu', pct(a.rateEur * (1 - TAX)), 'Kõrgeima avaldatud määra põhjal, kui tulumaks tasutakse kohe.');
    h += '<div class="rt-dgroup">Tingimused</div>';
    h += row('Miinimumsumma', a.minDeposit === 0 ? 'Miinimumita' : eur(a.minDeposit));
    h += row('Raha kättesaadavus', esc(a.withdrawalSpeed || 'Kohe'), 'Välismaised platvormid ei ole tähtajalised hoiused - raha ei ole lukku pandud.');
    h += '<div class="rt-dgroup">Maksud ja kaitse</div>';
    h += taxRow(a);
    h += row('Kaitseskeem', '<span class="rt-flag"><b>' + esc(a.guaranteeScheme) + '</b></span>');
    return h;
  }
  function details(a) {
    var h = a.kind === 'term' ? detailsTerm(a) : a.kind === 'flexible' ? detailsFlexible(a) : detailsFintech(a);
    if (a.ratesEffectiveFrom) h += row('Määrad kehtivad alates', esc(a.ratesEffectiveFrom));
    if (a.checkedOn) h += row('Viimati kontrollitud', esc(a.checkedOn));
    return h;
  }
  // Term-mismatch alert: tells the user exactly which term the numbers above
  // actually apply to, whenever it differs from what they typed. Always
  // silent for flexible/fintech products - effectiveRate() never reports a
  // mismatch for them, since there is no term to mismatch against. Also
  // silent whenever the bank's shortest tier is longer than what was asked
  // for - simulate() blocks that case entirely (see its own comment) rather
  // than substituting a longer term with a caveat, so termAlert() never even
  // sees it: s.blocked is already true and the guard above returns first.
  function termAlert(s, pf) {
    if (!s || s.blocked) return '';
    if (s.longer) {
      return 'Sinu valitud ' + pf.months + ' kuu jaoks on parim saadaolev intress tegelikult ' + s.rateTermMonths + ' kuu tähtajal (pikemad tähtajad kas puuduvad või annavad vähem). Arvutus eeldab raha paigutamist ' + s.rateTermMonths + ' kuuks, mitte ' + pf.months + ' kuuks.';
    }
    return '';
  }
  function card(a, pos) {
    var pf = state.profile, open = !!state.expanded[a.id], s = pf ? simulate(a, pf) : null, out = s && s.blocked;
    var st = styleFor(a);
    var tr = termRange(a);
    var compareOn = !!state.compare[a.id];
    var locked = a.kind === 'term';

    var heroRate, heroSub, heroNet = '';
    if (pf && s && !s.blocked) {
      heroRate = pct(s.rate);
      heroSub = locked ? (s.rateTermMonths + ' kuu tähtajaga · brutointress') : 'praegune muutuv määr · brutointress';
      heroNet = '<div class="rt-hero-net"><span>' + (locked ? 'Teenid tähtaja lõpus neto' : 'Teenid selle aja jooksul hinnanguliselt neto') +
        '</span><b>' + eur2(s.net) + '</b></div>';
    } else {
      heroRate = pct(bestRate(a));
      heroSub = locked ? ('parim ' + bestTermMonths(a) + ' kuu juures · brutointress') : 'praegune muutuv määr · brutointress';
    }
    var warn = pf && s && s.blocked === 'min'
      ? '<p class="rt-sim rt-sim--warn">Avamiseks on vaja ' + eur(a.minDeposit) + ', sinu sisestatud summa ei sobi.</p>' : '';
    var alertText = termAlert(s, pf);
    var al = alertText ? '<div class="rt-alert">' + INFO + '<span>' + esc(alertText) + '</span></div>' : '';
    var promoHtml = promo(a);
    var heroSide = (promoHtml || heroNet) ? '<div class="rt-hero-side">' + promoHtml + heroNet + '</div>' : '';

    return '<article class="rt-card' + (pos === 1 && !out ? ' rt-card--top' : '') + (out ? ' is-out' : '') + '" data-id="' + esc(a.id) + '">' +
      (pos === 1 && !out ? '<span class="rt-card__ribbon">' + (pf ? 'Sulle kõige tulusam' : 'Kõrgeim intress praegu') + '</span>' : '') +
      '<div class="rt-card__top">' +
        '<div class="rt-id"><span class="rt-rank">' + pos + '</span>' + logoHtml(a, st) +
        '<div><h3 class="rt-card__name">' + esc(a.bank) + '</h3><p class="rt-type">' + esc(a.product) + '</p>' + condChips(a) + '</div></div>' +
        '<div class="rt-top-actions">' +
          '<label class="rt-compare"><input type="checkbox" data-compare="' + esc(a.id) + '"' + (compareOn ? ' checked' : '') + '><span class="rt-check__box">' + CHECK + '</span><span>Võrdle</span></label>' +
          '<a class="rt-btn rt-btn--brand" href="' + esc(a.linkUrl || a.sourceUrl) + '" target="_blank" rel="nofollow noopener">Loe lähemalt</a>' +
        '</div>' +
      '</div>' +
      '<div class="rt-card__hero">' +
        '<div class="rt-hero-rate"><span class="rt-hero-num">' + heroRate + '</span><span class="rt-hero-sub">' + esc(heroSub) + '</span></div>' +
        heroSide + warn +
      '</div>' +
      (al ? al : '') +
      '<dl class="rt-facts">' +
        metric('Miinimumsumma', a.minDeposit === 0 ? 'Miinimumita' : eur(a.minDeposit)) +
        thirdMetric(a) +
        (locked ? metric('Tähtaeg', tr.min + '–' + tr.max + ' kuud') : metric('Raha kättesaadavus', esc(a.withdrawalSpeed || 'Kohe'))) +
        metric('Tagatis', guaranteeLabel(a)) +
      '</dl>' +
      '<button type="button" class="rt-toggle" data-action="toggle" aria-expanded="' + open + '"><span>' + (open ? 'Vähem infot' : (locked ? 'Vaata kõiki tähtaegu ja tingimusi' : 'Vaata kõiki tingimusi')) + '</span>' + CHEV + '</button>' +
      '<div class="rt-details"' + (open ? '' : ' hidden') + '>' + details(a) +
        '<div class="rt-details__sticky"><span>' + esc(a.bank) + '</span><a class="rt-btn rt-btn--brand" href="' + esc(a.linkUrl || a.sourceUrl) + '" target="_blank" rel="nofollow noopener">Loe lähemalt</a></div>' +
        '<div class="rt-details__foot"><button type="button" class="rt-btn rt-btn--ghost rt-btn--sm" data-action="toggle">Vähem infot</button></div>' +
      '</div></article>';
  }

  function renderProfile(root) {
    var pf = state.profile, el = root.querySelector('#rtProfileBar');
    if (!pf) { el.innerHTML = ''; return; }
    var p = ['<b>' + eur(pf.amount) + '</b> ' + pf.months + ' kuuks'];
    el.innerHTML = '<div class="rt-profile">' + p.join(' · ') + '<button type="button" class="rt-btn--text" id="rtProfileReset" style="margin-left:auto">Tühjenda simulatsioon</button></div>';
  }

  // A term deposit whose shortest tier is longer than the simulated term is
  // not a real option for that request (see simulate()'s own comment) - it
  // is excluded from the results entirely, not shown dimmed with a
  // best-effort substitute. This also means entering 0 months leaves only
  // flexible/fintech accounts, since no term deposit has a tier <= 0.
  function visibleFor(pf) {
    return function (a) { return !(pf && simulate(a, pf).blocked === 'term'); };
  }
  function renderList(root) {
    var pf = state.profile;
    var l = sorted(filtered()).filter(visibleFor(pf)), n = l.length, txt = n + (n === 1 ? ' tulemus' : ' tulemust');
    root.querySelector('#rtCountHead').textContent = txt;
    root.querySelector('#rtCountTop').textContent = txt;
    root.querySelector('#rtDrawerApply').textContent = 'Näita ' + txt;
    var b = root.querySelector('#rtBadgeMobile'), nf = nFilters();
    b.hidden = nf === 0; b.textContent = nf;
    var el = root.querySelector('#rtList');
    if (!n) {
      el.innerHTML = '<div class="rt-empty">Ükski hoius ei vasta kõigile valitud filtritele. Eemalda mõni ja proovi uuesti.<br><button type="button" class="rt-btn rt-btn--ghost rt-btn--sm rt-reset">Lähtesta filtrid</button></div>';
      root.querySelector('#rtMore').innerHTML = '';
      renderProfile(root);
      return;
    }
    var vis = l.slice(0, state.visible), h = '';
    vis.forEach(function (a, i) { h += card(a, i + 1); });
    el.innerHTML = h;
    var left = n - vis.length;
    root.querySelector('#rtMore').innerHTML = left > 0 ? '<button type="button" class="rt-btn rt-btn--ghost" id="rtMoreBtn">Näita veel ' + left + ' hoiust</button>' : '';
    renderProfile(root);
  }

  // Fixed sponsored placement above the calculator - a paid partner slot,
  // not a computed "best deal" (see SPONSORED_ID). The results list below
  // it stays entirely neutral/rate-sorted; this card is the one place on
  // the page whose account is chosen by a commercial agreement rather than
  // by the numbers, so it's labelled as such (rt-winner__tag--sponsored)
  // rather than reusing the old "kõrgeim intress praegu" / "kõige
  // tulusam" wording that implied a computed ranking. No explanatory tip
  // on the tag itself - "Reklaam" alone already reads as clear, and is
  // styled to match how the other calculator pages on the site label
  // their own ad/sponsored slots (see .rt-winner__tag--sponsored).
  // Still obeys the user's own calculator input for the net-earnings figure
  // (simulate() against their real amount/term) - that's genuinely useful
  // and not a ranking claim, just "what YOU would earn here."
  var SPONSORED_ID = 'fintech:Lightyear:Kasvufond (Savings Vaults)';
  // Display-only trim of the parenthetical - the full string above stays
  // the account's real `product` value (and thus part of its `id`), since
  // other lookups (compare, data-id) key off it; only this card's own
  // heading shortens "Kasvufond (Savings Vaults)" to "Kasvufond".
  function stripParenthetical(s) { return s.replace(/\s*\([^)]*\)\s*$/, ''); }
  function renderSponsored(root) {
    var el = root.querySelector('#rtSponsored');
    var sp = accountById(SPONSORED_ID);
    if (!sp) { el.innerHTML = ''; return; }
    var st = styleFor(sp);
    var pf = state.profile;
    var s = pf ? simulate(sp, pf) : null;
    var heroRate, heroSub;
    if (pf && s && !s.blocked) {
      heroRate = pct(s.rate);
      heroSub = 'hinnanguline neto ' + eur2(s.net);
    } else {
      heroRate = pct(bestRate(sp));
      heroSub = rateSummary(sp);
    }
    var promoHtml = promo(sp);
    el.innerHTML =
      '<div class="rt-winner__id">' +
        '<div class="rt-winner__logo-col"><span class="rt-winner__tag rt-winner__tag--sponsored">Reklaam</span>' + logoHtml(sp, st) + '</div>' +
        '<span class="rt-winner__divider" aria-hidden="true"></span>' +
        '<div class="rt-winner__col2">' +
          '<div class="rt-winner__name">' + esc(sp.bank) + ' · ' + esc(stripParenthetical(sp.product)) + '</div>' +
          '<div class="rt-rating"><b>' + heroRate + '</b> ' + esc(heroSub) + '</div>' +
          condChips(sp) +
        '</div>' +
      '</div>' +
      '<div class="rt-winner__cta">' +
        '<a class="rt-btn rt-btn--brand" href="' + esc(sp.linkUrl || sp.sourceUrl) + '" target="_blank" rel="nofollow noopener">Loe lähemalt</a>' +
        promoHtml +
      '</div>';
  }

  /* ---------- render: compare (max 3 accounts, sticky tray + table) ---------- */
  function renderCompareTray(root) {
    var el = root.querySelector('#rtCompareTray');
    var ks = compareKeys();
    if (!ks.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    var chips = ks.map(function (id) {
      var a = accountById(id);
      if (!a) return '';
      var st = styleFor(a);
      // Bank name alone is not enough here: comparing a bank's term deposit
      // against its own flexible product (e.g. SEB Tähtajaline hoius vs SEB
      // Digikassa) is a real use case, so the chip must show which product.
      var label = a.bank + ' · ' + a.product;
      return '<span class="rt-compare-chip">' + logoHtml(a, st, 'rt-logo--sm') + esc(label) +
        '<button type="button" data-compare-remove="' + esc(id) + '" aria-label="Eemalda ' + esc(label) + ' võrdlusest">' + CROSS + '</button></span>';
    }).join('');
    el.innerHTML = '<div class="rt-compare-tray__inner">' +
      '<div class="rt-compare-tray__chips">' + chips + '<span class="rt-compare-tray__hint">' + ks.length + '/' + COMPARE_MAX + ' valitud</span></div>' +
      '<div class="rt-compare-tray__actions">' +
        '<button type="button" class="rt-btn--text" data-compare-clear>Tühjenda</button>' +
        '<button type="button" class="rt-btn rt-btn--dark rt-btn--sm" data-compare-toggle' + (ks.length < 2 ? ' disabled' : '') + '>' + (state.compareOpen ? 'Peida võrdlus' : 'Võrdle ' + ks.length + ' hoiust') + '</button>' +
      '</div></div>';
  }
  function renderComparePanel(root) {
    var el = root.querySelector('#rtComparePanel');
    var ks = compareKeys();
    var accts = ks.map(accountById).filter(Boolean);
    if (!state.compareOpen || accts.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
    var pf = state.profile;
    function fmtRate(a) {
      if (pf) {
        var s = simulate(a, pf);
        if (s.blocked === 'min') return '<span class="rt-soft">Ei sobi - miinimum ' + eur(a.minDeposit) + '</span>';
        if (s.blocked === 'term') return '<span class="rt-soft">Ei paku nii lühikest tähtaega</span>';
        return pct(s.rate) + '<span class="rt-soft"> (' + s.rateTermMonths + ' kuud)</span>';
      }
      if (a.kind !== 'term') return pct(bestRate(a)) + '<span class="rt-soft"> (muutuv)</span>';
      return pct(bestRate(a)) + '<span class="rt-soft"> (' + bestTermMonths(a) + ' kuud)</span>';
    }
    function fmtNet(a) {
      if (!pf) return '<span class="rt-soft">Sisesta summa ja tähtaeg</span>';
      var s = simulate(a, pf);
      return s.blocked ? '—' : eur2(s.net);
    }
    var rows = [
      { l: pf ? 'Intress sinu perioodiga (bruto)' : 'Kõrgeim intress (bruto)', v: fmtRate },
      { l: 'Netotulu kohe pärast maksu', v: fmtNet },
      { l: 'Miinimumsumma', v: function (a) { return a.minDeposit === 0 ? 'Miinimumita' : eur(a.minDeposit); } },
      { l: 'Kapitali tagatis', v: function (a) { return esc(a.guaranteeScheme); } },
      { l: 'Raha kättesaadavus', v: function (a) { return a.kind === 'term' ? 'Tähtaja lõpus' : esc(a.withdrawalSpeed || 'Kohe'); } },
      { l: 'Nõuab palgakontot', v: function (a) { return bool(a.salaryRequired); } },
      { l: 'Kuutasu', v: function (a) { return a.monthlyFee ? eur2(a.monthlyFee) : '0 €'; } },
      { l: 'Ennetähtaegne lõpetamine', v: function (a) { return a.earlyWithdrawal ? esc(a.earlyWithdrawal.short) : '—'; } },
      { l: 'Automaatne pikenemine', v: function (a) { return a.autoRenewal ? esc(a.autoRenewal.short) : '—'; } },
      { l: 'Viimati kontrollitud', v: function (a) { return a.checkedOn ? esc(a.checkedOn) : '—'; } },
      { l: '', v: function (a) { return '<a class="rt-btn rt-btn--ghost rt-btn--sm" href="' + esc(a.linkUrl || a.sourceUrl) + '" target="_blank" rel="nofollow noopener">Loe lähemalt</a>'; } }
    ];
    var head = '<tr><th></th>' + accts.map(function (a) {
      var st = styleFor(a);
      return '<th>' + logoHtml(a, st, 'rt-logo--sm') + esc(a.bank) + '<span class="rt-soft"> · ' + esc(a.product) + '</span></th>';
    }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr><th>' + esc(r.l) + '</th>' + accts.map(function (a) { return '<td>' + r.v(a) + '</td>'; }).join('') + '</tr>';
    }).join('');
    el.hidden = false;
    el.innerHTML = '<div class="rt-compare-panel__head"><h2>Võrdlus kõrvuti</h2><button type="button" class="rt-x" data-compare-toggle aria-label="Sulge võrdlus">' + CROSS + '</button></div>' +
      '<div class="rt-compare-scroll"><table class="rt-compare-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }
  function refreshCompare(root) { renderCompareTray(root); renderComparePanel(root); }

  // A real dropdown component, not a native <select> - a native select's
  // open option list is rendered by the OS/browser chrome and simply cannot
  // be restyled with CSS in any browser, so no amount of CSS on it will
  // ever match a custom Webflow dropdown's look (rounded panel, highlighted
  // active option, etc.) once it's open. This mirrors that pattern:
  // a toggle button showing the current choice + a floating options panel.
  var SORT_LABELS = { rate: 'Kõrgeim intress', min: 'Madalaim miinimum', yield: 'Suurim tulu (simulatsioon)' };
  var SORT_ORDER = ['rate', 'min', 'yield'];
  function renderSortSelect(root) {
    var label = root.querySelector('#rtSortLabel'), list = root.querySelector('#rtSortList');
    if (!label || !list) return;
    label.textContent = SORT_LABELS[state.sort];
    list.innerHTML = SORT_ORDER.map(function (v) {
      var disabled = v === 'yield' && !state.profile;
      return '<div class="rt-select__option' + (state.sort === v ? ' is-active' : '') + (disabled ? ' is-disabled' : '') +
        '" data-value="' + v + '" role="option" aria-selected="' + (state.sort === v) + '" aria-disabled="' + disabled + '">' + SORT_LABELS[v] + '</div>';
    }).join('');
  }

  function render(root) { renderActive(root); renderList(root); renderSponsored(root); refreshCompare(root); }

  /* ---------- events ---------- */
  function reset(root) { state.on = {}; state.minRate = null; state.visible = PAGE; renderFilters(root); render(root); }
  function clearSim(root) {
    state.profile = null;
    root.querySelector('#rtCalcForm').reset();
    if (state.sort === 'yield') state.sort = 'rate';
    state.visible = PAGE; renderList(root); renderSponsored(root); refreshCompare(root); renderSortSelect(root);
  }

  // Bubbles are `position:fixed` (see comparator.css) and stay nested
  // inside .rt-tip - NOT reparented to <body>. That was tried and reverted:
  // #rt-hoius declares all of the widget's colour/shadow tokens (--ink,
  // --line-strong, --sh-2, ...) as custom properties on itself, and CSS
  // custom properties only inherit down the DOM tree, so a bubble moved
  // outside #rt-hoius lost every one of them - transparent background, no
  // text colour, no shadow. Keeping the bubble nested keeps those tokens
  // working; the tradeoff is the filters-sidebar case below has to stay
  // clear of the result cards by geometry (never overlapping them) rather
  // than relying on a reparent to dodge any stacking-context ordering.
  //
  // Two placement modes, chosen by where the tip lives:
  // - Side (right of the button, flip left near the viewport edge) for
  //   tips inside the result cards, matching the real site's own
  //   .help-text_wrapper/.triangle-tip exactly (see comparator.css).
  // - Above/below, clamped to the sidebar's own width, for tips inside the
  //   filters sidebar (#rtFilters). That sidebar sits to the left of the
  //   results grid, so a side-opening bubble there would run out over the
  //   result cards; clamping it to open above/below AND never wider than
  //   the sidebar itself keeps it entirely over open space.
  function positionTipBubble(tipEl) {
    var btn = tipEl.querySelector('.rt-tip__btn'), bubble = tipEl.querySelector('.rt-tip__bubble');
    var arrow = tipEl.querySelector('.rt-tip__arrow');
    if (!btn || !bubble) return;
    var r = btn.getBoundingClientRect(), bw = bubble.offsetWidth || 352, bh = bubble.offsetHeight || 60;
    var gap = 12;
    // Wider breathing room from the screen edge on phones - 8px read as
    // touching the edge with no padding at all once the bubble's own
    // rounded corners and shadow are factored in.
    var edge = window.innerWidth <= 600 ? 20 : 8;

    // Shared "opens above/below, arrow on top/bottom edge" layout - used both
    // for the filters sidebar (always, no room to open sideways) and, on
    // narrow phone widths, for result-card tips too (see below): a side-
    // opening bubble that doesn't actually fit beside the button just gets
    // clamped sideways to stay on-screen, which leaves the arrow (fixed to
    // the bubble's own left/right edge in CSS, not tracking that clamp)
    // pointing at empty screen edge instead of the button it belongs to.
    function positionAsTop(minX, maxX, maxW) {
      bubble.style.maxWidth = Math.min(maxW, 352) + 'px';
      var w = Math.min(bw, maxW);
      var minLeft = minX, maxLeft = maxX - w;
      var left = Math.max(minLeft, Math.min(r.left + r.width / 2 - w / 2, Math.max(minLeft, maxLeft)));
      var below = r.top - gap - bh < edge;
      var top = below ? r.bottom + gap : r.top - gap - bh;
      bubble.style.left = left + 'px';
      bubble.style.top = top + 'px';
      bubble.classList.add('rt-tip__bubble--top');
      bubble.classList.remove('rt-tip__bubble--side', 'rt-tip__bubble--flip-left');
      bubble.classList.toggle('rt-tip__bubble--below', below);
      if (arrow) {
        var margin = 18;
        var arrowLeft = Math.max(margin, Math.min(w - margin, r.left + r.width / 2 - left));
        arrow.style.left = arrowLeft + 'px';
        arrow.style.top = '';
      }
    }

    var sidebar = tipEl.closest('#rtFilters');
    if (sidebar) {
      var sr = sidebar.getBoundingClientRect();
      positionAsTop(sr.left + edge, sr.right - edge, Math.max(160, sr.width - edge * 2));
      return;
    }

    bubble.style.maxWidth = '';
    var fitsRight = r.right + gap + bw <= window.innerWidth - edge;
    var fitsLeft = r.left - gap - bw >= edge;
    if (!fitsRight && !fitsLeft) {
      positionAsTop(edge, window.innerWidth - edge, window.innerWidth - edge * 2);
      return;
    }

    var flipLeft = !fitsRight;
    var left = flipLeft ? r.left - gap - bw : r.right + gap;
    left = Math.max(edge, Math.min(left, window.innerWidth - bw - edge));
    var top = Math.max(edge, Math.min(r.top + r.height / 2 - bh / 2, window.innerHeight - bh - edge));
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    bubble.classList.add('rt-tip__bubble--side');
    bubble.classList.remove('rt-tip__bubble--top', 'rt-tip__bubble--below');
    bubble.classList.toggle('rt-tip__bubble--flip-left', flipLeft);
    if (arrow) {
      // Keeps the arrow pointed at the button's true centre even when top
      // got clamped to the viewport, and stays clear of the bubble's own
      // rounded corners (0.75rem radius) so it never rides up onto the curve.
      var radius = 12, margin2 = radius + 6;
      var arrowTop = Math.max(margin2, Math.min(bh - margin2, r.top + r.height / 2 - top));
      arrow.style.top = arrowTop + 'px';
      arrow.style.left = '';
    }
  }
  function repositionOpenTip(root) {
    var open = root.querySelector('.rt-tip.is-open');
    if (open) positionTipBubble(open);
  }

  // Shared with initStickySidebar()'s headerOffset(): finds the bottom edge
  // of whatever fixed/sticky chrome (a Webflow navbar) sits flush against
  // the top of the viewport, by behaviour rather than by guessing its tag
  // or class name (see the long comment where the sidebar uses this).
  function detectFixedChromeBottom() {
    var vw = window.innerWidth, bottom = 0;
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var style = window.getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      var rect = el.getBoundingClientRect();
      if (rect.top <= 2 && rect.bottom > 0 && rect.width >= vw * 0.5) {
        bottom = Math.max(bottom, rect.bottom);
      }
    }
    return bottom;
  }

  // A slower, custom-eased smooth scroll that stops with `gap` clearance
  // below any fixed navbar - native `scrollIntoView({behavior:'smooth'})`
  // can't be slowed down (the browser owns its duration) and has no way to
  // stop short of an element's exact top, so it was landing the compare
  // panel right under the navbar with its heading hidden behind it.
  function smoothScrollToY(targetY, duration) {
    var startY = window.scrollY, delta = targetY - startY, start = null;
    function step(ts) {
      if (start == null) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      window.scrollTo(0, startY + delta * eased);
      if (t < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }
  function smoothScrollToElement(el, extraGap) {
    var top = el.getBoundingClientRect().top + window.scrollY - detectFixedChromeBottom() - 16 - (extraGap || 0);
    smoothScrollToY(Math.max(0, top), 900);
  }

  // Reformats #rtAmount with space thousand-separators as the person types
  // (matching mil()'s own formatting, e.g. "10 000"), rather than leaving it
  // as a plain type=number field with no grouping. Restores the cursor to
  // the same position relative to the surrounding DIGITS (not characters),
  // since a naive "reformat then leave cursor at the end" would jump the
  // caret to the end of the field on every keystroke - annoying when
  // correcting a digit in the middle of a large number.
  function formatAmountInput(el) {
    var digitsBeforeCursor = el.value.slice(0, el.selectionStart).replace(/\D/g, '').length;
    var digits = el.value.replace(/\D/g, '');
    var formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    el.value = formatted;
    var seen = 0, pos = formatted.length;
    for (var i = 0; i < formatted.length; i++) {
      if (formatted[i] !== ' ') seen++;
      if (seen === digitsBeforeCursor) { pos = i + 1; break; }
    }
    if (digitsBeforeCursor === 0) pos = 0;
    el.setSelectionRange(pos, pos);
  }

  function bind(root) {
    root.addEventListener('mouseover', function (e) {
      var tipEl = e.target.closest ? e.target.closest('.rt-tip') : null;
      if (tipEl) positionTipBubble(tipEl);
    });
    root.addEventListener('focusin', function (e) {
      var tipEl = e.target.closest ? e.target.closest('.rt-tip') : null;
      if (tipEl) positionTipBubble(tipEl);
    });
    document.addEventListener('scroll', function () { repositionOpenTip(root); }, true);
    window.addEventListener('resize', function () { repositionOpenTip(root); });

    root.addEventListener('click', function (e) {
      var t = e.target, tb = t.closest('.rt-tip__btn');
      root.querySelectorAll('.rt-tip.is-open').forEach(function (x) { if (!tb || x !== tb.parentNode) x.classList.remove('is-open'); });
      var sortWrap = root.querySelector('#rtSortWrap');
      if (sortWrap && !t.closest('#rtSortWrap')) sortWrap.classList.remove('is-open');
      var sortToggle = t.closest('#rtSortToggle');
      if (sortToggle) { sortWrap.classList.toggle('is-open'); return; }
      var sortOpt = t.closest('.rt-select__option');
      if (sortOpt) {
        if (!sortOpt.classList.contains('is-disabled')) {
          state.sort = sortOpt.getAttribute('data-value');
          state.visible = PAGE;
          sortWrap.classList.remove('is-open');
          renderSortSelect(root); renderList(root);
        }
        return;
      }
      if (tb) {
        // The real site has zero IX3 interactions defined anywhere (verified
        // live via Webflow MCP) - its tooltip is pure CSS :hover, click does
        // nothing. Matching that exactly on a device that actually HAS hover
        // means a click here must be a no-op. Click-to-toggle only exists for
        // touch devices, which have no hover and would otherwise never be
        // able to see the tip content at all.
        if (!window.matchMedia || !window.matchMedia('(hover: none)').matches) return;
        var tipEl = tb.parentNode;
        tipEl.classList.toggle('is-open');
        if (tipEl.classList.contains('is-open')) positionTipBubble(tipEl);
        return;
      }
      var tg = t.closest('[data-action="toggle"]');
      if (tg) {
        var cardEl = tg.closest('.rt-card'), id = cardEl.getAttribute('data-id'), openIt = !state.expanded[id];
        if (openIt) state.expanded[id] = true; else delete state.expanded[id];
        renderList(root);
        if (!openIt) { var a = root.querySelector('.rt-card[data-id="' + id.replace(/"/g, '\\"') + '"]'); if (a && a.getBoundingClientRect().top < 0) a.scrollIntoView({ block: 'start' }); }
        return;
      }
      if (t.closest('#rtMoreBtn')) { state.visible += PAGE; renderList(root); return; }
      if (t.closest('.rt-reset')) { reset(root); return; }
      if (t.closest('#rtProfileReset')) { clearSim(root); return; }
      var gh = t.closest('.rt-group__head');
      if (gh) { var g = gh.parentNode, o = g.getAttribute('data-open') === 'true'; g.setAttribute('data-open', o ? 'false' : 'true'); gh.setAttribute('aria-expanded', o ? 'false' : 'true'); return; }
      var rm = t.closest('[data-remove]');
      if (rm) {
        var a2 = rm.getAttribute('data-remove');
        if (a2 === 'k') delete state.on[rm.getAttribute('data-k')];
        else if (a2 === 'rate') state.minRate = null;
        state.visible = PAGE; renderFilters(root); render(root); return;
      }
      if (t.closest('.rt-collapse')) { root.querySelector('#rtLayout').classList.add('is-collapsed'); window.dispatchEvent(new Event('resize')); return; }
      if (t.closest('.rt-panel-open')) { root.querySelector('#rtLayout').classList.remove('is-collapsed'); window.dispatchEvent(new Event('resize')); return; }
      if (t.closest('.rt-filters-open')) { root.querySelector('#rtLayout').classList.remove('is-collapsed'); document.body.classList.add('rt-drawer-open'); return; }
      if (t.closest('.rt-drawer-close')) { document.body.classList.remove('rt-drawer-open'); return; }
      var rp = t.closest('[data-rate-preset]');
      if (rp) {
        var pv = parseFloat(rp.getAttribute('data-rate-preset'));
        state.minRate = state.minRate === pv ? null : pv;
        state.visible = PAGE; renderFilters(root); render(root); return;
      }
      var crm = t.closest('[data-compare-remove]');
      if (crm) { delete state.compare[crm.getAttribute('data-compare-remove')]; renderList(root); refreshCompare(root); return; }
      if (t.closest('[data-compare-clear]')) { state.compare = {}; state.compareOpen = false; renderList(root); refreshCompare(root); return; }
      if (t.closest('[data-compare-toggle]')) {
        state.compareOpen = !state.compareOpen;
        refreshCompare(root);
        if (state.compareOpen) {
          var panel = root.querySelector('#rtComparePanel');
          if (panel && !panel.hidden) smoothScrollToElement(panel);
        }
        return;
      }
    });

    root.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('input[type="checkbox"][data-compare]')) {
        var bank = t.getAttribute('data-compare');
        if (t.checked) {
          if (compareKeys().length >= COMPARE_MAX) { t.checked = false; return; }
          state.compare[bank] = true;
        } else {
          delete state.compare[bank];
        }
        renderList(root); refreshCompare(root);
      }
    });

    var filters = root.querySelector('#rtFilters');
    filters.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('input[type="checkbox"][data-k]')) { if (t.checked) state.on[t.getAttribute('data-k')] = true; else delete state.on[t.getAttribute('data-k')]; }
      state.visible = PAGE; render(root);
    });
    filters.addEventListener('input', function (e) {
      if (e.target.id !== 'rtMinRate') return;
      var v = parseFloat(e.target.value); state.minRate = isNaN(v) ? null : v; state.visible = PAGE; render(root);
    });

    root.querySelector('#rtAmount').addEventListener('input', function (e) { formatAmountInput(e.target); });

    root.querySelector('#rtCalcForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var amount = parseFloat(root.querySelector('#rtAmount').value.replace(/\s/g, '')),
        months = parseFloat(root.querySelector('#rtTerm').value);
      if (isNaN(amount) || amount <= 0) { root.querySelector('#rtAmount').focus(); return; }
      // 0 is a real, deliberate input ("I might need this any time"), not a
      // missing one - only an actually blank/negative field falls back to
      // the 12-month default.
      state.profile = { amount: amount, months: isNaN(months) || months < 0 ? 12 : Math.min(months, 120) };
      state.sort = 'yield';
      state.visible = PAGE; renderList(root); renderSponsored(root); refreshCompare(root); renderSortSelect(root);
      smoothScrollToElement(root.querySelector('#rtLayout'));
    });
    root.querySelector('#rtCalcReset').addEventListener('click', function () { clearSim(root); });

    // The in-root click listener above only ever sees clicks inside #rt-hoius,
    // so a click on real page content outside the widget (the navbar, the
    // article text, anywhere) never reached it and left the sort dropdown
    // stuck open. This catches exactly that gap.
    document.addEventListener('click', function (e) {
      if (root.contains(e.target)) return;
      var sw = root.querySelector('#rtSortWrap');
      if (sw) sw.classList.remove('is-open');
      // Same gap as the sort dropdown above: a tip opened by tapping its
      // button (the click-to-open path exists for touch devices, which
      // have no hover) only ever got closed by a click still inside root -
      // a tap on real page content outside the widget left it stuck open
      // forever, exactly as reported.
      root.querySelectorAll('.rt-tip.is-open').forEach(function (x) { x.classList.remove('is-open'); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.body.classList.remove('rt-drawer-open');
        root.querySelectorAll('.rt-tip.is-open').forEach(function (x) { x.classList.remove('is-open'); });
        var sw = root.querySelector('#rtSortWrap');
        if (sw) sw.classList.remove('is-open');
      }
    });
  }


  /* ---------- sticky sidebar (plain CSS `position:sticky`) ----------
     .rt-filters itself has `position:sticky;top:var(--rt-sticky-top)` (see
     comparator.css). All this does is compute that one top-offset - how
     much fixed/sticky site chrome (a Webflow navbar) sits above the
     content - and keep it in sync. No scroll listener, no per-frame
     getBoundingClientRect/position mutation: the browser's own sticky
     positioning handles pinning and un-pinning at the bottom of the
     results column, so there's no risk of the JS fighting the scrollbar. */
  function initStickySidebar(root) {
    var layout = root.querySelector('#rtLayout');
    var cell = root.querySelector('#rtFiltersCell');
    var sidebar = root.querySelector('#rtFilters');
    if (!layout || !cell || !sidebar) return;
    var GAP = 24;

    // Detects a fixed/sticky site navbar so the sidebar doesn't tuck under
    // it. See detectFixedChromeBottom() above for how; this just adds the
    // sidebar's own breathing-room GAP and the manual override.
    function headerOffset() {
      if (typeof window.RT_HEADER_OFFSET === 'number') return window.RT_HEADER_OFFSET + GAP;
      return detectFixedChromeBottom() + GAP;
    }

    function applyTopVar() { sidebar.style.setProperty('--rt-sticky-top', headerOffset() + 'px'); }
    applyTopVar();
    window.addEventListener('resize', applyTopVar);
    // Re-check once layout has settled: web fonts and any late-loading
    // Webflow nav content can change the navbar's real height after our
    // first pass.
    setTimeout(applyTopVar, 600);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyTopVar);

    // Plain CSS `position:sticky` on .rt-filters (comparator.css) covers
    // ordinary pages for free. But ANY ancestor with a non-visible overflow
    // (overflow/overflow-x/overflow-y) permanently disables native sticky
    // for everything inside it, per spec - and Webflow pages routinely wrap
    // sections in overflow:hidden for reveal/clip effects, with zero
    // indication to whoever pastes an embed inside one. Walk the ancestor
    // chain once and, if blocked, fall back to a JS-driven position:fixed
    // pin. Unlike overflow, `position:fixed` is computed against the
    // viewport regardless of ancestor overflow (ancestors would need
    // transform/filter/perspective to trap it instead, which is a much
    // rarer thing for a page to do to a random content section).
    function stickyBlockedByAncestor() {
      var node = cell.parentElement;
      while (node && node !== document.documentElement) {
        var cs = window.getComputedStyle(node);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return true;
        node = node.parentElement;
      }
      return false;
    }
    // backface-visibility:hidden (comparator.css) alone doesn't fully stop
    // WebKit/Safari from only repainting a pinned position:fixed/sticky
    // element at intervals during a fast/momentum scroll rather than every
    // frame - it still visibly lags a beat behind and snaps into place once
    // scrolling settles. transform:translateZ(0)/will-change:transform is
    // the stronger fix, but it also makes this element the containing
    // block for any position:fixed descendant - which breaks .rt-tip__bubble
    // (a filter tooltip), whose whole reason for being position:fixed is to
    // escape this sidebar's own overflow:hidden/auto clipping. Applying it
    // as a class toggled on only while actively scrolling, and removed
    // ~200ms after the last scroll event, gets the stronger fix exactly
    // when it's needed (mid-fast-scroll, when nobody is hovering a tooltip
    // anyway) without it being active while a tooltip could be open.
    var gpuTimer = null;
    function bumpGpuLayer() {
      sidebar.classList.add('rt-filters--gpu');
      clearTimeout(gpuTimer);
      gpuTimer = setTimeout(function () { sidebar.classList.remove('rt-filters--gpu'); }, 200);
    }
    window.addEventListener('scroll', bumpGpuLayer, { passive: true });

    if (!stickyBlockedByAncestor()) return;

    // --- JS fallback -------------------------------------------------
    // Only ever writes to the DOM on an actual flow/pinned/settled
    // transition, never on every scroll frame - once pinned or settled,
    // the browser's own fixed/absolute positioning keeps it in place with
    // zero further JS, which is what avoids the jitter a naive "recompute
    // and rewrite every frame" version would have.
    layout.classList.add('rt-js-sticky');
    var zone = null;

    // tick() only fires on scroll/resize, but the results column's height
    // changes for lots of other reasons - "Näita veel", a filter narrowing
    // the list, opening the compare panel, submitting the calculator - none
    // of which dispatch a scroll or resize event. Without this, a "settled"
    // sidebar keeps its stale anchor point (computed from the OLD, shorter
    // column) until the next scroll, then snaps to the newly-correct one -
    // which is exactly the "sidebar jumps once I start scrolling" symptom.
    // ResizeObserver catches every one of those cases directly, no matter
    // what caused the height change.
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () { tick(true); });
      ro.observe(cell);
    }

    function tick(force) {
      if (window.innerWidth <= 900 || layout.classList.contains('is-collapsed')) {
        if (zone !== 'flow') setZone('flow');
        return;
      }
      var top = headerOffset(), lr = cell.getBoundingClientRect(), h = sidebar.offsetHeight;
      // "Settled" anchors the sidebar so its OWN bottom lines up with the
      // cell's bottom (top: lr.height - h) - this is what lets it detach
      // from the viewport and scroll away naturally with the rest of the
      // page once you've scrolled past the results. When the sidebar is
      // TALLER than the cell (a narrow filter result, e.g. just one account
      // left, makes the results column shorter than the filters panel
      // itself), that math goes negative; clamping it to 0 anchors the
      // sidebar's TOP to the cell's top instead of letting it poke up above
      // the cell. The earlier fix here disabled "settled" entirely in this
      // case and stayed "pinned" forever - which meant a one-result filter
      // left the sidebar fixed on screen all the way through the rest of the
      // page (the native Sõnastik section, footer, everything), since there
      // was no code path left to ever let go of position:fixed.
      var settledTop = Math.max(0, lr.height - h);
      var next = lr.top > top ? 'flow' : (lr.bottom - h >= top ? 'pinned' : 'settled');
      if (!force && next === zone) return;
      setZone(next, top, lr, settledTop);
    }
    function setZone(next, top, lr, settledTop) {
      zone = next;
      if (next === 'pinned') {
        sidebar.style.position = 'fixed';
        sidebar.style.top = top + 'px';
        sidebar.style.left = lr.left + 'px';
        sidebar.style.width = lr.width + 'px';
      } else if (next === 'settled') {
        sidebar.style.position = 'absolute';
        sidebar.style.top = settledTop + 'px';
        sidebar.style.left = '0';
        sidebar.style.width = '100%';
      } else {
        sidebar.style.position = '';
        sidebar.style.top = '';
        sidebar.style.left = '';
        sidebar.style.width = '';
      }
    }
    // A scroll-event-driven rAF (the previous approach here) waits for the
    // browser to dispatch a `scroll` event before scheduling a frame, and a
    // fast trackpad/fling scroll can dispatch those in bursts the compositor
    // has already painted past - which is exactly what reads as the sidebar
    // "lagging" a frame or two right as it crosses the pin point. Polling
    // tick() in a persistent requestAnimationFrame loop instead ties it
    // directly to the paint clock, so it can never fall behind regardless of
    // how scroll events are batched. tick() is cheap (one
    // getBoundingClientRect + a few comparisons) and only touches the DOM on
    // an actual zone change, so running it every frame for the page's
    // lifetime costs nothing measurable - and this fallback only loads at
    // all on pages where native sticky is blocked by an ancestor's overflow.
    function loop() { tick(false); window.requestAnimationFrame(loop); }
    function onResize() { tick(true); }
    window.addEventListener('resize', onResize);
    window.requestAnimationFrame(loop);
    tick(true);
  }

  /* ---------- shell markup ---------- */
  function shell() {
    return '' +
      '<section class="rt-winner" id="rtSponsored" aria-label="Reklaam"></section>' +

      '<section class="rt-calc" aria-labelledby="rtCalcTitle">' +
        '<h2 id="rtCalcTitle" class="rt-calc__title">Arvuta, kui palju teenid</h2>' +
        '<p class="rt-calc__sub">Sisesta summa ja tähtaeg, siis järjestame hoiused selle järgi, mis sulle kõige rohkem tulu toob.</p>' +
        '<form id="rtCalcForm" novalidate>' +
          '<div class="rt-calc__grid">' +
            '<div class="rt-field">' +
              '<label for="rtAmount">Hoiustatav summa</label>' +
              '<p class="rt-field__help">Summa, mille soovid tähtajalisele hoiusele panna.</p>' +
              '<div class="rt-input"><input id="rtAmount" type="text" inputmode="numeric" autocomplete="off"><span class="rt-input__unit">€</span></div>' +
            '</div>' +
            '<div class="rt-field">' +
              '<label for="rtTerm">Tähtaeg</label>' +
              '<p class="rt-field__help">Mitmeks kuuks raha hoiusele jääb.</p>' +
              '<div class="rt-input"><input id="rtTerm" type="number" inputmode="numeric" min="0" max="120" step="1"><span class="rt-input__unit">kuud</span></div>' +
            '</div>' +
            '<div class="rt-calc__actions">' +
              '<button type="button" class="rt-btn rt-btn--ghost" id="rtCalcReset">Tühjenda</button>' +
              '<button type="submit" class="rt-btn rt-btn--dark">Arvuta</button>' +
            '</div>' +
          '</div>' +
        '</form>' +
        '<p class="rt-calc__note">Arvutus on ligikaudne: lihtintress, pärast 22% tulumaksu. Tähtajaliste hoiuste puhul kehtib fikseeritud intress kogu tähtaja jooksul. Paindlike hoiuste ja kontode puhul eeldab arvutus, et praegune muutuv intressimäär püsib kogu perioodi muutumatuna - tegelik tulu võib erineda. Ei sisalda panga ümardusi ega investeerimiskonto edasilükkamist. See ei ole finantsnõustamine.</p>' +
      '</section>' +

      '<section class="rt-compare-panel" id="rtComparePanel" aria-label="Panga võrdlus" hidden></section>' +

      '<div class="rt-layout" id="rtLayout">' +
        '<div class="rt-filters-cell" id="rtFiltersCell">' +
        '<aside class="rt-filters" id="rtFilters" aria-label="Filtrid">' +
          '<div class="rt-filters__head">' +
            '<h2>Filtrid</h2>' +
            '<span class="rt-n" id="rtCountHead">0 tulemust</span>' +
            '<button type="button" class="rt-btn--text rt-reset">Lähtesta</button>' +
            '<button type="button" class="rt-x rt-drawer-close" aria-label="Sulge filtrid"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
          '</div>' +
          '<div class="rt-filters__scroll">' +
            '<div class="rt-active" id="rtActiveFilters"></div>' +
            '<div id="rtFilterGroups"></div>' +
          '</div>' +
          '<div class="rt-filters__foot">' +
            '<button type="button" class="rt-btn rt-btn--ghost rt-btn--sm rt-collapse">Peida</button>' +
            '<button type="button" class="rt-btn--text rt-reset">Lähtesta filtrid</button>' +
            '<button type="button" class="rt-btn rt-btn--brand rt-drawer-close" id="rtDrawerApply">Näita tulemusi</button>' +
          '</div>' +
        '</aside>' +
        '</div>' +

        '<section class="rt-results" id="rtResults" aria-label="Tulemused">' +
          '<div id="rtProfileBar"></div>' +
          '<div class="rt-toolbar">' +
            '<button type="button" class="rt-btn rt-btn--ghost rt-filters-open"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>Filtrid <span class="rt-count-badge" id="rtBadgeMobile" hidden>0</span></button>' +
            '<button type="button" class="rt-btn rt-btn--ghost rt-panel-open"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>Näita filtreid</button>' +
            '<span class="rt-results-count" id="rtCountTop">0 tulemust</span>' +
            '<div class="rt-select" id="rtSortWrap">' +
              '<button type="button" class="rt-select__toggle" id="rtSortToggle" aria-haspopup="listbox" aria-expanded="false"><span id="rtSortLabel">Kõrgeim intress</span>' + CHEV + '</button>' +
              '<div class="rt-select__list" id="rtSortList" role="listbox" aria-label="Järjesta"></div>' +
            '</div>' +
          '</div>' +
          '<div id="rtList"></div>' +
          '<div class="rt-more" id="rtMore"></div>' +
          '<p class="rt-fonte" id="rtSource"></p>' +
        '</section>' +
      '</div>' +

      '<div class="rt-compare-tray" id="rtCompareTray" hidden></div>';
  }

  /* ---------- boot ---------- */
  var ET_MONTHS = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni', 'juuli', 'august', 'september', 'oktoober', 'november', 'detsember'];
  function formatEtMonthYear(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return ET_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function boot(root) {
    root.className = 'rt-comparator';
    root.innerHTML = shell();
    injectStyles();
    bind(root);
    renderSponsored(root);
    renderFilters(root);
    renderSortSelect(root);
    render(root);
    initStickySidebar(root);
    var src = root.querySelector('#rtSource');
    if (src) {
      src.innerHTML = 'Intressimäärad kogutud iga panga/platvormi ametlikult lehelt' +
        (META.lastUpdated ? ' (viimati uuendatud ' + esc(META.lastUpdated) + ')' : '') +
        '. Kontrolli tingimusi alati panga või platvormi enda lehel enne hoiuse avamist.';
    }
    // Populates a "Viimati uuendatud <kuu> <aasta>" element wherever it
    // lives on the page - deliberately NOT scoped to #rt-hoius, since this
    // is meant for a native Webflow text element near the H1 (matching how
    // other pages on the site already show a "Viimati uuendatud ..." line),
    // not something this embed renders itself. Give that element the
    // custom ID "rt-last-updated" in Webflow's element Settings panel; its
    // own placeholder text is only a fallback for if this script is slow
    // or blocked, since this always overwrites it once data.json loads.
    var lastUpdatedEl = document.getElementById('rt-last-updated');
    if (lastUpdatedEl && META.lastUpdated) {
      lastUpdatedEl.textContent = 'Viimati uuendatud ' + formatEtMonthYear(META.lastUpdated);
    }
  }

  function fail(root, msg) {
    root.innerHTML = '<div class="rt-empty" style="margin:1rem 0">' + esc(msg) + '</div>';
    injectStyles();
  }

  function init() {
    var root = document.getElementById(MOUNT_ID);
    if (!root) return;
    // Styles go up immediately, before the data fetch even starts - the
    // #rt-hoius:empty min-height rule they carry (see comparator.css) then
    // reserves roughly the widget's real height right away, so whatever
    // native Webflow content sits below it (e.g. a Sõnastik section) doesn't
    // jump up into empty space and then get shoved back down again once the
    // widget finishes loading. No visible spinner/text - a brief loading
    // state that flashes for a moment before data arrives read as worse
    // than just reserving the space silently.
    injectStyles();
    // Merges three independently-scraped datasets (see the file header) into
    // one ACCOUNTS list. Each fetch is tolerant on its own - one dataset
    // being unreachable should not blank out the other two - and init()
    // only fails outright when EVERY dataset failed to load.
    //
    // No explicit `cache` option: the previous `cache:'no-cache'` forced the
    // browser to revalidate with jsDelivr on every single page load, adding
    // a network round-trip even for a visitor whose cached copy was still
    // perfectly correct. Rates only change weekly, and the GitHub Action
    // already explicitly purges jsDelivr's CDN cache whenever data actually
    // changes (see update-rates.yml) - so the default cache behavior is
    // both faster and still correct.
    function get(url) {
      return fetch(url)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function (e) { return { accounts: [], lastUpdated: null, _error: e }; });
    }
    Promise.all([get(DATA_URL), get(FLEXIBLE_DATA_URL), get(FINTECH_DATA_URL)]).then(function (results) {
      var termData = results[0], flexData = results[1], finData = results[2];
      if (termData._error && flexData._error && finData._error) throw termData._error;
      ACCOUNTS = mergeAccounts(termData, flexData, finData);
      META = { lastUpdated: maxDate([termData.lastUpdated, flexData.lastUpdated, finData.lastUpdated]) };
      boot(root);
    }).catch(function (e) {
      fail(root, 'Andmete laadimine ebaõnnestus. Proovi lehte värskendada. (' + e.message + ')');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ---------- styles (Rahatarkus tokens) ---------- */
  function injectStyles() {
    if (document.getElementById('rt-comparator-css')) return;
    var s = document.createElement('style');
    s.id = 'rt-comparator-css';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  var STYLES = '/* ==========================================================================\n   Rahatarkus - Tähtajalise hoiuse võrdlus\n   All rules scoped under #rt-hoius (ID = specificity 1,0,0) so they beat both\n   Webflow\'s Client-First classes and our own resets, and don\'t leak out.\n   ========================================================================== */\n\n#rt-hoius{\n  --brand:#0072ce; --brand-600:#005bb5; --brand-tint:#eff4ff; --brand-soft:#d1e0ff;\n  --ink:#081c15; --ink-2:#3a4454; --ink-3:#4f5969; --ink-4:#697386;\n  --bg:#fcfcfd; --bg-2:#f9fafb; --bg-3:#f2f4f7; --bg-4:#e9ecf1; --white:#fff;\n  --line:#e6e9ef; --line-2:#eef1f5; --line-strong:#ced5df;\n  --green:#067647; --green-bg:#e7f5ed; --red:#b42318; --red-bg:#fef3f2;\n  --amber-bg:#fffaeb; --amber-fg:#93591a; --amber-line:#fedf89;\n  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-xl:22px;\n  --sh-1:0 1px 2px rgba(8,28,21,.04);\n  --sh-2:0 6px 24px rgba(8,28,21,.08);\n  --f-head:"Tiempos Headline","Source Serif 4",Georgia,serif;\n  --f-body:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;\n  font-family:var(--f-body);color:var(--ink);font-size:16px;line-height:1.6;letter-spacing:-.01em;\n  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;\n}\n\n/* reset */\n#rt-hoius *,#rt-hoius *::before,#rt-hoius *::after{box-sizing:border-box}\n#rt-hoius h2,#rt-hoius h3,#rt-hoius h4{font-family:var(--f-head);font-weight:300;line-height:1.25;margin:0;letter-spacing:-.02em;color:var(--ink)}\n#rt-hoius p{margin:0}\n#rt-hoius ul{margin:0;padding:0;list-style:none}\n#rt-hoius a{color:var(--brand);text-decoration:none}\n#rt-hoius button{margin:0;padding:0;background:none;border:0;font:inherit;color:inherit;cursor:pointer;text-align:left}\n#rt-hoius input,#rt-hoius select{font:inherit;color:inherit}\n/* Webflow\'s own global stylesheet ships an unscoped `svg{width:100%}` rule.\n   The cascade is per-property, not per-rule, so our higher-specificity\n   #rt-hoius selectors below that only set flex/margin (never width) don\'t\n   block it - every icon (chevrons, checkmarks, alert/info glyphs) was\n   stretching to fill its flex container, squeezing sibling text to 0 width\n   and wrapping it. Declaring width/height:auto here wins on specificity and\n   reverts every svg to its own width="".../height="..." attributes. */\n#rt-hoius svg{display:block;width:auto;height:auto}\n#rt-hoius table{border-collapse:collapse;width:100%}\n#rt-hoius dl,#rt-hoius dd,#rt-hoius dt{margin:0}\n#rt-hoius :focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:6px}\n#rt-hoius input[type=number]{-moz-appearance:textfield;appearance:textfield}\n#rt-hoius input[type=number]::-webkit-inner-spin-button,#rt-hoius input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}\n\n/* buttons */\n#rt-hoius .rt-btn{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;padding:.6875rem 1.25rem;border-radius:var(--r-md);border:1px solid transparent;font-size:.9375rem;font-weight:500;letter-spacing:-.0125em;line-height:1.2;white-space:nowrap;cursor:pointer;transition:background-color .18s ease,border-color .18s ease,color .18s ease,box-shadow .18s ease;text-decoration:none}\n#rt-hoius a.rt-btn{text-decoration:none}\n#rt-hoius .rt-btn--brand,#rt-hoius a.rt-btn--brand{background:var(--brand);color:#fff;border-color:var(--brand)}\n#rt-hoius .rt-btn--brand:hover,#rt-hoius a.rt-btn--brand:hover{background:var(--brand-600);border-color:var(--brand-600);color:#fff}\n#rt-hoius .rt-btn--dark,#rt-hoius a.rt-btn--dark{background:var(--ink);color:#fff;border-color:var(--ink)}\n#rt-hoius .rt-btn--dark:hover{background:#0d2b20;border-color:#0d2b20;color:#fff}\n#rt-hoius .rt-btn--ghost{background:var(--white);border-color:var(--line-strong);color:var(--ink-2)}\n#rt-hoius .rt-btn--ghost:hover{border-color:var(--ink);color:var(--ink)}\n#rt-hoius .rt-btn--sm{padding:.5rem .875rem;font-size:.875rem}\n#rt-hoius .rt-btn--text{background:none;border:0;padding:0;color:var(--ink-4);font-size:.8125rem;font-weight:500;text-decoration:underline;text-underline-offset:2px}\n#rt-hoius .rt-btn--text:hover{color:var(--brand)}\n#rt-hoius .rt-count-badge{display:inline-grid;place-items:center;min-width:1.25rem;height:1.25rem;padding:0 .375rem;border-radius:100vw;background:var(--brand);color:#fff;font-size:.75rem;font-weight:600}\n#rt-hoius .rt-count-badge[hidden]{display:none}\n\n/* winner/sponsored banner - white background, same 4px neutral border as\n   .rt-calc right below it on the page, so the two cards read as a matched\n   pair rather than two different border treatments stacked on top of each\n   other. */\n#rt-hoius .rt-winner{border:4px solid var(--bg-3);border-radius:1.25rem;background:var(--white);padding:1rem 1.25rem 1rem 2rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}\n#rt-hoius .rt-winner__tag{display:flex;align-items:center;gap:.4rem;font-size:.6875rem;font-weight:600;color:var(--brand-600);letter-spacing:.06em;text-transform:uppercase}\n/* "Reklaam" - same grey/uppercase/medium-weight treatment as the real\n   site\'s own ad label (text-color-quarterary/--ink-4, weight 500, 0.01em\n   tracking), but sized up from its literal 0.625rem to stay legible at this\n   banner\'s larger scale. */\n#rt-hoius .rt-winner__tag--sponsored{font-size:.8125rem;line-height:1.3;font-weight:500;color:var(--ink-4);letter-spacing:.01em;text-transform:uppercase}\n/* "Reklaam" sits above the logo, tightly grouped with it in its own\n   column, at a fixed gap - it moves together with the logo as one unit.\n   .rt-winner__id centers that column against .rt-winner__col2, so the two\n   columns are balanced against each other. */\n#rt-hoius .rt-winner__logo-col{display:flex;flex-direction:column;align-items:flex-start;gap:.375rem}\n/* Tall enough to visually span the full height of the row (logo + name +\n   rating + chips), like a real column separator, not a short tick mark.\n   Its own left/right margin (2rem, matching .rt-winner\'s own left padding)\n   controls the space right around the line itself, independent of the\n   wider gap .rt-winner__id keeps between the two columns overall. */\n#rt-hoius .rt-winner__divider{width:1px;align-self:stretch;background:var(--bg-4);flex:none;margin:0 2rem}\n#rt-hoius .rt-winner__id{display:flex;align-items:center;gap:0;min-width:0}\n#rt-hoius .rt-winner__col2{display:flex;flex-direction:column;gap:.3125rem;min-width:0}\n/* .rt-rating and .rt-conds each carry their own margin-top for use\n   elsewhere (details rows, result cards) - inside this flex column that\n   stacked on top of the column\'s own gap, doubling the space before each\n   row. Zeroed here so the column\'s gap is the only spacing. */\n#rt-hoius .rt-winner .rt-rating{margin-top:0}\n#rt-hoius .rt-winner .rt-conds{margin-top:0}\n#rt-hoius .rt-winner .rt-logo{width:4.25rem;height:3.75rem}\n#rt-hoius .rt-winner .rt-logo--square{width:3.75rem}\n/* CTA button + promo badge stacked, promo below the button - side by side\n   read as cramped/competing for attention at the card\'s width; stacked and\n   right-aligned lets the button stay the clear primary action with the\n   promo (e.g. "Kuni 100 € tasuta murdaktsiat/ETFi") as a quieter note\n   underneath it, still visually grouped with the button it belongs to. */\n#rt-hoius .rt-winner__cta{display:flex;flex-direction:column;align-items:flex-end;gap:.875rem;margin-left:auto}\n/* Not an h2-h4 element (a plain div), so it doesn\'t pick up the h2-h4 rule\'s\n   font-weight:300 above for free - has to be set explicitly to match every\n   other heading\'s weight on the real site. */\n#rt-hoius .rt-winner__name{font-family:var(--f-head);font-size:1.25rem;font-weight:300;line-height:1.25;letter-spacing:-.02em;color:var(--ink)}\n#rt-hoius .rt-rating{display:flex;align-items:baseline;gap:.5rem;margin-top:.25rem;font-size:.8125rem;color:var(--ink-4);flex-wrap:wrap}\n/* Actual figures (rates, earnings, this rating number) use the real site\'s\n   own .text-size-numbers treatment (queried via Webflow MCP), not the\n   h1-h6 heading treatment: font-weight 400 (regular) and near-zero\n   letter-spacing (-0.0056em), not the headings\' light 300 weight and\n   tighter -0.02em - h1-h6 explicitly set weight 300, but .text-size-numbers\n   doesn\'t override it and so inherits the body\'s default 400. Same font\n   family (Tiempos Headline) either way. */\n#rt-hoius .rt-rating b{font-family:var(--f-head);font-size:1.375rem;color:var(--brand-600);font-weight:400;letter-spacing:-.006em}\n#rt-hoius .rt-winner .rt-alert{flex:1 1 100%;margin-top:0}\n\n/* calculator\n   Matches the real "calculadora-form_wrapper" card used on the site\'s other\n   calculator pages (queried live via Webflow MCP: 4px solid border in\n   colors/border-tertiary #f2f4f7 - same value as our own --bg-3 token,\n   border-radius 1.25rem, 2.5rem padding, no box-shadow at all). Our old\n   1.5px border + soft shadow read as a much softer, blended edge than the\n   flat, crisp-bordered look used everywhere else on the site. */\n#rt-hoius .rt-calc{margin-top:1.5rem;background:var(--white);border:4px solid var(--bg-3);border-radius:1.25rem;padding:2.5rem}\n#rt-hoius .rt-calc__title{font-size:1.5rem}\n#rt-hoius .rt-calc__sub{font-size:.9375rem;color:var(--ink-4);margin:.375rem 0 1.5rem}\n#rt-hoius .rt-calc__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr)) auto;gap:1.25rem;align-items:end}\n#rt-hoius .rt-field{min-width:0}\n#rt-hoius .rt-field label{display:block;font-size:.875rem;font-weight:600;margin-bottom:.25rem;color:var(--ink)}\n#rt-hoius .rt-field__help{font-size:.75rem;color:var(--ink-4);line-height:1.45;margin-bottom:.75rem}\n#rt-hoius .rt-input{position:relative}\n#rt-hoius .rt-input input{width:100%;min-height:2.75rem;border:1px solid var(--line-strong);border-radius:var(--r-md);padding:.25rem 3rem .25rem .75rem;font-size:1rem;color:var(--ink);background:var(--white);letter-spacing:-.01em}\n#rt-hoius .rt-input input:focus{outline:none;border-color:#84adff;box-shadow:0 0 0 4px #d1e0ff}\n#rt-hoius .rt-input__unit{position:absolute;right:.875rem;top:50%;transform:translateY(-50%);color:var(--ink-4);font-size:.875rem;pointer-events:none}\n#rt-hoius .rt-calc__actions{display:flex;align-items:stretch;gap:.5rem}\n#rt-hoius .rt-calc__actions .rt-btn{min-height:2.75rem}\n#rt-hoius .rt-calc__note{margin-top:1.125rem;font-size:.8125rem;color:var(--ink-4);line-height:1.55}\n\n/* layout\n   The sidebar sticks with plain CSS `position:sticky`, no JS scroll-handler\n   repositioning. That needs .rt-filters-cell (the actual grid item) to be\n   STRETCHED to the full row height (the default `align-items:stretch` - do\n   not add align-items:start here) so the sticky element has real room to\n   travel before it "runs out" of containing block and settles at the\n   bottom; .rt-filters itself keeps its own natural (unstretched) height via\n   align-self:start and is what actually gets `position:sticky`. Previously\n   this used JS to toggle position:fixed/absolute on every scroll tick,\n   which forced synchronous layout reads (getBoundingClientRect/offsetHeight)\n   on each frame and could visibly jump/desync the scrollbar. Native sticky\n   is jank-free and needs no scroll listener at all. */\n#rt-hoius .rt-layout{display:grid;grid-template-columns:17rem minmax(0,1fr);gap:1.5rem;margin-top:2.5rem;position:relative}\n#rt-hoius .rt-layout.is-collapsed{grid-template-columns:minmax(0,1fr)}\n#rt-hoius .rt-layout.is-collapsed .rt-filters-cell{display:none}\n#rt-hoius .rt-layout.is-collapsed .rt-results{grid-column:1}\n#rt-hoius .rt-panel-open{display:none}\n#rt-hoius .rt-layout.is-collapsed .rt-panel-open{display:inline-flex}\n\n/* filters */\n#rt-hoius .rt-filters-cell{min-width:0}\n/* JS-driven fallback for pages where an ancestor\'s non-visible overflow\n   (common on Webflow: sections wrapped in overflow:hidden for reveal/clip\n   effects) permanently blocks native position:sticky - see\n   initStickySidebar() in comparator.js. .rt-js-sticky is added only when\n   that\'s actually detected; ordinary pages never pay for this. The cell\n   needs position:relative as the containing block for the "settled"\n   (position:absolute, anchored past the end of the results column) state. */\n#rt-hoius .rt-js-sticky .rt-filters-cell{position:relative}\n/* backface-visibility:hidden promotes the sidebar to its own GPU compositor\n   layer, same WebKit/Safari fast-scroll-lag fix as transform:translateZ(0)\n   - but unlike transform (or will-change:transform), it does NOT redefine\n   the containing block for position:fixed descendants. .rt-tip__bubble\n   inside this sidebar relies on position:fixed being relative to the real\n   viewport to escape .rt-filters\' own overflow:hidden/auto clipping -\n   translateZ(0) was tried here first and broke exactly that, clipping every\n   tooltip bubble to the sidebar\'s own bounds instead of the viewport. */\n#rt-hoius .rt-filters{position:sticky;top:var(--rt-sticky-top, 1.5rem);align-self:start;background:var(--white);border:1.5px solid var(--line);border-radius:1.25rem;max-height:calc(100vh - var(--rt-sticky-top, 1.5rem) - 1.5rem);display:flex;flex-direction:column;min-width:0;overflow:hidden;-webkit-backface-visibility:hidden;backface-visibility:hidden}\n/* Toggled on only while actively scrolling (see bumpGpuLayer() in\n   initStickySidebar()) - transform is a stronger fast-scroll-lag fix than\n   backface-visibility alone, but it also makes this element the containing\n   block for position:fixed descendants, which would clip .rt-tip__bubble\n   right back to the sidebar. Scoping it to "currently scrolling" gets the\n   stronger fix exactly when it\'s needed without breaking tooltips at rest. */\n#rt-hoius .rt-filters--gpu{transform:translateZ(0);will-change:transform}\n#rt-hoius .rt-results{grid-column:2}\n#rt-hoius .rt-filters__head{display:flex;align-items:center;gap:.5rem;padding:1.125rem 1.25rem;border-bottom:1px solid var(--line-2)}\n#rt-hoius .rt-filters__head h2{font-family:var(--f-body);font-size:1rem;font-weight:600;letter-spacing:-.01em}\n#rt-hoius .rt-filters__head .rt-n{margin-left:auto;font-size:.75rem;color:var(--ink-4);font-weight:500;white-space:nowrap}\n#rt-hoius .rt-filters__scroll{overflow-y:auto;overflow-x:hidden;padding:.5rem 1.25rem .75rem;flex:1;overscroll-behavior:contain}\n#rt-hoius .rt-filters__foot{padding:1rem 1.25rem;border-top:1px solid var(--line-2);display:flex;gap:.5rem;justify-content:space-between;align-items:center;flex-wrap:wrap}\n#rt-hoius .rt-active{padding:.625rem 0;border-bottom:1px solid var(--line-2);font-size:.8125rem;color:var(--ink-4);display:flex;flex-wrap:wrap;gap:.375rem;align-items:center}\n#rt-hoius .rt-active:empty{display:none}\n/* Weight/tracking/colour match the real site\'s own pill "badge" component\n   (queried live via Webflow MCP): font-weight 500 (not 600), letter-spacing\n   -0.02em, neutral text colour #4f5969 = our --ink-3 (not --ink-2). Applies\n   below to .rt-cond and .rt-promo too - both are the same pill shape, just\n   different content. */\n#rt-hoius .rt-chip{display:inline-flex;align-items:center;gap:.25rem;background:var(--bg-3);color:var(--ink-3);border-radius:100vw;padding:.25rem .5rem .25rem .625rem;font-size:.75rem;font-weight:500;letter-spacing:-.02em;max-width:100%}\n#rt-hoius .rt-chip button{color:var(--ink-4);padding:0 .125rem;font-size:1rem;line-height:1;flex:none}\n#rt-hoius .rt-chip button:hover{color:var(--brand-600)}\n#rt-hoius .rt-group{border-bottom:1px solid var(--line-2);padding:.625rem 0 1rem}\n#rt-hoius .rt-group:last-child{border-bottom:0}\n#rt-hoius .rt-group__head{position:relative;width:100%;display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.625rem 0;font-weight:600;font-size:.8125rem;color:var(--ink);letter-spacing:-.01em;text-align:left}\n#rt-hoius .rt-group__head span{min-width:0;flex:1 1 auto}\n#rt-hoius .rt-group__head svg{transition:transform .2s ease;flex:0 0 auto;margin-left:auto;color:var(--ink-4)}\n#rt-hoius .rt-group[data-open="false"] .rt-group__head svg{transform:rotate(-90deg)}\n#rt-hoius .rt-group[data-open="false"] .rt-group__body{display:none}\n#rt-hoius .rt-check{display:flex;align-items:flex-start;gap:.625rem;padding:.5rem 0;font-size:.8125rem;cursor:pointer;color:var(--ink-2);line-height:1.4}\n#rt-hoius .rt-check input{position:absolute;opacity:0;width:0;height:0}\n#rt-hoius .rt-check__box{width:1.125rem;height:1.125rem;margin-top:.0625rem;border:1px solid var(--line-strong);border-radius:6px;flex:none;display:grid;place-items:center;background:var(--white);transition:background-color .15s ease,border-color .15s ease}\n#rt-hoius .rt-check__box svg{opacity:0;stroke:#fff;width:12px;height:12px}\n#rt-hoius .rt-check input:checked+.rt-check__box{background:var(--brand);border-color:var(--brand)}\n#rt-hoius .rt-check input:checked+.rt-check__box svg{opacity:1}\n#rt-hoius .rt-check input:focus-visible+.rt-check__box{outline:2px solid var(--brand);outline-offset:2px}\n#rt-hoius .rt-check__text{flex:1;min-width:0}\n#rt-hoius .rt-static{display:flex;align-items:center;gap:.375rem;font-size:.8125rem;font-weight:500;padding:.875rem 0 .625rem;color:var(--ink-3)}\n#rt-hoius .rt-num{margin:.25rem 0 1rem;max-width:8rem}\n#rt-hoius .rt-num input{min-height:2.25rem;font-size:.875rem;padding-right:1.75rem}\n#rt-hoius .rt-num .rt-input__unit{right:.75rem}\n\n/* tooltip */\n#rt-hoius .rt-tip{position:relative;display:inline-flex;flex:none;margin-left:auto}\n#rt-hoius .rt-row__label .rt-tip,#rt-hoius .rt-static .rt-tip,#rt-hoius .rt-check__text .rt-tip{margin-left:.25rem}\n#rt-hoius .rt-tip__btn{width:1rem;height:1rem;border-radius:100vw;border:0;background:none;padding:0;color:#96a0b0;display:grid;place-items:center;flex:none}\n#rt-hoius .rt-tip__btn svg{width:100%;height:100%}\n#rt-hoius .rt-tip__btn:hover{color:var(--ink)}\n/* position:fixed (not absolute) and positioned via JS (positionTipBubble in\n   comparator.js), not CSS left/top - an absolute bubble is clipped by any\n   ancestor with non-visible overflow, e.g. the filters sidebar\'s own\n   scroll container, so a tip near the edge of that list would render\n   cropped. Fixed positioning escapes that the same way the sticky sidebar\n   does. Stays nested inside .rt-tip and scoped under #rt-hoius - moving it\n   to <body> was tried and reverted, because #rt-hoius declares every one\n   of the widget\'s colour/shadow tokens (--ink, --line-strong, --sh-2, ...)\n   as custom properties on itself; those only inherit down the DOM tree, so\n   a bubble living outside #rt-hoius lost all of them (no background, no\n   text colour, no shadow). CSS still owns show/hide (opacity/pointer-events)\n   so hover alone keeps working without JS having to run on every mouse\n   move. Width/radius/padding/arrow are copied from the real site\'s own\n   tooltip component (read directly from its exported CSS,\n   devlink-test/webflow/css/classes.css: .help-text_wrapper + .triangle-tip):\n   bubble sits beside the trigger, vertically centred on it, width 22rem,\n   radius 0.75rem, padding 0.75rem; the arrow is a 1rem x 1.4rem wedge\n   (clip-path polygon(100% 0%, 0% 50%, 100% 100%)) at the bubble\'s edge,\n   same background colour, shifted outward with translate(-70%, -50%) so it\n   points back at the trigger. In the filters sidebar the bubble instead\n   opens above/below and is clamped (by JS) to the sidebar\'s own width, so\n   it never overlaps the result cards next to it - see positionTipBubble.\n   The real bubble only fades (opacity), it never slides - ours matches\n   that, no transform. */\n#rt-hoius .rt-tip__bubble{position:fixed;width:22rem;max-width:88vw;background:var(--ink);color:var(--line-strong);font-size:.8125rem;line-height:1.5;padding:.75rem;border-radius:.75rem;opacity:0;pointer-events:none;transition:opacity .3s ease;z-index:9999;font-weight:600;text-align:left;letter-spacing:0;box-shadow:var(--sh-2);overflow-wrap:break-word}\n/* Side mode (result cards): arrow is the real site\'s own 1rem x 1.4rem\n   wedge on the bubble\'s edge, pointing back at the trigger. */\n#rt-hoius .rt-tip__bubble--side .rt-tip__arrow{position:absolute;left:0;width:1rem;height:1.4rem;background:var(--ink);transform:translate(-70%,-50%);clip-path:polygon(100% 0%,0% 50%,100% 100%)}\n#rt-hoius .rt-tip__bubble--side.rt-tip__bubble--flip-left .rt-tip__arrow{left:auto;right:0;transform:translate(70%,-50%);clip-path:polygon(0% 0%,100% 50%,0% 100%)}\n/* Top mode (filters sidebar): arrow flips to a same-colour wedge on the\n   bubble\'s top/bottom edge instead, since a side-opening bubble there\n   would run out over the result cards. */\n#rt-hoius .rt-tip__bubble--top .rt-tip__arrow{position:absolute;top:100%;width:1rem;height:.7rem;background:var(--ink);transform:translate(-50%,-30%);clip-path:polygon(0% 0%,100% 0%,50% 100%)}\n#rt-hoius .rt-tip__bubble--top.rt-tip__bubble--below .rt-tip__arrow{top:auto;bottom:100%;transform:translate(-50%,30%);clip-path:polygon(50% 0%,0% 100%,100% 100%)}\n/* Hover-capable devices (real mice/trackpads) show the bubble on :hover\n   ONLY, matching the real site exactly (it has zero IX3 interactions -\n   verified live via Webflow MCP - so its tooltip is pure CSS :hover, full\n   stop). :focus-within alone used to keep it open after a click, because\n   clicking a <button> moves browser focus to it regardless of what our own\n   click handler does - a separate mechanism from the is-open class, and the\n   actual cause of "stays open after clicking." .is-open and :focus-within\n   are scoped to (hover:none) below instead, so touch devices (which have no\n   hover at all) keep a way to reach the tooltip content. */\n#rt-hoius .rt-tip:hover .rt-tip__bubble{opacity:1;pointer-events:auto}\n@media (hover:none){\n  #rt-hoius .rt-tip.is-open .rt-tip__bubble,#rt-hoius .rt-tip:focus-within .rt-tip__bubble{opacity:1;pointer-events:auto}\n}\n\n/* toolbar */\n#rt-hoius .rt-toolbar{display:flex;align-items:center;gap:.75rem;margin-bottom:1.5rem;flex-wrap:wrap;min-height:2.75rem}\n#rt-hoius .rt-results-count{font-weight:600;color:var(--ink)}\n#rt-hoius .rt-filters-open{display:none}\n/* Custom dropdown (not a native <select> - an open native select\'s option\n   list is OS-rendered and cannot be restyled by CSS in any browser, so it\n   can never visually match a real Webflow dropdown component). */\n#rt-hoius .rt-select{position:relative;margin-left:auto}\n/* min-width must fit the LONGEST option label ("Suurim tulu (simulatsioon)"),\n   not just whichever one happens to be selected - the option list\'s own\n   width follows the toggle\'s (see .rt-select__list below), so a toggle\n   sized to a short label like "Kõrgeim intress" made the longer label wrap\n   inside the list once opened. */\n#rt-hoius .rt-select__toggle{display:flex;align-items:center;justify-content:space-between;gap:.75rem;min-height:2.75rem;min-width:15.5rem;border:1px solid var(--line-strong);border-radius:var(--r-md);padding:.25rem .75rem;font-size:1rem;font-weight:400;color:var(--ink);background:var(--white);cursor:pointer}\n#rt-hoius .rt-select__toggle span{white-space:nowrap}\n#rt-hoius .rt-select__toggle svg{flex:none;color:var(--ink-4);transition:transform .2s ease}\n#rt-hoius .rt-select.is-open .rt-select__toggle svg{transform:rotate(180deg)}\n/* Colors/weights below are pulled from the live palgakalkulaator dropdown\'s\n   actual computed styles (default/active/:hover), not guessed - see\n   web/README.md. Notably: the active/selected option is NOT bold (still\n   font-weight:400, only its color changes), the panel has no box-shadow,\n   and hover changes BOTH the background and the text color together. */\n#rt-hoius .rt-select__list{display:none;position:absolute;top:calc(100% + .25rem);right:0;left:0;background:var(--white);border:1px solid #e9ecf1;border-radius:var(--r-md);padding:.25rem;z-index:30}\n#rt-hoius .rt-select.is-open .rt-select__list{display:block}\n#rt-hoius .rt-select__option{padding:.625rem .875rem;border-radius:var(--r-sm);font-size:1rem;font-weight:400;color:#222;cursor:pointer;white-space:nowrap}\n#rt-hoius .rt-select__option.is-active{color:var(--brand)}\n#rt-hoius .rt-select__option:hover{background:#f9fafb;color:var(--brand)}\n#rt-hoius .rt-select__option.is-disabled{color:var(--ink-4);cursor:not-allowed}\n#rt-hoius .rt-select__option.is-disabled:hover{background:none;color:var(--ink-4)}\n\n/* profile */\n#rt-hoius .rt-profile{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;background:var(--brand-tint);border:1px solid var(--brand-soft);border-radius:var(--r-md);padding:.75rem .875rem;margin-bottom:1rem;font-size:.8125rem;color:var(--ink-3)}\n#rt-hoius .rt-profile b{font-weight:600;color:var(--ink)}\n\n/* cards - three top-aligned zones: identity+CTA, hero result, compact facts.\n   This replaces a single vertically-centered 3-column grid whose "interest"\n   metric was much taller than its siblings, which is what made the top card\n   look lopsided next to the shorter ones below it. Every card now has the\n   same hero+facts skeleton regardless of rank, so heights stay consistent. */\n/* Radius matches the real site\'s "regulador_component" list-card (the\n   closest live analog: a bordered card in a comparison list) - queried live\n   via Webflow MCP: 1.25rem radius, no box-shadow. Border weight/color match\n   the filters sidebar (.rt-filters) instead of the 4px reference border -\n   4px read as too heavy for a whole column of stacked result cards.\n   .rt-card--top keeps its own brand-colored border (this card being the top\n   pick is a real, deliberate accent). */\n#rt-hoius .rt-card{position:relative;background:var(--white);border:1.5px solid var(--line);border-radius:1.25rem;margin-bottom:1rem}\n#rt-hoius .rt-card--top{border-color:var(--brand)}\n#rt-hoius .rt-card__ribbon{position:absolute;top:-.7rem;left:1.5rem;background:var(--brand);color:#fff;font-size:.6875rem;font-weight:600;padding:.1875rem .625rem;border-radius:100vw;letter-spacing:.02em;box-shadow:var(--sh-1)}\n\n#rt-hoius .rt-card__top{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;padding:1.5rem 1.5rem 0}\n#rt-hoius .rt-id{display:flex;gap:.75rem;align-items:center;min-width:0}\n#rt-hoius .rt-rank{font-family:var(--f-head);font-size:1.125rem;color:var(--ink-4);width:1.25rem;flex:none;text-align:center}\n#rt-hoius .rt-logo{position:relative;overflow:hidden;width:4rem;height:3.5rem;border-radius:var(--r-md);display:grid;place-items:center;font-family:var(--f-head);font-size:1rem;color:#fff;flex:none;letter-spacing:0}\n#rt-hoius .rt-logo--sm{width:1.75rem;height:1.5rem;font-size:.625rem;border-radius:6px}\n/* A real logo/favicon gets a plain white backing, not the brand colour -\n   the colour chip is only for the initials fallback (see logoHtml() in\n   comparator.js, which also restores it via onerror if the image fails). */\n#rt-hoius .rt-logo--img{background:#fff}\n/* The favicon <img> sits on top of the initials and covers them completely\n   once loaded (see logoHtml()\'s onerror handling for the failure case).\n   object-fit:contain (not cover) so a non-square logo is never cropped -\n   it shows whole, centred on the white backing, like a card. */\n#rt-hoius .rt-logo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:15%;box-sizing:border-box}\n/* Bare logos (see logoHtml()\'s `bare: true`) skip the chip\'s own white\n   backing and padding entirely - the source image is already a complete,\n   self-contained icon (own background, own margin), so no frame-around-a-\n   frame. Shown exactly as-is, still contained to the same chip footprint. */\n#rt-hoius .rt-logo--bare img{padding:0}\n/* Matches the chip\'s width to its height - for a square source logo shown\n   bare/unmodified, our normally wider chip would otherwise leave empty\n   transparent strips on either side (showing whatever\'s behind it, e.g.\n   the sponsored card\'s own tinted background) instead of the mark filling\n   the chip corner to corner. */\n#rt-hoius .rt-logo--square{width:3.5rem}\n#rt-hoius .rt-logo--sm.rt-logo--square{width:1.5rem}\n/* Wordmark logo (e.g. the sponsored banner\'s "Lightyear" text mark) -\n   much wider than the standard icon chip so it isn\'t squeezed down to an\n   illegible sliver by object-fit:contain. */\n#rt-hoius .rt-logo--wide{width:8rem}\n#rt-hoius .rt-card__name{font-family:var(--f-body);font-weight:600;font-size:1.0625rem;line-height:1.3;letter-spacing:-.01em}\n#rt-hoius .rt-type{font-size:.8125rem;color:var(--ink-4);margin-top:.125rem}\n\n#rt-hoius .rt-top-actions{display:flex;flex-direction:column;align-items:flex-end;gap:.5rem;flex:none}\n#rt-hoius .rt-top-actions .rt-btn{white-space:nowrap}\n#rt-hoius .rt-compare{display:flex;align-items:center;gap:.375rem;font-size:.75rem;color:var(--ink-3);cursor:pointer;white-space:nowrap}\n#rt-hoius .rt-compare input{position:absolute;opacity:0;width:0;height:0}\n#rt-hoius .rt-compare .rt-check__box{width:1rem;height:1rem;border:1px solid var(--line-strong);border-radius:5px;flex:none;display:grid;place-items:center;background:var(--white);transition:background-color .15s ease,border-color .15s ease}\n#rt-hoius .rt-compare .rt-check__box svg{opacity:0;stroke:#fff;width:10px;height:10px}\n#rt-hoius .rt-compare input:checked+.rt-check__box{background:var(--brand);border-color:var(--brand)}\n#rt-hoius .rt-compare input:checked+.rt-check__box svg{opacity:1}\n#rt-hoius .rt-compare input:focus-visible+.rt-check__box{outline:2px solid var(--brand);outline-offset:2px}\n\n#rt-hoius .rt-card__hero{margin:1rem 1.5rem 0;background:var(--brand-tint);border:1px solid var(--brand-soft);border-radius:var(--r-md);padding:1rem 1.125rem;display:flex;flex-wrap:wrap;gap:.75rem 1.5rem;align-items:center;justify-content:space-between}\n#rt-hoius .rt-hero-rate{display:flex;flex-direction:column;gap:.125rem;min-width:0}\n#rt-hoius .rt-hero-num{font-family:var(--f-head);font-size:2rem;font-weight:400;letter-spacing:-.006em;color:var(--brand-600);line-height:1.1}\n#rt-hoius .rt-hero-sub{font-size:.75rem;color:var(--ink-3)}\n/* Groups the promo badge with the net-earnings figure on the right side of\n   the hero box, so it reads as part of "what you get," not a separate ad.\n   Not a link (info only - the badge\'s own tooltip explains the offer, the\n   card\'s one outbound click stays the "Loe lähemalt" button). White fill\n   with a brand-colored border/text, like .rt-btn--ghost - the hero box\'s\n   own background is already a light brand-tint, so a solid brand-colored\n   fill read as too heavy/loud there; white lifts the badge off that tint\n   while the brand-colored border and text keep it clearly on-brand. */\n#rt-hoius .rt-hero-side{display:flex;flex-direction:column;align-items:flex-end;gap:.375rem}\n#rt-hoius .rt-promo{display:inline-flex;align-items:center;gap:.375rem;background:var(--white);color:var(--brand-600);border:1px solid var(--brand-soft);border-radius:100vw;padding:.3125rem .75rem;font-size:.75rem;font-weight:500;letter-spacing:-.02em;line-height:1.3}\n/* Inside the (now white-backed) sponsored banner, the white-fill treatment\n   above has nothing to lift off of - it just reads as a faint outline.\n   Filled with the brand tint instead so it actually stands out as a badge.\n   Padding left untouched from the shared .rt-promo rule on purpose. */\n#rt-hoius .rt-winner .rt-promo{background:var(--brand-tint);border-color:var(--brand-soft)}\n#rt-hoius .rt-hero-net{display:flex;flex-direction:column;align-items:flex-end;gap:.125rem;text-align:right}\n#rt-hoius .rt-hero-net span{font-size:.75rem;color:var(--ink-3)}\n#rt-hoius .rt-hero-net b{font-family:var(--f-head);font-size:1.25rem;font-weight:400;letter-spacing:-.006em;color:var(--ink)}\n#rt-hoius .rt-sim{font-size:.8125rem;color:var(--ink-3);line-height:1.45}\n#rt-hoius .rt-sim--warn{color:var(--amber-fg);width:100%}\n\n#rt-hoius .rt-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:min-content;column-gap:.5rem;row-gap:.375rem;margin:1rem 1.5rem 1.5rem;min-width:0}\n#rt-hoius .rt-metric{background:var(--bg-3);border-radius:var(--r-md);padding:.625rem .75rem;min-width:0;overflow-wrap:break-word}\n#rt-hoius .rt-metric dt{font-size:.6875rem;color:var(--ink-4);line-height:1.35;text-transform:uppercase;letter-spacing:.03em;font-weight:500}\n#rt-hoius .rt-metric dd{margin:.25rem 0 0;font-weight:600;font-size:.9375rem;line-height:1.3;color:var(--ink)}\n#rt-hoius .rt-metric dd small{display:block;font-size:.6875rem;font-weight:400;color:var(--ink-4);margin-top:.25rem;line-height:1.35;text-transform:none;letter-spacing:0}\n\n/* rate presets (filter sidebar quick buttons) */\n#rt-hoius .rt-presets{display:flex;flex-wrap:wrap;gap:.375rem;margin:.25rem 0 .75rem}\n#rt-hoius .rt-preset{border:1.5px solid var(--line-strong);border-radius:100vw;padding:.3125rem .75rem;font-size:.75rem;font-weight:500;letter-spacing:-.02em;color:var(--ink-2);background:var(--white)}\n#rt-hoius .rt-preset:hover{border-color:var(--ink)}\n#rt-hoius .rt-preset.is-on{background:var(--brand);border-color:var(--brand);color:#fff}\n\n/* compare: sticky tray + side-by-side table */\n#rt-hoius .rt-compare-tray{position:fixed;left:0;right:0;bottom:0;z-index:30;background:var(--white);border-top:1.5px solid var(--line);box-shadow:0 -6px 24px rgba(8,28,21,.08)}\n#rt-hoius .rt-compare-tray__inner{max-width:1220px;margin:0 auto;padding:.75rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}\n#rt-hoius .rt-compare-tray__chips{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}\n#rt-hoius .rt-compare-tray__hint{font-size:.75rem;color:var(--ink-4)}\n#rt-hoius .rt-compare-tray__actions{display:flex;align-items:center;gap:1rem}\n#rt-hoius .rt-compare-chip{display:inline-flex;align-items:center;gap:.4375rem;background:var(--bg-3);border-radius:100vw;padding:.25rem .5rem .25rem .375rem;font-size:.8125rem;font-weight:500;color:var(--ink-2)}\n#rt-hoius .rt-compare-chip button{display:grid;place-items:center;width:1.125rem;height:1.125rem;color:var(--ink-4);flex:none}\n#rt-hoius .rt-compare-chip button svg{width:9px;height:9px}\n#rt-hoius .rt-compare-chip button:hover{color:var(--red)}\n#rt-hoius .rt-compare-panel{margin-top:1.5rem;background:var(--white);border:4px solid var(--bg-4);border-radius:1.25rem;overflow:hidden}\n#rt-hoius .rt-compare-panel[hidden]{display:none}\n#rt-hoius .rt-compare-panel__head{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid var(--line-2)}\n#rt-hoius .rt-compare-panel__head h2{font-size:1.25rem}\n#rt-hoius .rt-compare-scroll{overflow-x:auto}\n#rt-hoius .rt-compare-table{font-size:.875rem;min-width:32rem}\n#rt-hoius .rt-compare-table th,#rt-hoius .rt-compare-table td{padding:.75rem 1.5rem;text-align:left;border-bottom:1px solid var(--line-2);vertical-align:middle}\n#rt-hoius .rt-compare-table tbody th{color:var(--ink-3);font-weight:500;white-space:nowrap}\n#rt-hoius .rt-compare-table thead th{background:var(--bg-2);white-space:nowrap;font-weight:600}\n#rt-hoius .rt-compare-table thead th .rt-logo--sm{margin-right:.5rem;vertical-align:middle}\n#rt-hoius .rt-compare-table td{font-weight:600;color:var(--ink)}\n#rt-hoius .rt-compare-table tr:last-child th,#rt-hoius .rt-compare-table tr:last-child td{border-bottom:0}\n\n/* toggle + details */\n#rt-hoius .rt-toggle{position:relative;width:100%;border-top:1px solid var(--line-2);padding:.875rem 1.5rem;display:flex;justify-content:space-between;align-items:center;gap:.5rem;font-weight:600;font-size:.875rem;color:var(--ink-2);border-radius:0 0 1.25rem 1.25rem;transition:color .18s ease,background-color .18s ease}\n/* When expanded, .rt-details (not the toggle) owns the card\'s bottom\n   corners - the toggle sits in the middle of the card at that point, so\n   its own bottom radius was showing as a stray rounded notch cut into the\n   details panel whenever it was hovered while open. */\n#rt-hoius .rt-toggle[aria-expanded="true"]{border-radius:0}\n#rt-hoius .rt-toggle span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n#rt-hoius .rt-toggle svg{flex:none;color:var(--ink-4);transition:transform .2s ease}\n#rt-hoius .rt-toggle:hover{color:var(--brand);background:var(--bg-2)}\n#rt-hoius .rt-toggle[aria-expanded="true"] svg{transform:rotate(180deg)}\n#rt-hoius .rt-details{border-top:1px solid var(--line-2);padding:0 1.5rem;background:var(--bg-2);border-radius:0 0 1.25rem 1.25rem}\n#rt-hoius .rt-dgroup{font-size:.6875rem;color:var(--ink-4);font-weight:600;padding:1.125rem 0 .375rem;text-transform:uppercase;letter-spacing:.05em}\n#rt-hoius .rt-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:1rem;padding:.6875rem 0;border-bottom:1px solid var(--line-2);font-size:.875rem;align-items:center}\n#rt-hoius .rt-row:last-child{border-bottom:0}\n#rt-hoius .rt-row__label{color:var(--ink-3);display:flex;align-items:center;gap:.375rem;min-width:0}\n#rt-hoius .rt-row__value{font-weight:600;display:flex;align-items:center;justify-content:flex-end;gap:.5rem;flex-wrap:wrap;text-align:right;color:var(--ink);min-width:0}\n#rt-hoius .rt-yes,#rt-hoius .rt-no{display:inline-grid;place-items:center;width:1.25rem;height:1.25rem;border-radius:100vw;flex:none}\n#rt-hoius .rt-yes{background:var(--green-bg);color:var(--green)}\n#rt-hoius .rt-no{background:var(--red-bg);color:var(--red)}\n#rt-hoius .rt-soft{color:var(--ink-4);font-weight:400;margin-left:.375rem}\n#rt-hoius .rt-flag b{background:var(--brand-tint);color:var(--brand-600);padding:.1875rem .5rem;border-radius:100vw;font-size:.75rem;font-weight:600}\n#rt-hoius .rt-tierwrap{padding:.375rem 0 .625rem}\n#rt-hoius .rt-tiertable{font-size:.875rem;background:var(--white);border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;table-layout:fixed}\n#rt-hoius .rt-tiertable th,#rt-hoius .rt-tiertable td{padding:.75rem 1.25rem}\n#rt-hoius .rt-tiertable th:first-child,#rt-hoius .rt-tiertable td:first-child{width:50%}\n#rt-hoius .rt-tiertable th:last-child,#rt-hoius .rt-tiertable td:last-child{width:50%;text-align:right}\n#rt-hoius .rt-tiertable th{text-align:left;font-weight:600;color:var(--ink-4);font-size:.6875rem;text-transform:uppercase;letter-spacing:.03em;background:var(--bg-3)}\n#rt-hoius .rt-tiertable td{border-top:1px solid var(--line-2);color:var(--ink)}\n#rt-hoius .rt-tiertable td:last-child{font-weight:600}\n#rt-hoius .rt-noteswrap{padding:.375rem 0 .75rem}\n#rt-hoius .rt-notestext{font-size:.875rem;color:var(--ink-3);line-height:1.6}\n#rt-hoius .rt-details__foot{display:flex;justify-content:center;padding:1rem 0}\n#rt-hoius .rt-details__sticky{display:none}\n\n/* Reserves roughly the widget\'s real height while #rt-hoius is still\n   literally empty (before init() has written anything into it - a brief\n   window covering the data fetch), so native Webflow content below it (a\n   Sõnastik section, footer, etc.) doesn\'t jump up into the empty space and\n   then get shoved back down once the widget finishes rendering. No visible\n   loading text/spinner - that read as worse than just holding the space\n   silently, since it only ever flashes for a moment. Stops applying the\n   instant real content lands, since #rt-hoius is then no longer :empty.\n   These are rough estimates (a filtered/short result list can still be\n   shorter than this), not a pixel-exact match. */\n#rt-hoius:empty{min-height:1500px}\n@media (max-width:900px){#rt-hoius:empty{min-height:1800px}}\n\n/* more / empty / source */\n#rt-hoius .rt-more{display:flex;justify-content:center;margin-top:.75rem}\n#rt-hoius .rt-empty{background:var(--white);border:1.5px dashed var(--line-strong);border-radius:var(--r-lg);padding:2.5rem 1.25rem;text-align:center;color:var(--ink-3);line-height:1.55}\n#rt-hoius .rt-empty .rt-btn{margin-top:1rem}\n#rt-hoius .rt-fonte{margin-top:1.5rem;font-size:.75rem;color:var(--ink-4);line-height:1.6}\n\n/* conditions + alerts */\n#rt-hoius .rt-conds{display:flex;flex-wrap:wrap;gap:.375rem;margin-top:.5rem}\n#rt-hoius .rt-cond{display:inline-flex;align-items:center;gap:.25rem;border-radius:100vw;padding:.1875rem .5rem;font-size:.6875rem;font-weight:500;letter-spacing:-.02em;background:var(--bg-3);color:var(--ink-3)}\n#rt-hoius .rt-cond--req{background:var(--amber-bg);color:var(--amber-fg);box-shadow:inset 0 0 0 1px var(--amber-line)}\n#rt-hoius .rt-cond--free{background:var(--green-bg);color:var(--green)}\n#rt-hoius .rt-cond--warn{background:var(--amber-bg);color:var(--amber-fg)}\n/* Same amber treatment as --req/--warn (not the brand-tint used before) -\n   the winner card now has a flat brand-tint background of its own, which\n   made a brand-tint badge on top of it nearly invisible. Amber also reads\n   correctly as "a condition to be aware of," which fits a locked term\n   better than the brand color. */\n#rt-hoius .rt-cond--info{background:var(--amber-bg);color:var(--amber-fg);box-shadow:inset 0 0 0 1px var(--amber-line)}\n#rt-hoius .rt-alert{display:flex;gap:.5rem;align-items:flex-start;background:var(--amber-bg);color:var(--amber-fg);border:1px solid var(--amber-line);border-radius:var(--r-md);padding:.625rem .75rem;font-size:.75rem;line-height:1.5;margin:.625rem 1.5rem 0}\n#rt-hoius .rt-winner .rt-alert{margin-left:0;margin-right:0}\n#rt-hoius .rt-alert svg{flex:none;margin-top:.0625rem}\n#rt-hoius .rt-card.is-out{opacity:.6}\n#rt-hoius .rt-card.is-out .rt-btn--brand{background:var(--bg-3);color:var(--ink-4);border-color:var(--bg-3)}\n\n/* responsive */\n#rt-hoius .rt-x{display:none}\n#rt-hoius #rtDrawerApply{display:none}\n@media (max-width:1080px){\n  #rt-hoius .rt-facts{grid-template-columns:repeat(2,minmax(0,1fr))}\n}\n@media (max-width:640px){\n  #rt-hoius .rt-card__top{flex-direction:column;align-items:stretch}\n  #rt-hoius .rt-top-actions{flex-direction:row-reverse;justify-content:space-between;align-items:center;width:100%}\n  #rt-hoius .rt-top-actions .rt-btn{flex:1}\n  #rt-hoius .rt-card__hero{flex-direction:column;align-items:stretch}\n  #rt-hoius .rt-hero-net{align-items:flex-start;text-align:left}\n  #rt-hoius .rt-compare-tray__inner{flex-direction:column;align-items:stretch}\n  #rt-hoius .rt-compare-tray__actions{justify-content:space-between}\n}\n@media (max-width:900px){\n  #rt-hoius .rt-layout{grid-template-columns:minmax(0,1fr);margin-top:1.75rem}\n  #rt-hoius .rt-results{grid-column:1}\n  #rt-hoius .rt-filters{position:fixed;inset:0;height:100dvh;z-index:9999;border-radius:0;max-height:none;transform:translateY(100%);transition:transform .25s ease;visibility:hidden;border:0}\n  body.rt-drawer-open #rt-hoius .rt-filters{transform:none;visibility:visible}\n  body.rt-drawer-open{overflow:hidden}\n  #rt-hoius .rt-filters-open{display:inline-flex}\n  #rt-hoius .rt-collapse,#rt-hoius .rt-panel-open{display:none!important}\n  #rt-hoius #rtDrawerApply{display:inline-flex}\n  #rt-hoius .rt-x{display:grid;place-items:center;width:2.25rem;height:2.25rem;border-radius:var(--r-md);border:1.5px solid var(--line-strong);background:var(--white);flex:none;color:var(--ink-2)}\n  #rt-hoius .rt-calc__grid{grid-template-columns:1fr 1fr}\n  #rt-hoius .rt-calc__actions{grid-column:1/-1}\n  #rt-hoius .rt-calc__actions .rt-btn{flex:1}\n}\n@media (max-width:600px){\n  #rt-hoius .rt-calc{padding:1.25rem}\n  #rt-hoius .rt-calc__grid{grid-template-columns:1fr}\n  #rt-hoius .rt-card__top,#rt-hoius .rt-card__hero,#rt-hoius .rt-facts,#rt-hoius .rt-card>.rt-alert{margin-left:1.25rem;margin-right:1.25rem}\n  #rt-hoius .rt-card__top{padding-top:1.25rem;padding-left:0;padding-right:0}\n  #rt-hoius .rt-facts{grid-template-columns:repeat(2,minmax(0,1fr))}\n  #rt-hoius .rt-row{grid-template-columns:1fr;gap:.1875rem}\n  #rt-hoius .rt-details{padding:0 1.25rem}\n  #rt-hoius .rt-details__sticky{display:flex;position:sticky;bottom:0;background:var(--bg-2);padding:.75rem 0;border-top:1px solid var(--line-2);margin-top:.25rem;gap:.625rem;align-items:center;z-index:2}\n  #rt-hoius .rt-details__sticky .rt-btn{flex:1}\n  #rt-hoius .rt-details__sticky span{font-size:.8125rem;color:var(--ink-3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n  #rt-hoius .rt-winner{padding:1.125rem}\n  #rt-hoius .rt-winner__divider{margin:0 .75rem}\n  #rt-hoius .rt-winner__logo-col{gap:.25rem}\n  #rt-hoius .rt-winner__col2{gap:.25rem}\n  #rt-hoius .rt-winner__cta{margin-left:0;margin-top:.875rem;width:100%;flex-direction:column;align-items:stretch;gap:.5rem}\n  /* max-width matches the 20px screen-edge margin positionTipBubble() now\n     uses on phones (see comparator.js) - CSS-only floor for the plain\n     "side" mode path, where JS clears its own inline max-width and lets\n     this apply. Longer explanations wrap onto more lines and the box grows\n     taller instead of running wider than this. */\n  #rt-hoius .rt-tip__bubble{max-width:calc(100vw - 40px)}\n  #rt-hoius .rt-winner .rt-btn{width:100%}\n  #rt-hoius .rt-select{margin-left:0;width:100%}\n}\n@media (prefers-reduced-motion:reduce){#rt-hoius *{transition:none!important}}';
})();
