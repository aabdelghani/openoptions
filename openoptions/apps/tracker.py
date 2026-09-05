"""Focused-application tracker.

X11: listens for _NET_ACTIVE_WINDOW changes on the root window and reports the
window's WM_CLASS. Wayland (GNOME): polls org.gnome.Shell.Introspect when the
interface is available. Otherwise reports None and only the default profile is used.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from typing import Callable, Optional


class AppTracker:
    def __init__(self, on_change: Callable[[Optional[str]], None]):
        self.on_change = on_change
        self.current: Optional[str] = None
        self._stop = threading.Event()
        self.backend = "none"
        self._thread: Optional[threading.Thread] = None

    def start(self):
        session = os.environ.get("XDG_SESSION_TYPE", "")
        if session == "x11" or (not session and os.environ.get("DISPLAY")):
            try:
                import Xlib  # noqa: F401
                self.backend = "x11"
                self._thread = threading.Thread(target=self._x11_loop, daemon=True, name="app-tracker-x11")
            except ImportError:
                self.backend = "none"
        elif session == "wayland" and "GNOME" in os.environ.get("XDG_CURRENT_DESKTOP", "").upper():
            self.backend = "gnome-wayland"
            self._thread = threading.Thread(target=self._gnome_loop, daemon=True, name="app-tracker-gnome")
        if self._thread:
            self._thread.start()

    def stop(self):
        self._stop.set()

    def _set(self, cls: Optional[str]):
        if cls != self.current:
            self.current = cls
            try:
                self.on_change(cls)
            except Exception:
                pass

    # ------------------------------------------------------------------ X11
    def _x11_loop(self):
        from Xlib import X, display

        try:
            d = display.Display()
        except Exception:
            self.backend = "none"
            return
        root = d.screen().root
        NET_ACTIVE = d.intern_atom("_NET_ACTIVE_WINDOW")
        root.change_attributes(event_mask=X.PropertyChangeMask)

        def read_active():
            try:
                prop = root.get_full_property(NET_ACTIVE, X.AnyPropertyType)
                if not prop or not prop.value:
                    return None
                wid = prop.value[0]
                if not wid:
                    return None
                win = d.create_resource_object("window", wid)
                cls = win.get_wm_class()
                if cls:
                    return cls[1] or cls[0]
                return None
            except Exception:
                return None

        self._set(read_active())
        while not self._stop.is_set():
            if d.pending_events():
                ev = d.next_event()
                if ev.type == X.PropertyNotify and ev.atom == NET_ACTIVE:
                    self._set(read_active())
            else:
                time.sleep(0.05)

    # ---------------------------------------------------------- GNOME shell
    def _gnome_loop(self):
        while not self._stop.is_set():
            cls = None
            try:
                out = subprocess.run(
                    ["gdbus", "call", "--session", "--dest", "org.gnome.Shell", "--object-path", "/org/gnome/Shell/Introspect",
                     "--method", "org.gnome.Shell.Introspect.GetWindows"],
                    capture_output=True, text=True, timeout=1.0).stdout
                # crude parse: find the entry with 'has-focus': <true> and its 'wm-class'
                for chunk in out.split("}, "):
                    if "'has-focus': <true>" in chunk and "'wm-class': <'" in chunk:
                        cls = chunk.split("'wm-class': <'", 1)[1].split("'", 1)[0]
                        break
            except Exception:
                cls = None
            self._set(cls)
            time.sleep(0.7)


def probe_backends() -> dict:
    return {"session": os.environ.get("XDG_SESSION_TYPE", ""), "desktop": os.environ.get("XDG_CURRENT_DESKTOP", "")}


if __name__ == "__main__":
    t = AppTracker(lambda c: print("focused:", c))
    t.start()
    print("backend:", t.backend)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
