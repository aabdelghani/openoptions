"""logimxd: owns the devices, applies settings, turns events into actions,
and serves the UI / CLI over a local socket.
"""
from __future__ import annotations

import logging
import signal
import sys
import threading
import time
from typing import Optional

from . import ipc
from .actions.engine import ActionEngine
from .actions.injector import Injector
from .actions.presets import BUTTON_PRESETS, KEY_PRESETS, PRESETS, WHEEL_PRESETS, resolve
from .apps.tracker import AppTracker
from .config import CID_NAMES, CONTROL_LABELS, Config
from .hidpp import discovery, protocol
from .hidpp.protocol import Device
from .hidpp.transport import HidppError, Notification, Timeout, Transport

log = logging.getLogger("logimx")


class ManagedDevice:
    def __init__(self, daemon: "Daemon", transport: Transport, dev: Device, pid: int):
        self.daemon = daemon
        self.t = transport
        self.dev = dev
        self.pid = pid
        self.kind = dev.kind
        self.cfg = daemon.config.device(pid, self.kind)
        self.profile_name = "default"
        self.profile = self.cfg.get("profiles", {}).get("default", {})
        self.battery: Optional[protocol.Battery] = None
        self.down: set[int] = set()
        self.diverted: set[int] = set()
        self.engine = ActionEngine(daemon.injector, {
            "change_host": self.dev.change_host,
            "get_dpi": lambda: (self.dev.dpi().dpi if self.dev.has(protocol.ADJUSTABLE_DPI) else 0),
            "set_dpi": self.dev.set_dpi,
        })
        self.lock = threading.RLock()
        self.state: dict = {}
        self.last_seen = time.time()

    # ------------------------------------------------------------- identity
    @property
    def id(self) -> str:
        return f"{self.pid:04x}"

    def summary(self) -> dict:
        return {
            "id": self.id, "pid": self.pid, "name": self.dev.name, "friendly_name": self.dev.friendly_name,
            "kind": self.kind, "firmware": self.dev.firmware, "serial": self.dev.serial,
            "transport": "bolt" if self.t.info.product in discovery.RECEIVERS else "bluetooth",
            "index": self.dev.index, "battery": self.battery.__dict__ if self.battery else None,
            "profile": self.profile_name, "features": sorted(f"{k:04X}" for k in self.dev.features),
            "controls": [{"cid": c.cid, "name": CID_NAMES.get(c.cid, f"cid_{c.cid:x}"),
                          "label": CONTROL_LABELS.get(c.cid, f"Control 0x{c.cid:X}"),
                          "divertable": c.divertable, "raw_xy": c.raw_xy, "fkey": c.is_fkey,
                          "diverted": c.cid in self.diverted} for c in self.dev.controls.values()],
            "state": self.state,
        }

    # ------------------------------------------------------------- settings
    def read_state(self):
        st = {}
        try:
            self.battery = self.dev.battery()
            ss = self.dev.smartshift()
            if ss:
                st["smartshift"] = {"mode": "ratchet" if ss.mode == 2 else "freespin", "threshold": ss.threshold, "default_threshold": ss.default_threshold}
            hr = self.dev.hires()
            if hr:
                st["hires"] = hr.__dict__
            tw = self.dev.thumbwheel()
            if tw:
                st["thumbwheel"] = tw.__dict__
            dp = self.dev.dpi()
            if dp:
                st["dpi"] = dp.__dict__
            bl = self.dev.backlight()
            if bl:
                st["backlight"] = dict(bl.__dict__, mode=bl.mode, auto_supported=bl.auto_supported,
                                       perm_manual_supported=bl.perm_manual_supported)
            n, cur = self.dev.current_host()
            st["hosts"] = {"count": n, "current": cur, "names": [h.__dict__ for h in self.dev.hosts()]}
            fi = self.dev.fn_inversion()
            if fi is not None:
                st["fn_swap"] = fi
        except (HidppError, Timeout, OSError) as e:
            log.warning("%s: read_state failed: %s", self.dev.name, e)
        self.state = st
        return st

    def apply_settings(self):
        s = self.cfg.get("settings", {})
        try:
            if self.dev.has(protocol.ADJUSTABLE_DPI) and "dpi" in s:
                self.dev.set_dpi(int(s["dpi"]))
            if (self.dev.has(protocol.SMART_SHIFT) or self.dev.has(protocol.SMART_SHIFT_ENHANCED)) and "smartshift" in s:
                ss = s["smartshift"]
                mode = {"ratchet": 2, "freespin": 1}.get(ss.get("mode", "ratchet"), 2)
                self.dev.set_smartshift(mode, int(ss.get("threshold", 0)))
            if self.dev.has(protocol.HIRES_WHEEL) and "hires" in s:
                h = s["hires"]
                self.dev.set_hires(False, bool(h.get("enabled", True)), bool(h.get("invert", False)))
            if self.dev.has(protocol.BACKLIGHT2) and "backlight" in s:
                b = s["backlight"]
                mode = {"auto": 1, "manual": 3, "temporary": 2}.get(b.get("mode", "auto"), 1)
                self.dev.set_backlight(bool(b.get("enabled", True)), mode=mode, level=int(b.get("level", 0)))
            if self.dev.has(protocol.FN_INVERSION_K375S) and "fn_swap" in s:
                self.dev.set_fn_inversion(bool(s["fn_swap"]))
        except (HidppError, Timeout, OSError) as e:
            log.warning("%s: apply_settings failed: %s", self.dev.name, e)

    def apply_assignments(self):
        """Divert every control that has a non-native action in the active profile."""
        p = self.profile
        wanted: dict[int, dict] = {}
        for section in ("buttons", "keys"):
            for cid_s, action in p.get(section, {}).items():
                a = resolve(action)
                if a.get("type") != "native":
                    wanted[int(cid_s)] = a
        with self.lock:
            for cid, ctl in self.dev.controls.items():
                if not ctl.divertable:
                    continue
                want = cid in wanted
                raw = want and wanted[cid].get("type") == "gesture" and ctl.raw_xy
                if want != (cid in self.diverted) or raw:
                    try:
                        self.dev.set_reporting(cid, divert=want, raw_xy=raw if ctl.raw_xy else None)
                        if want:
                            self.diverted.add(cid)
                        else:
                            self.diverted.discard(cid)
                    except (HidppError, Timeout, OSError) as e:
                        log.warning("%s: divert cid 0x%x failed: %s", self.dev.name, cid, e)
            if self.dev.has(protocol.THUMB_WHEEL):
                tw_action = resolve(p.get("thumbwheel", "native"))
                invert = bool(self.cfg.get("settings", {}).get("thumbwheel", {}).get("invert", False))
                try:
                    self.dev.set_thumbwheel(tw_action.get("type") != "native", invert)
                except (HidppError, Timeout, OSError) as e:
                    log.warning("%s: thumbwheel divert failed: %s", self.dev.name, e)

    def release_all(self):
        with self.lock:
            for cid in list(self.diverted):
                try:
                    self.dev.set_reporting(cid, divert=False, raw_xy=False if self.dev.controls[cid].raw_xy else None)
                except (HidppError, Timeout, OSError):
                    pass
            self.diverted.clear()
            if self.dev.has(protocol.THUMB_WHEEL):
                try:
                    self.dev.set_thumbwheel(False, bool(self.cfg.get("settings", {}).get("thumbwheel", {}).get("invert", False)))
                except (HidppError, Timeout, OSError):
                    pass

    def set_profile(self, app_class: Optional[str]):
        name, prof = self.daemon.config.profile_for(self.pid, app_class)
        if name != self.profile_name:
            self.profile_name, self.profile = name, prof
            log.info("%s: profile -> %s (%s)", self.dev.name, name, app_class)
            self.apply_assignments()

    # --------------------------------------------------------------- events
    def action_for(self, cid: int):
        for section in ("buttons", "keys"):
            a = self.profile.get(section, {}).get(str(cid))
            if a is not None:
                return a
        return "native"

    def handle(self, kind: str, data: dict):
        self.last_seen = time.time()
        if kind == "buttons":
            now = set(data["down"])
            for cid in now - self.down:
                self.engine.button_down(cid, self.action_for(cid))
            for cid in self.down - now:
                self.engine.button_up(cid, self.action_for(cid))
            self.down = now
        elif kind == "raw_xy":
            self.engine.raw_xy(data["dx"], data["dy"])
        elif kind == "thumbwheel":
            invert = bool(self.cfg.get("settings", {}).get("thumbwheel", {}).get("invert", False))
            # forward (away from the user) is positive after this; engine maps positive to right / up / next
            self.engine.thumbwheel(-data["rotation"], self.profile.get("thumbwheel", "native"), invert=False)
        elif kind == "battery":
            self.battery = protocol.Battery(data["percent"], data["level"], data["charging"], data["external_power"])
        elif kind == "wireless":
            if data.get("reconnect"):
                log.info("%s: reconnected, re-applying", self.dev.name)
                threading.Timer(0.5, self.reapply).start()
        elif kind == "backlight":
            self.state.setdefault("backlight", {})["current_level"] = data["level"]

    def reapply(self):
        try:
            self.diverted.clear()
            self.apply_settings()
            self.apply_assignments()
            self.read_state()
        except Exception as e:
            log.warning("reapply failed: %s", e)


