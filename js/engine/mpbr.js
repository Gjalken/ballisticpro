/**
 * BallisticPro — MPBR Engine (Maximum Point Blank Range)
 * 
 * Binary search over zero distance to find the optimal zero
 * where max ordinate exactly equals the vital zone radius.
 * Then finds the MPBR = where drop exceeds -radius after far zero.
 */
const MPBR = (() => {

  function calculate(baseConfig, vitalRadiusIn, opts) {
    opts = opts || {};
    const muzzleVelMps = baseConfig.muzzleVelMps || 800;
    const maxSearchZeroM = opts.maxSearchZeroM || (muzzleVelMps > 400 ? 600 : 150);
    const iterations = opts.iterations || 28;      // 595 m / 2^28 ≈ 2·10⁻⁶ m — far below display precision
    const stepM = opts.stepM || 0.9144; // 1 yard steps for better resolution

    // Trajectory range: enough to find where drop exceeds radius
    const maxTrajRangeM = muzzleVelMps > 400 ? 1500 : 300;

    // Phase 1: Binary search for optimal zero distance
    // Goal: find the zero where max ordinate = vitalRadiusIn (exactly fills the tube)
    let lo = 5;   // meters
    let hi = maxSearchZeroM;
    let bestZero = lo;
    let bestTraj = null;

    for (let i = 0; i < iterations && hi - lo > 0.001; i++) {
      const mid = (lo + hi) / 2;
      const cfg = Object.assign({}, baseConfig, {
        zeroRangeM: mid,
        maxRangeM: Math.min(mid * 3, maxTrajRangeM),
        stepM: stepM,
        skipBreakdown: true      // only the vertical profile matters here
      });

      const traj = Solver.solve(cfg);
      if (!traj || traj.length < 3) break;

      const maxOrd = _findMaxOrdinate(traj);

      if (maxOrd.value > vitalRadiusIn) {
        // Max ordinate exceeds radius → zero is too far → reduce
        hi = mid;
      } else {
        // Max ordinate under radius → we can push zero further
        lo = mid;
        bestZero = mid;
        bestTraj = traj;
      }
    }

    // Phase 2: Final trajectory with converged optimal zero
    const finalCfg = Object.assign({}, baseConfig, {
      zeroRangeM: bestZero,
      maxRangeM: maxTrajRangeM,
      stepM: stepM,
      skipBreakdown: true
    });
    const trajectory = Solver.solve(finalCfg);
    if (!trajectory || trajectory.length < 5) {
      return { error: 'No se pudo calcular la trayectoria' };
    }

    // Phase 3: Extract key points
    const maxOrd = _findMaxOrdinate(trajectory);
    const nearZero = _findCrossing(trajectory, 'up');
    const farZero = _findCrossing(trajectory, 'down');
    const mpbrPt = _findDropLimit(trajectory, -vitalRadiusIn);

    // Convert meters to yards: 1 meter = 1.09361 yards
    const MtoYd = 1.09361;

    return {
      optimalZeroM: bestZero,
      optimalZeroYd: bestZero * MtoYd,
      nearZeroM: nearZero.rangeM,
      nearZeroYd: nearZero.rangeM * MtoYd,
      farZeroM: farZero.rangeM,
      farZeroYd: farZero.rangeM * MtoYd,
      mpbrM: mpbrPt.rangeM,
      mpbrYd: mpbrPt.rangeM * MtoYd,
      maxOrdinateIn: maxOrd.value,
      maxOrdinateRangeM: maxOrd.rangeM,
      maxOrdinateRangeYd: maxOrd.rangeM * MtoYd,
      vitalRadiusIn: vitalRadiusIn,
      trajectory: trajectory
    };
  }

  /** Find max ordinate (highest point above LOS) */
  function _findMaxOrdinate(traj) {
    let best = { value: -Infinity, rangeM: 0 };
    for (const pt of traj) {
      if (pt.dropIn > best.value) {
        best = { value: pt.dropIn, rangeM: pt.rangeM };
      }
    }
    return best;
  }

  /** Find zero crossing: 'up' = near zero (neg→pos), 'down' = far zero (pos→neg) */
  function _findCrossing(traj, dir) {
    let seenPositive = false;
    for (let i = 1; i < traj.length; i++) {
      const prev = traj[i - 1].dropIn;
      const curr = traj[i].dropIn;
      if (dir === 'up' && prev <= 0 && curr > 0) {
        return _interpolateRange(traj, i, 0);
      }
      if (dir === 'down') {
        if (curr > 0) seenPositive = true;
        if (seenPositive && prev >= 0 && curr < 0) {
          return _interpolateRange(traj, i, 0);
        }
      }
    }
    return { rangeM: 0 };
  }

  /** Find where drop first goes below a limit (after the positive arc) */
  function _findDropLimit(traj, limit) {
    let seenPositive = false;
    let seenFarZero = false;
    for (let i = 1; i < traj.length; i++) {
      if (traj[i].dropIn > 0) seenPositive = true;
      if (seenPositive && traj[i].dropIn <= 0) seenFarZero = true;
      if (seenFarZero && traj[i].dropIn <= limit) {
        return _interpolateRange(traj, i, limit);
      }
    }
    // Never reached limit — return last point
    return { rangeM: traj[traj.length - 1].rangeM };
  }

  /** Interpolate range at a given drop threshold between traj[i-1] and traj[i] */
  function _interpolateRange(traj, i, targetDrop) {
    const p = traj[i - 1], c = traj[i];
    const denom = Math.abs(p.dropIn - targetDrop) + Math.abs(c.dropIn - targetDrop);
    if (denom < 0.0001) return { rangeM: p.rangeM };
    const t = Math.abs(p.dropIn - targetDrop) / denom;
    return { rangeM: p.rangeM + t * (c.rangeM - p.rangeM) };
  }

  return { calculate };
})();

if (typeof module !== 'undefined') module.exports = MPBR;
