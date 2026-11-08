#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <compare>
#include <cstddef>
#include <cstdint>
#include <expected>
#include <optional>
#include <numbers>
#include <random>
#include <span>
#include <utility>
#include <vector>

namespace tinyflock {

struct Vec3 {
    float x{}, y{}, z{};
    constexpr auto operator<=>(const Vec3&) const = default;
    constexpr Vec3 operator+(Vec3 b) const { return {x + b.x, y + b.y, z + b.z}; }
    constexpr Vec3 operator-(Vec3 b) const { return {x - b.x, y - b.y, z - b.z}; }
    constexpr Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
    constexpr Vec3 operator/(float s) const { return *this * (1.0F / s); }
    constexpr Vec3& operator+=(Vec3 b) { return *this = *this + b; }
};

[[nodiscard]] constexpr float length_squared(Vec3 v) {
    return v.x * v.x + v.y * v.y + v.z * v.z;
}
[[nodiscard]] float length(Vec3 v);

struct Boid {
    Vec3 position;
    Vec3 velocity;
    constexpr auto operator<=>(const Boid&) const = default;
};

// Distances are world units, speed is units/s, acceleration is units/s².
enum class Steering { free, forward_flight };
enum class NeighborSearch { all_pairs, spatial_grid };
using Seconds = std::chrono::duration<float>;

struct Avoidance {
    Seconds lookahead{3.0F};
    // Desired center-to-center clearance, independent of perception/separation radii.
    float clearance = 2.0F;
};

struct Config {
    float perception_radius = 12.0F;
    float separation_radius = 4.0F;
    float max_speed = 12.0F;
    float min_speed = 0.0F;
    float max_acceleration = 18.0F;
    float separation_weight = 1.5F;
    float alignment_weight = 1.0F;
    float cohesion_weight = 0.6F;
    float world_radius = 55.0F;
    float boundary_weight = 2.0F;
    Steering steering = Steering::free;
    // Full viewing cone in radians. Separation still senses all nearby agents.
    float view_angle = 2.0F * std::numbers::pi_v<float>;
    // Zero uses every visible neighbor; otherwise use the nearest N for social rules.
    std::size_t max_neighbors = 0;
    std::optional<float> preferred_altitude;
    Seconds altitude_response{8.0F};
    std::optional<Avoidance> avoidance;
    NeighborSearch neighbor_search = NeighborSearch::all_pairs;
    Seconds obstacle_lookahead{4.0F};
    float obstacle_margin = 1.0F;
};

struct SphereObstacle {
    Vec3 center;
    float radius = 1.0F;
    constexpr auto operator<=>(const SphereObstacle&) const = default;
};

struct StepStats {
    std::size_t candidate_pairs{};
    std::size_t social_neighbors{};
    std::size_t avoidance_corrections{};
    std::size_t obstacle_checks{};
    constexpr auto operator<=>(const StepStats&) const = default;
};

struct Target {
    Vec3 position;
    float radius = 40.0F;
    // Positive attracts; negative repels. Zero disables the influence.
    float strength = 1.0F;
};

enum class Error { invalid_config, invalid_state, invalid_timestep, invalid_target, invalid_obstacle, invalid_acceleration };

class Simulation {
public:
    Simulation() = default;

    // Validation failures leave existing state and configuration untouched.
    [[nodiscard]] std::expected<void, Error> configure(Config config);
    [[nodiscard]] std::expected<void, Error> set_state(std::span<const Boid> state);
    [[nodiscard]] std::expected<void, Error> set_target(std::optional<Target> target);
    [[nodiscard]] std::expected<void, Error> set_obstacles(std::span<const SphereObstacle> obstacles);
    void reset(std::size_t count, std::uint32_t seed = 42);

    // One synchronous update; caller owns scheduling. Accepts [0s, 100ms].
    // Optional accelerations are per agent, in world units/s², for this step only.
    [[nodiscard]] std::expected<void, Error> step(Seconds elapsed, std::span<const Vec3> accelerations = {});

