// HID++ 2.0 features used by the MX Master 3S and MX Keys S
#pragma once
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"
#include "transport.h"

namespace hidpp {

using json = nlohmann::json;

enum Feature : uint16_t {
    ROOT = 0x0000, FEATURE_SET = 0x0001, DEVICE_FW = 0x0003, DEVICE_NAME = 0x0005, FRIENDLY_NAME = 0x0007,
    CONFIG_CHANGE = 0x0020, UNIFIED_BATTERY = 0x1004, CHANGE_HOST = 0x1814, HOSTS_INFO = 0x1815,
    BACKLIGHT2 = 0x1982, SPECIAL_KEYS = 0x1B04, WIRELESS_STATUS = 0x1D4B, SMART_SHIFT = 0x2110,
    SMART_SHIFT_ENHANCED = 0x2111, HIRES_WHEEL = 0x2121, THUMB_WHEEL = 0x2150, ADJUSTABLE_DPI = 0x2201,
    FN_INVERSION_K375S = 0x40A3, MULTIPLATFORM = 0x4531,
};

struct FeatureInfo {
    uint16_t id = 0;
    uint8_t index = 0, version = 0, type = 0;
};

struct ControlInfo {
    uint16_t cid = 0, taskId = 0;
    uint8_t flags = 0, position = 0, group = 0, groupMask = 0, extraFlags = 0;
    bool isMouse() const { return flags & 0x01; }
    bool isFKey() const { return flags & 0x02; }
    bool divertable() const { return flags & 0x20; }
    bool persistentlyDivertable() const { return flags & 0x40; }
    bool rawXY() const { return extraFlags & 0x01; }
};

struct Battery {
    int percent = 0;
    std::string level;
    bool charging = false, externalPower = false;
    json toJson() const { return {{"percent", percent}, {"level", level}, {"charging", charging}, {"external_power", externalPower}}; }
};
struct SmartShiftState { int mode = 0, threshold = 0, defaultThreshold = 0; };
struct HiResState { bool hidppTarget = false, hires = false, invert = false; int multiplier = 1; bool hasInvert = false, hasRatchetSwitch = false; };
struct ThumbWheelState { bool diverted = false, invert = false; int nativeRes = 0, divertedRes = 0, capabilities = 0; };
struct DpiState { int dpi = 0, def = 0; std::vector<int> levels; bool stepped = false; };
struct BacklightState {
    bool enabled = false;
    int options = 0, supported = 0, effects = 0, level = 0, dho = 0, dhi = 0, dpow = 0, numLevels = 0, currentLevel = 0, status = 0;
    int mode() const { return (options >> 3) & 0x03; }
    bool autoSupported() const { return supported & 0x08; }
    bool permManualSupported() const { return supported & 0x20; }
};
struct HostInfo { int index = 0; bool paired = false; int busType = 0; std::string name; };

struct Event {
    std::string kind;
    json data;
};

class Device {
  public:
    Device(Transport& t, uint8_t index) : t_(t), index_(index) {}

    bool enumerate();
    bool has(uint16_t f) const { return features_.count(f) > 0; }
    Bytes req(uint16_t feature, uint8_t fn, const Bytes& params = {}, bool noReply = false);
    const FeatureInfo* featureByIndex(uint8_t idx) const;

    uint8_t index() const { return index_; }
    Transport& transport() { return t_; }
    const std::string& name() const { return name_; }
    const std::string& friendlyName() const { return friendlyName_; }
    const std::string& kind() const { return kind_; }
    const std::string& firmware() const { return firmware_; }
    const std::string& serial() const { return serial_; }
    const std::map<uint16_t, FeatureInfo>& features() const { return features_; }
    const std::map<uint16_t, ControlInfo>& controls() const { return controls_; }

    std::optional<Battery> battery();
    std::pair<uint8_t, uint16_t> getReporting(uint16_t cid);
    void setReporting(uint16_t cid, std::optional<bool> divert, std::optional<bool> rawXY, uint16_t remap = 0);
    std::optional<SmartShiftState> smartshift();
    void setSmartshift(int mode, int threshold);
    std::optional<HiResState> hires();
    void setHires(bool hidppTarget, bool hires, bool invert);
    std::optional<ThumbWheelState> thumbwheel();
    void setThumbwheel(bool diverted, bool invert);
    std::optional<DpiState> dpi();
    void setDpi(int dpi);
    std::optional<BacklightState> backlight();
    void setBacklight(bool enabled, std::optional<int> mode, std::optional<int> level,
                      std::optional<int> dho = std::nullopt, std::optional<int> dhi = std::nullopt, std::optional<int> dpow = std::nullopt);
    void setHostName(int host, const std::string& name);
    std::vector<HostInfo> hosts();
    std::pair<int, int> currentHost();
    void changeHost(int host);
    uint8_t fnHost();
    void invalidateFnHost() { fnHost_ = -1; }
    std::optional<bool> fnInversion();
    void setFnInversion(bool on);

    std::optional<Event> classify(const Notification& n) const;
    static Battery decodeBattery(const Bytes& r);

  private:
    int fnHost_ = -1;
    void readIdentity();
    void readControls();

    Transport& t_;
    uint8_t index_;
    std::map<uint16_t, FeatureInfo> features_;
    std::map<uint16_t, ControlInfo> controls_;
    std::string name_, friendlyName_, kind_ = "unknown", firmware_, serial_;
};

}  // namespace hidpp
