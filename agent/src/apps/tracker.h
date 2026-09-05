// Focused application tracker (X11 via _NET_ACTIVE_WINDOW; GNOME Wayland via gdbus polling)
#pragma once
#include <atomic>
#include <functional>
#include <string>
#include <thread>

namespace apps {

class Tracker {
  public:
    using Callback = std::function<void(const std::string&)>;
    explicit Tracker(Callback cb) : cb_(std::move(cb)) {}
    ~Tracker();
    void start();
    void stop();
    const std::string& backend() const { return backend_; }
    const std::string& current() const { return current_; }

  private:
    void x11Loop();
    void gnomeLoop();
    void swayLoop();
    void set(const std::string& cls);
    Callback cb_;
    std::string backend_ = "none", current_;
    std::atomic<bool> stop_{false};
    std::thread thread_;
};

}  // namespace apps
