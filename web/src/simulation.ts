export interface BehaviorSettings {
  perception: number; spacing: number; minSpeed: number; maxSpeed: number; acceleration: number;
  viewAngle: number; neighbors: number; worldRadius: number; boundary: number;
  altitudeEnabled: boolean; altitude: number; altitudeResponse: number;
  avoidanceEnabled: boolean; lookahead: number; clearance: number;
  forwardFlight: boolean; spatialGrid: boolean; obstaclesEnabled: boolean;
  obstacleLookahead: number; obstacleMargin: number;
  forceX: number; forceY: number; forceZ: number; pointerRadius: number; pointerStrength: number;
}
export interface SphereObstacle { x: number; y: number; z: number; radius: number }
export interface Simulation {
  reset(count: number, seed: number): void;
  step(seconds: number): boolean;
  target(x: number, y: number, z: number, strength: number): boolean;
  clearTarget(): void;
  weights(separation: number, alignment: number, cohesion: number): boolean;
  settings(): BehaviorSettings;
  configure(settings: BehaviorSettings): boolean;
  restoreDefaults(): void;
  obstacles(): SphereObstacle[];
  stats(): { candidatePairs: number; socialNeighbors: number; avoidanceCorrections: number; obstacleChecks: number };
  state(): Float32Array;
  delete(): void;
}
