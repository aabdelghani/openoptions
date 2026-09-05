// uinput virtual keyboard + mouse used to play actions into the desktop
#pragma once
#include <cstdint>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace actions {

class Injector {
  public:
    Injector();
    ~Injector();
    static int code(const std::string& name);  // "KEY_A" / "BTN_LEFT" -> code, -1 if unknown
    void press(const std::vector<std::string>& keys);
    void release(const std::vector<std::string>& keys);
    void tap(const std::vector<std::string>& keys);
    void releaseAll();
    void scroll(int dy, int dx, bool hires = true);  // hires units: 1/120 detent
    void click(const std::string& button, int count = 1);
    void typeText(const std::string& text);

  private:
    void emit(uint16_t type, uint16_t code, int32_t value);
    void syn();
    int fd_ = -1;
    std::mutex m_;
    std::set<int> held_;
};

}  // namespace actions
