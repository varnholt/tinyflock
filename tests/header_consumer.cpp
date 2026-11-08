#include <tinyflock/tinyflock.hpp>

// A second translation unit catches missing inline definitions in a drop-in header.
float header_consumer_length() {
    tinyflock::Simulation flock;
    flock.reset(1);
    return tinyflock::length({3, 4, 0});
}
