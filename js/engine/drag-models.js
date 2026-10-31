/**
 * BallisticPro — Drag Model Tables & Interpolation
 * Standard drag functions: G1, G7, GA (airgun diabolo)
 */
const DragModels = (() => {
  const G1_TABLE = [
    [0,0.2629],[0.05,0.2558],[0.1,0.2487],[0.15,0.2413],[0.2,0.2344],
    [0.25,0.2278],[0.3,0.2214],[0.35,0.2155],[0.4,0.2104],[0.45,0.2061],
    [0.5,0.2032],[0.55,0.2020],[0.6,0.2034],[0.7,0.2165],[0.725,0.2230],
    [0.75,0.2313],[0.775,0.2417],[0.8,0.2546],[0.825,0.2706],[0.85,0.2901],
    [0.875,0.3136],[0.9,0.3415],[0.925,0.3734],[0.95,0.4084],[0.975,0.4448],
    [1,0.4805],[1.025,0.5136],[1.05,0.5427],[1.075,0.5677],[1.1,0.5883],
    [1.125,0.6053],[1.15,0.6191],[1.2,0.6393],[1.25,0.6518],[1.3,0.6589],
    [1.35,0.6621],[1.4,0.6625],[1.45,0.6607],[1.5,0.6573],[1.55,0.6528],
    [1.6,0.6474],[1.65,0.6413],[1.7,0.6347],[1.75,0.6280],[1.8,0.6210],
    [1.85,0.6141],[1.9,0.6072],[1.95,0.6003],[2,0.5934],[2.05,0.5867],
    [2.1,0.5804],[2.15,0.5743],[2.2,0.5685],[2.25,0.5630],[2.3,0.5577],
    [2.35,0.5527],[2.4,0.5481],[2.45,0.5438],[2.5,0.5397],[2.6,0.5325],
    [2.7,0.5264],[2.8,0.5211],[2.9,0.5168],[3,0.5133],[3.1,0.5105],
    [3.2,0.5084],[3.3,0.5067],[3.4,0.5054],[3.5,0.5040],[3.6,0.5030],
    [3.7,0.5022],[3.8,0.5016],[3.9,0.5010],[4,0.5006],[4.2,0.4998],
    [4.4,0.4995],[4.6,0.4992],[4.8,0.4990],[5,0.4988]
  ];

  const G7_TABLE = [
    [0,0.1198],[0.05,0.1197],[0.1,0.1196],[0.15,0.1194],[0.2,0.1193],
    [0.25,0.1194],[0.3,0.1194],[0.35,0.1194],[0.4,0.1193],[0.45,0.1193],
    [0.5,0.1194],[0.55,0.1193],[0.6,0.1194],[0.65,0.1197],[0.7,0.1202],
    [0.725,0.1207],[0.75,0.1215],[0.775,0.1226],[0.8,0.1242],[0.825,0.1266],
    [0.85,0.1306],[0.875,0.1368],[0.9,0.1464],[0.925,0.1660],[0.95,0.2054],
    [0.975,0.2993],[1,0.3803],[1.025,0.4015],[1.05,0.4043],[1.075,0.4034],
    [1.1,0.4014],[1.125,0.3987],[1.15,0.3955],[1.2,0.3884],[1.25,0.3810],
    [1.3,0.3732],[1.35,0.3657],[1.4,0.3580],[1.5,0.3440],[1.55,0.3376],
    [1.6,0.3315],[1.65,0.3260],[1.7,0.3209],[1.75,0.3160],[1.8,0.3117],
    [1.85,0.3078],[1.9,0.3042],[1.95,0.3010],[2,0.2980],[2.05,0.2951],
    [2.1,0.2922],[2.15,0.2892],[2.2,0.2864],[2.25,0.2835],[2.3,0.2807],
    [2.35,0.2779],[2.4,0.2752],[2.45,0.2725],[2.5,0.2697],[2.55,0.2670],
    [2.6,0.2643],[2.65,0.2615],[2.7,0.2588],[2.75,0.2561],[2.8,0.2533],
    [2.85,0.2506],[2.9,0.2479],[2.95,0.2451],[3,0.2424],[3.1,0.2368],
    [3.2,0.2313],[3.3,0.2258],[3.4,0.2205],[3.5,0.2154],[3.6,0.2106],
    [3.7,0.2060],[3.8,0.2017],[3.9,0.1975],[4,0.1935],[4.2,0.1861],
    [4.4,0.1793],[4.6,0.1730],[4.8,0.1672],[5,0.1618]
  ];

  // GA table: Reference data for diabolo pellets (Cd vs Mach)
  // Source: Published GA drag model (AirgunNation, HardAirMagazine, Strelok reference)
  const GA_TABLE = [
    [0.00,0.2500],[0.05,0.2460],[0.10,0.2350],[0.15,0.2280],[0.20,0.2210],
    [0.25,0.2140],[0.30,0.2070],[0.35,0.2010],[0.40,0.1960],[0.45,0.1920],
    [0.50,0.1890],[0.55,0.1890],[0.60,0.1890],[0.65,0.1940],[0.70,0.2020],
    [0.75,0.2180],[0.80,0.2410],[0.85,0.2810],[0.875,0.3050],[0.90,0.3290],
    [0.925,0.3700],[0.95,0.4200],[0.975,0.4550],[1.00,0.4880],[1.025,0.5250],
    [1.05,0.5600],[1.075,0.5810],[1.10,0.5970],[1.15,0.6300],[1.20,0.6490],
    [1.25,0.6570],[1.30,0.6690],[1.35,0.6710],[1.40,0.6720],[1.50,0.6670],
    [1.60,0.6570],[1.70,0.6440],[1.80,0.6300],[1.90,0.6160],[2.00,0.6020],
    [2.10,0.5890],[2.20,0.5770],[2.30,0.5660],[2.40,0.5560],[2.50,0.5480],
    [2.60,0.5400],[2.70,0.5340],[2.80,0.5290],[2.90,0.5240],[3.00,0.5210]
  ];

  function interpolateCd(table, mach) {
    const n = table.length;
    if (mach <= table[0][0]) return table[0][1];
    if (mach >= table[n - 1][0]) return table[n - 1][1];
    // Binary search for the bracketing segment (tables are sorted by Mach)
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid][0] <= mach) lo = mid; else hi = mid;
    }
    const t = (mach - table[lo][0]) / (table[hi][0] - table[lo][0]);
    return table[lo][1] + t * (table[hi][1] - table[lo][1]);
  }

  // ── O(1) lookup tables ──
  // Every node of the built-in tables falls on a multiple of 0.005 Mach, so a
  // piecewise-linear table resampled on that grid and linearly interpolated is
  // EXACTLY the same function (verified in tests/run-tests.js).
  const LUT_STEP = 0.005;
  const LUT_INV = 1 / LUT_STEP;
  const _lutCache = {};

  function _buildLUT(table) {
    const maxMach = table[table.length - 1][0];
    const n = Math.round(maxMach / LUT_STEP) + 1;
    const lut = new Float64Array(n);
    for (let i = 0; i < n; i++) lut[i] = interpolateCd(table, i * LUT_STEP);
    return lut;
  }

  function _getTable(model) {
    switch (String(model).toUpperCase()) {
      case 'G7': return { key: 'G7', table: G7_TABLE };
      case 'GA': return { key: 'GA', table: GA_TABLE };
      default:   return { key: 'G1', table: G1_TABLE };
    }
  }

  /**
   * Build a fast reference-Cd function (Mach → Cd_ref) for a drag model.
   * Resolve the model ONCE per solve instead of once per integration stage.
   * @param {string} model — 'G1' | 'G7' | 'GA' | 'CUSTOM'
   * @param {Array} [customTable] — [[mach, cd], …] sorted by mach (CUSTOM only)
   * @returns {(mach:number)=>number}
   */
  function makeCdFunction(model, customTable) {
    if (String(model).toUpperCase() === 'CUSTOM' && customTable && customTable.length > 1) {
      return (mach) => interpolateCd(customTable, mach);   // arbitrary nodes → exact search
    }
    const { key, table } = _getTable(String(model).toUpperCase() === 'CUSTOM' ? 'G1' : model);
    const lut = _lutCache[key] || (_lutCache[key] = _buildLUT(table));
    const last = lut.length - 1;
    return (mach) => {
      const x = mach * LUT_INV;
      if (x <= 0) return lut[0];
      if (x >= last) return lut[last];
      const i = x | 0;                       // floor for positive x
      const f = x - i;
      return lut[i] + f * (lut[i + 1] - lut[i]);
    };
  }

  function getDragCoefficient(model, bc, mach, customTable) {
    let table;
    switch (model.toUpperCase()) {
      case 'G1': table = G1_TABLE; break;
      case 'G7': table = G7_TABLE; break;
      case 'GA': table = GA_TABLE; break;
      case 'CUSTOM': table = customTable || G1_TABLE; break;
      default: table = G1_TABLE;
    }
    const cdRef = interpolateCd(table, mach);
    return cdRef / bc;
  }

  function dragDeceleration(rho, S, Cd, v, m) {
    return (rho * S * Cd * v * v) / (2 * m);
  }

  function sectionalDensity(massGrains, caliberInches) {
    return (massGrains / 7000) / (caliberInches * caliberInches);
  }

  function getReferenceCd(model, mach) {
    const tables = { G1: G1_TABLE, G7: G7_TABLE, GA: GA_TABLE };
    return interpolateCd(tables[model] || G1_TABLE, mach);
  }

  return {
    getDragCoefficient, dragDeceleration, sectionalDensity,
    getReferenceCd, interpolateCd, makeCdFunction,
    tables: { G1: G1_TABLE, G7: G7_TABLE, GA: GA_TABLE }
  };
})();
if (typeof module !== 'undefined') module.exports = DragModels;
