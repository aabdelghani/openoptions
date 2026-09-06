"""Catalogue of assignable actions.

An action is a small dict: {"type": ..., ...}. Presets are named actions the UI
offers; "custom" actions are built from the same primitives.

Types:
  keystroke   keys: [KEY_..., ...]                     tap a chord
  hold        keys: [...]                              hold while the control is held
  button      button: BTN_...                          mouse button click
  scroll      dy / dx in detents, or hires 1/120 units continuous adapter
  command     cmd: shell command
  native      leave the control undiverted
  nothing     divert but do nothing
  gesture     see gestures.py: click/up/down/left/right sub-actions
  adapter     continuous: x/y sub-actions fired every `step` units of movement
  change_host host: 0..2                               Easy-Switch
  dpi_cycle   levels: [..]
"""
from __future__ import annotations

# Desktop-neutral chords with GNOME defaults; KDE and others can be picked per profile.
PRESETS: dict[str, dict] = {
    "native":            {"label": "Default (device)", "icon": "device", "type": "native"},
    "nothing":           {"label": "Do nothing", "icon": "block", "type": "nothing"},
    "middle_click":      {"label": "Middle click", "icon": "mouse", "type": "button", "button": "BTN_MIDDLE"},
    "back":              {"label": "Back", "icon": "arrow-left", "type": "button", "button": "BTN_SIDE"},
    "forward":           {"label": "Forward", "icon": "arrow-right", "type": "button", "button": "BTN_EXTRA"},
    "overview":          {"label": "Activities / Overview", "icon": "grid", "type": "keystroke", "keys": ["KEY_LEFTMETA"]},
    "show_desktop":      {"label": "Show desktop", "icon": "desktop", "type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_D"]},
    "app_switcher":      {"label": "Switch application", "icon": "windows", "type": "keystroke", "keys": ["KEY_LEFTALT", "KEY_TAB"]},
    "workspace_next":    {"label": "Next workspace", "icon": "arrow-down", "type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_PAGEDOWN"]},
    "workspace_prev":    {"label": "Previous workspace", "icon": "arrow-up", "type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_PAGEUP"]},
    "tab_next":          {"label": "Next tab", "icon": "tab", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_TAB"]},
    "tab_prev":          {"label": "Previous tab", "icon": "tab", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_LEFTSHIFT", "KEY_TAB"]},
    "copy":              {"label": "Copy", "icon": "copy", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_C"]},
    "paste":             {"label": "Paste", "icon": "paste", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_V"]},
    "undo":              {"label": "Undo", "icon": "undo", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_Z"]},
    "redo":              {"label": "Redo", "icon": "redo", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_LEFTSHIFT", "KEY_Z"]},
    "zoom_in":           {"label": "Zoom in", "icon": "zoom-in", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_EQUAL"]},
    "zoom_out":          {"label": "Zoom out", "icon": "zoom-out", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_MINUS"]},
    "volume_up":         {"label": "Volume up", "icon": "volume", "type": "keystroke", "keys": ["KEY_VOLUMEUP"]},
    "volume_down":       {"label": "Volume down", "icon": "volume", "type": "keystroke", "keys": ["KEY_VOLUMEDOWN"]},
    "mute":              {"label": "Mute", "icon": "mute", "type": "keystroke", "keys": ["KEY_MUTE"]},
    "mic_mute":          {"label": "Mute microphone", "icon": "mic", "type": "keystroke", "keys": ["KEY_MICMUTE"]},
    "play_pause":        {"label": "Play / Pause", "icon": "play", "type": "keystroke", "keys": ["KEY_PLAYPAUSE"]},
    "next_track":        {"label": "Next track", "icon": "next", "type": "keystroke", "keys": ["KEY_NEXTSONG"]},
    "prev_track":        {"label": "Previous track", "icon": "prev", "type": "keystroke", "keys": ["KEY_PREVIOUSSONG"]},
    "brightness_up":     {"label": "Brightness up", "icon": "sun", "type": "keystroke", "keys": ["KEY_BRIGHTNESSUP"]},
    "brightness_down":   {"label": "Brightness down", "icon": "sun", "type": "keystroke", "keys": ["KEY_BRIGHTNESSDOWN"]},
    "screenshot":        {"label": "Screenshot", "icon": "camera", "type": "keystroke", "keys": ["KEY_PRINT"]},
    "screenshot_area":   {"label": "Screenshot area", "icon": "camera", "type": "keystroke", "keys": ["KEY_LEFTSHIFT", "KEY_PRINT"]},
    "lock":              {"label": "Lock screen", "icon": "lock", "type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_L"]},
    "calculator":        {"label": "Calculator", "icon": "calc", "type": "keystroke", "keys": ["KEY_CALC"]},
    "emoji_picker":      {"label": "Emoji picker", "icon": "smile", "type": "ui", "event": "emoji"},
    "emoji":             {"label": "Emoji (desktop shortcut)", "icon": "smile", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_DOT"]},
    "context_menu":      {"label": "Context menu", "icon": "menu", "type": "keystroke", "keys": ["KEY_COMPOSE"]},
    "dictation":         {"label": "Dictation (needs a tool)", "icon": "mic", "type": "command", "cmd": ""},
    "terminal":          {"label": "Open terminal", "icon": "terminal", "type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_LEFTALT", "KEY_T"]},
    "close_window":      {"label": "Close window", "icon": "close", "type": "keystroke", "keys": ["KEY_LEFTALT", "KEY_F4"]},
    "maximize":          {"label": "Maximize window", "icon": "maximize", "type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_UP"]},
    "minimize":          {"label": "Minimize window", "icon": "minimize", "type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_H"]},
    "tile_left":         {"label": "Tile window left", "icon": "tile", "type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_LEFT"]},
    "tile_right":        {"label": "Tile window right", "icon": "tile", "type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_RIGHT"]},
    "hscroll":           {"label": "Horizontal scroll", "icon": "scroll-h", "type": "scroll", "axis": "x"},
    "vscroll":           {"label": "Vertical scroll", "icon": "scroll-v", "type": "scroll", "axis": "y"},
    "zoom_wheel":        {"label": "Zoom (Ctrl + scroll)", "icon": "zoom-in", "type": "scroll", "axis": "y", "modifiers": ["KEY_LEFTCTRL"]},
    "volume_wheel":      {"label": "Volume", "icon": "volume", "type": "adapter", "step": 120,
                          "plus": {"type": "keystroke", "keys": ["KEY_VOLUMEUP"]}, "minus": {"type": "keystroke", "keys": ["KEY_VOLUMEDOWN"]}},
    "tabs_wheel":        {"label": "Switch tabs", "icon": "tab", "type": "adapter", "step": 120,
                          "plus": {"type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_TAB"]}, "minus": {"type": "keystroke", "keys": ["KEY_LEFTCTRL", "KEY_LEFTSHIFT", "KEY_TAB"]}},
    "workspaces_wheel":  {"label": "Switch workspaces", "icon": "grid", "type": "adapter", "step": 240,
                          "plus": {"type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_PAGEDOWN"]}, "minus": {"type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_PAGEUP"]}},
    "brightness_wheel":  {"label": "Screen brightness", "icon": "sun", "type": "adapter", "step": 120,
                          "plus": {"type": "keystroke", "keys": ["KEY_BRIGHTNESSUP"]}, "minus": {"type": "keystroke", "keys": ["KEY_BRIGHTNESSDOWN"]}},
    "easy_switch_1":     {"label": "Switch to host 1", "icon": "host", "type": "change_host", "host": 0},
    "easy_switch_2":     {"label": "Switch to host 2", "icon": "host", "type": "change_host", "host": 1},
    "easy_switch_3":     {"label": "Switch to host 3", "icon": "host", "type": "change_host", "host": 2},
    "dpi_cycle":         {"label": "Cycle DPI", "icon": "speed", "type": "dpi_cycle", "levels": [800, 1000, 1600, 2400, 4000]},
    "smartshift_toggle": {"label": "Toggle SmartShift (ratchet / free spin)", "icon": "wheel", "type": "smartshift_toggle"},
    "open_home":         {"label": "Open home folder", "icon": "folder", "type": "open", "target": "~"},
    "gesture_navigation": {
        "label": "Gestures: navigation", "icon": "gesture", "type": "gesture", "threshold": 60,
        "click": {"type": "keystroke", "keys": ["KEY_LEFTMETA"]},
        "up":    {"type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_PAGEUP"]},
        "down":  {"type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_PAGEDOWN"]},
        "left":  {"type": "keystroke", "keys": ["KEY_LEFTALT", "KEY_LEFTSHIFT", "KEY_TAB"]},
        "right": {"type": "keystroke", "keys": ["KEY_LEFTALT", "KEY_TAB"]},
    },
    "gesture_windows": {
        "label": "Gestures: window management", "icon": "gesture", "type": "gesture", "threshold": 60,
        "click": {"type": "keystroke", "keys": ["KEY_LEFTMETA"]},
        "up":    {"type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_UP"]},
        "down":  {"type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_H"]},
        "left":  {"type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_LEFT"]},
        "right": {"type": "keystroke", "keys": ["KEY_LEFTMETA", "KEY_RIGHT"]},
    },
    "gesture_volume": {
        "label": "Gestures: volume and media", "icon": "gesture", "type": "gesture", "threshold": 60, "continuous": True, "step": 40,
        "click": {"type": "keystroke", "keys": ["KEY_PLAYPAUSE"]},
        "up":    {"type": "keystroke", "keys": ["KEY_VOLUMEUP"]},
        "down":  {"type": "keystroke", "keys": ["KEY_VOLUMEDOWN"]},
        "left":  {"type": "keystroke", "keys": ["KEY_PREVIOUSSONG"]},
        "right": {"type": "keystroke", "keys": ["KEY_NEXTSONG"]},
    },
    "gesture_pan": {
        "label": "Gestures: pan / scroll", "icon": "gesture", "type": "gesture", "threshold": 0, "continuous": True, "step": 8,
        "click": {"type": "button", "button": "BTN_MIDDLE"},
        "up":    {"type": "scroll", "axis": "y", "amount": 30},
        "down":  {"type": "scroll", "axis": "y", "amount": -30},
        "left":  {"type": "scroll", "axis": "x", "amount": -30},
        "right": {"type": "scroll", "axis": "x", "amount": 30},
    },
}

# Which presets make sense for which control class
BUTTON_PRESETS = [k for k, v in PRESETS.items() if v["type"] in ("native", "nothing", "button", "keystroke", "command", "change_host", "dpi_cycle", "gesture", "smartshift_toggle", "open")]
WHEEL_PRESETS = [k for k, v in PRESETS.items() if v["type"] in ("native", "nothing", "scroll", "adapter")]
KEY_PRESETS = [k for k, v in PRESETS.items() if v["type"] in ("native", "nothing", "keystroke", "command", "change_host", "open")]


def resolve(action) -> dict:
    """Accept a preset name or a full action dict and return an action dict."""
    if isinstance(action, str):
        return dict(PRESETS.get(action, PRESETS["native"]), preset=action)
    if isinstance(action, dict):
        return action
    return PRESETS["native"]
