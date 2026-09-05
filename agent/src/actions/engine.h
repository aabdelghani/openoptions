// Device events -> desktop actions (gestures, adapters, keystrokes)
#pragma once
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "injector.h"
#include "nlohmann/json.hpp"

namespace actions {

using json = nlohmann::json;

// Resolve a preset name or inline action object to a full action object
json resolve(const json& action);
const json& presets();

struct DeviceOps {
    std::function<void(int)> changeHost;
    std::function<int()> getDpi;
    std::function<void(int)> setDpi;
    std::function<void()> toggleSmartshift;
    std::function<void(const std::string&)> uiEvent;
};

class Engine {
  public:
    Engine(Injector& inj, DeviceOps ops) : inj_(inj), ops_(std::move(ops)) {}
    void play(const json& action, double delta = 0.0);
    void buttonDown(int cid, const json& action);
    void buttonUp(int cid, const json& action);
    void rawXY(int dx, int dy);
    void thumbwheel(int rotation, const json& action);

  private:
    struct Gesture {
        json action;
        int dx = 0, dy = 0;
        bool fired = false;
        double accX = 0, accY = 0;
        char direction = 0;  // 0, 'x', 'y'
    };
    static std::string dir(int dx, int dy);
    Injector& inj_;
    DeviceOps ops_;
    std::mutex m_;
    std::map<int, Gesture> gestures_;
    std::map<int, std::vector<std::string>> held_;
    double wheelAcc_ = 0;
};

}  // namespace actions
