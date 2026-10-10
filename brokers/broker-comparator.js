/* Maaklerite võrdlus - e-rahatarkus.ee
   Estonian fork of the EU Personal Finance broker comparator (franklinsilvapt-arch/corretoras-comparator, eu/).

   Where things live:
   - Fees and facts shown in the table: data/brokers.json (edit there, no code change needed).
   - Cost formulas for the first section ("Kui palju sa maksad"): CALC below.
   - Styles: broker-comparator.css (all rules scoped under #rt-bc).
   - Logos: "logo" (a URL) in the JSON, else the EU comparator's logos.js (data URIs, pinned to a commit), else initials.

   Webflow embed: see webflow-embed.html. The script loads its own CSS from the same folder it was
   loaded from, and the data from @main so data edits go live without touching Webflow. */
(function () {
  'use strict';
  var scriptEl = document.currentScript;
  var BASE = scriptEl && scriptEl.src ? scriptEl.src.replace(/[^/]*$/, '') : 'https://cdn.jsdelivr.net/gh/pedrofintech/e-rahatarkus@main/brokers/';
  var DATA_URL = 'https://cdn.jsdelivr.net/gh/pedrofintech/e-rahatarkus@main/brokers/data/brokers.json';
  var SITE = 'https://www.e-rahatarkus.ee';
  var LOC = 'et-EE';
  var EMTA = 'https://www.emta.ee/eraklient/maksud-ja-tasumine/maksustatavad-tulud/vaartpaberid-ja-investeerimiskonto';
  /* Same logo file as the EU comparator, pinned to a commit so it never changes under us */
  var LOGOS_URL = 'https://cdn.jsdelivr.net/gh/franklinsilvapt-arch/corretoras-comparator@5822cd5796465eb6bc4df78598cf860e83b8dde1/logos.js';

  var T = {
    conf:'Kinnitamata',
    loadFail:'Võrdlust ei õnnestunud laadida. Palun laadi leht uuesti.',
    secCosts:'Kui palju sa maksad', secCostsSub:'Arvutatud ülal sisestatud summadega',
    rEtf:'Euroopa ETF-i ost', nEtf:' ost, odavaim viis',
    rUs:'USA aktsiate ost', nUs:' ost, koos valuutavahetusega',
    rPlan:'Igakuine ETF-i plaan', nPlan:' kuus, kulu aastas',
    rCustody:'Portfelli hoidmine', nCustody:' portfell, kulu aastas',
    secFees:'Tasud lähemalt',
    rEtfFee:'Euroopa ETF-id', rUsFee:'USA aktsiad', rBaltic:'Balti aktsiad', nBaltic:'Nasdaq Tallinn, Riga ja Vilnius',
    rFx:'Valuutavahetus', rCustodyTxt:'Hoiutasu', rInact:'Mitteaktiivsuse tasu', rTransfer:'Väärtpaberite ülekanne välja',
    secInterest:'Intress investeerimata rahalt', rInterest:'Intress eurodelt',
    secSafety:'Turvalisus ja järelevalve',
    rEntity:'Ettevõte', rRegulator:'Järelevalve', rProtInv:'Investorikaitse', rProtCash:'Raha kaitse',
    secTax:'Maksud', rInvKonto:'Investeerimiskonto', nInvKonto:'Tulumaks alles raha väljavõtmisel',
    secProducts:'Tooted ja konto',
    rFractions:'Murdosalised aktsiad ja ETF-id', rPlans:'Automaatsed investeerimisplaanid', rBonds:'Võlakirjad',
    cta:'Ava konto',
    offerBadge:'Liitumisboonus', useCode:'Kasuta koodi', howItWorks:'Kuidas see töötab',
    chooseUpTo:'Vali kuni', toCompare:'pakkujat võrdlemiseks',
    pickerHint:'Kui maksimum on täis, asendab uus valik kõige varasema.',
    change:'Muuda', close:'Sulge',
    setScenario:'Sisesta oma summad', scenarioHint:'Esimese ploki kulud arvutatakse nende summadega ümber.',
    fAmount:'Ühe ostu summa', fAmountNote:'Eeldame, et see on kuu ainus tehing',
    fMonthly:'Igakuine investeering', fMonthlyNote:'Automaatse ETF-i plaani jaoks',
    fPortfolio:'Portfelli väärtus', fPortfolioNote:'Aastase hoiutasu arvutamiseks',
    diffOnly:'Näita ainult erinevusi',
    showFewer:'Näita vähem pakkujaid', showAll1:'Näita kõiki ', showAll2:' pakkujat',
    plusFees:'+ tasud', cheapest:'Odavaim', highestRate:'Kõrgeim intress',
    emptyPick:'Vali ülalt vähemalt üks pakkuja, et võrdlust näha.',
    pricingPlan:'Hinnaplaan', planFixed:'Fixed', planTiered:'Tiered',
    readReview:'Loe ülevaadet',
    sources:'Allikad', sourcesSub:'Hinnakirjad ja ametlikud lehed', feesSuffix:' hinnakiri', checked:'Kontrollitud ',
    sumBuy:'Ost', sumPerMonth:'/kuus', sumPortfolio:'Portfell',
    fullComparison:'Põhjalik võrdlus:', vs:' vs ', readArticle:'Loe artiklit',
    lastUpdated:'Viimati uuendatud '
  };
  function nSelected(n){ return n===1 ? '1 pakkuja valitud' : n+' pakkujat valitud'; }
  var ET_MONTHS = ['jaanuar','veebruar','märts','aprill','mai','juuni','juuli','august','september','oktoober','november','detsember'];
  function monthYear(iso){ var d=new Date(iso); return isNaN(d.getTime()) ? String(iso||'') : ET_MONTHS[d.getMonth()]+' '+d.getFullYear(); }

  var CONF = T.conf;
  var VERIFIED, USD_EUR, ETF_PRICE, US_PRICE_USD, VAT, B, PAIRS, LOGOS = {};
  var FX = '+ valuutavahetus';
  /* IBKR Tiered on Xetra: commission 0.05% (min. €1.25, max. €29) + clearing €0.02 + 0.0008% (max. €4.02) + regulatory €0.01.
     Exchange fee waived for retail orders routed through SmartRouting (IBKR Ireland Xetra IBIS table). */
  function ibXetra(a){ return Math.min(29,Math.max(1.25,a*0.0005))+Math.min(4.02,0.02+a*0.000008)+0.01; }
  /* Pre-selected on load (desktop shows 3, mobile the first 2). Editorial choice: change freely. */
  var TOP = ['lhv','lightyear','swedbank'];

  /* One function per scenario: etf(amount), us(amount), plan(monthly), custody(portfolio).
     Return {v: cost in €, s: short explanation, extra: shown after the number and excludes the cell
     from "Odavaim" (use it when part of the cost is not published), c: true to show "Kinnitamata"}. */
  var CALC = {
    /* LHV hinnakiri: Euroopa ja USA aktsiad internetis 0,14% (min 5 €). Kasvukonto: ost 0,5%, alla 26 tasuta.
       Välisväärtpaberite hoiutasu 0 € kuni 100 000 €, üle selle osalt 0,01% kuus + KM. */
    'lhv': {
      etf: function(a){ var vp=Math.max(5,a*0.0014), kk=a*0.005;
          return kk<vp ? {v:kk, s:'Kasvukontol 0,5% ostult, alla 26-aastastele tasuta'} : {v:vp, s:'Väärtpaberikontol 0,14% (min 5 €)'}; },
      us: function(a){ return {v:Math.max(5,a*0.0014), s:'0,14% (min 5 €). Valuuta vahetatakse panga kursiga', extra:FX}; },
      plan: function(m){ var vp=Math.max(5,m*0.0014), kk=m*0.005;
          return kk<vp ? {v:12*kk, s:'Kasvukonto püsimakse: 0,5% ostult, alla 26-aastastele tasuta'} : {v:12*vp, s:'12 ostu väärtpaberikontol, 0,14% (min 5 €)'}; },
      custody: function(p){ return {v:Math.max(0,p-100000)*0.0001*12*(1+VAT), s:'0 € kuni 100 000 €. Üle selle 0,01% kuus + KM'}; }
    },
    /* Swedbank hinnakiri: välisaktsiad ja ETF-id internetipangas 0,14% (min 3,90 €).
       Hoiutasu 0 € kuni 100 000 €, üle selle osalt 0,008% kuus (max 8 €) + KM. */
    'swedbank': {
      etf: function(a){ return {v:Math.max(3.9,a*0.0014), s:'Internetipangas 0,14% (min 3,90 €)'}; },
      us: function(a){ return {v:Math.max(3.9,a*0.0014), s:'0,14% (min 3,90 €). Valuuta vahetatakse panga kursiga', extra:FX}; },
      plan: function(m){ return {v:12*Math.max(3.9,m*0.0014), s:'ETF-ide püsiostu ei ole: 12 käsitsi ostu (min 3,90 €). Swedbanki fondides on regulaarne märkimine tasuta'}; },
      custody: function(p){ return {v:Math.min(8,Math.max(0,p-100000)*0.00008)*12*(1+VAT), s:'0 € kuni 100 000 €. Üle selle 0,008% kuus (max 8 €) + KM'}; }
    },
    /* SEB hinnakiri: Euroopa aktsiad 0,14% (min 5 €), USA 0,14% (min 5 €, vähemalt 0,015 $ aktsia kohta).
       Mikroinvesteerimine: 13 euro-ETF-i, 0,5% ilma miinimumtasuta, ühekordselt või kord kuus. Hoiutasu eraisikule 0 €. */
    'seb': {
      etf: function(a){ var vp=Math.max(5,a*0.0014), mi=a*0.005;
          return mi<vp ? {v:mi, s:'Mikroinvesteerimises 0,5% ilma miinimumtasuta (13 ETF-i valikust)'} : {v:vp, s:'Internetipangas 0,14% (min 5 €)'}; },
      us: function(a){ var sh=Math.ceil(a/USD_EUR/US_PRICE_USD); return {v:Math.max(5,a*0.0014,0.015*sh*USD_EUR), s:'0,14% (min 5 €). Valuuta vahetatakse panga kursiga', extra:FX}; },
      plan: function(m){ var vp=Math.max(5,m*0.0014), mi=m*0.005;
          return mi<vp ? {v:12*mi, s:'Mikroinvesteerimine kord kuus: 0,5% ilma miinimumtasuta'} : {v:12*vp, s:'12 ostu internetipangas, 0,14% (min 5 €)'}; },
      custody: function(p){ return {v:0, s:'Eraisikule tasuta'}; }
    },
    'bitpanda': {
      etf: function(a){ return {v:1, s:'1 € orderi kohta. Lisanduda võib hinnavahe'}; },
      us: function(a){ return {v:1, s:'1 € orderi kohta. Kaubeldakse eurodes, valuutatasu ei ole avaldatud'}; },
      plan: function(m){ return {v:0, s:'Paljudes ETF-ides praeguse kampaania ajal tasuta (muidu 1 € orderi kohta)'}; },
      custody: function(p){ return {v:0}; }
    },
    'degiro': {
      etf: function(a){ return {v:1, s:'ETF Core Selection Tradegate\'is: 0 € vahendustasu + 1 € käsitlustasu'}; },
      us: function(a){ return {v:2+a*0.0025, s:'1 € + 1 € käsitlustasu + 0,25% AutoFX'}; },
      plan: function(m){ return {v:12, s:'12 orderit ETF Core Selectionis, igaüks 1 €'}; },
      custody: function(p){ return {v:2.5, s:'Üks välisbörs. 0 €, kui hoiad ainult ETF Core Selectioni fonde'}; }
    },
    'etoro': {
      etf: function(a){ return {v:0, s:'ETF-idel vahendustasu ei ole, eurokonto'}; },
      us: function(a){ return {v:1*USD_EUR+a*0.0075, s:'1 $ vahendustasu + 0,75% EUR/USD vahetus'}; },
      plan: function(m){ return {v:0, s:'Korduvad investeeringud ilma vahendustasuta'}; },
      custody: function(p){ return {v:0}; }
    },
    'freedom24': {
      etf: function(a){ var u=Math.ceil(a/ETF_PRICE); return {v:2+0.02*u, s:'Smart plaan: 2 € orderi kohta + 0,02 € aktsia kohta'}; },
      us: function(a){ var sh=Math.ceil(a/USD_EUR/US_PRICE_USD); return {v:(2+0.02*sh)*USD_EUR, s:'Smart plaan: 2 $ + 0,02 $ aktsia kohta. Valuutatasu ei ole avaldatud', extra:FX}; },
      plan: function(m){ return {v:0, s:'0% ainult korduva ETF-i investeerimisplaani sees'}; },
      custody: function(p){ return {v:0}; }
    },
    'ibkr': {
      etf: function(a,plan){
          if(plan==='tiered'){ return {v:ibXetra(a), s:'Tiered Xetras: 0,05% (min 1,25 €, max 29 €) + kliiringu- ja regulatiivsed tasud'}; }
          return {v:Math.max(3,a*0.0005), s:'Fixed Xetras: 0,05% (min 3 €), tasud sees'}; },
      us: function(a,plan){ var sh=Math.ceil(a/USD_EUR/US_PRICE_USD);
          if(plan==='tiered'){ var com=Math.max(0.35,0.0035*sh); return {v:(com+0.003*sh+0.0002*sh+0.000003*sh+0.000735*com)*USD_EUR+a*0.0003, s:'Tiered: 0,0035 $/aktsia (min 0,35 $) + börsi-, kliiringu- ja regulatiivsed tasud (turuorder) + 0,03% valuutavahetus'}; }
          return {v:Math.max(1,0.005*sh)*USD_EUR+a*0.0003, s:'Fixed: 0,005 $/aktsia (min 1 $) + 0,03% valuutavahetus'}; },
      plan: function(m,plan){
          if(plan==='tiered'){ return {v:12*ibXetra(m), s:'12 orderit Xetras koos kliiringu- ja regulatiivsete tasudega'}; }
          return {v:12*Math.max(3,m*0.0005), s:'12 orderit, igaüks vähemalt 3 €'}; },
      custody: function(p){ return {v:0}; }
    },
    'lightyear': {
      etf: function(a){ return {v:0, s:'ETF-idel vahendustasu ei ole'}; },
      us: function(a){ var usd=a/USD_EUR; return {v:Math.min(1,Math.max(0.1,usd*0.001))*USD_EUR+a*0.0035, s:'0,1% (min 0,10 $, max 1 $) + 0,35% valuutavahetus'}; },
      plan: function(m){ return {v:0, s:'ETF-ide plaanid ilma vahendustasuta'}; },
      custody: function(p){ return {v:0}; }
    },
    'revolut': {
      etf: function(a){ return {v:1, s:'1 € orderi kohta Standard plaanis. Vahendustasu sõltub riigist', c:true}; },
      us: function(a){ var fx=Math.max(0,a-1000)*0.01; return {v:1+fx, s:'1 € + tasuta valuutavahetus kuni 1000 € kuus (üle selle 1%), tööpäevadel', c:true}; },
      plan: function(m){ return {v:0, s:'Valitud ETF-ide plaanid ilma vahendustasuta'}; },
      custody: function(p){ return {v:0}; }
    },
    'saxo': {
      etf: function(a){ return {v:Math.max(2,a*0.0008), s:'Classic tase Euronextis: 0,08% (min 2 €)'}; },
      us: function(a){ var usd=a/USD_EUR; return {v:Math.max(1,usd*0.0008)*USD_EUR+a*0.0025, s:'Classic tase: 0,08% (min 1 $) + 0,25% valuutavahetus'}; },
      plan: function(m){ return {v:12*Math.max(2,m*0.0008), s:'Säästuplaane ei ole: 12 käsitsi orderit (min 2 €)'}; },
      custody: function(p){ return {v:p*0.0015*1.25, s:'0,15% aastas + Taani KM 25% (Classic tase)'}; }
    },
    'traderepublic': {
      etf: function(a){ return {v:1, s:'1 € orderi kohta'}; },
      us: function(a){ return {v:1, s:'1 € orderi kohta. USA aktsiatega kaubeldakse eurodes'}; },
      plan: function(m){ return {v:0, s:'Tasuta säästuplaanid'}; },
      custody: function(p){ return {v:0}; }
    },
    'trading212': {
      etf: function(a){ return {v:0, s:'Vahendustasu ei ole. Võivad kehtida muud tasud'}; },
      us: function(a){ return {v:a*0.0015, s:'Vahendustasu ei ole + 0,15% valuutavahetus'}; },
      plan: function(m){ return {v:0, s:'AutoInvest ilma vahendustasuta'}; },
      custody: function(p){ return {v:0}; }
    },
    'xtb': {
      etf: function(a){ return {v:a<=100000?0:Math.max(10,(a-100000)*0.002), s:'0% kuni 100 000 € kuukäibe juures'}; },
      us: function(a){ return {v:a*0.005, s:'0% vahendustasu + 0,5% valuutavahetus'}; },
      plan: function(m){ return {v:0, s:'Investeerimisplaanid ilma vahendustasuta'}; },
      custody: function(p){ return {v:Math.max(0,p-250000)*0.0002, s:'0 € kuni 250 000 € (üle selle 0,02% aastas)'}; }
    }
  };

  /* ---------- Loading ---------- */
  function getJSON(url){
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 15000) : null;
    /* no-cache: the browser revalidates with jsDelivr (usually a 304), so a purge reaches returning visitors too */
    return fetch(url, ctrl ? {cache:'no-cache', signal:ctrl.signal} : {cache:'no-cache'})
      .then(function(r){ if(timer) clearTimeout(timer); if(!r.ok) throw new Error('HTTP '+r.status+' '+url); return r.json(); },
            function(e){ if(timer) clearTimeout(timer); throw e; });
  }
  function retry(fn, n){
    return fn().catch(function(e){
      if(n<=1) throw e;
      return new Promise(function(res){ setTimeout(res, 700); }).then(function(){ return retry(fn, n-1); });
    });
  }
  /* CSS and logos are optional: the promise always resolves, so a blocked file never blanks the tool. */
  function loadCss(href){
    return new Promise(function(res){
      if(document.getElementById('rt-bc-css')) return res();
      var l=document.createElement('link'); l.id='rt-bc-css'; l.rel='stylesheet'; l.href=href;
      var done=false, fin=function(){ if(!done){ done=true; res(); } };
      l.onload=fin; l.onerror=fin; setTimeout(fin, 4000);
      document.head.appendChild(l);
    });
  }
  function loadScript(src){
    return new Promise(function(res){
      if(window.LF_CC_LOGOS) return res();
      var s=document.createElement('script'); s.src=src; s.async=true;
      var done=false, fin=function(){ if(!done){ done=true; res(); } };
      s.onload=fin; s.onerror=fin; setTimeout(fin, 4000);
      document.head.appendChild(s);
    });
  }
  /* Reserves the space before the first render so the content below does not jump. */
  function reserveSpace(){
    if(document.getElementById('rt-bc-pre')) return;
    var st=document.createElement('style'); st.id='rt-bc-pre';
    st.textContent='#rt-bc:empty{min-height:1400px}@media (max-width:767px){#rt-bc:empty{min-height:1600px}}';
    document.head.appendChild(st);
  }

  function boot(){
    var root0 = document.getElementById('rt-bc'); if(!root0) return;
    reserveSpace();
    var dataUrl = root0.getAttribute('data-src') || window.RT_BC_DATA_URL || DATA_URL;
    Promise.all([
      retry(function(){ return getJSON(dataUrl); }, 3),
      loadCss(root0.getAttribute('data-css') || BASE + 'broker-comparator.css'),
      loadScript(LOGOS_URL)
    ]).then(function(res){
        var d = res[0];
        LOGOS = window.LF_CC_LOGOS || {};
        VERIFIED = d.verified; USD_EUR = d.assumptions.USD_EUR; ETF_PRICE = d.assumptions.ETF_PRICE; US_PRICE_USD = d.assumptions.US_PRICE_USD;
        VAT = d.assumptions.VAT != null ? d.assumptions.VAT : 0.24;
        PAIRS = d.pairs || {};
        B = d.brokers.filter(function(b){ return CALC[b.id]; }).map(function(b){ b.calc = CALC[b.id]; return b; });
        /* Pre-selected brokers first in the picker, the rest in alphabetical order */
        B = TOP.map(function(id){ for(var i=0;i<B.length;i++){ if(B[i].id===id) return B[i]; } return null; }).filter(Boolean)
          .concat(B.filter(function(b){ return TOP.indexOf(b.id)<0; }).sort(function(x,y){ return x.name.localeCompare(y.name, LOC); }));
        /* Fills the native "Viimati uuendatud ..." text in the page hero (element with ID rt-last-updated), like the savings comparator */
        var lu = document.getElementById('rt-last-updated');
        if(lu && d.lastUpdated) lu.textContent = T.lastUpdated + monthYear(d.lastUpdated);
        start(root0);
      })
      .catch(function(e){ root0.innerHTML = '<p style="text-align:center;color:#697386;padding:40px 16px">'+T.loadFail+'</p>'; if(window.console) console.error(e); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  function start(root){
  /* ---------- Rows ---------- */
    var SECTIONS = [
      { id:'costs', title:T.secCosts, sub:T.secCostsSub, open:true, rows:[
        {k:'etf', calc:true, label:T.rEtf, note:function(){ return fmtEurInt(S.amount)+T.nEtf; }},
        {k:'us', calc:true, label:T.rUs, note:function(){ return fmtEurInt(S.amount)+T.nUs; }},
        {k:'plan', calc:true, label:T.rPlan, note:function(){ return fmtEurInt(S.monthly)+T.nPlan; }},
        {k:'custody', calc:true, label:T.rCustody, note:function(){ return fmtEurInt(S.portfolio)+T.nCustody; }}
      ]},
      { id:'fees', title:T.secFees, open:true, rows:[
        {k:'etfFee', label:T.rEtfFee},
        {k:'usFee', label:T.rUsFee},
        {k:'baltic', label:T.rBaltic, note:T.nBaltic},
        {k:'fx', label:T.rFx},
        {k:'custodyTxt', label:T.rCustodyTxt},
        {k:'inact', label:T.rInact},
        {k:'transfer', label:T.rTransfer}
      ]},
      { id:'interest', title:T.secInterest, open:true, rows:[
        {k:'interest', label:T.rInterest, high:true}
      ]},
      { id:'safety', title:T.secSafety, open:true, rows:[
        {k:'entity', label:T.rEntity},
        {k:'regulator', label:T.rRegulator},
        {k:'protInv', label:T.rProtInv},
        {k:'protCash', label:T.rProtCash}
      ]},
      { id:'tax', title:T.secTax, open:true, rows:[
        {k:'invKonto', label:T.rInvKonto, note:T.nInvKonto}
      ]},
      { id:'products', title:T.secProducts, open:true, rows:[
        {k:'fractions', label:T.rFractions},
        {k:'plans', label:T.rPlans},
        {k:'bonds', label:T.rBonds}
      ]}
    ];

    /* ---------- State ---------- */
    var S = { sel:TOP.slice(0), amount:1000, monthly:100, portfolio:10000, ibkr:'fixed', diff:false, more:false, open:{} };
    SECTIONS.forEach(function(s){ S.open[s.id]=s.open; });

    function isMobile(){ return window.matchMedia('(max-width:767px)').matches; }
    function maxSel(){ return isMobile()?2:3; }
    function byId(id){ for(var i=0;i<B.length;i++){ if(B[i].id===id) return B[i]; } return null; }

    /* ---------- Estonian number format: 1 000 and 3,90 € ---------- */
    function fmtInt(n){ return Math.round(n).toLocaleString(LOC); }
    var NBSP=String.fromCharCode(160);
    function fmtEurInt(n){ return fmtInt(n)+NBSP+'€'; }
    function fmtEur(n){ return (Math.round(n*100)/100).toLocaleString(LOC,{minimumFractionDigits:2,maximumFractionDigits:2})+NBSP+'€'; }
    /* Accepts 1 000, 1000,50 and 1.000 so a reader can type either way. */
    function parseNum(v){
      var t=String(v).replace(/[\s€]/g,'');
      var lc=t.lastIndexOf(','), ld=t.lastIndexOf('.');
      if(lc>-1 && ld>-1){ t = lc>ld ? t.replace(/\./g,'').replace(',','.') : t.replace(/,/g,''); }
      else if(lc>-1){ t = /,\d{1,2}$/.test(t) ? t.replace(',','.') : t.replace(/,/g,''); }
      else if(ld>-1 && !/\.\d{1,2}$/.test(t)){ t = t.replace(/\./g,''); }
      var n=parseFloat(t); return isFinite(n)&&n>0?n:0;
    }
    function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

    /* ---------- Render ---------- */
    function ico(p){ return '<svg class="cc-sec-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>'; }
    var CHEV = '<svg class="cc-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    var ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M7 7h10v10"/></svg>';
    /* Lucide-style icons: calculator, percent, piggy bank, shield, receipt, layers */
    var ICONS = {
      costs: ico('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01M8 10h.01M12 10h.01M16 10h.01"/>'),
      fees: ico('<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
      interest: ico('<path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/><path d="M2 9v1c0 1.1.9 2 2 2h1"/><path d="M16 11h.01"/>'),
      safety: ico('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
      tax: ico('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>'),
      products: ico('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>')
    };
    /* Some affiliate links go through domains that ad blockers (EasyList) block, like Impact's sjv.io.
       If the broker's probe domain is blocked in this browser, the button points to the broker's own site. */
    var BLOCKED={}, probed={};
    function ctaHref(b){ return (b.cta.probe && BLOCKED[b.cta.probe] && b.cta.fallback) ? b.cta.fallback : b.cta.href; }
    function probeBlock(sel){
      if(typeof fetch!=='function') return;
      sel.forEach(function(b){
        var u=b.cta.probe; if(!u || probed[u]) return; probed[u]=true;
        fetch(u, {mode:'no-cors', credentials:'omit', cache:'no-store'})
          .then(function(){}, function(){ BLOCKED[u]=true; renderTable(); });
      });
    }
    function ctaRel(b){ return b.cta.plain ? 'nofollow noopener' : 'sponsored noopener'; }
    function ctaHtml(b){ return '<a class="cc-btn" href="'+esc(ctaHref(b))+'" target="_blank" rel="'+ctaRel(b)+'" aria-label="'+esc(T.cta+': '+b.name)+'"><span>'+esc(T.cta)+'</span>'+ARROW+'</a><span class="cc-risk">'+esc(b.risk)+'</span>'; }
    function offerHtml(b){
      var o=b.offer; if(!o) return '';
      return '<div class="cc-offer"><span class="cc-offer-b">'+T.offerBadge+'</span>'
        +'<span class="cc-offer-t">'+esc(o.t)+'.'+(o.c?' '+T.useCode+' <b>'+esc(o.c)+'</b>.':'')+'</span>'
        +'<a class="cc-offer-a" href="'+esc(o.a)+'" target="_blank" rel="noopener">'+T.howItWorks+'</a></div>';
    }

    /* "logo" in the JSON wins over logos.js. "logoBare": true shows the image as it is, with no frame or rounded
       corners (for partners whose logo must not be modified, like Lightyear on the savings comparator). */
    function logo(b,size){
      var st=(size?'width:'+size+'px;height:'+size+'px;':'');
      var src=b.logo||LOGOS[b.id];
      if(src) return '<span class="cc-logo has-img'+(b.logoBare?' is-bare':'')+'" style="'+st+'" data-short="'+esc(b.short)+'" data-color="'+esc(b.color)+'" aria-hidden="true"><img src="'+esc(src)+'" alt=""></span>';
      return '<span class="cc-logo" style="background:'+esc(b.color)+';'+st+'" aria-hidden="true">'+esc(b.short)+'</span>'; }
    /* A logo that fails to load falls back to the broker's initials on its brand colour */
    root.addEventListener('error',function(e){
      var img=e.target; if(!img || img.tagName!=='IMG') return;
      var sp=img.parentNode; if(!sp || !sp.classList || !sp.classList.contains('cc-logo')) return;
      sp.classList.remove('has-img','is-bare'); sp.style.background=sp.getAttribute('data-color')||'#3a4454'; sp.textContent=sp.getAttribute('data-short')||'';
    },true);

    function shell(){
      root.innerHTML =
        '<div class="cc-panel">'+
          '<p class="cc-step">'+T.chooseUpTo+' <span id="cc-max">3</span> '+T.toCompare+'</p>'+
          '<p class="cc-hint">'+T.pickerHint+'</p>'+
          '<div class="cc-picker" id="cc-picker"></div>'+
          '<button type="button" class="cc-more" id="cc-more" aria-expanded="false"></button>'+
          '<div class="cc-divider"></div>'+
          '<div class="cc-scen-wrap" id="cc-scen-wrap">'+
          '<button type="button" class="cc-scen-toggle" id="cc-scen-toggle" aria-expanded="false"><span id="cc-scen-sum"></span><span id="cc-scen-act">'+T.change+'</span></button>'+
          '<div class="cc-scen-body">'+
          '<p class="cc-step">'+T.setScenario+'</p>'+
          '<p class="cc-hint">'+T.scenarioHint+'</p>'+
          '<div class="cc-scen">'+
            field('cc-amount',T.fAmount,S.amount,T.fAmountNote)+
            field('cc-monthly',T.fMonthly,S.monthly,T.fMonthlyNote)+
            field('cc-portfolio',T.fPortfolio,S.portfolio,T.fPortfolioNote)+
          '</div>'+
          '</div></div>'+
        '</div>'+
        '<div class="cc-bar"><span class="cc-count" id="cc-count"></span>'+
          '<button type="button" class="cc-switch" id="cc-diff" aria-pressed="false"><i></i>'+T.diffOnly+'</button></div>'+
        '<div class="cc-table" id="cc-table"></div>'+
        '<div class="cc-pairs" id="cc-pairs"></div>'+
        notesHtml()+
        '<div class="cc-mini" id="cc-mini"></div>';
    }

    function field(id,label,val,note){
      return '<div><label class="cc-label" for="'+id+'">'+label+'</label><div class="cc-iw"><input class="cc-input" id="'+id+'" inputmode="decimal" autocomplete="off" value="'+fmtInt(val)+'"><span class="cc-unit">€</span></div><div class="cc-inote">'+note+'</div></div>';
    }

    /* On mobile only the first 6 brokers (plus any selected one) show until the reader opens the full list */
    var SHORT=6;
    function renderPicker(){
      var max=maxSel(); document.getElementById('cc-max').textContent=max;
      var pk=document.getElementById('cc-picker');
      pk.classList.toggle('is-open',S.more);
      pk.innerHTML = B.map(function(b,i){
        var on=S.sel.indexOf(b.id)>-1;
        return '<button type="button" class="cc-pick'+(on?' is-on':'')+(i>=SHORT&&!on?' is-extra':'')+'" data-id="'+b.id+'" aria-pressed="'+on+'">'+logo(b)+'<span>'+esc(b.name)+'</span><span class="cc-pick-t">'+esc(b.type)+'</span></button>';
      }).join('');
      var mb=document.getElementById('cc-more');
      mb.textContent=S.more?T.showFewer:T.showAll1+B.length+T.showAll2;
      mb.setAttribute('aria-expanded',S.more);
    }

    function calcFor(b,k){
      var plan=b.hasPlan?S.ibkr:null;
      if(k==='etf') return b.calc.etf(S.amount,plan);
      if(k==='us') return b.calc.us(S.amount,plan);
      if(k==='plan') return b.calc.plan(S.monthly,plan);
      return b.calc.custody(S.portfolio,plan);
    }

    /* Highest percentage in a text value, e.g. "2,50% kuni 3,50%" gives 3.5 */
    function pctMax(d){ var m=String(d&&d.v||'').match(/\d+(?:[.,]\d+)?(?=\s?%)/g); return m?Math.max.apply(null,m.map(function(x){ return Number(x.replace(',','.')); })):0; }

    function planData(b,d){ return (d && b.hasPlan && d.plans && d.plans[S.ibkr]) ? d.plans[S.ibkr] : d; }

    function cellHtml(b,row,best){
      var d, html;
      if(row.calc){
        d=calcFor(b,row.k);
        html='<span class="cc-v is-big">'+fmtEur(d.v)+(d.extra?' <span class="cc-extra">'+(typeof d.extra==='string'?d.extra:T.plusFees)+'</span>':'')+'</span>';
        if(d.s) html+='<span class="cc-s">'+esc(d.s)+'</span>';
        if(best!==null && !d.extra && Math.abs(d.v-best)<0.005) html+='<span class="cc-tag is-best">'+T.cheapest+'</span>';
        if(d.c) html+='<span class="cc-tag is-conf">'+CONF+'</span>';
      } else {
        d=planData(b,b.t[row.k])||{v:CONF,c:true};
        var isConf=d.v===CONF;
        html=isConf?'':'<span class="cc-v">'+esc(d.v)+'</span>';
        if(d.s) html+='<span class="cc-s">'+esc(d.s)+'</span>';
        if(row.high && best!==null && Math.abs(pctMax(d)-best)<0.005) html+='<span class="cc-tag is-best">'+T.highestRate+'</span>';
        if(d.c) html+='<span class="cc-tag is-conf">'+CONF+'</span>';
      }
      return '<div class="cc-cell">'+html+'</div>';
    }

    function sameValues(sel,row){
      if(sel.length<2) return false;
      var vals=sel.map(function(b){ if(row.calc){ var c=calcFor(b,row.k); return fmtEur(c.v)+'|'+(c.extra||''); } var d=planData(b,b.t[row.k])||{}; return (d.v||'')+'|'+(d.s||''); });
      return vals.every(function(v){ return v===vals[0]; });
    }

    function renderTable(){
      var sel=S.sel.map(byId).filter(Boolean);
      var t=document.getElementById('cc-table');
      document.getElementById('cc-count').textContent = sel.length? nSelected(sel.length) : '';
      if(!sel.length){ t.innerHTML='<div class="cc-empty">'+T.emptyPick+'</div>'; document.getElementById('cc-pairs').innerHTML=''; renderMini(sel); return; }
      root.style.setProperty('--cc-cols','minmax(180px,1.1fr) repeat('+sel.length+',minmax(0,1fr))');
      root.style.setProperty('--cc-n',sel.length);
      root.classList.toggle('show-all',!S.diff);

      var head='<div class="cc-row cc-head"><div class="cc-hcell"></div>'+sel.map(function(b){
        var h='<div class="cc-hcell"><div class="cc-hname">'+logo(b,32)+'<span><b>'+esc(b.name)+'</b><small>'+esc(b.type)+'</small></span></div>';
        h+='<div class="cc-hextra">'+(b.hasPlan?'<div class="cc-pills" role="group" aria-label="'+T.pricingPlan+'"><button type="button" class="cc-pill'+(S.ibkr==='fixed'?' is-on':'')+'" data-plan="fixed">'+T.planFixed+'</button><button type="button" class="cc-pill'+(S.ibkr==='tiered'?' is-on':'')+'" data-plan="tiered">'+T.planTiered+'</button></div>':'')+'</div>';
        h+=ctaHtml(b);
        h+=offerHtml(b);
        if(b.review) h+='<a class="cc-review" href="'+esc(b.review)+'" target="_blank" rel="noopener">'+T.readReview+'</a>';
        return h+'</div>';
      }).join('')+'</div>';

      var body=SECTIONS.map(function(sec){
        var rows=sec.rows.map(function(row){
          var best=null;
          if(row.calc && sel.length>1){
            var vals=sel.map(function(b){ var d=calcFor(b,row.k); return d.extra?null:d.v; }).filter(function(v){ return v!==null; });
            var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals);
            if(vals.length>1 && mx-mn>0.004) best=mn;
          }
          if(row.high && sel.length>1){
            var hv=sel.map(function(b){ return pctMax(planData(b,b.t[row.k])); });
            var hmx=Math.max.apply(null,hv), hmn=Math.min.apply(null,hv);
            /* No tag when the best rate is symbolic (the banks' 0,01%) */
            if(hmx>=0.1 && hmx-hmn>0.004) best=hmx;
          }
          var note=typeof row.note==='function'?row.note():row.note;
          var same=sameValues(sel,row);
          return '<div class="cc-row'+(same?' is-same':'')+'"><div class="cc-lab">'+esc(row.label)+(note?'<small>'+esc(note)+'</small>':'')+'</div>'+sel.map(function(b){ return cellHtml(b,row,best); }).join('')+'</div>';
        }).join('');
        var closed=!S.open[sec.id];
        return '<div class="cc-sec'+(closed?' is-closed':'')+'"><button type="button" class="cc-sec-h" data-sec="'+sec.id+'" aria-expanded="'+(!closed)+'"><span class="cc-sec-t">'+(ICONS[sec.id]||'')+'<span>'+esc(sec.title)+(sec.sub?'<small>'+esc(sec.sub)+'</small>':'')+'</span></span>'+CHEV+'</button><div class="cc-sec-b">'+rows+'</div></div>';
      }).join('');

      var srcRow='<div class="cc-row cc-srcrow"><div class="cc-lab">'+T.sources+'<small>'+T.sourcesSub+'</small></div>'+sel.map(function(b){ return '<div class="cc-cell"><a class="cc-src" href="'+esc(b.src)+'" target="_blank" rel="noopener">'+esc(b.name)+T.feesSuffix+'</a>'+(b.verified?'<span class="cc-ver">'+T.checked+esc(b.verified)+'</span>':'')+'</div>'; }).join('')+'</div>';

      t.innerHTML=head+body+srcRow;
      probeBlock(sel);
      updateSum();
      renderMini(sel);
      alignHead();
      onScroll();
      renderPairs(sel);
    }

    function updateSum(){
      var el=document.getElementById('cc-scen-sum'); if(!el) return;
      el.innerHTML=T.sumBuy+' <b>'+fmtEurInt(S.amount)+'</b> · <b>'+fmtEurInt(S.monthly)+'</b>'+T.sumPerMonth+'<span class="cc-sum-2">'+T.sumPortfolio+' <b>'+fmtEurInt(S.portfolio)+'</b></span>';
    }

    function renderMini(sel){
      var m=document.getElementById('cc-mini'); if(!m) return;
      if(!sel.length){ m.innerHTML=''; m.classList.remove('has-cta'); return; }
      /* On desktop the bar follows the table columns (empty label column on the left) */
      var desk=!isMobile();
      /* With 2 or 3 brokers compared, each column also gets the button and the risk warning */
      var cta=sel.length>1;
      m.classList.toggle('has-cta',cta);
      m.innerHTML='<div class="cc-mini-in" style="grid-template-columns:'+(desk?'var(--cc-cols)':'repeat('+sel.length+',minmax(0,1fr))')+'">'+(desk?'<div class="cc-mini-lab"></div>':'')+sel.map(function(b){
        var c='<div class="cc-mini-c"><div class="cc-mini-n">'+logo(b,24)+'<b>'+esc(b.name)+'</b></div>';
        if(cta) c+=ctaHtml(b);
        return c+'</div>'; }).join('')+'</div>';
    }

    function navBottom(){
      var n=document.querySelector('.nav_fixed')||document.querySelector('.navbar_component')||document.querySelector('nav');
      if(!n) return 0;
      var cs=window.getComputedStyle(n); if(cs.position!=='fixed' && cs.position!=='sticky') return 0;
      var r=n.getBoundingClientRect(); return r.bottom>0?Math.round(r.bottom):0;
    }

    var ticking=false;
    function onScroll(){
      if(ticking) return; ticking=true;
      requestAnimationFrame(function(){
        ticking=false;
        var top=navBottom();
        root.style.setProperty('--cc-top',top+'px');
        var t=document.getElementById('cc-table'), h=root.querySelector('.cc-head'), m=document.getElementById('cc-mini');
        if(!t||!h||!m) { if(m) m.classList.remove('is-on'); return; }
        var tr=t.getBoundingClientRect(), hr=h.getBoundingClientRect();
        var show=hr.bottom<top && tr.bottom>top+(m.classList.contains('has-cta')?160:80);
        if(isMobile()){ m.style.left=''; m.style.width=''; m.style.right=''; }
        else { m.style.left=Math.round(tr.left)+'px'; m.style.width=Math.round(tr.width)+'px'; m.style.right='auto'; }
        m.classList.toggle('is-on',show);
      });
    }
    window.addEventListener('scroll',onScroll,{passive:true});
    window.addEventListener('resize',onScroll);

    function alignHead(){
      var els=root.querySelectorAll('.cc-head .cc-hname, .cc-head .cc-hextra, .cc-head .cc-btn, .cc-head .cc-risk'), groups={};
      Array.prototype.forEach.call(els,function(el){ el.style.minHeight=''; var k=el.className; (groups[k]=groups[k]||[]).push(el); });
      Object.keys(groups).forEach(function(k){ var mx=0; groups[k].forEach(function(el){ mx=Math.max(mx,el.offsetHeight); }); groups[k].forEach(function(el){ el.style.minHeight=mx+'px'; }); });
    }
    window.addEventListener('resize',function(){ alignHead(); });

    function renderPairs(sel){
      var out=[];
      for(var i=0;i<sel.length;i++){ for(var j=i+1;j<sel.length;j++){
        var key=[sel[i].id,sel[j].id].sort().join('|');
        if(PAIRS[key]) out.push('<a class="cc-pair" href="'+SITE+'/artiklid/'+esc(PAIRS[key])+'" target="_blank" rel="noopener"><span>'+T.fullComparison+' <b>'+esc(sel[i].name)+T.vs+esc(sel[j].name)+'</b></span><span>'+T.readArticle+'</span></a>');
      }}
      document.getElementById('cc-pairs').innerHTML=out.join('');
    }

    function notesHtml(){
      var a=function(href,txt){ return '<a href="'+href+'" target="_blank" rel="noopener">'+txt+'</a>'; };
      return '<div class="cc-notes">'+
        '<p><b>Kuidas me kulud arvutame:</b> iga stsenaarium kasutab odavaimat viisi, mida pakkuja selle toote jaoks pakub, koos vahendustasu, fikseeritud tasude ja valuutavahetuse kuluga. Dollaritasud arvestame kursiga 1 $ = '+String(USD_EUR).replace('.',',')+' €. Tükitasude puhul eeldame, et ETF-i osak maksab '+ETF_PRICE+' € ja USA aktsia '+US_PRICE_USD+' $. Turu hinnavahet (spread), ETF-i enda kulusid (TER) ega makse ei ole arvestatud. Välismaakleritel võivad tasud elukohariigiti erineda: tabel näitab pakkumist enamikule ELi klientidele.</p>'+
        '<p><b>Eesti pangad:</b> LHV, Swedbank ja SEB vahetavad valuutat panga kursiga ega avalda hinnakirjas marginaali. Seepärast on nende USA aktsiate kulul märge „+ valuutavahetus” ja neid ei arvestata „Odavaim” märgi juures. Väikeste ETF-i ostude puhul on odavaim viis LHV Kasvukonto või SEB mikroinvesteerimine (0,5% ilma miinimumtasuta). Pankade hoiutasudele lisandub käibemaks '+Math.round(VAT*100)+'%.</p>'+
        '<p><b>Investeerimiskonto:</b> „Jah” tähendab, et pakkuja avab sulle investeerimiskonto. „Võimalik” tähendab, et konto võib vastata Maksu- ja Tolliameti tingimustele, kui ostad finantsvara ainult selle konto rahaga ja deklareerid konto tuludeklaratsiooni tabelis 6.5. Loe '+a(EMTA,'Maksu- ja Tolliameti juhendit')+' ja meie artiklit '+a(SITE+'/artiklid/investeerimiskonto-deklareerimine','investeerimiskonto deklareerimisest')+'.</p>'+
        '<p><b>Interactive Brokers:</b> kasuta veeru ülaosas valikut Fixed/Tiered. Tiered puhul lisame Interactive Brokersi tabelist kliiringu- ja regulatiivsed tasud. Xetras ei võeta börsitasu jaeinvestorite orderitelt, mis suunatakse SmartRoutingu kaudu. USA aktsiate puhul eeldame turuorderit, millele börsitasu lisandub.</p>'+
        '<p><b>Trading 212:</b> sponsitud link. Investeerides on sinu kapital riskis ja võid tagasi saada vähem, kui investeerisid. Varasem tootlus ei taga tulevast tootlust. Kehtida võivad muud tasud, vaata '+a('https://www.trading212.com/terms/invest','tingimusi ja tasusid')+'. Kui lülitad intressi sisse, hoiab Trading 212 sinu raha nõuetele vastavates rahaturufondides ja pankades. Muul juhul hoitakse sinu raha ainult pankades. Intress kehtib Trading 212 Invest-kontol oleval rahal. Kehtivad tingimused. Näidatud määrad ei pruugi olla enam ajakohased: vaata kehtivaid määrasid tingimuste ja tasude lehelt.</p>'+
        '<p><b>Freedom24:</b> 0% vahendustasu ETF-i investeerimisplaanis kehtib ainult korduva investeerimise funktsioonis. Muud tehingud järgivad Freedom24 hinnakirja.</p>'+
        '<p>Andmed on kontrollitud '+esc(VERIFIED)+'. Tasud muutuvad, seega kontrolli tingimusi enne konto avamist alati pakkuja enda lehel.</p>'+
      '</div>';
    }

    /* ---------- Events ---------- */
    function bind(){
      root.addEventListener('click',function(e){
        var p=e.target.closest('.cc-pick');
        if(p){ var id=p.getAttribute('data-id'), i=S.sel.indexOf(id);
          if(i>-1) S.sel.splice(i,1); else { if(S.sel.length>=maxSel()) S.sel.shift(); S.sel.push(id); }
          renderPicker(); renderTable(); return; }
        if(e.target.closest('#cc-more')){ S.more=!S.more; renderPicker(); return; }
        var h=e.target.closest('.cc-sec-h');
        if(h){ var sid=h.getAttribute('data-sec'); S.open[sid]=!S.open[sid]; renderTable(); return; }
        var pl=e.target.closest('.cc-pill');
        if(pl){ S.ibkr=pl.getAttribute('data-plan'); renderTable(); return; }
        if(e.target.closest('#cc-scen-toggle')){ var w=document.getElementById('cc-scen-wrap'), open=!w.classList.contains('is-open'); w.classList.toggle('is-open',open); document.getElementById('cc-scen-toggle').setAttribute('aria-expanded',open); document.getElementById('cc-scen-act').textContent=open?T.close:T.change; return; }
        if(e.target.closest('#cc-diff')){ S.diff=!S.diff; document.getElementById('cc-diff').setAttribute('aria-pressed',S.diff); renderTable(); }
      });
      [['cc-amount','amount'],['cc-monthly','monthly'],['cc-portfolio','portfolio']].forEach(function(f){
        var el=document.getElementById(f[0]);
        el.addEventListener('input',function(){ var n=parseNum(el.value); if(n>0){ S[f[1]]=n; renderTable(); } });
        el.addEventListener('blur',function(){ el.value=fmtInt(S[f[1]]); });
      });
      var mq=window.matchMedia('(max-width:767px)');
      var onMq=function(){ while(S.sel.length>maxSel()) S.sel.pop(); renderPicker(); renderTable(); };
      if(mq.addEventListener) mq.addEventListener('change',onMq); else if(mq.addListener) mq.addListener(onMq);
    }

    shell();
    if(isMobile()) S.sel=S.sel.slice(0,2);
    renderPicker(); renderTable(); bind();

  }
})();
