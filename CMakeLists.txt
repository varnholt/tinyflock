cmake_minimum_required(VERSION 3.25)
project(tinyflock VERSION 0.1.0 LANGUAGES CXX)

if(PROJECT_IS_TOP_LEVEL)
    include(CTest)
endif()
include(GNUInstallDirs)
include(CMakePackageConfigHelpers)
option(TINYFLOCK_BUILD_EXAMPLES "Build the native example" ${PROJECT_IS_TOP_LEVEL})

add_library(tinyflock INTERFACE)
add_library(tinyflock::tinyflock ALIAS tinyflock)
target_include_directories(tinyflock INTERFACE
    "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>"
    "$<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>")
target_compile_features(tinyflock INTERFACE cxx_std_23)

set(tinyflock_package_dir "${CMAKE_INSTALL_LIBDIR}/cmake/tinyflock")
configure_package_config_file(cmake/tinyflockConfig.cmake.in
    "${CMAKE_CURRENT_BINARY_DIR}/tinyflockConfig.cmake"
    INSTALL_DESTINATION "${tinyflock_package_dir}")
write_basic_package_version_file("${CMAKE_CURRENT_BINARY_DIR}/tinyflockConfigVersion.cmake"
    VERSION ${PROJECT_VERSION} COMPATIBILITY SameMajorVersion ARCH_INDEPENDENT)
install(TARGETS tinyflock EXPORT tinyflockTargets)
install(DIRECTORY include/tinyflock DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}")
install(EXPORT tinyflockTargets NAMESPACE tinyflock:: DESTINATION "${tinyflock_package_dir}")
install(FILES "${CMAKE_CURRENT_BINARY_DIR}/tinyflockConfig.cmake"
    "${CMAKE_CURRENT_BINARY_DIR}/tinyflockConfigVersion.cmake" DESTINATION "${tinyflock_package_dir}")

if(EMSCRIPTEN)
    add_executable(tinyflock_wasm bindings/wasm.cpp)
    target_link_libraries(tinyflock_wasm PRIVATE tinyflock::tinyflock)
    target_link_options(tinyflock_wasm PRIVATE
        --bind --no-entry -sMODULARIZE=1 -sEXPORT_ES6=1
        -sEXPORT_NAME=createTinyflock -sALLOW_MEMORY_GROWTH=1
        "-sENVIRONMENT=web,node")
    set_target_properties(tinyflock_wasm PROPERTIES
        OUTPUT_NAME tinyflock SUFFIX .js
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/web/public/wasm")
elseif(TINYFLOCK_BUILD_EXAMPLES)
    add_executable(tinyflock_example examples/headless.cpp)
    target_link_libraries(tinyflock_example PRIVATE tinyflock::tinyflock)
    add_executable(tinyflock_steering_example examples/steering.cpp)
    target_link_libraries(tinyflock_steering_example PRIVATE tinyflock::tinyflock)
endif()

if(BUILD_TESTING AND PROJECT_IS_TOP_LEVEL AND NOT EMSCRIPTEN)
    add_executable(tinyflock_tests tests/simulation_tests.cpp tests/header_consumer.cpp)
    target_link_libraries(tinyflock_tests PRIVATE tinyflock::tinyflock)
    add_test(NAME simulation COMMAND tinyflock_tests)
    add_executable(tinyflock_steering_tests tests/steering_tests.cpp)
    target_link_libraries(tinyflock_steering_tests PRIVATE tinyflock::tinyflock)
    add_test(NAME steering COMMAND tinyflock_steering_tests)
    add_executable(tinyflock_parity tests/parity.cpp)
    target_link_libraries(tinyflock_parity PRIVATE tinyflock::tinyflock)
    if(TARGET tinyflock_steering_example)
        add_test(NAME steering_example COMMAND tinyflock_steering_example)
    endif()
endif()

foreach(target tinyflock_example tinyflock_steering_example tinyflock_tests tinyflock_steering_tests tinyflock_parity tinyflock_wasm)
    if(TARGET ${target})
        set_target_properties(${target} PROPERTIES CXX_EXTENSIONS OFF)
        if(MSVC)
            target_compile_options(${target} PRIVATE /W4 /permissive-)
        else()
            target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
        endif()
    endif()
endforeach()