class Daemon:
    def __init__(self):
        self.config = Config()
        self.injector = Injector()
        self.transports: dict[str, Transport] = {}
        self.devices: dict[str, ManagedDevice] = {}      # keyed by device id (pid hex)
        self._by_route: dict[tuple[str, int], ManagedDevice] = {}
        self.tracker = AppTracker(self._on_app)
        self.app_class: Optional[str] = None
        self._stop = threading.Event()
        self.server = ipc.Server(self.rpc)

    # ------------------------------------------------------------ lifecycle
    def run(self):
        self.tracker.start()
        log.info("app tracker backend: %s", self.tracker.backend)
        signal.signal(signal.SIGTERM, lambda *_: self._stop.set())
        signal.signal(signal.SIGINT, lambda *_: self._stop.set())
        last_scan = 0.0
        last_poll = 0.0
        while not self._stop.is_set():
            now = time.time()
            if now - last_scan > 3.0:
                self.scan()
                last_scan = now
            if now - last_poll > 30.0:
                for md in list(self.devices.values()):
                    try:
                        md.battery = md.dev.battery()
                    except (HidppError, Timeout, OSError):
                        pass
                last_poll = now
            time.sleep(0.25)
        self.shutdown()

    def shutdown(self):
        log.info("shutting down")
        for md in list(self.devices.values()):
            md.release_all()
        for t in self.transports.values():
            t.close()
        self.server.close()
        self.injector.close()

    # ------------------------------------------------------------ discovery
    def scan(self):
        nodes = discovery.usable(discovery.scan())
        seen_paths = {n.path for n in nodes}
        for path in list(self.transports):
            if path not in seen_paths:
                self._drop_transport(path)
        for n in nodes:
            if n.path in self.transports:
                continue
            try:
                t = Transport(n.path, on_notification=self._on_notification)
            except OSError as e:
                log.debug("open %s failed: %s", n.path, e)
                continue
            found = 0
            idxs = range(1, 7) if n.is_receiver else [0xFF]
            for i in idxs:
                if self._attach(t, i, n):
                    found += 1
            if found or n.is_receiver:
                self.transports[n.path] = t
                if n.is_receiver:
                    log.info("receiver %s on %s: %d device(s)", n.receiver_kind, n.path, found)
            else:
                t.close()

    def _attach(self, t: Transport, idx: int, node: discovery.Node) -> bool:
        dev = Device(t, idx)
        try:
            if not dev.enumerate():
                return False
        except (HidppError, Timeout, OSError) as e:
            log.debug("enumerate %s/%d: %s", t.path, idx, e)
            return False
        pid = node.product
        if node.is_receiver:
            info = t.pairing_info(idx)
            pid = info[0] if info else 0
        if pid == 0:
            return False
        key = f"{pid:04x}"
        if key in self.devices:  # same device on a second transport (e.g. BT + Bolt): keep the first
            return False
        md = ManagedDevice(self, t, dev, pid)
        self.devices[key] = md
        self._by_route[(t.path, idx)] = md
        log.info("device %s (%s) pid %04x via %s idx %d, %d features, %d controls",
                 dev.name, dev.kind, pid, t.path, idx, len(dev.features), len(dev.controls))
        md.set_profile(self.app_class)
        md.apply_settings()
        md.apply_assignments()
        md.read_state()
        return True

    def _drop_transport(self, path: str):
        t = self.transports.pop(path, None)
        for key, md in list(self.devices.items()):
            if md.t is t:
                log.info("device %s gone", md.dev.name)
                self.devices.pop(key)
                self._by_route.pop((path, md.dev.index), None)
        if t:
            t.close()

    # ---------------------------------------------------------------- events
    def _on_notification(self, n: Notification):
        # HID++ 1.0 receiver notification 0x41: device connection/disconnection
        if n.feature_index == 0x41 and n.report_id == 0x10:
            md = None
            for (path, idx), m in self._by_route.items():
                if idx == n.device_index and m.t.info.product in discovery.RECEIVERS:
                    md = m
            link_down = bool(n.data[0] & 0x40) if n.data else False
            if md and not link_down:
                threading.Timer(0.8, md.reapply).start()
            elif md is None and not link_down:
                # new device on a known receiver
                for path, t in self.transports.items():
                    if t.info.product in discovery.RECEIVERS:
                        node = discovery.Node(path, t.info.vendor, t.info.product, t.info.name, t.info.bustype)
                        threading.Timer(1.0, lambda: self._attach(t, n.device_index, node)).start()
            return
        for md in list(self._by_route.values()):
            if md.dev.index != n.device_index or md.t is not self._transport_of(n):
                continue
            ev = md.dev.classify(n)
            if ev:
                md.handle(*ev)

    def _transport_of(self, n: Notification):
        # notifications do not carry the path; the reader thread belongs to one transport,
        # so identify it by thread name
        name = threading.current_thread().name
        for path, t in self.transports.items():
            if name.endswith(path.split("/")[-1]):
                return t
        return None

    def _on_app(self, cls: Optional[str]):
        self.app_class = cls
        for md in list(self.devices.values()):
            md.set_profile(cls)

    # ------------------------------------------------------------------ RPC
    def rpc(self, method: str, p: dict):
        if method == "devices":
            return [md.summary() for md in self.devices.values()]
        if method == "device":
            md = self.devices[p["id"]]
            md.read_state()
            return md.summary()
        if method == "config":
            return self.config.data
        if method == "presets":
            return {"all": PRESETS, "buttons": BUTTON_PRESETS, "keys": KEY_PRESETS, "wheel": WHEEL_PRESETS}
        if method == "set_setting":
            md = self.devices[p["id"]]
            self.config.set_setting(md.pid, p["path"], p["value"])
            md.cfg = self.config.device(md.pid, md.kind)
            md.apply_settings()
            md.apply_assignments()
            return md.read_state()
        if method == "set_assignment":
            md = self.devices[p["id"]]
            self.config.set_assignment(md.pid, p.get("profile", "default"), p["section"], p.get("control", ""), p["action"])
            md.cfg = self.config.device(md.pid, md.kind)
            md.profile = md.cfg["profiles"].get(md.profile_name, md.cfg["profiles"]["default"])
            md.apply_assignments()
            return md.summary()
        if method == "set_profiles":
            md = self.devices[p["id"]]
            md.cfg["profiles"] = p["profiles"]
            self.config.save()
            md.set_profile(self.app_class)
            md.apply_assignments()
            return md.summary()
        if method == "change_host":
            self.devices[p["id"]].dev.change_host(int(p["host"]))
            return True
        if method == "reload":
            self.config.load()
            for md in self.devices.values():
                md.cfg = self.config.device(md.pid, md.kind)
                md.reapply()
            return True
        if method == "status":
            return {"devices": len(self.devices), "app": self.app_class, "tracker": self.tracker.backend,
                    "transports": list(self.transports)}
        if method == "ping":
            return "pong"
        raise ValueError(f"unknown method {method}")


def main():
    logging.basicConfig(level=logging.DEBUG if "-v" in sys.argv else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    d = Daemon()
    d.run()


if __name__ == "__main__":
    main()
