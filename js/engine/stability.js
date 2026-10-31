/**
 * BallisticPro — Stability, Spin Drift, Aerodynamic Jump
 */
const Stability = (() => {
  function millerStability(massGr, diamIn, lengthIn, twistIn, muzzleVelFps, tempF, pressureInhg) {
    muzzleVelFps = muzzleVelFps || 2800;
    tempF = tempF || 59;
    pressureInhg = pressureInhg || 29.92;
    const L = lengthIn / diamIn;
    const t = twistIn / diamIn;
    let sg = (30 * massGr) / (t * t * diamIn * diamIn * diamIn * L * (1 + L * L));
    const velCorr = Math.pow(muzzleVelFps / 2800, 1.0 / 3.0);
    sg *= velCorr;
    const tempCorr = (tempF + 460) / (59 + 460);
    const pressCorr = 29.92 / pressureInhg;
    sg *= tempCorr * pressCorr;
    return sg;
  }

  function stabilityStatus(sg) {
    if (sg < 1.0) return { status: 'unstable', label: 'INESTABLE / UNSTABLE', color: '#ef4444' };
    if (sg < 1.3) return { status: 'marginal', label: 'MARGINAL', color: '#f59e0b' };
    if (sg <= 2.0) return { status: 'stable', label: 'ESTABLE / STABLE', color: '#22c55e' };
    return { status: 'overstable', label: 'SOBRE-ESTABILIZADO / OVER-STABILIZED', color: '#3b82f6' };
  }

  function spinDriftInches(sg, tof, twistDir) {
    twistDir = twistDir || 1;
    return twistDir * 1.25 * (sg + 1.2) * Math.pow(tof, 1.83);
  }

  function spinRateRpm(velFps, twistIn) {
    return (velFps * 12 / twistIn) * 60;
  }

  function aerodynamicJumpRad(sg, crossWindMps, muzzleVelMps, twistDir) {
    twistDir = twistDir || 1;
    if (Math.abs(crossWindMps) < 0.01 || muzzleVelMps < 1) return 0;
    const factor = 0.0001 * sg;
    return twistDir * factor * (crossWindMps / muzzleVelMps);
  }

  return {
    millerStability, stabilityStatus,
    spinDriftInches, spinRateRpm, aerodynamicJumpRad
  };
})();
if (typeof module !== 'undefined') module.exports = Stability;
