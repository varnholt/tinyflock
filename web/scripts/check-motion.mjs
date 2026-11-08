import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PhaseClock, FlightMotion, interpolatePosition, interpolateVelocity } from '../src/motion.ts';

const duration = .8;
const clock = new PhaseClock(.2);
let phase = clock.sample(600, .86, duration);
for (let frame = 1; frame <= 600; ++frame) {
  const next = clock.sample(600 + frame / 60, frame % 2 ? 1.08 : .86, duration);
  const advance = (next - phase + duration) % duration;
  assert(advance < 1.1 / 60 + 1e-9, 'changing playback rate cannot jump animation phase at late timestamps');
  phase = next;
}
assert.equal(clock.sample(610, 1, duration), phase, 'paused time must preserve phase');
clock.reset();
assert.equal(clock.sample(0, .86, duration), .2, 'reset restores the initial animation phase');
assert.equal(interpolatePosition(3, 7, 3.12, 7.2, 0, 1 / 60), 3);
assert.equal(interpolatePosition(3, 7, 3.12, 7.2, 1, 1 / 60), 3.12);
const epsilon = 1e-6;
const derivativeStart = (interpolatePosition(3, 7, 3.12, 7.2, epsilon, 1 / 60) - 3) / (epsilon / 60);
const derivativeEnd = (3.12 - interpolatePosition(3, 7, 3.12, 7.2, 1 - epsilon, 1 / 60)) / (epsilon / 60);
assert(Math.abs(derivativeStart - 7) < .001 && Math.abs(derivativeEnd - 7.2) < .001,
  'position interpolation preserves velocity at tick boundaries');
for (const alpha of [0, .2, .5, .8, 1]) {
  const numerical = (interpolatePosition(3, 7, 3.12, 7.2, alpha + epsilon, 1 / 60)
    - interpolatePosition(3, 7, 3.12, 7.2, alpha - epsilon, 1 / 60)) / (2 * epsilon / 60);
  assert(Math.abs(numerical - interpolateVelocity(3, 7, 3.12, 7.2, alpha, 1 / 60)) < 1e-5,
    'orientation velocity must be the derivative of the visible path');
}

function trajectory(t) {
  const speed = 7, yaw = .22, radius = speed / yaw;
  return new Float32Array([radius * (1 - Math.cos(yaw * t)), 0, radius * Math.sin(yaw * t),
    speed * Math.sin(yaw * t), 0, speed * Math.cos(yaw * t)]);
}
const results = [];
for (const fps of [30, 60, 120, 144]) {
  const motion = new FlightMotion(1), object = new THREE.Object3D();
  let last = null, maximumRotation = 0, maximumTravel = 0;
  for (let frame = 0; frame <= fps * 10; ++frame) {
    const time = frame / fps, tick = Math.floor(time * 60), alpha = time * 60 - tick;
    motion.sample(0, trajectory(tick / 60), trajectory((tick + 1) / 60), alpha, 1 / 60, 1 / fps, object);
    const previous = trajectory(tick / 60), current = trajectory((tick + 1) / 60);
    const tangent = new THREE.Vector3(...[0, 1, 2].map(axis =>
      (interpolatePosition(previous[axis], previous[axis + 3], current[axis], current[axis + 3], alpha + epsilon, 1 / 60)
      - interpolatePosition(previous[axis], previous[axis + 3], current[axis], current[axis + 3], alpha - epsilon, 1 / 60))
      / (2 * epsilon / 60)));
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion);
    assert(nose.angleTo(tangent) < 1e-5, 'the banked bird must face along its actual rendered motion');
    if (last) {
      maximumRotation = Math.max(maximumRotation, last.quaternion.angleTo(object.quaternion) * fps);
      maximumTravel = Math.max(maximumTravel, last.position.distanceTo(object.position) * fps);
    }
    last = { position: object.position.clone(), quaternion: object.quaternion.clone() };
  }
  assert(maximumRotation < .9, 'heading and banking cannot snap between rendering frames');
  assert(maximumTravel < 7.01, 'interpolation cannot introduce a position skip');
  results.push(object.quaternion.clone());
}
assert(results[0].angleTo(results[2]) < .015, 'banking should agree at 30 and 120 fps');
const directions = new FlightMotion(1), oriented = new THREE.Object3D();
for (const velocity of [[7, 1, 2], [-7, -1, 2], [0, 7, 0], [0, -7, 0], [0, 0, -7]]) {
  const previous = new Float32Array([0, 0, 0, ...velocity]);
  const current = new Float32Array([...velocity.map(value => value / 60), ...velocity]);
  directions.sample(0, previous, current, .5, 1 / 60, 1 / 60, oriented);
  assert(new THREE.Vector3(0, 0, 1).applyQuaternion(oriented.quaternion).angleTo(new THREE.Vector3(...velocity)) < 1e-5,
    'GLB forward axis follows climbs, descents, vertical flight and reverse bearings');
}
console.log('Motion continuity checks passed at 30, 60, 120 and 144 fps');
