/** Verifies every file listed in sw.js ASSETS exists, and that all <script>/<link> refs in index.html are precached. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
let bad = 0, bytes = 0;
for (const a of assets) {
  const p = path.join(ROOT, a === './' ? 'index.html' : a);
  if (!fs.existsSync(p)) { console.log('  ✗ MISSING', a); bad++; } else bytes += fs.statSync(p).size;
}
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|json|png))"/g)].map(m => m[1]);
for (const r of refs) if (!assets.includes(r)) { console.log('  ✗ referenced by index.html but NOT precached:', r); bad++; }
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
for (const i of man.icons) if (!assets.includes(i.src)) { console.log('  ✗ manifest icon not precached:', i.src); bad++; }
console.log(`${assets.length} precached files, ${(bytes / 1024).toFixed(0)} KB total — ${bad ? bad + ' problem(s)' : 'all present ✓'}`);
process.exit(bad ? 1 : 0);
