// Regenerates every derived web/ artifact from the canonical sources:
//   web/comparator.js          (app logic + markup, hand-edited)
//   web/comparator.css         (styles, hand-edited)
//   data/data.json             (term deposit rates, hand-edited / scraped)
//   data/flexible-accounts.json (Estonian flexible-savings rates)
//   data/fintech-accounts.json  (foreign fintech platform rates)
//
// Before this script existed, the CSS was manually pasted into a STYLES
// string inside comparator.js, and comparator.preview.js + the two
// webflow-embed-*.html files were separate hand-maintained copies of the
// whole comparator.js script. They drifted (comparator.preview.js already
// had a fix that comparator.js didn't). Run this after editing comparator.js,
// comparator.css or any of the three data files:
//
//   node scripts/build-web.mjs
//
// Run with `npm run build:web`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = (p) => path.join(ROOT, 'web', p);
const dataFile = (p) => path.join(ROOT, 'data', p);

const css = fs.readFileSync(web('comparator.css'), 'utf8').trim();
let appJs = fs.readFileSync(web('comparator.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(dataFile('data.json'), 'utf8'));
const flexibleData = JSON.parse(fs.readFileSync(dataFile('flexible-accounts.json'), 'utf8'));
const fintechData = JSON.parse(fs.readFileSync(dataFile('fintech-accounts.json'), 'utf8'));

// --- 1. Re-inline comparator.css into comparator.js's STYLES var --------
const stylesJsLiteral = "'" + css
  .replace(/\\/g, '\\\\')
  .replace(/'/g, "\\'")
  .replace(/\r?\n/g, '\\n') + "'";

const stylesRe = /var STYLES = '[\s\S]*?';\n\}\)\(\);\s*$/;
if (!stylesRe.test(appJs)) throw new Error('Could not find STYLES var in comparator.js to replace');
appJs = appJs.replace(stylesRe, 'var STYLES = ' + stylesJsLiteral + ';\n})();\n');
fs.writeFileSync(web('comparator.js'), appJs);
console.log('comparator.js: STYLES re-inlined from comparator.css (' + css.length + ' bytes)');

// --- 2. preview.js was a byte-for-byte fork of comparator.js. Delete it; --
//        preview.html now loads comparator.js directly (it already supports
//        window.RT_DATA_URL_OVERRIDE and self-injects its own CSS). ------
const previewJsPath = web('comparator.preview.js');
if (fs.existsSync(previewJsPath)) {
  fs.unlinkSync(previewJsPath);
  console.log('comparator.preview.js: removed (superseded by comparator.js + RT_DATA_URL_OVERRIDE)');
}

// --- 3. Extract the IIFE body (everything the loader needs minus the ------
//        fetch() based init() and, for the "nocss" variant, minus the
//        STYLES/injectStyles block) so the embed variants can never drift
//        from the real app logic. ----------------------------------------
const bodyMatch = appJs.match(/\(function \(\) \{\n {2}'use strict';\n\n([\s\S]*)\n\}\)\(\);\n$/);
if (!bodyMatch) throw new Error('Could not isolate comparator.js IIFE body');
let body = bodyMatch[1];

// Swap the network fetch for embedded data. mergeAccounts()/maxDate() are
// already part of `body` (defined earlier in the same IIFE), so the embedded
// init() just has to hand them the three datasets instead of fetch results.
// `termExpr`/`flexExpr`/`finExpr` are how the script reads each dataset - a
// local var when everything lives in one script, or `window.RT_EMBEDDED_*`
// when the data is a separate, earlier <script> (see webflow-embed-nocss-*.html:
// Webflow's HTML Embed blocks cap out at 50,000 characters each, and the full
// script + all three datasets no longer fit in one).
const initRe = /function init\(\) \{\n(?:.|\n)*?\n  \}\n\n  if \(document\.readyState/;
if (!initRe.test(body)) throw new Error('Could not find init() to replace with embedded data');
function withEmbeddedInit(src, termExpr, flexExpr, finExpr) {
  const embeddedInit =
    'function init() {\n' +
    '    var root = document.getElementById(MOUNT_ID);\n' +
    '    if (!root) return;\n' +
    '    var TERM_DATA = ' + termExpr + ';\n' +
    '    var FLEX_DATA = ' + flexExpr + ';\n' +
    '    var FIN_DATA = ' + finExpr + ';\n' +
    '    ACCOUNTS = mergeAccounts(TERM_DATA, FLEX_DATA, FIN_DATA);\n' +
    '    META = { lastUpdated: maxDate([TERM_DATA.lastUpdated, FLEX_DATA.lastUpdated, FIN_DATA.lastUpdated]) };\n' +
    '    boot(root);\n' +
    '  }\n\n' +
    '  if (document.readyState';
  return src.replace(initRe, embeddedInit);
}
const bodyEmbedded = withEmbeddedInit(body, 'EMBEDDED_DATA', 'EMBEDDED_FLEXIBLE_DATA', 'EMBEDDED_FINTECH_DATA');
const bodyEmbeddedFromWindow = withEmbeddedInit(
  body,
  'window.RT_EMBEDDED_DATA || {}',
  'window.RT_EMBEDDED_FLEXIBLE_DATA || {}',
  'window.RT_EMBEDDED_FINTECH_DATA || {}',
);

const embeddedDataLiteral =
  'var EMBEDDED_DATA = ' + JSON.stringify(data) + ';\n  ' +
  'var EMBEDDED_FLEXIBLE_DATA = ' + JSON.stringify(flexibleData) + ';\n  ' +
  'var EMBEDDED_FINTECH_DATA = ' + JSON.stringify(fintechData) + ';\n  ';

// The STYLES var + injectStyles() are always the LAST two statements in the
// IIFE body (see comparator.js), so everything from the styles comment
// onward can just be sliced off - far more robust than trying to regex-match
// a ~27KB CSS blob and a function body with nested braces (a previous, more
// "clever" regex silently failed to match and left the whole STYLES string
// in the generated nocss/webflow embed, blowing well past Webflow's 50,000
// character-per-embed limit without any error).
const STYLES_MARKER = '  /* ---------- styles (Rahatarkus tokens) ---------- */';
function stripStyles(src) {
  const idx = src.indexOf(STYLES_MARKER);
  if (idx === -1) throw new Error('Could not find styles marker to strip');
  return src.slice(0, idx).replace(/\n\s*injectStyles\(\);\n/, '\n').trimEnd() + '\n';
}

// Strips standalone comments (own-line `//...` and own-line `/* ... */`
// blocks - never a trailing inline comment, since comparator.js never
// writes those) to claw back headroom under Webflow's 50,000-char-per-embed
// cap. Only applied to the Webflow embed output; comparator.js and
// self-contained-test.html keep full comments for readability/debugging.
// Collapses the blank lines left behind so the result isn't full of gaps.
function stripComments(src) {
  return src
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\n{2,}/g, '\n');
}

const header =
  "/*\n" +
  " * Rahatarkus - Tähtajalise hoiuse võrdlus (savings account comparator)\n" +
  " * GENERATED by scripts/build-web.mjs from web/comparator.js + data/data.json.\n" +
  " * Do not edit this file directly - edit comparator.js/comparator.css/data.json\n" +
  " * and re-run `node scripts/build-web.mjs`.\n" +
  " */\n";

function wrapScript(bodyStr, withData) {
  return '(function () {\n\'use strict\';\n\n' + (withData ? embeddedDataLiteral : '') + bodyStr + '\n})();\n';
}

// A literal "</script" ANYWHERE inside a script's content - even inside a
// JS comment or string - ends that HTML <script> element right there; the
// HTML tokenizer does not know or care about JS syntax. Everything after it
// then renders as plain visible page text instead of running (this
// literally happened: an example snippet in a code comment,
// `// <script>...</script>`, silently truncated webflow-embed-nocss-2.html
// on every build). Every generated file gets checked here so that class of
// bug fails loudly instead of shipping silently.
function assertScriptTagsBalanced(html, filename) {
  const opens = (html.match(/<script(?:\s[^>]*)?>/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  if (opens !== closes) {
    throw new Error(
      filename + ': found ' + opens + ' <script> open tag(s) but ' + closes +
      ' </script> close sequence(s). A literal "</script" somewhere inside ' +
      'the script content (even in a comment or string) closes the tag early ' +
      'and dumps the rest of the file as visible page text - search for ' +
      '"</script" inside comparator.js and rewrite it so the sequence never ' +
      'appears literally (e.g. split it as \'</\' + \'script>\').'
    );
  }
}

// --- 4. web/webflow-embed-nocss-{1,2}.html: embedded data, NO css injection
//        (styles are pasted once into Webflow's page <head> via
//        webflow-head-css.html, generated in step 6). Split across two
//        Webflow HTML Embed blocks, pasted one after another, because a
//        single embed is capped at 50,000 characters and data + logic
//        together no longer fit in one (data alone already grows with every
//        bank/product added, so this split gives real headroom, not just a
//        today-sized fix).
//
//        Three product datasets (term/flexible/fintech) pushed the APP
//        logic itself over 50,000 characters on its own - even with data
//        already split out. The limit is per Webflow Embed BLOCK, not per
//        <script> tag though, so rather than asking for a third paste step,
//        embed 1 now carries a SECOND <script>: everything in comparator.js
//        that is pure model/data logic (formatting helpers, the rate model,
//        filter predicates, mergeAccounts()) with no dependency on `state`,
//        `ACCOUNTS`/`META` or the DOM. It exposes that as window.RT_MODEL.
//        Embed 2 keeps only the UI layer (rendering, event binding, boot),
//        destructuring what it needs off window.RT_MODEL at the top. This
//        split is found automatically (see MODEL_BOUNDARY below) precisely
//        so nobody has to hand-maintain an export list as the app grows. -
const oldSingleNocss = web('webflow-embed-nocss.html');
if (fs.existsSync(oldSingleNocss)) fs.unlinkSync(oldSingleNocss);

// Everything in the IIFE body from the top down to this comment is pure
// model/data logic with no dependency on `state`, `ACCOUNTS`/`META` or the
// DOM (verified by hand when this split was introduced - see the comment
// above). `state`/`ACCOUNTS`/`META` themselves are mutated throughout the UI
// layer (e.g. init() reassigns ACCOUNTS), so they - and everything that
// reads them - MUST live after this boundary: a variable destructured from
// window.RT_MODEL is a fresh binding, so reassigning it in the UI script
// would never be visible back in the model script. If a future change moves
// something across this line, keep that constraint in mind.
const MODEL_BOUNDARY = '  /* ---------- state ---------- */';
const uiSource = stripStyles(bodyEmbeddedFromWindow);
const boundaryIdx = uiSource.indexOf(MODEL_BOUNDARY);
if (boundaryIdx === -1) throw new Error('Could not find MODEL_BOUNDARY marker to split the embed at');
const modelRaw = uiSource.slice(0, boundaryIdx);
const uiRaw = uiSource.slice(boundaryIdx);

// Auto-detect every top-level (2-space-indented) `function name(` or
// `var name =` in the model chunk, so the export/import list can never
// silently drift from what the model chunk actually declares.
const topLevelNameRe = /^ {2}(?:function (\w+)\(|var (\w+)\s*=)/gm;
const modelNames = [];
for (const m of modelRaw.matchAll(topLevelNameRe)) {
  const name = m[1] || m[2];
  if (!modelNames.includes(name)) modelNames.push(name);
}

const modelBody = stripComments(modelRaw);
const uiBody = stripComments(uiRaw);

const modelScript =
  'window.RT_MODEL = (function () {\n\'use strict\';\n\n' + modelBody +
  '\n  return {' + modelNames.map((n) => ' ' + n + ': ' + n).join(',') + ' };\n})();\n';

const nocssDataHtml =
  '<!-- Embed 1 of 2. Paste this HTML Embed block FIRST, then webflow-embed-nocss-2.html right after it. -->\n' +
  '<script>\n' + header +
  'window.RT_EMBEDDED_DATA = ' + JSON.stringify(data) + ';\n' +
  'window.RT_EMBEDDED_FLEXIBLE_DATA = ' + JSON.stringify(flexibleData) + ';\n' +
  'window.RT_EMBEDDED_FINTECH_DATA = ' + JSON.stringify(fintechData) + ';\n' +
  '</script>\n' +
  '<script>\n' + header + modelScript + '</script>\n';
assertScriptTagsBalanced(nocssDataHtml, 'webflow-embed-nocss-1.html');
fs.writeFileSync(web('webflow-embed-nocss-1.html'), nocssDataHtml);
console.log('webflow-embed-nocss-1.html (data + model): ' + nocssDataHtml.length + ' chars');

const uiPreamble =
  '  var RT_MODEL_NS = window.RT_MODEL || {};\n' +
  '  var ' + modelNames.map((n) => n + ' = RT_MODEL_NS.' + n).join(', ') + ';\n\n';
const nocssAppScript = '(function () {\n\'use strict\';\n\n' + uiPreamble + uiBody + '\n})();\n';
const nocssAppHtml =
  '<!-- Embed 2 of 2. Paste right after webflow-embed-nocss-1.html (which must run first). -->\n' +
  '<div id="rt-hoius"></div>\n' +
  '<script>\n' + header + nocssAppScript + '</script>\n';
assertScriptTagsBalanced(nocssAppHtml, 'webflow-embed-nocss-2.html');
fs.writeFileSync(web('webflow-embed-nocss-2.html'), nocssAppHtml);
console.log('webflow-embed-nocss-2.html (app): ' + nocssAppHtml.length + ' chars');
console.log('  (' + modelNames.length + ' names exported from model layer)');

for (const [name, len] of [['webflow-embed-nocss-1.html', nocssDataHtml.length], ['webflow-embed-nocss-2.html', nocssAppHtml.length]]) {
  if (len > 50000) console.warn('WARNING: ' + name + ' is ' + len + ' chars, over Webflow\'s 50,000 limit.');
}

// --- 5. web/self-contained-test.html: embedded data + full CSS, wrapped --
//        in a standalone HTML page for opening straight from disk. -------
const selfScript = wrapScript(bodyEmbedded, true);
const selfHtml = `<!DOCTYPE html>
<html lang="et">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#fcfcfd;font-family:Inter,system-ui,sans-serif}.wrap{max-width:1220px;margin:0 auto;padding:2rem 1.25rem 5rem}.hero{max-width:48rem;margin-bottom:1.5rem}.hero h1{font-family:Georgia,serif;font-weight:400;font-size:3rem;line-height:1.15;margin:0 0 .75rem;color:#081c15}.hero p{color:#3a4454;font-size:1.125rem;margin:0}.note{background:#eff4ff;border:1px solid #d1e0ff;color:#155eef;padding:.625rem .875rem;border-radius:12px;font-size:.8125rem;margin-bottom:1.5rem}</style>
</head>
<body>
<div class="wrap">
<div class="note">Test: andmed koodi sees, serverit pole vaja.</div>
<header class="hero"><h1>Parim tähtajaline hoius ja kogumiskonto</h1><p>Näe ühest kohast kõigi Eesti pankade, kogumiskontode ja usaldusväärsete platvormide intressimäärasid, filtreeri sulle sobivate tingimuste järgi ja arvuta kalkulaatoriga, kui palju sinu raha tegelikult teeniks.</p></header>
<div id="rt-hoius"></div>
<script>
${header}${selfScript}</script>
</div>
</body>
</html>
`;
assertScriptTagsBalanced(selfHtml, 'self-contained-test.html');
fs.writeFileSync(web('self-contained-test.html'), selfHtml);
console.log('self-contained-test.html: regenerated (' + Math.round(selfHtml.length / 1024) + ' KB)');

// --- 6. web/webflow-head-css.html: just the CSS, wrapped in <style> ------
fs.writeFileSync(web('webflow-head-css.html'), '<style>\n' + css + '\n</style>\n');
console.log('webflow-head-css.html: regenerated');

console.log('\nDone. web/webflow-loader.html (jsDelivr + live fetch) needs no regeneration.');
