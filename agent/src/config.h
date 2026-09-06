// ~/.config/logimx/config.json
#pragma once
#include <mutex>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

using json = nlohmann::json;

class Config {
  public:
    Config();
    void load();
    void save();
    std::string path() const { return path_; }
    json& data() { return data_; }
    json& device(uint16_t pid, const std::string& kind);
    void setSetting(uint16_t pid, const std::vector<std::string>& path, const json& value);
    void setAssignment(uint16_t pid, const std::string& profile, const std::string& section, const std::string& control, const json& action);
    // Pick the profile for the focused app class: (name, profile)
    std::pair<std::string, json> profileFor(uint16_t pid, const std::string& appClass);
    static std::string key(uint16_t pid);
    std::string backup(const std::string& note);   // copies the config file, returns backup path
    json listBackups();
    bool restoreBackup(const std::string& file);
    std::string backupDir() const;

  private:
    std::string path_;
    json data_;
    std::recursive_mutex m_;
};

const json& controlLabels();
const json& cidNames();
