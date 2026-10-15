#!/usr/bin/env bash
# ppp: record https://ppp.brensch.com (SF → LA, sushi only) and encode out/ppp.webp.
set -euo pipefail
cd "$(dirname "$0")"
node ppp.mjs
.venv/bin/python lib/encode.py ppp --width 1440 --fps 30 \
	--max-hold 1.2 --quality 80 --encoder video \
	--hold-after overview:2.8 \
	--hold-after results:1.6 \
	--hold-after restaurant:2.4 \
	--hold-after charger:3.2
