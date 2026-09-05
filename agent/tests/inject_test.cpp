#include <cstdio>
#include <cstdlib>
#include <thread>
#include "actions/injector.h"
int main(int argc, char** argv) {
    actions::Injector inj;
    int pre = argc > 2 ? atoi(argv[2]) : 800, hold = argc > 3 ? atoi(argv[3]) : 8;
    std::this_thread::sleep_for(std::chrono::milliseconds(pre));
    std::string key = argc > 1 ? argv[1] : "KEY_CALC";
    inj.press({key});
    std::this_thread::sleep_for(std::chrono::milliseconds(hold));
    inj.release({key});
    std::this_thread::sleep_for(std::chrono::milliseconds(3000));
    return 0;
}
