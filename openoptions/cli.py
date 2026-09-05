"""openoptions command line client."""
from __future__ import annotations

import argparse
import json
import sys

from .ipc import Client


def fmt_device(d: dict):
    b = d.get("battery") or {}
    batt = f"{b.get('percent', '?')}%{' charging' if b.get('charging') else ''}" if b else "n/a"
    print(f"{d['name']}  [{d['id']}]  {d['kind']}  fw {d['firmware']}  via {d['transport']}  battery {batt}  profile {d['profile']}")
    st = d.get("state", {})
    if "dpi" in st:
        print(f"  dpi {st['dpi']['dpi']} (range {st['dpi']['levels']})")
    if "smartshift" in st:
        print(f"  smartshift {st['smartshift']['mode']} threshold {st['smartshift']['threshold']}")
    if "hires" in st:
        print(f"  hires wheel {st['hires']['hires']} invert {st['hires']['invert']}")
    if "thumbwheel" in st:
        print(f"  thumbwheel diverted {st['thumbwheel']['diverted']} invert {st['thumbwheel']['invert']}")
    if "backlight" in st:
        bl = st["backlight"]
        print(f"  backlight enabled {bl['enabled']} mode {bl['mode']} level {bl['current_level']}/{bl['num_levels']}")
    if "hosts" in st:
        h = st["hosts"]
        names = ", ".join(f"{'*' if n['index'] == h['current'] else ''}{n['index'] + 1}:{n['name'] or '-'}" for n in h["names"])
        print(f"  hosts {names}")
    ctl = [f"{c['label']}{'*' if c['diverted'] else ''}" for c in d.get("controls", []) if c["divertable"]]
    if ctl:
        print("  controls: " + ", ".join(ctl) + "   (* = diverted)")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="openoptions", description="Configure MX Master and MX Keys devices")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("status")
    sub.add_parser("devices")
    s = sub.add_parser("show"); s.add_argument("id")
    s = sub.add_parser("set", help="set a hardware setting, e.g. set b034 dpi 1600 | set b034 smartshift.threshold 20 | set b378 backlight.mode manual")
    s.add_argument("id"); s.add_argument("path"); s.add_argument("value")
    s = sub.add_parser("assign", help="assign an action: assign b034 buttons 195 gesture_navigation | assign b034 thumbwheel - volume_wheel")
    s.add_argument("id"); s.add_argument("section", choices=["buttons", "keys", "thumbwheel"]); s.add_argument("control"); s.add_argument("action")
    s.add_argument("--profile", default="default")
    sub.add_parser("presets")
    sub.add_parser("config")
    s = sub.add_parser("host"); s.add_argument("id"); s.add_argument("host", type=int, help="1..3")
    sub.add_parser("reload")
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_help(); return 0
    try:
        c = Client()
    except OSError:
        print("daemon not running (start with: python -m openoptions.daemon)", file=sys.stderr); return 1

    def parse_value(v: str):
        try:
            return json.loads(v)
        except ValueError:
            return v

    if a.cmd == "status":
        print(json.dumps(c.call("status"), indent=1))
    elif a.cmd == "devices":
        for d in c.call("devices"):
            fmt_device(d)
    elif a.cmd == "show":
        print(json.dumps(c.call("device", id=a.id), indent=1))
    elif a.cmd == "set":
        st = c.call("set_setting", id=a.id, path=a.path.split("."), value=parse_value(a.value))
        print(json.dumps(st, indent=1))
    elif a.cmd == "assign":
        d = c.call("set_assignment", id=a.id, profile=a.profile, section=a.section, control=a.control, action=parse_value(a.action))
        fmt_device(d)
    elif a.cmd == "presets":
        pr = c.call("presets")
        for k, v in pr["all"].items():
            print(f"{k:22s} {v['label']}")
    elif a.cmd == "config":
        print(json.dumps(c.call("config"), indent=1))
    elif a.cmd == "host":
        c.call("change_host", id=a.id, host=a.host - 1)
    elif a.cmd == "reload":
        c.call("reload")
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
