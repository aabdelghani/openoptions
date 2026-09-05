#include "discovery.h"

#include <unistd.h>

#include <algorithm>
#include <filesystem>

#include "transport.h"

namespace hidpp {

std::vector<Node> scan() {
    std::vector<Node> out;
    std::vector<std::filesystem::path> paths;
    for (auto& e : std::filesystem::directory_iterator("/dev")) {
        auto n = e.path().filename().string();
        if (n.rfind("hidraw", 0) == 0) paths.push_back(e.path());
    }
    std::sort(paths.begin(), paths.end(), [](auto& a, auto& b) {
        return std::stoi(a.filename().string().substr(6)) < std::stoi(b.filename().string().substr(6));
    });
    for (auto& p : paths) {
        std::string s = p.string();
        if (access(s.c_str(), R_OK | W_OK) != 0) continue;
        RawInfo info;
        try {
            info = rawInfo(s);
        } catch (...) {
            continue;
        }
        if (info.vendor != 0x046D) continue;
        if (!supportsHidpp(s)) continue;
        out.push_back(Node{s, info.name, info.vendor, info.product, info.bustype});
    }
    return out;
}

std::vector<Node> usable(const std::vector<Node>& nodes) {
    std::vector<Node> out;
    for (auto& n : nodes)
        if (n.isReceiver() || n.isBluetooth()) out.push_back(n);
    return out;
}

}  // namespace hidpp
