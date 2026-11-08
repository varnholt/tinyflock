import createTinyflock from '../public/wasm/tinyflock.js';
const module = await createTinyflock();
const flock = new module.Simulation();
flock.reset(96, 42);
let previous = flock.state().slice();
let minSpeed = Infinity, maxSpeed = 0, maxTurn = 0, maxAcceleration = 0, maxRadius = 0, slowSteps = 0;
const turns = [];
for (let tick = 0; tick < 3600; ++tick) {
  if (!flock.step(1 / 60)) throw new Error('Step failed');
  const state = flock.state();
  for (let i = 0; i < state.length; i += 6) {
    const speed = Math.hypot(...state.subarray(i + 3, i + 6));
    const oldSpeed = Math.hypot(...previous.subarray(i + 3, i + 6));
    minSpeed = Math.min(minSpeed, speed); maxSpeed = Math.max(maxSpeed, speed);
    maxRadius = Math.max(maxRadius, Math.hypot(...state.subarray(i, i + 3)));
    if (speed < 2) ++slowSteps;
    const dot = state[i + 3] * previous[i + 3] + state[i + 4] * previous[i + 4] + state[i + 5] * previous[i + 5];
    const turn = Math.acos(Math.max(-1, Math.min(1, dot / Math.max(1e-12, speed * oldSpeed)))) * 60 * 180 / Math.PI;
    maxTurn = Math.max(maxTurn, turn); turns.push(turn);
    maxAcceleration = Math.max(maxAcceleration, Math.hypot(state[i + 3] - previous[i + 3],
      state[i + 4] - previous[i + 4], state[i + 5] - previous[i + 5]) * 60);
  }
  previous.set(state);
}
turns.sort((a, b) => a - b);
console.log(JSON.stringify({ seconds: 60, minSpeed, maxSpeed, maxTurnDegreesPerSecond: maxTurn,
  p99TurnDegreesPerSecond: turns[Math.floor(turns.length * .99)], maxAcceleration, maxRadius, slowSteps }, null, 2));
flock.delete();
import assert from 'node:assert/strict';
if (process.argv.includes('--check')) {
  assert(minSpeed >= 6 - 1e-4 && maxSpeed <= 8 + 1e-4, 'cruising speed remains bounded');
  assert(maxTurn < 20, 'the demo must not snap into a reversed heading');
  assert(maxAcceleration < 2.001, 'the demo must not introduce acceleration spikes');
  assert(slowSteps === 0, 'airborne gulls must not stop and pivot');
  assert(maxRadius < 110, 'the reference flock must remain near the scene');
}
