"""Virtual input device (uinput) used to play actions into the desktop.

Works identically under X11 and Wayland because it sits below the compositor.
"""
from __future__ import annotations

import threading
import time
from typing import Iterable

from evdev import UInput, ecodes as e

MOUSE_BUTTONS = [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE, e.BTN_SIDE, e.BTN_EXTRA, e.BTN_FORWARD, e.BTN_BACK, e.BTN_TASK]


def _all_keys():
    keys = set()
    for name, code in e.ecodes.items():
        if name.startswith("KEY_") and isinstance(code, int) and code < 0x2FF:
            keys.add(code)
    keys.update(MOUSE_BUTTONS)
    return sorted(keys)


class Injector:
    def __init__(self, name: str = "LogiMX virtual input"):
        caps = {
            e.EV_KEY: _all_keys(),
            e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL, e.REL_HWHEEL, e.REL_WHEEL_HI_RES, e.REL_HWHEEL_HI_RES],
        }
        self.ui = UInput(caps, name=name, vendor=0x046D, product=0x0001, version=1)
        self._lock = threading.Lock()
        self._held: set[int] = set()

    def close(self):
        self.release_all()
        self.ui.close()

    # ------------------------------------------------------------ keys
    @staticmethod
    def code(name: str) -> int:
        if isinstance(name, int):
            return name
        n = name.upper()
        if not (n.startswith("KEY_") or n.startswith("BTN_")):
            n = "KEY_" + n
        return e.ecodes[n]

    def press(self, keys: Iterable[str | int]):
        with self._lock:
            for k in keys:
                c = self.code(k)
                self.ui.write(e.EV_KEY, c, 1)
                self._held.add(c)
            self.ui.syn()

    def release(self, keys: Iterable[str | int]):
        with self._lock:
            for k in reversed(list(keys)):
                c = self.code(k)
                self.ui.write(e.EV_KEY, c, 0)
                self._held.discard(c)
            self.ui.syn()

    def tap(self, keys: Iterable[str | int], hold_ms: int = 0):
        keys = list(keys)
        self.press(keys)
        if hold_ms:
            time.sleep(hold_ms / 1000)
        self.release(keys)

    def release_all(self):
        with self._lock:
            for c in list(self._held):
                self.ui.write(e.EV_KEY, c, 0)
            self._held.clear()
            self.ui.syn()

    # ------------------------------------------------------------ pointer
    def scroll(self, dy: int = 0, dx: int = 0, hires: bool = True):
        """dy/dx in wheel detents (positive = up / right). With hires the value is in
        1/120 of a detent, so callers pass e.g. 30 for a quarter step."""
        with self._lock:
            if hires:
                if dy:
                    self.ui.write(e.EV_REL, e.REL_WHEEL_HI_RES, dy)
                if dx:
                    self.ui.write(e.EV_REL, e.REL_HWHEEL_HI_RES, dx)
                # keep legacy axis in step so apps that ignore hi-res still move
                if dy and abs(dy) >= 120:
                    self.ui.write(e.EV_REL, e.REL_WHEEL, int(dy / 120))
                if dx and abs(dx) >= 120:
                    self.ui.write(e.EV_REL, e.REL_HWHEEL, int(dx / 120))
            else:
                if dy:
                    self.ui.write(e.EV_REL, e.REL_WHEEL, dy)
                if dx:
                    self.ui.write(e.EV_REL, e.REL_HWHEEL, dx)
            self.ui.syn()

    def move(self, dx: int, dy: int):
        with self._lock:
            if dx:
                self.ui.write(e.EV_REL, e.REL_X, dx)
            if dy:
                self.ui.write(e.EV_REL, e.REL_Y, dy)
            self.ui.syn()

    def click(self, button: str = "BTN_LEFT", count: int = 1):
        c = self.code(button)
        for _ in range(count):
            with self._lock:
                self.ui.write(e.EV_KEY, c, 1)
                self.ui.syn()
                self.ui.write(e.EV_KEY, c, 0)
                self.ui.syn()
            if count > 1:
                time.sleep(0.04)
