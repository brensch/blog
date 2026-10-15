#!/usr/bin/env bash
# snek: record a real game on snek.brensch.com, then encode out/snek.webp.
#   ./snek.sh            record + encode
#   ./snek.sh --encode   re-encode the last recording only
#
# Games run as long as they run, so the speed ramp is worked out from the
# recording's own marks: setup a touch quick, the opening and the last ten
# seconds before the end near real time, the middle as a time-lapse, then the
# results and the winner's emoji rain at real time.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--encode" ]; then shift; else node snek.mjs; fi

read -r -a SPEEDS < <(.venv/bin/python - <<'EOF'
import json
m = json.load(open("out/snek/manifest.json"))
t0 = m["frames"][0]["t"]
mk = {k["label"]: k["t"] - t0 for k in m["marks"]}
g, o = mk["game"], mk["over"]
segs = [(0, g, 1.4)]
mid_a, mid_b = g + 7, o - 10
if mid_b - mid_a > 4:
    segs += [(g, mid_a, 1.25), (mid_a, mid_b, max(2.0, (mid_b - mid_a) / 9)), (mid_b, o, 1.25)]
else:
    segs += [(g, o, 1.25)]
print(" ".join(f"--speed {a:.2f}:{b:.2f}:{f:.2f}" for a, b, f in segs))
EOF
)

.venv/bin/python lib/encode.py snek \
	"${SPEEDS[@]}" \
	--fps 60 --width 0 --max-hold 1.2 --hold-after over:5 --encoder video \
	--quality 80 --loop-fade 0.6 "$@"
