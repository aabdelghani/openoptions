#include "injector.h"

#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <sys/ioctl.h>
#include <unistd.h>

#include <cstring>
#include <stdexcept>
#include <thread>

#include <map>

#include "keycodes.gen.h"

namespace actions {

int Injector::code(const std::string& name) {
    std::string n = name;
    for (auto& c : n) c = static_cast<char>(toupper(c));
    if (n.rfind("KEY_", 0) != 0 && n.rfind("BTN_", 0) != 0) n = "KEY_" + n;
    for (auto& [k, v] : kKeyCodes)
        if (k == n) return v;
    return -1;
}

Injector::Injector() {
    fd_ = ::open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd_ < 0) throw std::runtime_error(std::string("open /dev/uinput: ") + strerror(errno));
    ioctl(fd_, UI_SET_EVBIT, EV_KEY);
    ioctl(fd_, UI_SET_EVBIT, EV_REL);
    ioctl(fd_, UI_SET_EVBIT, EV_SYN);
    for (auto& [k, v] : kKeyCodes) ioctl(fd_, UI_SET_KEYBIT, v);
    for (int r : {REL_X, REL_Y, REL_WHEEL, REL_HWHEEL, REL_WHEEL_HI_RES, REL_HWHEEL_HI_RES}) ioctl(fd_, UI_SET_RELBIT, r);
    uinput_setup us{};
    us.id.bustype = BUS_VIRTUAL;
    us.id.vendor = 0x046d;
    us.id.product = 0x0001;
    us.id.version = 1;
    strncpy(us.name, "OpenOptions virtual input", UINPUT_MAX_NAME_SIZE - 1);
    if (ioctl(fd_, UI_DEV_SETUP, &us) < 0 || ioctl(fd_, UI_DEV_CREATE) < 0)
        throw std::runtime_error(std::string("uinput setup: ") + strerror(errno));
    std::this_thread::sleep_for(std::chrono::milliseconds(200));  // let the desktop pick the device up
}

Injector::~Injector() {
    if (fd_ >= 0) {
        releaseAll();
        ioctl(fd_, UI_DEV_DESTROY);
        ::close(fd_);
    }
}

void Injector::emit(uint16_t type, uint16_t code, int32_t value) {
    input_event ev{};
    ev.type = type;
    ev.code = code;
    ev.value = value;
    if (::write(fd_, &ev, sizeof(ev)) < 0) { /* ignore */ }
}

void Injector::syn() { emit(EV_SYN, SYN_REPORT, 0); }

void Injector::press(const std::vector<std::string>& keys) {
    std::lock_guard<std::mutex> lk(m_);
    for (auto& k : keys) {
        int c = code(k);
        if (c < 0) continue;
        emit(EV_KEY, static_cast<uint16_t>(c), 1);
        held_.insert(c);
    }
    syn();
}

void Injector::release(const std::vector<std::string>& keys) {
    std::lock_guard<std::mutex> lk(m_);
    for (auto it = keys.rbegin(); it != keys.rend(); ++it) {
        int c = code(*it);
        if (c < 0) continue;
        emit(EV_KEY, static_cast<uint16_t>(c), 0);
        held_.erase(c);
    }
    syn();
}

void Injector::tap(const std::vector<std::string>& keys) {
    press(keys);
    std::this_thread::sleep_for(std::chrono::milliseconds(8));
    release(keys);
}

void Injector::releaseAll() {
    std::lock_guard<std::mutex> lk(m_);
    for (int c : held_) emit(EV_KEY, static_cast<uint16_t>(c), 0);
    held_.clear();
    syn();
}

