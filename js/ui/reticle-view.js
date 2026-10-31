/**
 * BallisticPro — Reticle View (Canvas Renderer)
 * Renders the selected reticle on a Canvas element and overlays
 * the calculated Point of Impact (POI).
 *
 * Supports: Mil-Dot, TMR, MOA Hash, Duplex, German #4, Crosshair
 */
const ReticleView = (() => {
  let canvas, ctx;
  let currentReticle = null;
  let currentSolution = null;
  let currentMag = 14;
  let scale = 40; // pixels per MIL (base scale)
  let currentAnimal = null;  // { silhouetteType, bodyHeightCm, vitalZoneCm }
  let showSilhouette = false;
  let showDotDistances = false;
  let extendedRange = false;   // shift zero to dot 5 upper = 10 MIL usable
  let ballisticTable = null;  // full results array for distance lookups
  let displayUnits = 'metric'; // 'metric' or 'imperial'

  // Colors
  const C = {
    bg: '#0a0e17',
    reticle: '#e2e8f0',
    reticleThin: 'rgba(226,232,240,0.7)',
    poi: '#ef4444',
    poiGlow: 'rgba(239,68,68,0.3)',
    label: '#94a3b8',
    labelBg: 'rgba(10,14,23,0.8)',
    grid: 'rgba(255,255,255,0.03)',
    accent: '#f59e0b',
    cyan: '#06b6d4'
  };

  /**
   * Initialize the reticle view with a canvas element.
   * @param {string} canvasId — ID of the canvas element
   */
  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    _resizeCanvas();
    window.addEventListener('resize', () => { _resizeCanvas(); render(); });
    // Re-render when silhouette images finish loading asynchronously
    if (typeof Silhouettes !== 'undefined' && Silhouettes.onReady) {
      Silhouettes.onReady(() => { if (showSilhouette) render(); });
    }
  }

  function _resizeCanvas() {
    if (!canvas) return;
    const container = canvas.parentElement;
    const size = Math.min(container.clientWidth, 600);
    canvas.width = size * (window.devicePixelRatio || 1);
    canvas.height = size * (window.devicePixelRatio || 1);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    scale = size / 16; // ~16 MIL total view width
  }

  /**
   * Set the current reticle definition.
   * @param {Object} reticle — From reticles.json
   */
  function setReticle(reticle) {
    currentReticle = reticle;
    render();
  }

  /**
   * Set the current firing solution (from ReticleCalc.getFiringSolution).
   * @param {Object} solution
   */
  function setSolution(solution) {
    currentSolution = solution;
    render();
  }

  /**
   * Set current magnification.
   * @param {number} mag
   */
  function setMagnification(mag) {
    currentMag = mag;
    render();
  }

  let _rafId = 0;

  /**
   * Request a redraw. Calls made in the same frame (setReticle + setSolution + setAnimal +
   * setMagnification …) are coalesced into ONE paint instead of one full repaint each.
   */
  function render() {
    if (!canvas || !ctx) return;
    if (typeof requestAnimationFrame !== 'function') { _renderNow(); return; }
    if (_rafId) return;
    _rafId = requestAnimationFrame(() => { _rafId = 0; _renderNow(); });
  }

  /**
   * Immediate render (internal).
   */
  function _renderNow() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = w / 2; // Square canvas

    ctx.save();
    ctx.scale(dpr, dpr);
    const size = w / dpr;
    const center = size / 2;

    // Clear
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, size, size);

    // Draw subtle grid
    _drawGrid(center, size);

    // Draw scope circle (tube view)
    _drawScopeCircle(center, size);

    // Draw reticle
    if (currentReticle) {
      const s = size / 16; // pixels per MIL
      switch (currentReticle.type) {
        case 'dots':    _drawMilDot(center, s, currentReticle.render); break;
        case 'hash':    _drawHashReticle(center, s, currentReticle.render, currentReticle.unit); break;
        case 'duplex':  _drawDuplex(center, s, currentReticle.render, true); break;
        case 'german4': _drawDuplex(center, s, currentReticle.render, false); break;
        case 'crosshair': _drawCrosshair(center, s, currentReticle.render); break;
        default:        _drawMilDot(center, s, currentReticle.render); break;
      }
    }

    // Draw silhouette (before POI so POI renders on top)
    if (showSilhouette && currentAnimal && currentSolution) {
      _drawSilhouette(center, size);
    }

    // Draw POI
    if (currentSolution) {
      _drawPOI(center, size);
    }

    // Draw distance labels on MIL dots
    if (showDotDistances && currentSolution) {
      _drawDotDistances(center, size);
    }

    ctx.restore();
  }

  function _drawGrid(center, size) {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 0.5;
    const s = size / 16;
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(center + i * s, 0);
      ctx.lineTo(center + i * s, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, center + i * s);
      ctx.lineTo(size, center + i * s);
      ctx.stroke();
    }
  }

  function _drawScopeCircle(center, size) {
    const radius = size * 0.46;
    // Dark vignette outside
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(center, center, radius, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fill();
    ctx.restore();

    // Scope ring
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(226,232,240,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function _drawMilDot(center, s, r) {
    const isMoa = currentReticle && currentReticle.unit === 'moa';
    const unitFactor = isMoa ? 0.2909 : 1;
    const gap = (r.centerGapMil || 0.5) * s;
    const thin = Math.max(1, (r.crosshairThicknessMil || 0.05) * s);
    const postW = Math.max(2.5, 0.45 * s);  // thick post width (matches image proportions)
    const dotR = Math.max(1.5, (r.dotDiameterMil || 0.2) * s / 2);
    const scopeR = center * 0.92;            // scope tube inner edge

    // Where thin crosshair ends and thick post begins (1 MIL past last dot)
    const thinEndL = (r.marksLeft + 1) * unitFactor * s;
    const thinEndR = (r.marksRight + 1) * unitFactor * s;
    const thinEndU = (r.marksAbove + 1) * unitFactor * s;
    const thinEndD = (r.marksBelow + 1) * unitFactor * s;

    ctx.strokeStyle = C.reticle;
    ctx.fillStyle = C.reticle;
    ctx.lineCap = 'butt';

    // ── Thin crosshair (center gap → 1 MIL past last dot) ──
    ctx.lineWidth = thin;
    ctx.beginPath(); ctx.moveTo(center - gap, center); ctx.lineTo(center - thinEndL, center); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center + gap, center); ctx.lineTo(center + thinEndR, center); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center, center - gap); ctx.lineTo(center, center - thinEndU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center, center + gap); ctx.lineTo(center, center + thinEndD); ctx.stroke();

    // ── Thick posts (from thin end → scope edge) ──
    ctx.lineWidth = postW;
    ctx.beginPath(); ctx.moveTo(center - thinEndL, center); ctx.lineTo(center - scopeR, center); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center + thinEndR, center); ctx.lineTo(center + scopeR, center); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center, center - thinEndU); ctx.lineTo(center, center - scopeR); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center, center + thinEndD); ctx.lineTo(center, center + scopeR); ctx.stroke();

    // ── Round dots at 1 MIL intervals ──
    for (let i = 1; i <= r.marksLeft; i++) {
      ctx.beginPath(); ctx.arc(center - i * unitFactor * s, center, dotR, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 1; i <= r.marksRight; i++) {
      ctx.beginPath(); ctx.arc(center + i * unitFactor * s, center, dotR, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 1; i <= r.marksAbove; i++) {
      ctx.beginPath(); ctx.arc(center, center - i * unitFactor * s, dotR, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 1; i <= r.marksBelow; i++) {
      ctx.beginPath(); ctx.arc(center, center + i * unitFactor * s, dotR, 0, Math.PI * 2); ctx.fill();
    }


    // Center crosshair intersection (fine point)
    ctx.beginPath();
    ctx.arc(center, center, 1, 0, Math.PI * 2);
    ctx.fillStyle = C.reticle;
    ctx.fill();
  }

  function _drawHashReticle(center, s, r, unit) {
    const isMoa = unit === 'moa';
    const unitFactor = isMoa ? 0.2909 : 1; // 1 MOA ≈ 0.2909 MIL
    const gap = (r.centerGapMil || 0.5) * s;
    const thick = Math.max(1, (r.crosshairThicknessMil || 0.05) * s);
    const hashLen = (isMoa ? (r.hashLengthMoa || 0.5) / 3.438 : (r.hashLengthMil || 0.3)) * s;
    const halfHashLen = (r.halfHashLengthMil || hashLen / 2 / s) * s;

    ctx.strokeStyle = C.reticle;
    ctx.lineWidth = thick;

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(center - r.marksLeft * unitFactor * s - s, center);
    ctx.lineTo(center - gap, center);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(center + gap, center);
    ctx.lineTo(center + r.marksRight * unitFactor * s + s, center);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(center, center - r.marksAbove * unitFactor * s - s);
    ctx.lineTo(center, center - gap);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(center, center + gap);
    ctx.lineTo(center, center + r.marksBelow * unitFactor * s + s);
    ctx.stroke();

    // Hash marks
    const hashW = Math.max(1, thick);
    ctx.lineWidth = hashW;

    // Horizontal hashes (perpendicular = vertical lines on the horizontal axis)
    for (let i = 1; i <= r.marksLeft; i++) {
      const x = center - i * unitFactor * s;
      ctx.beginPath(); ctx.moveTo(x, center - hashLen); ctx.lineTo(x, center + hashLen); ctx.stroke();
      if (r.halfMarks && i < r.marksLeft) {
        const hx = center - (i + 0.5) * unitFactor * s;
        ctx.beginPath(); ctx.moveTo(hx, center - halfHashLen); ctx.lineTo(hx, center + halfHashLen); ctx.stroke();
      }
    }
    for (let i = 1; i <= r.marksRight; i++) {
      const x = center + i * unitFactor * s;
      ctx.beginPath(); ctx.moveTo(x, center - hashLen); ctx.lineTo(x, center + hashLen); ctx.stroke();
      if (r.halfMarks && i < r.marksRight) {
        const hx = center + (i + 0.5) * unitFactor * s;
        ctx.beginPath(); ctx.moveTo(hx, center - halfHashLen); ctx.lineTo(hx, center + halfHashLen); ctx.stroke();
      }
    }

    // Vertical hashes (perpendicular = horizontal lines on the vertical axis)
    for (let i = 1; i <= r.marksAbove; i++) {
      const y = center - i * unitFactor * s;
      ctx.beginPath(); ctx.moveTo(center - hashLen, y); ctx.lineTo(center + hashLen, y); ctx.stroke();
      if (r.halfMarks && i < r.marksAbove) {
        const hy = center - (i + 0.5) * unitFactor * s;
        ctx.beginPath(); ctx.moveTo(center - halfHashLen, hy); ctx.lineTo(center + halfHashLen, hy); ctx.stroke();
      }
    }
    for (let i = 1; i <= r.marksBelow; i++) {
      const y = center + i * unitFactor * s;
      ctx.beginPath(); ctx.moveTo(center - hashLen, y); ctx.lineTo(center + hashLen, y); ctx.stroke();
      if (r.halfMarks && i < r.marksBelow) {
        const hy = center + (i + 0.5) * unitFactor * s;
        ctx.beginPath(); ctx.moveTo(center - halfHashLen, hy); ctx.lineTo(center + halfHashLen, hy); ctx.stroke();
      }
    }

    // Numeric labels on RIGHT arm
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 1; i <= r.marksRight; i++) {
      const x = center + i * unitFactor * s;
      ctx.fillText(String(i), x, center + hashLen + 3);
    }

    // Numeric labels on BOTTOM arm
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 1; i <= r.marksBelow; i++) {
      const y = center + i * unitFactor * s;
      ctx.fillText(String(i), center + hashLen + 3, y);
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(center, center, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = C.reticle;
    ctx.fill();
  }

  function _drawDuplex(center, s, r, hasTopPost) {
    const thick = Math.max(1, (r.crosshairThicknessMil || 0.05) * s);
    const postW = Math.max(2, (r.thickPostWidthMil || 0.8) * s);
    const postLen = (r.thickPostLengthMil || 10) * s;
    const thinLen = (r.thinCrosshairLengthMil || 5) * s;
    const scopeR = center * 0.46 * 2;

    // Thin crosshairs
    ctx.strokeStyle = C.reticle;
    ctx.lineWidth = thick;
    // Left thin
    ctx.beginPath(); ctx.moveTo(center - thinLen, center); ctx.lineTo(center, center); ctx.stroke();
    // Right thin
    ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(center + thinLen, center); ctx.stroke();
    // Top thin
    ctx.beginPath(); ctx.moveTo(center, center - thinLen); ctx.lineTo(center, center); ctx.stroke();
    // Bottom thin
    ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(center, center + thinLen); ctx.stroke();

    // Thick posts
    ctx.lineWidth = postW;
    ctx.lineCap = 'butt';
    // Left post
    ctx.beginPath(); ctx.moveTo(center - thinLen - postLen, center); ctx.lineTo(center - thinLen, center); ctx.stroke();
    // Right post
    ctx.beginPath(); ctx.moveTo(center + thinLen, center); ctx.lineTo(center + thinLen + postLen, center); ctx.stroke();
    // Bottom post
    ctx.beginPath(); ctx.moveTo(center, center + thinLen); ctx.lineTo(center, center + thinLen + postLen); ctx.stroke();
    // Top post (duplex) or thin (german4)
    if (hasTopPost) {
      ctx.beginPath(); ctx.moveTo(center, center - thinLen - postLen); ctx.lineTo(center, center - thinLen); ctx.stroke();
    } else {
      ctx.lineWidth = thick;
      ctx.beginPath(); ctx.moveTo(center, center - thinLen - postLen * 0.7); ctx.lineTo(center, center - thinLen); ctx.stroke();
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(center, center, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = C.reticle;
    ctx.fill();
  }

  function _drawCrosshair(center, s, r) {
    const thick = Math.max(1, (r.crosshairThicknessMil || 0.05) * s);
    const gap = (r.centerGapMil || 0.25) * s;
    const len = center * 0.8;

    ctx.strokeStyle = C.reticle;
    ctx.lineWidth = thick;

    // Horizontal
    ctx.beginPath(); ctx.moveTo(center - len, center); ctx.lineTo(center - gap, center); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center + gap, center); ctx.lineTo(center + len, center); ctx.stroke();
    // Vertical
    ctx.beginPath(); ctx.moveTo(center, center - len); ctx.lineTo(center, center - gap); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center, center + gap); ctx.lineTo(center, center + len); ctx.stroke();
  }

  function _drawPOI(center, size) {
    if (!currentSolution) return;
    const s = size / 16;

    // Extended range mode: zero shifts to dot 5 on upper arm
    const zeroY = extendedRange ? (center - 5 * s) : center;

    const isMoa = currentSolution.holdover.unit === 'MOA';
    const toMil = isMoa ? (1 / 3.43775) : 1;

    // Apparent reading on the reticle at the current power (single source: ReticleCalc)
    const apparentHold = currentSolution.holdover.value;
    const apparentWind = currentSolution.windage.value;

    const holdMil = apparentHold * toMil;
    const windMil = apparentWind * toMil;

    const dirY = currentSolution.holdover.direction === 'down' ? 1 : -1;
    const dirX = currentSolution.windage.direction === 'right' ? 1 : -1;

    // POI position on canvas — relative to zeroY (shifted in extended mode)
    const px = center + dirX * windMil * s;
    const py = zeroY + dirY * holdMil * s;

    // Check if POI is within visible area
    if (px < 0 || px > size || py < 0 || py > size) {
      _drawPOIArrow(center, size, px, py);
      return;
    }

    // Glow
    const grad = ctx.createRadialGradient(px, py, 0, px, py, 12);
    grad.addColorStop(0, C.poi);
    grad.addColorStop(0.5, C.poiGlow);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, 12, 0, Math.PI * 2);
    ctx.fill();

    // POI dot
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = C.poi;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label — show apparent position on reticle (what you actually see)
    const holdUnit = currentSolution.holdover.unit;
    const holdVal = apparentHold.toFixed(1);
    const windVal = apparentWind.toFixed(1);
    const holdDir = currentSolution.holdover.direction === 'down' ? '↓' : '↑';
    const windDir = currentSolution.windage.direction === 'right' ? '→' : '←';

    const label = `${holdVal} ${holdUnit} ${holdDir}  ${windVal} ${holdUnit} ${windDir}`;

    ctx.font = '11px "JetBrains Mono", monospace';
    const tw = ctx.measureText(label).width;
    const th = 14;
    const pad = 10;

    // Place label DIAGONALLY from POI, away from center, so it never overlaps crosshairs
    const offX = (px >= center) ? pad : -(pad + tw);
    const offY = (py >= center) ? pad : -(pad + th);

    const lx = px + offX;
    const ly = py + offY;

    // Clamp to canvas bounds
    const clx = Math.max(2, Math.min(lx, size - tw - 4));
    const cly = Math.max(2, Math.min(ly, size - th - 2));

    // Label background
    ctx.fillStyle = C.labelBg;
    ctx.fillRect(clx - 2, cly - 1, tw + 4, th + 2);

    // Label text
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, clx, cly);
  }

  function _drawPOIArrow(center, size, px, py) {
    // Draw arrow at the edge indicating POI is off-screen
    const angle = Math.atan2(py - center, px - center);
    const edgeR = size * 0.42;
    const ax = center + Math.cos(angle) * edgeR;
    const ay = center + Math.sin(angle) * edgeR;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);

    ctx.fillStyle = C.poi;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();

    // Distance label
    if (currentSolution) {
      const dist = Math.sqrt(
        Math.pow(currentSolution.dropMil, 2) +
        Math.pow(currentSolution.windageMil, 2)
      ).toFixed(1);
      ctx.rotate(-angle);
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = C.poi;
      ctx.textAlign = 'center';
      ctx.fillText(dist + ' MIL', 0, -10);
    }

    ctx.restore();
  }

  /**
   * Draw target animal silhouette at the correct angular size.
   */
  function _drawSilhouette(center, size) {
    if (!currentAnimal || !currentSolution) return;

    const s = size / 16; // pixels per MIL
    const type = currentAnimal.silhouetteType || 'generic';
    const bodyH = currentAnimal.bodyHeightCm / 100; // meters

    // Extended range mode: zero shifts to dot 5 on upper arm
    const zeroY = extendedRange ? (center - 5 * s) : center;

    const distM = currentSolution.distanceM || 100;
    if (distM <= 0) return;

    // Angular size in MIL = (height_m * 1000) / distance_m
    const bodyMil = (bodyH * 1000) / distM;

    // SFP magnification — same single source (ReticleCalc) as _drawPOI so both stay aligned
    const magRatio = currentSolution.magRatio || 1;

    // Silhouette body scales with magnification in SFP
    const apparentMil = bodyMil * magRatio;

    // Height in pixels on canvas
    const hPx = apparentMil * s;
    if (hPx < 8) return; // too small to render

    const aspect = Silhouettes.getAspect(type);
    const wPx = hPx * aspect;

    // Calculate POI position — IDENTICAL math to _drawPOI
    const isMoa = currentSolution.holdover.unit === 'MOA';
    const toMil = isMoa ? (1 / 3.43775) : 1;
    const apparentHold = currentSolution.holdover.value;
    const apparentWind = currentSolution.windage.value;
    const holdMil = apparentHold * toMil;
    const windMil = apparentWind * toMil;
    const holdSign = currentSolution.holdover.direction === 'down' ? 1 : -1;
    const windSign = currentSolution.windage.direction === 'right' ? 1 : -1;

    const poiX = center + windSign * windMil * s;
    const poiY = zeroY + holdSign * holdMil * s;

    // Position silhouette so VITAL ZONE aligns with POI
    // (you aim above target with holdover, bullet hits the vital zone)
    const vz = Silhouettes.vitalZones[type] || Silhouettes.vitalZones.generic;
    const silX = poiX - vz.x * wPx;
    const silY = poiY - vz.y * hPx;

    // Draw silhouette then vital zone on top
    Silhouettes.draw(ctx, type, silX, silY, hPx, '#ffffff');
    Silhouettes.drawVitalZone(ctx, type, silX, silY, hPx, '#ef4444');
  }

  /**
   * Set the target animal for silhouette display.
   * @param {object|null} animal — { silhouetteType, bodyHeightCm, vitalZoneCm }
   */
  function setAnimal(animal) {
    currentAnimal = animal;
    render();
  }

  /**
   * Toggle silhouette visibility.
   */
  function setShowSilhouette(show) {
    showSilhouette = show;
    render();
  }

  function setShowDotDistances(show) {
    showDotDistances = show;
    render();
  }

  function setExtendedRange(enabled) {
    extendedRange = enabled;
    render();
  }

  function setBallisticTable(results, units) {
    ballisticTable = results;
    displayUnits = units || 'metric';
  }

  /**
   * Draw distance labels next to MIL dots.
   *
   * Normal mode: labels on dots 1-5 of the LOWER arm.
   *
   * Extended range mode: the new zero is at dot 5 UPPER.
   *   Dot 5 upper = 0 MIL drop (new zero)
   *   Dot 4 upper = 1 MIL drop
   *   ...
   *   Center      = 5 MIL drop
   *   Dot 1 lower = 6 MIL drop
   *   ...
   *   Dot 5 lower = 10 MIL drop
   *
   * This doubles the usable holdover range from 5 to 10 MIL.
   */
  function _drawDotDistances(center, size) {
    if (!ballisticTable || ballisticTable.length < 2) return;

    const s = size / 16; // pixels per MIL
    const fp = currentSolution ? currentSolution.focalPlane : 'SFP';
    const refMag = currentSolution ? (currentSolution.refMag || 14) : 14;
    const milFactor = (fp === 'SFP') ? (refMag / currentMag) : 1;
    const isMetric = displayUnits === 'metric';

    ctx.save();
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    if (!extendedRange) {
      // ─── Normal mode: labels on lower arm (4 dots + post at 5 MIL) ───
      for (let dot = 1; dot <= 5; dot++) {
        const trueMil = dot * milFactor;
        const dist = _findDistanceForDrop(trueMil);
        if (dist === null) continue;
        _drawDistLabel(center + dot * s, center + 12, dist, isMetric, '#06b6d4');
      }
    } else {
      // ─── Extended range mode ───
      // Mark dot 5 upper as the new zero
      const zeroY = center - 5 * s;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center, zeroY, 5, 0, Math.PI * 2);
      ctx.stroke();
      // "ZERO" label
      ctx.fillStyle = 'rgba(10,14,23,0.85)';
      ctx.beginPath();
      ctx.roundRect(center + 10, zeroY - 7, 32, 14, 3);
      ctx.fill();
      ctx.fillStyle = '#f59e0b';
      ctx.textAlign = 'left';
      ctx.fillText('ZERO', center + 13, zeroY);

      // Labels on all positions: upper dots 4→1, center, lower dots 1→5
      // Dot 5 upper = 0 MIL, dot 4 upper = 1 MIL, ..., center = 5 MIL, ..., dot 5 lower = 10 MIL
      for (let milDrop = 1; milDrop <= 10; milDrop++) {
        const trueMil = milDrop * milFactor;
        const dist = _findDistanceForDrop(trueMil);
        if (dist === null) continue;

        // Canvas Y position: dot 5 upper + milDrop dots down
        const posY = zeroY + milDrop * s;
        // Choose side: upper arm labels on right, lower arm labels on right too
        const posX = center + 12;
        const color = (milDrop <= 5) ? '#a78bfa' : '#06b6d4'; // purple for upper, cyan for lower

        _drawDistLabel(posY, posX, dist, isMetric, color);
      }
    }
    ctx.restore();
  }

  /**
   * Helper: draw a single distance label at a canvas position.
   */
  function _drawDistLabel(y, x, distM, isMetric, color) {
    const displayDist = isMetric ? Math.round(distM) : Math.round(distM / 0.9144);
    const unit = isMetric ? 'm' : 'yd';
    const label = displayDist + unit;

    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(10,14,23,0.85)';
    ctx.beginPath();
    ctx.roundRect(x - 2, y - 7, tw + 6, 14, 3);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 1, y);
  }

  /**
   * Find the distance (in meters) where bullet drop equals the given MIL value.
   * Uses linear interpolation between ballistic table entries.
   */
  function _findDistanceForDrop(targetMil) {
    if (!ballisticTable || ballisticTable.length < 2) return null;

    // Convert target MIL to MOA for comparison (table has dropMoa)
    const targetMoa = targetMil * 3.43775;

    for (let i = 1; i < ballisticTable.length; i++) {
      const prev = ballisticTable[i - 1];
      const curr = ballisticTable[i];
      const prevDrop = Math.abs(prev.dropMoa);
      const currDrop = Math.abs(curr.dropMoa);

      if (prevDrop <= targetMoa && currDrop >= targetMoa) {
        const range = currDrop - prevDrop;
        if (range < 0.001) return curr.rangeM;
        const t = (targetMoa - prevDrop) / range;
        return prev.rangeM + t * (curr.rangeM - prev.rangeM);
      }
    }
    return null;
  }

  /**
   * Public resize — call when the canvas container becomes visible
   * (e.g. tab switch) to recalculate dimensions and re-render.
   */
  function resize() {
    _resizeCanvas();
    _renderNow();
  }

  return { init, setReticle, setSolution, setMagnification, setAnimal,
           setShowSilhouette, setShowDotDistances, setExtendedRange,
           setBallisticTable, render, resize };
})();

if (typeof module !== 'undefined') module.exports = ReticleView;
