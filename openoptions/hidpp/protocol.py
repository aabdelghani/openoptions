"""HID++ 2.0 feature access on top of hidpp.transport.

Function numbers and byte layouts follow the published HID++ 2.0 documentation
and the behaviour observed in Solaar and logiops.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Optional

from .transport import HidppError, Notification, Timeout, Transport

# --------------------------------------------------------------- feature ids
ROOT = 0x0000
FEATURE_SET = 0x0001
DEVICE_FW = 0x0003
DEVICE_NAME = 0x0005
FRIENDLY_NAME = 0x0007
CONFIG_CHANGE = 0x0020
UNIFIED_BATTERY = 0x1004
CHANGE_HOST = 0x1814
HOSTS_INFO = 0x1815
BACKLIGHT2 = 0x1982
SPECIAL_KEYS = 0x1B04
WIRELESS_STATUS = 0x1D4B
SMART_SHIFT = 0x2110
SMART_SHIFT_ENHANCED = 0x2111
HIRES_WHEEL = 0x2121
THUMB_WHEEL = 0x2150
ADJUSTABLE_DPI = 0x2201
FN_INVERSION_K375S = 0x40A3
MULTIPLATFORM = 0x4531

FEATURE_NAMES = {
    ROOT: "Root", FEATURE_SET: "Feature set", DEVICE_FW: "Firmware", DEVICE_NAME: "Device name",
    FRIENDLY_NAME: "Friendly name", CONFIG_CHANGE: "Config change", UNIFIED_BATTERY: "Unified battery",
    CHANGE_HOST: "Change host", HOSTS_INFO: "Hosts info", BACKLIGHT2: "Backlight", SPECIAL_KEYS: "Reprogrammable controls",
    WIRELESS_STATUS: "Wireless status", SMART_SHIFT: "SmartShift", SMART_SHIFT_ENHANCED: "SmartShift enhanced",
    HIRES_WHEEL: "Hi-res wheel", THUMB_WHEEL: "Thumb wheel", ADJUSTABLE_DPI: "Adjustable DPI",
    FN_INVERSION_K375S: "Fn inversion", MULTIPLATFORM: "Multi platform",
}

DEVICE_TYPES = {0: "keyboard", 1: "remote", 2: "numpad", 3: "mouse", 4: "trackpad", 5: "trackball",
                6: "presenter", 7: "receiver", 8: "headset", 9: "webcam", 10: "steering wheel"}


@dataclass
class FeatureInfo:
    id: int
    index: int
    version: int
    type: int = 0

    @property
    def name(self):
        return FEATURE_NAMES.get(self.id, f"0x{self.id:04X}")


@dataclass
class ControlInfo:
    """One entry of the 0x1B04 control table."""
    cid: int
    task_id: int
    flags: int
    position: int
    group: int
    group_mask: int
    extra_flags: int

    @property
    def is_mouse(self):
        return bool(self.flags & 0x01)

    @property
    def is_fkey(self):
        return bool(self.flags & 0x02)

    @property
    def is_hotkey(self):
        return bool(self.flags & 0x04)

    @property
    def reprogrammable(self):
        return bool(self.flags & 0x10)

    @property
    def divertable(self):
        return bool(self.flags & 0x20)

    @property
    def persistently_divertable(self):
        return bool(self.flags & 0x40)

    @property
    def virtual(self):
        return bool(self.flags & 0x80)

    @property
    def raw_xy(self):
        return bool(self.extra_flags & 0x01)

    @property
    def force_raw_xy(self):
        return bool(self.extra_flags & 0x02)


@dataclass
class Battery:
    percent: int
    level: str
    charging: bool
    external_power: bool


@dataclass
class SmartShiftState:
    mode: int          # 1 freespin, 2 ratchet
    threshold: int     # auto disengage 1..255
    default_threshold: int


@dataclass
class HiResState:
    hidpp_target: bool
    hires: bool
    invert: bool
    multiplier: int = 1
    has_invert: bool = False
    has_ratchet_switch: bool = False


@dataclass
class ThumbWheelState:
    diverted: bool
    invert: bool
    native_res: int = 0
    diverted_res: int = 0
    capabilities: int = 0


@dataclass
class DpiState:
    dpi: int
    default: int
    levels: list[int] = field(default_factory=list)  # explicit list, or [min, max, step] when stepped
    stepped: bool = False


@dataclass
class BacklightState:
    enabled: bool
    options: int
    supported: int
    effects: int
    level: int
    duration_hands_out: int
    duration_hands_in: int
    duration_powered: int
    num_levels: int = 0
    current_level: int = 0
    status: int = 0

    @property
    def mode(self):
        return (self.options >> 3) & 0x03

    @property
    def auto_supported(self):
        return bool(self.supported & 0x08)

    @property
    def temp_manual_supported(self):
        return bool(self.supported & 0x10)

    @property
    def perm_manual_supported(self):
        return bool(self.supported & 0x20)


@dataclass
class HostInfo:
    index: int
    paired: bool
    bus_type: int
    name: str


class Device:
    """A HID++ 2.0 device reachable through (transport, device_index)."""

    def __init__(self, transport: Transport, index: int):
        self.t = transport
        self.index = index
        self.features: dict[int, FeatureInfo] = {}
        self.protocol = (0, 0)
        self.name = ""
        self.friendly_name = ""
        self.kind = "unknown"
        self.firmware = ""
        self.serial = ""
        self.controls: dict[int, ControlInfo] = {}

    # ------------------------------------------------------------- helpers
    def req(self, feature_id: int, fn: int, params: bytes = b"", **kw) -> bytes:
        fi = self.features.get(feature_id)
        if fi is None:
            raise HidppError(0x06, 0, fn << 4)
        return self.t.request(self.index, fi.index, fn, params, **kw)

    def has(self, feature_id: int) -> bool:
        return feature_id in self.features

    def feature_index(self, feature_id: int) -> Optional[int]:
        fi = self.features.get(feature_id)
        return fi.index if fi else None

    def feature_by_index(self, idx: int) -> Optional[FeatureInfo]:
        for f in self.features.values():
            if f.index == idx:
                return f
        return None

    # -------------------------------------------------------- enumeration
    def enumerate(self) -> bool:
        pv = self.t.ping(self.index)
        if pv is None or pv[0] < 2:
            return False
        self.protocol = pv
        self.features = {ROOT: FeatureInfo(ROOT, 0, 0)}
        r = self.t.request(self.index, 0, 0, struct.pack(">H", FEATURE_SET), long=False)
        fs_index = r[0]
        if fs_index == 0:
            return False
        self.features[FEATURE_SET] = FeatureInfo(FEATURE_SET, fs_index, r[2])
        count = self.t.request(self.index, fs_index, 0, b"", long=False)[0]
        for i in range(1, count + 1):
            r = self.t.request(self.index, fs_index, 1, bytes([i]), long=False)
            fid, ftype, fver = struct.unpack(">HBB", r[:4])
            self.features[fid] = FeatureInfo(fid, i, fver, ftype)
        self._read_identity()
        if self.has(SPECIAL_KEYS):
            self._read_controls()
        return True

    def _read_identity(self):
        if self.has(DEVICE_NAME):
            n = self.req(DEVICE_NAME, 0)[0]
            name = b""
            while len(name) < n:
                name += self.req(DEVICE_NAME, 1, bytes([len(name)]))
            self.name = name[:n].decode(errors="replace")
            self.kind = DEVICE_TYPES.get(self.req(DEVICE_NAME, 2)[0], "unknown")
        if self.has(FRIENDLY_NAME):
            try:
                n = self.req(FRIENDLY_NAME, 0)[0]
                fn = b""
                while len(fn) < n:
                    r = self.req(FRIENDLY_NAME, 1, bytes([len(fn)]))
                    if not r[1:]:
                        break
                    fn += r[1:]
                self.friendly_name = fn[:n].decode(errors="replace")
            except (HidppError, Timeout):
                pass
        if self.has(DEVICE_FW):
            try:
                cnt = self.req(DEVICE_FW, 0)[0]
                for e in range(cnt):
                    r = self.req(DEVICE_FW, 1, bytes([e]))
                    if r[0] == 0:  # main firmware
                        self.firmware = f"{r[1:4].decode(errors='replace')} {r[4]:02X}.{r[5]:02X}.B{struct.unpack('>H', r[6:8])[0]:04X}"
                # v4+: fn2 getDeviceSerialNumber returns 12 ASCII characters
                if self.features[DEVICE_FW].version >= 4:
                    r = self.req(DEVICE_FW, 2)
                    self.serial = r[:12].rstrip(b"\0").decode(errors="replace")
            except (HidppError, Timeout):
                pass

    def _read_controls(self):
        self.controls = {}
        cnt = self.req(SPECIAL_KEYS, 0)[0]
        for i in range(cnt):
            r = self.req(SPECIAL_KEYS, 1, bytes([i]))
            cid, tid, flags, pos, group, gmask, extra = struct.unpack(">HHBBBBB", r[:9])
            self.controls[cid] = ControlInfo(cid, tid, flags, pos, group, gmask, extra)

    # -------------------------------------------------------------- battery
    def battery(self) -> Optional[Battery]:
        if not self.has(UNIFIED_BATTERY):
            return None
        r = self.req(UNIFIED_BATTERY, 1)
        return self._decode_battery(r)

    @staticmethod
    def _decode_battery(r: bytes) -> Battery:
        soc, level, status, ext = r[0], r[1], r[2], r[3] if len(r) > 3 else 0
        names = {8: "full", 4: "good", 2: "low", 1: "critical"}
        return Battery(soc, names.get(level, "unknown"), status in (1, 2, 3), bool(ext))

    # -------------------------------------------------------- special keys
    def get_reporting(self, cid: int) -> tuple[int, int]:
        r = self.req(SPECIAL_KEYS, 2, struct.pack(">H", cid))
        _cid, flags, remap = struct.unpack(">HBH", r[:5])
        return flags, remap

    def set_reporting(self, cid: int, divert: Optional[bool] = None, persist: Optional[bool] = None,
                      raw_xy: Optional[bool] = None, force_raw_xy: Optional[bool] = None, remap: int = 0):
        flags = 0
        if divert is not None:
            flags |= 0x02 | (0x01 if divert else 0)
        if persist is not None:
            flags |= 0x08 | (0x04 if persist else 0)
        if raw_xy is not None:
            flags |= 0x20 | (0x10 if raw_xy else 0)
        if force_raw_xy is not None:
            flags |= 0x80 | (0x40 if force_raw_xy else 0)
        self.req(SPECIAL_KEYS, 3, struct.pack(">HBH", cid, flags, remap))

    # ---------------------------------------------------------- smart shift
    def smartshift(self) -> Optional[SmartShiftState]:
        if self.has(SMART_SHIFT):
            r = self.req(SMART_SHIFT, 0)
            return SmartShiftState(r[0], r[1], r[2])
        if self.has(SMART_SHIFT_ENHANCED):
            r = self.req(SMART_SHIFT_ENHANCED, 1)
            return SmartShiftState(r[0], r[1], r[2])
        return None

    def set_smartshift(self, mode: int = 0, threshold: int = 0):
        """mode: 0 keep, 1 freespin, 2 ratchet. threshold: 0 keep, 1..255."""
        p = bytes([mode & 0xFF, threshold & 0xFF, 0])
        if self.has(SMART_SHIFT):
            self.req(SMART_SHIFT, 1, p)
        elif self.has(SMART_SHIFT_ENHANCED):
            self.req(SMART_SHIFT_ENHANCED, 2, p)

    # ------------------------------------------------------------ hires wheel
    def hires(self) -> Optional[HiResState]:
        if not self.has(HIRES_WHEEL):
            return None
        cap = self.req(HIRES_WHEEL, 0)
        mode = self.req(HIRES_WHEEL, 1)[0]
        return HiResState(bool(mode & 0x01), bool(mode & 0x02), bool(mode & 0x04),
                          multiplier=cap[0], has_invert=bool(cap[1] & 0x08), has_ratchet_switch=bool(cap[1] & 0x04))

    def set_hires(self, hidpp_target: bool, hires: bool, invert: bool):
        mode = (0x01 if hidpp_target else 0) | (0x02 if hires else 0) | (0x04 if invert else 0)
        self.req(HIRES_WHEEL, 2, bytes([mode]))

    # ------------------------------------------------------------ thumb wheel
    def thumbwheel(self) -> Optional[ThumbWheelState]:
        if not self.has(THUMB_WHEEL):
            return None
        info = self.req(THUMB_WHEEL, 0)
        st = self.req(THUMB_WHEEL, 1)
        nres, dres, caps = struct.unpack(">HHB", info[:5])
        return ThumbWheelState(bool(st[0] & 0x01), bool(st[1] & 0x01), nres, dres, caps)

    def set_thumbwheel(self, diverted: bool, invert: bool):
        self.req(THUMB_WHEEL, 2, bytes([1 if diverted else 0, 1 if invert else 0]))

    # -------------------------------------------------------------------- dpi
    def dpi(self) -> Optional[DpiState]:
        if not self.has(ADJUSTABLE_DPI):
            return None
        r = self.req(ADJUSTABLE_DPI, 2, b"\0")
        _s, cur, default = struct.unpack(">BHH", r[:5])
        lst = self.req(ADJUSTABLE_DPI, 1, b"\0")
        vals = []
        stepped = False
        for i in range(1, len(lst) - 1, 2):
            v = struct.unpack(">H", lst[i:i + 2])[0]
            if v == 0:
                break
            if v & 0xE000 == 0xE000:
                stepped = True
                vals.append(v & 0x1FFF)   # step value
            else:
                vals.append(v)
        if stepped and len(vals) >= 3:
            # layout is [min, step, max]
            mn, step, mx = vals[0], vals[1], vals[2]
            return DpiState(cur, default, [mn, mx, step], True)
        return DpiState(cur, default, vals, False)

    def set_dpi(self, dpi: int):
        self.req(ADJUSTABLE_DPI, 3, struct.pack(">BH", 0, dpi))

    # ------------------------------------------------------------- backlight
    def backlight(self) -> Optional[BacklightState]:
        if not self.has(BACKLIGHT2):
            return None
        r = self.req(BACKLIGHT2, 0)
        enabled, options, supported, effects, level, dho, dhi, dpow = struct.unpack("<BBBHBHHH", r[:12])
        st = BacklightState(bool(enabled), options, supported, effects, level, dho, dhi, dpow)
        try:
            info = self.req(BACKLIGHT2, 2)
            st.num_levels, st.current_level, st.status = info[0], info[1], info[2]
        except (HidppError, Timeout):
            pass
        return st

    def set_backlight(self, enabled: bool, mode: Optional[int] = None, level: Optional[int] = None,
                      dho: Optional[int] = None, dhi: Optional[int] = None, dpow: Optional[int] = None):
        cur = self.backlight()
        if cur is None:
            return
        options = cur.options & 0x07
        m = cur.mode if mode is None else mode
        options |= (m & 0x03) << 3
        lvl = cur.level if level is None else level
        if m != 3:
            lvl = 0
        data = struct.pack("<BBBBHHH", 1 if enabled else 0, options, 0xFF, lvl,
                           cur.duration_hands_out if dho is None else dho,
                           cur.duration_hands_in if dhi is None else dhi,
                           cur.duration_powered if dpow is None else dpow)
        self.req(BACKLIGHT2, 1, data)

    # ----------------------------------------------------------------- hosts
    def hosts(self) -> list[HostInfo]:
        out = []
        if not self.has(HOSTS_INFO):
            return out
        st = self.req(HOSTS_INFO, 0)
        caps, num, cur = st[0], st[2], st[3]
        for h in range(num):
            r = self.req(HOSTS_INFO, 1, bytes([h]))
            _h, status, bus, _pages, nlen, _nmax = struct.unpack(">BBBBBB", r[:6])
            name = b""
            if caps & 0x01:
                while len(name) < nlen:
                    piece = self.req(HOSTS_INFO, 3, bytes([h, len(name)]))
                    chunk = piece[2:2 + min(14, nlen - len(name))]
                    if not chunk:
                        break
                    name += chunk
            out.append(HostInfo(h, bool(status), bus, name.decode(errors="replace")))
        return out

    def current_host(self) -> tuple[int, int]:
        """(number of hosts, current host index)"""
        if self.has(CHANGE_HOST):
            r = self.req(CHANGE_HOST, 0)
            return r[0], r[1]
        if self.has(HOSTS_INFO):
            r = self.req(HOSTS_INFO, 0)
            return r[2], r[3]
        return 0, 0

    def change_host(self, host: int):
        self.req(CHANGE_HOST, 1, bytes([host]), no_reply=True)

    # ------------------------------------------------------------ fn inversion
    def fn_inversion(self) -> Optional[bool]:
        if not self.has(FN_INVERSION_K375S):
            return None
        r = self.req(FN_INVERSION_K375S, 0, b"\xff")
        return bool(r[1])

    def set_fn_inversion(self, on: bool):
        if self.has(FN_INVERSION_K375S):
            self.req(FN_INVERSION_K375S, 1, bytes([0xFF, 1 if on else 0]))

    # ----------------------------------------------------------- notification
    def classify(self, n: Notification) -> Optional[tuple[str, dict]]:
        """Turn a raw notification addressed to this device into (kind, data)."""
        if n.device_index != self.index:
            return None
        f = self.feature_by_index(n.feature_index)
        if f is None:
            return None
        d = n.data
        if f.id == SPECIAL_KEYS:
            if n.event == 0:
                cids = [c for c in struct.unpack(">4H", d[:8]) if c]
                return "buttons", {"down": cids}
            if n.event == 1:
                dx, dy = struct.unpack(">hh", d[:4])
                return "raw_xy", {"dx": dx, "dy": dy}
        elif f.id == THUMB_WHEEL and n.event == 0:
            rot, ts = struct.unpack(">hH", d[:4])
            return "thumbwheel", {"rotation": rot, "timestamp": ts, "status": d[4], "touch": d[5] if len(d) > 5 else 0}
        elif f.id == HIRES_WHEEL:
            if n.event == 0:
                delta = struct.unpack(">h", d[1:3])[0]
                return "wheel", {"hires": bool(d[0] & 0x10), "periods": d[0] & 0x0F, "delta": delta}
            if n.event == 1:
                return "ratchet", {"ratchet": bool(d[0])}
        elif f.id == UNIFIED_BATTERY and n.event == 0:
            b = self._decode_battery(d)
            return "battery", b.__dict__
        elif f.id == WIRELESS_STATUS:
            return "wireless", {"reconnect": bool(d[0]), "data": d[:3].hex()}
        elif f.id == CONFIG_CHANGE:
            return "config_change", {}
        elif f.id == BACKLIGHT2 and n.event == 0:
            return "backlight", {"num_levels": d[0], "level": d[1], "status": d[2], "effect": d[3] if len(d) > 3 else 0}
        return f.name.lower().replace(" ", "_"), {"raw": d.hex(), "event": n.event}
