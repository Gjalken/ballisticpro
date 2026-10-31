/**
 * BallisticPro — Unit Conversion Module
 * Comprehensive unit conversion for ballistic calculations
 */

const Conversions = (() => {
  // ─── Constants ───
  const GRAINS_PER_GRAM = 15.4324;
  const GRAINS_PER_KG = 15432.4;
  const INCHES_PER_METER = 39.3701;
  const FEET_PER_METER = 3.28084;
  const YARDS_PER_METER = 1.09361;
  const FPS_PER_MPS = 3.28084;
  const MPS_PER_FPS = 0.3048;
  const MPH_PER_MPS = 2.23694;
  const KMH_PER_MPS = 3.6;
  const HPA_PER_INHG = 33.8639;
  const MMHG_PER_HPA = 0.750062;
  const MOA_PER_MRAD = 3.43775;
  const MRAD_PER_MOA = 0.290888;
  const MOA_PER_RAD = 3437.7468;
  const MRAD_PER_RAD = 1000;
  const FT_LBS_FACTOR = 450437;

  function metersToInches(m) { return m * INCHES_PER_METER; }
  function inchesToMeters(i) { return i / INCHES_PER_METER; }
  function metersToFeet(m) { return m * FEET_PER_METER; }
  function feetToMeters(ft) { return ft / FEET_PER_METER; }
  function metersToYards(m) { return m * YARDS_PER_METER; }
  function yardsToMeters(yd) { return yd / YARDS_PER_METER; }
  function inchesToMm(i) { return i * 25.4; }
  function mmToInches(mm) { return mm / 25.4; }
  function cmToInches(cm) { return cm / 2.54; }
  function inchesToCm(i) { return i * 2.54; }
  function grainsToGrams(gr) { return gr / GRAINS_PER_GRAM; }
  function gramsToGrains(g) { return g * GRAINS_PER_GRAM; }
  function grainsToKg(gr) { return gr / GRAINS_PER_KG; }
  function kgToGrains(kg) { return kg * GRAINS_PER_KG; }
  function fpsToMps(fps) { return fps * MPS_PER_FPS; }
  function mpsToFps(mps) { return mps * FPS_PER_MPS; }
  function mphToMps(mph) { return mph / MPH_PER_MPS; }
  function mpsToMph(mps) { return mps * MPH_PER_MPS; }
  function kmhToMps(kmh) { return kmh / KMH_PER_MPS; }
  function mpsToKmh(mps) { return mps * KMH_PER_MPS; }
  function inhgToHpa(inhg) { return inhg * HPA_PER_INHG; }
  function hpaToInhg(hpa) { return hpa / HPA_PER_INHG; }
  function hpaToMmhg(hpa) { return hpa * MMHG_PER_HPA; }
  function mmhgToHpa(mmhg) { return mmhg / MMHG_PER_HPA; }
  function celsiusToFahrenheit(c) { return c * 9 / 5 + 32; }
  function fahrenheitToCelsius(f) { return (f - 32) * 5 / 9; }
  function celsiusToKelvin(c) { return c + 273.15; }
  function kelvinToCelsius(k) { return k - 273.15; }
  function degreesToRadians(deg) { return deg * Math.PI / 180; }
  function radiansToDegrees(rad) { return rad * 180 / Math.PI; }
  function moaToMrad(moa) { return moa * MRAD_PER_MOA; }
  function mradToMoa(mrad) { return mrad * MOA_PER_MRAD; }
  function moaToRadians(moa) { return moa / MOA_PER_RAD; }
  function radiansToMoa(rad) { return rad * MOA_PER_RAD; }
  function mradToRadians(mrad) { return mrad / MRAD_PER_RAD; }
  function radiansToMrad(rad) { return rad * MRAD_PER_RAD; }
  function linearToMoa(inches, distanceYards) {
    if (distanceYards <= 0) return 0;
    return (inches / (distanceYards * 36)) * MOA_PER_RAD;
  }
  function linearToMrad(inches, distanceYards) {
    if (distanceYards <= 0) return 0;
    return (inches / (distanceYards * 36)) * MRAD_PER_RAD;
  }
  function moaToLinear(moa, distanceYards) { return (moa / MOA_PER_RAD) * distanceYards * 36; }
  function mradToLinear(mrad, distanceYards) { return (mrad / MRAD_PER_RAD) * distanceYards * 36; }
  function kineticEnergyFtLbs(massGrains, velocityFps) { return (massGrains * velocityFps * velocityFps) / FT_LBS_FACTOR; }
  function kineticEnergyJoules(massKg, velocityMps) { return 0.5 * massKg * velocityMps * velocityMps; }
  function ftLbsToJoules(ftlbs) { return ftlbs * 1.35582; }
  function joulesToFtLbs(j) { return j / 1.35582; }
  function momentum(massKg, velocityMps) { return massKg * velocityMps; }
  function twistToCalibersPerTurn(twistInches, caliberInches) { return twistInches / caliberInches; }
  function lengthInCalibers(lengthInches, caliberInches) { return lengthInches / caliberInches; }
  function spinRateRpm(velocityFps, twistInchesPerTurn) { return (velocityFps * 12 / twistInchesPerTurn) * 60; }

  return {
    metersToInches, inchesToMeters, metersToFeet, feetToMeters,
    metersToYards, yardsToMeters, inchesToMm, mmToInches, cmToInches, inchesToCm,
    grainsToGrams, gramsToGrains, grainsToKg, kgToGrains,
    fpsToMps, mpsToFps, mphToMps, mpsToMph, kmhToMps, mpsToKmh,
    inhgToHpa, hpaToInhg, hpaToMmhg, mmhgToHpa,
    celsiusToFahrenheit, fahrenheitToCelsius, celsiusToKelvin, kelvinToCelsius,
    degreesToRadians, radiansToDegrees, moaToMrad, mradToMoa,
    moaToRadians, radiansToMoa, mradToRadians, radiansToMrad,
    linearToMoa, linearToMrad, moaToLinear, mradToLinear,
    kineticEnergyFtLbs, kineticEnergyJoules, ftLbsToJoules, joulesToFtLbs,
    momentum, twistToCalibersPerTurn, lengthInCalibers, spinRateRpm,
    constants: { GRAINS_PER_GRAM, GRAINS_PER_KG, INCHES_PER_METER, FEET_PER_METER, YARDS_PER_METER, MPS_PER_FPS }
  };
})();
if (typeof module !== 'undefined') module.exports = Conversions;
