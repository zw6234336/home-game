set -eu
uname -srmo
if command -v lsusb >/dev/null 2>&1; then
  lsusb
  lsusb -t
fi
if command -v v4l2-ctl >/dev/null 2>&1; then
  v4l2-ctl --list-devices
  for device in /dev/video*; do
    if [ -e "$device" ]; then
      v4l2-ctl --device "$device" --list-formats-ext || true
    fi
  done
fi
