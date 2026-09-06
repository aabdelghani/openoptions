#!/usr/bin/env bash
# Build logimx_<version>_<arch>.deb: agent + CLI in /usr/bin, udev rule, systemd user unit,
# the packaged Electron UI in /opt/logimx and a desktop entry.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(node -p "require('$ROOT/ui/package.json').version")"
ARCH="$(dpkg --print-architecture)"
OUT="$ROOT/dist"
PKG="$OUT/deb/logimx_${VERSION}_${ARCH}"

echo "== agent"
cmake -B "$ROOT/agent/build" -S "$ROOT/agent" -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$ROOT/agent/build"

echo "== ui (unpacked)"
( cd "$ROOT/ui"
  [ -d node_modules ] || npm ci --no-audit --no-fund
  npx electron-builder --linux dir --publish never )
UNPACKED="$ROOT/ui/dist/linux-unpacked"
[ -x "$UNPACKED/logimx" ] || { echo "unpacked UI missing"; exit 1; }

echo "== tree"
rm -rf "$PKG"
mkdir -p "$PKG/DEBIAN" "$PKG/opt/logimx" "$PKG/usr/bin" "$PKG/usr/lib/udev/rules.d" \
         "$PKG/usr/lib/systemd/user" "$PKG/usr/share/applications" \
         "$PKG/usr/share/icons/hicolor/256x256/apps" "$PKG/usr/share/doc/logimx"
cp -a "$UNPACKED/." "$PKG/opt/logimx/"
install -m755 "$ROOT/agent/build/logimx-agent" "$PKG/usr/bin/logimx-agent"
install -m755 "$ROOT/agent/build/logimxctl"   "$PKG/usr/bin/logimxctl"
install -m644 "$ROOT/udev/60-logimx.rules"    "$PKG/usr/lib/udev/rules.d/60-logimx.rules"
sed 's|^ExecStart=.*|ExecStart=/usr/bin/logimx-agent|' "$ROOT/systemd/logimx.service" \
  > "$PKG/usr/lib/systemd/user/logimx.service"
install -m644 "$ROOT/ui/assets/icon.png" "$PKG/usr/share/icons/hicolor/256x256/apps/logimx.png"
install -m644 "$ROOT/LICENSE" "$PKG/usr/share/doc/logimx/copyright"
cat > "$PKG/usr/bin/logimx" <<'SH'
#!/bin/sh
exec /opt/logimx/logimx "$@"
SH
chmod 755 "$PKG/usr/bin/logimx"
cat > "$PKG/usr/share/applications/logimx.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Name=LogiMX
Comment=Buttons, gestures, keys and Easy-Switch for MX mice and keyboards
Exec=logimx %U
Icon=logimx
Terminal=false
Categories=Settings;HardwareSettings;
Keywords=mouse;keyboard;MX;Bolt;
StartupWMClass=logimx
StartupNotify=true
DESK

SIZE_KB="$(du -sk "$PKG" --exclude=DEBIAN | cut -f1)"
cat > "$PKG/DEBIAN/control" <<CTRL
Package: logimx
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Installed-Size: $SIZE_KB
Maintainer: aabdelghany <ahmedabdelghany15@gmail.com>
Homepage: https://github.com/aabdelghani/logimx
Depends: libc6, libstdc++6, libx11-6, libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0, libgbm1, libasound2 | libasound2t64, udev
Recommends: xdotool, pulseaudio-utils, libfuse2 | libfuse2t64
Description: Configuration app for MX Master and MX Keys devices
 Button and key assignments, gestures, thumb wheel actions, SmartShift, DPI,
 smart backlighting, Easy-Switch and per-application profiles for the
 MX Master 3S and MX Keys S on Linux. A background agent talks HID++ to the
 devices; a desktop app configures it.
CTRL
cat > "$PKG/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
chmod 4755 /opt/logimx/chrome-sandbox 2>/dev/null || true
if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload || true
  udevadm trigger --subsystem-match=hidraw --action=add || true
  udevadm trigger --subsystem-match=misc --action=add || true
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl --global enable logimx.service >/dev/null 2>&1 || true
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
echo "LogiMX installed. Start the agent for this session with:  systemctl --user enable --now logimx"
exit 0
POST
cat > "$PKG/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e
if [ "$1" = remove ] && command -v systemctl >/dev/null 2>&1; then
  systemctl --global disable logimx.service >/dev/null 2>&1 || true
fi
exit 0
PRERM
cat > "$PKG/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
command -v udevadm >/dev/null 2>&1 && udevadm control --reload || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
exit 0
POSTRM
chmod 755 "$PKG/DEBIAN/postinst" "$PKG/DEBIAN/prerm" "$PKG/DEBIAN/postrm"

echo "== dpkg-deb"
mkdir -p "$OUT"
DEB="$OUT/logimx_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "$PKG" "$DEB" >/dev/null
rm -rf "$OUT/deb"
echo "built $DEB ($(du -h "$DEB" | cut -f1))"
