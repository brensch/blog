#!/usr/bin/env bash
# ppp: record https://ppp.brensch.com (SF → LA, sushi only) and encode out/ppp.webp.
set -euo pipefail
cd "$(dirname "$0")"
node ppp.mjs
.venv/bin/python lib/encode.py ppp --width 720 --fps 15 \
	--max-hold 1.2 --quality 80 --encoder pillow \
	--hold-after overview:2.8 \
	--hold-after results:1.6 \
	--hold-after restaurant:2.4 \
	--hold-after charger:3.2
