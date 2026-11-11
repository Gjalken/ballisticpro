/**
 * BallisticPro — Target Silhouettes (Image-based with polygon fallback)
 * Uses pre-rendered PNG silhouette images for perfect animal shapes.
 * Falls back to simple recognizable polygon outlines if images can't load.
 * Images are tinted to the desired color at draw time via Canvas composite.
 */
const Silhouettes = (() => {

  // Vital zone positions — relative to full image bounding box (0-1)
  // Hunting rule: behind front shoulder crease, 1/3 up from chest bottom
  // Calibrated by: body center → offset 30-40% toward front for heart/lungs
  // Note: bovine, boar & bird face RIGHT; all others face LEFT
  const vitalZones = {
    deer:      { x: 0.47, y: 0.53, rFactor: 0.06 },  // front leg ~0.36, heart behind at ~0.47
    bovine:    { x: 0.58, y: 0.48, rFactor: 0.07 },  // faces RIGHT, front leg ~0.62, heart behind at ~0.58
    camelid:   { x: 0.48, y: 0.52, rFactor: 0.05 },  // body center ~0.52, heart at ~0.48
    equine:    { x: 0.47, y: 0.47, rFactor: 0.06 },  // user-confirmed ✓
    boar:      { x: 0.55, y: 0.42, rFactor: 0.07 },  // faces RIGHT, front leg ~0.58, heart behind at ~0.55
    rabbit:    { x: 0.42, y: 0.52, rFactor: 0.08 },  // sitting, body center ~0.45
    bird:      { x: 0.78, y: 0.47, rFactor: 0.09 },  // faces RIGHT (dove/pigeon), chest center
    duck:      { x: 0.40, y: 0.49, rFactor: 0.08 },  // faces LEFT (dabbling duck), breast/thorax
    goose:     { x: 0.41, y: 0.52, rFactor: 0.08 },  // faces LEFT (Chloephaga upland goose), breast/thorax
    coot:      { x: 0.42, y: 0.50, rFactor: 0.08 },  // faces LEFT (Fulica coot), thorax center
    cormorant: { x: 0.53, y: 0.49, rFactor: 0.07 },  // faces RIGHT (Phalacrocorax yeco), upper chest
    quail:     { x: 0.40, y: 0.50, rFactor: 0.08 },  // faces LEFT (California quail), breast/thorax
    partridge: { x: 0.40, y: 0.49, rFactor: 0.08 },  // faces LEFT (Chilean tinamou), plump thorax
    pheasant:  { x: 0.24, y: 0.52, rFactor: 0.07 },  // faces LEFT (long tail on right), chest center
    raptor:    { x: 0.41, y: 0.45, rFactor: 0.07 },  // faces LEFT (Southern caracara / traro), thorax
    parrot:    { x: 0.37, y: 0.36, rFactor: 0.07 },  // faces LEFT (Monk parakeet), perched upper chest
    songbird:  { x: 0.37, y: 0.47, rFactor: 0.08 },  // faces LEFT (Austral thrush / passerine), thorax
    goat:      { x: 0.44, y: 0.48, rFactor: 0.06 },  // body center ~0.50, heart at ~0.44
    fox:       { x: 0.34, y: 0.46, rFactor: 0.07 },  // body center ~0.40, heart at ~0.34
    beaver:    { x: 0.30, y: 0.50, rFactor: 0.07 },  // faces LEFT, stout chest behind foreleg
    muskrat:   { x: 0.31, y: 0.50, rFactor: 0.07 },  // faces LEFT, compact rodent thorax
    mink:      { x: 0.30, y: 0.51, rFactor: 0.06 },  // faces LEFT (American mink), chest behind foreleg
    generic:   { x: 0.44, y: 0.48, rFactor: 0.07 }
  };

  const aspects = {
    deer: 1.30, bovine: 1.35, camelid: 0.85, equine: 1.10,
    boar: 1.30, rabbit: 0.75, bird: 1.18, duck: 1.00,
    goose: 1.00, coot: 1.00, cormorant: 1.00, quail: 1.00,
    partridge: 1.00, pheasant: 1.00, raptor: 1.00, parrot: 1.00,
    songbird: 1.00, goat: 1.15, fox: 1.50, beaver: 1.00,
    muskrat: 1.00, mink: 1.00, generic: 1.30
  };

  // ── Image system ──
  const images = {};
  const tintedCache = {};
  const TYPES = [
    'deer', 'bovine', 'camelid', 'equine', 'boar', 'rabbit',
    'bird', 'duck', 'goose', 'coot', 'cormorant', 'quail',
    'partridge', 'pheasant', 'raptor', 'parrot', 'songbird',
    'goat', 'fox', 'beaver', 'muskrat', 'mink'
  ];
  let _onReadyCallback = null;
  let _imagesAvailable = false;

  function preload() {
    let loaded = 0;
    let failed = 0;
    TYPES.forEach(type => {
      const img = new Image();
      // Try multiple path strategies
      img.src = `img/silhouettes/${type}.png`;
      img.onload = () => {
        images[type] = img;
        loaded++;
        _imagesAvailable = true;
        // Clear tinted cache
        Object.keys(tintedCache).forEach(k => { if (k.startsWith(type + '_')) delete tintedCache[k]; });
        if (_onReadyCallback) _onReadyCallback();
      };
      img.onerror = () => {
        failed++;
        // If all failed, images aren't available
        if (failed === TYPES.length) _imagesAvailable = false;
      };
    });
  }

  function onReady(cb) { _onReadyCallback = cb; }

  // Parse hex color to RGB
  function _hexToRGB(hex) {
    const r = parseInt(hex.slice(1, 3), 16) || 255;
    const g = parseInt(hex.slice(3, 5), 16) || 255;
    const b = parseInt(hex.slice(5, 7), 16) || 255;
    return [r, g, b];
  }

  /**
   * Create tinted silhouette from image.
   * The PNGs are true alpha masks (black + alpha channel), so tinting is a single
   * GPU-friendly composite: fill with the colour, keep it only where the mask is opaque.
   * (Previously every image was scanned pixel-by-pixel with getImageData at 1024² px.)
   */
  function _getTinted(type, color) {
    const key = `${type}_${color}`;
    if (tintedCache[key]) return tintedCache[key];
    const img = images[type];
    if (!img) return null;

    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx = c.getContext('2d');
    cx.fillStyle = color;
    cx.fillRect(0, 0, c.width, c.height);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(img, 0, 0);

    tintedCache[key] = c;
    return c;
  }

  // ── Polygon fallback system ──
  // Simple but recognizable outlines
  const _poly = {
    equine: [
      [0.06,0.45],[0.02,0.40],[0.01,0.34],[0.04,0.28],[0.08,0.24],[0.11,0.21],
      [0.09,0.14],[0.07,0.06],[0.08,0.01],[0.10,0.00],[0.12,0.04],[0.13,0.17],
      [0.15,0.21],[0.15,0.13],[0.15,0.05],[0.17,0.00],[0.19,0.01],[0.21,0.12],[0.21,0.17],
      [0.23,0.22],[0.32,0.21],[0.48,0.21],[0.60,0.22],
      [0.66,0.27],[0.70,0.34],[0.74,0.52],[0.77,0.61],[0.75,0.60],[0.72,0.46],
      [0.70,0.54],[0.72,0.69],[0.73,0.93],[0.75,0.98],[0.72,0.98],
      [0.69,0.88],[0.64,0.63],[0.62,0.59],
      [0.51,0.63],[0.39,0.64],[0.30,0.60],
      [0.27,0.62],[0.25,0.77],[0.25,0.93],[0.27,0.98],[0.24,0.98],
      [0.21,0.87],[0.17,0.67],[0.16,0.62],
      [0.12,0.50],[0.08,0.45]
    ],
    deer: [
      [0.06,0.34],[0.03,0.29],[0.06,0.24],[0.10,0.21],
      [0.10,0.12],[0.12,0.06],[0.13,0.09],[0.14,0.19],[0.15,0.22],
      [0.22,0.22],[0.35,0.21],[0.55,0.21],[0.65,0.23],
      [0.74,0.30],[0.78,0.33],[0.79,0.31],[0.78,0.34],[0.77,0.37],
      [0.77,0.52],[0.79,0.76],[0.80,0.92],[0.81,0.97],[0.78,0.97],
      [0.73,0.70],[0.69,0.56],
      [0.57,0.58],[0.41,0.58],[0.31,0.54],
      [0.27,0.64],[0.26,0.80],[0.26,0.88],[0.27,0.97],[0.24,0.97],
      [0.19,0.68],[0.14,0.52],[0.09,0.38],[0.07,0.36]
    ],
    bovine: [
      [0.06,0.34],[0.02,0.28],[0.06,0.22],[0.08,0.20],
      [0.10,0.12],[0.11,0.10],[0.12,0.12],[0.15,0.18],[0.15,0.20],
      [0.22,0.19],[0.35,0.18],[0.55,0.19],[0.65,0.21],
      [0.74,0.28],[0.79,0.39],
      [0.81,0.49],[0.82,0.59],[0.81,0.57],[0.79,0.46],
      [0.80,0.68],[0.82,0.92],[0.83,0.97],[0.80,0.97],
      [0.75,0.70],[0.73,0.62],
      [0.59,0.66],[0.41,0.66],[0.30,0.62],
      [0.26,0.72],[0.25,0.88],[0.26,0.97],[0.23,0.97],
      [0.18,0.68],[0.13,0.52],[0.08,0.38],[0.06,0.36]
    ],
    camelid: [
      [0.11,0.10],[0.07,0.06],[0.07,0.04],[0.08,0.02],
      [0.09,0.00],[0.10,0.00],[0.12,0.05],[0.12,0.08],
      [0.14,0.18],[0.18,0.36],[0.20,0.40],
      [0.30,0.41],[0.48,0.40],[0.66,0.42],
      [0.76,0.47],[0.81,0.49],[0.82,0.47],[0.81,0.50],[0.80,0.53],
      [0.81,0.76],[0.82,0.92],[0.83,0.97],[0.80,0.97],
      [0.75,0.70],[0.73,0.62],
      [0.58,0.65],[0.38,0.65],[0.32,0.63],
      [0.26,0.73],[0.25,0.89],[0.26,0.97],[0.23,0.97],
      [0.18,0.69],[0.14,0.54],[0.13,0.47],
      [0.11,0.36],[0.09,0.18],[0.09,0.13]
    ],
    boar: [
      [0.06,0.44],[0.01,0.39],[0.00,0.36],[0.01,0.33],
      [0.06,0.25],[0.10,0.20],
      [0.12,0.15],[0.13,0.14],[0.14,0.16],
      [0.21,0.12],[0.25,0.11],[0.33,0.14],
      [0.41,0.20],[0.53,0.29],[0.65,0.35],
      [0.72,0.41],[0.74,0.39],[0.75,0.37],[0.74,0.39],[0.73,0.43],
      [0.74,0.58],[0.76,0.82],[0.77,0.94],[0.74,0.94],
      [0.69,0.70],[0.65,0.56],
      [0.51,0.61],[0.36,0.61],[0.30,0.58],
      [0.25,0.68],[0.24,0.84],[0.25,0.94],[0.22,0.94],
      [0.17,0.72],[0.12,0.56],[0.07,0.46]
    ],
    rabbit: [
      [0.20,0.50],[0.16,0.44],[0.18,0.36],[0.20,0.30],
      [0.19,0.18],[0.20,0.07],[0.22,0.03],[0.23,0.05],[0.24,0.17],[0.24,0.24],
      [0.25,0.11],[0.27,0.02],[0.28,0.00],[0.30,0.04],[0.30,0.17],[0.30,0.24],
      [0.31,0.30],[0.34,0.34],
      [0.50,0.33],[0.62,0.36],[0.74,0.46],[0.78,0.52],
      [0.80,0.50],[0.81,0.48],[0.80,0.50],[0.79,0.54],
      [0.78,0.68],[0.78,0.84],
      [0.76,0.95],[0.72,0.97],[0.68,0.96],
      [0.68,0.82],[0.65,0.67],
      [0.51,0.67],[0.37,0.63],
      [0.31,0.72],[0.28,0.88],[0.29,0.95],[0.27,0.95],
      [0.23,0.79],[0.21,0.64],[0.20,0.54]
    ],
    bird: [
      [0.04,0.36],[0.00,0.32],[0.02,0.31],[0.10,0.27],[0.18,0.25],[0.21,0.27],
      [0.26,0.32],[0.36,0.30],[0.48,0.29],[0.60,0.32],
      [0.76,0.39],[0.92,0.44],[0.98,0.46],
      [0.86,0.50],[0.70,0.51],
      [0.58,0.56],[0.42,0.62],[0.36,0.62],
      [0.31,0.72],[0.28,0.90],[0.25,0.95],[0.28,0.93],[0.34,0.96],[0.32,0.92],[0.30,0.86],
      [0.26,0.70],[0.24,0.64],
      [0.17,0.50],[0.09,0.40],[0.06,0.38]
    ],
    goat: [
      [0.06,0.34],[0.03,0.27],[0.07,0.22],[0.09,0.21],
      [0.10,0.13],[0.12,0.06],[0.13,0.05],[0.15,0.11],
      [0.16,0.16],[0.18,0.17],[0.18,0.19],
      [0.24,0.21],[0.38,0.21],[0.53,0.22],[0.63,0.24],
      [0.70,0.31],[0.72,0.35],
      [0.73,0.32],[0.74,0.30],[0.73,0.33],[0.72,0.37],
      [0.73,0.60],[0.75,0.84],[0.75,0.92],[0.76,0.97],[0.73,0.97],
      [0.68,0.70],[0.64,0.56],
      [0.50,0.59],[0.36,0.57],[0.32,0.55],
      [0.27,0.65],[0.26,0.81],[0.26,0.89],[0.27,0.97],[0.24,0.97],
      [0.19,0.69],[0.14,0.53],[0.09,0.39],
      [0.06,0.37],[0.06,0.40],[0.07,0.38],[0.07,0.36]
    ],
    fox: [
      [0.03,0.46],[0.00,0.41],[0.03,0.35],[0.05,0.33],
      [0.07,0.23],[0.09,0.16],[0.10,0.19],[0.10,0.24],
      [0.11,0.20],[0.12,0.17],[0.13,0.20],[0.13,0.25],
      [0.18,0.31],[0.27,0.30],[0.38,0.31],[0.47,0.34],[0.50,0.36],
      [0.58,0.31],[0.70,0.25],[0.82,0.23],[0.94,0.25],[1.00,0.31],
      [0.92,0.36],[0.80,0.40],[0.62,0.47],[0.52,0.47],[0.50,0.44],
      [0.50,0.66],[0.51,0.82],[0.52,0.93],[0.49,0.93],
      [0.44,0.68],[0.40,0.55],
      [0.30,0.52],[0.26,0.50],
      [0.22,0.60],[0.21,0.76],[0.22,0.93],[0.19,0.93],
      [0.14,0.68],[0.09,0.52],[0.04,0.46]
    ],
    beaver: [
      // Stout beaver facing LEFT with broad flat paddle tail to the right
      [0.04,0.56],[0.02,0.48],[0.05,0.40],[0.10,0.35],[0.14,0.34],
      [0.15,0.29],[0.17,0.29],[0.18,0.34],
      [0.26,0.28],[0.38,0.22],[0.52,0.24],[0.64,0.34],[0.71,0.48],
      // Broad flat paddle tail
      [0.82,0.49],[0.94,0.54],[0.99,0.61],[0.97,0.68],[0.88,0.72],[0.74,0.68],[0.67,0.64],
      // Hind foot & belly
      [0.64,0.78],[0.66,0.88],[0.56,0.88],[0.54,0.76],
      [0.42,0.75],[0.28,0.74],
      // Front foot & chin
      [0.24,0.86],[0.18,0.86],[0.19,0.72],[0.11,0.65],[0.05,0.60]
    ],
    muskrat: [
      // Compact semi-aquatic muskrat facing LEFT with slender curved scaly tail
      [0.05,0.56],[0.03,0.49],[0.07,0.41],[0.13,0.36],[0.16,0.32],[0.18,0.35],
      [0.28,0.27],[0.42,0.24],[0.55,0.29],[0.64,0.42],[0.68,0.56],
      // Long slender tail
      [0.78,0.60],[0.90,0.64],[0.98,0.68],[0.96,0.72],[0.86,0.70],[0.75,0.66],[0.66,0.63],
      // Hind leg & belly
      [0.62,0.78],[0.64,0.86],[0.55,0.86],[0.53,0.74],
      [0.38,0.74],[0.25,0.72],
      [0.22,0.84],[0.17,0.84],[0.18,0.70],[0.10,0.63]
    ],
    mink: [
      // Sleek arched mustelid facing LEFT with bushy tail
      [0.02,0.52],[0.00,0.46],[0.04,0.40],[0.10,0.37],[0.13,0.34],[0.15,0.37],
      [0.24,0.34],[0.38,0.26],[0.52,0.26],[0.64,0.34],[0.72,0.46],
      // Bushy mustelid tail
      [0.84,0.48],[0.96,0.54],[0.99,0.60],[0.94,0.65],[0.82,0.63],[0.70,0.58],
      // Short legs & arched belly
      [0.67,0.78],[0.69,0.86],[0.63,0.86],[0.60,0.70],
      [0.48,0.56],[0.34,0.58],[0.24,0.66],
      [0.21,0.84],[0.16,0.84],[0.16,0.68],[0.08,0.58]
    ]
  };
  _poly.duck = [
    [0.14,0.25],[0.24,0.20],[0.30,0.24],[0.29,0.38],[0.45,0.40],[0.68,0.46],[0.86,0.52],
    [0.74,0.62],[0.55,0.66],[0.50,0.82],[0.42,0.82],[0.44,0.66],[0.26,0.60],[0.22,0.44],[0.22,0.29]
  ];
  _poly.goose = [
    [0.16,0.18],[0.28,0.09],[0.36,0.16],[0.36,0.36],[0.56,0.42],[0.78,0.58],[0.84,0.68],
    [0.64,0.67],[0.56,0.88],[0.45,0.88],[0.45,0.68],[0.26,0.56],[0.24,0.38],[0.28,0.22]
  ];
  _poly.coot = _poly.duck;
  _poly.cormorant = [
    [0.84,0.10],[0.64,0.08],[0.58,0.20],[0.62,0.32],[0.46,0.46],[0.32,0.72],[0.18,0.92],
    [0.34,0.80],[0.48,0.76],[0.52,0.88],[0.64,0.88],[0.56,0.72],[0.70,0.46],[0.72,0.28],[0.68,0.18]
  ];
  _poly.quail = [
    [0.14,0.22],[0.26,0.18],[0.38,0.30],[0.62,0.42],[0.88,0.68],[0.66,0.64],[0.54,0.82],[0.42,0.82],[0.44,0.64],[0.24,0.52],[0.22,0.32]
  ];
  _poly.partridge = _poly.quail;
  _poly.pheasant = [
    [0.10,0.26],[0.20,0.22],[0.24,0.36],[0.48,0.48],[0.92,0.42],[0.56,0.58],[0.36,0.64],[0.34,0.78],[0.24,0.78],[0.26,0.64],[0.14,0.50],[0.14,0.34]
  ];
  _poly.raptor = [
    [0.26,0.18],[0.42,0.12],[0.48,0.26],[0.66,0.48],[0.82,0.76],[0.60,0.64],[0.52,0.86],[0.42,0.86],[0.46,0.64],[0.34,0.42],[0.34,0.24]
  ];
  _poly.parrot = [
    [0.18,0.22],[0.30,0.10],[0.46,0.22],[0.68,0.54],[0.88,0.90],[0.58,0.60],[0.42,0.68],[0.38,0.60],[0.28,0.38]
  ];
  _poly.songbird = [
    [0.14,0.20],[0.32,0.16],[0.44,0.30],[0.68,0.54],[0.90,0.72],[0.64,0.62],[0.48,0.82],[0.38,0.82],[0.44,0.62],[0.26,0.46],[0.24,0.28]
  ];
  _poly.generic = _poly.deer;

  // ── Draw functions ──

  function draw(ctx, type, x, y, h, color) {
    const img = images[type];
    if (img) {
      // IMAGE MODE — use pre-rendered PNG
      const tinted = _getTinted(type, color);
      if (!tinted) return;
      const w = h * (img.naturalWidth / img.naturalHeight);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(tinted, x, y, w, h);
      ctx.restore();
    } else {
      // POLYGON FALLBACK
      const pts = _poly[type] || _poly.generic;
      if (!pts || pts.length < 3) return;
      const aspect = aspects[type] || aspects.generic;
      const w = h * aspect;
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + pts[0][0] * w, y + pts[0][1] * h);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(x + pts[i][0] * w, y + pts[i][1] * h);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawVitalZone(ctx, type, x, y, h, color) {
    const img = images[type];
    const aspect = img ? (img.naturalWidth / img.naturalHeight) : (aspects[type] || aspects.generic);
    const w = h * aspect;
    const vz = vitalZones[type] || vitalZones.generic;
    const vzX = x + vz.x * w;
    const vzY = y + vz.y * h;
    const vzR = vz.rFactor * h;

    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(vzX, vzY, vzR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(vzX - vzR * 0.5, vzY);
    ctx.lineTo(vzX + vzR * 0.5, vzY);
    ctx.moveTo(vzX, vzY - vzR * 0.5);
    ctx.lineTo(vzX, vzY + vzR * 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function getAspect(type) {
    const img = images[type];
    if (img) return img.naturalWidth / img.naturalHeight;
    return aspects[type] || aspects.generic;
  }

  // Auto-preload
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', preload);
    } else {
      preload();
    }
  }

  return { TYPES, draw, drawVitalZone, getAspect, vitalZones, aspects, preload, onReady };
})();

if (typeof module !== 'undefined') module.exports = Silhouettes;
