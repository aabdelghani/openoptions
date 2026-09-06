#!/usr/bin/env python3
"""Regenerate agent/src/tables.gen.h and keycodes.gen.h from the Python sources. Run from linux/."""
import json, re, sys
sys.path.insert(0, '.')
from logimx.actions.presets import PRESETS, BUTTON_PRESETS, KEY_PRESETS, WHEEL_PRESETS
from logimx.config import MX_MASTER_3S, MX_KEYS_S, CONTROL_LABELS, CID_NAMES
codes = []
for line in open('/usr/include/linux/input-event-codes.h'):
    m = re.match(r'#define\s+((?:KEY|BTN)_[A-Z0-9_]+)\s+(0x[0-9a-fA-F]+|\d+)\b', line)
    if m: codes.append((m.group(1), int(m.group(2), 0)))
with open('agent/src/actions/keycodes.gen.h', 'w') as f:
    f.write('// generated from linux/input-event-codes.h\n#pragma once\n#include <cstdint>\n#include <string_view>\n#include <utility>\n')
    f.write('inline constexpr std::pair<std::string_view, uint16_t> kKeyCodes[] = {\n')
    for n, c in codes:
        if c < 0x300: f.write(f'  {{"{n}", {c}}},\n')
    f.write('};\n')
cstr = lambda s: 'R"json(' + s + ')json"'
with open('agent/src/tables.gen.h', 'w') as f:
    f.write('// generated from the Python sources (logimx/actions/presets.py, logimx/config.py)\n#pragma once\n')
    f.write('inline const char* kPresetsJson = ' + cstr(json.dumps({"all": PRESETS, "buttons": BUTTON_PRESETS, "keys": KEY_PRESETS, "wheel": WHEEL_PRESETS})) + ';\n')
    f.write('inline const char* kDefaultsJson = ' + cstr(json.dumps({"b034": MX_MASTER_3S, "b035": MX_MASTER_3S, "b043": MX_MASTER_3S, "b378": MX_KEYS_S, "b379": MX_KEYS_S, "b37a": MX_KEYS_S})) + ';\n')
    f.write('inline const char* kControlLabelsJson = ' + cstr(json.dumps({str(k): v for k, v in CONTROL_LABELS.items()})) + ';\n')
    f.write('inline const char* kCidNamesJson = ' + cstr(json.dumps({str(k): v for k, v in CID_NAMES.items()})) + ';\n')
print('tables regenerated:', len(codes), 'key codes,', len(PRESETS), 'presets')
