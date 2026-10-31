/**
 * BallisticPro — Reticle Calculation Engine
 * Converts ballistic data to reticle units, handles SFP/FFP corrections,
 * calculates click adjustments, and provides range estimation.
 *
 * Constants:
 *   1 MIL (MRAD) = 3.43775 MOA
 *   1 MOA = 1.047" at 100 yd
 *   1 MIL = 3.6" at 100 yd = 10 cm at 100 m
 */
const ReticleCalc = (() => {
  const MOA_PER_MIL = 3.43775;
  const MIL_PER_MOA = 1 / MOA_PER_MIL;

  /**
   * Convert MOA to MIL.
   * @param {number} moa
   * @returns {number} mils
   */
  function moaToMil(moa) { return moa * MIL_PER_MOA; }

  /**
   * Convert MIL to MOA.
   * @param {number} mil
   * @returns {number} moa
   */
  function milToMoa(mil) { return mil * MOA_PER_MIL; }

  /**
   * Calculate holdover in the reticle's native unit.
   * @param {number} dropMoa — Drop in MOA from solver
   * @param {string} reticleUnit — 'mil' or 'moa'
   * @returns {{ value: number, unit: string }}
   */
  function calcHoldover(dropMoa, reticleUnit) {
    if (reticleUnit === 'mil') {
      return { value: moaToMil(dropMoa), unit: 'MIL' };
    }
    return { value: dropMoa, unit: 'MOA' };
  }

  /**
   * Calculate windage in the reticle's native unit.
   * @param {number} windageMoa — Windage in MOA from solver
   * @param {string} reticleUnit — 'mil' or 'moa'
   * @returns {{ value: number, unit: string }}
   */
  function calcWindage(windageMoa, reticleUnit) {
    if (reticleUnit === 'mil') {
      return { value: moaToMil(windageMoa), unit: 'MIL' };
    }
    return { value: windageMoa, unit: 'MOA' };
  }

  /**
   * True angular SUBTENSION of a reticle mark.
   * In SFP scopes a mark labelled `nominalValue` only spans that angle at the reference
   * magnification; at another power it spans nominal × (refMag / currentMag) of target.
   * (e.g. a 1-mil dot at ref 14x covers 2 true mils at 7x.)
   *
   * @param {number} nominalValue — Value printed/calibrated at reference magnification
   * @param {number} refMag — Reference magnification (where reticle is calibrated)
   * @param {number} currentMag — Current magnification setting
   * @param {string} focalPlane — 'FFP' or 'SFP'
   * @returns {number}
   */
  function sfpCorrection(nominalValue, refMag, currentMag, focalPlane) {
    if (focalPlane === 'FFP') return nominalValue; // FFP: always true
    return nominalValue * (refMag / currentMag);
  }

  /**
   * Apparent RETICLE READING for a TRUE angle — the inverse of sfpCorrection().
   * To hold `trueValue` mils on an SFP scope at power `currentMag`, read
   * trueValue × (currentMag / refMag) marks off the reticle.
   */
  function sfpApparent(trueValue, refMag, currentMag, focalPlane) {
    if (focalPlane === 'FFP') return trueValue;
    return trueValue * (currentMag / refMag);
  }

  /**
   * Calculate number of turret clicks needed for a given correction.
   * @param {number} valueMoa — Correction needed in MOA
   * @param {number} clickSize — Click value in MOA (e.g., 0.25, 0.125)
   * @param {string} turretUnit — 'moa' or 'mil'
   * @returns {{ clicks: number, remainder: number, turretValue: number, turretUnit: string }}
   */
  function calcClicks(valueMoa, clickSize, turretUnit) {
    let turretValue;
    let effectiveClickMoa;

    if (turretUnit === 'mil') {
      // Convert click size from MIL to MOA for comparison
      turretValue = moaToMil(valueMoa);
      effectiveClickMoa = clickSize * MOA_PER_MIL;
    } else {
      turretValue = valueMoa;
      effectiveClickMoa = clickSize;
    }

    const clicks = Math.round(valueMoa / effectiveClickMoa);
    const actualMoa = clicks * effectiveClickMoa;
    const remainderMoa = valueMoa - actualMoa;

    return {
      clicks: clicks,
      remainderMoa: remainderMoa,
      turretValue: turretUnit === 'mil' ? moaToMil(actualMoa) : actualMoa,
      turretUnit: turretUnit === 'mil' ? 'MIL' : 'MOA'
    };
  }

  /**
   * Estimate range to a target using mil-dot ranging.
   * Formula: Range(m) = (targetSize_m × 1000) / milsObserved
   * Formula: Range(yd) = (targetSize_in × 27.778) / milsObserved
   *
   * @param {number} targetSize — Target size
   * @param {string} targetUnit — 'cm', 'in', 'm'
   * @param {number} milsObserved — How many mils the target subtends
   * @param {string} focalPlane — 'FFP' or 'SFP'
   * @param {number} refMag — Reference magnification
   * @param {number} currentMag — Current magnification
   * @returns {{ rangeM: number, rangeYd: number }}
   */
  function rangeEstimate(targetSize, targetUnit, milsObserved, focalPlane, refMag, currentMag) {
    // Reading → true mils. On SFP scopes off the reference power each mark spans
    // refMag/currentMag true mils (2x at half power), so scale by refMag/currentMag.
    const trueMils = sfpCorrection(milsObserved, refMag, currentMag, focalPlane);

    // Convert target size to meters
    let targetM;
    switch (targetUnit) {
      case 'cm': targetM = targetSize / 100; break;
      case 'in': targetM = targetSize * 0.0254; break;
      case 'm':  targetM = targetSize; break;
      default:   targetM = targetSize / 100;
    }

    const rangeM = (targetM * 1000) / trueMils;
    const rangeYd = rangeM / 0.9144;

    return { rangeM, rangeYd };
  }

  /**
   * Get complete firing solution for reticle display.
   * Takes solver results at a specific range and scope profile,
   * returns everything needed for the reticle view UI.
   *
   * @param {Object} resultAtRange — Single result object from Solver at target range
   * @param {Object} scopeProfile — Scope profile from scopes.json
   * @param {number} currentMag — Current magnification setting
   * @returns {Object} — Complete reticle solution
   */
  function getFiringSolution(resultAtRange, scopeProfile, currentMag) {
    if (!resultAtRange) return null;

    const fp = scopeProfile.focalPlane;
    const refMag = scopeProfile.magRef;
    const rUnit = scopeProfile.reticleUnit;

    // Holdover and windage in reticle units
    const holdover = calcHoldover(Math.abs(resultAtRange.dropMoa), rUnit);
    const windage = calcWindage(Math.abs(resultAtRange.windageMoa), rUnit);

    // Apparent reading on the reticle at the current power (SFP: scales with magnification)
    const holdoverCorrected = sfpApparent(holdover.value, refMag, currentMag, fp);
    const windageCorrected = sfpApparent(windage.value, refMag, currentMag, fp);

    // Click calculations
    const elevClicks = calcClicks(Math.abs(resultAtRange.dropMoa), scopeProfile.clickElev, scopeProfile.turretUnit);
    const windClicks = calcClicks(Math.abs(resultAtRange.windageMoa), scopeProfile.clickWind, scopeProfile.turretUnit);

    // Direction indicators
    const dropDir = resultAtRange.dropMoa < 0 ? 'down' : 'up';
    const windDir = resultAtRange.windageMoa > 0 ? 'right' : 'left';

    return {
      // Holdover for reticle positioning. `value` = apparent reading at the current power
      // (what you see on the reticle); `raw` = true angle.
      holdover: {
        value: holdoverCorrected,
        raw: holdover.value,
        unit: holdover.unit,
        direction: dropDir
      },
      windage: {
        value: windageCorrected,
        raw: windage.value,
        unit: windage.unit,
        direction: windDir
      },
      // Values in both units for display
      dropMoa: resultAtRange.dropMoa,
      dropMil: moaToMil(resultAtRange.dropMoa),
      windageMoa: resultAtRange.windageMoa,
      windageMil: moaToMil(resultAtRange.windageMoa),
      // Click solutions
      elevClicks: { ...elevClicks, direction: dropDir },
      windClicks: { ...windClicks, direction: windDir },
      // Ballistic data
      velocity: resultAtRange.velocityFps,
      energy: resultAtRange.energyFtLbs,
      tof: resultAtRange.tof,
      distanceM: resultAtRange.rangeM,
      mach: resultAtRange.mach,
      // Coriolis & spin drift (inches)
      coriolisLatIn: resultAtRange.coriolisLatIn || 0,
      coriolisVertIn: resultAtRange.coriolisVertIn || 0,
      spinDriftIn: resultAtRange.spinDriftIn || 0,
      // Scope state
      currentMag: currentMag,
      refMag: refMag,
      magRatio: fp === 'SFP' ? currentMag / refMag : 1,
      focalPlane: fp,
      isTrueSubtension: fp === 'FFP' || currentMag === refMag
    };
  }

  return {
    moaToMil, milToMoa,
    calcHoldover, calcWindage,
    sfpCorrection, sfpApparent, calcClicks,
    rangeEstimate, getFiringSolution
  };
})();

if (typeof module !== 'undefined') module.exports = ReticleCalc;
