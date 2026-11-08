use std::time::Duration;
use tinyflock::{
    Avoidance, Config, NeighborSearch, Simulation, SphereObstacle, Steering, Target, Vec3,
};
use wasm_bindgen::prelude::*;

fn preset() -> Config {
    Config {
        perception_radius: 16.0,
        separation_radius: 5.5,
        max_speed: 8.0,
        min_speed: 6.0,
        max_acceleration: 2.0,
        separation_weight: 1.8,
        alignment_weight: 0.8,
        cohesion_weight: 0.4,
        boundary_weight: 5.0,
        steering: Steering::ForwardFlight,
        view_angle: std::f32::consts::PI * 1.5,
        max_neighbors: 7,
        preferred_altitude: Some(0.0),
        altitude_response: Duration::from_secs(10),
        avoidance: Some(Avoidance {
            lookahead: Duration::from_secs(4),
            clearance: 2.5,
        }),
        neighbor_search: NeighborSearch::SpatialGrid,
        ..Config::default()
    }
}
const COURSE: [SphereObstacle; 2] = [
    SphereObstacle {
        center: Vec3::new(18.0, 0.0, 6.0),
        radius: 8.0,
    },
    SphereObstacle {
        center: Vec3::new(-20.0, 2.0, -12.0),
        radius: 6.0,
    },
];

