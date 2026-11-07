// The simulation's maths must come out bit for bit the same on every browser (al.js AL.sin, cos, atan2, exp, log,
// pow, hypot): a lockstep match between Chrome, Firefox and Safari PCs stays in sync only if it does.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const AL = require('../public/al.js');
const f = new Float64Array(1), u = new Uint32Array(f.buffer);
const bits = v => { f[0] = v; return u[1].toString(16).padStart(8, '0') + u[0].toString(16).padStart(8, '0'); };

test('engine-independent maths: the exact same bits as recorded, and within an ulp or two of Math', () => {
  // (recorded once; any engine doing IEEE-754 + - * / sqrt gets these same bits)
  const GOLD = [['sin', 0.5, '3fdeaee8744b05f0'], ['sin', -3.7, '3fe0f46aec2e1b41'], ['sin', 1234.567, '3fb42e44755bce6c'], ['cos', 0.25, '3fef01549f7deea1'],
    ['cos', -77.7, 'bfe55cf9c92e02cb'], ['cos', 4000.1, 'bfe50edbb38caeb1'], ['atan2', [3, -4], '4003fc176b7a8560'], ['atan2', [-0.3, 0.2], 'bfef730bd281f69b'],
    ['exp', -2.5, '3fb50385c094f425'], ['exp', 7.25, '4096006b5d53e8d9'], ['log', 3.3, '3ff31a4e7240c777'], ['pow', [0.5, 0.03], '3fef57693c659500'],
    ['pow', [1.7, 1.35], '4000602461269d89'], ['hypot', [3.1, 4.2], '4014e16fdacff937']];
  for (const [n, x, b] of GOLD) assert.equal(bits(Array.isArray(x) ? AL[n](x[0], x[1]) : AL[n](x)), b, n + '(' + x + ')');
  const R = AL.rng(5);
  for (let k = 0; k < 20000; k++) {
    const x = (R() - 0.5) * 8000, y = (R() - 0.5) * 8000;
    assert.ok(Math.abs(AL.sin(x) - Math.sin(x)) < 1e-15 && Math.abs(AL.cos(x) - Math.cos(x)) < 1e-15, 'sin/cos ' + x);
    assert.ok(Math.abs(AL.atan2(y, x) - Math.atan2(y, x)) < 1e-15, 'atan2');
    const e = (R() - 0.5) * 40; assert.ok(Math.abs(AL.exp(e) / Math.exp(e) - 1) < 1e-15, 'exp ' + e);
    const p = R() * 9 + 0.01, q = (R() - 0.5) * 6; assert.ok(Math.abs(AL.pow(p, q) / Math.pow(p, q) - 1) < 1e-14, 'pow ' + p + ' ' + q);
  }
  assert.equal(AL.pow(3, 4), 81); assert.equal(AL.pow(2, -2), 0.25); assert.equal(AL.pow(7, 0), 1);
  assert.equal(AL.atan2(0, -1), Math.PI); assert.equal(AL.atan2(1, 0), Math.PI / 2); assert.equal(AL.sin(0), 0); assert.equal(AL.cos(0), 1); assert.equal(AL.exp(0), 1);
});

test('simulation code never calls the engine\'s own sin, cos, atan2, exp, pow, hypot or **', () => {
  const dir = path.join(__dirname, '../public');
  const sim = fs.readdirSync(dir).filter(f => f.endsWith('.js') && /typeof window !== 'undefined' \? window : globalThis/.test(fs.readFileSync(path.join(dir, f), 'utf8')) && f !== 'al.js');
  assert.ok(sim.length > 30, 'found the simulation modules: ' + sim.length);
  for (const f of sim) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const code = l.replace(/\/\/.*$/, '');
      assert.ok(!/Math\.(sin|cos|tan|atan2?|asin|acos|exp|expm1|log1?p?|log2|log10|pow|hypot|cbrt|sinh|cosh|tanh)\(/.test(code), f + ':' + (i + 1) + ' uses an engine maths function: ' + l.trim().slice(0, 90));
      assert.ok(!/[^*/]\*\*[^*/]/.test(code), f + ':' + (i + 1) + ' uses **: ' + l.trim().slice(0, 90));
    });
  }
});
