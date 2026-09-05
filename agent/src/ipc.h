// JSON-lines RPC over a UNIX socket, plus event broadcast to connected clients
#pragma once
#include <atomic>
#include <functional>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "nlohmann/json.hpp"

namespace ipc {

using json = nlohmann::json;

std::string defaultSocketPath();

class Server {
  public:
    using Handler = std::function<json(const std::string& method, const json& params)>;
    Server(Handler h, std::string path = defaultSocketPath());
    ~Server();
    void broadcast(const std::string& event, const json& data);

  private:
    void acceptLoop();
    void serve(int fd);
    Handler handler_;
    std::string path_;
    int fd_ = -1;
    std::atomic<bool> stop_{false};
    std::thread thread_;
    std::mutex clientsMutex_;
    std::set<int> clients_;
};

class Client {
  public:
    explicit Client(std::string path = defaultSocketPath());
    ~Client();
    json call(const std::string& method, const json& params = json::object());

  private:
    int fd_ = -1;
    int id_ = 0;
    std::string buf_;
};

}  // namespace ipc
