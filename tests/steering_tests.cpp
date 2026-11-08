#include <tinyflock/tinyflock.hpp>
#include <array>
#include <cstdlib>
#include <iostream>
#include <limits>

namespace {
void check(bool condition, const char* message) {
    if (!condition) { std::cerr << "FAIL: " << message << '\n'; std::exit(1); }
}
bool near(float a, float b) { return std::abs(a - b) < 1.0e-4F; }
tinyflock::Config isolated() {
    tinyflock::Config config;
    config.separation_weight = config.alignment_weight = config.cohesion_weight = config.boundary_weight = 0;
    config.max_speed = 20;
    config.max_acceleration = 4;
    return config;
}
}

int main() {
    using namespace std::chrono_literals;
    using tinyflock::Boid;
    using tinyflock::Vec3;
    tinyflock::Simulation input;
    check(input.configure(isolated()).has_value(), "configure external input scenario");
    check(input.set_state(std::array{Boid{{-10, 0, 0}, {1, 0, 0}}, Boid{{10, 0, 0}, {0, 0, 2}}}).has_value(), "set input state");
    const std::array forces{Vec3{0, 2, 0}, Vec3{-3, 0, 0}};
    check(input.step(100ms, forces).has_value(), "per-agent accelerations accepted");
    check(near(input.state()[0].velocity.y, .2F) && near(input.state()[1].velocity.x, -.3F), "inputs applied to the correct agents");
    const auto before = std::vector(input.state().begin(), input.state().end());
    check(input.step(100ms).has_value(), "unforced step accepted");
    check(input.state()[0].velocity == before[0].velocity && input.state()[1].velocity == before[1].velocity, "accelerations last only one step");
    const auto state = std::vector(input.state().begin(), input.state().end());
    const auto stats = input.stats();
    check(!input.step(16ms, std::array{Vec3{}}), "mismatched input size rejected");
    check(!input.step(16ms, std::array{Vec3{std::numeric_limits<float>::infinity(), 0, 0}, Vec3{}}), "nonfinite acceleration rejected");
    check(!input.step(0ms, std::array{Vec3{1.0e7F, 0, 0}, Vec3{}}), "invalid acceleration rejected even for zero time");
    check(std::ranges::equal(input.state(), state) && input.stats() == stats, "invalid inputs preserve state and diagnostics");
    check(input.step(100ms, std::array{Vec3{1000, 1000, 1000}, Vec3{-1000, 0, 0}}).has_value(), "large finite inputs accepted");
    for (std::size_t i = 0; i < state.size(); ++i)
        check(tinyflock::length(input.state()[i].velocity - state[i].velocity) <= .4001F, "external acceleration shares the budget");

    tinyflock::Simulation obstacles;
    auto obstacle_config = isolated();
    obstacle_config.min_speed = 6; obstacle_config.max_speed = 8; obstacle_config.max_acceleration = 2;
    obstacle_config.steering = tinyflock::Steering::forward_flight;
    obstacle_config.obstacle_lookahead = 6s;
    check(obstacles.configure(obstacle_config).has_value(), "configure obstacle avoidance without bird prediction");
    const std::array spheres{tinyflock::SphereObstacle{{}, 3}};
    check(obstacles.set_obstacles(spheres).has_value(), "set obstacle geometry");
    check(obstacles.set_obstacles(obstacles.obstacles()).has_value(), "obstacle input may alias current geometry");
    check(!obstacles.set_obstacles(std::array{tinyflock::SphereObstacle{{}, -1}}), "negative obstacle radius rejected");
    check(obstacles.obstacles()[0] == spheres[0], "invalid obstacles preserve geometry");
    check(obstacles.set_state(std::array{Boid{{-35, 0, 0}, {7, 0, 0}}}).has_value(), "approach solid sphere");
    float minimum = 35;
    for (int tick = 0; tick < 600; ++tick) {
        const auto velocity = obstacles.state()[0].velocity;
        // A strong caller input toward the obstacle cannot erase avoidance.
        const auto force = Vec3{0, 0, 10};
        check(obstacles.step(1s / 60.0F, std::span{&force, 1}).has_value(), "obstacle course step");
        minimum = std::min(minimum, tinyflock::length(obstacles.state()[0].position));
        check(tinyflock::length(obstacles.state()[0].velocity - velocity) <= 2.0F / 60 + 1.0e-4F, "obstacle avoidance obeys acceleration cap");
    }
    check(minimum > 3.9F, "predictive sphere avoidance keeps radius plus margin");
    check(obstacles.stats().obstacle_checks == 1, "obstacle diagnostics count checks");
    obstacles.reset(1);
    check(obstacles.obstacles().size() == 1, "reset preserves caller-supplied environment");
    obstacle_config.steering = tinyflock::Steering::free; obstacle_config.min_speed = 0;
    check(obstacles.configure(obstacle_config).has_value() && obstacles.set_state(std::array{Boid{{}, {}}}).has_value(), "start stationary inside sphere");
    check(obstacles.step(16ms).has_value() && obstacles.state()[0].velocity.x > 0, "center penetration recovers without NaNs");
    check(obstacles.set_obstacles({}).has_value() && obstacles.obstacles().empty(), "clear obstacles");

    for (const bool prediction : {false, true}) for (const std::size_t limit : {std::size_t{0}, std::size_t{7}}) {
        auto reference_config = obstacle_config;
        reference_config.world_radius = 2000;
        reference_config.max_neighbors = limit;
        reference_config.view_angle = std::numbers::pi_v<float> * 1.5F;
        reference_config.separation_weight = 1.5F; reference_config.alignment_weight = .8F; reference_config.cohesion_weight = .4F;
        reference_config.preferred_altitude = 0.0F;
        if (prediction) reference_config.avoidance = tinyflock::Avoidance{3s, 2};
        auto grid_config = reference_config; grid_config.neighbor_search = tinyflock::NeighborSearch::spatial_grid;
        tinyflock::Simulation reference, grid;
        check(reference.configure(reference_config).has_value() && grid.configure(grid_config).has_value(), "configure reference/grid pair");
        reference.reset(192, 17); grid.reset(192, 17);
        check(reference.set_obstacles(spheres).has_value() && grid.set_obstacles(spheres).has_value(), "set matching environments");
        std::vector<Vec3> accelerations(192);
        for (std::size_t i = 0; i < accelerations.size(); ++i) accelerations[i] = {.1F, 0, i % 2 ? .1F : -.1F};
        for (int tick = 0; tick < 60; ++tick) {
            check(reference.step(1s / 60.0F, accelerations).has_value() && grid.step(1s / 60.0F, accelerations).has_value(), "reference/grid step");
            check(std::ranges::equal(reference.state(), grid.state()), "grid preserves exact reference trajectories");
            check(reference.stats().social_neighbors == grid.stats().social_neighbors && reference.stats().avoidance_corrections == grid.stats().avoidance_corrections,
                "grid preserves neighbor and avoidance choices");
        }
        check(grid.stats().candidate_pairs < reference.stats().candidate_pairs / 4, "sparse world grid reduces pair checks");
    }
    tinyflock::Simulation sparse;
    auto grid_config = isolated(); grid_config.neighbor_search = tinyflock::NeighborSearch::spatial_grid;
    check(sparse.configure(grid_config).has_value(), "configure sparse grid");
    std::vector<Boid> line(4096);
    for (std::size_t i = 0; i < line.size(); ++i) line[i].position.x = (static_cast<float>(i) - 2048) * 50;
    check(sparse.set_state(line).has_value() && sparse.step(16ms).has_value(), "large sparse flock step");
    check(sparse.stats().candidate_pairs == 0, "distant cells do not trigger quadratic pair checks");
    grid_config.neighbor_search = static_cast<tinyflock::NeighborSearch>(99);
    check(!sparse.configure(grid_config), "invalid search mode rejected");
    grid_config = sparse.config(); grid_config.obstacle_lookahead = 0ms;
    check(!sparse.configure(grid_config), "invalid obstacle horizon rejected");

    // Search bounds must use actual velocities, including after lowering a cap.
    tinyflock::Simulation fast_reference, fast_grid;
    auto fast_config = isolated(); fast_config.avoidance = tinyflock::Avoidance{3s, 2};
    check(fast_reference.configure(fast_config).has_value(), "configure fast reference");
    fast_config.neighbor_search = tinyflock::NeighborSearch::spatial_grid;
    check(fast_grid.configure(fast_config).has_value(), "configure fast grid");
    const std::array fast_pair{Boid{{-100, 0, 0}, {100, 0, 0}}, Boid{{100, 0, 0}, {-100, 0, 0}}};
    check(fast_reference.set_state(fast_pair).has_value() && fast_grid.set_state(fast_pair).has_value(), "set over-cap velocities");
    check(fast_reference.step(16ms).has_value() && fast_grid.step(16ms).has_value() &&
        std::ranges::equal(fast_reference.state(), fast_grid.state()), "grid prediction bounds include over-cap velocities");
    check(fast_grid.stats().avoidance_corrections == 2, "long-range high-speed threats are not dropped");
    std::cout << "External inputs, obstacles and spatial reference checks passed\n";
}
