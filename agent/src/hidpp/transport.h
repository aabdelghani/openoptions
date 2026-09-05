// hidraw transport for HID++ 1.0 / 2.0 (receiver or directly connected device)
#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace hidpp {

using Bytes = std::vector<uint8_t>;

constexpr uint8_t kShort = 0x10, kLong = 0x11, kVeryLong = 0x12;
constexpr size_t kShortLen = 7, kLongLen = 20;
constexpr uint8_t kSwId = 0x0D;

struct RawInfo {
    uint32_t bustype = 0;
    uint16_t vendor = 0, product = 0;
    std::string name;
};
RawInfo rawInfo(const std::string& path);
bool supportsHidpp(const std::string& path);

struct HidppError : std::runtime_error {
    uint8_t code, featureIndex, function;
    HidppError(uint8_t c, uint8_t f = 0, uint8_t fn = 0);
};
struct Timeout : std::runtime_error {
    using std::runtime_error::runtime_error;
};

struct Notification {
    uint8_t deviceIndex = 0, featureIndex = 0, event = 0, swId = 0, reportId = 0, address = 0;
    Bytes data;
};

struct PairingInfo {
    uint16_t wpid = 0;
    uint8_t kind = 0;
    std::string serial;
};

class Transport {
  public:
    using Callback = std::function<void(const Notification&)>;
    Transport(std::string path, Callback cb, double timeoutSec = 1.5);
    ~Transport();
    Transport(const Transport&) = delete;

    void setCallback(Callback cb);
    const std::string& path() const { return path_; }
    const RawInfo& info() const { return info_; }

    // HID++ 2.0 request. Returns the payload (bytes after the 4 byte header).
    Bytes request(uint8_t devIdx, uint8_t featIdx, uint8_t fn, const Bytes& params = {},
                  std::optional<bool> longReport = std::nullopt, bool noReply = false);
    // HID++ 1.0 register access (0x80 set / 0x81 get / 0x82 set long / 0x83 get long)
    Bytes request10(uint8_t devIdx, uint8_t subId, uint8_t reg, const Bytes& params = {}, bool longReport = false);
    std::optional<std::pair<int, int>> ping(uint8_t devIdx);
    std::optional<PairingInfo> pairingInfo(uint8_t devIdx);

  private:
    void reader();
    void dispatch(const Bytes& frame);
    Bytes exchange(const Bytes& frame, uint8_t devIdx, uint8_t byte2, uint8_t byte3, bool matchSwId, bool noReply);

    std::string path_;
    RawInfo info_;
    int fd_ = -1;
    double timeout_;
    Callback cb_;
    std::mutex cbMutex_;
    std::atomic<bool> stop_{false};
    std::thread thread_;

    std::mutex reqMutex_;      // serialises requests
    std::mutex slotMutex_;     // protects the pending slot
    std::condition_variable cv_;
    bool pending_ = false;
    uint8_t pDev_ = 0, pB2_ = 0, pB3_ = 0;
    bool pMatchSw_ = false;
    bool haveResult_ = false;
    Bytes result_;
    std::optional<HidppError> error_;
};

}  // namespace hidpp
