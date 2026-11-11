/**
 * BallisticPro — Main Application Logic
 */
// Shadow parseFloat to support comma as decimal separator (common in Spanish locale)
const parseFloat = (orig => {
  return function(val) {
    if (typeof val === 'string') {
      val = val.replace(',', '.');
    }
    return orig(val);
  };
})(window.parseFloat);

let appState = {
  units: 'imperial',
  lang: 'es',
  results: null,
  charts: { trajectory: null, velEnergy: null, mpbr: null },
  projectilesDB: { firearms: [], airgun: [] },
  weaponsDB: [],
  scopesDB: [],
  reticlesDB: [],
  currentScope: null,
  currentReticle: null,
  truingMVResult: null,
  truingBCResult: null,
  mpbrResult: null,
  gameAnimalsDB: [],
  gameAnimalsDBMeta: null,
  pcpTune: null  // { v0Fps, baseWeightGr } — for dynamic V0 recalculation
};

/** Read a numeric input. Unlike `parseFloat(v) || def`, a legitimate 0 (e.g. 0 °C) is kept. */
function num(id, def) {
  const el = document.getElementById(id);
  const v = el ? parseFloat(el.value) : NaN;
  return Number.isFinite(v) ? v : def;
}

/** Escape text before inserting it into innerHTML (DOPE notes, regulation text…). */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [fRes, aRes, wRes, sRes, rRes] = await Promise.all([
      fetch('js/data/projectiles-firearms.json'),
      fetch('js/data/projectiles-airgun.json'),
      fetch('js/data/weapons.json'),
      fetch('js/data/scopes.json'),
      fetch('js/data/reticles.json')
    ]);
    const fData = await fRes.json();
    const aData = await aRes.json();
    const wData = await wRes.json();
    const sData = await sRes.json();
    const rData = await rRes.json();
    appState.projectilesDB.firearms = fData.firearms || [];
    appState.projectilesDB.airgun = aData.airgun || [];
    appState.weaponsDB = wData.weapons || [];
    appState.scopesDB = sData.scopes || [];
    appState.reticlesDB = rData.reticles || [];
    // Load game animals database (prefer localStorage if newer)
    try {
      const gRes = await fetch('js/data/game-animals.json');
      const gData = await gRes.json();
      let bundled = gData;
      // Check localStorage for updated data
      try {
        const cached = localStorage.getItem('gameAnimalsDB');
        if (cached) {
          const sanitized = _sanitizeGameAnimalsPayload(JSON.parse(cached));
          if (!sanitized) {
            localStorage.removeItem('gameAnimalsDB');
          } else if (sanitized.meta.lastUpdated > gData.meta.lastUpdated) {
            bundled = sanitized;
            console.log('Using cached game animals DB:', sanitized.meta.lastUpdated);
          } else {
            // Bundled DB is equal or newer — clear stale cache so updated silhouettes/rules apply
            localStorage.removeItem('gameAnimalsDB');
          }
        }
      } catch (e) { localStorage.removeItem('gameAnimalsDB'); }
      appState.gameAnimalsDB = bundled.animals || [];
      appState.gameAnimalsDBMeta = bundled.meta || null;
    } catch (e) { console.warn('Could not load game animals DB:', e); }
  } catch (e) { console.warn('Could not load databases:', e); }

  populateWeaponSelect();
  populateProjectileSelect();
  populateScopeSelect();
  updateAtmoDisplay();
  updateWindDisplay();
  initReticleView();
  populateGameAnimalSelect();
  populateReticleSilhouetteSelect();

  document.getElementById('btnLang').addEventListener('click', () => {
    appState.lang = appState.lang === 'es' ? 'en' : 'es';
    I18n.setLang(appState.lang);
    I18n.updateDOM();
    if (document.getElementById('huntingLawModal')?.style.display === 'flex') {
      renderHuntingLawCartilla();
    }
  });

  document.getElementById('btnUnits').addEventListener('click', () => {
    appState.units = appState.units === 'imperial' ? 'metric' : 'imperial';
    updateUnitsDisplay();
    if (document.getElementById('huntingLawModal')?.style.display === 'flex') {
      renderHuntingLawCartilla();
    }
  });

  document.getElementById('btnTruing').addEventListener('click', openTruing);
  const btnHL = document.getElementById('btnHuntingLaw');
  if (btnHL) btnHL.addEventListener('click', openHuntingLaw);

  // Sidebar collapsible panel headers (CSP-safe: zero inline onclick)
  document.querySelectorAll('.panel > .panel-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const panel = hdr.closest('.panel');
      if (panel && panel.id) togglePanel(panel.id);
    });
  });

  // Presets, weapon, optics, projectile, position, wind & calculate controls
  const bind = (id, evName, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evName, fn);
  };
  bind('presetSelect', 'change', onPresetLoad);
  bind('btnPresetSave', 'click', onPresetSave);
  bind('btnPresetDelete', 'click', onPresetDelete);
  bind('weaponType', 'change', onWeaponTypeChange);
  bind('caliberSelect', 'change', onWeaponSelect);
  bind('scopeSelect', 'change', onScopeSelect);
  bind('reticleType', 'change', onReticleChange);
  bind('projSelect', 'change', onProjectileSelect);
  bind('btnLatHemi', 'click', toggleLatSign);
  bind('windClock', 'change', onWindClockChange);
  bind('btnCalculate', 'click', calculate);

  // Results tabs & Hunting Law tab shortcut
  document.querySelectorAll('.results-tabs .tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
  });
  bind('btnTabHuntingLaw', 'click', openHuntingLaw);

  // DOPE actions & delegated delete button handler
  bind('btnDopeAdd', 'click', toggleDopeForm);
  bind('btnDopeExport', 'click', exportDOPE);
  bind('btnDopeClear', 'click', clearDOPE);
  bind('btnDopeAutoFill', 'click', autoFillDope);
  bind('btnDopeSave', 'click', saveDope);
  const dopeBody = document.getElementById('dopeTableBody');
  if (dopeBody) {
    dopeBody.addEventListener('click', e => {
      const btn = e.target.closest('[data-delete-dope]');
      if (btn) deleteDope(btn.dataset.deleteDope);
    });
  }

  // Truing modal controls
  bind('btnCloseTruing', 'click', closeTruing);
  bind('btnRunTruingMV', 'click', runTruingMV);
  bind('btnApplyMV', 'click', applyTruingMV);
  bind('btnRunTruingBC', 'click', runTruingBC);
  bind('btnApplyBC', 'click', applyTruingBC);

  // MPBR modal controls
  bind('btnCloseMPBR', 'click', closeMPBR);
  bind('gameAnimalSelect', 'change', onGameAnimalChange);
  bind('btnOpenCartillaFromMPBR', 'click', openHuntingLaw);
  bind('btnUpdateDB', 'click', updateGameAnimalsDB);
  bind('btnCalcMPBR', 'click', calculateMPBR);
  bind('btnApplyMPBRZero', 'click', applyMPBRZero);

  // Hunting Law Cartilla modal controls & delegated species selector
  bind('btnCloseHuntingLaw', 'click', closeHuntingLaw);
  bind('hlZoneSelect', 'change', renderHuntingLawCartilla);
  bind('hlCatSelect', 'change', renderHuntingLawCartilla);
  bind('hlStatusSelect', 'change', renderHuntingLawCartilla);
  bind('hlSearchInput', 'input', renderHuntingLawCartilla);
  const hlList = document.getElementById('huntingLawList');
  if (hlList) {
    hlList.addEventListener('click', e => {
      const btn = e.target.closest('[data-select-animal]');
      if (btn) selectAnimalFromCartilla(btn.dataset.selectAnimal);
    });
  }

  // Reticle view controls
  document.getElementById('reticleMagSlider').addEventListener('input', (e) => {
    const mag = parseFloat(e.target.value);
    document.getElementById('reticleMagValue').textContent = mag + 'x';
    ReticleView.setMagnification(mag);
    updateReticleView();
  });
  document.getElementById('reticleTargetDist').addEventListener('change', updateReticleView);
  document.getElementById('showSilhouette').addEventListener('change', (e) => {
    ReticleView.setShowSilhouette(e.target.checked);
    updateReticleView();
  });
  document.getElementById('showDotDist').addEventListener('change', (e) => {
    ReticleView.setShowDotDistances(e.target.checked);
    updateReticleView();
  });
  document.getElementById('extendedRange').addEventListener('change', (e) => {
    ReticleView.setExtendedRange(e.target.checked);
    updateReticleView();
    // Show clicks needed for 5 MIL turret adjustment
    const clicksSpan = document.getElementById('extRangeClicks');
    if (e.target.checked) {
      const scope = getScopeProfile();
      // 5 MIL = 5 * 3.43775 MOA = 17.19 MOA
      const moaFor5Mil = 5 * 3.43775;
      const clickVal = scope.clickElev || 0.25; // MOA per click
      const clicks = Math.round(moaFor5Mil / clickVal);
      clicksSpan.textContent = `↑ ${clicks} clicks`;
      clicksSpan.style.display = 'inline';
    } else {
      clicksSpan.style.display = 'none';
    }
  });
  document.getElementById('rangeEstSize').addEventListener('input', updateRangeEstimate);
  document.getElementById('rangeEstMils').addEventListener('input', updateRangeEstimate);
  document.getElementById('truingDist1').addEventListener('change', updateTruingPredictions);
  document.getElementById('truingDist2').addEventListener('change', updateTruingPredictions);

  // MPBR
  document.getElementById('btnMPBR').addEventListener('click', openMPBR);
  document.getElementById('mpbrVitalDiameter').addEventListener('input', () => {
    const d = parseFloat(document.getElementById('mpbrVitalDiameter').value) || 8;
    const u = appState.units === 'metric' ? 'cm' : 'in';
    document.getElementById('mpbrRadiusDisp').textContent = (d / 2).toFixed(1) + ' ' + u;
  });

  ['temperature', 'pressure', 'humidity', 'altitude'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateAtmoDisplay);
  });

  ['windSpeed', 'windDir'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateWindDisplay);
  });

  ['magMin', 'magMax', 'magRef'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => updateReticleMagSliderLimits(false));
  });

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('btnInstall').style.display = '';
    document.getElementById('btnInstall').addEventListener('click', () => {
      deferredPrompt.prompt();
    });
  });

  // Offline support: the service worker pre-caches the app so it opens with no signal.
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); }
    catch (e) { console.warn('Service worker registration failed:', e); }
  }
  // Ask the browser not to evict our data (DOPE log, presets) under storage pressure.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
});

function togglePanel(id) {
  document.getElementById(id).classList.toggle('collapsed');
}

/** Toggle latitude sign (N/S hemisphere) — mobile-friendly negative input */
function toggleLatSign() {
  const inp = document.getElementById('latitude');
  const btn = document.getElementById('btnLatHemi');
  let val = parseFloat(inp.value) || 0;
  val = -val;
  inp.value = val;
  btn.textContent = val < 0 ? 'S' : 'N';
}

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(tb => tb.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  if (btn) btn.classList.add('active');
  // Render DOPE log when switching to that tab
  if (tabId === 'tabDOPE') renderDopeLog();
  // Resize and update reticle canvas when switching to reticle tab
  if (tabId === 'tabReticle') {
    ReticleView.resize();
    updateReticleView();
  }
}

function onWeaponTypeChange() {
  const type = document.getElementById('weaponType').value;
  const isAirgun = type === 'airgun';
  appState.pcpTune = null; // Reset dynamic V0 tune on type change
  if (isAirgun) {
    document.getElementById('twistRate').value = '16';
    document.getElementById('scopeHeight').value = '1.5';
    document.getElementById('zeroRange').value = '30';
    document.getElementById('muzzleVel').value = '900';
    document.getElementById('maxRange').value = '100';
    document.getElementById('rangeStep').value = '5';
    document.getElementById('dragModel').value = 'GA';
    document.getElementById('projWeight').value = '18.13';
    document.getElementById('projDiam').value = '0.217';
    document.getElementById('projLength').value = '0.300';
    document.getElementById('projBC').value = '0.035';
  } else {
    document.getElementById('twistRate').value = '10';
    document.getElementById('scopeHeight').value = '1.5';
    document.getElementById('zeroRange').value = '100';
    document.getElementById('muzzleVel').value = '2600';
    document.getElementById('maxRange').value = '1000';
    document.getElementById('rangeStep').value = '25';
    document.getElementById('dragModel').value = 'G7';
    document.getElementById('projWeight').value = '175';
    document.getElementById('projDiam').value = '0.308';
    document.getElementById('projLength').value = '1.24';
    document.getElementById('projBC').value = '0.264';
  }
  populateWeaponSelect();
  populateProjectileSelect();
}

// ─── Weapon Select ───
function populateWeaponSelect() {
  const type = document.getElementById('weaponType').value;
  const sel = document.getElementById('caliberSelect');
  const list = appState.weaponsDB.filter(w => w.type === type);
  sel.innerHTML = `<option value="custom">${I18n.t('custom')}</option>`;
  list.forEach((w, i) => {
    const opt = document.createElement('option');
    opt.value = w.name;
    opt.textContent = w.name;
    sel.appendChild(opt);
  });
}

function onWeaponSelect() {
  const selVal = document.getElementById('caliberSelect').value;
  // Re-filter the ammunition list for this weapon's calibre (or show all for "custom")
  populateProjectileSelect();
  if (selVal === 'custom') { appState.pcpTune = null; return; }
  const w = appState.weaponsDB.find(x => x.name === selVal);
  if (!w) return;
  const m = appState.units === 'metric';

  // Fill weapon fields — JSON values are ALWAYS in imperial, convert if metric
  document.getElementById('twistRate').value = m ? (w.twistRateIn * 25.4).toFixed(1) : w.twistRateIn;
  document.getElementById('twistDir').value = w.twistDir;
  document.getElementById('scopeHeight').value = m ? (w.scopeHeightIn * 2.54).toFixed(2) : w.scopeHeightIn;
  document.getElementById('zeroRange').value = m ? Math.round(w.zeroRangeYd * 0.9144) : w.zeroRangeYd;
  if (w.maxRangeM || w.maxRangeYd) {
    document.getElementById('maxRange').value = m ? (w.maxRangeM || Math.round(w.maxRangeYd * 0.9144)) : (w.maxRangeYd || Math.round(w.maxRangeM / 0.9144));
  }
  if (w.stepM || w.stepYd) {
    document.getElementById('rangeStep').value = m ? (w.stepM || Math.round(w.stepYd * 0.9144)) : (w.stepYd || Math.round(w.stepM / 0.9144));
  }

  // Fill optics if available in weapon profile
  if (w.clickElev) document.getElementById('clickElev').value = w.clickElev;
  if (w.clickWind) document.getElementById('clickWind').value = w.clickWind;
  if (w.magMin) document.getElementById('magMin').value = w.magMin;
  if (w.magMax) document.getElementById('magMax').value = w.magMax;
  if (w.magRef) document.getElementById('magRef').value = w.magRef;
  if (w.focalPlane) document.getElementById('focalPlane').value = w.focalPlane;

  // Try to auto-select matching ammo
  if (w.defaultAmmo) {
    const type = document.getElementById('weaponType').value;
    const list = type === 'airgun' ? appState.projectilesDB.airgun : appState.projectilesDB.firearms;
    const ammoIdx = list.findIndex(p => p.name === w.defaultAmmo);
    if (ammoIdx >= 0) {
      document.getElementById('projSelect').value = ammoIdx;
      onProjectileSelect();
      // Set muzzle velocity: ammo-specific first, then weapon default
      const ammo = list[ammoIdx];
      const velFps = ammo.muzzleVelFps || w.defaultVelFps;
      if (velFps) {
        document.getElementById('muzzleVel').value = m ? (velFps * 0.3048).toFixed(1) : velFps;
      }
    }
  } else if (w.defaultVelFps) {
    document.getElementById('muzzleVel').value = m ? (w.defaultVelFps * 0.3048).toFixed(1) : w.defaultVelFps;
  }

  // Store PCP tune for dynamic V0 recalculation (airgun only)
  if (document.getElementById('weaponType').value === 'airgun') {
    const tuneVel = parseFloat(document.getElementById('muzzleVel').value);
    const tuneWeight = parseFloat(document.getElementById('projWeight').value);
    if (tuneVel > 0 && tuneWeight > 0) {
      // Store in imperial (FPS/grains) regardless of display unit
      appState.pcpTune = {
        v0Fps: m ? tuneVel / 0.3048 : tuneVel,
        baseWeightGr: m ? tuneWeight / 0.0648 : tuneWeight
      };
    }
  }

  updateReticleMagSliderLimits(true);
}

