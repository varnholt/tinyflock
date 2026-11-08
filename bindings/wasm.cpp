#include <tinyflock/tinyflock.hpp>
#include <emscripten/bind.h>
#include <algorithm>
#include <vector>
#include <array>
#include <string>

namespace {
class BrowserSimulation {
public:
    BrowserSimulation() { restore_defaults(); reset(96, 42); }

    void restore_defaults() {
        // Demo preset: more spacing and weaker cohesion for a loose gull flock.
        (void)simulation_.configure({.perception_radius = 16.0F, .separation_radius = 5.5F,
            .max_speed = 8.0F, .min_speed = 6.0F, .max_acceleration = 2.0F,
            .separation_weight = 1.8F, .alignment_weight = 0.8F, .cohesion_weight = 0.4F,
            .boundary_weight = 5.0F,
            .steering = tinyflock::Steering::forward_flight,
            .view_angle = std::numbers::pi_v<float> * 1.5F, .max_neighbors = 7,
            .preferred_altitude = 0.0F, .altitude_response = tinyflock::Seconds{10},
            .avoidance = tinyflock::Avoidance{.lookahead = tinyflock::Seconds{4}, .clearance = 2.5F},
            .neighbor_search = tinyflock::NeighborSearch::spatial_grid});
        (void)simulation_.set_obstacles({});
        (void)simulation_.set_target(std::nullopt);
        external_acceleration_ = {};
        std::ranges::fill(forces_, external_acceleration_);
        pointer_radius_ = 70;
        pointer_strength_ = 2;
        avoidance_knobs_ = {tinyflock::Seconds{4}, 2.5F};
        altitude_knob_ = 0;
    }

