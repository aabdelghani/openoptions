#include <cstdio>
#include <cstring>

#include "daemon.h"

void setVerbose(int v);

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "-v") || !strcmp(argv[i], "--verbose")) setVerbose(1);
        if (!strcmp(argv[i], "-h") || !strcmp(argv[i], "--help")) {
            printf("logimx-agent [-v]\n  Background agent for MX Master and MX Keys devices (HID++ over hidraw, uinput actions).\n"
                   "  Listens on $XDG_RUNTIME_DIR/logimx.sock\n");
            return 0;
        }
    }
    try {
        Daemon d;
        return d.run();
    } catch (const std::exception& e) {
        fprintf(stderr, "fatal: %s\n", e.what());
        return 1;
    }
}
