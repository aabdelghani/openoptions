#!/usr/bin/env bash
# Install the agent for the current user (~/.local/bin) and enable the user service.
# The udev rule needs root; the script prints the command instead of running it.
set -e
cd "$(dirname "$0")"
cmake -B agent/build -S agent -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build agent/build
mkdir -p ~/.local/bin ~/.config/systemd/user
cp agent/build/openoptions-agent agent/build/openoptionsctl ~/.local/bin/
cp systemd/openoptions.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now openoptions.service
echo "Agent installed and started. For hidraw/uinput access without Solaar's rules run:"
echo "  sudo cp udev/60-openoptions.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger"
