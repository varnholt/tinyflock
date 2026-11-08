#include <tinyflock/tinyflock.hpp>
#include <iomanip>
#include <iostream>
#include <vector>

// Numeric fixture stream shared with rust/examples/parity.rs and check-parity.mjs.
int main() {
    tinyflock::Config c;
    unsigned flight{}, altitude{}, prediction{}, grid{};
    float altitude_value{}, altitude_time{}, lookahead{}, clearance{}, obstacle_time{};
    if (!(std::cin >> c.perception_radius >> c.separation_radius >> c.max_speed >> c.min_speed >> c.max_acceleration
        >> c.separation_weight >> c.alignment_weight >> c.cohesion_weight >> c.world_radius >> c.boundary_weight
        >> flight >> c.view_angle >> c.max_neighbors >> altitude >> altitude_value >> altitude_time
        >> prediction >> lookahead >> clearance >> grid >> obstacle_time >> c.obstacle_margin)) return 1;
    c.steering = flight ? tinyflock::Steering::forward_flight : tinyflock::Steering::free;
    c.neighbor_search = grid ? tinyflock::NeighborSearch::spatial_grid : tinyflock::NeighborSearch::all_pairs;
    c.altitude_response = tinyflock::Seconds{altitude_time}; c.obstacle_lookahead = tinyflock::Seconds{obstacle_time};
    if (altitude) c.preferred_altitude = altitude_value;
    if (prediction) c.avoidance = tinyflock::Avoidance{tinyflock::Seconds{lookahead}, clearance};
    unsigned steps{}, reset_count{}, seed{}; float seconds{}; std::size_t count{};
    std::cin >> steps >> seconds >> reset_count >> seed >> count;
    std::vector<tinyflock::Boid> state(count);
    for (auto& b : state) std::cin >> b.position.x >> b.position.y >> b.position.z >> b.velocity.x >> b.velocity.y >> b.velocity.z;
    std::cin >> count; std::vector<tinyflock::SphereObstacle> obstacles(count);
    for (auto& o : obstacles) std::cin >> o.center.x >> o.center.y >> o.center.z >> o.radius;
    std::cin >> count; std::vector<tinyflock::Vec3> accelerations(count);
    for (auto& a : accelerations) std::cin >> a.x >> a.y >> a.z;
    unsigned target_enabled{}; tinyflock::Target target;
    std::cin >> target_enabled >> target.position.x >> target.position.y >> target.position.z >> target.radius >> target.strength;
    tinyflock::Simulation sim;
    if (!std::cin || !sim.configure(c) || !sim.set_obstacles(obstacles)) return 1;
    if (reset_count) sim.reset(reset_count, seed); else if (!sim.set_state(state)) return 1;
    if (target_enabled && !sim.set_target(target)) return 1;
    for (unsigned tick = 0; tick < steps; ++tick) if (!sim.step(tinyflock::Seconds{seconds}, accelerations)) return 1;
    std::cout << std::setprecision(9) << "{\"state\":[";
    bool first = true;
    for (const auto& b : sim.state()) for (const auto value : {b.position.x, b.position.y, b.position.z, b.velocity.x, b.velocity.y, b.velocity.z}) {
        if (!first) std::cout << ','; first = false; std::cout << value;
    }
    const auto stats = sim.stats();
    std::cout << "],\"stats\":[" << stats.candidate_pairs << ',' << stats.social_neighbors << ',' << stats.avoidance_corrections << ',' << stats.obstacle_checks << "]}\n";
}
