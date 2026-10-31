/**
 * BallisticPro — Test harness
 * Loads the engine files exactly like the browser does (global scope, same order
 * as index.html) so they can be exercised from Node without a DOM.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_FILES = [
  'js/engine/conversions.js', 'js/engine/atmosphere.js', 'js/engine/drag-models.js',
  'js/engine/stability.js', 'js/engine/coriolis.js', 'js/engine/solver.js',
  'js/engine/truing.js', 'js/engine/reticle.js', 'js/engine/mpbr.js'
];

function loadEngine(root = ROOT) {
  // `const X = ...` at script top level is not a property of the context object,
  // so append an export line that copies the bindings out.
  const ctx = vm.createContext({ console, Math });
  const names = ['Conversions', 'Atmosphere', 'DragModels', 'Stability', 'Coriolis',
                 'Solver', 'Truing', 'ReticleCalc', 'MPBR'];
  let src = ENGINE_FILES.map(f => fs.readFileSync(path.join(root, f), 'utf8')
    .replace(/if \(typeof module !== 'undefined'\)[^\n]*/g, '')).join('\n;\n');
  src += `\n;this.__api = { ${names.join(', ')} };`;
  vm.runInContext(src, ctx, { filename: 'engine-bundle.js' });
  return ctx.__api;
}

/** Same shape as gatherInputs() in app.js (all SI), built from friendly units. */
function makeConfig(o = {}) {
  const E = o.engine;
  const tempC = o.tempC ?? 15, pHpa = o.pHpa ?? 1013.25, rh = o.rh ?? 50;
  const atmo = E.Atmosphere.getAtmosphere({ tempC, pressureHpa: pHpa, rh });
  const grains = o.grains ?? 175;
  const diamIn = o.diamIn ?? 0.308;
  return {
    muzzleVelMps: (o.fps ?? 2600) * 0.3048,
    massKg: grains / 15432.4,
    diameterM: diamIn * 0.0254,
    bc: o.bc ?? 0.264, dragModel: o.model ?? 'G7',
    scopeHeightM: (o.scopeIn ?? 1.5) * 0.0254,
    zeroRangeM: (o.zeroYd ?? 100) * 0.9144,
    lookAngleDeg: o.look ?? 0,
    atmo,
    windSpeedMps: (o.windMph ?? 0) * 0.44704, windDirDeg: o.windDir ?? 90,
    latDeg: o.lat ?? 0, azimuthDeg: o.az ?? 0,
    twistDir: o.twistDir ?? 1, twistInchesPerTurn: o.twist ?? 10,
    bulletLengthIn: o.lenIn ?? 1.24, bulletDiamIn: diamIn, massGrains: grains,
    maxRangeM: o.maxM ?? 1000, stepM: o.stepM ?? 25, customDragTable: null
  };
}

/** Representative scenarios shared by baseline capture and comparison. */
function scenarios(E) {
  const c = (o) => makeConfig({ engine: E, ...o });
  return {
    rifle308:      c({}),
    rifle308_wind: c({ windMph: 10, windDir: 90 }),
    rifle308_cor:  c({ lat: -33, az: 90 }),
    rifle308_cor45N: c({ lat: 45, az: 0 }),
    rifle308_incl: c({ look: 20 }),
    rifle308_cold: c({ tempC: -15, pHpa: 1030, rh: 20 }),
    rifle308_alt:  c({ tempC: 5, pHpa: 640, rh: 30 }),
    cm65_long:     c({ fps: 2710, grains: 140, diamIn: 0.264, bc: 0.315, lenIn: 1.35, twist: 8, maxM: 1500, stepM: 50 }),
    lr22:          c({ fps: 1080, grains: 40, diamIn: 0.223, bc: 0.125, model: 'G1', lenIn: 0.5, twist: 16, zeroYd: 50, maxM: 300, stepM: 10 }),
    airgun22:      c({ fps: 900, grains: 18.13, diamIn: 0.217, bc: 0.035, model: 'GA', lenIn: 0.3, twist: 16, zeroYd: 30, maxM: 100, stepM: 5 }),
    lhtwist:       c({ twistDir: -1, windMph: 8, windDir: 90 })
  };
}

module.exports = { loadEngine, makeConfig, scenarios, ROOT };
