"""hidraw transport for HID++ 1.0/2.0 receivers and devices.

One Transport owns one /dev/hidrawN node (a receiver, or a directly connected
Bluetooth / USB device). Requests are serialised; notifications are delivered
to a callback from the reader thread.
"""
from __future__ import annotations

import fcntl
import os
import queue
import select
import struct
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

SHORT = 0x10   # 7 bytes
LONG = 0x11    # 20 bytes
VERY_LONG = 0x12  # 64 bytes
DJ_SHORT = 0x20
DJ_LONG = 0x21

SHORT_LEN = 7
LONG_LEN = 20

SW_ID = 0x0D  # our software id (low nibble of the function byte); Solaar uses another

# HIDIOCGRAWINFO / HIDIOCGRAWNAME(len) from linux/hidraw.h
_HIDIOCGRAWINFO = 0x80084803
_HIDIOCGRAWNAME = lambda n: 0x80004804 | (n << 16)  # noqa: E731
_HIDIOCGRDESCSIZE = 0x80044801
_HIDIOCGRDESC = 0x90044802


@dataclass
class RawInfo:
    bustype: int
    vendor: int
    product: int
    name: str


def raw_info(path: str) -> RawInfo:
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    try:
        buf = fcntl.ioctl(fd, _HIDIOCGRAWINFO, bytes(8))
        bustype, vendor, product = struct.unpack("<IHH", buf)
        name = fcntl.ioctl(fd, _HIDIOCGRAWNAME(256), bytes(256)).split(b"\0", 1)[0].decode(errors="replace")
        return RawInfo(bustype, vendor & 0xFFFF, product & 0xFFFF, name)
    finally:
        os.close(fd)


def report_descriptor(path: str) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    try:
        size = struct.unpack("<I", fcntl.ioctl(fd, _HIDIOCGRDESCSIZE, bytes(4)))[0]
        buf = bytearray(4 + 4096)
        struct.pack_into("<I", buf, 0, size)
        fcntl.ioctl(fd, _HIDIOCGRDESC, buf, True)
        return bytes(buf[4:4 + size])
    finally:
        os.close(fd)


def supports_hidpp(path: str) -> bool:
    """True if the report descriptor exposes the vendor usage pages
    used by HID++ (0xFF00 / 0xFF43 with report ids 0x10 / 0x11)."""
    try:
        desc = report_descriptor(path)
    except OSError:
        return False
    return b"\x06\x00\xff" in desc or b"\x06\x43\xff" in desc


class HidppError(Exception):
    def __init__(self, code: int, feature_index: int = 0, function: int = 0):
        self.code = code
        self.feature_index = feature_index
        self.function = function
        super().__init__(f"HID++ error 0x{code:02x} (feature idx 0x{feature_index:02x}, fn 0x{function >> 4:x})")


class Timeout(Exception):
    pass


@dataclass
class Notification:
    device_index: int
    feature_index: int  # for HID++ 2.0: feature index; for 1.0: sub id
    event: int          # high nibble of byte 3 (function/event id)
    sw_id: int
    data: bytes
    report_id: int


