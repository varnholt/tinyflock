#include <tinyflock/tinyflock.hpp>
#include <chrono>
#include <iostream>

int main() {
    using namespace std::chrono_literals;
    tinyflock::Simulation flock;
    flock.reset(256, 42);
    for (int tick = 0; tick < 600; ++tick) {
        if (!flock.step(1s / 60.0F)) return 1;
    }
    tinyflock::Vec3 center{};
    for (const auto& boid : flock.state()) center += boid.position;
    center = center / static_cast<float>(flock.state().size());
    std::cout << flock.state().size() << " birds after 10 seconds; center: "
              << center.x << ", " << center.y << ", " << center.z << '\n';
}

