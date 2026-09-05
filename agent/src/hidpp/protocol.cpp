#include "protocol.h"

#include <cstdio>
#include <cstring>

namespace hidpp {

static const std::map<int, std::string> kDeviceTypes = {
    {0, "keyboard"}, {1, "remote"}, {2, "numpad"}, {3, "mouse"}, {4, "trackpad"}, {5, "trackball"},
    {6, "presenter"}, {7, "receiver"}, {8, "headset"}, {9, "webcam"}, {10, "steering wheel"}};

static inline uint16_t be16(const Bytes& b, size_t i) { return static_cast<uint16_t>((b[i] << 8) | b[i + 1]); }
static inline int16_t sbe16(const Bytes& b, size_t i) { return static_cast<int16_t>(be16(b, i)); }
static inline uint16_t le16(const Bytes& b, size_t i) { return static_cast<uint16_t>(b[i] | (b[i + 1] << 8)); }

Bytes Device::req(uint16_t feature, uint8_t fn, const Bytes& params, bool noReply) {
    auto it = features_.find(feature);
    if (it == features_.end()) throw HidppError(0x06, 0, fn << 4);
    return t_.request(index_, it->second.index, fn, params, std::nullopt, noReply);
}

const FeatureInfo* Device::featureByIndex(uint8_t idx) const {
    for (auto& [id, f] : features_)
        if (f.index == idx) return &f;
    return nullptr;
}

bool Device::enumerate() {
    auto pv = t_.ping(index_);
    if (!pv || pv->first < 2) return false;
    features_.clear();
    features_[ROOT] = {ROOT, 0, 0, 0};
    Bytes r = t_.request(index_, 0, 0, {static_cast<uint8_t>(FEATURE_SET >> 8), static_cast<uint8_t>(FEATURE_SET & 0xFF)}, false);
    if (r.size() < 3 || r[0] == 0) return false;
    uint8_t fs = r[0];
    features_[FEATURE_SET] = {FEATURE_SET, fs, r[2], 0};
    int count = t_.request(index_, fs, 0, {}, false)[0];
    for (int i = 1; i <= count; ++i) {
        Bytes fr = t_.request(index_, fs, 1, {static_cast<uint8_t>(i)}, false);
        if (fr.size() < 4) continue;
        uint16_t fid = be16(fr, 0);
        features_[fid] = {fid, static_cast<uint8_t>(i), fr[3], fr[2]};
    }
    readIdentity();
    if (has(SPECIAL_KEYS)) readControls();
    return true;
}

void Device::readIdentity() {
    try {
        if (has(DEVICE_NAME)) {
            int n = req(DEVICE_NAME, 0)[0];
            std::string name;
            while (static_cast<int>(name.size()) < n) {
                Bytes r = req(DEVICE_NAME, 1, {static_cast<uint8_t>(name.size())});
                if (r.empty()) break;
                name.append(reinterpret_cast<const char*>(r.data()), r.size());
            }
            name_ = name.substr(0, n);
            int type = req(DEVICE_NAME, 2)[0];
            auto it = kDeviceTypes.find(type);
            kind_ = it == kDeviceTypes.end() ? "unknown" : it->second;
        }
    } catch (const std::exception&) {
    }
    try {
        if (has(FRIENDLY_NAME)) {
            int n = req(FRIENDLY_NAME, 0)[0];
            std::string fn;
            while (static_cast<int>(fn.size()) < n) {
                Bytes r = req(FRIENDLY_NAME, 1, {static_cast<uint8_t>(fn.size())});
                if (r.size() < 2) break;
                fn.append(reinterpret_cast<const char*>(r.data() + 1), r.size() - 1);
            }
            friendlyName_ = fn.substr(0, n);
        }
    } catch (const std::exception&) {
    }
    try {
        if (has(DEVICE_FW)) {
            int cnt = req(DEVICE_FW, 0)[0];
            for (int e = 0; e < cnt; ++e) {
                Bytes r = req(DEVICE_FW, 1, {static_cast<uint8_t>(e)});
                if (r.size() >= 8 && r[0] == 0) {
                    char buf[48];
                    snprintf(buf, sizeof(buf), "%c%c%c %02X.%02X.B%04X", r[1], r[2], r[3], r[4], r[5], be16(r, 6));
                    firmware_ = buf;
                }
            }
            if (features_[DEVICE_FW].version >= 4) {
                Bytes r = req(DEVICE_FW, 2);
                std::string s(reinterpret_cast<const char*>(r.data()), std::min<size_t>(12, r.size()));
                while (!s.empty() && s.back() == '\0') s.pop_back();
                serial_ = s;
            }
        }
    } catch (const std::exception&) {
    }
}

void Device::readControls() {
    controls_.clear();
    int cnt = req(SPECIAL_KEYS, 0)[0];
    for (int i = 0; i < cnt; ++i) {
        Bytes r = req(SPECIAL_KEYS, 1, {static_cast<uint8_t>(i)});
        if (r.size() < 9) continue;
        ControlInfo c;
        c.cid = be16(r, 0);
        c.taskId = be16(r, 2);
        c.flags = r[4];
        c.position = r[5];
        c.group = r[6];
        c.groupMask = r[7];
        c.extraFlags = r[8];
        controls_[c.cid] = c;
    }
}

Battery Device::decodeBattery(const Bytes& r) {
    Battery b;
    if (r.size() < 3) return b;
    b.percent = r[0];
    static const std::map<int, std::string> lv = {{8, "full"}, {4, "good"}, {2, "low"}, {1, "critical"}};
    auto it = lv.find(r[1]);
    b.level = it == lv.end() ? "unknown" : it->second;
    b.charging = r[2] >= 1 && r[2] <= 3;
    b.externalPower = r.size() > 3 && r[3];
    return b;
}

std::optional<Battery> Device::battery() {
    if (!has(UNIFIED_BATTERY)) return std::nullopt;
    return decodeBattery(req(UNIFIED_BATTERY, 1));
}

std::pair<uint8_t, uint16_t> Device::getReporting(uint16_t cid) {
    Bytes r = req(SPECIAL_KEYS, 2, {static_cast<uint8_t>(cid >> 8), static_cast<uint8_t>(cid)});
    return {r[2], be16(r, 3)};
}

void Device::setReporting(uint16_t cid, std::optional<bool> divert, std::optional<bool> rawXY, uint16_t remap) {
    uint8_t flags = 0;
    if (divert) flags |= 0x02 | (*divert ? 0x01 : 0);
    if (rawXY) flags |= 0x20 | (*rawXY ? 0x10 : 0);
    req(SPECIAL_KEYS, 3, {static_cast<uint8_t>(cid >> 8), static_cast<uint8_t>(cid), flags,
                          static_cast<uint8_t>(remap >> 8), static_cast<uint8_t>(remap)});
}

std::optional<SmartShiftState> Device::smartshift() {
    if (has(SMART_SHIFT)) {
        Bytes r = req(SMART_SHIFT, 0);
        return SmartShiftState{r[0], r[1], r[2]};
    }
    if (has(SMART_SHIFT_ENHANCED)) {
        Bytes r = req(SMART_SHIFT_ENHANCED, 1);
        return SmartShiftState{r[0], r[1], r[2]};
    }
    return std::nullopt;
}

void Device::setSmartshift(int mode, int threshold) {
    Bytes p = {static_cast<uint8_t>(mode), static_cast<uint8_t>(threshold), 0};
    if (has(SMART_SHIFT)) req(SMART_SHIFT, 1, p);
    else if (has(SMART_SHIFT_ENHANCED)) req(SMART_SHIFT_ENHANCED, 2, p);
}

std::optional<HiResState> Device::hires() {
    if (!has(HIRES_WHEEL)) return std::nullopt;
    Bytes cap = req(HIRES_WHEEL, 0);
    uint8_t mode = req(HIRES_WHEEL, 1)[0];
    HiResState s;
    s.hidppTarget = mode & 0x01;
    s.hires = mode & 0x02;
    s.invert = mode & 0x04;
    s.multiplier = cap[0];
    s.hasInvert = cap[1] & 0x08;
    s.hasRatchetSwitch = cap[1] & 0x04;
    return s;
}

void Device::setHires(bool hidppTarget, bool hires, bool invert) {
    req(HIRES_WHEEL, 2, {static_cast<uint8_t>((hidppTarget ? 1 : 0) | (hires ? 2 : 0) | (invert ? 4 : 0))});
}

std::optional<ThumbWheelState> Device::thumbwheel() {
    if (!has(THUMB_WHEEL)) return std::nullopt;
    Bytes info = req(THUMB_WHEEL, 0);
    Bytes st = req(THUMB_WHEEL, 1);
    ThumbWheelState s;
    s.diverted = st[0] & 0x01;
    s.invert = st[1] & 0x01;
    s.nativeRes = be16(info, 0);
    s.divertedRes = be16(info, 2);
    s.capabilities = info[4];
    return s;
}

void Device::setThumbwheel(bool diverted, bool invert) {
    req(THUMB_WHEEL, 2, {static_cast<uint8_t>(diverted), static_cast<uint8_t>(invert)});
}

std::optional<DpiState> Device::dpi() {
    if (!has(ADJUSTABLE_DPI)) return std::nullopt;
    Bytes r = req(ADJUSTABLE_DPI, 2, {0});
    DpiState s;
    s.dpi = be16(r, 1);
    s.def = be16(r, 3);
    Bytes lst = req(ADJUSTABLE_DPI, 1, {0});
    std::vector<int> vals;
    for (size_t i = 1; i + 1 < lst.size(); i += 2) {
        uint16_t v = be16(lst, i);
        if (v == 0) break;
        if ((v & 0xE000) == 0xE000) {
            s.stepped = true;
            vals.push_back(v & 0x1FFF);
        } else {
            vals.push_back(v);
        }
    }
    if (s.stepped && vals.size() >= 3) s.levels = {vals[0], vals[2], vals[1]};  // min, max, step
    else s.levels = vals;
    return s;
}

void Device::setDpi(int dpi) {
    req(ADJUSTABLE_DPI, 3, {0, static_cast<uint8_t>(dpi >> 8), static_cast<uint8_t>(dpi)});
}

std::optional<BacklightState> Device::backlight() {
    if (!has(BACKLIGHT2)) return std::nullopt;
    Bytes r = req(BACKLIGHT2, 0);
    if (r.size() < 12) return std::nullopt;
    BacklightState s;
    s.enabled = r[0];
    s.options = r[1];
    s.supported = r[2];
    s.effects = le16(r, 3);
    s.level = r[5];
    s.dho = le16(r, 6);
    s.dhi = le16(r, 8);
    s.dpow = le16(r, 10);
    try {
        Bytes i = req(BACKLIGHT2, 2);
        s.numLevels = i[0];
        s.currentLevel = i[1];
        s.status = i[2];
    } catch (const std::exception&) {
    }
    return s;
}

void Device::setBacklight(bool enabled, std::optional<int> mode, std::optional<int> level,
                          std::optional<int> dho, std::optional<int> dhi, std::optional<int> dpow) {
    auto cur = backlight();
    if (!cur) return;
    if (dho) cur->dho = *dho;
    if (dhi) cur->dhi = *dhi;
    if (dpow) cur->dpow = *dpow;
    int m = mode.value_or(cur->mode());
    uint8_t options = static_cast<uint8_t>((cur->options & 0x07) | ((m & 0x03) << 3));
    int lvl = level.value_or(cur->level);
    if (m != 3) lvl = 0;
    Bytes p = {static_cast<uint8_t>(enabled), options, 0xFF, static_cast<uint8_t>(lvl),
               static_cast<uint8_t>(cur->dho & 0xFF), static_cast<uint8_t>(cur->dho >> 8),
               static_cast<uint8_t>(cur->dhi & 0xFF), static_cast<uint8_t>(cur->dhi >> 8),
               static_cast<uint8_t>(cur->dpow & 0xFF), static_cast<uint8_t>(cur->dpow >> 8)};
    req(BACKLIGHT2, 1, p);
}

std::vector<HostInfo> Device::hosts() {
    std::vector<HostInfo> out;
    if (!has(HOSTS_INFO)) return out;
    Bytes st = req(HOSTS_INFO, 0);
    int caps = st[0], num = st[2];
    for (int h = 0; h < num; ++h) {
        Bytes r = req(HOSTS_INFO, 1, {static_cast<uint8_t>(h)});
        HostInfo hi;
        hi.index = h;
        hi.paired = r[1];
        hi.busType = r[2];
        int nlen = r[4];
        std::string name;
        if (caps & 0x01) {
            while (static_cast<int>(name.size()) < nlen) {
                Bytes piece = req(HOSTS_INFO, 3, {static_cast<uint8_t>(h), static_cast<uint8_t>(name.size())});
                size_t take = std::min<size_t>(14, nlen - name.size());
                if (piece.size() < 2 + take) take = piece.size() > 2 ? piece.size() - 2 : 0;
                if (take == 0) break;
                name.append(reinterpret_cast<const char*>(piece.data() + 2), take);
            }
        }
        hi.name = name;
        out.push_back(hi);
    }
    return out;
}

void Device::setHostName(int host, const std::string& name) {
    if (!has(HOSTS_INFO)) return;
    std::string n = name.substr(0, 24);
    for (size_t off = 0; off < n.size(); off += 14) {
        Bytes p = {static_cast<uint8_t>(host), static_cast<uint8_t>(off)};
        std::string chunk = n.substr(off, 14);
        p.insert(p.end(), chunk.begin(), chunk.end());
        req(HOSTS_INFO, 4, p);
    }
}

std::pair<int, int> Device::currentHost() {
    if (has(CHANGE_HOST)) {
        Bytes r = req(CHANGE_HOST, 0);
        return {r[0], r[1]};
    }
    if (has(HOSTS_INFO)) {
        Bytes r = req(HOSTS_INFO, 0);
        return {r[2], r[3]};
    }
    return {0, 0};
}

void Device::changeHost(int host) {
    if (!has(CHANGE_HOST)) return;
    auto [n, cur] = currentHost();
    if (host < 0 || host >= n) throw std::runtime_error("host index out of range");
    if (host == cur) return;
    req(CHANGE_HOST, 1, {static_cast<uint8_t>(host)}, true);
}

// 0x40A3 is per host. The MX Keys S firmware does not accept 0xFF as "current host" (reads
// come back 0 and writes are ignored), so address the host the keyboard is connected to.
uint8_t Device::fnHost() {
    if (fnHost_ < 0) {
        try { fnHost_ = (has(CHANGE_HOST) || has(HOSTS_INFO)) ? currentHost().second : 0; } catch (...) { fnHost_ = 0; }
        if (fnHost_ < 0) fnHost_ = 0;
    }
    return static_cast<uint8_t>(fnHost_);
}

std::optional<bool> Device::fnInversion() {
    if (!has(FN_INVERSION_K375S)) return std::nullopt;
    Bytes r = req(FN_INVERSION_K375S, 0, {fnHost()});
    return r.size() > 1 && r[1];
}

void Device::setFnInversion(bool on) {
    if (has(FN_INVERSION_K375S)) req(FN_INVERSION_K375S, 1, {fnHost(), static_cast<uint8_t>(on)});
}

std::optional<Event> Device::classify(const Notification& n) const {
    if (n.deviceIndex != index_) return std::nullopt;
    const FeatureInfo* f = featureByIndex(n.featureIndex);
    if (!f) return std::nullopt;
    const Bytes& d = n.data;
    switch (f->id) {
        case SPECIAL_KEYS:
            if (n.event == 0 && d.size() >= 8) {
                json cids = json::array();
                for (int i = 0; i < 4; ++i) {
                    uint16_t c = be16(d, i * 2);
                    if (c) cids.push_back(c);
                }
                return Event{"buttons", {{"down", cids}}};
            }
            if (n.event == 1 && d.size() >= 4) return Event{"raw_xy", {{"dx", sbe16(d, 0)}, {"dy", sbe16(d, 2)}}};
            break;
        case FN_INVERSION_K375S:
            if (n.event == 0 && d.size() >= 2) return Event{"fn_swap", {{"host", d[0]}, {"on", d[1] != 0}}};
            break;
        case THUMB_WHEEL:
            if (n.event == 0 && d.size() >= 5)
                return Event{"thumbwheel", {{"rotation", sbe16(d, 0)}, {"timestamp", be16(d, 2)}, {"status", d[4]}}};
            break;
        case HIRES_WHEEL:
            if (n.event == 0 && d.size() >= 3) return Event{"wheel", {{"hires", (d[0] & 0x10) != 0}, {"delta", sbe16(d, 1)}}};
            if (n.event == 1 && !d.empty()) return Event{"ratchet", {{"ratchet", d[0] != 0}}};
            break;
        case UNIFIED_BATTERY:
            if (n.event == 0) return Event{"battery", decodeBattery(d).toJson()};
            break;
        case WIRELESS_STATUS:
            return Event{"wireless", {{"reconnect", !d.empty() && d[0] != 0}}};
        case CONFIG_CHANGE:
            return Event{"config_change", json::object()};
        case BACKLIGHT2:
            if (n.event == 0 && d.size() >= 3) return Event{"backlight", {{"num_levels", d[0]}, {"level", d[1]}, {"status", d[2]}}};
            break;
        default:
            break;
    }
    return std::nullopt;
}

}  // namespace hidpp
