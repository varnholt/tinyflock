#![forbid(unsafe_code)]
#![doc = include_str!("../README.md")]

use std::f32::consts::PI;
use std::ops::{Add, AddAssign, Div, Mul, Sub};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}
impl Vec3 {
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
    pub fn dot(self, b: Self) -> f32 {
        self.x * b.x + self.y * b.y + self.z * b.z
    }
    pub fn length_squared(self) -> f32 {
        self.dot(self)
    }
    pub fn length(self) -> f32 {
        self.length_squared().sqrt()
    }
    fn finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
    fn bounded(self, limit: f32) -> bool {
        self.finite() && self.x.abs() <= limit && self.y.abs() <= limit && self.z.abs() <= limit
    }
}
impl Add for Vec3 {
    type Output = Self;
    fn add(self, b: Self) -> Self {
        Self::new(self.x + b.x, self.y + b.y, self.z + b.z)
    }
}
impl Sub for Vec3 {
    type Output = Self;
    fn sub(self, b: Self) -> Self {
        Self::new(self.x - b.x, self.y - b.y, self.z - b.z)
    }
}
impl Mul<f32> for Vec3 {
    type Output = Self;
    fn mul(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }
}
impl Div<f32> for Vec3 {
    type Output = Self;
    fn div(self, s: f32) -> Self {
        self * (1.0 / s)
    }
}
impl AddAssign for Vec3 {
    fn add_assign(&mut self, b: Self) {
        *self = *self + b;
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Boid {
    pub position: Vec3,
    pub velocity: Vec3,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Steering {
    #[default]
    Free,
    ForwardFlight,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NeighborSearch {
    #[default]
    AllPairs,
    SpatialGrid,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Avoidance {
    pub lookahead: Duration,
    pub clearance: f32,
}
impl Default for Avoidance {
    fn default() -> Self {
        Self {
            lookahead: Duration::from_secs(3),
            clearance: 2.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Config {
    pub perception_radius: f32,
    pub separation_radius: f32,
    pub max_speed: f32,
    pub min_speed: f32,
    pub max_acceleration: f32,
    pub separation_weight: f32,
    pub alignment_weight: f32,
    pub cohesion_weight: f32,
    pub world_radius: f32,
    pub boundary_weight: f32,
    pub steering: Steering,
    /// Full viewing cone in radians. Separation remains omnidirectional.
    pub view_angle: f32,
    /// Zero selects every visible neighbor for alignment and cohesion.
    pub max_neighbors: usize,
    pub preferred_altitude: Option<f32>,
    pub altitude_response: Duration,
    pub avoidance: Option<Avoidance>,
    pub neighbor_search: NeighborSearch,
    pub obstacle_lookahead: Duration,
    pub obstacle_margin: f32,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            perception_radius: 12.0,
            separation_radius: 4.0,
            max_speed: 12.0,
            min_speed: 0.0,
            max_acceleration: 18.0,
            separation_weight: 1.5,
            alignment_weight: 1.0,
            cohesion_weight: 0.6,
            world_radius: 55.0,
            boundary_weight: 2.0,
            steering: Steering::Free,
            view_angle: 2.0 * PI,
            max_neighbors: 0,
            preferred_altitude: None,
            altitude_response: Duration::from_secs(8),
            avoidance: None,
            neighbor_search: NeighborSearch::AllPairs,
            obstacle_lookahead: Duration::from_secs(4),
            obstacle_margin: 1.0,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SphereObstacle {
    pub center: Vec3,
    pub radius: f32,
}
impl Default for SphereObstacle {
    fn default() -> Self {
        Self {
            center: Vec3::default(),
            radius: 1.0,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Target {
    pub position: Vec3,
    pub radius: f32,
    pub strength: f32,
}
impl Default for Target {
    fn default() -> Self {
        Self {
            position: Vec3::default(),
            radius: 40.0,
            strength: 1.0,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StepStats {
    pub candidate_pairs: usize,
    pub social_neighbors: usize,
    pub avoidance_corrections: usize,
    pub obstacle_checks: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidConfig,
    InvalidState,
    InvalidTimestep,
    InvalidTarget,
    InvalidObstacle,
    InvalidAcceleration,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidConfig => "invalid flock configuration",
            Self::InvalidState => "invalid agent state",
            Self::InvalidTimestep => "timestep exceeds 100 ms",
            Self::InvalidTarget => "invalid steering target",
            Self::InvalidObstacle => "invalid sphere obstacle",
            Self::InvalidAcceleration => "invalid per-agent accelerations",
        })
    }
}
impl std::error::Error for Error {}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
struct Cell(i64, i64, i64);
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Entry {
    cell: Cell,
    index: usize,
}
#[derive(Clone, Debug, Default)]
pub struct Simulation {
    config: Config,
    target: Option<Target>,
    state: Vec<Boid>,
    next: Vec<Boid>,
    obstacles: Vec<SphereObstacle>,
    neighbors: Vec<(f32, usize)>,
    grid: Vec<Entry>,
    candidates: Vec<usize>,
    stats: StepStats,
}

fn positive(v: f32) -> bool {
    v.is_finite() && (0.0001..=1.0e6).contains(&v)
}
fn weight(v: f32) -> bool {
    v.is_finite() && (0.0..=1000.0).contains(&v)
}
fn horizon(v: Duration) -> bool {
    (Duration::from_millis(10)..=Duration::from_secs(60)).contains(&v)
}
fn limited(v: Vec3, maximum: f32) -> Vec3 {
    let size = v.length();
    if size > maximum {
        v * (maximum / size)
    } else {
        v
    }
}

#[derive(Clone, Copy, Default)]
struct Prediction {
    direction: Vec3,
    acceleration: f32,
}
fn predict(
    offset: Vec3,
    relative_velocity: Vec3,
    avoidance: Avoidance,
    maximum: f32,
) -> Prediction {
    let speed2 = relative_velocity.length_squared();
    let closing = -offset.dot(relative_velocity);
    if speed2 < 1.0e-12 || closing <= 0.0 {
        return Prediction::default();
    }
    let time = (closing / speed2).min(avoidance.lookahead.as_secs_f32());
    let miss = offset + relative_velocity * time;
    let distance = miss.length();
    if distance >= avoidance.clearance {
        return Prediction::default();
    }
    let mut direction = miss;
    if distance < 1.0e-5 {
        direction = Vec3::new(relative_velocity.z, 0.0, -relative_velocity.x);
        if direction.length_squared() < speed2 * 1.0e-8 {
            direction = Vec3::new(relative_velocity.y, -relative_velocity.x, 0.0);
        }
    }
    direction = direction / direction.length();
    let required =
        2.0 * f64::from(avoidance.clearance - distance) / (f64::from(time) * f64::from(time));
    Prediction {
        direction,
        acceleration: required.min(f64::from(maximum)) as f32,
    }
}
fn steering(direction: Vec3, velocity: Vec3, config: Config) -> Vec3 {
    let magnitude = direction.length();
    if magnitude < 1.0e-6 {
        return Vec3::default();
    }
    let speed = velocity.length();
    if config.steering == Steering::ForwardFlight && speed > 1.0e-6 {
        let forward = velocity / speed;
        let goal = direction / magnitude;
        let cosine = forward.dot(goal).clamp(-1.0, 1.0);
        let mut turn = goal - forward * cosine;
        let mut preferred = Vec3::new(forward.z, 0.0, -forward.x);
        if preferred.length_squared() < 1.0e-8 {
            preferred = Vec3::new(forward.y, -forward.x, 0.0);
        }
        preferred = preferred / preferred.length();
        let behind = ((-cosine - 0.25) * 2.0).clamp(0.0, 1.0);
        turn = turn * (1.0 - behind) + preferred * behind;
        let amount = turn.length();
        if amount > 1.0e-6 {
            turn = turn / amount * (config.max_acceleration * (cosine.acos() / 0.8).min(1.0));
        }
        return limited(
            turn + forward * ((config.max_speed - speed) * 0.5),
            config.max_acceleration,
        );
    }
    limited(
        direction * (config.max_speed / magnitude) - velocity,
        config.max_acceleration,
    )
}
fn next_toward_one(value: f32) -> f32 {
    if value == 1.0 {
        value
    } else if value == 0.0 {
        f32::from_bits(1)
    } else if value > 0.0 {
        f32::from_bits(value.to_bits() + 1)
    } else {
        f32::from_bits(value.to_bits() - 1)
    }
}
fn speed_floor(candidate: Vec3, previous: Vec3, minimum: f32, max_change: f32) -> Vec3 {
    let old_speed = previous.length();
    let floor = minimum.min(old_speed + max_change);
    let speed = candidate.length();
    if floor == 0.0 || speed >= floor {
        return candidate;
    }
    let mut direction = if speed > 1.0e-7 {
        candidate / speed
    } else if old_speed > 1.0e-7 {
        previous / old_speed
    } else {
        Vec3::new(1.0, 0.0, 0.0)
    };
    if old_speed > 1.0e-7 {
        let forward = previous / old_speed;
        let cosine = forward.dot(direction).clamp(-1.0, 1.0);
        let (old, low, change) = (
            f64::from(old_speed),
            f64::from(floor),
            f64::from(max_change),
        );
        let bound =
            ((old * old + low * low - change * change) / (2.0 * old * low)).clamp(-1.0, 1.0);
        let limit = next_toward_one(bound as f32);
        if cosine < limit {
            let mut sideways = direction - forward * cosine;
            if sideways.length_squared() < 1.0e-12 {
                sideways = if forward.y.abs() < 0.9 {
                    Vec3::new(-forward.z, 0.0, forward.x)
                } else {
                    Vec3::new(0.0, forward.z, -forward.y)
                };
            }
            sideways = sideways / sideways.length();
            direction = forward * limit + sideways * (1.0 - limit * limit).max(0.0).sqrt();
        }
    }
    direction * floor
}

impl Simulation {
    pub fn config(&self) -> &Config {
        &self.config
    }
    pub fn state(&self) -> &[Boid] {
        &self.state
    }
    pub fn obstacles(&self) -> &[SphereObstacle] {
        &self.obstacles
    }
    pub fn stats(&self) -> StepStats {
        self.stats
    }
    pub fn configure(&mut self, config: Config) -> Result<(), Error> {
        let valid = [
            config.perception_radius,
            config.separation_radius,
            config.max_speed,
            config.max_acceleration,
            config.world_radius,
        ]
        .into_iter()
        .all(positive)
            && [
                config.separation_weight,
                config.alignment_weight,
                config.cohesion_weight,
                config.boundary_weight,
            ]
            .into_iter()
            .all(weight)
            && config.separation_radius <= config.perception_radius
            && config.min_speed.is_finite()
            && (0.0..=config.max_speed).contains(&config.min_speed)
            && config.view_angle.is_finite()
            && config.view_angle > 0.0
            && config.view_angle <= 2.0 * PI
            && config
                .preferred_altitude
                .is_none_or(|v| v.is_finite() && v.abs() <= 1.0e9)
            && (Duration::from_millis(100)..=Duration::from_secs(3600))
                .contains(&config.altitude_response)
            && config
                .avoidance
                .is_none_or(|v| positive(v.clearance) && horizon(v.lookahead))
            && horizon(config.obstacle_lookahead)
            && config.obstacle_margin.is_finite()
            && (0.0..=1.0e6).contains(&config.obstacle_margin)
            && (config.steering != Steering::ForwardFlight || config.min_speed > 0.0);
        if !valid {
            return Err(Error::InvalidConfig);
        }
        self.config = config;
        Ok(())
    }
    pub fn set_state(&mut self, state: &[Boid]) -> Result<(), Error> {
        if !state
            .iter()
            .all(|b| b.position.bounded(1.0e9) && b.velocity.bounded(1.0e9))
        {
            return Err(Error::InvalidState);
        }
        self.state = state.to_vec();
        self.next.resize(state.len(), Boid::default());
        self.stats = StepStats::default();
        Ok(())
    }
    pub fn set_target(&mut self, target: Option<Target>) -> Result<(), Error> {
        if target.is_some_and(|t| {
            !t.position.bounded(1.0e9)
                || !positive(t.radius)
                || !t.strength.is_finite()
                || t.strength.abs() > 1000.0
        }) {
            return Err(Error::InvalidTarget);
        }
        self.target = target;
        Ok(())
    }
    pub fn set_obstacles(&mut self, obstacles: &[SphereObstacle]) -> Result<(), Error> {
        if !obstacles
            .iter()
            .all(|o| o.center.bounded(1.0e9) && positive(o.radius))
        {
            return Err(Error::InvalidObstacle);
        }
        self.obstacles = obstacles.to_vec();
        Ok(())
    }
    pub fn reset(&mut self, count: usize, seed: u32) {
        let mut random = Mt19937::new(seed);
        let c = self.config;
        self.state.resize(count, Boid::default());
        self.next.resize(count, Boid::default());
        self.target = None;
        self.stats = StepStats::default();
        for bird in &mut self.state {
            bird.position = Vec3::new(random.sample(), random.sample() * 0.45, random.sample())
                * (c.world_radius * 0.45);
            bird.velocity = limited(
                Vec3::new(random.sample(), random.sample() * 0.3, random.sample()),
                1.0,
            ) * (c.max_speed * 0.7);
            let speed = bird.velocity.length();
            if speed < c.min_speed {
                bird.velocity = (if speed > 1.0e-7 {
                    bird.velocity / speed
                } else {
                    Vec3::new(1.0, 0.0, 0.0)
                }) * c.min_speed;
            }
        }
    }
    pub fn step(&mut self, elapsed: Duration) -> Result<(), Error> {
        self.step_with_accelerations(elapsed, &[])
    }
    pub fn step_with_accelerations(
        &mut self,
        elapsed: Duration,
        accelerations: &[Vec3],
    ) -> Result<(), Error> {
        if elapsed > Duration::from_millis(100) {
            return Err(Error::InvalidTimestep);
        }
        if (!accelerations.is_empty() && accelerations.len() != self.state.len())
            || !accelerations.iter().all(|a| a.bounded(1.0e6))
        {
            return Err(Error::InvalidAcceleration);
        }
        if elapsed.is_zero() {
            return Ok(());
        }
        let dt = elapsed.as_secs_f32();
        let c = self.config;
        self.stats = StepStats::default();
        let mut cell_size = f64::from(c.perception_radius);
        if let Some(avoidance) = c.avoidance {
            let speed = self
                .state
                .iter()
                .map(|b| b.velocity.length())
                .fold(0.0_f32, f32::max);
            cell_size = cell_size.max(
                f64::from(avoidance.clearance)
                    + 2.0 * f64::from(speed) * f64::from(avoidance.lookahead.as_secs_f32()),
            );
        }
        let cell_of = |position: Vec3| {
            let coordinate =
                |v: f32| (f64::from(v) / cell_size).floor().clamp(-1.0e18, 1.0e18) as i64;
            Cell(
                coordinate(position.x),
                coordinate(position.y),
                coordinate(position.z),
            )
        };
        if c.neighbor_search == NeighborSearch::SpatialGrid {
            self.grid.clear();
            self.grid
                .extend(self.state.iter().enumerate().map(|(index, b)| Entry {
                    cell: cell_of(b.position),
                    index,
                }));
            self.grid.sort_unstable();
        }
        let perception2 = c.perception_radius * c.perception_radius;
        let separation2 = c.separation_radius * c.separation_radius;
        let view_cosine = (c.view_angle * 0.5).cos();
        for i in 0..self.state.len() {
            let bird = self.state[i];
            let (mut separation, mut alignment, mut center) =
                (Vec3::default(), Vec3::default(), Vec3::default());
            let mut avoidance = Prediction::default();
            let mut neighbors = 0;
            self.neighbors.clear();
            if c.neighbor_search == NeighborSearch::SpatialGrid {
                self.candidates.clear();
                let Cell(x, y, z) = cell_of(bird.position);
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        for dz in -1..=1 {
                            let query = Cell(x + dx, y + dy, z + dz);
                            let start = self.grid.partition_point(|entry| entry.cell < query);
                            for entry in self.grid[start..]
                                .iter()
                                .take_while(|entry| entry.cell == query)
                            {
                                self.candidates.push(entry.index);
                            }
                        }
                    }
                }
                self.candidates.sort_unstable();
            }
            let count = if c.neighbor_search == NeighborSearch::SpatialGrid {
                self.candidates.len()
            } else {
                self.state.len()
            };
            for candidate in 0..count {
                let j = if c.neighbor_search == NeighborSearch::SpatialGrid {
                    self.candidates[candidate]
                } else {
                    candidate
                };
                if i == j {
                    continue;
                }
                self.stats.candidate_pairs += 1;
                let other = self.state[j];
                let offset = bird.position - other.position;
                let distance2 = offset.length_squared();
                if let Some(settings) = c.avoidance {
                    let prediction = predict(
                        offset,
                        bird.velocity - other.velocity,
                        settings,
                        c.max_acceleration,
                    );
                    if prediction.acceleration > avoidance.acceleration {
                        avoidance = prediction;
                    }
                }
                if distance2 > perception2 {
                    continue;
                }
                if distance2 < separation2 {
                    separation += if distance2 > 1.0e-10 {
                        offset / distance2
                    } else {
                        Vec3::new(if i < j { -1.0 } else { 1.0 }, 0.0, 0.0)
                    };
                }
                let speed2 = bird.velocity.length_squared();
                let toward = -bird.velocity.dot(offset);
                if c.view_angle < 2.0 * PI
                    && speed2 > 1.0e-10
                    && toward < view_cosine * (speed2 * distance2).sqrt()
                {
                    continue;
                }
                if c.max_neighbors != 0 {
                    self.neighbors.push((distance2, j));
                } else {
                    neighbors += 1;
                    alignment += other.velocity;
                    center += other.position - bird.position;
                }
            }
            for obstacle in &self.obstacles {
                self.stats.obstacle_checks += 1;
                let offset = bird.position - obstacle.center;
                let clearance = obstacle.radius + c.obstacle_margin;
                let mut prediction = predict(
                    offset,
                    bird.velocity,
                    Avoidance {
                        lookahead: c.obstacle_lookahead,
                        clearance,
                    },
                    c.max_acceleration,
                );
                if offset.length_squared() < clearance * clearance
                    && offset.dot(bird.velocity) <= 0.0
                {
                    let distance = offset.length();
                    prediction = Prediction {
                        direction: if distance > 1.0e-6 {
                            offset / distance
                        } else {
                            Vec3::new(1.0, 0.0, 0.0)
                        },
                        acceleration: c.max_acceleration,
                    };
                }
                if prediction.acceleration > avoidance.acceleration {
                    avoidance = prediction;
                }
            }
            if c.max_neighbors != 0 {
                neighbors = c.max_neighbors.min(self.neighbors.len());
                let compare =
                    |a: &(f32, usize), b: &(f32, usize)| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1));
                if neighbors < self.neighbors.len() {
                    self.neighbors.select_nth_unstable_by(neighbors, compare);
                }
                self.neighbors[..neighbors].sort_unstable_by(compare);
                for &(_, index) in &self.neighbors[..neighbors] {
                    alignment += self.state[index].velocity;
                    center += self.state[index].position - bird.position;
                }
            }
            self.stats.social_neighbors += neighbors;
            let mut acceleration = accelerations.get(i).copied().unwrap_or_default();
            acceleration += steering(separation, bird.velocity, c) * c.separation_weight;
            if neighbors != 0 {
                let n = neighbors as f32;
                acceleration += steering(alignment / n, bird.velocity, c) * c.alignment_weight;
                acceleration += steering(center / n, bird.velocity, c) * c.cohesion_weight;
            }
            if let Some(altitude) = c.preferred_altitude {
                let response = c.altitude_response.as_secs_f32();
                acceleration.y += 4.0 * (altitude - bird.position.y) / (response * response)
                    - 4.0 * bird.velocity.y / response;
            }
            let boundary_position = if c.steering == Steering::ForwardFlight {
                bird.position + bird.velocity * (1.5 * c.max_speed / c.max_acceleration)
            } else {
                bird.position
            };
            let distance = boundary_position.length();
            let edge = c.world_radius * 0.75;
            if distance > edge {
                let fade = ((distance - edge) / (c.world_radius - edge)).min(1.0);
                acceleration += steering(boundary_position * -1.0, bird.velocity, c)
                    * (c.boundary_weight * fade);
            }
            if let Some(target) = self.target {
                let offset = target.position - bird.position;
                let fade = (1.0 - offset.length() / target.radius).max(0.0);
                let direction = if target.strength >= 0.0 {
                    offset
                } else {
                    offset * -1.0
                };
                acceleration +=
                    steering(direction, bird.velocity, c) * (target.strength.abs() * fade);
            }
            if avoidance.acceleration > 0.0 {
                self.stats.avoidance_corrections += 1;
                let mut direction = avoidance.direction;
                if c.steering == Steering::ForwardFlight && bird.velocity.length_squared() > 1.0e-12
                {
                    let forward = bird.velocity / bird.velocity.length();
                    direction = direction - forward * direction.dot(forward);
                    if direction.length_squared() < 1.0e-10 {
                        direction = Vec3::new(forward.z, 0.0, -forward.x);
                        if direction.length_squared() < 1.0e-8 {
                            direction = Vec3::new(forward.y, -forward.x, 0.0);
                        }
                    }
                    direction = direction / direction.length();
                }
                let mut remaining =
                    limited(acceleration, c.max_acceleration - avoidance.acceleration);
                let opposing = remaining.dot(direction);
                if opposing < 0.0 {
                    remaining = remaining - direction * opposing;
                }
                acceleration = direction * avoidance.acceleration + remaining;
            }
            acceleration = limited(acceleration, c.max_acceleration);
            let mut velocity = limited(bird.velocity + acceleration * dt, c.max_speed);
            if c.min_speed > 0.0 {
                velocity = speed_floor(
                    velocity,
                    bird.velocity,
                    c.min_speed,
                    c.max_acceleration * dt,
                );
            }
            self.next[i] = Boid {
                position: bird.position + velocity * dt,
                velocity,
            };
        }
        std::mem::swap(&mut self.state, &mut self.next);
        Ok(())
    }
}

// Fixed MT19937 and explicit float conversion match the C++ seeded reset.
struct Mt19937 {
    state: [u32; 624],
    index: usize,
}
impl Mt19937 {
    fn new(seed: u32) -> Self {
        let mut state = [0; 624];
        state[0] = seed;
        for i in 1..624 {
            state[i] = 1812433253_u32
                .wrapping_mul(state[i - 1] ^ (state[i - 1] >> 30))
                .wrapping_add(i as u32);
        }
        Self { state, index: 624 }
    }
    fn next(&mut self) -> u32 {
        if self.index == 624 {
            for i in 0..624 {
                let x = (self.state[i] & 0x80000000) | (self.state[(i + 1) % 624] & 0x7fffffff);
                self.state[i] = self.state[(i + 397) % 624]
                    ^ (x >> 1)
                    ^ if x & 1 != 0 { 0x9908b0df } else { 0 };
            }
            self.index = 0;
        }
        let mut y = self.state[self.index];
        self.index += 1;
        y ^= y >> 11;
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^ (y >> 18)
    }
    fn sample(&mut self) -> f32 {
        (self.next() >> 8) as f32 / 16777216.0 * 2.0 - 1.0
    }
}
