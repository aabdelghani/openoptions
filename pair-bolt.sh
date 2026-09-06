#!/usr/bin/env bash
# Pair a device to the Bolt receiver with the Bluetooth adapter switched off.
#
# BlueZ aggressively reconnects to a keyboard it already knows. When that device leaves
# its current channel to enter pairing mode, those reconnect attempts share the 2.4 GHz
# band with the Bolt handshake and it fails a few seconds after the passcode is typed.
# This script keeps the air quiet for the duration and restores Bluetooth on exit.
set -u
cd "$(dirname "$0")"

BT_WAS_ON=$(bluetoothctl show 2>/dev/null | grep -c 'Powered: yes')
restore() { [ "$BT_WAS_ON" = 1 ] && bluetoothctl power on >/dev/null 2>&1; echo; echo "Bluetooth restored."; }
trap restore EXIT INT TERM
[ "$BT_WAS_ON" = 1 ] && { bluetoothctl power off >/dev/null 2>&1; echo "Bluetooth switched off for the duration."; sleep 1; }

exec python3 - <<'PY'
import sys, os, json, time, socket, subprocess
sys.path.insert(0, '.')
from logimx.ipc import Client

def notify(t, b, u='normal'):
    subprocess.run(['notify-send', '-a', 'LogiMX', '-u', u, '-t', '40000', t, b],
                   stderr=subprocess.DEVNULL)

c = Client()
try: c.call('pair_cancel')
except Exception: pass

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(os.environ.get('XDG_RUNTIME_DIR', '/run/user/1000') + '/logimx.sock')
s.settimeout(1.0)

print()
print('  Hold the Easy-Switch key of the channel you want (1, 2 or 3)')
print('  for 3 seconds, until it blinks fast.')
print()
print('  Waiting for the device… press Ctrl+C to stop.')
print()

c.call('pair_start')
buf = b''; seen = False; last = None; result = None
while result is None:
    try:
        chunk = s.recv(65536)
    except socket.timeout:
        if not seen and not c.call('pair_status').get('active'):
            c.call('pair_start')          # keep the door open until the device shows up
        continue
    except KeyboardInterrupt:
        break
    if not chunk: break
    buf += chunk
    while b'\n' in buf:
        line, buf = buf.split(b'\n', 1)
        try: d = json.loads(line)
        except Exception: continue
        if d.get('event') != 'pair': continue
        d = d['data']; st = d.get('status')
        if st in ('found', 'pairing'):
            seen = True
            if st == 'found': print('  Found %s.' % (d['found'][0]['name'] if d.get('found') else 'device'))
        elif st == 'passkey' and d.get('passkey') and d['passkey'] != last:
            last = d['passkey']
            print()
            print('  ' + '=' * 46)
            print('     TYPE  %s  THEN PRESS ENTER' % '  '.join(last))
            print('     (type it straight through, do not pause)')
            print('  ' + '=' * 46)
            print()
            notify('Type on the keyboard: ' + last, 'then press Enter, without pausing', 'critical')
        elif st == 'done':
            print('  Paired.'); notify('Paired', 'Device joined the Bolt receiver'); result = 'ok'
        elif st == 'error':
            if seen:
                print('  Failed: %s' % d.get('error', '')); result = 'fail'
            else:
                c.call('pair_start')
print()
print('  Result:', 'paired' if result == 'ok' else 'not paired')
PY