/// Thin browser adapter; the published crate has no WebAssembly dependencies.
#[wasm_bindgen]
pub struct WebSimulation {
    simulation: Simulation,
    force: Vec3,
    forces: Vec<Vec3>,
    lookahead: f32,
    clearance: f32,
    altitude: f32,
    pointer_radius: f32,
    pointer_strength: f32,
}
impl Default for WebSimulation {
    fn default() -> Self {
        Self::new()
    }
}
#[wasm_bindgen]
impl WebSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut result = Self {
            simulation: Simulation::default(),
            force: Vec3::default(),
            forces: Vec::new(),
            lookahead: 4.0,
            clearance: 2.5,
            altitude: 0.0,
            pointer_radius: 70.0,
            pointer_strength: 2.0,
        };
        result.restore_defaults();
        result.reset(96, 42);
        result
    }
    pub fn restore_defaults(&mut self) {
        self.simulation
            .configure(preset())
            .expect("valid demo preset");
        self.simulation
            .set_obstacles(&[])
            .expect("empty environment");
        self.simulation.set_target(None).expect("empty target");
        self.force = Vec3::default();
        self.forces.fill(self.force);
        self.lookahead = 4.0;
        self.clearance = 2.5;
        self.altitude = 0.0;
        self.pointer_radius = 70.0;
        self.pointer_strength = 2.0;
    }
    pub fn reset(&mut self, count: u32, seed: u32) {
        self.simulation.reset(count.min(2048) as usize, seed);
        let mut state = self.simulation.state().to_vec();
        let c = *self.simulation.config();
        for bird in &mut state {
            let direction = Vec3::new(
                1.0 + bird.velocity.x * 0.012,
                bird.velocity.y * 0.012,
                0.35 + bird.velocity.z * 0.012,
            );
            bird.velocity =
                direction / direction.length() * 7.0_f32.clamp(c.min_speed, c.max_speed);
        }
        self.simulation
            .set_state(&state)
            .expect("bounded reset state");
        self.forces.resize(state.len(), self.force);
        self.forces.fill(self.force);
    }
    pub fn step(&mut self, seconds: f32) -> bool {
        if !seconds.is_finite() || !(0.0..=0.1).contains(&seconds) {
            return false;
        }
        let elapsed = Duration::from_secs_f32(seconds).min(Duration::from_millis(100));
        let forces = if self.force == Vec3::default() {
            &[][..]
        } else {
            &self.forces[..]
        };
        self.simulation
            .step_with_accelerations(elapsed, forces)
            .is_ok()
    }
    pub fn target(&mut self, x: f32, y: f32, z: f32, strength: f32) -> bool {
        self.simulation
            .set_target(Some(Target {
                position: Vec3::new(x, y, z),
                radius: self.pointer_radius,
                strength,
            }))
            .is_ok()
    }
    pub fn clear_target(&mut self) {
        self.simulation.set_target(None).expect("empty target");
    }
    pub fn weights(&mut self, separation: f32, alignment: f32, cohesion: f32) -> bool {
        self.simulation
            .configure(Config {
                separation_weight: separation,
                alignment_weight: alignment,
                cohesion_weight: cohesion,
                ..*self.simulation.config()
            })
            .is_ok()
    }
    pub fn state(&self) -> Vec<f32> {
        self.simulation
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
            .collect()
    }
    /// Packed settings are translated to named properties by the shared renderer.
    pub fn settings(&self) -> Vec<f32> {
        let c = *self.simulation.config();
        let flag = |v: bool| u8::from(v) as f32;
        vec![
            c.perception_radius,
            c.separation_radius,
            c.min_speed,
            c.max_speed,
            c.max_acceleration,
            c.view_angle / std::f32::consts::PI * 180.0,
            c.max_neighbors as f32,
            c.world_radius,
            c.boundary_weight,
            flag(c.preferred_altitude.is_some()),
            self.altitude,
            c.altitude_response.as_secs_f32(),
            flag(c.avoidance.is_some()),
            self.lookahead,
            self.clearance,
            flag(c.steering == Steering::ForwardFlight),
            flag(c.neighbor_search == NeighborSearch::SpatialGrid),
            flag(!self.simulation.obstacles().is_empty()),
            c.obstacle_lookahead.as_secs_f32(),
            c.obstacle_margin,
            self.force.x,
            self.force.y,
            self.force.z,
            self.pointer_radius,
            self.pointer_strength,
        ]
    }
    pub fn configure(&mut self, v: &[f32]) -> bool {
        if v.len() != 25
            || !v.iter().all(|x| x.is_finite())
            || [9, 12, 15, 16, 17]
                .iter()
                .any(|&i| v[i] != 0.0 && v[i] != 1.0)
        {
            return false;
        }
        if v[6] < 0.0
            || v[6] > 2048.0
            || v[6].fract() != 0.0
            || v[10].abs() > 1.0e9
            || !(0.1..=3600.0).contains(&v[11])
            || !(0.01..=60.0).contains(&v[13])
            || !(0.0001..=1.0e6).contains(&v[14])
            || !(0.01..=60.0).contains(&v[18])
            || v[20..23].iter().any(|x| x.abs() > 1.0e6)
            || !(0.0001..=1.0e6).contains(&v[23])
            || !(0.0..=1000.0).contains(&v[24])
        {
            return false;
        }
        let c = Config {
            perception_radius: v[0],
            separation_radius: v[1],
            min_speed: v[2],
            max_speed: v[3],
            max_acceleration: v[4],
            view_angle: v[5] / 180.0 * std::f32::consts::PI,
            max_neighbors: v[6] as usize,
            world_radius: v[7],
            boundary_weight: v[8],
            preferred_altitude: if v[9] != 0.0 { Some(v[10]) } else { None },
            altitude_response: Duration::from_secs_f32(v[11]),
            avoidance: if v[12] != 0.0 {
                Some(Avoidance {
                    lookahead: Duration::from_secs_f32(v[13]),
                    clearance: v[14],
                })
            } else {
                None
            },
            steering: if v[15] != 0.0 {
                Steering::ForwardFlight
            } else {
                Steering::Free
            },
            neighbor_search: if v[16] != 0.0 {
                NeighborSearch::SpatialGrid
            } else {
                NeighborSearch::AllPairs
            },
            obstacle_lookahead: Duration::from_secs_f32(v[18]),
            obstacle_margin: v[19],
            ..*self.simulation.config()
        };
        let mut candidate = self.simulation.clone();
        if candidate.configure(c).is_err() {
            return false;
        }
        if candidate
            .set_obstacles(if v[17] != 0.0 { &COURSE } else { &[] })
            .is_err()
        {
            return false;
        }
        self.simulation = candidate;
        self.force = Vec3::new(v[20], v[21], v[22]);
        self.forces.fill(self.force);
        self.altitude = v[10];
        self.lookahead = v[13];
        self.clearance = v[14];
        self.pointer_radius = v[23];
        self.pointer_strength = v[24];
        true
    }
    pub fn obstacles(&self) -> Vec<f32> {
        self.simulation
            .obstacles()
            .iter()
            .flat_map(|o| [o.center.x, o.center.y, o.center.z, o.radius])
            .collect()
    }
    pub fn stats(&self) -> Vec<u32> {
        let s = self.simulation.stats();
        vec![
            s.candidate_pairs as u32,
            s.social_neighbors as u32,
            s.avoidance_corrections as u32,
            s.obstacle_checks as u32,
        ]
    }
}
