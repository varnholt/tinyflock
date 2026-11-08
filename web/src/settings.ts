import type { BehaviorSettings } from './simulation';

// Stable browser ABI for the Rust adapter; C++ exposes these as named fields.
export const settingsKeys = ['perception', 'spacing', 'minSpeed', 'maxSpeed', 'acceleration',
  'viewAngle', 'neighbors', 'worldRadius', 'boundary', 'altitudeEnabled', 'altitude', 'altitudeResponse',
  'avoidanceEnabled', 'lookahead', 'clearance', 'forwardFlight', 'spatialGrid', 'obstaclesEnabled',
  'obstacleLookahead', 'obstacleMargin', 'forceX', 'forceY', 'forceZ', 'pointerRadius', 'pointerStrength'] as const satisfies readonly (keyof BehaviorSettings)[];
const flags = new Set<keyof BehaviorSettings>(['altitudeEnabled', 'avoidanceEnabled', 'forwardFlight', 'spatialGrid', 'obstaclesEnabled']);
export function decodeSettings(values: Float32Array): BehaviorSettings {
  if (values.length !== settingsKeys.length) throw new Error('Unexpected Rust settings ABI');
  return Object.fromEntries(settingsKeys.map((key, i) => [key, flags.has(key) ? values[i] !== 0 : values[i]])) as unknown as BehaviorSettings;
}
export function encodeSettings(settings: BehaviorSettings): Float32Array | undefined {
  if (!settings || typeof settings !== 'object') return;
  const values = [];
  for (const key of settingsKeys) {
    const value = settings[key];
    if (flags.has(key)) { if (typeof value !== 'boolean') return; values.push(Number(value)); }
    else { if (typeof value !== 'number' || !Number.isFinite(value)) return; values.push(value); }
  }
  return new Float32Array(values);
}
