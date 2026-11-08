import assert from 'node:assert/strict';
import createTinyflock from '../web/public/wasm/tinyflock.js';
import { readFile } from 'node:fs/promises';
import { createRustSimulation } from '../web/src/rust-adapter.ts';

const module = await createTinyflock();
const rustUrl = new URL('../web/public/wasm-rust/tinyflock_web.js', import.meta.url).href;
const rustBytes = await readFile(new URL('../web/public/wasm-rust/tinyflock_web_bg.wasm', import.meta.url));
for (const [name, factory] of [['C++', async () => new module.Simulation()], ['Rust', () => createRustSimulation(rustUrl, rustBytes)]]) {
const first = await factory();
const second = await factory();
try {
  first.reset(32, 42);
  second.reset(32, 42);
  const initial = first.state().slice();
  assert.equal(initial.length, 32 * 6);
  assert.deepEqual(initial, second.state());
  assert.equal(first.step(-1), false);
  assert.deepEqual(first.state(), initial);
  assert.equal(first.weights(1, 1, -1), false);
  assert.equal(first.weights(1.5, 1, 0.6), true);
  assert.equal(first.target(10, 0, 0, 2), true);
  assert.equal(first.step(1 / 60), true);
  const advanced = first.state().slice();
  assert.notDeepEqual(advanced, initial);
  assert.deepEqual(second.state(), initial, 'each browser instance owns independent state');
  first.clearTarget();
  first.reset(2048, 7);
  assert.equal(first.state().length, 2048 * 6);
  first.reset(0, 7);
  assert.equal(first.step(1 / 60), true);
  assert.equal(first.state().length, 0);
  first.reset(32, 42);
  assert.deepEqual(first.state(), initial);
  const defaults = first.settings();
  assert.equal(defaults.spatialGrid, true);
  for (const invalid of [null, {}, { ...defaults, minSpeed: 9 }, { ...defaults, viewAngle: 361 },
    { ...defaults, forceX: Infinity }, { ...defaults, neighbors: 1.5 }, { ...defaults, avoidanceEnabled: 1 }]) {
    assert.equal(first.configure(invalid), false);
    assert.deepEqual(first.settings(), defaults, 'rejected settings preserve the complete configuration');
    assert.deepEqual(first.state(), initial, 'configuration rejection cannot move birds');
  }
  assert.equal(first.configure({ ...defaults, lookahead: 6, clearance: 3, avoidanceEnabled: false,
    altitudeEnabled: false, altitude: 7, obstaclesEnabled: true, forceX: .4, viewAngle: 360 }), true);
  assert.equal(first.settings().lookahead, 6, 'disabled avoidance retains its knobs');
  assert.equal(first.settings().altitude, 7, 'disabled altitude retains its knob');
  assert.equal(first.obstacles().length, 2);
  assert.equal(second.obstacles().length, 0, 'environment belongs to each instance');
  assert.equal(first.step(1 / 60), true);
  assert.equal(first.stats().obstacleChecks, 64);
  first.reset(32, 42);
  assert.equal(first.obstacles().length, 2, 'restart preserves the configured obstacle course');
  first.restoreDefaults();
  assert.deepEqual(first.settings(), defaults);
  assert.equal(first.obstacles().length, 0);
  first.reset(32, 42);
  assert.deepEqual(first.state(), initial, 'restoring defaults clears caller forces');
  console.log(`${name} WebAssembly boundary checks passed`);
} finally {
  first.delete();
  second.delete();
}
}
const cpp = new module.Simulation(), rust = await createRustSimulation(rustUrl, rustBytes);
try {
  cpp.reset(96, 42); rust.reset(96, 42);
  let difference = 0;
  for (let tick = 0; tick < 120; ++tick) {
    assert(cpp.step(.016) && rust.step(.016));
    const a = cpp.state(), b = rust.state();
    for (let i = 0; i < a.length; ++i) difference = Math.max(difference, Math.abs(a[i] - b[i]));
  }
  assert(difference < .001, `browser-backend parity difference ${difference}`);
  console.log(`C++/Rust WASM parity passed; largest component difference ${difference.toExponential(2)}`);
} finally { cpp.delete(); rust.delete(); }
