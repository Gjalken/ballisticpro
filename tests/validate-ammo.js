/**
 * Sanity checks for ammunition data (js/data/projectiles-*.json and research batches).
 *   node tests/validate-ammo.js [file.json ...]       (default: the two shipped databases)
 *
 * It cannot prove a BC is "right", but it catches typos, unit mix-ups and physically
 * implausible combinations, which are the usual ways bad data sneaks into a ballistic app.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const SD = (gr, d) => (gr / 7000) / (d * d);                  // sectional density, lb/in²
const issues = [];
const warn = (e, msg, level = 'WARN') => issues.push({ level, name: e.name, msg });

function checkEntry(e, kind) {
  const w = e.weightGr, d = e.diamIn;
  if (!e.name) warn(e, 'missing name', 'ERROR');
  if (!(w > 0) || !(d > 0)) { warn(e, `bad weight/diameter (${w}, ${d})`, 'ERROR'); return; }
  if (e.lengthIn != null && !(e.lengthIn > 0.1 && e.lengthIn < 4)) warn(e, `length ${e.lengthIn} in out of range`, 'ERROR');
  if (e.lengthIn != null && e.lengthIn / d < 0.8) warn(e, `length/diameter ${(e.lengthIn / d).toFixed(2)} suspiciously short`);

  const sd = SD(w, d);
  const bcs = [['bcG1', e.bcG1], ['bcG7', e.bcG7], ['bcGA', e.bcGA]].filter(([, v]) => v != null);
  for (const [k, v] of bcs) if (!(v > 0.005 && v < 1.6)) warn(e, `${k}=${v} out of plausible range`, 'ERROR');

  // Form factor i = SD / BC.  Real projectiles: G1 form factor ≈ 0.45–1.3 (flat-base SP ≈ 1.1–1.3,
  // boat-tail match ≈ 0.55–0.75, pellets/rimfire ≈ 1.0–2.2). G7 form factor ≈ 0.85–1.45 for rifle bullets.
  if (kind !== 'airgun') {
    if (e.bcG1 != null) {
      const i1 = sd / e.bcG1;
      if (i1 < 0.38 || i1 > 2.4) warn(e, `G1 form factor ${i1.toFixed(2)} (SD ${sd.toFixed(3)}, BC ${e.bcG1}) implausible`);
    }
    if (e.bcG7 != null && e.bcG1 != null) {
      const ratio = e.bcG1 / e.bcG7;
      // G1/G7 BC ratio is ~1.8–2.15 for most rifle bullets; rimfire/blunt can differ
      if (ratio < 1.55 || ratio > 2.35) warn(e, `G1/G7 ratio ${ratio.toFixed(2)} unusual (G1 ${e.bcG1}, G7 ${e.bcG7})`);
    }
    if (e.muzzleVelFps != null && !(e.muzzleVelFps > 500 && e.muzzleVelFps < 4500)) warn(e, `MV ${e.muzzleVelFps} fps implausible`, 'ERROR');
    if (e.muzzleVelFps != null) {
      const ke = w * e.muzzleVelFps * e.muzzleVelFps / 450437;
      if (ke > 6500) warn(e, `muzzle energy ${ke.toFixed(0)} ft·lbf too high for this class`);
    }
  } else if (e.bcGA != null) {
    const iA = sd / e.bcGA;
    if (iA < 0.7 || iA > 4.5) warn(e, `GA form factor ${iA.toFixed(2)} (SD ${sd.toFixed(3)}, BC ${e.bcGA}) implausible`);
  }
}

function load(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return j.firearms || j.airgun || j.entries || [];
}

const files = process.argv.slice(2);
if (!files.length) files.push(path.join(ROOT, 'js/data/projectiles-firearms.json'), path.join(ROOT, 'js/data/projectiles-airgun.json'));

let total = 0;
for (const f of files) {
  const list = load(f);
  const kind = /airgun/.test(f) ? 'airgun' : 'firearms';
  list.forEach(e => checkEntry(e, e.type === 'pellet' || e.type === 'slug' ? 'airgun' : kind));
  const names = new Set(), dups = [];
  for (const e of list) { const k = `${e.name}|${e.weightGr}`; if (names.has(k)) dups.push(e.name); names.add(k); }
  dups.forEach(n => issues.push({ level: 'ERROR', name: n, msg: 'duplicate entry' }));
  total += list.length;
  console.log(`${path.relative(ROOT, f)}: ${list.length} entries`);
}
const errs = issues.filter(i => i.level === 'ERROR'), warns = issues.filter(i => i.level === 'WARN');
for (const i of issues) console.log(`  [${i.level}] ${i.name}: ${i.msg}`);
console.log(`\n${total} entries checked — ${errs.length} error(s), ${warns.length} warning(s)`);
process.exit(errs.length ? 1 : 0);
