/**
 * BallisticPro — Trajectory Solver (RK4 Integration)
 * Modified Point Mass model with Coriolis, spin drift, aerodynamic jump
 *
 * DRAG FORMULA:
 *   a = Cd_ref(Mach) × ρ × A_ref × v² / (2 × m_ref × BC)
 *   where A_ref and m_ref are the G-model reference projectile constants
 *   (1 lb mass, 1 inch diameter for G1/G7/GA).
 *   BC already encodes the real projectile's sectional density and form factor.
 *
 * PERFORMANCE NOTES
 *   - State lives in preallocated Float64Arrays; the integrator allocates nothing
 *     per step (the previous version created ~20 objects per RK4 step).
 *   - Drag is an O(1) lookup (DragModels.makeCdFunction) resolved once per solve.
 *   - Fixed step DT = 0.5 ms. RK4 is 4th-order accurate; the step was validated
 *     against the previous 50 µs integration (see tests/run-tests.js).
 *
 * FRAME CONVENTIONS
 *   x = horizontal downrange, y = up, z = right of the line of fire.
 *   Inclined shots: rows are reported at SLANT range along the line of sight and
 *   `dropIn` is the perpendicular offset of the bullet from that line of sight.
 */
const Solver = (() => {
  const G = 9.80665;
  const OMEGA = 7.292115e-5;            // Earth angular velocity (rad/s)
  const IN_PER_M = 39.3701;

  // Reference projectile constants (same for G1, G7, GA)
  // Mass: 1 lb = 0.45359237 kg
  // Diameter: 1 in = 0.0254 m  →  Area: π/4 × d² = 5.06707479e-4 m²
  const M_REF = 0.45359237;
  const A_REF = Math.PI / 4 * 0.0254 * 0.0254;
  const DRAG_K = A_REF / (2 * M_REF);   // ≈ 5.585e-4

  const DT = 0.0005;                    // integration step (s)

  /**
   * Build the state-derivative function for a fixed environment.
   * State vector layout: [x, y, z, vx, vy, vz].
   * `env.cor` = null (no Coriolis) or { sinLat, cosLat, sinAz, cosAz }.
   */
  function makeDerivs(env) {
    const { a, hw, cw, cdFn, cor } = env;
    const k = env.rho * DRAG_K / env.bc;        // rho × DRAG_K / BC
    return function derivs(s, out) {
      const vx = s[3], vy = s[4], vz = s[5];
      out[0] = vx; out[1] = vy; out[2] = vz;
      const vrx = vx - hw, vrz = vz - cw;
      const vr = Math.sqrt(vrx * vrx + vy * vy + vrz * vrz);
      if (vr < 0.1) { out[3] = 0; out[4] = -G; out[5] = 0; return; }
      const dragAccel = k * cdFn(vr / a) * vr;
      let ax = -dragAccel * vrx;
      let ay = -dragAccel * vy - G;
      let az = -dragAccel * vrz;
      if (cor) {
        // Earth frame: east / north / up, from shooter frame (forward / right / up)
        const ve = vx * cor.sinAz + vz * cor.cosAz;
        const vn = vx * cor.cosAz - vz * cor.sinAz;
        const cae = 2 * OMEGA * (vn * cor.sinLat - vy * cor.cosLat);
        const can = -2 * OMEGA * ve * cor.sinLat;
        const cau = 2 * OMEGA * ve * cor.cosLat;
        ax += cae * cor.sinAz + can * cor.cosAz;
        ay += cau;
        az += cae * cor.cosAz - can * cor.sinAz;
      }
      out[3] = ax; out[4] = ay; out[5] = az;
    };
  }

  /** In-place classic RK4 stepper (no allocations per call). */
  function makeStepper(derivs) {
    const k1 = new Float64Array(6), k2 = new Float64Array(6);
    const k3 = new Float64Array(6), k4 = new Float64Array(6);
    const tmp = new Float64Array(6);
    return function step(s, dt) {
      const h2 = dt * 0.5, h6 = dt / 6;
      derivs(s, k1);
      for (let i = 0; i < 6; i++) tmp[i] = s[i] + k1[i] * h2;
      derivs(tmp, k2);
      for (let i = 0; i < 6; i++) tmp[i] = s[i] + k2[i] * h2;
      derivs(tmp, k3);
      for (let i = 0; i < 6; i++) tmp[i] = s[i] + k3[i] * dt;
      derivs(tmp, k4);
      for (let i = 0; i < 6; i++) s[i] += h6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    };
  }

  /**
   * Integrate one trajectory and call `onSample(i, o)` for every target abscissa
   * xT[i] (horizontal metres, ascending). `o` = [x,y,z,vx,vy,vz,t] interpolated
   * linearly between steps (reused buffer — copy what you need).
   */
  function simulate(env, dt, v0, angle, scopeH, xT, onSample) {
    const nT = xT.length;
    const s = new Float64Array(6), p = new Float64Array(6), o = new Float64Array(7);
    s[1] = -scopeH; s[3] = v0 * Math.cos(angle); s[4] = v0 * Math.sin(angle);
    const stepper = makeStepper(makeDerivs(env));
    const xMax = xT[nT - 1];
    let next = 0, t = 0, tp = 0;

    const emit = () => {
      while (next < nT && xT[next] <= s[0]) {
        const dx = s[0] - p[0];
        const f = dx > 1e-4 ? (xT[next] - p[0]) / dx : 1;
        for (let j = 0; j < 6; j++) o[j] = p[j] + f * (s[j] - p[j]);
        o[0] = xT[next]; o[6] = tp + f * (t - tp);
        onSample(next, o);
        next++;
      }
    };

    p.set(s);
    emit();                                   // sample at x = 0
    while (next < nT && s[0] < xMax && t < 20) {
      p.set(s); tp = t;
      stepper(s, dt);
      t += dt;
      emit();                                 // includes the final sample at maxRange
      if (s[3] < 1) break;                    // bullet effectively stopped
    }
  }

  /** Launch-angle solution that puts the bullet on the line of sight at zeroRange (level ground). */
  function findZeroAngle(env, dt, v0, scopeH, zeroRange) {
    // Zeroing uses headwind drag only (no crosswind / Coriolis), as before.
    const zEnv = { a: env.a, hw: env.hw, cw: 0, cdFn: env.cdFn, cor: null, rho: env.rho, bc: env.bc };
    const stepper = makeStepper(makeDerivs(zEnv));
    const s = new Float64Array(6);

    const yAtRange = (angle) => {
      s[0] = 0; s[1] = -scopeH; s[2] = 0;
      s[3] = v0 * Math.cos(angle); s[4] = v0 * Math.sin(angle); s[5] = 0;
      let t = 0, px = 0, py = s[1];
      while (s[0] < zeroRange && t < 10) {
        px = s[0]; py = s[1];
        stepper(s, dt);
        t += dt;
        if (s[3] < 1) break;                  // bullet effectively stopped before zeroRange
      }
      if (s[0] > zeroRange && s[0] > px) {
        const f = (zeroRange - px) / (s[0] - px);
        return py + f * (s[1] - py);
      }
      return s[1];
    };

    // y(angle) is smooth and almost linear in the launch angle (dy/dθ ≈ range), so the
    // secant method converges in ~4 evaluations. Bisection remains as a safety net.
    const SEC_TOL = 1e-8;                                  // metres at zeroRange
    let a0 = 0, f0 = yAtRange(a0);
    let a1 = (scopeH + 0.5 * G * Math.pow(zeroRange / v0, 2)) / zeroRange;   // drag-free guess
    let f1 = yAtRange(a1);
    for (let iter = 0; iter < 24 && Math.abs(f1) > SEC_TOL; iter++) {
      const denom = f1 - f0;
      if (!(Math.abs(denom) > 1e-14)) break;
      const a2 = a1 - f1 * (a1 - a0) / denom;
      if (!isFinite(a2) || a2 < -0.2 || a2 > 0.6) break;
      a0 = a1; f0 = f1; a1 = a2; f1 = yAtRange(a1);
    }
    if (Math.abs(f1) <= SEC_TOL * 10) return a1;

    // Fallback: plain bisection
    let lo = 0, hi = 0.1;
    for (let iter = 0; iter < 48 && hi - lo > 1e-10; iter++) {
      const mid = (lo + hi) / 2;
      if (yAtRange(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function solve(config) {
    const {
      muzzleVelMps, massKg, bc, dragModel,
      scopeHeightM, zeroRangeM, lookAngleDeg,
      atmo, windSpeedMps, windDirDeg,
      latDeg, azimuthDeg, twistDir, twistInchesPerTurn,
      bulletLengthIn, bulletDiamIn, massGrains,
      maxRangeM, stepM, customDragTable
    } = config;

    const MAX_SAMPLES = 5000;
    const maxRange = Math.min(Math.max(Number(maxRangeM) || 2000, 1), 10000);
    let step = Math.max(Number(stepM) || 1, 0.1);
    if (maxRange / step > MAX_SAMPLES) step = maxRange / MAX_SAMPLES;
    const dt = Math.min(Math.max(Number(config.integrationDt) || DT, 0.0002), 0.05);
    const safeVel = Math.min(Math.max(Number(muzzleVelMps) || 800, 10), 3000);
    const safeBc = Math.min(Math.max(Number(bc) || 0.25, 0.001), 10);
    const clampedLookDeg = Math.min(Math.max(Number(lookAngleDeg) || 0, -85), 85);

    const rho = atmo.density;
    const a = atmo.speedOfSound;
    const latRad = (latDeg || 0) * Math.PI / 180;
    const azRad = (azimuthDeg || 0) * Math.PI / 180;
    const theta = clampedLookDeg * Math.PI / 180;
    const cosT = Math.cos(theta), tanT = Math.tan(theta);

    const windAngleRad = ((windDirDeg || 0) - (azimuthDeg || 0)) * Math.PI / 180;
    const headWind = -(windSpeedMps || 0) * Math.cos(windAngleRad);
    const crossWind = (windSpeedMps || 0) * Math.sin(windAngleRad);

    let sg = 1.5;
    if (massGrains && bulletDiamIn && bulletLengthIn && twistInchesPerTurn) {
      sg = Stability.millerStability(massGrains, bulletDiamIn, bulletLengthIn, twistInchesPerTurn, safeVel * 3.28084, atmo.tempC * 9 / 5 + 32, atmo.pressureHpa * 0.02953);
    }
    const ajAngle = Stability.aerodynamicJumpRad(sg, crossWind, safeVel, twistDir || 1);

    const cdFn = DragModels.makeCdFunction(dragModel, customDragTable);
    const baseEnv = { rho, a, bc: safeBc, hw: headWind, cw: crossWind, cdFn, cor: null };
    const useCoriolis = Math.abs(latRad) > 0.001;
    const corEnv = useCoriolis ? Object.assign({}, baseEnv, {
      cor: { sinLat: Math.sin(latRad), cosLat: Math.cos(latRad), sinAz: Math.sin(azRad), cosAz: Math.cos(azRad) }
    }) : baseEnv;

    const scopeH = scopeHeightM || 0.04;
    // Zero is established on LEVEL ground; the look angle only tilts the shot afterwards.
    const zeroAngle = findZeroAngle(baseEnv, dt, safeVel, scopeH, Math.min(Math.max(Number(zeroRangeM) || 100, 1), 5000));
    const launchAngle = zeroAngle + theta + ajAngle;

    // Sample abscissae: slant range along the line of sight → horizontal x
    const nT = Math.floor(maxRange / step + 1e-9) + 1;
    const xT = new Float64Array(nT);
    for (let i = 0; i < nT; i++) xT[i] = i * step * cosT;

    // Coriolis breakdown (exact): re-run the same launch with Coriolis switched off and
    // subtract. The totals below come straight from the integrated Coriolis trajectory,
    // so Coriolis is counted exactly once.
    let yOff = null, zOff = null;
    if (useCoriolis && !config.skipBreakdown) {
      yOff = new Float64Array(nT); zOff = new Float64Array(nT);
      simulate(baseEnv, dt, safeVel, launchAngle, scopeH, xT, (i, o) => { yOff[i] = o[1]; zOff[i] = o[2]; });
    }

    const results = [];
    const hasSpin = !!(twistInchesPerTurn && massGrains);
    simulate(corEnv, dt, safeVel, launchAngle, scopeH, xT, (i, o) => {
      const x = o[0], y = o[1], z = o[2];
      const v = Math.sqrt(o[3] * o[3] + o[4] * o[4] + o[5] * o[5]);
      const mach = v / a;
      const tof = o[6];

      const rangeM = i * step;                           // slant range (== horizontal when level)
      const distYd = rangeM * 1.09361;
      const perpDropM = (y - x * tanT) * cosT;           // offset from the line of sight

      const sdIn = hasSpin ? Stability.spinDriftInches(sg, tof, twistDir || 1) : 0;
      let corLatIn = 0, corVertIn = 0;
      if (yOff) {
        corLatIn = (z - zOff[i]) * IN_PER_M;
        corVertIn = (y - yOff[i]) * cosT * IN_PER_M;
      }

      const dropIn = perpDropM * IN_PER_M;
      const windageIn = z * IN_PER_M + sdIn;             // Coriolis is already inside z
      const eKg = 0.5 * massKg * v * v;
      const perYd = distYd * 36;

      results.push({
        rangeM: rangeM, rangeYd: distYd,
        dropIn: dropIn, dropCm: dropIn * 2.54,
        dropMoa: distYd > 0 ? (dropIn / perYd) * 3437.7468 : 0,
        dropMrad: distYd > 0 ? (dropIn / perYd) * 1000 : 0,
        windageIn: windageIn, windageCm: windageIn * 2.54,
        windageMoa: distYd > 0 ? (windageIn / perYd) * 3437.7468 : 0,
        windageMrad: distYd > 0 ? (windageIn / perYd) * 1000 : 0,
        velocityMps: v, velocityFps: v * 3.28084,
        mach, energyJ: eKg, energyFtLbs: eKg * 0.737562,
        tof: tof, spinDriftIn: sdIn,
        coriolisLatIn: corLatIn, coriolisVertIn: corVertIn,
        stabilityFactor: sg,
        isTransonic: mach >= 0.9 && mach <= 1.2,
        isSubsonic: mach < 0.9
      });
    });
    return results;
  }

  return { solve };
})();
if (typeof module !== 'undefined') module.exports = Solver;
