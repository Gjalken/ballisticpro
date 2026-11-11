/**
 * DOM smoke test (jsdom): boots the real index.html + js/app.js, runs a calculation, and
 * checks the UI-level fixes. Canvas and Chart.js are stubbed (no rendering needed).
 *   node tests/dom-smoke.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.log('  ✗', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROPS = new Set(['fillStyle', 'strokeStyle', 'font', 'textAlign', 'textBaseline', 'lineWidth', 'lineCap',
  'lineJoin', 'globalAlpha', 'globalCompositeOperation', 'shadowBlur', 'shadowColor', 'lineDashOffset']);
const noopCtx = new Proxy({}, {
  get: (t, p) => {
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (p === 'canvas') return {};
    return PROPS.has(p) ? t[p] : () => {};
  },
  set: (t, p, v) => { t[p] = v; return true; }
});

(async () => {
  const base = 'http://127.0.0.1/';
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', e => errors.push(String(e)));

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<script\s+src="([^"]+)"><\/script>/g, (_, s) => {
      const code = fs.readFileSync(path.join(ROOT, s.split('?')[0]), 'utf8');
      return '<script>' + code.replace(/<\/script>/gi, '<\\/script>') + '</script>';
    });
  const dom = new JSDOM(indexHtml, {
    url: base, contentType: 'text/html',
    runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => noopCtx;
      w.Chart = class { constructor() {} destroy() {} update() {} };
      w.alert = m => errors.push('alert: ' + m);
      w.fetch = async (u) => {
        const body = fs.readFileSync(path.join(ROOT, String(u).split('?')[0].replace(base, '')), 'utf8');
        return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
      };
    }
  });
  const w = dom.window;
  await sleep(800);                                            // DOMContentLoaded + async DB loading
  w.Chart = class { constructor() {} destroy() {} update() {} };   // real chart.js loaded; replace it by a stub
  const $ = id => w.document.getElementById(id);
  const ev = code => w.eval(code);

  console.log('\nBoot');
  ok(errors.length === 0, 'no script errors on load' + (errors.length ? ' → ' + errors[0] : ''));
  ok(!/unregister|caches\.delete/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'index.html no longer wipes service worker / caches');
  ok(ev('appState.weaponsDB.length') > 0 && ev('appState.gameAnimalsDB.length') > 0, 'databases loaded');

  console.log('\nInputs (units + zero handling)');
  $('temperature').value = '0';                                // imperial default → 0 °F
  let cfg = ev('gatherInputs()');
  ok(Math.abs(cfg.atmo.tempC - (-17.78)) < 0.05, `0 °F is kept as 0 °F (${cfg.atmo.tempC.toFixed(2)} °C), not replaced by 15`);
  $('pressure').value = '';
  cfg = ev('gatherInputs()');
  ok(Math.abs(cfg.atmo.pressureHpa - 1013.2) < 0.5, `blank pressure in imperial → 29.92 inHg (${cfg.atmo.pressureHpa.toFixed(1)} hPa), not 1013 inHg`);
  $('pressure').value = '29.92'; $('temperature').value = '59';
  $('muzzleVel').value = '';
  cfg = ev('gatherInputs()');
  ok(Math.abs(cfg.muzzleVelMps - 2600 * 0.3048) < 0.01, 'blank muzzle velocity → 2600 fps default');
  $('muzzleVel').value = '2600';

  console.log('\nCalculation + rendering');
  ev('calculate()'); await sleep(400);
  const nRows = ev('appState.results.length');
  ok(nRows === 41, `results table has 41 rows incl. maxRange (got ${nRows})`);
  ok($('rangeCardBody').querySelectorAll('tr').length === nRows, 'range card renders every row');
  ok(/Supers|Transón|Subsón|E final/.test($('ballisticAlerts').textContent), 'ballistic alerts rendered via i18n');
  ev('I18n.setLang("en"); renderBallisticAlerts(appState.results)');
  ok(/Supersonic|Transonic|Subsonic|E final/.test($('ballisticAlerts').textContent), 'alerts follow the language (EN)');
  ev('I18n.setLang("es")');

  console.log('\nReticle view');
  ev("document.getElementById('reticleTargetDist').value = '300'; updateReticleView()");
  await sleep(100);
  const fs1 = ev('appState.results.some(x => Math.abs(x.rangeM - 300) < 12)');
  ok(fs1, 'a result row near 300 m exists');
  ok($('firingSolution').innerHTML.includes('sol-item'), 'firing solution panel rendered');
  ok(errors.length === 0, 'no errors while rendering reticle' + (errors.length ? ' → ' + errors[errors.length - 1] : ''));

  console.log('\nMag slider follows the selected scope');
  const idx = ev("appState.scopesDB.findIndex(s => s.magMax < 24)");
  if (idx >= 0) {
    ev(`document.getElementById('scopeSelect').value='${idx}'; onScopeSelect();`);
    const max = parseFloat($('reticleMagSlider').max), want = ev(`appState.scopesDB[${idx}].magMax`);
    ok(max === want, `slider max = scope max (${max} = ${want}), not 24`);
  }

  console.log('\nAmmo list is filtered by the weapon calibre');
  const optionCals = () => ev(`(() => { const t = document.getElementById('weaponType').value; const L = t === 'airgun' ? appState.projectilesDB.airgun : appState.projectilesDB.firearms; return Array.from(document.getElementById('projSelect').options).filter(o => o.value !== 'custom').map(o => L[+o.value].cal); })()`);
  ev(`document.getElementById('caliberSelect').value = 'Weatherby Vanguard S2 .300 Win Mag'; onWeaponSelect();`);
  let cals = optionCals();
  ok(cals.length > 0 && cals.every(c => c === '.300WM'), `.300 Win Mag rifle offers ONLY .300WM loads (${cals.length}: ${[...new Set(cals)].join(',')})`);
  ev(`document.getElementById('caliberSelect').value = 'Mossberg 100 ATR .308 Win'; onWeaponSelect();`);
  cals = optionCals();
  ok(cals.length > 0 && cals.every(c => c === '.308'), `.308 rifle offers ONLY .308 loads (${cals.length}: ${[...new Set(cals)].join(',')})`);
  ok(ev(`appState.projectilesDB.firearms[+document.getElementById('projSelect').value].name`) === 'Winchester Power Point .308 180gr', 'default ammo of the weapon is selected');
  ev(`document.getElementById('caliberSelect').value = 'Savage Mark II .22 LR'; onWeaponSelect();`);
  cals = optionCals();
  const lr22Names = ev(`Array.from(document.getElementById('projSelect').options).filter(o => o.value !== 'custom').map(o => appState.projectilesDB.firearms[+o.value].name)`);
  ok(cals.length > 0 && cals.every(c => c === '.22LR'), `Savage Mark II .22 LR offers ONLY .22LR loads (${cals.length})`);
  ok(lr22Names.includes('Remington Thunderbolt .22 LR 40gr LRN') && lr22Names.includes('Remington Golden Bullet .22 LR 36gr HP'), 'both Remington .22 LR loads (Thunderbolt 40gr LRN & Golden Bullet 36gr HP) are available');
  ev(`document.getElementById('caliberSelect').value = 'custom'; onWeaponSelect();`);
  cals = optionCals();
  ok(new Set(cals).size > 1 && $('projSelect').querySelectorAll('optgroup').length > 1, 'custom weapon shows every calibre, grouped');
  ev(`document.getElementById('weaponType').value = 'airgun'; onWeaponTypeChange();`);
  ev(`document.getElementById('caliberSelect').value = 'SAG AR1000 .22 (5.5mm)'; onWeaponSelect();`);
  cals = optionCals();
  ok(cals.length > 0 && cals.every(c => c === '.22'), `.22 airgun offers ONLY .22 pellets/slugs (${cals.length})`);
  ev(`document.getElementById('weaponType').value = 'firearm'; onWeaponTypeChange();`);
  // preset round-trip keeps the weapon + its filtered ammo
  ev(`document.getElementById('caliberSelect').value = 'Weatherby Vanguard S2 .300 Win Mag'; onWeaponSelect();`);
  const idx300 = ev(`appState.projectilesDB.firearms.findIndex(p => p.cal === '.300WM')`);
  ev("document.getElementById('projSelect').value = '" + idx300 + "'");
  const snap = ev('_capturePreset()');
  ev(`document.getElementById('caliberSelect').value = 'custom'; onWeaponSelect();`);
  w.__snap = snap; ev('_restorePreset(window.__snap)');
  ok($('caliberSelect').value === 'Weatherby Vanguard S2 .300 Win Mag' && $('projSelect').value === String(idx300), 'preset restore re-selects the weapon and its ammo');

  console.log('\nDOPE log escapes HTML');
  ev(`DOPE.clearAll(); DOPE.add({date:'2026-01-01',weapon:'<img src=x onerror=alert(1)>',ammo:'a',scope:'s',distance:100,distUnit:'m',temp:'5',pressure:'1',humidity:'1',windSpeed:'0',windDir:'0',elevClicks:1,windClicks:1,elevMoa:1,windMoa:1,calcDropMoa:'1',calcWindMoa:'1',groupSize:1,poiResult:'center',notes:'<script>1</script>'}); renderDopeLog();`);
  ok($('dopeTableBody').querySelector('img') === null && $('dopeTableBody').querySelector('script') === null, 'injected markup is not parsed as HTML');
  ok($('dopeTableBody').textContent.includes('<img src=x'), 'text is shown literally');

  console.log('\nMPBR (was ~4.5 s of main-thread blocking)');
  const t0 = Date.now();
  ev('calculateMPBR()'); await sleep(300);
  const dt = Date.now() - t0;
  ok(ev('!!appState.mpbrResult'), `MPBR finished (${dt} ms incl. 50 ms UI delay)`);

  console.log('\nCartilla de Caza SAG (Ley 19.473)');
  ev('openHuntingLaw()');
  const allCards = $('huntingLawList').querySelectorAll('.hl-species-card').length;
  const allPngImages = $('huntingLawList').querySelectorAll('.hl-species-card svg image').length;
  const hasTargetFallback = Array.from($('reticleSilhouetteSelect').options).some(o => o.textContent.includes('🎯'));
  ok($('huntingLawModal').style.display === 'flex' && allCards === 45 && allPngImages === 45, `Cartilla opens and renders all 45 Chilean species using real PNG silhouettes in img/silhouettes/*.png (got ${allCards}/${allPngImages})`);
  ok(!hasTargetFallback && ev(`_getAnimalEmoji({id:'castor'})`) === '🦫' && ev(`_getAnimalEmoji({id:'rata_almizclera'})`) === '🐀' && ev(`_getAnimalEmoji({id:'vison'})`) === '🦦', 'Castor (🦫), Rata almizclera (🐀), Visón (🦦) and all species have specific icons (zero 🎯 fallbacks)');
  ev(`document.getElementById('hlZoneSelect').value = 'Norte'; renderHuntingLawCartilla();`);
  const norteCards = $('huntingLawList').querySelectorAll('.hl-species-card').length;
  ok(norteCards > 0 && norteCards < allCards, `Zone filter 'Norte' filters to species allowed in Zona Norte (${norteCards} of ${allCards})`);
  ev(`document.getElementById('hlZoneSelect').value = 'all'; document.getElementById('hlSearchInput').value = 'tórtola'; renderHuntingLawCartilla();`);
  const tortolaCards = $('huntingLawList').querySelectorAll('.hl-species-card').length;
  ok(tortolaCards >= 2, `Search filter 'tórtola' finds matching species (${tortolaCards})`);
  ev(`selectAnimalFromCartilla('tortola')`);
  await sleep(150);
  ok($('gameAnimalSelect').value === 'tortola' && $('mpbrModal').style.display === 'flex', `selectAnimalFromCartilla('tortola') loads Tórtola into MPBR and opens MPBR modal`);

  console.log('\nHunting Season Date Detection (In-Season vs Out-of-Season)');
  const RealDate = w.Date;
  const mockDate = iso => {
    const fixed = new RealDate(iso).getTime();
    w.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
  };
  mockDate('2026-11-01T12:00:00');
  ev(`onGameAnimalChange(); updateReticleView(); renderHuntingLawCartilla();`);
  ok($('gameAnimalSeasonBanner').textContent.includes('FUERA DE TEMPORADA') && $('ballisticAlerts').textContent.includes('FUERA DE TEMPORADA') && $('firingSolution').textContent.includes('FUERA DE TEMPORADA'), 'Tórtola in November triggers ⛔ FUERA DE TEMPORADA warning in MPBR modal, main alerts bar, and Reticle firing solution');
  ev(`document.getElementById('hlSearchInput').value = ''; document.getElementById('hlStatusSelect').value = 'open_now'; renderHuntingLawCartilla();`);
  const novOpenCount = $('huntingLawList').querySelectorAll('.hl-species-card').length;
  mockDate('2026-06-15T12:00:00');
  ev(`onGameAnimalChange(); renderHuntingLawCartilla();`);
  const junOpenCount = $('huntingLawList').querySelectorAll('.hl-species-card').length;
  ok($('gameAnimalSeasonBanner').textContent.includes('EN TEMPORADA') && novOpenCount === 19 && junOpenCount === 45, `Season calendar accurately distinguishes November (${novOpenCount} open) vs June (${junOpenCount} open, Tórtola EN TEMPORADA)`);
  w.Date = RealDate;

  console.log('\n22 Species Silhouettes Integration');
  ok(ev('Silhouettes.TYPES.length') === 22, 'Silhouettes.TYPES registers all 22 target silhouettes');
  ev(`document.getElementById('hlStatusSelect').value = 'all'; document.getElementById('hlZoneSelect').value = 'all'; renderHuntingLawCartilla();`);
  const speciesTypeMap = {
    canquen: 'goose', caiquen: 'goose', tagua: 'coot', tagua_chica: 'coot',
    yeco: 'cormorant', codorniz: 'quail', perdiz_chilena: 'partridge',
    faisan: 'pheasant', pavo_salvaje: 'pheasant', traro: 'raptor',
    cotorra: 'parrot', zorzal: 'songbird', vison: 'mink',
    castor: 'beaver', rata_almizclera: 'muskrat'
  };
  const allMappedOk = Object.entries(speciesTypeMap).every(([id, want]) => {
    const a = ev(`appState.gameAnimalsDB.find(x => x.id === '${id}')`);
    if (!a || a.silhouetteType !== want) return false;
    if (a.region !== 'CL') return true;
    const btn = w.document.querySelector(`[data-select-animal="${id}"]`);
    const card = btn ? btn.closest('.hl-species-card') : null;
    const imgHref = card && card.querySelector('svg image') ? (card.querySelector('svg image').getAttribute('href') || '') : '';
    return imgHref.includes(`img/silhouettes/${want}.png`);
  });
  ok(allMappedOk, 'Canquén & Caiquén use goose.png (not duck.png) and all new species render their dedicated PNG silhouette');

  console.log('\nSecurity Hardening (CSP, zero inline JS, XSS & DB sanitization)');
  const rawHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const rawCss = fs.readFileSync(path.join(ROOT, 'css/main.css'), 'utf8');
  const rawApp = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const cspMeta = w.document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  ok(cspMeta && /script-src 'self'/.test(cspMeta.content) && /font-src 'self'/.test(cspMeta.content) && /object-src 'none'/.test(cspMeta.content), 'strict Content-Security-Policy meta tag present');
  ok(!/\bon[a-z]+\s*=/i.test(rawHtml) && w.document.querySelectorAll('[onclick],[onchange],[oninput]').length === 0, 'zero inline event handler attributes in index.html and live DOM');
  ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(rawCss) && /fonts\/inter-latin\.woff2/.test(rawCss), '100% local WOFF2 fonts (zero external Google Fonts leakage)');
  ok(!/__ballisticTestDate/.test(rawApp), 'production app.js contains zero __ballisticTestDate global test hooks');

  // Delegated DOPE delete with crafted ID must not execute JS
  ev(`DOPE.clearAll(); localStorage.setItem('ballisticpro_dope', JSON.stringify([{id: "'); alert('xss'); //", timestamp: 1, date: '2026-01-01', weapon: 'w', ammo: 'a', scope: 's', distance: 100}])); renderDopeLog();`);
  const delBtn = $('dopeTableBody').querySelector('[data-delete-dope]');
  ok(!!delBtn, 'crafted DOPE id rendered via data-delete-dope attribute');
  delBtn.click();
  ok(ev('DOPE.getAll().length') === 0 && errors.length === 0, 'clicking delegated delete removes crafted DOPE entry without XSS execution');

  // Remote update URL allowlist + schema sanitizer
  ok(ev(`_isAllowedUpdateUrl('http://gjalken.github.io/a.json') === false && _isAllowedUpdateUrl('https://evil.example.com/a.json') === false && _isAllowedUpdateUrl('https://gjalken.github.io/ballisticpro/js/data/game-animals.json') === true`), '_isAllowedUpdateUrl enforces HTTPS and trusted GitHub origins');
  const sanitizedCheck = ev(`(() => {
    const rejected = _sanitizeGameAnimalsPayload({
      meta: { lastUpdated: '2026-11' },
      animals: [{ id: '<script>bad</script>', nameEs: 'Bad', vitalZoneCm: 10 }]
    });
    const clean = _sanitizeGameAnimalsPayload({
      meta: { lastUpdated: '2026-11', updateUrl: 'http://evil.example/a.json' },
      animals: [{ id: 'ciervo_test', nameEs: 'Ciervo Test', vitalZoneCm: 25, silhouetteType: '../../etc/passwd', status: 'javascript:alert(1)' }]
    });
    return rejected === null && clean && clean.animals.length === 1 && clean.animals[0].silhouetteType === 'generic' && clean.animals[0].status === 'regulada' && !clean.meta.updateUrl;
  })()`);
  ok(sanitizedCheck, '_sanitizeGameAnimalsPayload rejects poisoned IDs and neutralizes untrusted silhouetteType / status / updateUrl');

  console.log(`\n${passed} passed, ${failed} failed`);
  w.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
