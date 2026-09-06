"""Find Bolt/Unifying receivers and directly connected MX devices under /dev/hidraw*."""
from __future__ import annotations

import glob
import os
from dataclasses import dataclass

from .transport import raw_info, supports_hidpp

VENDOR_ID = 0x046D  # MX family vendor id
BUS_USB, BUS_BLUETOOTH = 0x03, 0x05

RECEIVERS = {
    0xC548: "Bolt", 0xC52B: "Unifying", 0xC532: "Unifying", 0xC52F: "Nano", 0xC534: "Nano",
    0xC539: "Lightspeed", 0xC53A: "Lightspeed", 0xC53F: "Lightspeed", 0xC547: "Lightspeed",
}


@dataclass
class Node:
    path: str
    vendor: int
    product: int
    name: str
    bustype: int

    @property
    def is_receiver(self):
        return self.product in RECEIVERS

    @property
    def receiver_kind(self):
        return RECEIVERS.get(self.product, "")

    @property
    def is_bluetooth(self):
        return self.bustype == BUS_BLUETOOTH


def scan() -> list[Node]:
    out = []
    for p in sorted(glob.glob("/dev/hidraw*"), key=lambda s: int(s[len("/dev/hidraw"):])):
        if not os.access(p, os.R_OK | os.W_OK):
            continue
        try:
            info = raw_info(p)
        except OSError:
            continue
        if info.vendor != VENDOR_ID:
            continue
        if not supports_hidpp(p):
            continue
        out.append(Node(p, info.vendor, info.product, info.name, info.bustype))
    return out


def usable(nodes: list[Node]) -> list[Node]:
    """Receivers and Bluetooth devices only. USB nodes that are not receivers are the
    per-device children the kernel dj driver creates; the receiver path covers them."""
    return [n for n in nodes if n.is_receiver or n.is_bluetooth]
