import type { Simulation, BehaviorSettings } from './simulation';

const numeric = {
  perception: 'perception', spacing: 'spacing', minSpeed: 'min-speed', maxSpeed: 'max-speed',
  acceleration: 'acceleration', viewAngle: 'view-angle', neighbors: 'neighbors',
  worldRadius: 'world-radius', boundary: 'boundary', altitude: 'altitude', altitudeResponse: 'altitude-response',
  lookahead: 'lookahead', clearance: 'clearance', obstacleLookahead: 'obstacle-lookahead', obstacleMargin: 'obstacle-margin',
  forceX: 'force-x', forceY: 'force-y', forceZ: 'force-z', pointerRadius: 'pointer-radius', pointerStrength: 'pointer-strength',
} as const;
const toggles = {
  avoidanceEnabled: 'avoidance-enabled', altitudeEnabled: 'altitude-enabled', forwardFlight: 'forward-flight',
  spatialGrid: 'spatial-grid', obstaclesEnabled: 'obstacles-enabled',
} as const;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;

export function installBehaviorControls(simulation: Simulation, restart: () => void, obstaclesChanged: () => void) {
  let settings = simulation.settings();
  const sync = () => {
    for (const key of Object.keys(numeric) as (keyof typeof numeric)[]) {
      const id = numeric[key], control = input(id);
      control.value = String(settings[key]);
      const output = document.getElementById(`${id}-value`) as HTMLOutputElement | null;
      if (output) output.value = key === 'neighbors' && settings[key] === 0 ? 'All' :
        Number(settings[key].toFixed(2)).toString();
    }
    for (const key of Object.keys(toggles) as (keyof typeof toggles)[]) input(toggles[key]).checked = settings[key];
    for (const id of ['lookahead', 'clearance']) input(id).disabled = !settings.avoidanceEnabled;
    for (const id of ['altitude', 'altitude-response']) input(id).disabled = !settings.altitudeEnabled;
    for (const id of ['obstacle-lookahead', 'obstacle-margin']) input(id).disabled = !settings.obstaclesEnabled;
  };
  const apply = (next: BehaviorSettings) => {
    if (!simulation.configure(next)) throw new Error('Behavior settings rejected');
    settings = simulation.settings();
    sync();
    obstaclesChanged();
  };
  for (const key of Object.keys(numeric) as (keyof typeof numeric)[]) {
    input(numeric[key]).addEventListener('input', () => {
      const next = { ...settings, [key]: input(numeric[key]).valueAsNumber };
      if (!Number.isFinite(next[key])) { sync(); return; }
      if (key === 'perception') next.spacing = Math.min(next.spacing, next.perception);
      if (key === 'spacing') next.perception = Math.max(next.perception, next.spacing);
      if (key === 'minSpeed') next.maxSpeed = Math.max(next.minSpeed, next.maxSpeed);
      if (key === 'maxSpeed') next.minSpeed = Math.min(next.minSpeed, next.maxSpeed);
      if (next.forwardFlight) next.minSpeed = Math.max(.5, next.minSpeed);
      apply(next);
    });
  }
  for (const key of Object.keys(toggles) as (keyof typeof toggles)[]) {
    input(toggles[key]).addEventListener('change', () => {
      const next = { ...settings, [key]: input(toggles[key]).checked };
      if (next.forwardFlight) next.minSpeed = Math.max(.5, next.minSpeed);
      apply(next);
    });
  }
  input('seed').addEventListener('change', () => {
    if (!input('seed').checkValidity()) input('seed').value = '42';
    restart();
  });
  sync();
  return {
    get seed() { return input('seed').valueAsNumber; },
    get pointerStrength() { return settings.pointerStrength; },
    restoreDefaults() {
      simulation.restoreDefaults();
      settings = simulation.settings();
      input('seed').value = '42';
      (document.getElementById('advanced') as HTMLDetailsElement).open = false;
      for (const detail of document.querySelectorAll<HTMLDetailsElement>('#advanced details')) detail.open = false;
      sync();
      obstaclesChanged();
    },
    updateStats() {
      const stats = simulation.stats();
      (document.getElementById('neighbor-checks') as HTMLOutputElement).value = stats.candidatePairs.toLocaleString();
      (document.getElementById('avoidance-count') as HTMLOutputElement).value = String(stats.avoidanceCorrections);
    },
  };
}
