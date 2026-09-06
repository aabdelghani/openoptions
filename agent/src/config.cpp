#include "config.h"

#include <sys/stat.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <dirent.h>
#include <ctime>
#include <algorithm>

#include "tables.gen.h"

const json& controlLabels() {
    static const json j = json::parse(kControlLabelsJson);
    return j;
}
const json& cidNames() {
    static const json j = json::parse(kCidNamesJson);
    return j;
}

std::string Config::key(uint16_t pid) {
    char b[8];
    snprintf(b, sizeof(b), "%04x", pid);
    return b;
}

// The project was called openoptions before 0.4. Carry a configuration over once so an upgrade
// keeps every assignment, profile and backup.
static void migrateFromOldName(const std::string& base, const std::string& newDir) {
    std::string oldDir = base + "/openoptions";
    struct stat st{};
    if (stat(newDir.c_str(), &st) == 0) return;          // already on the new path
    if (stat(oldDir.c_str(), &st) != 0) return;          // nothing to carry over
    std::string cmd = "cp -a '" + oldDir + "' '" + newDir + "' 2>/dev/null";
    if (std::system(cmd.c_str()) != 0) { /* best effort */ }
}

Config::Config() {
    const char* xdg = getenv("XDG_CONFIG_HOME");
    std::string base = xdg && *xdg ? xdg : std::string(getenv("HOME") ? getenv("HOME") : "/tmp") + "/.config";
    migrateFromOldName(base, base + "/logimx");
    path_ = base + "/logimx/config.json";
    data_ = {{"devices", json::object()}, {"general", {{"desktop", "gnome"}}}};
    load();
}

void Config::load() {
    std::lock_guard<std::recursive_mutex> lk(m_);
    std::ifstream f(path_);
    if (f) {
        try {
            json j = json::parse(f);
            if (j.is_object()) data_ = j;
        } catch (...) {
        }
    }
    if (!data_.is_object()) data_ = json::object();
    if (!data_.contains("devices") || !data_["devices"].is_object()) data_["devices"] = json::object();
    if (!data_.contains("general") || !data_["general"].is_object()) data_["general"] = {{"desktop", "gnome"}};
    for (auto it = data_["devices"].begin(); it != data_["devices"].end();) {
        json& d = it.value();
        bool ok = d.is_object() && d.value("settings", json::object()).is_object() && d.value("profiles", json::object()).is_object();
        if (!ok) it = data_["devices"].erase(it); else ++it;
    }
}

void Config::save() {
    std::lock_guard<std::recursive_mutex> lk(m_);
    std::string dir = path_.substr(0, path_.rfind('/'));
    std::string parent = dir.substr(0, dir.rfind('/'));
    mkdir(parent.c_str(), 0755);
    mkdir(dir.c_str(), 0755);
    std::string tmp = path_ + ".tmp";
    {
        std::ofstream o(tmp);
        o << data_.dump(2) << "\n";
    }
    std::rename(tmp.c_str(), path_.c_str());
}

json& Config::device(uint16_t pid, const std::string& kind) {
    std::lock_guard<std::recursive_mutex> lk(m_);
    std::string k = key(pid);
    json& devs = data_["devices"];
    if (!devs.contains(k)) {
        static const json defaults = json::parse(kDefaultsJson);
        if (defaults.contains(k)) {
            devs[k] = defaults[k];
        } else if (kind == "keyboard") {
            devs[k] = {{"settings", json::object()}, {"profiles", {{"default", {{"name", "All applications"}, {"keys", json::object()}}}}}};
        } else {
            devs[k] = {{"settings", json::object()}, {"profiles", {{"default", {{"name", "All applications"}, {"buttons", json::object()}, {"thumbwheel", "native"}}}}}};
        }
        save();
    }
    return devs[k];
}

void Config::setSetting(uint16_t pid, const std::vector<std::string>& path, const json& value) {
    std::lock_guard<std::recursive_mutex> lk(m_);
    json* d = &device(pid, "")["settings"];
    for (size_t i = 0; i + 1 < path.size(); ++i) {
        if (!d->contains(path[i]) || !(*d)[path[i]].is_object()) (*d)[path[i]] = json::object();
        d = &(*d)[path[i]];
    }
    (*d)[path.back()] = value;
    save();
}