/**
 * Fill the ammunition dropdown.
 * - With a weapon selected, ONLY loads of that weapon's calibre are offered
 *   (a .300 Win Mag rifle never lists .308 / 6.5 CM / .22 ammo).
 * - With "custom" weapon, every load is offered, grouped by calibre.
 * Option values stay the index into the FULL database so presets / onProjectileSelect keep working.
 */
function populateProjectileSelect() {
  const type = document.getElementById('weaponType').value;
  const sel = document.getElementById('projSelect');
  const list = type === 'airgun' ? appState.projectilesDB.airgun : appState.projectilesDB.firearms;
  const prev = sel.value;

  const wName = document.getElementById('caliberSelect').value;
  const weapon = (wName && wName !== 'custom')
    ? appState.weaponsDB.find(w => w.name === wName && w.type === type) : null;
  const cal = weapon ? weapon.caliber : null;

  sel.innerHTML = `<option value="custom">${I18n.t('custom')}</option>`;
  const items = list.map((p, i) => ({ p, i })).filter(({ p }) => !cal || p.cal === cal);

  const label = ({ p, i }) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = (p.bcVerified === false ? '⚠ ' : '') + p.name;
    if (p.bcVerified === false) opt.title = I18n.getLang() === 'es' ? 'BC sin verificar con el fabricante' : 'BC not verified with the manufacturer';
    return opt;
  };
  // Chilean-market loads first, then by weight
  const byPopularity = (a, b) => (b.p.chile ? 1 : 0) - (a.p.chile ? 1 : 0) || (a.p.weightGr - b.p.weightGr);

  if (cal) {
    items.sort(byPopularity).forEach(it => sel.appendChild(label(it)));
  } else {
    const groups = {};
    items.forEach(it => { (groups[it.p.cal || '—'] = groups[it.p.cal || '—'] || []).push(it); });
    Object.keys(groups).forEach(c => {
      const grp = document.createElement('optgroup');
      grp.label = c;
      groups[c].sort(byPopularity).forEach(it => grp.appendChild(label(it)));
      sel.appendChild(grp);
    });
  }
  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
}

function onProjectileSelect() {
  const type = document.getElementById('weaponType').value;
  const idx = document.getElementById('projSelect').value;
  if (idx === 'custom') return;
  const list = type === 'airgun' ? appState.projectilesDB.airgun : appState.projectilesDB.firearms;
  const p = list[parseInt(idx)];
  if (!p) return;
  const m = appState.units === 'metric';

  // JSON values are ALWAYS in imperial — convert if metric
  document.getElementById('projWeight').value = m ? (p.weightGr * 0.0648).toFixed(2) : p.weightGr;
  document.getElementById('projDiam').value = m ? (p.diamIn * 25.4).toFixed(3) : p.diamIn;
  document.getElementById('projLength').value = m ? (p.lengthIn * 25.4).toFixed(2) : p.lengthIn;

  const isAirgun = type === 'airgun';
  if (isAirgun && p.bcGA) {
    document.getElementById('projBC').value = p.bcGA;
    document.getElementById('dragModel').value = 'GA';
  } else if (p.bcG7) {
    document.getElementById('projBC').value = p.bcG7;
    document.getElementById('dragModel').value = 'G7';
  } else if (p.bcG1) {
    document.getElementById('projBC').value = p.bcG1;
    document.getElementById('dragModel').value = 'G1';
  }

  // Set muzzle velocity if ammo has it
  if (p.muzzleVelFps) {
    document.getElementById('muzzleVel').value = m ? (p.muzzleVelFps * 0.3048).toFixed(1) : p.muzzleVelFps;
  } else if (type === 'airgun' && appState.pcpTune) {
    // Dynamic V0: recalculate velocity based on energy conservation
    // V_new = V_base × √(W_base / W_new)
    const newWeightGr = p.weightGr;
    const newV0Fps = appState.pcpTune.v0Fps * Math.sqrt(appState.pcpTune.baseWeightGr / newWeightGr);
    document.getElementById('muzzleVel').value = m ? (newV0Fps * 0.3048).toFixed(1) : Math.round(newV0Fps);
  }
}

function updateAtmoDisplay() {
  const m = appState.units === 'metric';
  const rawT = num('temperature', m ? 15 : 59);
  const tC = m ? rawT : (rawT - 32) * 5 / 9;
  const rawP = num('pressure', m ? 1013.25 : 29.92);
  const pHpa = m ? rawP : rawP * 33.8639;
  const rh = parseFloat(document.getElementById('humidity').value) || 0;
  const atmo = Atmosphere.getAtmosphere({ tempC: tC, pressureHpa: pHpa, rh: rh });
  document.getElementById('dispDensity').textContent = atmo.density.toFixed(4) + ' kg/m³';
  document.getElementById('dispSoS').textContent = atmo.speedOfSound.toFixed(1) + ' m/s';
  const daVal = m ? (atmo.densityAltitudeFt * 0.3048).toFixed(0) + ' m' : Math.round(atmo.densityAltitudeFt) + ' ft';
  document.getElementById('dispDA').textContent = daVal;
}

function updateWindDisplay() {
  const m = appState.units === 'metric';
  const speed = parseFloat(document.getElementById('windSpeed').value) || 0;
  const dir = parseFloat(document.getElementById('windDir').value) || 0;
  const azimuth = parseFloat(document.getElementById('azimuth').value) || 0;
  const relAngle = (dir - azimuth) * Math.PI / 180;
  const cross = speed * Math.sin(relAngle);
  const head = -speed * Math.cos(relAngle);
  const u = m ? 'km/h' : 'mph';
  document.getElementById('dispCrossWind').textContent = Math.abs(cross).toFixed(1) +
    ` ${u} ` + (cross > 0 ? '→' : cross < 0 ? '←' : '');
  document.getElementById('dispHeadWind').textContent = Math.abs(head).toFixed(1) +
    ` ${u} ` + (head > 0 ? I18n.t('headWind') : head < 0 ? I18n.t('tailWind') : '');
}

function onWindClockChange() {
  const val = document.getElementById('windClock').value;
  if (val !== '') {
    const az = parseFloat(document.getElementById('azimuth').value) || 0;
    document.getElementById('windDir').value = (az + parseFloat(val)) % 360;
    updateWindDisplay();
  }
}

// ─── Unit Conversion System ───
const UnitDefs = {
  twistRate:    { imp: 'in/t', met: 'mm/t',  toMet: v => v * 25.4,     toImp: v => v / 25.4,     dec: 1 },
  scopeHeight:  { imp: 'in',   met: 'cm',    toMet: v => v * 2.54,     toImp: v => v / 2.54,     dec: 2 },
  zeroRange:    { imp: 'yd',   met: 'm',     toMet: v => v * 0.9144,   toImp: v => v / 0.9144,   dec: 0 },
  projWeight:   { imp: 'gr',   met: 'g',     toMet: v => v * 0.0648,   toImp: v => v / 0.0648,   dec: 2 },
  projDiam:     { imp: 'in',   met: 'mm',    toMet: v => v * 25.4,     toImp: v => v / 25.4,     dec: 3 },
  projLength:   { imp: 'in',   met: 'mm',    toMet: v => v * 25.4,     toImp: v => v / 25.4,     dec: 2 },
  muzzleVel:    { imp: 'fps',  met: 'm/s',   toMet: v => v * 0.3048,   toImp: v => v / 0.3048,   dec: 1 },
  temperature:  { imp: '°F',   met: '°C',    toMet: v =>(v-32)*5/9,    toImp: v => v*9/5+32,     dec: 1 },
  pressure:     { imp: 'inHg', met: 'hPa',   toMet: v => v * 33.8639,  toImp: v => v / 33.8639,  dec: 2 },
  altitude:     { imp: 'ft',   met: 'm',     toMet: v => v * 0.3048,   toImp: v => v / 0.3048,   dec: 0 },
  windSpeed:    { imp: 'mph',  met: 'km/h',  toMet: v => v * 1.60934,  toImp: v => v / 1.60934,  dec: 1 },
  maxRange:     { imp: 'yd',   met: 'm',     toMet: v => v * 0.9144,   toImp: v => v / 0.9144,   dec: 0 },
  rangeStep:    { imp: 'yd',   met: 'm',     toMet: v => v * 0.9144,   toImp: v => v / 0.9144,   dec: 0 },
  mpbrVitalDiameter: { imp: 'in', met: 'cm', toMet: v => v * 2.54, toImp: v => v / 2.54, dec: 1 },
};

function convertFieldValue(id, toMetric) {
  const def = UnitDefs[id];
  if (!def) return;
  const el = document.getElementById(id);
  const val = parseFloat(el.value);
  if (isNaN(val)) return;
  el.value = (toMetric ? def.toMet(val) : def.toImp(val)).toFixed(def.dec);
}

function updateUnitLabels() {
  const m = appState.units === 'metric';
  Object.keys(UnitDefs).forEach(id => {
    const def = UnitDefs[id];
    const el = document.getElementById(id);
    if (!el) return;
    const label = el.closest('.input-with-unit')?.querySelector('.unit-label');
    if (label) label.textContent = m ? def.met : def.imp;
  });
  // Special IDs for range unit labels
  const ru = m ? 'm' : 'yd';
  ['zeroRangeUnit','maxRangeUnit','rangeStepUnit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = ru;
  });
}

function updateUnitsDisplay() {
  const toMetric = appState.units === 'metric';
  const btn = document.getElementById('btnUnits');
  btn.textContent = '📐';
  btn.title = toMetric ? 'Métrico' : 'Imperial';
  // Convert all field values
  Object.keys(UnitDefs).forEach(id => convertFieldValue(id, toMetric));
  // Update labels
  updateUnitLabels();
  // Refresh displays
  updateAtmoDisplay();
  updateWindDisplay();
  // Update MPBR vital zone display
  const u = toMetric ? 'cm' : 'in';
  const vitalU = document.getElementById('mpbrVitalUnit');
  if (vitalU) vitalU.textContent = u;
  const d = parseFloat(document.getElementById('mpbrVitalDiameter').value) || 8;
  const rd = document.getElementById('mpbrRadiusDisp');
  if (rd) rd.textContent = (d / 2).toFixed(1) + ' ' + u;
  // Update DOPE unit labels
  const dopeDistU = document.getElementById('dopeDistUnit');
  if (dopeDistU) dopeDistU.textContent = toMetric ? 'm' : 'yd';
  const dopeTempU = document.getElementById('dopeTempUnit');
  if (dopeTempU) dopeTempU.textContent = toMetric ? '°C' : '°F';
  // Update reticle distance unit
  const retDistU = document.getElementById('reticleDistUnit');
  if (retDistU) retDistU.textContent = toMetric ? 'm' : 'yd';
  // Re-render results if available
  if (appState.results) renderResults(appState.results);
}

function calculate() {
  const btn = document.getElementById('btnCalculate');
  btn.textContent = '⏳ ...';
  btn.disabled = true;
  setTimeout(() => {
    try {
      const config = gatherInputs();
      const results = Solver.solve(config);
      appState.results = results;
      renderResults(results);
    } catch (e) {
      console.error('Calculation error:', e);
      alert(I18n.t('calcError') + ': ' + e.message);
    } finally {
      btn.textContent = '⊕ ' + I18n.t('calculate');
      btn.disabled = false;
    }
  }, 50);
}

function gatherInputs() {
  const m = appState.units === 'metric';
  // Read a field in the active unit system. Blank/invalid → default given in IMPERIAL,
  // converted to the active units. `positive` also rejects 0/negatives (physical quantities).
  const field = (id, impDefault, positive) => {
    const v = parseFloat(document.getElementById(id).value);
    if (Number.isFinite(v) && (!positive || v > 0)) return v;
    const def = UnitDefs[id];
    return m && def ? def.toMet(impDefault) : impDefault;
  };
  const rawVel = field('muzzleVel', 2600, true);
  const muzzleVelMps = m ? rawVel : rawVel * 0.3048;
  const rawWeight = field('projWeight', 175, true);
  const massGrains = m ? rawWeight / 0.0648 : rawWeight;
  const rawDiam = field('projDiam', 0.308, true);
  const diamIn = m ? rawDiam / 25.4 : rawDiam;
  const rawLen = field('projLength', 1.24, true);
  const lengthIn = m ? rawLen / 25.4 : rawLen;
  const bc = field('projBC', 0.264, true);
  const dragModel = document.getElementById('dragModel').value;
  const rawTwist = field('twistRate', 10, true);
  const twistIn = m ? rawTwist / 25.4 : rawTwist;
  const twistDir = parseInt(document.getElementById('twistDir').value) || 1;
  const rawScope = field('scopeHeight', 1.5, true);
  const scopeHIn = m ? rawScope / 2.54 : rawScope;
  const rawZero = field('zeroRange', 100, true);
  const zeroRangeM = m ? rawZero : rawZero * 0.9144;
  const rawTemp = field('temperature', 59);           // 0 °C / 0 °F are valid temperatures
  const tempC = m ? rawTemp : (rawTemp - 32) * 5 / 9;
  const rawPress = field('pressure', 29.92, true);
  const pHpa = m ? rawPress : rawPress * 33.8639;
  const rh = num('humidity', 0);
  const atmo = Atmosphere.getAtmosphere({ tempC, pressureHpa: pHpa, rh });
  const rawWind = num('windSpeed', 0);
  const windSpeedMps = m ? rawWind / 3.6 : rawWind * 0.44704;
  const windDir = num('windDir', 0);
  const latDeg = num('latitude', 0);
  const azDeg = num('azimuth', 0);
  const lookAngleDeg = Math.min(Math.max(num('lookAngle', 0), -85), 85);
  const rawMax = field('maxRange', 1093.61, true);
  const maxRangeM = Math.min(Math.max(m ? rawMax : rawMax * 0.9144, 10), 5000);
  const rawStep = field('rangeStep', 27.34, true);
  const stepM = Math.min(Math.max(m ? rawStep : rawStep * 0.9144, Math.max(0.5, maxRangeM / 2000)), maxRangeM);
  return {
    muzzleVelMps, massKg: massGrains / 15432.4,
    diameterM: diamIn * 0.0254, bc, dragModel,
    scopeHeightM: scopeHIn * 0.0254, zeroRangeM, lookAngleDeg,
    atmo, windSpeedMps, windDirDeg: windDir,
    latDeg, azimuthDeg: azDeg, twistDir, twistInchesPerTurn: twistIn,
    bulletLengthIn: lengthIn, bulletDiamIn: diamIn, massGrains,
    maxRangeM, stepM, customDragTable: null
  };
}

function renderResults(results) {
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('resultsContent').style.display = '';
  renderBallisticAlerts(results);
  renderRangeCard(results);
  renderCharts(results);
  updateReticleView();
}

