#!/usr/bin/env bash
# Record schniffer (live map + Discord mock) and encode out/schniffer.webp.
set -euo pipefail
cd "$(dirname "$0")"
node schniffer.mjs
.venv/bin/python lib/encode.py schniffer --width 1440 --fps 30 --max-hold 1.6 --encoder video
