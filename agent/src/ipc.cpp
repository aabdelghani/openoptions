#include "ipc.h"

#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <cstring>
#include <stdexcept>

namespace ipc {

std::string defaultSocketPath() {
    const char* rt = getenv("XDG_RUNTIME_DIR");
    std::string base = rt && *rt ? rt : "/run/user/" + std::to_string(getuid());
    return base + "/logimx.sock";
}

static bool writeAll(int fd, const std::string& s) {
    size_t off = 0;
    while (off < s.size()) {
        ssize_t w = ::send(fd, s.data() + off, s.size() - off, MSG_NOSIGNAL);
        if (w <= 0) return false;
        off += static_cast<size_t>(w);
    }
    return true;
}

Server::Server(Handler h, std::string path) : handler_(std::move(h)), path_(std::move(path)) {
    ::unlink(path_.c_str());
    fd_ = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd_ < 0) throw std::runtime_error("socket");
    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, path_.c_str(), sizeof(addr.sun_path) - 1);
    if (::bind(fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) throw std::runtime_error("bind " + path_ + ": " + strerror(errno));
    chmod(path_.c_str(), 0600);
    ::listen(fd_, 64);
    thread_ = std::thread([this] { acceptLoop(); });
}

Server::~Server() {
    stop_ = true;
    ::shutdown(fd_, SHUT_RDWR);
    ::close(fd_);
    if (thread_.joinable()) thread_.join();
    {
        std::lock_guard<std::mutex> lk(clientsMutex_);
        for (int c : clients_) ::shutdown(c, SHUT_RDWR);
    }
    ::unlink(path_.c_str());
}

void Server::acceptLoop() {
    while (!stop_) {
        pollfd p{fd_, POLLIN, 0};
        if (::poll(&p, 1, 300) <= 0) continue;
        for (;;) {  // drain everything pending
            int c = ::accept4(fd_, nullptr, nullptr, SOCK_CLOEXEC | SOCK_NONBLOCK);
            if (c < 0) break;
            int fl = fcntl(c, F_GETFL);
            if (fl >= 0) fcntl(c, F_SETFL, fl & ~O_NONBLOCK);
            {
                std::lock_guard<std::mutex> lk(clientsMutex_);
                clients_.insert(c);
            }
            std::thread([this, c] { serve(c); }).detach();
        }
    }
}

void Server::serve(int fd) {
    std::string buf;
    char tmp[4096];
    while (!stop_) {
        ssize_t n = ::recv(fd, tmp, sizeof(tmp), 0);
        if (n <= 0) break;
        buf.append(tmp, static_cast<size_t>(n));
        if (buf.size() > 8 * 1024 * 1024 && buf.find('\n') == std::string::npos) break;  // oversized request, drop client
        size_t nl;
        while ((nl = buf.find('\n')) != std::string::npos) {
            std::string line = buf.substr(0, nl);
            buf.erase(0, nl + 1);
            json resp, reqId;
            try {
                json req = json::parse(line);
                if (req.is_object()) reqId = req.value("id", json());
                json params = req.is_object() ? req.value("params", json::object()) : json::object();
                if (!params.is_object()) params = json::object();
                resp = {{"id", reqId}, {"result", handler_(req.is_object() ? req.value("method", "") : "", params)}};
            } catch (const std::exception& e) {
                resp = {{"id", reqId}, {"error", e.what()}};
            }
            if (!writeAll(fd, resp.dump() + "\n")) break;
        }
    }
    {
        std::lock_guard<std::mutex> lk(clientsMutex_);
        clients_.erase(fd);
    }
    ::close(fd);
}

void Server::broadcast(const std::string& event, const json& data) {
    std::string msg = json{{"event", event}, {"data", data}}.dump() + "\n";
    std::lock_guard<std::mutex> lk(clientsMutex_);
    for (int c : clients_) writeAll(c, msg);
}

Client::Client(std::string path) {
    fd_ = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, path.c_str(), sizeof(addr.sun_path) - 1);
    if (::connect(fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        ::close(fd_);
        fd_ = -1;
        throw std::runtime_error("agent not running (" + path + ")");
    }
}

Client::~Client() {
    if (fd_ >= 0) ::close(fd_);
}

json Client::call(const std::string& method, const json& params) {
    json req = {{"id", ++id_}, {"method", method}, {"params", params}};
    if (!writeAll(fd_, req.dump() + "\n")) throw std::runtime_error("send failed");
    char tmp[4096];
    for (;;) {
        size_t nl = buf_.find('\n');
        if (nl != std::string::npos) {
            std::string line = buf_.substr(0, nl);
            buf_.erase(0, nl + 1);
            json resp = json::parse(line);
            if (resp.contains("event")) continue;  // ignore broadcasts on a request socket
            if (resp.contains("error")) throw std::runtime_error(resp["error"].get<std::string>());
            return resp["result"];
        }
        ssize_t n = ::recv(fd_, tmp, sizeof(tmp), 0);
        if (n <= 0) throw std::runtime_error("agent closed the connection");
        buf_.append(tmp, static_cast<size_t>(n));
    }
}

}  // namespace ipc