class Transport:
    def __init__(self, path: str, on_notification: Optional[Callable[[Notification], None]] = None,
                 timeout: float = 1.5):
        self.path = path
        self.info = raw_info(path)
        self.fd = os.open(path, os.O_RDWR | os.O_NONBLOCK)
        self.timeout = timeout
        self._lock = threading.Lock()
        self._pending: dict[tuple, queue.Queue] = {}
        self._pending_lock = threading.Lock()
        self.on_notification = on_notification
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._reader, name=f"hidpp-reader-{os.path.basename(path)}", daemon=True)
        self._thread.start()

    # ------------------------------------------------------------------ io
    def close(self):
        self._stop.set()
        try:
            os.close(self.fd)
        except OSError:
            pass

    def _reader(self):
        while not self._stop.is_set():
            try:
                r, _, _ = select.select([self.fd], [], [], 0.5)
            except (OSError, ValueError):
                return
            if not r:
                continue
            try:
                data = os.read(self.fd, 64)
            except BlockingIOError:
                continue
            except OSError:
                return
            if not data:
                continue
            self._dispatch(data)

    def _dispatch(self, data: bytes):
        rid = data[0]
        if rid not in (SHORT, LONG, VERY_LONG):
            return  # DJ reports and plain HID reports are not ours
        if len(data) < 4:
            return
        devidx, feat, fnsw = data[1], data[2], data[3]
        payload = data[4:]
        # HID++ 1.0 error: sub id 0x8F ; HID++ 2.0 error: feature index 0xFF
        if feat == 0x8F or feat == 0xFF:
            err_feat, err_fn, err_code = data[3], data[4], data[5]
            if not self._resolve((devidx, err_feat, err_fn & 0xF0), HidppError(err_code, err_feat, err_fn)):
                self._resolve((devidx, 0x8F, err_fn & 0xF0), HidppError(err_code, err_feat, err_fn))
            return
        key = (devidx, feat, fnsw & 0xF0)
        if feat in (0x80, 0x81, 0x82, 0x83):  # HID++ 1.0 register reply: byte3 is the register
            if self._resolve((devidx, feat, fnsw), data[4:]):
                return
        elif (fnsw & 0x0F) == SW_ID and self._resolve(key, payload):
            return
        # everything else (sw id 0, or unmatched) is a notification/event
        if self.on_notification:
            try:
                self.on_notification(Notification(devidx, feat, fnsw >> 4, fnsw & 0x0F, payload, rid))
            except Exception:  # never kill the reader
                pass

    def _resolve(self, key, value) -> bool:
        with self._pending_lock:
            q = self._pending.get(key)
        if q is None:
            return False
        q.put(value)
        return True

    # ------------------------------------------------------------- request
    def request(self, device_index: int, feature_index: int, function: int, params: bytes = b"",
                long: Optional[bool] = None, no_reply: bool = False, timeout: Optional[float] = None) -> bytes:
        """Send a HID++ 2.0 request. `function` is the function number (0..15).
        Returns the payload (16 bytes for long replies)."""
        fnsw = ((function & 0x0F) << 4) | SW_ID
        if long is None:
            long = len(params) > 3 or self.info.bustype == 0x05  # BT prefers long reports
        if long:
            frame = struct.pack("BBBB", LONG, device_index, feature_index, fnsw) + params.ljust(LONG_LEN - 4, b"\0")
        else:
            frame = struct.pack("BBBB", SHORT, device_index, feature_index, fnsw) + params.ljust(SHORT_LEN - 4, b"\0")
        key = (device_index, feature_index, fnsw & 0xF0)
        q: queue.Queue = queue.Queue()
        with self._lock:
            with self._pending_lock:
                self._pending[key] = q
            try:
                os.write(self.fd, frame)
                if no_reply:
                    return b""
                try:
                    res = q.get(timeout=timeout or self.timeout)
                except queue.Empty:
                    raise Timeout(f"no reply from device {device_index} feature 0x{feature_index:02x} fn {function}")
            finally:
                with self._pending_lock:
                    self._pending.pop(key, None)
        if isinstance(res, Exception):
            raise res
        return res

    def request10(self, device_index: int, sub_id: int, register: int, params: bytes = b"",
                  long: bool = False, timeout: Optional[float] = None) -> bytes:
        """HID++ 1.0 register access (sub_id 0x80 set / 0x81 get / 0x82 set long / 0x83 get long)."""
        rid, size = (LONG, LONG_LEN) if long else (SHORT, SHORT_LEN)
        frame = struct.pack("BBBB", rid, device_index, sub_id, register) + params.ljust(size - 4, b"\0")
        reply_sub = sub_id  # replies echo the sub id
        key = (device_index, reply_sub, register)
        q: queue.Queue = queue.Queue()
        with self._lock:
            with self._pending_lock:
                self._pending[key] = q
                self._pending[(device_index, 0x8F, register & 0xF0)] = q
            try:
                os.write(self.fd, frame)
                try:
                    res = q.get(timeout=timeout or self.timeout)
                except queue.Empty:
                    raise Timeout(f"no reply to register 0x{register:02x}")
            finally:
                with self._pending_lock:
                    self._pending.pop(key, None)
                    self._pending.pop((device_index, 0x8F, register & 0xF0), None)
        if isinstance(res, Exception):
            raise res
        return res

    def pairing_info(self, device_index: int) -> Optional[tuple[int, int, str]]:
        """(wpid, device_kind, serial) for a receiver slot. Bolt: register 0xB5 sub 0x50+idx;
        Unifying/Nano: 0xB5 sub 0x20+idx-1."""
        try:
            r = self.request10(0xFF, 0x83, 0xB5, bytes([0x50 + device_index]))
            if len(r) >= 8 and r[0] == 0x50 + device_index:
                return (r[3] << 8) | r[2], r[1] & 0x0F, r[4:8].hex().upper()
        except (HidppError, Timeout, OSError):
            pass
        try:
            r = self.request10(0xFF, 0x83, 0xB5, bytes([0x20 | (device_index - 1)]))
            if len(r) >= 8 and (r[0] & 0x0F) == device_index - 1:
                return struct.unpack(">H", r[3:5])[0], r[7] & 0x0F, ""
        except (HidppError, Timeout, OSError):
            pass
        return None

    def ping(self, device_index: int) -> Optional[tuple[int, int]]:
        """ROOT.getProtocolVersion. Returns (major, minor) or None if the device is
        not reachable (HID++ 1.0 devices answer with an error 0x8F)."""
        try:
            r = self.request(device_index, 0x00, 0x1, b"\0\0\x5a", long=False)
        except HidppError:
            return (1, 0)
        except (Timeout, OSError):
            return None
        return (r[0], r[1])

    def __repr__(self):
        return f"Transport({self.path}, {self.info.vendor:04x}:{self.info.product:04x} '{self.info.name}')"


def _sleep(s: float):
    time.sleep(s)
