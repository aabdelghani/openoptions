#include "tracker.h"

#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace apps {

Tracker::~Tracker() { stop(); }

void Tracker::start() {
    const char* session = getenv("XDG_SESSION_TYPE");
    const char* desktop = getenv("XDG_CURRENT_DESKTOP");
    std::string s = session ? session : "", d = desktop ? desktop : "";
    if (s == "x11" || (s.empty() && getenv("DISPLAY"))) {
        backend_ = "x11";
        thread_ = std::thread([this] { x11Loop(); });
    } else if (s == "wayland" && d.find("GNOME") != std::string::npos) {
        backend_ = "gnome-wayland";
        thread_ = std::thread([this] { gnomeLoop(); });
    } else if (getenv("SWAYSOCK")) {
        backend_ = "sway";
        thread_ = std::thread([this] { swayLoop(); });
    }
}

void Tracker::stop() {
    stop_ = true;
    if (thread_.joinable()) thread_.join();
}

void Tracker::set(const std::string& cls) {
    if (cls == current_) return;
    current_ = cls;
    if (cb_) cb_(cls);
}

static int silentHandler(Display*, XErrorEvent*) { return 0; }

void Tracker::x11Loop() {
    Display* dpy = XOpenDisplay(nullptr);
    if (!dpy) {
        backend_ = "none";
        return;
    }
    XSetErrorHandler(silentHandler);
    Window root = DefaultRootWindow(dpy);
    Atom netActive = XInternAtom(dpy, "_NET_ACTIVE_WINDOW", False);
    XSelectInput(dpy, root, PropertyChangeMask);

    auto readActive = [&]() -> std::string {
        Atom type;
        int fmt;
        unsigned long n, after;
        unsigned char* data = nullptr;
        std::string cls;
        if (XGetWindowProperty(dpy, root, netActive, 0, 1, False, XA_WINDOW, &type, &fmt, &n, &after, &data) == Success && data) {
            Window w = *reinterpret_cast<Window*>(data);
            XFree(data);
            if (w) {
                XClassHint hint{};
                if (XGetClassHint(dpy, w, &hint)) {
                    cls = hint.res_class ? hint.res_class : (hint.res_name ? hint.res_name : "");
                    if (hint.res_name) XFree(hint.res_name);
                    if (hint.res_class) XFree(hint.res_class);
                }
            }
        }
        return cls;
    };
    set(readActive());
    int fd = ConnectionNumber(dpy);
    while (!stop_) {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(fd, &fds);
        timeval tv{0, 200000};
        if (select(fd + 1, &fds, nullptr, nullptr, &tv) <= 0 && !XPending(dpy)) continue;
        while (XPending(dpy)) {
            XEvent ev;
            XNextEvent(dpy, &ev);
            if (ev.type == PropertyNotify && ev.xproperty.atom == netActive) set(readActive());
        }
    }
    XCloseDisplay(dpy);
}

void Tracker::gnomeLoop() {
    while (!stop_) {
        std::string cls;
        FILE* p = popen("gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Introspect "
                        "--method org.gnome.Shell.Introspect.GetWindows 2>/dev/null", "r");
        if (p) {
            std::string out;
            char buf[4096];
            while (fgets(buf, sizeof(buf), p)) out += buf;
            pclose(p);
            size_t pos = out.find("'has-focus': <true>");
            if (pos != std::string::npos) {
                size_t start = out.rfind('{', pos);
                size_t end = out.find('}', pos);
                std::string chunk = out.substr(start == std::string::npos ? 0 : start, end == std::string::npos ? std::string::npos : end - start);
                size_t k = chunk.find("'wm-class': <'");
                if (k != std::string::npos) {
                    k += strlen("'wm-class': <'");
                    cls = chunk.substr(k, chunk.find('\'', k) - k);
                }
            }
        }
        set(cls);
        for (int i = 0; i < 7 && !stop_; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

}  // namespace apps

namespace apps {

// sway / i3: poll the focused node's app_id (Wayland) or window class (XWayland)
void Tracker::swayLoop() {
    while (!stop_) {
        std::string cls;
        FILE* p = popen("swaymsg -t get_tree 2>/dev/null", "r");
        if (p) {
            std::string out;
            char buf[8192];
            while (fgets(buf, sizeof(buf), p)) out += buf;
            pclose(p);
            size_t pos = out.find("\"focused\": true");
            if (pos != std::string::npos) {
                size_t a = out.find("\"app_id\": \"", pos);
                size_t c = out.find("\"class\": \"", pos);
                size_t k = std::min(a == std::string::npos ? out.size() : a, c == std::string::npos ? out.size() : c);
                if (k < out.size()) {
                    k = out.find('"', out.find(':', k)) + 1;
                    cls = out.substr(k, out.find('"', k) - k);
                }
            }
        }
        set(cls);
        for (int i = 0; i < 7 && !stop_; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

}  // namespace apps
