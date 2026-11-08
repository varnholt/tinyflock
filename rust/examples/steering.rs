use std::time::Duration;
use tinyflock::{
    Avoidance, Config, NeighborSearch, Simulation, SphereObstacle, Steering, Target, Vec3,
};

fn main() -> Result<(), tinyflock::Error> {
    let mut flock = Simulation::default();
    flock.configure(Config {
        min_speed: 6.0,
        max_speed: 8.0,
        max_acceleration: 2.0,
        steering: Steering::ForwardFlight,
        preferred_altitude: Some(0.0),
        avoidance: Some(Avoidance {
            lookahead: Duration::from_secs(4),
            clearance: 2.5,
        }),
        neighbor_search: NeighborSearch::SpatialGrid,
        ..Config::default()
    })?;
    flock.set_obstacles(&[SphereObstacle {
        center: Vec3::default(),
        radius: 4.0,
    }])?;
    flock.reset(64, 42);
    let mut accelerations = vec![Vec3::default(); flock.state().len()];
    let step = Duration::from_secs_f32(1.0 / 60.0);
    for tick in 0..600 {
        let time = tick as f32 * step.as_secs_f32();
        flock.set_target(Some(Target {
            position: Vec3::new(30.0 * (time * 0.1).cos(), 0.0, 30.0 * (time * 0.1).sin()),
            radius: 150.0,
            strength: 0.4,
        }))?;
        for (i, acceleration) in accelerations.iter_mut().enumerate() {
            *acceleration = Vec3::new(0.05 * (time + i as f32).sin(), 0.0, 0.03);
        }
        flock.step_with_accelerations(step, &accelerations)?;
    }
    println!(
        "64 agents; {} candidate pairs in the last step",
        flock.stats().candidate_pairs
    );
    Ok(())
}
