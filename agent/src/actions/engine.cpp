#include "engine.h"

#include <cstdlib>

#include "../tables.gen.h"

namespace actions {

const json& presets() {
    static const json p = json::parse(kPresetsJson);
    return p;
}

json resolve(const json& action) {
    if (action.is_string()) {
        const json& all = presets()["all"];
        auto it = all.find(action.get<std::string>());
        json a = it == all.end() ? all["native"] : *it;
        a["preset"] = action;
        return a;
    }
    if (action.is_object()) return action;
    return presets()["all"]["native"];
}

static std::vector<std::string> keys(const json& a, const char* field = "keys") {
    std::vector<std::string> out;
    if (a.contains(field) && a[field].is_array())
        for (auto& k : a[field]) out.push_back(k.get<std::string>());
    return out;
}

void Engine::play(const json& action, double delta) {
    std::string t = action.value("type", "native");
    if (t == "native" || t == "nothing") return;
    if (t == "keystroke") {
        inj_.tap(keys(action));
    } else if (t == "button") {
        inj_.click(action.value("button", "BTN_MIDDLE"), action.value("count", 1));
    } else if (t == "scroll") {
        int amt = static_cast<int>(delta != 0.0 ? delta : action.value("amount", 0.0));
        auto mods = keys(action, "modifiers");
        if (!mods.empty()) inj_.press(mods);
        if (action.value("axis", "y") == "x") inj_.scroll(0, amt);
        else inj_.scroll(amt, 0);
        if (!mods.empty()) inj_.release(mods);
    } else if (t == "command") {
        std::string cmd = action.value("cmd", "");
        if (!cmd.empty()) {
            std::string full = "(" + cmd + ") >/dev/null 2>&1 &";
            if (std::system(full.c_str()) != 0) { /* ignore */ }
        }
    } else if (t == "ui") {
        if (ops_.uiEvent) ops_.uiEvent(action.value("event", "emoji"));
    } else if (t == "type_text") {
        inj_.typeText(action.value("text", ""));
    } else if (t == "open") {
        std::string target = action.value("target", "");
        if (!target.empty()) {
            if (target == "~" || target.rfind("~/", 0) == 0) { const char* h = getenv("HOME"); target = std::string(h ? h : "") + target.substr(1); }
            std::string full = "xdg-open '" + target + "' >/dev/null 2>&1 &";
            if (std::system(full.c_str()) != 0) { /* ignore */ }
        }
    } else if (t == "launch") {
        std::string id = action.value("app", "");
        if (!id.empty()) {
            std::string full = "(gtk-launch '" + id + "' || gio launch /usr/share/applications/'" + id + "'.desktop) >/dev/null 2>&1 &";
            if (std::system(full.c_str()) != 0) { /* ignore */ }
        }
    } else if (t == "smartshift_toggle") {
        if (ops_.toggleSmartshift) ops_.toggleSmartshift();
    } else if (t == "change_host") {
        if (ops_.changeHost) ops_.changeHost(action.value("host", 0));
    } else if (t == "dpi_cycle") {
        if (ops_.getDpi && ops_.setDpi) {
            int cur = ops_.getDpi();
            std::vector<int> levels = action.contains("levels") ? action["levels"].get<std::vector<int>>() : std::vector<int>{800, 1000, 1600, 2400, 4000};
            int nxt = levels.front();
            for (int lv : levels)
                if (lv > cur) { nxt = lv; break; }
            ops_.setDpi(nxt);
        }
    }
}

std::string Engine::dir(int dx, int dy) {
    if (std::abs(dx) >= std::abs(dy)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "down" : "up";
}

void Engine::buttonDown(int cid, const json& action) {
    json a = resolve(action);
    std::string t = a.value("type", "native");
    if (t == "gesture") {
        std::lock_guard<std::mutex> lk(m_);
        gestures_[cid] = Gesture{a};
    } else if (t == "hold") {
        auto k = keys(a);
        inj_.press(k);
        held_[cid] = k;
    }
}

void Engine::buttonUp(int cid, const json& action) {
    json a = resolve(action);
    std::string t = a.value("type", "native");
    if (t == "gesture") {
        Gesture g;
        {
            std::lock_guard<std::mutex> lk(m_);
            auto it = gestures_.find(cid);
            if (it == gestures_.end()) return;
            g = it->second;
            gestures_.erase(it);
        }
        int thr = a.value("threshold", 60);
        bool moved = std::abs(g.dx) > thr || std::abs(g.dy) > thr;
        if (a.value("continuous", false)) {
            if (!g.direction) play(a.value("click", json::object()));
        } else if (!g.fired && !moved) {
            play(a.value("click", json::object()));
        } else if (!g.fired && moved) {
            play(a.value(dir(g.dx, g.dy), json::object()));
        }
    } else if (t == "hold") {
        auto it = held_.find(cid);
        if (it != held_.end()) {
            inj_.release(it->second);
            held_.erase(it);
        }
    } else {
        play(a);
    }
}

void Engine::rawXY(int dx, int dy) {
    std::lock_guard<std::mutex> lk(m_);
    for (auto& [cid, g] : gestures_) {
        g.dx += dx;
        g.dy += dy;
        const json& a = g.action;
        int thr = a.value("threshold", 60);
        if (a.value("continuous", false)) {
            int step = std::max(1, a.value("step", 40));
            if (!g.direction) {
                if (std::abs(g.dx) > thr || std::abs(g.dy) > thr) {
                    g.direction = std::abs(g.dx) >= std::abs(g.dy) ? 'x' : 'y';
                    g.accX = g.accY = 0;
                } else {
                    continue;
                }
            }
            if (g.direction == 'x') {
                g.accX += dx;
                while (std::abs(g.accX) >= step) {
                    int sign = g.accX > 0 ? 1 : -1;
                    g.accX -= sign * step;
                    const json& sub = a.value(sign > 0 ? "right" : "left", json::object());
                    play(sub, sub.value("amount", 0.0));
                }
            } else {
                g.accY += dy;
                while (std::abs(g.accY) >= step) {
                    int sign = g.accY > 0 ? 1 : -1;
                    g.accY -= sign * step;
                    const json& sub = a.value(sign > 0 ? "down" : "up", json::object());
                    play(sub, sub.value("amount", 0.0));
                }
            }
        } else if (!g.fired && (std::abs(g.dx) > thr || std::abs(g.dy) > thr)) {
            g.fired = true;
            play(a.value(dir(g.dx, g.dy), json::object()));
        }
    }
}

void Engine::thumbwheel(int rotation, const json& action) {
    json a = resolve(action);
    std::string t = a.value("type", "native");
    if (rotation == 0 || t == "native" || t == "nothing") return;
    if (t == "scroll") {
        double gain = a.value("gain", 8.0);
        int amt = static_cast<int>(rotation * gain);
        auto mods = keys(a, "modifiers");
        if (!mods.empty()) inj_.press(mods);
        if (a.value("axis", "x") == "x") inj_.scroll(0, amt);
        else inj_.scroll(-amt, 0);
        if (!mods.empty()) inj_.release(mods);
    } else if (t == "adapter") {
        int step = std::max(1, a.value("step", 120));
        wheelAcc_ += rotation * a.value("gain", 8.0);
        while (std::abs(wheelAcc_) >= step) {
            int sign = wheelAcc_ > 0 ? 1 : -1;
            wheelAcc_ -= sign * step;
            play(a.value(sign > 0 ? "plus" : "minus", json::object()));
        }
    } else {
        play(a);
    }
}

}  // namespace actions