function renderBallisticAlerts(results) {
  const container = document.getElementById('ballisticAlerts');
  const m = appState.units === 'metric';
  const badges = [];

  // ── Stability ──
  const sg = results[0].stabilityFactor;
  const sgStatus = Stability.stabilityStatus(sg);
  const sgClass = sg >= 1.5 ? 'stability' : (sg >= 1.0 ? 'stability marginal' : 'stability unstable');
  badges.push(`<span class="bal-alert ${sgClass}"><span class="bal-icon">🌀</span>SG ${sg.toFixed(2)}</span>`);

  // ── Find transonic & subsonic distances ──
  let transonicDist = null;
  let subsonicDist = null;
  for (const r of results) {
    if (transonicDist === null && r.isTransonic) {
      transonicDist = m ? r.rangeM : r.rangeYd;
    }
    if (subsonicDist === null && r.isSubsonic) {
      subsonicDist = m ? r.rangeM : r.rangeYd;
    }
  }
  const dU = m ? 'm' : 'yd';

  if (transonicDist !== null) {
    badges.push(`<span class="bal-alert transonic"><span class="bal-icon">⚠️</span>${I18n.t('alertTransonic')} ${Math.round(transonicDist)}${dU}</span>`);
  }
  if (subsonicDist !== null) {
    badges.push(`<span class="bal-alert subsonic"><span class="bal-icon">🔴</span>${I18n.t('alertSubsonic')} ${Math.round(subsonicDist)}${dU}</span>`);
  }
  if (transonicDist === null && subsonicDist === null) {
    const last = results[results.length - 1];
    const lastD = m ? last.rangeM : last.rangeYd;
    badges.push(`<span class="bal-alert supersonic"><span class="bal-icon">✅</span>${I18n.t('alertSupersonicTo')} ${Math.round(lastD)}${dU}+</span>`);
  }

  // ── Max ethical hunting distance for selected species ──
  const animalSel = document.getElementById('gameAnimalSelect');
  const selectedAnimal = (animalSel && animalSel.value && appState.gameAnimalsDB)
    ? appState.gameAnimalsDB.find(a => a.id === animalSel.value) : null;

  if (selectedAnimal && selectedAnimal.minEnergyFPE) {
    const minE = selectedAnimal.minEnergyFPE; // ft·lbs
    // Find last distance where energy >= minEnergyFPE
    let maxEthicalDist = null;
    for (const r of results) {
      if (r.energyFtLbs >= minE) {
        maxEthicalDist = m ? r.rangeM : r.rangeYd;
      } else {
        break;
      }
    }
    const animalName = (I18n.getLang() === 'es') ? selectedAnimal.nameEs : selectedAnimal.nameEn;
    const minEDisplay = m ? Math.round(minE * 1.3558) + 'J' : Math.round(minE) + 'fpe';
    if (maxEthicalDist === null) {
      // Energy is insufficient from the start
      badges.push(`<span class="bal-alert subsonic"><span class="bal-icon">💀</span>${esc(animalName)}: ${I18n.t('alertEnergyLow')} ${minEDisplay})</span>`);
    } else {
      const last = results[results.length - 1];
      const lastD = m ? last.rangeM : last.rangeYd;
      if (maxEthicalDist >= lastD - 1) {
        // Sufficient across full range
        badges.push(`<span class="bal-alert supersonic"><span class="bal-icon">🎯</span>${esc(animalName)}: ${I18n.t('alertEthicalTo')} ${Math.round(maxEthicalDist)}${dU}+</span>`);
      } else {
        badges.push(`<span class="bal-alert transonic"><span class="bal-icon">🎯</span>${esc(animalName)}: ${I18n.t('alertEthicalTo')} ${Math.round(maxEthicalDist)}${dU} (min ${minEDisplay})</span>`);
      }
    }
    // Check hunting season status for the selected animal
    const seasonCheck = _evalAnimalSeasonStatus(selectedAnimal, 'all');
    if (seasonCheck.state === 'out_of_season') {
      badges.push(`<span class="bal-alert subsonic" style="border-color:#ef4444;background:rgba(239,68,68,0.18);color:#fecaca"><span class="bal-icon">⛔</span>${esc(animalName)}: ${I18n.t('outOfSeasonShort')} (${esc(seasonCheck.seasonSummary)})</span>`);
    } else if (seasonCheck.state === 'closed') {
      badges.push(`<span class="bal-alert subsonic"><span class="bal-icon">🚫</span>${esc(animalName)}: VEDADA</span>`);
    }
  } else {
    // No animal selected — show final energy
    const last = results[results.length - 1];
    const lastE = m ? (last.energyFtLbs * 1.3558) : last.energyFtLbs;
    const eU = m ? 'J' : 'ft·lbs';
    badges.push(`<span class="bal-alert energy"><span class="bal-icon">⚡</span>${I18n.t('alertEFinal')} ${Math.round(lastE)}${eU}</span>`);
  }

  container.innerHTML = badges.join('');
}

function renderRangeCard(results) {
  const thead = document.getElementById('rangeCardHead');
  const tbody = document.getElementById('rangeCardBody');
  const m = appState.units === 'metric';
  const dU = m ? 'm' : 'yd'; const lU = m ? 'cm' : 'in';
  const vU = m ? 'm/s' : 'fps'; const eU = m ? 'J' : 'ft·lbs';
  const mob = window.innerWidth <= 768;
  if (mob) {
    thead.innerHTML = `<tr><th>${dU}</th><th>MOA</th><th>${lU}</th><th>W.MOA</th><th>W.${lU}</th><th>${vU}</th><th>${eU}</th><th>ToF(s)</th><th>M</th></tr>`;
  } else {
    thead.innerHTML = `<tr><th>${I18n.t('range')} (${dU})</th><th>${I18n.t('drop')} (MOA)</th><th>${I18n.t('drop')} (${lU})</th><th>${I18n.t('windage')} (MOA)</th><th>${I18n.t('windage')} (${lU})</th><th>${I18n.t('velocity')} (${vU})</th><th>${I18n.t('energy')} (${eU})</th><th>${I18n.t('tof')} (s)</th><th>Mach</th></tr>`;
  }
  const zeroRange = parseFloat(document.getElementById('zeroRange').value) || 100;
  tbody.innerHTML = results.map(r => {
    const dist = m ? r.rangeM : r.rangeYd;
    const dropL = m ? r.dropIn * 2.54 : r.dropIn;
    const windL = m ? r.windageIn * 2.54 : r.windageIn;
    const vel = m ? r.velocityFps * 0.3048 : r.velocityFps;
    const eng = m ? r.energyFtLbs * 1.3558 : r.energyFtLbs;
    const zeroCheck = m ? r.rangeM : r.rangeYd;
    const isZero = Math.abs(zeroCheck - zeroRange) < 2;
    let rowClass = isZero ? 'zero-row' : (r.isTransonic ? 'transonic' : (r.isSubsonic ? 'subsonic' : ''));
    const dropClass = dropL < 0 ? 'negative' : 'positive';
    const badge = r.isTransonic ? '<span class="badge badge-transonic">T</span>' : (r.isSubsonic ? '<span class="badge badge-subsonic">S</span>' : '');
    return `<tr class="${rowClass}"><td>${dist.toFixed(0)}${badge}</td><td class="${dropClass}">${r.dropMoa.toFixed(1)}</td><td class="${dropClass}">${dropL.toFixed(1)}</td><td>${r.windageMoa.toFixed(1)}</td><td>${windL.toFixed(1)}</td><td>${vel.toFixed(0)}</td><td>${eng.toFixed(0)}</td><td>${r.tof.toFixed(3)}</td><td>${r.mach.toFixed(2)}</td></tr>`;
  }).join('');
}

