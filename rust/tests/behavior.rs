use std::time::Duration;
use tinyflock::*;

const STEP: Duration = Duration::from_millis(16);
fn bird(x: f32, y: f32, z: f32, vx: f32, vy: f32, vz: f32) -> Boid {
    Boid {
        position: Vec3::new(x, y, z),
        velocity: Vec3::new(vx, vy, vz),
    }
}
fn isolated() -> Config {
    Config {
        separation_weight: 0.0,
        alignment_weight: 0.0,
        cohesion_weight: 0.0,
        boundary_weight: 0.0,
        ..Config::default()
    }
}
fn flight() -> Config {
    Config {
        min_speed: 6.0,
        max_speed: 8.0,
        max_acceleration: 2.0,
        steering: Steering::ForwardFlight,
        ..isolated()
    }
}

#[test]
fn invalid_inputs_are_transactional() {
    let mut sim = Simulation::default();
    sim.reset(2, 42);
    let state = sim.state().to_vec();
    let cfg = *sim.config();
    for invalid in [
        Config {
            max_speed: f32::NAN,
            ..cfg
        },
        Config {
            min_speed: 13.0,
            ..cfg
        },
        Config {
            view_angle: 0.0,
            ..cfg
        },
        Config {
            steering: Steering::ForwardFlight,
            ..cfg
        },
        Config {
            altitude_response: Duration::ZERO,
            ..cfg
        },
    ] {
        assert_eq!(sim.configure(invalid), Err(Error::InvalidConfig));
        assert_eq!(sim.config(), &cfg);
    }
    assert_eq!(
        sim.set_state(&[bird(f32::INFINITY, 0.0, 0.0, 0.0, 0.0, 0.0)]),
        Err(Error::InvalidState)
    );
    assert_eq!(
        sim.step(Duration::from_millis(101)),
        Err(Error::InvalidTimestep)
    );
    assert_eq!(
        sim.step_with_accelerations(STEP, &[Vec3::default()]),
        Err(Error::InvalidAcceleration)
    );
    assert_eq!(
        sim.step_with_accelerations(Duration::ZERO, &[Vec3::new(f32::NAN, 0.0, 0.0); 2]),
        Err(Error::InvalidAcceleration)
    );
    assert_eq!(
        sim.set_target(Some(Target {
            radius: -1.0,
            ..Target::default()
        })),
        Err(Error::InvalidTarget)
    );
    sim.step(Duration::ZERO).unwrap();
    assert_eq!(sim.state(), state);
}
#[test]
fn seeds_repeat_and_instances_are_independent() {
    let mut a = Simulation::default();
    let mut b = Simulation::default();
    a.reset(256, 42);
    b.reset(256, 42);
    assert_eq!(a.state(), b.state());
    a.step(STEP).unwrap();
    assert_ne!(a.state(), b.state());
    b.step(STEP).unwrap();
    assert_eq!(a.state(), b.state());
    b.reset(0, 42);
    b.step(STEP).unwrap();
    assert!(b.state().is_empty());
}
#[test]
fn external_acceleration_is_per_agent_and_per_step() {
    let mut sim = Simulation::default();
    sim.configure(isolated()).unwrap();
    sim.set_state(&[Boid::default(); 2]).unwrap();
    sim.step_with_accelerations(
        Duration::from_millis(100),
        &[Vec3::new(0.0, 2.0, 0.0), Vec3::new(-3.0, 0.0, 0.0)],
    )
    .unwrap();
    assert!((sim.state()[0].velocity.y - 0.2).abs() < 1.0e-6);
    assert!((sim.state()[1].velocity.x + 0.3).abs() < 1.0e-6);
    let velocities: Vec<_> = sim.state().iter().map(|b| b.velocity).collect();
    sim.step(STEP).unwrap();
    assert_eq!(
        sim.state().iter().map(|b| b.velocity).collect::<Vec<_>>(),
        velocities
    );
}
#[test]
fn viewing_cone_and_social_limit_do_not_disable_spacing() {
    let mut sim = Simulation::default();
    let config = Config {
        view_angle: std::f32::consts::PI,
        cohesion_weight: 1.0,
        ..isolated()
    };
    sim.configure(config).unwrap();
    let pair = [
        bird(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        bird(-2.0, 0.0, 0.0, 1.0, 0.0, 0.0),
    ];
    sim.set_state(&pair).unwrap();
    sim.step(STEP).unwrap();
    assert_eq!(sim.state()[0].velocity, pair[0].velocity);
    sim.configure(Config {
        separation_weight: 1.0,
        ..config
    })
    .unwrap();
    sim.set_state(&pair).unwrap();
    sim.step(STEP).unwrap();
    assert!(sim.state()[0].velocity.x > 1.0);
    sim.configure(Config {
        max_neighbors: 1,
        cohesion_weight: 1.0,
        ..isolated()
    })
    .unwrap();
    sim.set_state(&[
        pair[0],
        bird(0.0, 0.0, 2.0, 0.0, 0.0, 0.0),
        bird(0.0, 0.0, -5.0, 0.0, 0.0, 0.0),
    ])
    .unwrap();
    sim.step(STEP).unwrap();
    assert!(sim.state()[0].velocity.z > 0.0);
}
#[test]
fn attraction_repulsion_and_altitude_work() {
    let mut sim = Simulation::default();
    sim.configure(isolated()).unwrap();
    sim.set_state(&[Boid::default()]).unwrap();
    sim.set_target(Some(Target {
        position: Vec3::new(10.0, 0.0, 0.0),
        radius: 100.0,
        strength: 1.0,
    }))
    .unwrap();
    sim.step(STEP).unwrap();
    assert!(sim.state()[0].velocity.x > 0.0);
    sim.set_state(&[Boid::default()]).unwrap();
    sim.set_target(Some(Target {
        position: Vec3::new(10.0, 0.0, 0.0),
        radius: 100.0,
        strength: -1.0,
    }))
    .unwrap();
    sim.step(STEP).unwrap();
    assert!(sim.state()[0].velocity.x < 0.0);
    sim.set_target(None).unwrap();
    sim.configure(Config {
        preferred_altitude: Some(0.0),
        altitude_response: Duration::from_secs(4),
        ..isolated()
    })
    .unwrap();
    sim.set_state(&[bird(0.0, 10.0, 0.0, 1.0, 0.0, 0.0)])
        .unwrap();
    for _ in 0..1250 {
        sim.step(STEP).unwrap();
    }
    assert!(sim.state()[0].position.y.abs() < 0.02);
    assert!(sim.state()[0].velocity.y.abs() < 0.01);
}
fn encounter(pair: [Boid; 2], enabled: bool) -> f32 {
    let mut sim = Simulation::default();
    let mut config = flight();
    if enabled {
        config.avoidance = Some(Avoidance {
            lookahead: Duration::from_secs(6),
            clearance: 2.0,
        });
    }
    sim.configure(config).unwrap();
    sim.set_state(&pair).unwrap();
    let mut minimum = f32::MAX;
    for _ in 0..625 {
        let before = sim.state().to_vec();
        sim.step(STEP).unwrap();
        minimum = minimum.min((sim.state()[0].position - sim.state()[1].position).length());
        for (old, new) in before.iter().zip(sim.state()) {
            assert!((new.velocity - old.velocity).length() <= 2.0 * STEP.as_secs_f32() + 1.0e-4);
            assert!(new.velocity.length() >= 6.0 - 1.0e-4 && new.velocity.length() <= 8.0 + 1.0e-4);
        }
    }
    minimum
}
#[test]
fn predictive_avoidance_clears_head_on_crossing_overtaking_and_vertical_paths() {
    for pair in [
        [
            bird(-12.0, 0.0, 0.0, 7.0, 0.0, 0.0),
            bird(12.0, 0.0, 0.0, -7.0, 0.0, 0.0),
        ],
        [
            bird(-12.0, 0.0, 0.0, 7.0, 0.0, 0.0),
            bird(0.0, 0.0, -12.0, 0.0, 0.0, 7.0),
        ],
        [
            bird(-10.0, 0.0, 0.0, 8.0, 0.0, 0.0),
            bird(0.0, 0.0, 0.0, 6.0, 0.0, 0.0),
        ],
        [
            bird(0.0, -12.0, 0.0, 0.0, 7.0, 0.0),
            bird(0.0, 12.0, 0.0, 0.0, -7.0, 0.0),
        ],
    ] {
        assert!(encounter(pair, false) < 0.15);
        assert!(encounter(pair, true) > 1.9);
    }
}
#[test]
fn safe_paths_do_not_trigger_prediction() {
    let mut sim = Simulation::default();
    sim.configure(Config {
        avoidance: Some(Avoidance::default()),
        ..flight()
    })
    .unwrap();
    for pair in [
        [
            bird(0.0, 0.0, 0.0, 7.0, 0.0, 0.0),
            bird(1.0, 0.0, 0.0, 7.0, 0.0, 0.0),
        ],
        [
            bird(-1.0, 0.0, 0.0, -7.0, 0.0, 0.0),
            bird(1.0, 0.0, 0.0, 7.0, 0.0, 0.0),
        ],
        [
            bird(-12.0, 0.0, 0.0, 7.0, 0.0, 0.0),
            bird(0.0, 5.0, -12.0, 0.0, 0.0, 7.0),
        ],
    ] {
        sim.set_state(&pair).unwrap();
        sim.step(STEP).unwrap();
        assert_eq!(sim.state()[0].velocity, pair[0].velocity);
        assert_eq!(sim.stats().avoidance_corrections, 0);
    }
}
#[test]
fn solid_spheres_are_avoided_and_preserved_by_reset() {
    let mut sim = Simulation::default();
    sim.configure(Config {
        obstacle_lookahead: Duration::from_secs(6),
        ..flight()
    })
    .unwrap();
    let obstacle = SphereObstacle {
        center: Vec3::default(),
        radius: 3.0,
    };
    sim.set_obstacles(&[obstacle]).unwrap();
    assert_eq!(
        sim.set_obstacles(&[SphereObstacle {
            radius: -1.0,
            ..obstacle
        }]),
        Err(Error::InvalidObstacle)
    );
    assert_eq!(sim.obstacles(), &[obstacle]);
    sim.set_state(&[bird(-35.0, 0.0, 0.0, 7.0, 0.0, 0.0)])
        .unwrap();
    let mut minimum = f32::MAX;
    for _ in 0..625 {
        sim.step(STEP).unwrap();
        minimum = minimum.min(sim.state()[0].position.length());
    }
    assert!(minimum > 3.9);
    sim.reset(1, 42);
    assert_eq!(sim.obstacles(), &[obstacle]);
    sim.configure(isolated()).unwrap();
    sim.set_state(&[Boid::default()]).unwrap();
    sim.step(STEP).unwrap();
    assert!(sim.state()[0].velocity.x > 0.0);
}
#[test]
fn grid_matches_the_reference_exactly() {
    for prediction in [false, true] {
        for max_neighbors in [0, 7] {
            let mut a = Simulation::default();
            let mut cfg = Config {
                world_radius: 2000.0,
                max_neighbors,
                preferred_altitude: Some(0.0),
                ..Config::default()
            };
            if prediction {
                cfg.avoidance = Some(Avoidance::default());
            }
            a.configure(cfg).unwrap();
            a.reset(192, 17);
            let mut b = a.clone();
            cfg.neighbor_search = NeighborSearch::SpatialGrid;
            b.configure(cfg).unwrap();
            for _ in 0..60 {
                a.step(STEP).unwrap();
                b.step(STEP).unwrap();
                assert_eq!(a.state(), b.state());
                assert_eq!(a.stats().social_neighbors, b.stats().social_neighbors);
            }
            assert!(b.stats().candidate_pairs < a.stats().candidate_pairs / 4);
        }
    }
}
#[test]
fn sparse_grid_skips_distant_pairs() {
    let mut sim = Simulation::default();
    sim.configure(Config {
        neighbor_search: NeighborSearch::SpatialGrid,
        ..isolated()
    })
    .unwrap();
    sim.set_state(
        &(0..4096)
            .map(|i| bird((i as f32 - 2048.0) * 50.0, 0.0, 0.0, 0.0, 0.0, 0.0))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    sim.step(STEP).unwrap();
    assert_eq!(sim.stats().candidate_pairs, 0);
}
#[test]
fn forward_flight_starts_from_rest_without_a_velocity_jump() {
    let mut sim = Simulation::default();
    sim.configure(flight()).unwrap();
    sim.set_state(&[Boid::default()]).unwrap();
    sim.step(STEP).unwrap();
    assert!(sim.state()[0].velocity.length() <= 2.0 * STEP.as_secs_f32() + 1.0e-4);
}