void Injector::scroll(int dy, int dx, bool hires) {
    std::lock_guard<std::mutex> lk(m_);
    if (hires) {
        if (dy) emit(EV_REL, REL_WHEEL_HI_RES, dy);
        if (dx) emit(EV_REL, REL_HWHEEL_HI_RES, dx);
        if (dy && std::abs(dy) >= 120) emit(EV_REL, REL_WHEEL, dy / 120);
        if (dx && std::abs(dx) >= 120) emit(EV_REL, REL_HWHEEL, dx / 120);
    } else {
        if (dy) emit(EV_REL, REL_WHEEL, dy);
        if (dx) emit(EV_REL, REL_HWHEEL, dx);
    }
    syn();
}

void Injector::click(const std::string& button, int count) {
    int c = code(button);
    if (c < 0) return;
    for (int i = 0; i < count; ++i) {
        {
            std::lock_guard<std::mutex> lk(m_);
            emit(EV_KEY, static_cast<uint16_t>(c), 1);
            syn();
            emit(EV_KEY, static_cast<uint16_t>(c), 0);
            syn();
        }
        if (count > 1) std::this_thread::sleep_for(std::chrono::milliseconds(40));
    }
}

}  // namespace actions

namespace actions {

// ASCII typing through a US layout: (key, shift)
static std::pair<const char*, bool> charKey(char ch) {
    static const std::map<char, std::pair<const char*, bool>> punct = {
        {' ', {"KEY_SPACE", false}}, {'\n', {"KEY_ENTER", false}}, {'\t', {"KEY_TAB", false}},
        {'-', {"KEY_MINUS", false}}, {'_', {"KEY_MINUS", true}}, {'=', {"KEY_EQUAL", false}}, {'+', {"KEY_EQUAL", true}},
        {'[', {"KEY_LEFTBRACE", false}}, {'{', {"KEY_LEFTBRACE", true}}, {']', {"KEY_RIGHTBRACE", false}}, {'}', {"KEY_RIGHTBRACE", true}},
        {'\\', {"KEY_BACKSLASH", false}}, {'|', {"KEY_BACKSLASH", true}}, {';', {"KEY_SEMICOLON", false}}, {':', {"KEY_SEMICOLON", true}},
        {'\'', {"KEY_APOSTROPHE", false}}, {'"', {"KEY_APOSTROPHE", true}}, {'`', {"KEY_GRAVE", false}}, {'~', {"KEY_GRAVE", true}},
        {',', {"KEY_COMMA", false}}, {'<', {"KEY_COMMA", true}}, {'.', {"KEY_DOT", false}}, {'>', {"KEY_DOT", true}},
        {'/', {"KEY_SLASH", false}}, {'?', {"KEY_SLASH", true}}, {'!', {"KEY_1", true}}, {'@', {"KEY_2", true}}, {'#', {"KEY_3", true}},
        {'$', {"KEY_4", true}}, {'%', {"KEY_5", true}}, {'^', {"KEY_6", true}}, {'&', {"KEY_7", true}}, {'*', {"KEY_8", true}},
        {'(', {"KEY_9", true}}, {')', {"KEY_0", true}}};
    static char buf[8];
    if (ch >= 'a' && ch <= 'z') { snprintf(buf, sizeof(buf), "KEY_%c", ch - 32); return {buf, false}; }
    if (ch >= 'A' && ch <= 'Z') { snprintf(buf, sizeof(buf), "KEY_%c", ch); return {buf, true}; }
    if (ch >= '0' && ch <= '9') { snprintf(buf, sizeof(buf), "KEY_%c", ch); return {buf, false}; }
    auto it = punct.find(ch);
    if (it != punct.end()) return it->second;
    return {nullptr, false};
}

void Injector::typeText(const std::string& text) {
    for (char ch : text) {
        auto [key, shift] = charKey(ch);
        if (!key) continue;
        std::vector<std::string> keys;
        if (shift) keys.push_back("KEY_LEFTSHIFT");
        keys.push_back(key);
        press(keys);
        std::this_thread::sleep_for(std::chrono::milliseconds(6));
        release(keys);
        std::this_thread::sleep_for(std::chrono::milliseconds(6));
    }
}

}  // namespace actions
