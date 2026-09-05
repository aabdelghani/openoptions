#include "transport.h"

#include <fcntl.h>
#include <linux/hidraw.h>
#include <poll.h>
#include <sys/ioctl.h>
#include <unistd.h>

#include <chrono>
#include <cstring>

namespace hidpp {

HidppError::HidppError(uint8_t c, uint8_t f, uint8_t fn)
    : std::runtime_error("HID++ error 0x" + std::to_string(c) + " (feature idx " + std::to_string(f) + ")"),
      code(c), featureIndex(f), function(fn) {}

RawInfo rawInfo(const std::string& path) {
    RawInfo r;
    int fd = ::open(path.c_str(), O_RDONLY | O_NONBLOCK);
    if (fd < 0) throw std::runtime_error("open " + path + ": " + strerror(errno));
    hidraw_devinfo di{};
    if (ioctl(fd, HIDIOCGRAWINFO, &di) == 0) {
        r.bustype = di.bustype;
        r.vendor = static_cast<uint16_t>(di.vendor);
        r.product = static_cast<uint16_t>(di.product);
    }
    char name[256] = {0};
    if (ioctl(fd, HIDIOCGRAWNAME(sizeof(name)), name) >= 0) r.name = name;
    ::close(fd);
    return r;
}

bool supportsHidpp(const std::string& path) {
    int fd = ::open(path.c_str(), O_RDONLY | O_NONBLOCK);
    if (fd < 0) return false;
    int size = 0;
    bool ok = false;
    if (ioctl(fd, HIDIOCGRDESCSIZE, &size) == 0 && size > 0) {
        hidraw_report_descriptor rd{};
        rd.size = size;
        if (ioctl(fd, HIDIOCGRDESC, &rd) == 0) {
            const uint8_t a[] = {0x06, 0x00, 0xff}, b[] = {0x06, 0x43, 0xff};
            for (int i = 0; i + 3 <= size && !ok; ++i)
                ok = !memcmp(rd.value + i, a, 3) || !memcmp(rd.value + i, b, 3);
        }
    }
    ::close(fd);
    return ok;
}

Transport::Transport(std::string path, Callback cb, double timeoutSec)
    : path_(std::move(path)), timeout_(timeoutSec), cb_(std::move(cb)) {
    info_ = rawInfo(path_);
    fd_ = ::open(path_.c_str(), O_RDWR | O_NONBLOCK);
    if (fd_ < 0) throw std::runtime_error("open " + path_ + ": " + strerror(errno));
    thread_ = std::thread([this] { reader(); });
}

void Transport::setCallback(Callback cb) {
    std::lock_guard<std::mutex> lk(cbMutex_);
    cb_ = std::move(cb);
}

Transport::~Transport() {
    stop_ = true;
    if (thread_.joinable()) thread_.join();
    if (fd_ >= 0) ::close(fd_);
}

void Transport::reader() {
    pollfd p{fd_, POLLIN, 0};
    uint8_t buf[64];
    while (!stop_) {
        int r = ::poll(&p, 1, 200);
        if (r <= 0) continue;
        if (p.revents & (POLLERR | POLLHUP | POLLNVAL)) return;
        ssize_t n = ::read(fd_, buf, sizeof(buf));
        if (n <= 0) continue;
        dispatch(Bytes(buf, buf + n));
    }
}

void Transport::dispatch(const Bytes& d) {
    if (d.size() < 4) return;
    uint8_t rid = d[0];
    if (rid != kShort && rid != kLong && rid != kVeryLong) return;
    uint8_t dev = d[1], b2 = d[2], b3 = d[3];
    {
        std::lock_guard<std::mutex> lk(slotMutex_);
        if (pending_ && dev == pDev_) {
            if ((b2 == 0x8F || b2 == 0xFF) && d.size() >= 6) {
                // error frame: [rid dev 0x8F/0xFF featIdx fn code]
                uint8_t ef = d[3], efn = d[4], code = d[5];
                bool match = (ef == pB2_ && (pMatchSw_ ? (efn & 0xF0) == (pB3_ & 0xF0) : efn == pB3_)) ||
                             (b2 == 0x8F && (efn & 0xF0) == (pB3_ & 0xF0));
                if (match) {
                    error_ = HidppError(code, ef, efn);
                    haveResult_ = true;
                    pending_ = false;
                    cv_.notify_all();
                    return;
                }
            } else if (b2 == pB2_) {
                bool match = pMatchSw_ ? (b3 == pB3_) : (b3 == pB3_);
                if (match) {
                    result_.assign(d.begin() + 4, d.end());
                    haveResult_ = true;
                    pending_ = false;
                    cv_.notify_all();
                    return;
                }
            }
        }
    }
    if (b2 == 0x8F || b2 == 0xFF) return;
    Callback cb;
    {
        std::lock_guard<std::mutex> lk(cbMutex_);
        cb = cb_;
    }
    if (cb) {
        Notification n;
        n.deviceIndex = dev;
        n.featureIndex = b2;
        n.event = b3 >> 4;
        n.swId = b3 & 0x0F;
        n.address = b3;
        n.reportId = rid;
        n.data.assign(d.begin() + 4, d.end());
        try {
            cb(n);
        } catch (...) {
        }
    }
}

Bytes Transport::exchange(const Bytes& frame, uint8_t devIdx, uint8_t b2, uint8_t b3, bool matchSw, bool noReply) {
    std::lock_guard<std::mutex> req(reqMutex_);
    {
        std::lock_guard<std::mutex> lk(slotMutex_);
        pending_ = !noReply;
        pDev_ = devIdx;
        pB2_ = b2;
        pB3_ = b3;
        pMatchSw_ = matchSw;
        haveResult_ = false;
        error_.reset();
        result_.clear();
    }
    ssize_t w = ::write(fd_, frame.data(), frame.size());
    if (w < 0) {
        std::lock_guard<std::mutex> lk(slotMutex_);
        pending_ = false;
        throw std::runtime_error(std::string("write: ") + strerror(errno));
    }
    if (noReply) return {};
    std::unique_lock<std::mutex> lk(slotMutex_);
    if (!cv_.wait_for(lk, std::chrono::duration<double>(timeout_), [this] { return haveResult_; })) {
        pending_ = false;
        throw Timeout("no reply");
    }
    if (error_) throw *error_;
    return result_;
}

Bytes Transport::request(uint8_t devIdx, uint8_t featIdx, uint8_t fn, const Bytes& params,
                         std::optional<bool> longReport, bool noReply) {
    bool lng = longReport.value_or(params.size() > 3 || info_.bustype == 0x05);
    uint8_t fnsw = static_cast<uint8_t>(((fn & 0x0F) << 4) | kSwId);
    Bytes f = {lng ? kLong : kShort, devIdx, featIdx, fnsw};
    f.insert(f.end(), params.begin(), params.end());
    f.resize(lng ? kLongLen : kShortLen, 0);
    return exchange(f, devIdx, featIdx, fnsw, true, noReply);
}

Bytes Transport::request10(uint8_t devIdx, uint8_t subId, uint8_t reg, const Bytes& params, bool longReport) {
    Bytes f = {longReport ? kLong : kShort, devIdx, subId, reg};
    f.insert(f.end(), params.begin(), params.end());
    f.resize(longReport ? kLongLen : kShortLen, 0);
    return exchange(f, devIdx, subId, reg, false, false);
}

std::optional<std::pair<int, int>> Transport::ping(uint8_t devIdx) {
    try {
        Bytes r = request(devIdx, 0x00, 0x1, {0, 0, 0x5a}, false);
        if (r.size() < 2) return std::nullopt;
        return std::make_pair(r[0], r[1]);
    } catch (const HidppError&) {
        return std::make_pair(1, 0);
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

std::optional<PairingInfo> Transport::pairingInfo(uint8_t idx) {
    try {  // Bolt: 0xB5 / 0x50 + idx
        Bytes r = request10(0xFF, 0x83, 0xB5, {static_cast<uint8_t>(0x50 + idx)});
        if (r.size() >= 8 && r[0] == 0x50 + idx) {
            PairingInfo p;
            p.wpid = static_cast<uint16_t>((r[3] << 8) | r[2]);
            p.kind = r[1] & 0x0F;
            char s[9];
            snprintf(s, sizeof(s), "%02X%02X%02X%02X", r[4], r[5], r[6], r[7]);
            p.serial = s;
            return p;
        }
    } catch (const std::exception&) {
    }
    try {  // Unifying / Nano: 0xB5 / 0x20 | (idx-1)
        Bytes r = request10(0xFF, 0x83, 0xB5, {static_cast<uint8_t>(0x20 | (idx - 1))});
        if (r.size() >= 8 && (r[0] & 0x0F) == idx - 1) {
            PairingInfo p;
            p.wpid = static_cast<uint16_t>((r[3] << 8) | r[4]);
            p.kind = r[7] & 0x0F;
            return p;
        }
    } catch (const std::exception&) {
    }
    return std::nullopt;
}

}  // namespace hidpp
