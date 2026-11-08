#include <tinyflock/tinyflock.hpp>

#include <array>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <utility>
#include <vector>

namespace {
void check(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(1);
    }
}
bool near(float a, float b) { return std::abs(a - b) < 1.0e-4F; }
} // namespace

float header_consumer_length();

int main() {
    check(near(header_consumer_length(), 5), "header links across multiple translation units");
    using namespace std::chrono_literals;
    tinyflock::Simulation flock;
    check(flock.step(16ms).has_value(), "empty flock steps");
    flock.reset(1);
    check(flock.step(16ms).has_value(), "single bird steps");
    check(std::isfinite(flock.state()[0].position.x), "single bird remains finite");

    const auto previous = flock.state()[0];
    check(!flock.step(-1ms), "negative timestep rejected");
    check(!flock.step(101ms), "oversized timestep rejected");
    check(!flock.step(tinyflock::Seconds{std::numeric_limits<float>::quiet_NaN()}), "NaN timestep rejected");
    check(flock.step(0ms).has_value(), "zero timestep accepted");
    check(flock.state()[0] == previous, "invalid and zero steps preserve state");

    auto config = flock.config();
    config.separation_radius = config.perception_radius + 1;
    check(!flock.configure(config), "inconsistent radii rejected");
    check(flock.config().separation_radius == 4.0F, "invalid config preserves previous config");
    config = flock.config();
    config.max_speed = std::numeric_limits<float>::infinity();
    check(!flock.configure(config), "infinite configuration rejected");
    const std::array invalid{tinyflock::Boid{{std::numeric_limits<float>::quiet_NaN(), 0, 0}, {}}};
    check(!flock.set_state(invalid), "invalid initial state rejected");
    check(flock.state()[0] == previous, "invalid initial state preserves state");
    check(!flock.set_target(tinyflock::Target{{}, -1, 1}), "invalid target rejected");
    check(flock.set_state(flock.state()).has_value(), "state may alias existing state");

    // An isolated bird with no forces integrates in seconds, not milliseconds.
    const std::array isolated{tinyflock::Boid{{}, {2, 0, 0}}};
    check(flock.set_state(isolated).has_value(), "set isolated state");
    check(flock.step(50ms).has_value(), "chrono milliseconds accepted");
    check(near(flock.state()[0].position.x, 0.1F), "time units are seconds");

    config = flock.config();
    config.alignment_weight = 0;
    config.cohesion_weight = 0;
    config.boundary_weight = 0;
    check(flock.configure(config).has_value(), "separation-only configuration");
    const std::array pair{tinyflock::Boid{{-0.5F, 0, 0}, {}}, tinyflock::Boid{{0.5F, 0, 0}, {}}};
    check(flock.set_state(pair).has_value(), "set pair");
    check(flock.step(16ms).has_value(), "step pair");
    check(flock.state()[0].velocity.x < 0 && flock.state()[1].velocity.x > 0,
          "nearby birds separate symmetrically");

    const std::array overlapping{tinyflock::Boid{{}, {}}, tinyflock::Boid{{}, {}}};
    check(flock.set_state(overlapping).has_value(), "set overlapping pair");
    check(flock.step(16ms).has_value(), "step overlapping pair");
    check(flock.state()[0].velocity.x < 0 && flock.state()[1].velocity.x > 0,
          "overlapping birds separate without NaN");

    check(flock.set_state(std::array{tinyflock::Boid{{}, {}}}).has_value(), "target initial state");
    check(flock.set_target(tinyflock::Target{{10, 0, 0}, 40, 2}).has_value(), "set attractor");
    check(flock.step(16ms).has_value(), "step attraction");
    check(flock.state()[0].velocity.x > 0, "positive strength attracts");
    check(flock.set_state(std::array{tinyflock::Boid{{}, {}}}).has_value(), "repulsion initial state");
    check(flock.set_target(tinyflock::Target{{10, 0, 0}, 40, -2}).has_value(), "set repulsor");
    check(flock.step(16ms).has_value(), "step repulsion");
    check(flock.state()[0].velocity.x < 0, "negative strength repels");

    tinyflock::Simulation boundaries;
    const std::array outside{tinyflock::Boid{{60, 0, 0}, {}}};
    check(boundaries.set_state(outside).has_value(), "set bird outside boundary");
    check(boundaries.step(16ms).has_value(), "step boundary steering");
    check(boundaries.state()[0].velocity.x < 0, "soft boundary steers inward");
    const std::array distant{tinyflock::Boid{{-20, 0, 0}, {}}, tinyflock::Boid{{20, 0, 0}, {}}};
    check(boundaries.set_state(distant).has_value(), "set distant pair");
    check(boundaries.step(16ms).has_value(), "step distant pair");
    check(boundaries.state()[0] == distant[0] && boundaries.state()[1] == distant[1],
          "birds outside perception radius do not influence each other");

    tinyflock::Simulation a, b;
    a.reset(96, 123);
    b.reset(96, 123);
    for (int tick = 0; tick < 1200; ++tick) {
        const auto before = std::vector(a.state().begin(), a.state().end());
        check(a.step(1s / 60.0F).has_value() && b.step(1s / 60.0F).has_value(), "long simulation steps");
        for (std::size_t i = 0; i < a.state().size(); ++i) {
            const auto& boid = a.state()[i];
            check(boid == b.state()[i], "same seed and timesteps repeat in this build");
            check(std::isfinite(tinyflock::length(boid.position)), "long simulation remains finite");
            check(tinyflock::length(boid.velocity) <= a.config().max_speed + 1.0e-4F, "speed bounded");
            check(tinyflock::length(boid.velocity - before[i].velocity) <=
                  a.config().max_acceleration / 60.0F + 1.0e-4F, "acceleration bounded");
        }
    }

    // A permutation of non-overlapping input must just permute the result.
    const std::array initial{tinyflock::Boid{{-2, 0, 0}, {1, 0, 0}},
                             tinyflock::Boid{{2, 1, 0}, {0, 0, 1}},
                             tinyflock::Boid{{0, -1, 2}, {0, 1, 0}}};
    auto reversed = initial;
    std::swap(reversed.front(), reversed.back());
    check(a.set_state(initial).has_value() && b.set_state(reversed).has_value(), "set permuted states");
    check(a.step(16ms).has_value() && b.step(16ms).has_value(), "step permuted states");
    for (std::size_t i = 0; i < initial.size(); ++i) {
        const auto& left = a.state()[i];
        const auto& right = b.state()[initial.size() - 1 - i];
        check(tinyflock::length(left.position - right.position) < 1.0e-4F &&
              tinyflock::length(left.velocity - right.velocity) < 1.0e-4F, "updates use previous state");
    }
    tinyflock::Simulation flight;
    auto flight_config = flight.config();
    flight_config.max_speed = 8;
    flight_config.min_speed = 6;
    flight_config.max_acceleration = 2;
    flight_config.steering = tinyflock::Steering::forward_flight;
    flight_config.view_angle = std::numbers::pi_v<float> * 1.5F;
    flight_config.max_neighbors = 7;
    flight_config.preferred_altitude = 0.0F;
    flight_config.altitude_response = 10s;
    flight_config.avoidance = tinyflock::Avoidance{.lookahead = 4s, .clearance = 2};
    check(flight.configure(flight_config).has_value(), "forward-flight envelope accepted");
    flight_config.min_speed = 9;
    check(!flight.configure(flight_config), "minimum cannot exceed maximum speed");
    flight_config.min_speed = -1;
    check(!flight.configure(flight_config), "negative minimum speed rejected");
    flight.reset(32, 71);
    for (int tick = 0; tick < 1800; ++tick) {
        const auto before = std::vector(flight.state().begin(), flight.state().end());
        if (tick % 120 == 0) check(flight.set_target(tinyflock::Target{{tick % 240 == 0 ? 40.0F : -40.0F, 0, 0}, 100, 3}).has_value(), "change flight goal");
        check(flight.step(1s / 60.0F).has_value(), "forward-flight step");
        for (std::size_t i = 0; i < before.size(); ++i) {
            const auto speed = tinyflock::length(flight.state()[i].velocity);
            check(speed >= 6 - 1.0e-4F && speed <= 8 + 1.0e-4F, "airborne birds retain forward speed");
            check(tinyflock::length(flight.state()[i].velocity - before[i].velocity) <= 2.0F / 60 + 1.0e-4F,
                  "speed floor does not introduce acceleration jumps");
        }
    }
    check(flight.set_state(std::array{tinyflock::Boid{{}, {}}}).has_value(), "start flight from rest");
    check(flight.set_target(std::nullopt).has_value(), "clear goal at rest");
    check(flight.step(1s / 60.0F).has_value(), "accelerate from rest");
    check(tinyflock::length(flight.state()[0].velocity) <= 2.0F / 60 + 1.0e-4F,
          "configuring a speed floor does not teleport a stationary bird to cruising speed");
    tinyflock::Simulation social;
    tinyflock::Config social_config;
    social_config.separation_weight = 0;
    social_config.alignment_weight = 0;
    social_config.cohesion_weight = 1;
    social_config.boundary_weight = 0;
    social_config.view_angle = std::numbers::pi_v<float>;
    check(social.configure(social_config).has_value(), "view cone accepted");
    const std::array rear{tinyflock::Boid{{}, {1, 0, 0}}, tinyflock::Boid{{-2, 0, 0}, {1, 0, 0}}};
    check(social.set_state(rear).has_value() && social.step(16ms).has_value(), "blind rear neighbor step");
    check(social.state()[0].velocity == rear[0].velocity, "rear neighbor does not affect social steering");
    social_config.separation_weight = 1;
    check(social.configure(social_config).has_value() && social.set_state(rear).has_value() && social.step(16ms).has_value(), "rear spacing step");
    check(social.state()[0].velocity.x > 1, "rear blind spot does not disable collision spacing");
    social_config.separation_weight = 0;
    social_config.max_neighbors = 1;
    social_config.view_angle = 2 * std::numbers::pi_v<float>;
    const std::array nearest{tinyflock::Boid{{}, {1, 0, 0}}, tinyflock::Boid{{0, 0, 2}, {}}, tinyflock::Boid{{0, 0, -5}, {}}};
    check(social.configure(social_config).has_value() && social.set_state(nearest).has_value() && social.step(16ms).has_value(), "nearest neighbor step");
    check(social.state()[0].velocity.z > 0, "nearest neighbor wins over opposing distant neighbor");
    social_config.view_angle = 0;
    check(!social.configure(social_config), "empty view cone rejected");
    social_config = social.config();
    social_config.preferred_altitude = 0.0F;
    social_config.altitude_response = 0ms;
    check(!social.configure(social_config), "zero altitude response rejected");
    social_config.altitude_response = 4s;
    check(social.configure(social_config).has_value(), "chrono altitude response accepted");
    check(social.set_state(std::array{tinyflock::Boid{{0, 10, 0}, {1, 0, 0}}}).has_value(), "set elevated bird");
    for (int tick = 0; tick < 1200; ++tick) check(social.step(1s / 60.0F).has_value(), "altitude recovery step");
    check(std::abs(social.state()[0].position.y) < .02F && std::abs(social.state()[0].velocity.y) < .01F,
        "altitude spring settles without persistent vertical oscillation");
    tinyflock::Config avoidance_config;
    avoidance_config.perception_radius = 8;
    avoidance_config.separation_radius = 2;
    avoidance_config.separation_weight = 0;
    avoidance_config.alignment_weight = 0;
    avoidance_config.cohesion_weight = 0;
    avoidance_config.boundary_weight = 0;
    avoidance_config.max_speed = 8;
    avoidance_config.min_speed = 6;
    avoidance_config.max_acceleration = 2;
    avoidance_config.steering = tinyflock::Steering::forward_flight;
    avoidance_config.avoidance = tinyflock::Avoidance{.lookahead = 6s, .clearance = 2};
    const auto encounter = [&](std::array<tinyflock::Boid, 2> initial_state, bool enabled) {
        tinyflock::Simulation test;
        auto preset = avoidance_config;
        if (!enabled) preset.avoidance.reset();
        check(test.configure(preset).has_value() && test.set_state(initial_state).has_value(), "set encounter scenario");
        auto minimum = tinyflock::length(initial_state[0].position - initial_state[1].position);
        for (int tick = 0; tick < 600; ++tick) {
            const auto before = std::array{test.state()[0], test.state()[1]};
            check(test.step(1s / 60.0F).has_value(), "predictive avoidance step");
            minimum = std::min(minimum, tinyflock::length(test.state()[0].position - test.state()[1].position));
            for (std::size_t i = 0; i < before.size(); ++i) {
                check(tinyflock::length(test.state()[i].velocity - before[i].velocity) < 2.0F / 60 + 1.0e-4F,
                    "predictive avoidance respects acceleration budget");
                const auto speed = tinyflock::length(test.state()[i].velocity);
                check(speed >= 6 - 1.0e-4F && speed <= 8 + 1.0e-4F, "avoidance preserves forward-flight speed");
            }
        }
        return minimum;
    };
    const std::array head_on{tinyflock::Boid{{-12, 0, 0}, {7, 0, 0}}, tinyflock::Boid{{12, 0, 0}, {-7, 0, 0}}};
    const std::array crossing{tinyflock::Boid{{-12, 0, 0}, {7, 0, 0}}, tinyflock::Boid{{0, 0, -12}, {0, 0, 7}}};
    const std::array overtaking{tinyflock::Boid{{-10, 0, 0}, {8, 0, 0}}, tinyflock::Boid{{0, 0, 0}, {6, 0, 0}}};
    const std::array vertical{tinyflock::Boid{{0, -12, 0}, {0, 7, 0}}, tinyflock::Boid{{0, 12, 0}, {0, -7, 0}}};
    for (const auto& scenario : {head_on, crossing, overtaking, vertical}) {
        const auto uncorrected = encounter(scenario, false), corrected = encounter(scenario, true);
        std::cout << "Encounter minimum clearance: " << uncorrected << " -> " << corrected << '\n';
        check(uncorrected < .15F && corrected > 1.9F, "predictive steering clears a collision course");
    }
    tinyflock::Simulation predictive;
    check(predictive.configure(avoidance_config).has_value() && predictive.set_state(head_on).has_value(), "set remote head-on pair");
    check(predictive.step(16ms).has_value(), "predict beyond social perception");
    check(std::abs(predictive.state()[0].velocity.z) > .001F && predictive.state()[0].velocity.z * predictive.state()[1].velocity.z < 0,
        "remote head-on pair chooses opposite lateral directions before reaching perception radius");
    const auto early_avoidance = predictive.state()[0].velocity.z;
    check(predictive.set_state(head_on).has_value() && predictive.set_target(tinyflock::Target{{0, 0, 100}, 1000, 1000}).has_value(), "goal opposing early avoidance");
    check(predictive.step(16ms).has_value() && predictive.state()[0].velocity.z <= early_avoidance + 1.0e-6F,
        "goals cannot cancel even a partial-budget avoidance correction");
    check(predictive.set_target(std::nullopt).has_value(), "clear opposing goal");
    const std::array urgent{tinyflock::Boid{{-5, 0, 0}, {7, 0, 0}}, tinyflock::Boid{{5, 0, 0}, {-7, 0, 0}}};
    check(predictive.set_state(urgent).has_value() && predictive.step(16ms).has_value(), "urgent prediction step");
    const auto urgent_result = predictive.state()[0];
    auto competing = avoidance_config;
    competing.cohesion_weight = 1000;
    check(predictive.configure(competing).has_value() && predictive.set_state(urgent).has_value(), "set competing social force");
    check(predictive.set_target(tinyflock::Target{{100, 0, 0}, 1000, 1000}).has_value() && predictive.step(16ms).has_value(), "competing goal step");
    check(predictive.state()[0] == urgent_result, "full-budget avoidance cannot be canceled by cohesion or goals");
    check(predictive.configure(avoidance_config).has_value() && predictive.set_target(std::nullopt).has_value(), "restore isolated avoidance");
    const std::array parallel{tinyflock::Boid{{}, {7, 0, 0}}, tinyflock::Boid{{1, 0, 0}, {7, 0, 0}}};
    const std::array receding{tinyflock::Boid{{-1, 0, 0}, {-7, 0, 0}}, tinyflock::Boid{{1, 0, 0}, {7, 0, 0}}};
    const std::array safe_crossing{tinyflock::Boid{{-12, 0, 0}, {7, 0, 0}}, tinyflock::Boid{{0, 5, -12}, {0, 0, 7}}};
    const std::array beyond_horizon{tinyflock::Boid{{-100, 0, 0}, {7, 0, 0}}, tinyflock::Boid{{100, 0, 0}, {-7, 0, 0}}};
    for (const auto& scenario : {parallel, receding, safe_crossing, beyond_horizon}) {
        check(predictive.set_state(scenario).has_value() && predictive.step(16ms).has_value(), "safe encounter step");
        check(predictive.state()[0].velocity == scenario[0].velocity && predictive.state()[1].velocity == scenario[1].velocity,
            "safe, parallel and receding paths do not trigger avoidance");
    }
    auto invalid_avoidance = avoidance_config;
    invalid_avoidance.avoidance->lookahead = 0ms;
    check(!predictive.configure(invalid_avoidance), "zero prediction horizon rejected");
    invalid_avoidance = avoidance_config;
    invalid_avoidance.avoidance->clearance = std::numeric_limits<float>::quiet_NaN();
    check(!predictive.configure(invalid_avoidance), "nonfinite clearance rejected");
    check(predictive.config().avoidance->lookahead == 6s && predictive.config().avoidance->clearance == 2,
        "invalid avoidance preserves the configured policy");
    std::cout << "All simulation checks passed\n";
}
