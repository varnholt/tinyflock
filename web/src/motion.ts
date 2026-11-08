import * as THREE from 'three';

/** Endpoint positions AND velocities match, including across simulation ticks. */
export function interpolatePosition(p0: number, v0: number, p1: number, v1: number, alpha: number, step: number) {
  const a2 = alpha * alpha, a3 = a2 * alpha;
  return (2 * a3 - 3 * a2 + 1) * p0 + (a3 - 2 * a2 + alpha) * step * v0
    + (-2 * a3 + 3 * a2) * p1 + (a3 - a2) * step * v1;
}

/** Exact time derivative of the rendered Hermite path, not a second interpolation. */
export function interpolateVelocity(p0: number, v0: number, p1: number, v1: number, alpha: number, step: number) {
  const a2 = alpha * alpha;
  return 6 * alpha * (1 - alpha) * (p1 - p0) / step
    + (3 * a2 - 4 * alpha + 1) * v0 + (3 * a2 - 2 * alpha) * v1;
}

/** Integrate rate changes; multiplying a changing rate by total time jumps phase. */
export class PhaseClock {
  private lastTime: number | undefined;
  private phase = 0;
  private rate = 1;
  private offset: number;
  constructor(offset = 0) { this.offset = offset; }
  reset() { this.lastTime = undefined; this.phase = 0; this.rate = 1; }
  sample(time: number, requestedRate: number, duration: number) {
    if (this.lastTime === undefined) {
      this.lastTime = time;
      this.phase = this.offset % duration;
      this.rate = requestedRate;
    }
    const delta = Math.max(0, Math.min(time - this.lastTime, 0.1));
    this.rate += (requestedRate - this.rate) * (1 - Math.exp(-delta / 0.7));
    this.phase = (this.phase + delta * this.rate) % duration;
    this.lastTime = time;
    return this.phase;
  }
}

/** Visual attitude, independent of display frequency and the authored bird rig. */
export class FlightMotion {
  private states: { heading: THREE.Quaternion; acceleration: THREE.Vector3; bank: number }[];
  private velocity = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private frameUp = new THREE.Vector3();
  private rawAcceleration = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private axis = new THREE.Vector3(0, 0, 1);
  private basis = new THREE.Matrix4();
  private roll = new THREE.Quaternion();
  constructor(capacity: number) {
    this.states = Array.from({ length: capacity }, () => ({ heading: new THREE.Quaternion(),
      acceleration: new THREE.Vector3(), bank: 0 }));
  }
  reset() { for (const state of this.states) { state.heading.identity(); state.bank = 0; state.acceleration.set(0, 0, 0); } }
  sample(index: number, previous: Float32Array, current: Float32Array, alpha: number,
    step: number, delta: number, target: THREE.Object3D) {
    const offset = index * 6, state = this.states[index];
    target.position.set(
      interpolatePosition(previous[offset], previous[offset + 3], current[offset], current[offset + 3], alpha, step),
      interpolatePosition(previous[offset + 1], previous[offset + 4], current[offset + 1], current[offset + 4], alpha, step),
      interpolatePosition(previous[offset + 2], previous[offset + 5], current[offset + 2], current[offset + 5], alpha, step));
    this.velocity.set(
      interpolateVelocity(previous[offset], previous[offset + 3], current[offset], current[offset + 3], alpha, step),
      interpolateVelocity(previous[offset + 1], previous[offset + 4], current[offset + 1], current[offset + 4], alpha, step),
      interpolateVelocity(previous[offset + 2], previous[offset + 5], current[offset + 2], current[offset + 5], alpha, step));
    const speed = this.velocity.length();
    if (speed < 1e-6) { target.quaternion.copy(state.heading); return 0; }
    this.forward.copy(this.velocity).divideScalar(speed);
    this.right.crossVectors(this.up, this.forward);
    if (this.right.lengthSq() < 0.01) {
      this.right.set(1, 0, 0).applyQuaternion(state.heading);
      this.right.addScaledVector(this.forward, -this.right.dot(this.forward));
    }
    this.right.normalize();
    this.basis.makeBasis(this.right, this.frameUp.crossVectors(this.forward, this.right), this.forward);
    // The GLB flies along local +Z. Banking around that axis leaves its nose on
    // the path tangent. A second heading filter would make it visibly sideslip.
    state.heading.setFromRotationMatrix(this.basis);
    // Acceleration comes from the two SIMULATION states, never rendering-frame differences.
    this.rawAcceleration.set((current[offset + 3] - previous[offset + 3]) / step,
      (current[offset + 4] - previous[offset + 4]) / step, (current[offset + 5] - previous[offset + 5]) / step);
    state.acceleration.lerp(this.rawAcceleration, 1 - Math.exp(-delta / 0.6));
    const bank = THREE.MathUtils.clamp(-Math.atan2(state.acceleration.dot(this.right), 9.81), -0.35, 0.35);
    const change = (bank - state.bank) * (1 - Math.exp(-delta * 4));
    state.bank += THREE.MathUtils.clamp(change, -0.35 * delta, 0.35 * delta);
    target.quaternion.copy(state.heading).multiply(this.roll.setFromAxisAngle(this.axis, state.bank));
    return Math.max(0, this.velocity.y / speed);
  }
}
