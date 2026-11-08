import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const windows = process.platform === 'win32';
const cpp = resolve(process.argv[2] ?? (windows ? 'build/native/Release/tinyflock_parity.exe' : 'build/native/tinyflock_parity'));
const rust = resolve(process.argv[3] ?? `target/release/examples/parity${windows ? '.exe' : ''}`);
const base = { perception: 12, spacing: 4, max: 12, min: 0, acceleration: 18, separation: 1.5, alignment: 1, cohesion: .6,
  radius: 55, boundary: 2, flight: 0, view: Math.fround(2 * Math.fround(Math.PI)), neighbors: 0,
  altitudeEnabled: 0, altitude: 0, response: 8, avoidance: 0, lookahead: 3, clearance: 2, grid: 0, obstacleTime: 4, margin: 1 };
const isolated = { separation: 0, alignment: 0, cohesion: 0, boundary: 0 };
const flight = { ...isolated, max: 8, min: 6, acceleration: 2, flight: 1, avoidance: 1, lookahead: 6 };
const cases = [
  { name: 'seeded-reset-multiple-MT-blocks', reset: 256, steps: 0, tolerance: 1e-6 },
  { name: 'seeded-free-flock', reset: 32, steps: 120 },
  { name: 'seeded-grid-flight', reset: 32, steps: 120, config: { ...flight, ...{ separation: 1.8, alignment: .8, cohesion: .4, boundary: 5, grid: 1, neighbors: 7, altitudeEnabled: 1, response: 10 } } },
  { name: 'head-on', config: flight, steps: 500, state: [[-12,0,0,7,0,0],[12,0,0,-7,0,0]] },
  { name: 'crossing', config: flight, steps: 500, state: [[-12,0,0,7,0,0],[0,0,-12,0,0,7]] },
  { name: 'overtaking', config: flight, steps: 625, state: [[-10,0,0,8,0,0],[0,0,0,6,0,0]] },
  { name: 'vertical-approach', config: flight, steps: 500, state: [[0,-12,0,0,7,0],[0,12,0,0,-7,0]] },
  { name: 'sphere-and-conflicting-input', config: { ...flight, avoidance: 0, obstacleTime: 6 }, steps: 625, state: [[-35,0,0,7,0,0]], obstacles: [[0,0,0,3]], forces: [[0,0,10]] },
  { name: 'target-altitude-and-inputs', config: { ...flight, grid: 1, altitudeEnabled: 1, response: 10 }, steps: 120, state: [[-12,2,0,7,0,0],[-12,-2,6,7,0,0]], target: [100,0,10,150,.4], forces: [[.1,0,0],[0,0,.1]] },
  { name: 'nearest-visible-neighbor', config: { ...isolated, cohesion: 1, neighbors: 1, view: Math.fround(Math.PI) }, steps: 1, state: [[0,0,0,1,0,0],[0,0,2,0,0,0],[0,0,-5,0,0,0]] },
  { name: 'repulsion', config: isolated, steps: 120, state: [[0,0,0,0,0,0]], target: [10,0,0,100,-1] },
  { name: 'speed-floor-from-rest', config: flight, steps: 120, state: [[0,0,0,0,0,0]] },
  { name: 'altitude-recovery', config: { ...isolated, altitudeEnabled: 1, response: 4 }, steps: 1250, state: [[0,10,0,1,0,0]] },
];
let worst = 0;
for (const scenario of cases) {
  const c = { ...base, ...scenario.config };
  const rows = [Object.values(c), [scenario.steps, .016, scenario.reset ?? 0, 42], [(scenario.state ?? []).length], ...(scenario.state ?? []),
    [(scenario.obstacles ?? []).length], ...(scenario.obstacles ?? []), [(scenario.forces ?? []).length], ...(scenario.forces ?? []),
    [scenario.target ? 1 : 0, ...(scenario.target ?? [0,0,0,40,1])]];
  const input = rows.map(row => row.join(' ')).join('\n') + '\n';
  const run = executable => {
    const result = spawnSync(executable, [], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, `${scenario.name}: ${result.stderr || result.error || executable}`);
    return JSON.parse(result.stdout);
  };
  const a = run(cpp), b = run(rust);
  assert.equal(a.state.length, b.state.length);
  let error = 0;
  for (let i = 0; i < a.state.length; ++i) {
    assert(Number.isFinite(a.state[i]) && Number.isFinite(b.state[i]));
    error = Math.max(error, Math.abs(a.state[i] - b.state[i]));
  }
  assert(error <= (scenario.tolerance ?? .005), `${scenario.name}: maximum component difference ${error}`);
  worst = Math.max(worst, error);
  console.log(`${scenario.name}: max component difference ${error.toExponential(2)}`);
}
console.log(`${cases.length} C++/Rust scenarios passed; largest difference ${worst.toExponential(2)}.`);
