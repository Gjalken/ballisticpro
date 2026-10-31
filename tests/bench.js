const { loadEngine, scenarios } = require('./harness');
const E = loadEngine(); const sc = scenarios(E);
function bench(name, dt, n = 40) {
  const cfg = { ...sc[name], integrationDt: dt };
  for (let i = 0; i < 8; i++) E.Solver.solve(cfg);            // warm-up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) E.Solver.solve(cfg);
  return +(Number(process.hrtime.bigint() - t0) / 1e6 / n).toFixed(2);
}
const out = {};
for (const name of ['rifle308', 'rifle308_cor', 'cm65_long', 'airgun22']) {
  out[name] = {};
  for (const dt of [0.001, 0.0005, 0.00025]) out[name]['dt=' + dt * 1000 + 'ms'] = bench(name, dt);
}
console.log('ms per solve (warm):'); console.table(out);
