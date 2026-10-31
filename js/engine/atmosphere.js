/**
 * BallisticPro — Atmosphere Model (ICAO Standard)
 */
const Atmosphere = (() => {
  const R = 8.31447, M_AIR = 0.0289644, GAMMA = 1.4, G = 9.80665;
  const LAPSE = 0.0065, T0 = 288.15, P0 = 1013.25, RHO0 = 1.225;

  function satVaporPressure(tC) {
    return 611.21 * Math.exp((17.502 * tC) / (240.97 + tC));
  }

  function airDensity(pHpa, tC, rh) {
    rh = rh || 0;
    const P = pHpa * 100, T = tC + 273.15;
    const e = (rh / 100) * satVaporPressure(tC);
    return (P * M_AIR) / (R * T) * (1 - 0.378 * e / P);
  }

  function speedOfSound(tC) {
    return Math.sqrt(GAMMA * R * (tC + 273.15) / M_AIR);
  }

  function machNumber(vMps, tC) { return vMps / speedOfSound(tC); }

  function isaPressure(altM) {
    const exp = (G * M_AIR) / (R * LAPSE);
    return P0 * Math.pow((T0 - LAPSE * altM) / T0, exp);
  }

  function densityAltitude(pHpa, tC, rh) {
    const rho = airDensity(pHpa, tC, rh || 0);
    const n = (G * M_AIR) / (R * LAPSE);
    return (T0 / LAPSE) * (1 - Math.pow(rho / RHO0, 1 / (n - 1)));
  }

  function getAtmosphere(p) {
    let { tempC = 15, pressureHpa, rh = 0, altitudeM = 0 } = p;
    if (!pressureHpa) pressureHpa = altitudeM ? isaPressure(altitudeM) : P0;
    const rho = airDensity(pressureHpa, tempC, rh);
    const a = speedOfSound(tempC);
    const da = densityAltitude(pressureHpa, tempC, rh);
    return {
      tempC, tempK: tempC + 273.15, pressureHpa, pressurePa: pressureHpa * 100,
      rh, density: rho, densityRatio: rho / RHO0, speedOfSound: a,
      densityAltitudeM: da, densityAltitudeFt: da * 3.28084
    };
  }

  return { airDensity, speedOfSound, machNumber, isaPressure, densityAltitude, getAtmosphere,
    constants: { R, M_AIR, GAMMA, G, LAPSE, T0, P0, RHO0 } };
})();
if (typeof module !== 'undefined') module.exports = Atmosphere;
