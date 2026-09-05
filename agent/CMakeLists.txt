cmake_minimum_required(VERSION 3.16)
project(openoptions-agent VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(Threads REQUIRED)
find_package(X11 REQUIRED)

add_library(oo_core STATIC
  src/hidpp/transport.cpp
  src/hidpp/protocol.cpp
  src/hidpp/discovery.cpp
  src/actions/injector.cpp
  src/actions/engine.cpp
  src/apps/tracker.cpp
  src/config.cpp
  src/ipc.cpp)
target_include_directories(oo_core PUBLIC src third_party)
target_link_libraries(oo_core PUBLIC Threads::Threads X11::X11)
target_compile_options(oo_core PRIVATE -Wall -Wextra -Wno-unused-parameter)

add_executable(openoptions-agent src/daemon.cpp src/main.cpp)
target_link_libraries(openoptions-agent PRIVATE oo_core)
target_compile_options(openoptions-agent PRIVATE -Wall -Wextra -Wno-unused-parameter)

add_executable(openoptionsctl src/ctl.cpp)
target_link_libraries(openoptionsctl PRIVATE oo_core)

install(TARGETS openoptions-agent openoptionsctl RUNTIME DESTINATION bin)
install(FILES ${CMAKE_SOURCE_DIR}/../udev/60-openoptions.rules DESTINATION /usr/lib/udev/rules.d OPTIONAL)