function renderCharts(results) {
  const m = appState.units === 'metric';
  const labels = results.map(r => m ? r.rangeM.toFixed(0) : r.rangeYd.toFixed(0));
  const dropData = results.map(r => m ? r.dropIn * 2.54 : r.dropIn);
  const windData = results.map(r => m ? r.windageIn * 2.54 : r.windageIn);
  const velData = results.map(r => m ? r.velocityFps * 0.3048 : r.velocityFps);
  const engData = results.map(r => m ? r.energyFtLbs * 1.3558 : r.energyFtLbs);
  const lU = m ? 'cm' : 'in'; const vU = m ? 'm/s' : 'fps'; const eU = m ? 'J' : 'ft·lbs';
  if (appState.charts.trajectory) appState.charts.trajectory.destroy();
  if (appState.charts.velEnergy) appState.charts.velEnergy.destroy();

  // Kill zone plugin — draws vital zone band on trajectory chart
  const killZonePlugin = {
    id: 'killZoneBand',
    beforeDraw(chart) {
      const rawDiam = parseFloat(document.getElementById('mpbrVitalDiameter').value);
      if (!rawDiam || rawDiam <= 0) return;
      const isMetric = appState.units === 'metric';
      // Convert diameter to chart units (cm if metric, in if imperial)
      const radiusChart = isMetric ? rawDiam / 2 : rawDiam / 2;  // already in display units
      const yAxis = chart.scales.y;
      const xAxis = chart.scales.x;
      if (!yAxis || !xAxis) return;
      const topPx = yAxis.getPixelForValue(radiusChart);
      const botPx = yAxis.getPixelForValue(-radiusChart);
      const zeroPx = yAxis.getPixelForValue(0);
      const ctx = chart.ctx;
      ctx.save();
      // Fill band
      ctx.fillStyle = 'rgba(16,185,129,0.06)';
      ctx.fillRect(xAxis.left, topPx, xAxis.right - xAxis.left, botPx - topPx);
      // Border lines
      ctx.strokeStyle = 'rgba(16,185,129,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xAxis.left, topPx); ctx.lineTo(xAxis.right, topPx);
      ctx.moveTo(xAxis.left, botPx); ctx.lineTo(xAxis.right, botPx);
      ctx.stroke();
      // Label
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(16,185,129,0.5)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      const label = isMetric ? `±${(rawDiam/2).toFixed(1)} cm` : `±${(rawDiam/2).toFixed(1)} in`;
      ctx.fillText('⊕ ' + label, xAxis.left + 6, topPx - 4);
      ctx.restore();
    }
  };

  const cDef = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } } },
    scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } }, title: { display: true, text: I18n.t('chartRange') + (m ? ' (m)' : ' (yd)'), color: '#64748b' } } }
  };
  const ctxT = document.getElementById('chartTrajectory').getContext('2d');
  appState.charts.trajectory = new Chart(ctxT, {
    type: 'line',
    plugins: [killZonePlugin],
    data: { labels, datasets: [
      { label: I18n.t('drop') + ` (${lU})`, data: dropData, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3 },
      { label: I18n.t('windage') + ` (${lU})`, data: windData, borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.1)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3 }
    ] },
    options: { ...cDef, scales: { ...cDef.scales, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } }, title: { display: true, text: lU, color: '#64748b' } } } }
  });
  const ctxV = document.getElementById('chartVelEnergy').getContext('2d');
  appState.charts.velEnergy = new Chart(ctxV, {
    type: 'line', data: { labels, datasets: [
      { label: I18n.t('velocity') + ` (${vU})`, data: velData, borderColor: '#22c55e', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y' },
      { label: I18n.t('energy') + ` (${eU})`, data: engData, borderColor: '#8b5cf6', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' }
    ] },
    options: { ...cDef, scales: { ...cDef.scales,
      y: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#22c55e', font: { family: 'JetBrains Mono', size: 10 } }, title: { display: true, text: `${I18n.t('velocity')} (${vU})`, color: '#22c55e' } },
      y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#8b5cf6', font: { family: 'JetBrains Mono', size: 10 } }, title: { display: true, text: `${I18n.t('energy')} (${eU})`, color: '#8b5cf6' } }
    } }
  });
}

// ─── Scope Select ───
function populateScopeSelect() {
  const sel = document.getElementById('scopeSelect');
  sel.innerHTML = `<option value="custom">${I18n.t('custom')}</option>`;
  appState.scopesDB.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
}

/** Dynamically update reticle magnification slider limits and values */
function updateReticleMagSliderLimits(forceRef = false) {
  const slider = document.getElementById('reticleMagSlider');
  if (!slider) return;
  const minVal = parseFloat(document.getElementById('magMin').value) || 1;
  const maxVal = parseFloat(document.getElementById('magMax').value) || 24;
  const refVal = parseFloat(document.getElementById('magRef').value) || 14;

  slider.min = minVal;
  slider.max = maxVal;
  
  let currentVal = forceRef ? refVal : (parseFloat(slider.value) || refVal);
  if (currentVal < minVal) currentVal = minVal;
  if (currentVal > maxVal) currentVal = maxVal;
  
  slider.value = currentVal;
  document.getElementById('reticleMagValue').textContent = currentVal + 'x';
  ReticleView.setMagnification(currentVal);
}

function onScopeSelect() {
  const idx = document.getElementById('scopeSelect').value;
  if (idx === 'custom') { appState.currentScope = null; return; }
  const scope = appState.scopesDB[parseInt(idx)];
  if (!scope) return;
  appState.currentScope = scope;

  document.getElementById('scopeHeight').value = scope.scopeHeightIn;
  document.getElementById('focalPlane').value = scope.focalPlane;
  document.getElementById('reticleType').value = scope.reticleId;
  document.getElementById('reticleUnit').value = scope.reticleUnit;
  document.getElementById('clickElev').value = scope.clickElev;
  document.getElementById('clickWind').value = scope.clickWind;
  document.getElementById('turretUnit').value = scope.turretUnit;
  document.getElementById('magRef').value = scope.magRef;
  document.getElementById('magMin').value = scope.magMin;
  document.getElementById('magMax').value = scope.magMax;

  updateReticleMagSliderLimits(true);

  onReticleChange();
}

function onReticleChange() {
  const reticleId = document.getElementById('reticleType').value;
  const reticle = appState.reticlesDB.find(r => r.id === reticleId);
  if (reticle) {
    appState.currentReticle = reticle;
    ReticleView.setReticle(reticle);
    // Auto-set unit based on reticle if it has one
    if (reticle.unit !== 'none') {
      document.getElementById('reticleUnit').value = reticle.unit;
    }
  }
}

function getScopeProfile() {
  return {
    focalPlane: document.getElementById('focalPlane').value,
    reticleId: document.getElementById('reticleType').value,
    reticleUnit: document.getElementById('reticleUnit').value,
    clickElev: parseFloat(document.getElementById('clickElev').value) || 0.25,
    clickWind: parseFloat(document.getElementById('clickWind').value) || 0.25,
    turretUnit: document.getElementById('turretUnit').value,
    magRef: parseFloat(document.getElementById('magRef').value) || 14,
    magMin: parseFloat(document.getElementById('magMin').value) || 1,
    magMax: parseFloat(document.getElementById('magMax').value) || 24,
    scopeHeightIn: parseFloat(document.getElementById('scopeHeight').value) || 1.5
  };
}

// ─── Reticle View ───
function initReticleView() {
  ReticleView.init('reticleCanvas');
  // Set default reticle
  const defaultReticle = appState.reticlesDB.find(r => r.id === 'mildot');
  if (defaultReticle) {
    appState.currentReticle = defaultReticle;
    ReticleView.setReticle(defaultReticle);
  }
}

function updateReticleView() {
  if (!appState.results || appState.results.length === 0) return;

  const m = appState.units === 'metric';
  const rawDist = parseFloat(document.getElementById('reticleTargetDist').value) || 300;
  const distM = m ? rawDist : rawDist * 0.9144;
  const currentMag = parseFloat(document.getElementById('reticleMagSlider').value) || 14;

  // Find result closest to target distance
  let closest = appState.results[0];
  let minDiff = Infinity;
  for (const r of appState.results) {
    const diff = Math.abs(r.rangeM - distM);
    if (diff < minDiff) { minDiff = diff; closest = r; }
  }

  const scopeProfile = getScopeProfile();
  const solution = ReticleCalc.getFiringSolution(closest, scopeProfile, currentMag);

  if (solution) {
    ReticleView.setSolution(solution);
    ReticleView.setBallisticTable(appState.results, appState.units);
    renderFiringSolution(solution, scopeProfile);
  }

  // Pass selected silhouette (independent from MPBR animal)
  const silSel = document.getElementById('reticleSilhouetteSelect');
  if (silSel && silSel.value && appState.gameAnimalsDB) {
    const animal = appState.gameAnimalsDB.find(a => a.id === silSel.value);
    if (animal && animal.bodyHeightCm) {
      ReticleView.setAnimal({
        silhouetteType: animal.silhouetteType || 'generic',
        bodyHeightCm: animal.bodyHeightCm,
        vitalZoneCm: animal.vitalZoneCm
      });
    } else {
      ReticleView.setAnimal(null);
    }
  }
}

function renderFiringSolution(sol, scope) {
  const container = document.getElementById('firingSolution');
  if (!sol) { container.innerHTML = ''; return; }

  const dU = appState.units === 'metric' ? 'm/s' : 'fps';
  const eU = appState.units === 'metric' ? 'J' : 'ft·lbs';
  const vel = appState.units === 'metric' ? (sol.velocity * 0.3048).toFixed(0) : sol.velocity.toFixed(0);
  const eng = appState.units === 'metric' ? (sol.energy * 1.3558).toFixed(0) : sol.energy.toFixed(0);

  const sfpNote = !sol.isTrueSubtension
    ? `<div class="sfp-warning">⚠ ${I18n.t('sfpWarning')} ${scope.magRef}x</div>` : '';

  // Out-of-season alert in Reticle View if target animal is out of season
  let seasonNote = '';
  const silId = document.getElementById('reticleSilhouetteSelect')?.value || document.getElementById('gameAnimalSelect')?.value;
  if (silId && appState.gameAnimalsDB) {
    const retAnimal = appState.gameAnimalsDB.find(a => a.id === silId);
    if (retAnimal) {
      const sc = _evalAnimalSeasonStatus(retAnimal, 'all');
      const aName = (appState.lang === 'es') ? retAnimal.nameEs : retAnimal.nameEn;
      if (sc.state === 'out_of_season') {
        seasonNote = `<div class="sfp-warning" style="background:rgba(239,68,68,0.16);border-color:#ef4444;color:#fecaca;font-weight:700">⛔ ${esc(aName)}: ${I18n.t('outOfSeasonShort')} (${esc(sc.seasonSummary)})</div>`;
      } else if (sc.state === 'closed') {
        seasonNote = `<div class="sfp-warning" style="background:rgba(239,68,68,0.16);border-color:#ef4444;color:#fecaca;font-weight:700">🚫 ${esc(aName)}: VEDADA</div>`;
      }
    }
  }

  // Apparent values = what you see on the reticle at current magnification (computed by ReticleCalc)
  const appHold = sol.holdover.value;
  const appWind = sol.windage.value;

  // Coriolis & spin drift breakdown (only show when present)
  const m = appState.units === 'metric';
  const corLat = m ? (sol.coriolisLatIn * 2.54) : sol.coriolisLatIn;
  const corVert = m ? (sol.coriolisVertIn * 2.54) : sol.coriolisVertIn;
  const sdrift = m ? (sol.spinDriftIn * 2.54) : sol.spinDriftIn;
  const lU = m ? 'cm' : 'in';
  const hasCor = Math.abs(corLat) > 0.01 || Math.abs(corVert) > 0.01;
  const hasSd = Math.abs(sdrift) > 0.01;

  let extraRows = '';
  if (hasCor) {
    extraRows += `<div class="sol-item"><span class="sol-label">Coriolis Lat</span><span class="sol-value" style="color:#a855f7">${corLat.toFixed(1)} ${lU} ${corLat > 0 ? '→' : '←'}</span></div>`;
    extraRows += `<div class="sol-item"><span class="sol-label">Coriolis Vert</span><span class="sol-value" style="color:#a855f7">${corVert.toFixed(1)} ${lU} ${corVert > 0 ? '↑' : '↓'}</span></div>`;
  }
  if (hasSd) {
    extraRows += `<div class="sol-item"><span class="sol-label">Spin Drift</span><span class="sol-value" style="color:#a855f7">${sdrift.toFixed(1)} ${lU} ${sdrift > 0 ? '→' : '←'}</span></div>`;
  }

  container.innerHTML = `
    <h4>${I18n.t('firingSlnTitle')}</h4>
    ${seasonNote}
    ${sfpNote}
    <div class="solution-grid">
      <div class="sol-item"><span class="sol-label">${I18n.t('holdover')}</span><span class="sol-value accent">${appHold.toFixed(2)} ${sol.holdover.unit} ${sol.holdover.direction === 'down' ? '↓' : '↑'}</span></div>
      <div class="sol-item"><span class="sol-label">${I18n.t('windage')}</span><span class="sol-value cyan">${appWind.toFixed(2)} ${sol.windage.unit} ${sol.windage.direction === 'right' ? '→' : '←'}</span></div>
      <div class="sol-item"><span class="sol-label">${I18n.t('drop')} (MOA)</span><span class="sol-value">${sol.dropMoa.toFixed(1)}</span></div>
      <div class="sol-item"><span class="sol-label">${I18n.t('drop')} (MIL)</span><span class="sol-value">${sol.dropMil.toFixed(2)}</span></div>
      <div class="sol-item"><span class="sol-label">${I18n.t('clicksElev')}</span><span class="sol-value accent">${Math.abs(sol.elevClicks.clicks)} ${sol.elevClicks.direction === 'down' ? '↑ U' : '↓ D'}</span></div>
      <div class="sol-item"><span class="sol-label">${I18n.t('clicksWind')}</span><span class="sol-value cyan">${Math.abs(sol.windClicks.clicks)} ${sol.windClicks.direction === 'right' ? '→ R' : '← L'}</span></div>
      <div class="sol-item"><span class="sol-label">${I18n.t('velocity')}</span><span class="sol-value">${vel} ${dU}</span></div>
      <div class="sol-item"><span class="sol-label">${I18n.t('tof')}</span><span class="sol-value">${sol.tof.toFixed(3)} s</span></div>
      ${extraRows}
    </div>
  `;
}

function updateRangeEstimate() {
  const size = parseFloat(document.getElementById('rangeEstSize').value) || 45;
  const mils = parseFloat(document.getElementById('rangeEstMils').value) || 1.5;
  const scope = getScopeProfile();
  const currentMag = parseFloat(document.getElementById('reticleMagSlider').value) || 14;

  const est = ReticleCalc.rangeEstimate(size, 'cm', mils, scope.focalPlane, scope.magRef, currentMag);
  document.getElementById('rangeEstResult').textContent =
    `${est.rangeM.toFixed(0)} m / ${est.rangeYd.toFixed(0)} yd`;
}

// ─── Truing ───
function openTruing() {
  document.getElementById('truingModal').style.display = 'flex';
  // Update unit labels based on current system
  const m = appState.units === 'metric';
  const dU = m ? 'm' : 'yd';
  const dropU = m ? 'cm' : 'in';
  const velU = m ? 'm/s' : 'fps';
  document.getElementById('truingDist1Unit').textContent = dU;
  document.getElementById('truingDist2Unit').textContent = dU;
  document.getElementById('truingDropUnit1').textContent = dropU;
  document.getElementById('truingDropUnit2').textContent = dropU;
  // Reset predictions/results defaults
  document.getElementById('truingPredDrop1').textContent = '— ' + dropU;
  document.getElementById('truingPredDrop2').textContent = '— ' + dropU;
  document.getElementById('truingOrigMV').textContent = '— ' + velU;
  document.getElementById('truingNewMV').textContent = '— ' + velU;
  document.getElementById('truingDeltaMV').textContent = '— ' + velU;
  updateTruingPredictions();
}

function closeTruing() {
  document.getElementById('truingModal').style.display = 'none';
}

function updateTruingPredictions() {
  try {
    const config = gatherInputs();
    const m = appState.units === 'metric';
    const dropU = m ? 'cm' : 'in';

    const rawDist1 = parseFloat(document.getElementById('truingDist1').value) || (m ? 450 : 500);
    const dist1M = m ? rawDist1 : rawDist1 * 0.9144;
    const pred1 = Truing.getPredictedDrop(config, dist1M);
    if (pred1 !== null) {
      const val1 = m ? pred1 * 2.54 : pred1;
      document.getElementById('truingPredDrop1').textContent = val1.toFixed(1) + ' ' + dropU;
    } else {
      document.getElementById('truingPredDrop1').textContent = '— (' + I18n.t('rangeExceeded') + ')';
    }

    const rawDist2 = parseFloat(document.getElementById('truingDist2').value) || (m ? 800 : 900);
    const dist2M = m ? rawDist2 : rawDist2 * 0.9144;
    const pred2 = Truing.getPredictedDrop(config, dist2M);
    if (pred2 !== null) {
      const val2 = m ? pred2 * 2.54 : pred2;
      document.getElementById('truingPredDrop2').textContent = val2.toFixed(1) + ' ' + dropU;
    } else {
      document.getElementById('truingPredDrop2').textContent = '— (' + I18n.t('rangeExceeded') + ')';
    }
  } catch (e) {
    console.warn('Truing prediction error:', e);
  }
}

function runTruingMV() {
  try {
    const config = gatherInputs();
    const m = appState.units === 'metric';
    const rawDist = parseFloat(document.getElementById('truingDist1').value) || (m ? 450 : 500);
    const distM = m ? rawDist : rawDist * 0.9144;
    const actualDropRaw = parseFloat(document.getElementById('truingActualDrop1').value);
    if (isNaN(actualDropRaw)) { alert(I18n.t('enterActualDrop')); return; }
    // Convert user input to inches for the engine
    const actualDropIn = m ? actualDropRaw / 2.54 : actualDropRaw;

    const result = Truing.findMuzzleVelocity(config, distM, actualDropIn);
    appState.truingMVResult = result;

    const velU = m ? 'm/s' : 'fps';
    const origVel = m ? result.originalVelMps : result.originalVelFps;
    const newVel = m ? result.truedVelMps : result.truedVelFps;
    const deltaVel = m ? (result.truedVelMps - result.originalVelMps) : result.deltaFps;

    document.getElementById('truingResult1').style.display = '';
    document.getElementById('truingOrigMV').textContent = origVel.toFixed(1) + ' ' + velU;
    document.getElementById('truingNewMV').textContent = newVel.toFixed(1) + ' ' + velU;
    document.getElementById('truingDeltaMV').textContent =
      (deltaVel >= 0 ? '+' : '') + deltaVel.toFixed(1) + ' ' + velU;
    document.getElementById('btnApplyMV').style.display = '';
  } catch (e) {
    console.error('Truing MV error:', e);
    alert(I18n.t('calcError') + ' (MV): ' + e.message);
  }
}

function applyTruingMV() {
  if (!appState.truingMVResult) return;
  const m = appState.units === 'metric';
  const newVel = m ? appState.truingMVResult.truedVelMps : appState.truingMVResult.truedVelFps;
  document.getElementById('muzzleVel').value = newVel.toFixed(1);
  updateTruingPredictions();
}

function runTruingBC() {
  try {
    const config = gatherInputs();
    const m = appState.units === 'metric';
    const rawDist = parseFloat(document.getElementById('truingDist2').value) || (m ? 800 : 900);
    const distM = m ? rawDist : rawDist * 0.9144;
    const actualDropRaw = parseFloat(document.getElementById('truingActualDrop2').value);
    if (isNaN(actualDropRaw)) { alert(I18n.t('enterActualDrop')); return; }
    // Convert user input to inches for the engine
    const actualDropIn = m ? actualDropRaw / 2.54 : actualDropRaw;

    const result = Truing.findBC(config, distM, actualDropIn);
    appState.truingBCResult = result;

    document.getElementById('truingResult2').style.display = '';
    document.getElementById('truingOrigBC').textContent = result.originalBC.toFixed(4);
    document.getElementById('truingNewBC').textContent = result.truedBC.toFixed(4);
    const delta = result.deltaBC;
    document.getElementById('truingDeltaBC').textContent =
      (delta >= 0 ? '+' : '') + delta.toFixed(4);
    document.getElementById('btnApplyBC').style.display = '';
  } catch (e) {
    console.error('Truing BC error:', e);
    alert(I18n.t('calcError') + ' (BC): ' + e.message);
  }
}

function applyTruingBC() {
  if (!appState.truingBCResult) return;
  document.getElementById('projBC').value = appState.truingBCResult.truedBC.toFixed(4);
  updateTruingPredictions();
}

// ─── MPBR Modal ───
function openMPBR() {
  document.getElementById('mpbrModal').style.display = 'flex';
  // Set unit label
  const u = appState.units === 'metric' ? 'cm' : 'in';
  document.getElementById('mpbrVitalUnit').textContent = u;
  const d = parseFloat(document.getElementById('mpbrVitalDiameter').value) || 8;
  document.getElementById('mpbrRadiusDisp').textContent = (d / 2).toFixed(1) + ' ' + u;
  // Filter game animals based on weapon type
  populateGameAnimalSelect();
  populateReticleSilhouetteSelect();
}
function closeMPBR() { document.getElementById('mpbrModal').style.display = 'none'; }

function calculateMPBR() {
  const btn = document.getElementById('btnCalcMPBR');
  btn.disabled = true;
  btn.textContent = '⏳ ...';
  setTimeout(() => {
    try {
      const config = gatherInputs();
      const m = appState.units === 'metric';
      const rawDiam = parseFloat(document.getElementById('mpbrVitalDiameter').value) || 8;
      // Always convert to inches for the engine
      const diamIn = m ? rawDiam / 2.54 : rawDiam;
      const radiusIn = diamIn / 2;

      const result = MPBR.calculate(config, radiusIn);
      if (result.error) { alert('MPBR: ' + result.error); return; }

      // Store for later use
      appState.mpbrResult = result;

      // Display results in modal
      document.getElementById('mpbrResults').style.display = '';
      const du = m ? 'm' : 'yd';
      const lu = m ? 'cm' : 'in';
      document.getElementById('mpbrOptZero').textContent =
        (m ? result.optimalZeroM.toFixed(0) : result.optimalZeroYd.toFixed(0)) + ' ' + du;
      document.getElementById('mpbrNearZero').textContent =
        (m ? result.nearZeroM.toFixed(0) : result.nearZeroYd.toFixed(0)) + ' ' + du;
      document.getElementById('mpbrFarZero').textContent =
        (m ? result.farZeroM.toFixed(0) : result.farZeroYd.toFixed(0)) + ' ' + du;
      document.getElementById('mpbrDist').textContent =
        (m ? result.mpbrM.toFixed(0) : result.mpbrYd.toFixed(0)) + ' ' + du;
      document.getElementById('mpbrMaxOrd').textContent =
        (m ? (result.maxOrdinateIn * 2.54).toFixed(1) : result.maxOrdinateIn.toFixed(1)) + ' ' + lu +
        ' @ ' + (m ? result.maxOrdinateRangeM.toFixed(0) : result.maxOrdinateRangeYd.toFixed(0)) + ' ' + du;

      // Also render MPBR chart in the MPBR tab if it exists
      renderMPBRChart(result, radiusIn);

      // Calculate ethical hunting range if a game animal is selected
      updateEthicalRange(result);

    } catch (e) {
      console.error('MPBR error:', e);
      alert(I18n.t('calcError') + ' (MPBR): ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = I18n.t('calcMPBR');
    }
  }, 50);
}

function applyMPBRZero() {
  if (!appState.mpbrResult) return;
  const m = appState.units === 'metric';
  const zeroVal = m ? appState.mpbrResult.optimalZeroM : appState.mpbrResult.optimalZeroYd;
  document.getElementById('zeroRange').value = zeroVal.toFixed(0);
  closeMPBR();
  // Recalculate if results exist
  if (appState.results) calculate();
}

function renderMPBRChart(result, radiusIn) {
  const ctx = document.getElementById('chartMPBR');
  if (!ctx) return;
  if (appState.charts.mpbr) appState.charts.mpbr.destroy();

  const m = appState.units === 'metric';
  const traj = result.trajectory;
  const du = m ? 'm' : 'yd';
  const lu = m ? 'cm' : 'in';
  const MtoYd = 1.09361;

  // Only plot up to a reasonable range (MPBR + 20%)
  const mpbrM = result.mpbrM;
  const maxPlotM = Math.min(mpbrM * 1.3, traj[traj.length - 1].rangeM);
  const filtered = traj.filter(p => p.rangeM <= maxPlotM);

  const labels = filtered.map(p => m ? p.rangeM.toFixed(0) : (p.rangeM * MtoYd).toFixed(0));
  const dropData = filtered.map(p => m ? p.dropCm : p.dropIn);
  const radVal = m ? radiusIn * 2.54 : radiusIn;
  const upperBound = filtered.map(() => radVal);
  const lowerBound = filtered.map(() => -radVal);

  appState.charts.mpbr = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: I18n.t('trajectory'), data: dropData, borderColor: '#f59e0b', borderWidth: 2.5, pointRadius: 0, tension: 0.3, fill: false },
        { label: I18n.t('chartPlusRadius'), data: upperBound, borderColor: 'rgba(6,182,212,0.5)', borderWidth: 1.5, borderDash: [6, 3], pointRadius: 0, fill: false },
        { label: I18n.t('chartMinusRadius'), data: lowerBound, borderColor: 'rgba(6,182,212,0.5)', borderWidth: 1.5, borderDash: [6, 3], pointRadius: 0, fill: '-1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        tooltip: { backgroundColor: 'rgba(10,14,23,0.95)', titleColor: '#f59e0b', bodyColor: '#e2e8f0' }
      },
      scales: {
        x: { title: { display: true, text: I18n.t('range') + ' (' + du + ')', color: '#94a3b8' }, ticks: { color: '#64748b', maxTicksLimit: 15 }, grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { title: { display: true, text: I18n.t('drop') + ' (' + lu + ')', color: '#94a3b8' }, ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

// ─── D.O.P.E. (Data On Previous Engagements) ───
function toggleDopeForm() {
  const form = document.getElementById('dopeForm');
  const btn = document.getElementById('btnDopeAdd');
  if (form.style.display === 'none') {
    form.style.display = '';
    btn.textContent = '✕ ' + (I18n.t('cancel') || 'Cancelar');
    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('dopeDate').value = today;
    // Set distance unit
    document.getElementById('dopeDistUnit').textContent = appState.units === 'metric' ? 'm' : 'yd';
    document.getElementById('dopeTempUnit').textContent = appState.units === 'metric' ? '°C' : '°F';
  } else {
    form.style.display = 'none';
    btn.textContent = '+ ' + (I18n.t('dopeAdd') || 'Agregar');
  }
}

function autoFillDope() {
  if (!appState.results || !appState.results.length) {
    alert(I18n.t('runCalcFirst'));
    return;
  }
  const m = appState.units === 'metric';
  // Fill weapon/ammo/scope from current sidebar inputs
  const weaponName = document.getElementById('weaponName')?.value || '';
  const projName = document.getElementById('projName')?.value || '';
  const scopeSel = document.getElementById('scopeSelect');
  const scopeName = scopeSel ? scopeSel.options[scopeSel.selectedIndex]?.text : '';

  document.getElementById('dopeWeapon').value = weaponName;
  document.getElementById('dopeAmmo').value = projName;
  document.getElementById('dopeScope').value = scopeName;

  // Fill conditions from sidebar
  document.getElementById('dopeTemp').value = document.getElementById('temperature').value;
  document.getElementById('dopeWind').value = document.getElementById('windSpeed').value;
  document.getElementById('dopeWindDir').value = document.getElementById('windDir').value;

  // Fill distance with zero range as default
  const dist = document.getElementById('zeroRange').value;
  document.getElementById('dopeDist').value = dist;

  // Find closest result to the set distance and fill calculated values
  const rawDist = parseFloat(dist) || 100;
  const results = appState.results;
  let closest = results[0];
  let minDiff = Infinity;
  for (const r of results) {
    const d = m ? Math.abs(r.rangeM - rawDist) : Math.abs(r.rangeYd - rawDist);
    if (d < minDiff) { minDiff = d; closest = r; }
  }
  document.getElementById('dopeElevMoa').value = Math.abs(closest.dropMoa).toFixed(2);
  document.getElementById('dopeWindMoa').value = Math.abs(closest.windageMoa).toFixed(2);

  // Turret clicks from the scope profile (click size is in turret units: MOA or MIL)
  const scope = getScopeProfile();
  const elevClk = ReticleCalc.calcClicks(Math.abs(closest.dropMoa), scope.clickElev, scope.turretUnit);
  const windClk = ReticleCalc.calcClicks(Math.abs(closest.windageMoa), scope.clickWind, scope.turretUnit);
  document.getElementById('dopeElevClicks').value = Math.abs(elevClk.clicks);
  document.getElementById('dopeWindClicks').value = Math.abs(windClk.clicks);
}

function saveDope() {
  const dist = parseFloat(document.getElementById('dopeDist').value);
  if (!dist || dist <= 0) {
    alert(I18n.t('enterValidDist'));
    return;
  }

  const m = appState.units === 'metric';
  // Gather calc data if available
  let calcDropMoa = '', calcWindMoa = '';
  if (appState.results && appState.results.length) {
    let closest = appState.results[0];
    let minDiff = Infinity;
    for (const r of appState.results) {
      const d = m ? Math.abs(r.rangeM - dist) : Math.abs(r.rangeYd - dist);
      if (d < minDiff) { minDiff = d; closest = r; }
    }
    calcDropMoa = closest.dropMoa.toFixed(2);
    calcWindMoa = closest.windageMoa.toFixed(2);
  }

  const entry = {
    date: document.getElementById('dopeDate').value || new Date().toISOString().split('T')[0],
    weapon: document.getElementById('dopeWeapon').value,
    ammo: document.getElementById('dopeAmmo').value,
    scope: document.getElementById('dopeScope').value,
    distance: dist,
    distUnit: m ? 'm' : 'yd',
    temp: document.getElementById('dopeTemp').value,
    pressure: document.getElementById('pressure')?.value || '',
    humidity: document.getElementById('humidity')?.value || '',
    windSpeed: document.getElementById('dopeWind').value,
    windDir: document.getElementById('dopeWindDir').value,
    elevClicks: parseFloat(document.getElementById('dopeElevClicks').value) || 0,
    windClicks: parseFloat(document.getElementById('dopeWindClicks').value) || 0,
    elevMoa: parseFloat(document.getElementById('dopeElevMoa').value) || 0,
    windMoa: parseFloat(document.getElementById('dopeWindMoa').value) || 0,
    calcDropMoa: calcDropMoa,
    calcWindMoa: calcWindMoa,
    groupSize: parseFloat(document.getElementById('dopeGroupSize').value) || 0,
    poiResult: document.getElementById('dopePOI').value,
    notes: document.getElementById('dopeNotes').value
  };

  DOPE.add(entry);
  toggleDopeForm(); // Close form
  renderDopeLog();
  // Clear form fields
  ['dopeWeapon', 'dopeAmmo', 'dopeScope', 'dopeDist', 'dopeTemp', 'dopeWind',
   'dopeElevClicks', 'dopeWindClicks', 'dopeElevMoa', 'dopeWindMoa',
   'dopeGroupSize', 'dopeNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function renderDopeLog() {
  const entries = DOPE.getAll();
  const stats = DOPE.getStats();
  const m = appState.units === 'metric';
  const du = m ? 'm' : 'yd';

  // Stats badges
  const statsEl = document.getElementById('dopeStats');
  if (stats.count > 0) {
    statsEl.innerHTML = `
      <div class="dope-stat-badge"><span class="val">${stats.count}</span><span class="lbl">${I18n.t('dopeEntries')}</span></div>
      <div class="dope-stat-badge"><span class="val">${stats.sessions}</span><span class="lbl">${I18n.t('dopeSessions')}</span></div>
      <div class="dope-stat-badge"><span class="val">${stats.maxDistance.toFixed(0)}</span><span class="lbl">${I18n.t('dopeMaxDist')} (${du})</span></div>
      <div class="dope-stat-badge"><span class="val">${stats.avgGroupSize > 0 ? stats.avgGroupSize.toFixed(1) : '—'}</span><span class="lbl">${I18n.t('dopeAvgGroup')}</span></div>
    `;
  } else {
    statsEl.innerHTML = '';
  }

  // Empty state
  const emptyEl = document.getElementById('dopeEmpty');
  emptyEl.style.display = entries.length ? 'none' : '';

  // Table
  const thead = document.getElementById('dopeTableHead');
  const tbody = document.getElementById('dopeTableBody');

  if (!entries.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    return;
  }

  thead.innerHTML = `<tr>
    <th>${I18n.t('dopeDate')}</th>
    <th>${I18n.t('dopeDist')}</th>
    <th>${I18n.t('dopeWeapon')}</th>
    <th>${I18n.t('dopeAmmo')}</th>
    <th>${I18n.t('dopeHeaderElev')}</th><th>${I18n.t('dopeHeaderWind')}</th>
    <th>${I18n.t('dopeHeaderCalcDrop')}</th><th>${I18n.t('dopeHeaderCalcWind')}</th>
    <th>${I18n.t('dopeHeaderDeltaElev')}</th>
    <th>${I18n.t('dopeGroupSize')}</th>
    <th>${I18n.t('dopeHeaderPOI')}</th>
    <th>${I18n.t('dopeNotes')}</th>
    <th></th>
  </tr>`;

  tbody.innerHTML = entries.map(e => {
    const poiClass = e.poiResult === 'center' ? 'center' : e.poiResult === 'miss' ? 'miss' : 'off';
    const poiEmoji = {
      center: '✔️', high: '⬆️', low: '⬇️', left: '⬅️', right: '➡️',
      'high-left': '↖️', 'high-right': '↗️', 'low-left': '↙️', 'low-right': '↘️', miss: '❌'
    };
    const deltaElev = (e.calcDropMoa && e.elevMoa)
      ? (Math.abs(e.elevMoa) - Math.abs(parseFloat(e.calcDropMoa))).toFixed(1)
      : '—';
    const deltaClass = deltaElev !== '—' ?
      (parseFloat(deltaElev) > 0 ? 'color:#22c55e' : parseFloat(deltaElev) < 0 ? 'color:#ef4444' : '') : '';
    return `<tr>
      <td>${esc(e.date)}</td>
      <td>${esc(e.distance)} ${esc(e.distUnit || du)}</td>
      <td>${esc(e.weapon) || '—'}</td>
      <td>${esc(e.ammo) || '—'}</td>
      <td>${e.elevMoa ? e.elevMoa.toFixed(1) + ' MOA' : '—'}</td>
      <td>${e.windMoa ? e.windMoa.toFixed(1) + ' MOA' : '—'}</td>
      <td>${esc(e.calcDropMoa) || '—'}</td>
      <td>${esc(e.calcWindMoa) || '—'}</td>
      <td style="${deltaClass};font-weight:600">${deltaElev !== '—' ? (parseFloat(deltaElev) > 0 ? '+' : '') + deltaElev : '—'}</td>
      <td>${e.groupSize > 0 ? e.groupSize.toFixed(1) + ' MOA' : '—'}</td>
      <td><span class="poi-badge ${poiClass}">${poiEmoji[e.poiResult] || '?'}</span></td>
      <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(e.notes)}</td>
      <td><button type="button" class="dope-delete" data-delete-dope="${esc(e.id)}" title="${esc(I18n.t('deleteEntry'))}">✕</button></td>
    </tr>`;
  }).join('');
}

function deleteDope(id) {
  DOPE.remove(id);
  renderDopeLog();
}

function exportDOPE() {
  const csv = DOPE.exportCSV(appState.units);
  if (!csv) { alert(I18n.t('noExportData')); return; }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DOPE_BallisticPro_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function clearDOPE() {
  if (!confirm(I18n.t('confirmClearDOPE'))) return;
  DOPE.clearAll();
  renderDopeLog();
}

// ─── Species Specific Icons & Tactical SVG Medallions ───
function _getAnimalEmoji(a) {
  if (!a) return '🦌';
  const id = a.id || '';
  const exact = {
    castor: '🦫',
    rata_almizclera: '🐀',
    vison: '🦦',
    conejo: '🐰',
    liebre: '🐇',
    ardilla: '🐿️',
    zorro_gris: '🦊',
    coyote: '🦊',
    jabali: '🐗',
    guanaco: '🦙',
    cabra_asilvestrada: '🐐',
    bagual: '🐂',
    burro_asilvestrado: '🫏',
    ciervo_rojo: '🦌',
    gamo: '🦌',
    corzo: '🦌',
    ciervo_axis: '🦌',
    venado_cola_blanca: '🦌',
    alce: '🫎',
    caiquen: '🪿',
    canquen: '🪿',
    pato_criollo: '🦆',
    pato_juarjual: '🦆',
    pato_real: '🦆',
    pato_jergon_grande: '🦆',
    pato_jergon_chico: '🦆',
    pato_colorado: '🦆',
    tagua: '🦆',
    tagua_chica: '🦆',
    yeco: '🐦‍⬛',
    tortola: '🕊️',
    tortola_cordillerana: '🕊️',
    paloma_alas_blancas: '🕊️',
    paloma: '🕊️',
    codorniz: '🐦',
    perdiz_chilena: '🐦',
    faisan: '🦃',
    pavo_salvaje: '🦃',
    traro: '🦅',
    cotorra: '🦜',
    mirlo: '🐦‍⬛',
    tordo: '🐦‍⬛',
    cuervo: '🐦‍⬛',
    estornino: '🐦‍⬛',
    zorzal: '🐤',
    zorzal_jf: '🐤',
    chirihue: '🐤',
    chirihue_dorado: '🐤',
    yal: '🐤',
    diuca: '🐤',
    jilguero: '🐤',
    gorrion: '🐤'
  };
  if (exact[id]) return exact[id];
  const byType = {
    deer: '🦌', bovine: '🐂', camelid: '🦙', equine: '🫏',
    boar: '🐗', rabbit: '🐇', bird: '🕊️', duck: '🦆',
    goose: '🪿', coot: '🦆', cormorant: '🐦‍⬛', quail: '🐦',
    partridge: '🐦', pheasant: '🦃', raptor: '🦅', parrot: '🦜',
    songbird: '🐤', goat: '🐐', fox: '🦊', beaver: '🦫',
    muskrat: '🐀', mink: '🦦'
  };
  return byType[a.silhouetteType] || '🦌';
}

const VALID_SILHOUETTE_TYPES = new Set([
  'deer', 'bovine', 'camelid', 'equine', 'boar', 'rabbit',
  'bird', 'duck', 'goose', 'coot', 'cormorant', 'quail',
  'partridge', 'pheasant', 'raptor', 'parrot', 'songbird',
  'goat', 'fox', 'beaver', 'muskrat', 'mink'
]);

function _getSpeciesBadgeSVG(animal, accentColor) {
  const col = (typeof accentColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(accentColor)) ? accentColor : '#f59e0b';
  const silType = (animal && VALID_SILHOUETTE_TYPES.has(animal.silhouetteType)) ? animal.silhouetteType : 'deer';
  const vz = (typeof Silhouettes !== 'undefined' && Silhouettes.vitalZones && Silhouettes.vitalZones[silType])
    ? Silhouettes.vitalZones[silType]
    : { x: 0.47, y: 0.50 };

  // bird.png is 512x433 (aspect 1.1824); all other 21 PNGs in img/silhouettes/ are 512x512 (aspect 1.0)
  const aspect = silType === 'bird' ? (512 / 433) : 1.0;
  const box = 56;
  const imgW = box;
  const imgH = box / aspect;
  const imgX = 4;
  const imgY = 4 + (box - imgH) / 2;
  const vx = (imgX + vz.x * imgW).toFixed(1);
  const vy = (imgY + vz.y * imgH).toFixed(1);

  return `<svg viewBox="0 0 64 64" width="46" height="46" style="flex-shrink:0;display:block;background:radial-gradient(circle at 50% 50%, rgba(30,41,59,0.95) 0%, rgba(11,17,30,0.98) 100%);border:1.5px solid ${col};border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,0.45), inset 0 0 8px rgba(255,255,255,0.04)">
    <!-- Scope crosshair ticks -->
    <line x1="32" y1="2" x2="32" y2="8" stroke="${col}" stroke-width="1" opacity="0.45"/>
    <line x1="32" y1="56" x2="32" y2="62" stroke="${col}" stroke-width="1" opacity="0.45"/>
    <line x1="2" y1="32" x2="8" y2="32" stroke="${col}" stroke-width="1" opacity="0.45"/>
    <line x1="56" y1="32" x2="62" y2="32" stroke="${col}" stroke-width="1" opacity="0.45"/>
    <circle cx="32" cy="32" r="27" fill="none" stroke="${col}" stroke-width="0.6" stroke-dasharray="3,3" opacity="0.35"/>
    <!-- Official High-Res PNG Target Silhouette (img/silhouettes/*.png) -->
    <image href="img/silhouettes/${silType}.png" x="4" y="4" width="56" height="56" preserveAspectRatio="xMidYMid meet" style="filter:invert(0.92)"/>
    <!-- Vital Zone Target Dot -->
    <circle cx="${vx}" cy="${vy}" r="4.2" fill="rgba(239,68,68,0.28)" stroke="#ef4444" stroke-width="1.1"/>
    <circle cx="${vx}" cy="${vy}" r="1.5" fill="#ef4444"/>
  </svg>`;
}

// ─── Game Animals / Ethical Hunting Range ───
function populateGameAnimalSelect() {
  const sel = document.getElementById('gameAnimalSelect');
  if (!sel) return;
  const weaponType = document.getElementById('weaponType').value;
  const isAirgun = weaponType === 'airgun';
  const lang = appState.lang || 'es';

  const prevVal = sel.value;
  sel.innerHTML = `<option value="">${I18n.t('gameAnimalNone')}</option>`;

  const regionFlag = { CL: '🇨🇱', AR: '🇦🇷', INT: '🌎' };
  const regionLabel = {
    CL: lang === 'es' ? 'Chile (SAG)' : 'Chile (SAG)',
    AR: lang === 'es' ? 'Argentina' : 'Argentina',
    INT: lang === 'es' ? 'Internacional' : 'International'
  };

  // Filter by weapon type
  const filtered = appState.gameAnimalsDB.filter(a => {
    if (isAirgun && a.category === 'mayor') return false;
    return true;
  });

  // Build groups: category + region
  const groups = [
    { cat: 'menor', region: 'CL', label: (lang === 'es' ? 'Caza Menor' : 'Small Game') + ' — 🇨🇱' },
    { cat: 'menor', region: 'AR', label: (lang === 'es' ? 'Caza Menor' : 'Small Game') + ' — 🇦🇷' },
    { cat: 'menor', region: 'INT', label: (lang === 'es' ? 'Caza Menor' : 'Small Game') + ' — 🌎' },
    { cat: 'mayor', region: 'CL', label: (lang === 'es' ? 'Caza Mayor' : 'Big Game') + ' — 🇨🇱' },
    { cat: 'mayor', region: 'AR', label: (lang === 'es' ? 'Caza Mayor' : 'Big Game') + ' — 🇦🇷' },
    { cat: 'mayor', region: 'INT', label: (lang === 'es' ? 'Caza Mayor' : 'Big Game') + ' — 🌎' }
  ];

  groups.forEach(g => {
    const items = filtered.filter(a => a.category === g.cat && a.region === g.region);
    if (!items.length) return;
    const grp = document.createElement('optgroup');
    grp.label = g.label;
    items.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${_getAnimalEmoji(a)} ${lang === 'es' ? a.nameEs : a.nameEn}`;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });

  if (prevVal) sel.value = prevVal;
}

/** Populate independent silhouette selector for reticle view */
function populateReticleSilhouetteSelect() {
  const sel = document.getElementById('reticleSilhouetteSelect');
  if (!sel || !appState.gameAnimalsDB) return;
  const lang = appState.lang || 'es';
  const prevVal = sel.value;

  sel.innerHTML = '<option value="">—</option>';

  // Simple flat list — all animals, with specific species icon
  appState.gameAnimalsDB.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    const icon = _getAnimalEmoji(a);
    opt.textContent = `${icon} ${lang === 'es' ? a.nameEs : a.nameEn}`;
    sel.appendChild(opt);
  });

  if (prevVal) sel.value = prevVal;

  // On change — redraw reticle with new silhouette (no MPBR change)
  sel.onchange = () => {
    if (appState.results && appState.results.length) {
      updateReticleView();
    }
  };
}

// Format energy: metric → J primary, imperial → FPE primary
function fmtE(fpe, decimals) {
  const d = decimals || 0;
  const j = (fpe * 1.3558).toFixed(d);
  return appState.units === 'metric'
    ? j + ' J (' + fpe.toFixed(d) + ' FPE)'
    : fpe.toFixed(d) + ' FPE (' + j + ' J)';
}

function onGameAnimalChange() {
  const sel = document.getElementById('gameAnimalSelect');
  const id = sel.value;
  const infoEl = document.getElementById('gameAnimalInfo');

  if (!id) {
    infoEl.style.display = 'none';
    return;
  }

  const animal = appState.gameAnimalsDB.find(a => a.id === id);
  if (!animal) return;

  const m = appState.units === 'metric';
  const lang = appState.lang || 'es';

  // Auto-fill vital zone diameter
  if (m) {
    document.getElementById('mpbrVitalDiameter').value = animal.vitalZoneCm;
  } else {
    document.getElementById('mpbrVitalDiameter').value = (animal.vitalZoneCm / 2.54).toFixed(1);
  }
  // Update radius display
  const u = m ? 'cm' : 'in';
  const d = parseFloat(document.getElementById('mpbrVitalDiameter').value);
  document.getElementById('mpbrRadiusDisp').textContent = (d / 2).toFixed(1) + ' ' + u;

  // Show animal info
  infoEl.style.display = '';
  const statusMap = { 'dañina': 'statusDangerous', 'regulada': 'statusRegulated', 'especial': 'statusSpecial' };
  const statusKey = statusMap[animal.status] || 'statusRegulated';
  let statusText = I18n.t(statusKey);
  if (animal.category === 'mayor') statusText += ' · ' + I18n.t('firearmsOnly');
  document.getElementById('gameAnimalStatus').textContent = statusText;
  document.getElementById('gameAnimalMinE').textContent =
    fmtE(animal.minEnergyFPE, 1);

  // Evaluate hunting season against today's date
  const seasonBanner = document.getElementById('gameAnimalSeasonBanner');
  const seasonEval = _evalAnimalSeasonStatus(animal, 'all');
  if (seasonBanner) {
    seasonBanner.style.display = '';
    if (seasonEval.state === 'out_of_season') {
      seasonBanner.style.background = 'rgba(239,68,68,0.15)';
      seasonBanner.style.border = '1.5px solid #ef4444';
      seasonBanner.style.color = '#fecaca';
      seasonBanner.innerHTML = `<div style="font-weight:800;color:#f87171;font-size:0.82rem">${esc(I18n.t('outOfSeasonBanner'))}</div>` +
        `<div style="font-size:0.74rem;margin-top:2px">${
          lang === 'es'
            ? `Hoy (${esc(seasonEval.todayStr)}) está fuera del período habilitado (${esc(seasonEval.seasonSummary)}). Caza prohibida en esta fecha.`
            : `Today (${esc(seasonEval.todayStr)}) is outside the open season (${esc(seasonEval.seasonSummary)}). Hunting prohibited on this date.`
        }</div>`;
    } else if (seasonEval.state === 'in_season') {
      seasonBanner.style.background = 'rgba(34,197,94,0.12)';
      seasonBanner.style.border = '1px solid rgba(34,197,94,0.4)';
      seasonBanner.style.color = '#bbf7d0';
      seasonBanner.innerHTML = `<div style="font-weight:700;color:#4ade80;font-size:0.8rem">${esc(I18n.t('inSeasonBanner'))} (${esc(seasonEval.todayStr)})</div>` +
        `<div style="font-size:0.73rem;margin-top:1px">${
          lang === 'es'
            ? `Temporada activa: ${esc(seasonEval.seasonSummary)} · Zonas: ${esc(seasonEval.openZones.join(', '))}`
            : `Active season: ${esc(seasonEval.seasonSummary)} · Zones: ${esc(seasonEval.openZones.join(', '))}`
        }</div>`;
    } else if (seasonEval.state === 'open_all_year') {
      seasonBanner.style.background = 'rgba(34,197,94,0.10)';
      seasonBanner.style.border = '1px solid rgba(34,197,94,0.35)';
      seasonBanner.style.color = '#bbf7d0';
      seasonBanner.innerHTML = `<div style="font-weight:700;color:#4ade80;font-size:0.79rem">🟢 ${
        lang === 'es' ? 'CAZA HABILITADA TODO EL AÑO (Art. 6° Especie Dañina)' : 'OPEN YEAR-ROUND (Art. 6° Harmful Species)'
      }</div>`;
    } else if (seasonEval.state === 'special_permit') {
      seasonBanner.style.background = 'rgba(245,158,11,0.12)';
      seasonBanner.style.border = '1px solid rgba(245,158,11,0.4)';
      seasonBanner.style.color = '#fde68a';
      seasonBanner.innerHTML = `<div style="font-weight:700;color:#fbbf24;font-size:0.79rem">⚠️ ${
        lang === 'es' ? 'RÉGIMEN ESPECIAL SAG (Solo zonas autorizadas)' : 'SPECIAL SAG REGIME (Authorized zones only)'
      }</div>`;
    } else {
      seasonBanner.style.background = 'rgba(239,68,68,0.15)';
      seasonBanner.style.border = '1.5px solid #ef4444';
      seasonBanner.style.color = '#fecaca';
      seasonBanner.innerHTML = `<div style="font-weight:800;color:#f87171;font-size:0.8rem">🚫 ${
        lang === 'es' ? 'ESPECIE EN VEDA / CAZA NO HABILITADA' : 'CLOSED / HUNTING PROHIBITED'
      }</div>`;
    }
  }

  // Show regulation info (per-zone table) if available
  const regEl = document.getElementById('gameAnimalRegulation');
  const regBody = document.getElementById('gameAnimalRegBody');
  if (animal.regulations && animal.regulations.length) {
    regEl.style.display = '';
    regBody.innerHTML = '';
    animal.regulations.forEach(r => {
      const tr = document.createElement('tr');
      const rEval = _evalRegulationSeason(r);
      const isProtected = r.season === 'PROTEGIDA';
      const isZero = r.quota === 0 || r.quota === '0';
      // Format quota: number → "X/día", 0 → "—", string → as-is
      let qDisp = r.quota;
      if (typeof r.quota === 'number') {
        qDisp = r.quota === 0 ? '—' : r.quota + '/día';
      }
      const notesAttr = r.notes ? ` title="${esc(r.notes)}"` : '';
      const zoneColor = isZero ? '#64748b' : '#e2e8f0';
      const seasonColor = isProtected || rEval.state === 'out_of_season'
        ? '#f87171'
        : (isZero ? '#64748b' : '#4ade80');
      const quotaColor = isZero ? '#64748b' : '#e2e8f0';
      const statusDot = rEval.state === 'out_of_season'
        ? ` <span style="color:#ef4444;font-size:0.68rem">⛔ ${lang === 'es' ? 'Fuera de fecha' : 'Out of season'}</span>`
        : (rEval.inSeason ? ' <span style="color:#22c55e;font-size:0.68rem">🟢</span>' : '');
      tr.innerHTML = `<td style="padding:3px 4px;color:${zoneColor}"${notesAttr}>${esc(r.zone)}${r.notes ? ' *' : ''}</td>` +
        `<td style="padding:3px 4px;color:${seasonColor};font-weight:600">${isZero ? '—' : esc(r.season)}${statusDot}</td>` +
        `<td style="padding:3px 4px;color:${quotaColor};font-weight:600">${esc(qDisp)}</td>`;
      regBody.appendChild(tr);
    });
  } else {
    regEl.style.display = 'none';
  }

  // Refresh main ballistic alerts if results exist
  if (appState.results && appState.results.length) {
    renderBallisticAlerts(appState.results);
  }

  // Show data date
  const dataDate = appState.gameAnimalsDBMeta ? appState.gameAnimalsDBMeta.lastUpdated : '—';
  const dateLabel = lang === 'es' ? 'Datos: ' : 'Data: ';
  document.getElementById('gameAnimalDataDate').textContent = '📅 ' + dateLabel + dataDate;
}

function updateEthicalRange(mpbrResult) {
  const sel = document.getElementById('gameAnimalSelect');
  const panel = document.getElementById('ethicalRangePanel');
  if (!sel || !sel.value) {
    if (panel) panel.style.display = 'none';
    return;
  }

  const animal = appState.gameAnimalsDB.find(a => a.id === sel.value);
  if (!animal || !mpbrResult || !mpbrResult.trajectory) {
    if (panel) panel.style.display = 'none';
    return;
  }

  const m = appState.units === 'metric';
  const du = m ? 'm' : 'yd';
  const lang = appState.lang || 'es';
  const traj = mpbrResult.trajectory;
  const minFPE = animal.minEnergyFPE;
  const mpbrM = mpbrResult.mpbrM;

  // Check muzzle energy first
  const muzzleEnergy = traj[0] ? traj[0].energyFtLbs : 0;

  // Find distance where energy drops below minimum
  let energyLimitM = null;
  for (let i = 0; i < traj.length; i++) {
    if (traj[i].energyFtLbs < minFPE) {
      if (i > 0) {
        const prev = traj[i - 1];
        const curr = traj[i];
        const t = (minFPE - prev.energyFtLbs) / (curr.energyFtLbs - prev.energyFtLbs);
        energyLimitM = prev.rangeM + t * (curr.rangeM - prev.rangeM);
      } else {
        energyLimitM = 0; // Muzzle energy already below minimum
      }
      break;
    }
  }

  // If energy never drops below minimum within trajectory range = unlimited by energy
  if (energyLimitM === null) {
    energyLimitM = Infinity;
  }

  // Find energy at MPBR distance
  let energyAtMPBR = 0;
  for (let i = 1; i < traj.length; i++) {
    if (traj[i].rangeM >= mpbrM) {
      const prev = traj[i - 1];
      const curr = traj[i];
      const t = (mpbrM - prev.rangeM) / (curr.rangeM - prev.rangeM);
      energyAtMPBR = prev.energyFtLbs + t * (curr.energyFtLbs - prev.energyFtLbs);
      break;
    }
  }

  // Display results
  panel.style.display = '';
  const reasonEl = document.getElementById('ethicalLimitReason');
  const valueEl = document.getElementById('ethicalRangeValue');
  const mpbrDist = m ? mpbrM.toFixed(0) : (mpbrM * 1.09361).toFixed(0);

  // Case 1: Muzzle energy insufficient — can't hunt this game at all
  if (energyLimitM === 0) {
    const insufficientMsg = lang === 'es' ? '⛔ Energía insuficiente' : '⛔ Insufficient energy';
    valueEl.textContent = insufficientMsg;
    valueEl.style.color = '#ef4444';
    document.getElementById('ethicalMPBR').textContent = mpbrDist + ' ' + du;
    document.getElementById('ethicalMinEnergy').textContent =
      fmtE(minFPE) + ' — ' + (lang === 'es' ? 'Boca: ' : 'Muzzle: ') + fmtE(muzzleEnergy, 1);
    document.getElementById('ethicalEnergyAtMPBR').textContent = fmtE(energyAtMPBR, 1);
    reasonEl.textContent = '⛔ ' + (lang === 'es'
      ? `Energía en boca (${fmtE(muzzleEnergy)}) menor que mínima (${fmtE(minFPE)})`
      : `Muzzle energy (${fmtE(muzzleEnergy)}) below minimum (${fmtE(minFPE)})`);
    panel.style.borderColor = 'rgba(239,68,68,0.4)';
    panel.style.background = 'rgba(239,68,68,0.08)';
    return;
  }

  // Case 2 & 3: Show energy-based ethical range (independent of MPBR)
  const energyLimitDist = energyLimitM === Infinity
    ? (lang === 'es' ? '> alcance calc.' : '> calc. range')
    : (m ? energyLimitM.toFixed(0) : (energyLimitM * 1.09361).toFixed(0)) + ' ' + du;

  // Ethical range = energy limit (not capped by MPBR)
  valueEl.textContent = energyLimitM === Infinity
    ? (lang === 'es' ? '> ' + mpbrDist + ' ' + du + ' (sobra energía)' : '> ' + mpbrDist + ' ' + du + ' (energy surplus)')
    : (m ? energyLimitM.toFixed(0) : (energyLimitM * 1.09361).toFixed(0)) + ' ' + du;

  document.getElementById('ethicalMPBR').textContent = mpbrDist + ' ' + du;
  document.getElementById('ethicalMinEnergy').textContent =
    fmtE(minFPE) + ' → ' + energyLimitDist;
  document.getElementById('ethicalEnergyAtMPBR').textContent = fmtE(energyAtMPBR, 1);

  // Color: based on energy limit vs MPBR relationship
  if (energyLimitM < mpbrM) {
    // Energy runs out BEFORE MPBR — red, energy is the real limit
    reasonEl.textContent = '⚠️ ' + (lang === 'es'
      ? `Energía cae a ${fmtE(minFPE)} antes del MPBR`
      : `Energy drops to ${fmtE(minFPE)} before MPBR`);
    valueEl.style.color = '#ef4444';
    panel.style.borderColor = 'rgba(239,68,68,0.3)';
    panel.style.background = 'rgba(239,68,68,0.06)';
  } else if (energyLimitM !== Infinity && energyLimitM < mpbrM * 1.5) {
    // Energy close to MPBR — yellow, caution
    reasonEl.textContent = '⚠️ ' + (lang === 'es'
      ? `Energía justa — margen reducido más allá del MPBR`
      : `Tight energy — reduced margin beyond MPBR`);
    valueEl.style.color = '#f59e0b';
    panel.style.borderColor = 'rgba(245,158,11,0.3)';
    panel.style.background = 'rgba(245,158,11,0.06)';
  } else {
    // Energy lasts well beyond MPBR — green
    reasonEl.textContent = '✔ ' + (lang === 'es'
      ? 'Energía suficiente en todo el rango útil'
      : 'Sufficient energy across useful range');
    valueEl.style.color = '#22c55e';
    panel.style.borderColor = 'rgba(34,197,94,0.2)';
    panel.style.background = 'rgba(34,197,94,0.06)';
  }
}

// ─── Game Animals DB Security Validator & Updater ───
function _isAllowedUpdateUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const u = new URL(urlStr, window.location.origin);
    if (u.origin === window.location.origin) return true;
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host === 'raw.githubusercontent.com' || host.endsWith('.github.io');
  } catch (e) {
    return false;
  }
}

function _sanitizeGameAnimalsPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!data.meta || typeof data.meta !== 'object' || !Array.isArray(data.animals)) return null;
  if (data.animals.length < 1 || data.animals.length > 500) return null;
  const lastUpdated = String(data.meta.lastUpdated || '');
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(lastUpdated)) return null;

  const cleanAnimals = [];
  for (const a of data.animals) {
    if (!a || typeof a !== 'object') return null;
    if (typeof a.id !== 'string' || !/^[a-zA-Z0-9_]{1,64}$/.test(a.id)) return null;
    // Reject legacy flat schema lacking regulations on CL entries
    if (a.season && !a.regulations) return null;

    const regs = Array.isArray(a.regulations)
      ? a.regulations.slice(0, 20).filter(r => r && typeof r === 'object').map(r => ({
          zone: String(r.zone || '').slice(0, 120),
          season: String(r.season || '—').slice(0, 80),
          quota: typeof r.quota === 'number' && Number.isFinite(r.quota)
            ? Math.max(0, Math.min(r.quota, 10000))
            : String(r.quota ?? '—').slice(0, 60),
          ...(r.notes ? { notes: String(r.notes).slice(0, 240) } : {})
        }))
      : undefined;

    cleanAnimals.push({
      id: a.id,
      nameEs: String(a.nameEs || a.id).slice(0, 100),
      nameEn: String(a.nameEn || a.nameEs || a.id).slice(0, 100),
      scientificName: String(a.scientificName || '').slice(0, 120),
      category: a.category === 'mayor' ? 'mayor' : 'menor',
      region: ['CL', 'AR', 'INT'].includes(a.region) ? a.region : 'INT',
      status: ['regulada', 'dañina', 'especial'].includes(a.status) ? a.status : 'regulada',
      vitalZoneCm: Math.min(Math.max(Number(a.vitalZoneCm) || 5, 0.5), 100),
      minEnergyFPE: Math.min(Math.max(Number(a.minEnergyFPE) || 1, 0.5), 10000),
      weightKg: Math.min(Math.max(Number(a.weightKg) || 1, 0.005), 2000),
      bodyHeightCm: Math.min(Math.max(Number(a.bodyHeightCm) || 20, 3), 300),
      silhouetteType: VALID_SILHOUETTE_TYPES.has(a.silhouetteType) ? a.silhouetteType : 'generic',
      ...(regs ? { regulations: regs } : {})
    });
  }

  const cleanMeta = {
    lastUpdated,
    dataYear: Number(data.meta.dataYear) || new Date().getFullYear(),
    warning_es: String(data.meta.warning_es || '').slice(0, 400),
    warning_en: String(data.meta.warning_en || '').slice(0, 400),
    ...(typeof data.meta.updateUrl === 'string' && _isAllowedUpdateUrl(data.meta.updateUrl)
      ? { updateUrl: data.meta.updateUrl }
      : {})
  };
  return { meta: cleanMeta, animals: cleanAnimals };
}

async function updateGameAnimalsDB() {
  const btn = document.getElementById('btnUpdateDB');
  const lang = appState.lang || 'es';
  const originalText = btn.textContent;

  // Get update URL from meta, localStorage, or prompt
  let updateUrl = '';
  if (appState.gameAnimalsDBMeta && _isAllowedUpdateUrl(appState.gameAnimalsDBMeta.updateUrl)) {
    updateUrl = appState.gameAnimalsDBMeta.updateUrl;
  }
  if (!updateUrl) {
    const storedUrl = localStorage.getItem('gameAnimalsUpdateUrl') || '';
    if (_isAllowedUpdateUrl(storedUrl)) updateUrl = storedUrl;
    else if (storedUrl) localStorage.removeItem('gameAnimalsUpdateUrl');
  }
  let fromPrompt = false;
  if (!updateUrl) {
    const msg = lang === 'es'
      ? 'Ingrese la URL HTTPS oficial (github.io / raw.githubusercontent.com) del archivo game-animals.json:\n\nEjemplo: https://usuario.github.io/repo/game-animals.json'
      : 'Enter the official HTTPS URL (github.io / raw.githubusercontent.com) of game-animals.json:\n\nExample: https://user.github.io/repo/game-animals.json';
    updateUrl = (prompt(msg) || '').trim();
    if (!updateUrl) return;
    fromPrompt = true;
  }

  if (!_isAllowedUpdateUrl(updateUrl)) {
    alert(lang === 'es'
      ? 'URL bloqueada por seguridad: solo se permiten orígenes HTTPS confiables (*.github.io o raw.githubusercontent.com).'
      : 'URL blocked for security: only trusted HTTPS origins (*.github.io or raw.githubusercontent.com) are allowed.');
    return;
  }

  btn.textContent = '⏳ ...';
  btn.disabled = true;

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;

  try {
    const res = await fetch(updateUrl, {
      cache: 'no-store',
      credentials: 'omit',
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rawData = await res.json();
    const data = _sanitizeGameAnimalsPayload(rawData);

    if (!data) {
      throw new Error(lang === 'es' ? 'Formato inválido' : 'Invalid format');
    }

    if (fromPrompt) {
      localStorage.setItem('gameAnimalsUpdateUrl', updateUrl);
    }

    const currentDate = appState.gameAnimalsDBMeta ? appState.gameAnimalsDBMeta.lastUpdated : '0';
    const newDate = data.meta.lastUpdated || '0';

    if (newDate <= currentDate) {
      btn.textContent = '✔ ' + (lang === 'es' ? 'Ya actualizado' : 'Up to date');
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
      return;
    }

    // Save validated payload to localStorage and update appState
    localStorage.setItem('gameAnimalsDB', JSON.stringify(data));
    appState.gameAnimalsDB = data.animals;
    appState.gameAnimalsDBMeta = data.meta;

    // Refresh the selector
    populateGameAnimalSelect();
    populateReticleSilhouetteSelect();

    // Update date display
    const sel = document.getElementById('gameAnimalSelect');
    if (sel && sel.value) onGameAnimalChange();
    if (document.getElementById('huntingLawModal')?.style.display === 'flex') {
      renderHuntingLawCartilla();
    }

    const count = data.animals.length;
    btn.textContent = '✔ ' + (lang === 'es'
      ? `${count} especies (${newDate})`
      : `${count} species (${newDate})`);
    btn.style.color = '#22c55e';
    setTimeout(() => { btn.textContent = originalText; btn.style.color = ''; btn.disabled = false; }, 3000);

  } catch (e) {
    console.error('Update game animals DB error:', e);
    btn.textContent = '❌ ' + e.message;
    btn.style.color = '#ef4444';
    setTimeout(() => { btn.textContent = originalText; btn.style.color = ''; btn.disabled = false; }, 3000);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Cartilla de Caza SAG (Ley N° 19.473 / D.S. N° 5) ───
function _zoneAppliesTo(regZone, selectedZone) {
  if (!regZone || selectedZone === 'all') return true;
  if (regZone.startsWith('Nacional')) return true;
  if (selectedZone === 'Norte') return regZone.startsWith('Norte');
  if (selectedZone === 'Centro') return regZone.startsWith('Centro') || regZone.includes('V Región');
  if (selectedZone === 'Sur') return regZone.startsWith('Sur');
  if (selectedZone === 'Austral') return regZone.startsWith('Austral') || regZone.includes('XII Región');
  return false;
}

function _isRegPermitted(reg) {
  if (!reg) return false;
  if (reg.season === 'PROTEGIDA') return false;
  if (reg.quota === 0 || reg.quota === '0') return false;
  return true;
}

const _MONTH_MAP = {
  ene: 1, jan: 1,
  feb: 2,
  mar: 3,
  abr: 4, apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8, aug: 8,
  sep: 9, set: 9,
  oct: 10,
  nov: 11,
  dic: 12, dec: 12
};

const _MONTH_NAMES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const _MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _parseSeasonDateRange(seasonStr) {
  if (!seasonStr || typeof seasonStr !== 'string') return null;
  const m = seasonStr.trim().match(/^(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]{3})\s*[—\-–a]\s*(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]{3})$/);
  if (!m) return null;
  const d1 = parseInt(m[1], 10);
  const m1 = _MONTH_MAP[m[2].toLowerCase()];
  const d2 = parseInt(m[3], 10);
  const m2 = _MONTH_MAP[m[4].toLowerCase()];
  if (!m1 || !m2 || !d1 || !d2) return null;
  return { d1, m1, d2, m2 };
}

function _evalRegulationSeason(reg, refDate) {
  const now = refDate instanceof Date ? refDate : new Date();
  if (!reg || reg.season === 'PROTEGIDA') {
    return { state: 'protected', inSeason: false };
  }
  if (reg.quota === 0 || reg.quota === '0' || reg.season === '—') {
    return { state: 'closed', inSeason: false };
  }
  const s = (reg.season || '').trim();
  if (s === 'Todo el año' || s.toLowerCase() === 'year-round') {
    return { state: 'open_all_year', inSeason: true };
  }
  if (s === 'Regulada por SAG') {
    return { state: 'special_permit', inSeason: true };
  }
  const parsed = _parseSeasonDateRange(s);
  if (parsed) {
    const mmdd = (now.getMonth() + 1) * 100 + now.getDate();
    const start = parsed.m1 * 100 + parsed.d1;
    const end = parsed.m2 * 100 + parsed.d2;
    const active = start <= end
      ? (mmdd >= start && mmdd <= end)
      : (mmdd >= start || mmdd <= end);
    return { state: active ? 'in_season' : 'out_of_season', inSeason: active };
  }
  return { state: 'in_season', inSeason: true };
}

function _evalAnimalSeasonStatus(animal, zoneFilter, refDate) {
  const now = refDate instanceof Date ? refDate : new Date();
  const lang = appState.lang || 'es';
  const mNames = lang === 'es' ? _MONTH_NAMES_ES : _MONTH_NAMES_EN;
  const todayStr = `${now.getDate()} ${mNames[now.getMonth()]}`;
  const zf = zoneFilter || 'all';

  if (!animal || !animal.regulations || !animal.regulations.length) {
    if (animal && animal.status === 'dañina') {
      return { state: 'open_all_year', inSeason: true, openZones: ['Nacional'], seasonSummary: 'Todo el año', todayStr };
    }
    return { state: 'in_season', inSeason: true, openZones: [], seasonSummary: '—', todayStr };
  }

  const matchingRegs = animal.regulations.filter(r => _zoneAppliesTo(r.zone, zf));
  const evals = matchingRegs.map(r => ({ reg: r, ev: _evalRegulationSeason(r, now) }));

  const openZones = evals.filter(x => x.ev.inSeason).map(x => x.reg.zone.replace(/\s*\(.*\)/, ''));
  const permittedSeasons = [...new Set(
    evals.filter(x => _isRegPermitted(x.reg)).map(x => x.reg.season)
  )];
  const seasonSummary = permittedSeasons.join(' / ') || '—';

  if (evals.some(x => x.ev.state === 'open_all_year')) {
    return { state: 'open_all_year', inSeason: true, openZones, seasonSummary, todayStr };
  }
  if (evals.some(x => x.ev.state === 'in_season')) {
    return { state: 'in_season', inSeason: true, openZones, seasonSummary, todayStr };
  }
  if (evals.some(x => x.ev.state === 'special_permit')) {
    return { state: 'special_permit', inSeason: true, openZones, seasonSummary, todayStr };
  }
  if (evals.some(x => x.ev.state === 'out_of_season')) {
    return { state: 'out_of_season', inSeason: false, openZones: [], seasonSummary, todayStr };
  }
  return { state: 'closed', inSeason: false, openZones: [], seasonSummary, todayStr };
}

function openHuntingLaw() {
  const modal = document.getElementById('huntingLawModal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderHuntingLawCartilla();
}

function closeHuntingLaw() {
  const modal = document.getElementById('huntingLawModal');
  if (modal) modal.style.display = 'none';
}

function selectAnimalFromCartilla(animalId) {
  const animal = (appState.gameAnimalsDB || []).find(a => a.id === animalId);
  if (!animal) return;

  // Ensure gameAnimalSelect includes this animal (if mayor + airgun, temporarily allow or switch)
  const wTypeEl = document.getElementById('weaponType');
  if (animal.category === 'mayor' && wTypeEl && wTypeEl.value === 'airgun') {
    populateGameAnimalSelect();
  }
  const sel = document.getElementById('gameAnimalSelect');
  if (sel) {
    // If option not in select (e.g. airgun + mayor), append it so user can still inspect MPBR/energy warning
    if (!Array.from(sel.options).some(o => o.value === animal.id)) {
      const opt = document.createElement('option');
      opt.value = animal.id;
      opt.textContent = (appState.lang === 'es' ? animal.nameEs : animal.nameEn);
      sel.appendChild(opt);
    }
    sel.value = animal.id;
    onGameAnimalChange();
  }
  const silSel = document.getElementById('reticleSilhouetteSelect');
  if (silSel && Array.from(silSel.options).some(o => o.value === animal.id)) {
    silSel.value = animal.id;
  }

  closeHuntingLaw();
  openMPBR();
  try { calculateMPBR(); } catch (e) {}
}

function renderHuntingLawCartilla() {
  const listEl = document.getElementById('huntingLawList');
  if (!listEl) return;

  const lang = appState.lang || 'es';
  const isMetric = appState.units === 'metric';
  const zoneFilter = document.getElementById('hlZoneSelect')?.value || 'all';
  const catFilter = document.getElementById('hlCatSelect')?.value || 'all';
  const statusFilter = document.getElementById('hlStatusSelect')?.value || 'all';
  const searchQuery = (document.getElementById('hlSearchInput')?.value || '').trim().toLowerCase();

  const clAnimals = (appState.gameAnimalsDB || []).filter(a => a.region === 'CL');

  const filtered = clAnimals.filter(a => {
    if (catFilter !== 'all' && a.category !== catFilter) return false;
    if (statusFilter === 'open_now') {
      const sc = _evalAnimalSeasonStatus(a, zoneFilter);
      if (!sc.inSeason) return false;
    } else if (statusFilter !== 'all' && a.status !== statusFilter) {
      return false;
    }
    if (zoneFilter !== 'all') {
      const regs = a.regulations || [];
      const allowedInZone = regs.some(r => _zoneAppliesTo(r.zone, zoneFilter) && _isRegPermitted(r));
      if (!allowedInZone) return false;
    }
    if (searchQuery) {
      const hay = `${a.nameEs || ''} ${a.nameEn || ''} ${a.scientificName || ''}`.toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  const countBadge = document.getElementById('hlCountBadge');
  if (countBadge) {
    countBadge.textContent = lang === 'es'
      ? `${filtered.length} de ${clAnimals.length} especies`
      : `${filtered.length} of ${clAnimals.length} species`;
  }

  const meta = appState.gameAnimalsDBMeta;
  const warnEl = document.getElementById('hlWarningText');
  if (warnEl && meta) {
    warnEl.textContent = '⚠️ ' + (lang === 'es' ? (meta.warning_es || I18n.t('verifySAG')) : (meta.warning_en || I18n.t('verifySAG')));
  }
  const verEl = document.getElementById('hlDataVersion');
  if (verEl && meta) {
    verEl.textContent = `SAG ${meta.lastUpdated || ''}`;
  }

  if (!filtered.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:24px;color:#94a3b8;font-size:0.85rem">${
      lang === 'es'
        ? 'No se encontraron especies permitidas con los filtros seleccionados.'
        : 'No permitted species found with the selected filters.'
    }</div>`;
    return;
  }

  const statusMeta = {
    regulada: {
      label: lang === 'es' ? 'Art. 5° Temporada Regulada' : 'Art. 5° Regulated Season',
      bg: 'rgba(56,189,248,0.12)',
      border: 'rgba(56,189,248,0.35)',
      color: '#38bdf8'
    },
    'dañina': {
      label: lang === 'es' ? 'Art. 6° Dañina — Todo el año' : 'Art. 6° Harmful — Year-round',
      bg: 'rgba(34,197,94,0.12)',
      border: 'rgba(34,197,94,0.35)',
      color: '#22c55e'
    },
    especial: {
      label: lang === 'es' ? 'Régimen Especial (XII Región)' : 'Special Regime (XII Region)',
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(245,158,11,0.35)',
      color: '#f59e0b'
    }
  };

  listEl.innerHTML = filtered.map(a => {
    const st = statusMeta[a.status] || statusMeta.regulada;
    const sc = _evalAnimalSeasonStatus(a, zoneFilter);
    const isOutOfSeason = sc.state === 'out_of_season';
    const badgeSvg = _getSpeciesBadgeSVG(a, isOutOfSeason ? '#ef4444' : st.color);
    const emoji = _getAnimalEmoji(a);
    const name = lang === 'es' ? a.nameEs : a.nameEn;
    const catBadge = a.category === 'mayor'
      ? (lang === 'es' ? 'Caza Mayor' : 'Big Game')
      : (lang === 'es' ? 'Caza Menor' : 'Small Game');
    const catColor = a.category === 'mayor' ? '#f59e0b' : '#a78bfa';
    const vitalDisp = isMetric
      ? `⌀ ${a.vitalZoneCm} cm`
      : `⌀ ${(a.vitalZoneCm / 2.54).toFixed(1)} in`;
    const minEDisp = fmtE(a.minEnergyFPE, 0);

    let seasonChip = '';
    if (sc.state === 'out_of_season') {
      seasonChip = `<span class="hl-season-chip out" style="padding:1px 7px;border-radius:99px;background:rgba(239,68,68,0.18);border:1px solid #ef4444;color:#fca5a5;font-weight:700">${esc(I18n.t('outOfSeasonShort'))}</span>`;
    } else if (sc.state === 'in_season' || sc.state === 'open_all_year') {
      seasonChip = `<span class="hl-season-chip open" style="padding:1px 7px;border-radius:99px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.45);color:#4ade80;font-weight:700">${esc(I18n.t('inSeasonShort'))}</span>`;
    }

    const rowsHtml = (a.regulations || []).map(r => {
      const permitted = _isRegPermitted(r);
      const rEval = _evalRegulationSeason(r);
      const matchesSelectedZone = zoneFilter === 'all' || _zoneAppliesTo(r.zone, zoneFilter);
      let qDisp = r.quota;
      if (typeof r.quota === 'number') {
        qDisp = r.quota === 0
          ? (lang === 'es' ? '0 (Vedada)' : '0 (Closed)')
          : `${r.quota} / ${lang === 'es' ? 'día' : 'day'}`;
      }
      const seasonDisp = (r.quota === 0 || r.quota === '0') && r.season === '—'
        ? (lang === 'es' ? 'Vedada en esta zona' : 'Closed in this zone')
        : r.season;

      const dateTag = rEval.state === 'out_of_season'
        ? ` <span style="color:#f87171;font-size:0.66rem;font-weight:700">⛔ ${lang === 'es' ? 'Fuera de fecha' : 'Out of season'}</span>`
        : (rEval.inSeason ? ` <span style="color:#4ade80;font-size:0.66rem">🟢</span>` : '');

      const rowOpacity = (!matchesSelectedZone && zoneFilter !== 'all') ? '0.4' : (permitted ? '1' : '0.55');
      const highlightBg = (zoneFilter !== 'all' && matchesSelectedZone && permitted)
        ? (rEval.inSeason ? 'background:rgba(34,197,94,0.08);' : 'background:rgba(239,68,68,0.08);')
        : '';
      const seasonColor = (r.season === 'PROTEGIDA' || rEval.state === 'out_of_season')
        ? '#f87171'
        : (permitted ? '#e2e8f0' : '#64748b');
      const quotaColor = permitted ? (rEval.inSeason ? '#22c55e' : '#f59e0b') : '#ef4444';

      const notesHtml = r.notes
        ? `<div style="font-size:0.68rem;color:#94a3b8;font-weight:400;margin-top:1px">ℹ️ ${esc(r.notes)}</div>`
        : '';

      return `<tr style="border-top:1px solid rgba(255,255,255,0.05);opacity:${rowOpacity};${highlightBg}">
        <td style="padding:4px 6px;font-weight:600;color:#cbd5e1;width:34%">${esc(r.zone)}</td>
        <td style="padding:4px 6px;color:${seasonColor};font-weight:600;width:42%">${esc(seasonDisp)}${dateTag}${notesHtml}</td>
        <td style="padding:4px 6px;color:${quotaColor};font-weight:700;font-family:var(--font-mono);text-align:right;width:24%">${esc(qDisp)}</td>
      </tr>`;
    }).join('');

    const cardBorder = isOutOfSeason ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.08)';
    return `<div class="hl-species-card" style="background:rgba(255,255,255,0.025);border:1px solid ${cardBorder};border-radius:10px;padding:9px 11px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:9px;min-width:0;flex:1">
          ${badgeSvg}
          <div style="min-width:0;flex:1">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <strong style="font-size:0.88rem;color:#f8fafc">${emoji} ${esc(name)}</strong>
              <em style="font-size:0.74rem;color:#64748b">${esc(a.scientificName || '')}</em>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;font-size:0.68rem">
              ${seasonChip}
              <span style="padding:1px 7px;border-radius:99px;background:${st.bg};border:1px solid ${st.border};color:${st.color};font-weight:600">${esc(st.label)}</span>
              <span style="padding:1px 6px;border-radius:6px;background:rgba(255,255,255,0.05);color:${catColor};font-weight:600">${esc(catBadge)}</span>
              <span style="color:#94a3b8;font-family:var(--font-mono)">${esc(vitalDisp)} · E≥${esc(minEDisp)}</span>
            </div>
          </div>
        </div>
        <button type="button" data-select-animal="${esc(a.id)}" style="background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.4);color:#f59e0b;border-radius:6px;padding:4px 9px;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap">${esc(I18n.t('hlUseInMPBR'))}</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:0.75rem">
        <thead>
          <tr style="color:#64748b;font-size:0.66rem;text-transform:uppercase;text-align:left">
            <th style="padding:2px 6px">${esc(I18n.t('zonesLabel'))}</th>
            <th style="padding:2px 6px">${esc(I18n.t('seasonLabel'))}</th>
            <th style="padding:2px 6px;text-align:right">${esc(I18n.t('quotaLabel'))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
// PRESETS — Saved weapon+optic+ammo setups
// ══════════════════════════════════════════════

const PRESET_STORAGE_KEY = 'ballisticpro_presets';

function _getPresets() {
  try { return JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY)) || []; }
  catch (e) { return []; }
}
function _savePresets(list) {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(list));
}

/** IDs of all form fields to capture in a preset */
const PRESET_FIELDS = [
  // Weapon
  'weaponType', 'caliberSelect', 'twistRate', 'twistDir', 'zeroRange',
  // Optics
  'scopeSelect', 'scopeHeight', 'focalPlane', 'reticleType', 'reticleUnit',
  'clickElev', 'clickWind', 'turretUnit', 'magRef', 'magMin', 'magMax',
  // Projectile
  'projSelect', 'projWeight', 'projDiam', 'projLength', 'projBC', 'dragModel', 'muzzleVel'
];

/** Capture current form values into a preset object.
 *  Stores the raw displayed values + the current unit system.
 */
function _capturePreset() {
  const data = {};
  PRESET_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  data._savedUnits = appState.units; // 'imperial' or 'metric'
  return data;
}

/** Restore form values from a preset object. */
function _restorePreset(data) {
  if (!data) return;
  const savedUnits = data._savedUnits || 'imperial';
  const currentUnits = appState.units;

  // Set weapon type and repopulate select lists WITHOUT resetting numeric fields
  if (data.weaponType) {
    document.getElementById('weaponType').value = data.weaponType;
    populateWeaponSelect();
    // Select the saved weapon BEFORE building the ammo list so it is filtered to its calibre
    const wSel = document.getElementById('caliberSelect');
    if (data.caliberSelect != null && Array.from(wSel.options).some(o => o.value === data.caliberSelect)) {
      wSel.value = data.caliberSelect;
    }
    populateProjectileSelect();
  }

  // Set all field values (as saved — in whatever unit system they were saved)
  PRESET_FIELDS.forEach(id => {
    if (id === 'weaponType') return;
    if (data[id] == null) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') {
      const optExists = Array.from(el.options).some(o => o.value === data[id]);
      if (optExists) el.value = data[id];
    } else {
      el.value = data[id];
    }
  });

  // Only convert if preset has a _savedUnits flag AND it differs from current
  if (data._savedUnits && data._savedUnits !== currentUnits) {
    const toMetric = currentUnits === 'metric';
    Object.keys(UnitDefs).forEach(id => {
      if (data[id] == null) return;
      convertFieldValue(id, toMetric);
    });
  }

  updateUnitLabels();
  updateReticleMagSliderLimits(true);
  onReticleChange();
  updateAtmoDisplay();
  updateWindDisplay();
}

/** Generate a descriptive name for the current setup */
function _generatePresetName() {
  const weapon = document.getElementById('caliberSelect');
  const scope = document.getElementById('scopeSelect');
  const proj = document.getElementById('projSelect');

  let parts = [];
  if (weapon && weapon.selectedIndex > 0) {
    parts.push(weapon.options[weapon.selectedIndex].text);
  } else {
    parts.push(document.getElementById('twistRate').value + '" twist');
  }
  if (scope && scope.selectedIndex > 0) {
    parts.push(scope.options[scope.selectedIndex].text);
  }
  if (proj && proj.selectedIndex > 0) {
    parts.push(proj.options[proj.selectedIndex].text);
  } else {
    parts.push(document.getElementById('projWeight').value + 'gr');
  }
  return parts.join(' + ');
}

/** Populate the preset selector dropdown */
function populatePresetSelect() {
  const sel = document.getElementById('presetSelect');
  if (!sel) return;
  const presets = _getPresets();
  // Clear all except the first "none" option
  while (sel.options.length > 1) sel.remove(1);
  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

/** Save current configuration as a new preset */
function onPresetSave() {
  const suggested = _generatePresetName();
  const lang = appState.lang || 'es';
  const promptMsg = lang === 'es' ? 'Nombre para esta configuración:' : 'Name for this setup:';
  const name = prompt(promptMsg, suggested);
  if (!name) return;

  const presets = _getPresets();
  // Check for duplicate name
  const existingIdx = presets.findIndex(p => p.name === name);
  const preset = { name: name, data: _capturePreset(), created: new Date().toISOString() };

  if (existingIdx >= 0) {
    const confirmMsg = lang === 'es'
      ? `¿Sobreescribir "${name}"?`
      : `Overwrite "${name}"?`;
    if (!confirm(confirmMsg)) return;
    presets[existingIdx] = preset;
  } else {
    presets.push(preset);
  }

  _savePresets(presets);
  populatePresetSelect();

  // Select the saved preset
  const sel = document.getElementById('presetSelect');
  const idx = existingIdx >= 0 ? existingIdx : presets.length - 1;
  sel.value = idx;
}

/** Load a preset from the dropdown */
function onPresetLoad() {
  const sel = document.getElementById('presetSelect');
  const idx = sel.value;
  if (idx === '' || idx == null) return;

  const presets = _getPresets();
  const preset = presets[parseInt(idx)];
  if (!preset || !preset.data) return;

  _restorePreset(preset.data);
  // Auto-calculate after loading
  calculate();
}

/** Delete the currently selected preset */
function onPresetDelete() {
  const sel = document.getElementById('presetSelect');
  const idx = sel.value;
  if (idx === '' || idx == null) return;

  const presets = _getPresets();
  const preset = presets[parseInt(idx)];
  if (!preset) return;

  const lang = appState.lang || 'es';
  const msg = lang === 'es'
    ? `¿Eliminar "${preset.name}"?`
    : `Delete "${preset.name}"?`;
  if (!confirm(msg)) return;

  presets.splice(parseInt(idx), 1);
  _savePresets(presets);
  populatePresetSelect();
  sel.value = '';
}

// Initialize presets on load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(populatePresetSelect, 100);
});

