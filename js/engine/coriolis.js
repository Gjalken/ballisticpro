/**
 * BallisticPro — Coriolis & Eötvös Effect Module
 */
const Coriolis = (() => {
  const OMEGA = 7.292115e-5; // Earth angular velocity (rad/s)

  function acceleration(latRad, vx, vy, vz) {
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    return {
      ax: 2 * OMEGA * (vy * sinLat - vz * cosLat),
      ay: -2 * OMEGA * vx * sinLat,
      az: 2 * OMEGA * vx * cosLat
    };
  }

  function toEarthFrame(vForward, vVertical, vLateral, azimuthRad) {
    const sinAz = Math.sin(azimuthRad);
    const cosAz = Math.cos(azimuthRad);
    return {
      vEast:  vForward * sinAz + vLateral * cosAz,
      vNorth: vForward * cosAz - vLateral * sinAz,
      vUp:    vVertical
    };
  }

  function toShooterFrame(ax, ay, az, azimuthRad) {
    const sinAz = Math.sin(azimuthRad);
    const cosAz = Math.cos(azimuthRad);
    return {
      aForward:  ax * sinAz + ay * cosAz,
      aLateral:  ax * cosAz - ay * sinAz,
      aVertical: az
    };
  }

  function getCorrection(params) {
    const latRad = params.latDeg * Math.PI / 180;
    const azRad = params.azimuthDeg * Math.PI / 180;
    const ef = toEarthFrame(params.vForward, params.vVertical, params.vLateral || 0, azRad);
    const accel = acceleration(latRad, ef.vEast, ef.vNorth, ef.vUp);
    return toShooterFrame(accel.ax, accel.ay, accel.az, azRad);
  }

  function estimateHorizontalDeflection(latDeg, tof, velMps) {
    const latRad = latDeg * Math.PI / 180;
    return OMEGA * Math.sin(latRad) * velMps * tof * tof;
  }

  return {
    acceleration, toEarthFrame, toShooterFrame, getCorrection,
    estimateHorizontalDeflection, OMEGA
  };
})();
if (typeof module !== 'undefined') module.exports = Coriolis;
