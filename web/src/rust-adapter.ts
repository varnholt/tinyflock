import type { BehaviorSettings, Simulation, SphereObstacle } from './simulation';
import { decodeSettings, encodeSettings } from './settings.ts';

export async function createRustSimulation(moduleUrl: string, wasmBytes?: BufferSource): Promise<Simulation> {
  const module = await import(/* @vite-ignore */ moduleUrl);
  await module.default(wasmBytes ? { module_or_path: wasmBytes } : undefined);
  const core = new module.WebSimulation();
  return {
    reset: (count, seed) => core.reset(count, seed),
    step: seconds => core.step(seconds),
    target: (x, y, z, strength) => core.target(x, y, z, strength),
    clearTarget: () => core.clear_target(),
    weights: (separation, alignment, cohesion) => core.weights(separation, alignment, cohesion),
    settings: () => decodeSettings(core.settings()),
    configure(settings: BehaviorSettings) { const values = encodeSettings(settings); return values ? core.configure(values) : false; },
    restoreDefaults: () => core.restore_defaults(),
    obstacles() {
      const values: Float32Array = core.obstacles(); const result: SphereObstacle[] = [];
      for (let i = 0; i < values.length; i += 4) result.push({ x: values[i], y: values[i + 1], z: values[i + 2], radius: values[i + 3] });
      return result;
    },
    stats() { const values = core.stats(); return { candidatePairs: values[0], socialNeighbors: values[1], avoidanceCorrections: values[2], obstacleChecks: values[3] }; },
    state: () => core.state(),
    delete: () => core.free(),
  };
}
