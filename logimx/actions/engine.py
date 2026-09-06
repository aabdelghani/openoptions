"""Turns device events (button down/up, raw XY, thumb wheel rotation) into
desktop actions through the Injector. Holds per-control gesture state.
"""
from __future__ import annotations

import subprocess
import threading
import time
from typing import Callable, Optional

from .injector import Injector
from .presets import resolve


class GestureState:
    def __init__(self, action: dict):
        self.action = action
        self.dx = 0
        self.dy = 0
        self.t0 = time.monotonic()
        self.fired = False       # a swipe already fired (one-shot mode)
        self.acc_x = 0.0
        self.acc_y = 0.0
        self.direction: Optional[str] = None


class ActionEngine:
    def __init__(self, injector: Injector, device_ops: Optional[dict[str, Callable]] = None):
        self.inj = injector
        self.device_ops = device_ops or {}   # e.g. {"change_host": fn(host), "set_dpi": fn(dpi), "get_dpi": fn()}
        self._gestures: dict[int, GestureState] = {}
        self._held_keys: dict[int, list] = {}
        self._wheel_acc = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------ playback
    def play(self, action: dict, delta: float = 0.0):
        """Fire an atomic action. `delta` carries movement for scroll actions."""
        t = action.get("type", "native")
        if t in ("native", "nothing"):
            return
        if t == "keystroke":
            self.inj.tap(action.get("keys", []))
        elif t == "button":
            self.inj.click(action.get("button", "BTN_MIDDLE"), action.get("count", 1))
        elif t == "scroll":
            amt = int(action.get("amount", 0) if not delta else delta)
            mods = action.get("modifiers") or []
            if mods:
                self.inj.press(mods)
            if action.get("axis", "y") == "x":
                self.inj.scroll(dx=amt)
            else:
                self.inj.scroll(dy=amt)
            if mods:
                self.inj.release(mods)
        elif t == "command":
            cmd = action.get("cmd")
            if cmd:
                subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif t == "change_host":
            fn = self.device_ops.get("change_host")
            if fn:
                fn(int(action.get("host", 0)))
        elif t == "dpi_cycle":
            get_dpi, set_dpi = self.device_ops.get("get_dpi"), self.device_ops.get("set_dpi")
            levels = action.get("levels") or [800, 1000, 1600, 2400, 4000]
            if get_dpi and set_dpi:
                cur = get_dpi()
                nxt = next((lv for lv in levels if lv > cur), levels[0])
                set_dpi(nxt)

    # ------------------------------------------------------------- buttons
    def button_down(self, cid: int, action):
        a = resolve(action)
        t = a.get("type")
        if t == "gesture":
            with self._lock:
                self._gestures[cid] = GestureState(a)
        elif t == "hold":
            keys = a.get("keys", [])
            self.inj.press(keys)
            self._held_keys[cid] = keys
        # everything else fires on release so a gesture-like press does not double fire

    def button_up(self, cid: int, action):
        a = resolve(action)
        t = a.get("type")
        if t == "gesture":
            with self._lock:
                g = self._gestures.pop(cid, None)
            if g is None:
                return
            thr = a.get("threshold", 60)
            moved = abs(g.dx) > thr or abs(g.dy) > thr
            if a.get("continuous"):
                if not g.direction:
                    self.play(a.get("click", {}))
            elif not g.fired and not moved:
                self.play(a.get("click", {}))
            elif not g.fired and moved:
                self.play(a.get(self._dir(g.dx, g.dy), {}))
        elif t == "hold":
            keys = self._held_keys.pop(cid, None)
            if keys:
                self.inj.release(keys)
        else:
            self.play(a)

    @staticmethod
    def _dir(dx: int, dy: int) -> str:
        if abs(dx) >= abs(dy):
            return "right" if dx > 0 else "left"
        return "down" if dy > 0 else "up"

    def raw_xy(self, dx: int, dy: int):
        with self._lock:
            gestures = list(self._gestures.values())
        for g in gestures:
            g.dx += dx
            g.dy += dy
            a = g.action
            thr = a.get("threshold", 60)
            if a.get("continuous"):
                step = max(1, int(a.get("step", 40)))
                if g.direction is None:
                    if abs(g.dx) > thr or abs(g.dy) > thr:
                        g.direction = "x" if abs(g.dx) >= abs(g.dy) else "y"
                        g.acc_x = g.acc_y = 0.0
                    else:
                        continue
                if g.direction == "x":
                    g.acc_x += dx
                    while abs(g.acc_x) >= step:
                        sign = 1 if g.acc_x > 0 else -1
                        g.acc_x -= sign * step
                        self.play(a.get("right" if sign > 0 else "left", {}), delta=a.get("right" if sign > 0 else "left", {}).get("amount", 0))
                else:
                    g.acc_y += dy
                    while abs(g.acc_y) >= step:
                        sign = 1 if g.acc_y > 0 else -1
                        g.acc_y -= sign * step
                        self.play(a.get("down" if sign > 0 else "up", {}), delta=a.get("down" if sign > 0 else "up", {}).get("amount", 0))
            else:
                if not g.fired and (abs(g.dx) > thr or abs(g.dy) > thr):
                    g.fired = True
                    self.play(a.get(self._dir(g.dx, g.dy), {}))

    # ---------------------------------------------------------- thumb wheel
    def thumbwheel(self, rotation: int, action, invert: bool = False):
        a = resolve(action)
        t = a.get("type")
        if rotation == 0 or t in ("native", "nothing"):
            return
        if invert:
            rotation = -rotation
        if t == "scroll":
            # diverted resolution is fine grained; scale to hi-res 1/120 units
            gain = float(a.get("gain", 8.0))
            amt = int(rotation * gain)
            mods = a.get("modifiers") or []
            if mods:
                self.inj.press(mods)
            if a.get("axis", "x") == "x":
                self.inj.scroll(dx=amt)
            else:
                self.inj.scroll(dy=-amt)
            if mods:
                self.inj.release(mods)
        elif t == "adapter":
            step = max(1, int(a.get("step", 120)))
            self._wheel_acc += rotation * float(a.get("gain", 8.0))
            while abs(self._wheel_acc) >= step:
                sign = 1 if self._wheel_acc > 0 else -1
                self._wheel_acc -= sign * step
                self.play(a.get("plus" if sign > 0 else "minus", {}))
        else:
            self.play(a)
