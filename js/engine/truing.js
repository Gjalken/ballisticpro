/**
 * BallisticPro — Truing Engine
 * Adjusts Muzzle Velocity and BC to match real-world POI data.
 * Uses binary search against the Solver for iterative refinement.
 *
 * Methodology: Applied Ballistics / Kestrel 2-stage truing
 *   Stage 1: MV adjustment at 400-600 yd (supersonic)
 *   Stage 2: BC adjustment at 800-1000+ yd (near transonic)
 */
const Truing = (() => {
  const MAX_ITERATIONS = 60;
  const DROP_TOLERANCE_IN = 0.01; // inches (solves are cheap now, so be tight)

  /**
   * Config trimmed to what truing needs: a single step that ends EXACTLY at the observed
   * range (so the drop there is not linearly interpolated between table rows) and no
   * Coriolis breakdown.
   */
  function _trimConfig(baseConfig, rangeM, overrides) {
    return Object.assign({}, baseConfig, overrides, {
      maxRangeM: rangeM, stepM: rangeM, skipBreakdown: true
    });
  }

  /**
   * Find the muzzle velocity that produces the observed drop at a given range.
   * @param {Object} baseConfig — Full config from gatherInputs()
   * @param {number} rangeM — Distance of observation in meters
   * @param {number} actualDropIn — Measured drop in inches (negative = below POA)
   * @returns {{ truedVelMps: number, truedVelFps: number, originalVelFps: number, deltaFps: number, predictedDropIn: number, iterations: number }}
   */
  function findMuzzleVelocity(baseConfig, rangeM, actualDropIn) {
    const originalVelMps = baseConfig.muzzleVelMps;
    const originalVelFps = originalVelMps / 0.3048;

    // Binary search bounds (m/s)
    let lo = 50;   // ~164 fps minimum
    let hi = 1500; // ~4921 fps maximum
    let bestVel = originalVelMps;
    let bestDrop = 0;
    let iterations = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterations = i + 1;
      const mid = (lo + hi) / 2;
      const testConfig = _trimConfig(baseConfig, rangeM, { muzzleVelMps: mid });
      const results = Solver.solve(testConfig);
      const dropAtRange = _interpolateDrop(results, rangeM);

      if (dropAtRange === null) {
        // The bullet never reached this range (stalled / time limit): it needs MORE velocity.
        lo = mid;
        continue;
      }

      bestVel = mid;
      bestDrop = dropAtRange;

      const diff = dropAtRange - actualDropIn;

      if (Math.abs(diff) < DROP_TOLERANCE_IN) break;

      // More velocity → less drop (less negative) at supersonic ranges
      // If predicted drop is less negative than actual → velocity too high → reduce
      // If predicted drop is more negative than actual → velocity too low → increase
      if (dropAtRange > actualDropIn) {
        hi = mid; // Velocity too high, drop not enough
      } else {
        lo = mid; // Velocity too low, too much drop
      }
    }

    const truedVelFps = bestVel / 0.3048;
    return {
      truedVelMps: bestVel,
      truedVelFps: truedVelFps,
      originalVelMps: originalVelMps,
      originalVelFps: originalVelFps,
      deltaFps: truedVelFps - originalVelFps,
      predictedDropIn: bestDrop,
      actualDropIn: actualDropIn,
      iterations: iterations
    };
  }

  /**
   * Find the BC that produces the observed drop at a given range.
   * Should be run AFTER MV truing (use trued MV in config).
   * @param {Object} baseConfig — Full config with trued MV
   * @param {number} rangeM — Distance of observation in meters
   * @param {number} actualDropIn — Measured drop in inches
   * @returns {{ truedBC: number, originalBC: number, deltaBC: number, predictedDropIn: number, iterations: number }}
   */
  function findBC(baseConfig, rangeM, actualDropIn) {
    const originalBC = baseConfig.bc;

    let lo = 0.01;
    let hi = 2.0;
    let bestBC = originalBC;
    let bestDrop = 0;
    let iterations = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterations = i + 1;
      const mid = (lo + hi) / 2;
      const testConfig = _trimConfig(baseConfig, rangeM, { bc: mid });
      const results = Solver.solve(testConfig);
      const dropAtRange = _interpolateDrop(results, rangeM);

      if (dropAtRange === null) {
        lo = mid; // Need more BC to reach this range
        continue;
      }

      bestBC = mid;
      bestDrop = dropAtRange;

      const diff = dropAtRange - actualDropIn;

      if (Math.abs(diff) < DROP_TOLERANCE_IN) break;

      // Higher BC → less drag → less drop (less negative)
      // If predicted drop is less negative than actual → BC too high → reduce
      if (dropAtRange > actualDropIn) {
        hi = mid; // BC too high
      } else {
        lo = mid; // BC too low
      }
    }

    return {
      truedBC: bestBC,
      originalBC: originalBC,
      deltaBC: bestBC - originalBC,
      predictedDropIn: bestDrop,
      actualDropIn: actualDropIn,
      iterations: iterations
    };
  }

  /**
   * Get the predicted drop at a specific range by interpolating the results array.
   * @param {Array} results — Solver results array
   * @param {number} rangeM — Target range in meters
   * @returns {number|null} — Drop in inches, or null if range not reached
   */
  function _interpolateDrop(results, rangeM) {
    if (!results || results.length === 0) return null;

    // Find the two bracketing data points
    for (let i = 1; i < results.length; i++) {
      if (results[i].rangeM >= rangeM) {
        const prev = results[i - 1];
        const curr = results[i];
        // Linear interpolation
        const t = (rangeM - prev.rangeM) / (curr.rangeM - prev.rangeM);
        return prev.dropIn + t * (curr.dropIn - prev.dropIn);
      }
    }

    // Range exceeds trajectory
    return null;
  }

  /**
   * Get the predicted drop at a specific range from current config.
   * Utility for the UI to show "predicted drop" before user enters real data.
   * @param {Object} config — Full config from gatherInputs()
   * @param {number} rangeM — Target range in meters
   * @returns {number|null} — Predicted drop in inches
   */
  function getPredictedDrop(config, rangeM) {
    // Respect the user's max range: asking beyond it reports "range exceeded" (null)
    if (config.maxRangeM && rangeM > config.maxRangeM + 1e-6) return null;
    const results = Solver.solve(_trimConfig(config, rangeM, {}));
    return _interpolateDrop(results, rangeM);
  }

  return { findMuzzleVelocity, findBC, getPredictedDrop };
})();

if (typeof module !== 'undefined') module.exports = Truing;