void Config::setAssignment(uint16_t pid, const std::string& profile, const std::string& section, const std::string& control, const json& action) {
    std::lock_guard<std::recursive_mutex> lk(m_);
    json& profs = device(pid, "")["profiles"];
    if (!profs.contains(profile)) profs[profile] = {{"name", profile}};
    if (section == "thumbwheel") profs[profile]["thumbwheel"] = action;
    else profs[profile][section][control] = action;
    save();
}

std::pair<std::string, json> Config::profileFor(uint16_t pid, const std::string& appClass) {
    std::lock_guard<std::recursive_mutex> lk(m_);
    json& profs = device(pid, "")["profiles"];
    if (!appClass.empty()) {
        std::string lc = appClass;
        std::transform(lc.begin(), lc.end(), lc.begin(), ::tolower);
        for (auto& [name, p] : profs.items()) {
            if (name == "default" || !p.contains("match")) continue;
            for (auto& m : p["match"]) {
                std::string ms = m.get<std::string>();
                std::transform(ms.begin(), ms.end(), ms.begin(), ::tolower);
                if (!ms.empty() && lc.find(ms) != std::string::npos) return {name, p};
            }
        }
    }
    return {"default", profs.value("default", json::object())};
}

std::string Config::backupDir() const { return path_.substr(0, path_.rfind('/')) + "/backups"; }

std::string Config::backup(const std::string& note) {
    std::lock_guard<std::recursive_mutex> lk(m_);
    std::ifstream in(path_, std::ios::binary);
    if (!in) return "";
    std::string dir = backupDir();
    mkdir(dir.c_str(), 0755);
    std::time_t t = std::time(nullptr);
    char stamp[32];
    std::strftime(stamp, sizeof(stamp), "%Y%m%d-%H%M%S", std::localtime(&t));
    std::string file = dir + "/config-" + stamp + ".json";
    { std::ofstream out(file, std::ios::binary); out << in.rdbuf(); }
    json idx = json::object();
    { std::ifstream f(dir + "/index.json"); if (f) { try { idx = json::parse(f); } catch (...) {} } }
    if (!idx.is_object()) idx = json::object();
    idx[file.substr(dir.size() + 1)] = {{"note", note}, {"time", static_cast<long>(t)}};
    // keep the newest 15
    std::vector<std::string> names;
    for (auto& [k, v] : idx.items()) names.push_back(k);
    std::sort(names.begin(), names.end());
    while (names.size() > 15) { unlink((dir + "/" + names.front()).c_str()); idx.erase(names.front()); names.erase(names.begin()); }
    { std::ofstream f(dir + "/index.json"); f << idx.dump(2); }
    return file;
}

json Config::listBackups() {
    std::lock_guard<std::recursive_mutex> lk(m_);
    json out = json::array();
    std::string dir = backupDir();
    json idx = json::object();
    { std::ifstream f(dir + "/index.json"); if (f) { try { idx = json::parse(f); } catch (...) {} } }
    std::vector<std::string> names;
    for (auto& [k, v] : idx.items()) names.push_back(k);
    std::sort(names.rbegin(), names.rend());
    for (auto& n : names) {
        std::time_t t = idx[n].value("time", 0L);
        char when[48];
        std::strftime(when, sizeof(when), "%b %e, %H:%M", std::localtime(&t));
        out.push_back({{"file", n}, {"when", when}, {"note", idx[n].value("note", "")}, {"time", static_cast<long>(t)}});
    }
    return out;
}

bool Config::restoreBackup(const std::string& file) {
    std::lock_guard<std::recursive_mutex> lk(m_);
    if (file.find('/') != std::string::npos || file.find("..") != std::string::npos) return false;
    std::ifstream in(backupDir() + "/" + file);
    if (!in) return false;
    json j;
    try { j = json::parse(in); } catch (...) { return false; }
    if (!j.is_object()) return false;
    backup("Before restore");
    data_ = j;
    if (!data_.contains("devices") || !data_["devices"].is_object()) data_["devices"] = json::object();
    if (!data_.contains("general") || !data_["general"].is_object()) data_["general"] = json::object();
    save();
    return true;
}
