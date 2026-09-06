// The agent: owns transports and devices, applies configuration, routes events
#pragma once
#include <atomic>
#include <chrono>
#include <vector>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>

#include "actions/engine.h"
#include "actions/injector.h"
#include "apps/tracker.h"
#include "config.h"
#include "hidpp/discovery.h"
#include "hidpp/protocol.h"
#include "hidpp/transport.h"
#include "ipc.h"

class Daemon;

class ManagedDevice : public std::enable_shared_from_this<ManagedDevice> {
  public:
    ManagedDevice(Daemon& d, hidpp::Transport& t, std::unique_ptr<hidpp::Device> dev, uint16_t pid, std::string serial);
    std::string id() const { return Config::key(pid_); }
    uint16_t pid() const { return pid_; }
    hidpp::Device& dev() { return *dev_; }
    hidpp::Transport& transport() { return t_; }
    json summary();
    json readState(bool full = true);
    void applySettings(const std::string& only = "");
    void applyAssignments();
    bool isDiverted(int cid) const { return diverted_.count(cid) > 0; }
    void releaseAll();
    void setProfile(const std::string& appClass);
    void handle(const hidpp::Event& ev);
    void reapply();
    void refreshConfig();
    void applyPointerSpeed(double v);
    const std::string& profileName() const { return profileName_; }
    std::optional<hidpp::Battery> battery() const { return battery_; }
    void setBattery(std::optional<hidpp::Battery> b) { battery_ = b; }

  private:
    json actionFor(int cid);
    void announce(const json& action);
    Daemon& daemon_;
    hidpp::Transport& t_;
    std::unique_ptr<hidpp::Device> dev_;
    uint16_t pid_;
    std::string serial_, kind_;
    json cfg_, profile_;
    std::string profileName_ = "default";
    std::optional<hidpp::Battery> battery_;
    std::set<int> down_, diverted_;
    json state_;
    json hostsCache_;
    std::unique_ptr<actions::Engine> engine_;
    std::recursive_mutex m_;
};

struct PairingSession {
    hidpp::Transport* transport = nullptr;
    bool active = false, discovering = false, lockOpen = false;
    int counter = -1;
    uint8_t kind = 0, authentication = 0;
    std::vector<uint8_t> address;
    std::string name, passkey, error, doneName;
    std::chrono::steady_clock::time_point started{};
    int timeoutSec = 60;
};

class Daemon {
  public:
    Daemon();
    ~Daemon();
    int run();
    void stop() { stop_ = true; }
    Config& config() { return config_; }
    actions::Injector& injector() { return *injector_; }
    void broadcast(const std::string& ev, const json& data) { if (server_) server_->broadcast(ev, data); }
    const std::string& appClass() const { return appClass_; }
    void changeHostFrom(ManagedDevice& src, int host);
    bool paused() const { return paused_; }

  private:
    using DevPtr = std::shared_ptr<ManagedDevice>;
    void scan();
    bool attach(hidpp::Transport& t, uint8_t idx, const hidpp::Node& node);
    void onNotification(hidpp::Transport& t, const hidpp::Notification& n);
    void onApp(const std::string& cls);
    json rpc(const std::string& method, const json& p);
    void onReceiverNotification(hidpp::Transport& t, const hidpp::Notification& n);
    void pairStart();
    void pairCancel();
    void pairBroadcast(const std::string& status);
    DevPtr find(const std::string& id);
    bool linkAlive(ManagedDevice& md);
    std::vector<DevPtr> snapshot();

    Config config_;
    std::unique_ptr<actions::Injector> injector_;
    std::unique_ptr<ipc::Server> server_;
    std::unique_ptr<apps::Tracker> tracker_;
    // mapMutex_ protects the two maps only and is never held during device I/O
    std::mutex mapMutex_;
    std::map<std::string, std::unique_ptr<hidpp::Transport>> transports_;
    std::map<std::string, DevPtr> devices_;  // by id (pid hex)
    std::mutex attachMutex_;                 // serialises attach() calls
    std::mutex scanMutex_;
    std::atomic<bool> pairing_{false};
    std::string appClass_;
    std::atomic<bool> stop_{false};
    std::atomic<bool> paused_{false};
    PairingSession pair_;
    std::mutex pairMutex_;
    std::chrono::steady_clock::time_point lastRetry_{};
};
