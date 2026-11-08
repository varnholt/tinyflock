#include <tinyflock/tinyflock.hpp>
#include <array>
#include <chrono>
#include <iostream>
#include <vector>

int main() {
    using namespace std::chrono_literals;
    tinyflock::Simulation flock;
    tinyflock::Config config{
        .max_speed = 8, .min_speed = 6, .max_acceleration = 2,
        .steering = tinyflock::Steering::forward_flight,
        .preferred_altitude = 0.0F,
        .avoidance = tinyflock::Avoidance{4s, 2.5F},
        .neighbor_search = tinyflock::NeighborSearch::spatial_grid,
    };
    if (!flock.configure(config)) return 1;
    const std::array obstacles{tinyflock::SphereObstacle{{0, 0, 0}, 4}};
    if (!flock.set_obstacles(obstacles)) return 1;
    flock.reset(64, 42);
    std::vector<tinyflock::Vec3> accelerations(flock.state().size());
    constexpr auto timestep = 1s / 60.0F;
    for (int tick = 0; tick < 600; ++tick) {
        const auto time = static_cast<float>(tick) * timestep.count();
        // The caller owns routes and environmental fields; no renderer is needed.
        const tinyflock::Vec3 waypoint{30 * std::cos(time * .1F), 0, 30 * std::sin(time * .1F)};
        if (!flock.set_target(tinyflock::Target{waypoint, 150, .4F})) return 1;
        for (std::size_t i = 0; i < accelerations.size(); ++i)
            accelerations[i] = {.05F * std::sin(time + static_cast<float>(i)), 0, .03F};
        if (!flock.step(timestep, accelerations)) return 1;
    }
    std::cout << "64 agents; " << flock.stats().candidate_pairs << " candidate pairs in the last step\n";
}
