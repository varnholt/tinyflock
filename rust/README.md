# tinyflock

A few simple rules and a sky full of birds. A small flocking simulation with no rendering or third-party dependencies.

```rust
use std::time::Duration;
use tinyflock::Simulation;

let mut flock = Simulation::default();
flock.reset(96, 42);
flock.step(Duration::from_secs_f32(1.0 / 60.0))?;
for bird in flock.state() {
    // Pass bird.position and bird.velocity to your renderer.
    let _ = bird;
}
# Ok::<(), tinyflock::Error>(())
```

Separation, alignment and cohesion are the starting point. Optional viewing cones, nearest-neighbor limits, forward-flight steering, altitude keeping, predictive avoidance and sphere obstacles let you shape the flock. Caller-supplied per-bird accelerations work with ordinary application code for routes and environmental influences.

```rust
use std::time::Duration;
use tinyflock::{Avoidance, Config, NeighborSearch, Simulation, SphereObstacle, Steering, Vec3};

let mut flock = Simulation::default();
flock.configure(Config {
    min_speed: 6.0,
    max_speed: 8.0,
    max_acceleration: 2.0,
    steering: Steering::ForwardFlight,
    avoidance: Some(Avoidance { lookahead: Duration::from_secs(4), clearance: 2.5 }),
    neighbor_search: NeighborSearch::SpatialGrid,
    ..Config::default()
})?;
flock.set_obstacles(&[SphereObstacle { center: Vec3::new(30.0, 0.0, 0.0), radius: 4.0 }])?;
flock.reset(96, 42);
let accelerations = vec![Vec3::new(0.1, 0.0, 0.0); flock.state().len()];
flock.step_with_accelerations(Duration::from_millis(16), &accelerations)?;
# Ok::<(), tinyflock::Error>(())
```

The caller owns the clock. Steps accept up to 100 ms; use a fixed timestep for repeatable results. `state()` is a borrowed read-only slice. Configuration and input errors leave state unchanged. Reset preserves configuration and obstacles, clears the target, and repeats the seed within a build. Optional acceleration inputs last one step only and share the acceleration budget; avoidance takes priority over conflicting steering.

Distances use world units, velocities use units/s and accelerations use units/s². Coordinates are bounded to `1e9` per component; positive configuration magnitudes to `[0.0001, 1000000]`; weights to `[0, 1000]`. `min_speed` is in `[0, max_speed]`; forward flight requires it to be positive. Viewing cones use radians in `(0, 2π]`; zero `max_neighbors` means all visible neighbors. Altitude response uses `[0.1s, 3600s]`; avoidance horizons use `[0.01s, 60s]`. Per-agent acceleration components are bounded to `1e6`. Sphere radii use the positive range, obstacle margins allow zero, and target strengths use `[-1000, 1000]`.

All-pairs search is the default reference. The spatial grid preserves its processing order and behavior while skipping distant cells in sparse worlds. Dense flocks and long lookahead distances can still approach quadratic work. `stats()` reports the work and avoidance corrections from the last positive step. Avoidance and boundaries are steering heuristics, not collision guarantees or an aerodynamic model. Lowering the speed cap immediately constrains existing velocity on the next positive step; the acceleration bound assumes the initial velocity respects the cap.

The Rust crate implements the same features as the C++23 single-header library. Shared scenarios check their outputs with floating-point tolerances; exact cross-language trajectories are not promised. The [browser playground](https://varnholt.github.io/tinyflock/) uses Three.js and glTF assets separately from the core.

MIT licensed. Source, examples, implementation details and asset credits: [github.com/varnholt/tinyflock](https://github.com/varnholt/tinyflock).
