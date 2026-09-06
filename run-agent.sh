#!/usr/bin/env bash
# Build (if needed) and run the LogiMX agent in the foreground.
set -e
cd "$(dirname "$0")/agent"
[ -x build/logimx-agent ] || { cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build; }
exec ./build/logimx-agent "$@"
