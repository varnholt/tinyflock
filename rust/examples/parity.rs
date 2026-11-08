use std::io::{self, Read};
use std::time::Duration;
use tinyflock::*;

// Numeric fixture stream shared with tests/parity.cpp and check-parity.mjs.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let mut tokens = input.split_whitespace();
    let mut read = || {
        tokens
            .next()
            .expect("fixture value")
            .parse::<f32>()
            .expect("numeric fixture")
    };
    let mut c = Config {
        perception_radius: read(),
        separation_radius: read(),
        max_speed: read(),
        min_speed: read(),
        max_acceleration: read(),
        separation_weight: read(),
        alignment_weight: read(),
        cohesion_weight: read(),
        world_radius: read(),
        boundary_weight: read(),
        ..Config::default()
    };
    c.steering = if read() != 0.0 {
        Steering::ForwardFlight
    } else {
        Steering::Free
    };
    c.view_angle = read();
    c.max_neighbors = read() as usize;
    let altitude = read() != 0.0;
    let altitude_value = read();
    if altitude {
        c.preferred_altitude = Some(altitude_value);
    }
    c.altitude_response = Duration::from_secs_f32(read());
    let prediction = read() != 0.0;
    let lookahead = Duration::from_secs_f32(read());
    let clearance = read();
    if prediction {
        c.avoidance = Some(Avoidance {
            lookahead,
            clearance,
        });
    }
    c.neighbor_search = if read() != 0.0 {
        NeighborSearch::SpatialGrid
    } else {
        NeighborSearch::AllPairs
    };
    c.obstacle_lookahead = Duration::from_secs_f32(read());
    c.obstacle_margin = read();
    let steps = read() as usize;
    let elapsed = Duration::from_secs_f32(read());
    let reset_count = read() as usize;
    let seed = read() as u32;
    let count = read() as usize;
    let state: Vec<_> = (0..count)
        .map(|_| Boid {
            position: Vec3::new(read(), read(), read()),
            velocity: Vec3::new(read(), read(), read()),
        })
        .collect();
    let count = read() as usize;
    let obstacles: Vec<_> = (0..count)
        .map(|_| SphereObstacle {
            center: Vec3::new(read(), read(), read()),
            radius: read(),
        })
        .collect();
    let count = read() as usize;
    let accelerations: Vec<_> = (0..count)
        .map(|_| Vec3::new(read(), read(), read()))
        .collect();
    let target_enabled = read() != 0.0;
    let target = Target {
        position: Vec3::new(read(), read(), read()),
        radius: read(),
        strength: read(),
    };
    let mut sim = Simulation::default();
    sim.configure(c)?;
    sim.set_obstacles(&obstacles)?;
    if reset_count > 0 {
        sim.reset(reset_count, seed);
    } else {
        sim.set_state(&state)?;
    }
    if target_enabled {
        sim.set_target(Some(target))?;
    }
    for _ in 0..steps {
        sim.step_with_accelerations(elapsed, &accelerations)?;
    }
    let values: Vec<_> = sim
        .state()
        .iter()
        .flat_map(|b| {
            [
                b.position.x,
                b.position.y,
                b.position.z,
                b.velocity.x,
                b.velocity.y,
                b.velocity.z,
            ]
        })
        .map(|v| v.to_string())
        .collect();
    let s = sim.stats();
    println!(
        "{{\"state\":[{}],\"stats\":[{},{},{},{}]}}",
        values.join(","),
        s.candidate_pairs,
        s.social_neighbors,
        s.avoidance_corrections,
        s.obstacle_checks
    );
    Ok(())
}
