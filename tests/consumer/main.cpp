#include <tinyflock/tinyflock.hpp>
#include <chrono>

int main() {
    using namespace std::chrono_literals;
    tinyflock::Simulation flock;
    flock.reset(8);
    return flock.step(16ms) && flock.state().size() == 8 ? 0 : 1;
}