    void reset(unsigned count, unsigned seed) {
        // Bound browser allocations and the reference algorithm's quadratic work.
        simulation_.reset(std::min(count, 2048U), seed);
        auto state = std::vector<tinyflock::Boid>(simulation_.state().begin(), simulation_.state().end());
        for (auto& bird : state) {
            // Begin as a travelling flock, rather than 96 conflicting headings.
            const auto direction = tinyflock::Vec3{1.0F + bird.velocity.x * 0.012F,
                bird.velocity.y * 0.012F, 0.35F + bird.velocity.z * 0.012F};
            const auto speed = std::clamp(7.0F, simulation_.config().min_speed, simulation_.config().max_speed);
            bird.velocity = direction / tinyflock::length(direction) * speed;
        }
        (void)simulation_.set_state(state);
        buffer_.resize(simulation_.state().size() * 6);
        forces_.assign(simulation_.state().size(), external_acceleration_);
    }
    bool step(float seconds) {
        return simulation_.step(tinyflock::Seconds{seconds}, external_acceleration_ == tinyflock::Vec3{} ?
            std::span<const tinyflock::Vec3>{} : std::span<const tinyflock::Vec3>{forces_}).has_value();
    }
    bool target(float x, float y, float z, float strength) {
        return simulation_.set_target(tinyflock::Target{{x, y, z}, pointer_radius_, strength}).has_value();
    }
    void clear_target() { (void)simulation_.set_target(std::nullopt); }
    bool weights(float separation, float alignment, float cohesion) {
        auto config = simulation_.config();
        config.separation_weight = separation;
        config.alignment_weight = alignment;
        config.cohesion_weight = cohesion;
        return simulation_.configure(config).has_value();
    }
    emscripten::val settings() const {
        auto result = emscripten::val::object();
        const auto& c = simulation_.config();
        result.set("perception", c.perception_radius); result.set("spacing", c.separation_radius);
        result.set("minSpeed", c.min_speed); result.set("maxSpeed", c.max_speed);
        result.set("acceleration", c.max_acceleration); result.set("viewAngle", c.view_angle / std::numbers::pi_v<float> * 180);
        result.set("neighbors", c.max_neighbors); result.set("worldRadius", c.world_radius);
        result.set("boundary", c.boundary_weight); result.set("altitudeEnabled", c.preferred_altitude.has_value());
        result.set("altitude", c.preferred_altitude.value_or(altitude_knob_)); result.set("altitudeResponse", c.altitude_response.count());
        result.set("avoidanceEnabled", c.avoidance.has_value());
        result.set("lookahead", avoidance_knobs_.lookahead.count());
        result.set("clearance", avoidance_knobs_.clearance);
        result.set("forwardFlight", c.steering == tinyflock::Steering::forward_flight);
        result.set("spatialGrid", c.neighbor_search == tinyflock::NeighborSearch::spatial_grid);
        result.set("obstaclesEnabled", !simulation_.obstacles().empty());
        result.set("obstacleLookahead", c.obstacle_lookahead.count()); result.set("obstacleMargin", c.obstacle_margin);
        result.set("forceX", external_acceleration_.x); result.set("forceY", external_acceleration_.y); result.set("forceZ", external_acceleration_.z);
        result.set("pointerRadius", pointer_radius_); result.set("pointerStrength", pointer_strength_);
        return result;
    }
    bool configure(const emscripten::val& input) {
        if (input.isNull() || input.isUndefined() || input.typeOf().as<std::string>() != "object") return false;
        auto c = simulation_.config();
        auto force = external_acceleration_;
        float angle{}, neighbors{}, altitude{}, lookahead{}, clearance{}, response{}, obstacle_time{}, pointer_radius{}, pointer_strength{};
        const std::pair<const char*, float*> numbers[] = {
            {"perception", &c.perception_radius}, {"spacing", &c.separation_radius}, {"minSpeed", &c.min_speed},
            {"maxSpeed", &c.max_speed}, {"acceleration", &c.max_acceleration}, {"worldRadius", &c.world_radius},
            {"boundary", &c.boundary_weight}, {"viewAngle", &angle}, {"neighbors", &neighbors},
            {"altitude", &altitude}, {"altitudeResponse", &response}, {"lookahead", &lookahead}, {"clearance", &clearance},
            {"obstacleLookahead", &obstacle_time}, {"obstacleMargin", &c.obstacle_margin},
            {"forceX", &force.x}, {"forceY", &force.y}, {"forceZ", &force.z},
            {"pointerRadius", &pointer_radius}, {"pointerStrength", &pointer_strength}};
        for (const auto& [name, value] : numbers) {
            if (input[name].typeOf().as<std::string>() != "number") return false;
            *value = input[name].as<float>();
            if (!std::isfinite(*value)) return false;
        }
        for (const auto* name : {"altitudeEnabled", "avoidanceEnabled", "forwardFlight", "spatialGrid", "obstaclesEnabled"})
            if (input[name].typeOf().as<std::string>() != "boolean") return false;
        if (neighbors < 0 || neighbors > 2048 || std::floor(neighbors) != neighbors ||
            std::abs(altitude) > 1.0e9F || response < .1F || response > 3600 || lookahead < .01F || lookahead > 60 ||
            clearance < .0001F || clearance > 1.0e6F || pointer_radius < .0001F || pointer_radius > 1.0e6F ||
            pointer_strength < 0 || pointer_strength > 1000 || std::abs(force.x) > 1.0e6F ||
            std::abs(force.y) > 1.0e6F || std::abs(force.z) > 1.0e6F) return false;
        c.view_angle = angle / 180 * std::numbers::pi_v<float>;
        c.max_neighbors = static_cast<std::size_t>(neighbors);
        c.preferred_altitude = input["altitudeEnabled"].as<bool>() ? std::optional{altitude} : std::nullopt;
        c.altitude_response = tinyflock::Seconds{response};
        c.avoidance = input["avoidanceEnabled"].as<bool>() ? std::optional{tinyflock::Avoidance{tinyflock::Seconds{lookahead}, clearance}} : std::nullopt;
        c.steering = input["forwardFlight"].as<bool>() ? tinyflock::Steering::forward_flight : tinyflock::Steering::free;
        c.neighbor_search = input["spatialGrid"].as<bool>() ? tinyflock::NeighborSearch::spatial_grid : tinyflock::NeighborSearch::all_pairs;
        c.obstacle_lookahead = tinyflock::Seconds{obstacle_time};
        auto candidate = simulation_;
        if (!candidate.configure(c)) return false;
        const std::array course{tinyflock::SphereObstacle{{18, 0, 6}, 8}, tinyflock::SphereObstacle{{-20, 2, -12}, 6}};
        if (!candidate.set_obstacles(input["obstaclesEnabled"].as<bool>() ? std::span<const tinyflock::SphereObstacle>{course} : std::span<const tinyflock::SphereObstacle>{})) return false;
        simulation_ = std::move(candidate);
        external_acceleration_ = force;
        std::ranges::fill(forces_, force);
        pointer_radius_ = pointer_radius;
        pointer_strength_ = pointer_strength;
        avoidance_knobs_ = {tinyflock::Seconds{lookahead}, clearance};
        altitude_knob_ = altitude;
        return true;
    }
    emscripten::val obstacles() const {
        auto result = emscripten::val::array();
        for (const auto& obstacle : simulation_.obstacles()) {
            auto value = emscripten::val::object();
            value.set("x", obstacle.center.x); value.set("y", obstacle.center.y); value.set("z", obstacle.center.z);
            value.set("radius", obstacle.radius);
            result.call<void>("push", value);
        }
        return result;
    }
    emscripten::val stats() const {
        auto result = emscripten::val::object(); const auto stats = simulation_.stats();
        result.set("candidatePairs", stats.candidate_pairs); result.set("socialNeighbors", stats.social_neighbors);
        result.set("avoidanceCorrections", stats.avoidance_corrections); result.set("obstacleChecks", stats.obstacle_checks);
        return result;
    }
    emscripten::val state() {
        std::size_t cursor = 0;
        for (const auto& boid : simulation_.state()) {
            for (auto value : {boid.position.x, boid.position.y, boid.position.z,
                               boid.velocity.x, boid.velocity.y, boid.velocity.z}) {
                buffer_[cursor++] = value;
            }
        }
        // Borrowed until reset/destruction/memory growth; callers consume immediately.
        return emscripten::val(emscripten::typed_memory_view(buffer_.size(), buffer_.data()));
    }
private:
    tinyflock::Simulation simulation_;
    std::vector<float> buffer_;
    std::vector<tinyflock::Vec3> forces_;
    tinyflock::Vec3 external_acceleration_;
    float pointer_radius_ = 70, pointer_strength_ = 2;
    tinyflock::Avoidance avoidance_knobs_{tinyflock::Seconds{4}, 2.5F};
    float altitude_knob_ = 0;
};
} // namespace

EMSCRIPTEN_BINDINGS(tinyflock) {
    emscripten::class_<BrowserSimulation>("Simulation")
        .constructor<>()
        .function("reset", &BrowserSimulation::reset)
        .function("step", &BrowserSimulation::step)
        .function("target", &BrowserSimulation::target)
        .function("clearTarget", &BrowserSimulation::clear_target)
        .function("weights", &BrowserSimulation::weights)
        .function("settings", &BrowserSimulation::settings)
        .function("configure", &BrowserSimulation::configure)
        .function("restoreDefaults", &BrowserSimulation::restore_defaults)
        .function("obstacles", &BrowserSimulation::obstacles)
        .function("stats", &BrowserSimulation::stats)
        .function("state", &BrowserSimulation::state);
}

