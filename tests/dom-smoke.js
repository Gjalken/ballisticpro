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
  // Minimal static server so jsdom has a real http origin (localStorage needs one)
  const http = require('http');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', e => errors.push(String(e)));

  const dom = await JSDOM.fromURL(base, {
    runScripts: 'dangerously', resources: 'usable',
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

  console.log(`\n${passed} passed, ${failed} failed`);
  w.close(); server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
