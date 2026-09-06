"""Configuration model: ~/.config/logimx/config.json

{
  "devices": {
    "b034": {                       # product id of the device (Bolt/Unifying WPID or BT PID)
      "settings": {...},            # device-wide hardware settings
      "profiles": {
        "default": {"buttons": {"195": "gesture_navigation", ...}, "thumbwheel": "hscroll", "keys": {...}},
        "firefox": {"match": ["firefox"], "buttons": {...}}
      }
    }
  }
}
"""
from __future__ import annotations

import json
import os
import threading
from copy import deepcopy

CONFIG_DIR = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "logimx")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")

# Control ids (0x1B04) used by the two reference devices
CID = {
    "left": 0x50, "right": 0x51, "middle": 0x52, "back": 0x53, "forward": 0x56,
    "gesture": 0xC3, "mode_shift": 0xC4,
    "calculator": 0x0A, "screen_lock": 0x6F, "brightness_down": 0xC7, "brightness_up": 0xC8,
    "backlight_down": 0xE2, "backlight_up": 0xE3, "prev_track": 0xE4, "play_pause": 0xE5, "next_track": 0xE6,
    "mute": 0xE7, "volume_down": 0xE8, "volume_up": 0xE9, "context_menu": 0xEA,
    "dictation": 0x103, "emoji": 0x108, "screenshot": 0x10A, "mic_mute": 0x11C,
}
CID_NAMES = {v: k for k, v in CID.items()}

CONTROL_LABELS = {
    0x50: "Left button", 0x51: "Right button", 0x52: "Middle button", 0x53: "Back button", 0x56: "Forward button",
    0xC3: "Gesture button", 0xC4: "Mode shift button", 0xD7: "Smart shift",
    0x0A: "Calculator", 0x6F: "Lock screen", 0xC7: "Brightness down", 0xC8: "Brightness up",
    0xE2: "Backlight down", 0xE3: "Backlight up", 0xE4: "Previous track", 0xE5: "Play / Pause", 0xE6: "Next track",
    0xE7: "Mute", 0xE8: "Volume down", 0xE9: "Volume up", 0xEA: "Context menu",
    0x103: "Dictation", 0x108: "Emoji", 0x10A: "Screen capture", 0x11C: "Mute microphone",
    0xEF: "Fn lock", 0x100: "Show desktop", 0xA1: "Search", 0x11D: "Voice assistant",
}

MX_MASTER_3S = {
    "settings": {
        "dpi": 1000,
        "smartshift": {"mode": "ratchet", "threshold": 14},
        "hires": {"enabled": True, "invert": False},
        "thumbwheel": {"invert": False},
    },
    "profiles": {
        "default": {
            "name": "All applications",
            "buttons": {
                str(CID["middle"]): "native",
                str(CID["back"]): "native",
                str(CID["forward"]): "native",
                str(CID["gesture"]): "gesture_navigation",
                str(CID["mode_shift"]): "native",
            },
            "thumbwheel": "hscroll",
        }
    },
}

MX_KEYS_S = {
    "settings": {
        "backlight": {"enabled": True, "mode": "auto", "level": 0},
        "fn_swap": True,
    },
    "profiles": {
        "default": {
            "name": "All applications",
            "keys": {
                str(CID["calculator"]): "native",
                str(CID["screen_lock"]): "native",
                str(CID["brightness_down"]): "native",
                str(CID["brightness_up"]): "native",
                str(CID["backlight_down"]): "native",
                str(CID["backlight_up"]): "native",
                str(CID["prev_track"]): "native",
                str(CID["play_pause"]): "native",
                str(CID["next_track"]): "native",
                str(CID["mute"]): "native",
                str(CID["volume_down"]): "native",
                str(CID["volume_up"]): "native",
                str(CID["context_menu"]): "native",
                str(CID["dictation"]): "nothing",
                str(CID["emoji"]): "emoji_picker",
                str(CID["screenshot"]): "screenshot_area",
                str(CID["mic_mute"]): "mic_mute",
            },
        }
    },
}

DEFAULTS_BY_PID = {
    0xB034: MX_MASTER_3S, 0xB035: MX_MASTER_3S, 0xB043: MX_MASTER_3S,   # MX Master 3S (Bolt / business / BT)
    0xB378: MX_KEYS_S, 0xB379: MX_KEYS_S, 0xB37A: MX_KEYS_S,            # MX Keys S (Bolt / business / mac)
}

GENERIC_MOUSE = {"settings": {}, "profiles": {"default": {"name": "All applications", "buttons": {}, "thumbwheel": "native"}}}
GENERIC_KEYBOARD = {"settings": {}, "profiles": {"default": {"name": "All applications", "keys": {}}}}


class Config:
    def __init__(self, path: str = CONFIG_PATH):
        self.path = path
        self.data = {"devices": {}, "general": {"desktop": "gnome"}}
        self._lock = threading.RLock()
        self.load()

    def load(self):
        with self._lock:
            try:
                with open(self.path) as f:
                    self.data = json.load(f)
            except (OSError, ValueError):
                pass
            self.data.setdefault("devices", {})
            self.data.setdefault("general", {"desktop": "gnome"})

    def save(self):
        with self._lock:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.data, f, indent=2)
            os.replace(tmp, self.path)

    def device(self, pid: int, kind: str = "mouse") -> dict:
        """Return (creating from defaults if needed) the config block for a product id."""
        key = f"{pid:04x}"
        with self._lock:
            if key not in self.data["devices"]:
                base = DEFAULTS_BY_PID.get(pid) or (GENERIC_KEYBOARD if kind == "keyboard" else GENERIC_MOUSE)
                self.data["devices"][key] = deepcopy(base)
                self.save()
            return self.data["devices"][key]

    def set_setting(self, pid: int, path: list[str], value):
        with self._lock:
            d = self.device(pid).setdefault("settings", {})
            for p in path[:-1]:
                d = d.setdefault(p, {})
            d[path[-1]] = value
            self.save()

    def set_assignment(self, pid: int, profile: str, section: str, control: str, action):
        with self._lock:
            prof = self.device(pid).setdefault("profiles", {}).setdefault(profile, {"name": profile})
            if section == "thumbwheel":
                prof["thumbwheel"] = action
            else:
                prof.setdefault(section, {})[str(control)] = action
            self.save()

    def profile_for(self, pid: int, app_class: str | None) -> tuple[str, dict]:
        """Pick the profile whose `match` list contains the focused application."""
        dev = self.device(pid)
        profiles = dev.get("profiles", {})
        if app_class:
            lc = app_class.lower()
            for name, p in profiles.items():
                if name == "default":
                    continue
                for m in p.get("match", []):
                    if m.lower() in lc:
                        return name, p
        return "default", profiles.get("default", {})