    [[nodiscard]] const Config& config() const noexcept { return config_; }
    // Valid until reset/set_state/step or destruction. Read-only, no ownership transfer.
    [[nodiscard]] std::span<const Boid> state() const noexcept { return state_; }
    [[nodiscard]] std::span<const SphereObstacle> obstacles() const noexcept { return obstacles_; }
    [[nodiscard]] StepStats stats() const noexcept { return stats_; }

private:
    Config config_;
    std::optional<Target> target_;
    std::vector<Boid> state_;
    std::vector<Boid> next_;
    std::vector<std::pair<float, std::size_t>> neighbors_;
    std::vector<SphereObstacle> obstacles_;
    struct Cell {
        std::int64_t x{}, y{}, z{};
        constexpr auto operator<=>(const Cell&) const = default;
    };
    struct Entry {
        Cell cell;
        std::size_t index;
        constexpr auto operator<=>(const Entry&) const = default;
    };
    std::vector<Entry> grid_;
    std::vector<std::size_t> candidates_;
    StepStats stats_;
};

namespace detail {
inline bool finite(Vec3 v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

inline Vec3 limited(Vec3 v, float maximum) {
    const auto magnitude = length(v);
    return magnitude > maximum ? v * (maximum / magnitude) : v;
}

struct PredictedAvoidance { Vec3 direction; float acceleration{}; };

inline PredictedAvoidance predict_avoidance(Vec3 offset, Vec3 relative_velocity,
    const Avoidance& avoidance, float maximum) {
    const auto relative_speed2 = length_squared(relative_velocity);
    const auto closing = -(offset.x * relative_velocity.x + offset.y * relative_velocity.y +
        offset.z * relative_velocity.z);
    // Equal-velocity and receding pairs need no predictive correction. Existing
    // overlaps are handled by separation, rather than inventing a collision time.
    if (relative_speed2 < 1.0e-12F || closing <= 0.0F) return {};
    const auto time = std::min(closing / relative_speed2, avoidance.lookahead.count());
    const auto miss = offset + relative_velocity * time;
    const auto miss_distance = length(miss);
    if (miss_distance >= avoidance.clearance) return {};
    auto direction = miss;
    if (miss_distance < 1.0e-5F) {
        // Reciprocal lateral choices for an exactly centered approach. Reversing
        // the pair reverses this vector, including for vertical approaches.
        direction = Vec3{relative_velocity.z, 0, -relative_velocity.x};
        if (length_squared(direction) < relative_speed2 * 1.0e-8F)
            direction = Vec3{relative_velocity.y, -relative_velocity.x, 0};
    }
    direction = direction / length(direction);
    // Fade continuously as predicted clearance improves. Double intermediates
    // keep imminent encounters finite before clamping to the acceleration budget.
    const auto required = 2.0 * (avoidance.clearance - miss_distance) / (double(time) * time);
    return {direction, static_cast<float>(std::min(required, double(maximum)))};
}

inline Vec3 steering(Vec3 direction, Vec3 velocity, const Config& config) {
    const auto magnitude = length(direction);
    if (magnitude < 1.0e-6F) return {};
    const auto speed = length(velocity);
    if (config.steering == Steering::forward_flight && speed > 1.0e-6F) {
        const auto forward = velocity / speed;
        const auto goal = direction / magnitude;
        const auto cosine = std::clamp(forward.x * goal.x + forward.y * goal.y + forward.z * goal.z,
            -1.0F, 1.0F);
        auto turn = goal - forward * cosine;
        // A goal directly aft requires an arc, not braking through zero.
        auto preferred = Vec3{forward.z, 0, -forward.x};
        if (length_squared(preferred) < 1.0e-8F) preferred = Vec3{forward.y, -forward.x, 0};
        preferred = preferred / length(preferred);
        const auto behind = std::clamp((-cosine - 0.25F) * 2.0F, 0.0F, 1.0F);
        turn = turn * (1.0F - behind) + preferred * behind;
        if (const auto amount = length(turn); amount > 1.0e-6F) {
            turn = turn / amount * (config.max_acceleration * std::min(1.0F, std::acos(cosine) / 0.8F));
        }
        return limited(turn + forward * ((config.max_speed - speed) * 0.5F), config.max_acceleration);
    }
    return limited(direction * (config.max_speed / magnitude) - velocity,
                   config.max_acceleration);
}

// Optional forward-flight envelope. Approach the floor from rest without a
// velocity jump; when already airborne, retain speed rather than stopping and
// reversing. The chord constraint also preserves the acceleration bound.
inline Vec3 speed_floor(Vec3 candidate, Vec3 previous, float minimum, float max_change) {
    const auto old_speed = length(previous);
    const auto floor = std::min(minimum, old_speed + max_change);
    const auto speed = length(candidate);
    if (floor == 0.0F || speed >= floor) return candidate;
    auto direction = speed > 1.0e-7F ? candidate / speed :
        old_speed > 1.0e-7F ? previous / old_speed : Vec3{1, 0, 0};
    if (old_speed > 1.0e-7F) {
        const auto forward = previous / old_speed;
        const auto cosine = std::clamp(forward.x * direction.x + forward.y * direction.y +
            forward.z * direction.z, -1.0F, 1.0F);
        const auto bound = std::clamp((double(old_speed) * old_speed + double(floor) * floor -
            double(max_change) * max_change) / (2.0 * old_speed * floor), -1.0, 1.0);
        const auto limit = std::nextafter(static_cast<float>(bound), 1.0F);
        if (cosine < limit) {
            auto sideways = direction - forward * cosine;
            if (length_squared(sideways) < 1.0e-12F) {
                sideways = std::abs(forward.y) < 0.9F ? Vec3{-forward.z, 0, forward.x} :
                    Vec3{0, forward.z, -forward.y};
            }
            sideways = sideways / length(sideways);
            direction = forward * limit + sideways * std::sqrt(std::max(0.0F, 1.0F - limit * limit));
        }
    }
    return direction * floor;
}
} // namespace detail

inline float length(Vec3 v) { return std::sqrt(length_squared(v)); }

inline std::expected<void, Error> Simulation::configure(Config config) {
    const float positive[] = {config.perception_radius, config.separation_radius,
        config.max_speed, config.max_acceleration, config.world_radius};
    const float weights[] = {config.separation_weight, config.alignment_weight,
        config.cohesion_weight, config.boundary_weight};
    // Bound magnitudes so squared distances and weighted forces stay representable.
    const auto valid_positive = [](float v) {
        return std::isfinite(v) && v >= 1.0e-4F && v <= 1.0e6F;
    };
    const auto valid_weight = [](float v) {
        return std::isfinite(v) && v >= 0.0F && v <= 1000.0F;
    };
    if (!std::ranges::all_of(positive, valid_positive) ||
        !std::ranges::all_of(weights, valid_weight) ||
        config.separation_radius > config.perception_radius || !std::isfinite(config.min_speed) ||
        config.min_speed < 0.0F || config.min_speed > config.max_speed ||
        !std::isfinite(config.view_angle) || config.view_angle <= 0.0F ||
        config.view_angle > 2.0F * std::numbers::pi_v<float> ||
        (config.preferred_altitude && (!std::isfinite(*config.preferred_altitude) ||
            std::abs(*config.preferred_altitude) > 1.0e9F)) ||
        !std::isfinite(config.altitude_response.count()) || config.altitude_response.count() < 0.1F ||
        config.altitude_response.count() > 3600.0F ||
        (config.avoidance && (!valid_positive(config.avoidance->clearance) ||
            !std::isfinite(config.avoidance->lookahead.count()) ||
            config.avoidance->lookahead.count() < 0.01F || config.avoidance->lookahead.count() > 60.0F)) ||
        (config.neighbor_search != NeighborSearch::all_pairs && config.neighbor_search != NeighborSearch::spatial_grid) ||
        !std::isfinite(config.obstacle_lookahead.count()) || config.obstacle_lookahead.count() < 0.01F ||
        config.obstacle_lookahead.count() > 60.0F || !std::isfinite(config.obstacle_margin) ||
        config.obstacle_margin < 0.0F || config.obstacle_margin > 1.0e6F ||
        (config.steering != Steering::free && config.steering != Steering::forward_flight) ||
        (config.steering == Steering::forward_flight && config.min_speed == 0.0F)) {
        return std::unexpected(Error::invalid_config);
    }
    config_ = config;
    return {};
}

inline std::expected<void, Error> Simulation::set_state(std::span<const Boid> state) {
    const auto safe_vector = [](Vec3 v) {
        return detail::finite(v) && std::abs(v.x) <= 1.0e9F &&
            std::abs(v.y) <= 1.0e9F && std::abs(v.z) <= 1.0e9F;
    };
    if (!std::ranges::all_of(state, [&](const Boid& b) {
            return safe_vector(b.position) && safe_vector(b.velocity);
        })) return std::unexpected(Error::invalid_state);
    // Copy first: the input is allowed to alias our current state.
    std::vector<Boid> replacement(state.begin(), state.end());
    state_ = std::move(replacement);
    next_.resize(state_.size());
    stats_ = {};
    return {};
}

inline std::expected<void, Error> Simulation::set_target(std::optional<Target> target) {
    if (target && (!detail::finite(target->position) ||
        std::abs(target->position.x) > 1.0e9F ||
        std::abs(target->position.y) > 1.0e9F ||
        std::abs(target->position.z) > 1.0e9F ||
        !std::isfinite(target->radius) || target->radius < 1.0e-4F ||
        target->radius > 1.0e6F || !std::isfinite(target->strength) ||
        std::abs(target->strength) > 1000.0F)) {
        return std::unexpected(Error::invalid_target);
    }
    target_ = target;
    return {};
}

inline std::expected<void, Error> Simulation::set_obstacles(std::span<const SphereObstacle> obstacles) {
    if (!std::ranges::all_of(obstacles, [](const SphereObstacle& obstacle) {
        return detail::finite(obstacle.center) && std::abs(obstacle.center.x) <= 1.0e9F &&
            std::abs(obstacle.center.y) <= 1.0e9F && std::abs(obstacle.center.z) <= 1.0e9F &&
            std::isfinite(obstacle.radius) && obstacle.radius >= 1.0e-4F && obstacle.radius <= 1.0e6F;
    })) return std::unexpected(Error::invalid_obstacle);
    // Copy first so the input may alias obstacles().
    std::vector<SphereObstacle> replacement(obstacles.begin(), obstacles.end());
    obstacles_ = std::move(replacement);
    return {};
}

inline void Simulation::reset(std::size_t count, std::uint32_t seed) {
    std::mt19937 random(seed);
    // Explicit conversion avoids implementation-specific uniform_real_distribution.
    const auto sample = [&]() {
        return static_cast<float>(random() >> 8) / 16777216.0F * 2.0F - 1.0F;
    };
    state_.resize(count);
    next_.resize(count);
    target_.reset();
    stats_ = {};
    for (auto& boid : state_) {
        boid.position = Vec3{sample(), sample() * 0.45F, sample()} *
            (config_.world_radius * 0.45F);
        boid.velocity = detail::limited(Vec3{sample(), sample() * 0.3F, sample()}, 1.0F) *
            (config_.max_speed * 0.7F);
        if (const auto speed = length(boid.velocity); speed < config_.min_speed) {
            boid.velocity = (speed > 1.0e-7F ? boid.velocity / speed : Vec3{1, 0, 0}) * config_.min_speed;
        }
    }
}

inline std::expected<void, Error> Simulation::step(Seconds elapsed, std::span<const Vec3> accelerations) {
    const auto dt = elapsed.count();
    if (!std::isfinite(dt) || dt < 0.0F || dt > 0.1F) {
        return std::unexpected(Error::invalid_timestep);
    }
    if ((!accelerations.empty() && accelerations.size() != state_.size()) ||
        !std::ranges::all_of(accelerations, [](Vec3 acceleration) {
            return detail::finite(acceleration) && std::abs(acceleration.x) <= 1.0e6F &&
                std::abs(acceleration.y) <= 1.0e6F && std::abs(acceleration.z) <= 1.0e6F;
        })) return std::unexpected(Error::invalid_acceleration);
    if (dt == 0.0F) return {};

    stats_ = {};
    double cell_size = config_.perception_radius;
    if (config_.avoidance) {
        float maximum_speed = 0;
        for (const auto& boid : state_) maximum_speed = std::max(maximum_speed, length(boid.velocity));
        // A conservative query radius includes every pair that can enter the
        // clearance sphere within the horizon, even above a newly lowered cap.
        cell_size = std::max(cell_size, double(config_.avoidance->clearance) +
            2.0 * maximum_speed * config_.avoidance->lookahead.count());
    }
    const auto cell_of = [cell_size](Vec3 position) {
        const auto coordinate = [cell_size](float value) {
            return static_cast<std::int64_t>(std::clamp(std::floor(double(value) / cell_size), -1.0e18, 1.0e18));
        };
        return Cell{coordinate(position.x), coordinate(position.y), coordinate(position.z)};
    };
    if (config_.neighbor_search == NeighborSearch::spatial_grid) {
        grid_.clear();
        grid_.reserve(state_.size());
        candidates_.reserve(state_.size());
        for (std::size_t i = 0; i < state_.size(); ++i) grid_.push_back({cell_of(state_[i].position), i});
        std::ranges::sort(grid_);
    }

    const auto perception2 = config_.perception_radius * config_.perception_radius;
    const auto separation2 = config_.separation_radius * config_.separation_radius;
    const auto view_cosine = std::cos(config_.view_angle * 0.5F);
    if (config_.max_neighbors != 0) neighbors_.reserve(state_.size());
    for (std::size_t i = 0; i < state_.size(); ++i) {
        const auto& boid = state_[i];
        Vec3 separation{}, alignment{}, center{};
        detail::PredictedAvoidance avoidance{};
        std::size_t neighbors = 0;
        neighbors_.clear();
        if (config_.neighbor_search == NeighborSearch::spatial_grid) {
            candidates_.clear();
            const auto cell = cell_of(boid.position);
            for (int x = -1; x <= 1; ++x) for (int y = -1; y <= 1; ++y) for (int z = -1; z <= 1; ++z) {
                const Cell query{cell.x + x, cell.y + y, cell.z + z};
                auto entry = std::lower_bound(grid_.begin(), grid_.end(), Entry{query, 0});
                while (entry != grid_.end() && entry->cell == query) candidates_.push_back((entry++)->index);
            }
            // Preserve the reference accumulation and threat tie-breaking order.
            std::ranges::sort(candidates_);
        }
        // Read only the previous state: update order cannot affect the result.
        const auto candidate_count = config_.neighbor_search == NeighborSearch::spatial_grid ? candidates_.size() : state_.size();
        for (std::size_t candidate = 0; candidate < candidate_count; ++candidate) {
            const auto j = config_.neighbor_search == NeighborSearch::spatial_grid ? candidates_[candidate] : candidate;
            if (i == j) continue;
            ++stats_.candidate_pairs;
            const auto offset = boid.position - state_[j].position;
            const auto distance2 = length_squared(offset);
            if (config_.avoidance) {
                const auto prediction = detail::predict_avoidance(offset, boid.velocity - state_[j].velocity,
                    *config_.avoidance, config_.max_acceleration);
                if (prediction.acceleration > avoidance.acceleration) avoidance = prediction;
            }
            if (distance2 > perception2) continue;
            if (distance2 < separation2) {
                if (distance2 > 1.0e-10F) separation += offset / distance2;
                // Resolve exactly overlapping birds with a reproducible opposite push.
                else separation += Vec3{i < j ? -1.0F : 1.0F, 0.0F, 0.0F};
            }
            const auto speed2 = length_squared(boid.velocity);
            const auto toward = -(boid.velocity.x * offset.x + boid.velocity.y * offset.y + boid.velocity.z * offset.z);
            if (config_.view_angle < 2.0F * std::numbers::pi_v<float> && speed2 > 1.0e-10F &&
                toward < view_cosine * std::sqrt(speed2 * distance2)) continue;
            if (config_.max_neighbors != 0) neighbors_.emplace_back(distance2, j);
            else {
                ++neighbors;
                alignment += state_[j].velocity;
                center += state_[j].position - boid.position;
            }
        }

        for (const auto& obstacle : obstacles_) {
            ++stats_.obstacle_checks;
            const auto offset = boid.position - obstacle.center;
            const auto clearance = obstacle.radius + config_.obstacle_margin;
            const auto closing = offset.x * boid.velocity.x + offset.y * boid.velocity.y + offset.z * boid.velocity.z;
            auto prediction = detail::predict_avoidance(offset, boid.velocity,
                Avoidance{config_.obstacle_lookahead, clearance}, config_.max_acceleration);
            if (length_squared(offset) < clearance * clearance && closing <= 0.0F) {
                const auto distance = length(offset);
                prediction = {distance > 1.0e-6F ? offset / distance : Vec3{1, 0, 0}, config_.max_acceleration};
            }
            if (prediction.acceleration > avoidance.acceleration) avoidance = prediction;
        }
        if (config_.max_neighbors != 0) {
            neighbors = std::min(config_.max_neighbors, neighbors_.size());
            // Pair ordering breaks equal-distance ties by stable state index.
            std::partial_sort(neighbors_.begin(), neighbors_.begin() + neighbors, neighbors_.end());
            for (std::size_t n = 0; n < neighbors; ++n) {
                const auto& other = state_[neighbors_[n].second];
                alignment += other.velocity;
                center += other.position - boid.position;
            }
        }

        stats_.social_neighbors += neighbors;
        Vec3 acceleration = accelerations.empty() ? Vec3{} : accelerations[i];
        // Collision spacing remains active even when every neighbor is behind us.
        acceleration += detail::steering(separation, boid.velocity, config_) * config_.separation_weight;
        if (neighbors != 0) {
            const auto count = static_cast<float>(neighbors);
            acceleration += detail::steering(alignment / count, boid.velocity, config_) * config_.alignment_weight;
            acceleration += detail::steering(center / count, boid.velocity, config_) * config_.cohesion_weight;
        }
        if (config_.preferred_altitude) {
            // Critically damped vertical spring; the shared acceleration budget still applies.
            const auto response = config_.altitude_response.count();
            acceleration.y += 4.0F * (*config_.preferred_altitude - boid.position.y) / (response * response)
                - 4.0F * boid.velocity.y / response;
        }
        // Airborne agents start a boundary turn before reaching the edge.
        const auto boundary_position = config_.steering == Steering::forward_flight ?
            boid.position + boid.velocity * (1.5F * config_.max_speed / config_.max_acceleration) : boid.position;
        const auto distance = length(boundary_position);
        const auto edge = config_.world_radius * 0.75F;
        if (distance > edge) {
            const auto fade = std::min((distance - edge) / (config_.world_radius - edge), 1.0F);
            acceleration += detail::steering(boundary_position * -1.0F, boid.velocity, config_) *
                (config_.boundary_weight * fade);
        }
        if (target_) {
            const auto offset = target_->position - boid.position;
            const auto fade = std::max(0.0F, 1.0F - length(offset) / target_->radius);
            const auto direction = target_->strength >= 0.0F ? offset : offset * -1.0F;
            acceleration += detail::steering(direction, boid.velocity, config_) *
                (std::abs(target_->strength) * fade);
        }
        if (avoidance.acceleration > 0.0F) {
            ++stats_.avoidance_corrections;
            auto direction = avoidance.direction;
            if (config_.steering == Steering::forward_flight && length_squared(boid.velocity) > 1.0e-12F) {
                const auto forward = boid.velocity / length(boid.velocity);
                direction = direction - forward * (direction.x * forward.x + direction.y * forward.y + direction.z * forward.z);
                if (length_squared(direction) < 1.0e-10F) {
                    direction = Vec3{forward.z, 0, -forward.x};
                    if (length_squared(direction) < 1.0e-8F) direction = Vec3{forward.y, -forward.x, 0};
                }
                direction = direction / length(direction);
            }
            // Reserve acceleration for the strongest predicted encounter first;
            // social rules, goals and boundaries share only the remaining budget.
            auto remaining = detail::limited(acceleration, config_.max_acceleration - avoidance.acceleration);
            const auto opposing = remaining.x * direction.x + remaining.y * direction.y + remaining.z * direction.z;
            if (opposing < 0.0F) remaining = remaining - direction * opposing;
            acceleration = direction * avoidance.acceleration + remaining;
        }
        acceleration = detail::limited(acceleration, config_.max_acceleration);
        auto velocity = detail::limited(boid.velocity + acceleration * dt, config_.max_speed);
        if (config_.min_speed > 0.0F) {
            velocity = detail::speed_floor(velocity, boid.velocity, config_.min_speed,
                config_.max_acceleration * dt);
        }
        next_[i] = {boid.position + velocity * dt, velocity};
    }
    state_.swap(next_);
    return {};
}
} // namespace tinyflock
