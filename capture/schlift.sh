#!/usr/bin/env bash
# Film schlift on the Android emulator and encode out/schlift.webp.
#
# Needs: the lift repo at $LIFT (default ~/lift) with the emulator AVD set up
# (`make android-phone-avd-create` there). Builds main in a throwaway worktree
# so your own checkout is never touched, starts a seeded backend (the `demo`
# accounts from src/demo_seed.rs), runs schlift/promo_video_test.dart while
# `adb shell screenrecord` films it, then crops off the system bars.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIFT="${LIFT:-$HOME/lift}"
WT="${WT:-$HOME/lift-capture}"
ADB="${ADB:-$HOME/android-sdk/platform-tools/adb}"
FLUTTER="${FLUTTER:-$HOME/flutter-sdk/bin/flutter}"
DEV=emulator-5554
OUT="$HERE/out/schlift"
mkdir -p "$OUT"

if [ ! -d "$WT" ]; then
	git -C "$LIFT" fetch -q origin
	git -C "$LIFT" worktree add -q "$WT" origin/main
	(cd "$WT/app" && "$FLUTTER" pub get >/dev/null)
fi
cp "$HERE/schlift/promo_video_test.dart" "$WT/app/integration_test/"

# Emulator: booted, dark, real animations, a tidy status bar (cropped anyway).
if [ "$("$ADB" -s $DEV get-state 2>/dev/null)" != device ]; then
	(cd "$WT" && make -s android-emulator-start android-emulator-wait android-emulator-unlock)
fi
"$ADB" -s $DEV shell cmd uimode night yes
for k in window_animation_scale transition_animation_scale animator_duration_scale; do
	"$ADB" -s $DEV shell settings put global $k 1
done
"$ADB" -s $DEV shell settings put global sysui_demo_allowed 1
"$ADB" -s $DEV shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
"$ADB" -s $DEV shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0730 >/dev/null
"$ADB" -s $DEV shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null

# Backend: fresh data, seeded demo accounts, on :50051.
B="$WT/.tmp/store-backend"
mkdir -p "$B"
[ -f "$B/backend.pid" ] && kill "$(cat "$B/backend.pid")" 2>/dev/null || true
rm -rf "$B/data" && mkdir -p "$B/data"
(cd "$WT" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$LIFT/target}" cargo build -q --bin schlift --features test-auth)
DATA_DIR="$B/data" SEED_DEMO_USER=demo PORT=50051 \
	WEBAUTHN_RP_ID=schlift.com WEBAUTHN_RP_ORIGIN=https://schlift.com \
	nohup "${CARGO_TARGET_DIR:-$LIFT/target}/debug/schlift" >"$B/backend.log" 2>&1 &
echo $! >"$B/backend.pid"
trap 'kill "$(cat "$B/backend.pid")" 2>/dev/null || true' EXIT
for _ in $(seq 60); do grep -q "Server listening" "$B/backend.log" && break; sleep 1; done
"$ADB" -s $DEV reverse tcp:50051 tcp:50051 >/dev/null

# Drive the app; start filming when the scenario says it is set up.
LOG="$OUT/drive.log"
: >"$LOG"
(cd "$WT/app" && "$FLUTTER" drive --profile --driver test_driver/integration_test.dart \
	--target integration_test/promo_video_test.dart -d $DEV >"$LOG" 2>&1) &
DRIVE=$!
until grep -q 'PROMO|texts' "$LOG" || ! kill -0 $DRIVE 2>/dev/null; do sleep 0.2; done
"$ADB" -s $DEV shell rm -f /sdcard/promo.mp4
"$ADB" -s $DEV shell 'date +%s%3N > /sdcard/promo.t0; exec screenrecord --bit-rate 24000000 /sdcard/promo.mp4' &
REC=$!
wait $DRIVE || { echo "drive failed — see $LOG"; tail -30 "$LOG"; }
sleep 1
"$ADB" -s $DEV shell pkill -INT screenrecord || true
wait $REC || true
sleep 1
"$ADB" -s $DEV pull -q /sdcard/promo.mp4 "$OUT/raw.mp4"
T0=$("$ADB" -s $DEV shell cat /sdcard/promo.t0 | tr -d '\r')
grep -o 'PROMO|[a-z]*|[0-9]*$' "$LOG" | awk -F'|' -v t0="$T0" '{ printf "%s %.2f\n", $2, ($3 - t0) / 1000 }' | tee "$OUT/beats.txt"

# Encode: from the first beat to the last, a touch faster than life, without
# the status and gesture bars (the app's content is y 118..2336 on a Pixel 6).
A=$(awk '$1=="start"{print $2}' "$OUT/beats.txt")
Z=$(awk '$1=="end"{print $2}' "$OUT/beats.txt")
"$HERE/.venv/bin/python" "$HERE/lib/encode.py" schlift --video "$OUT/raw.mp4" \
	--crop 0:118:1080:2218 --trim "$A:$Z" --speed "$A:$Z:1.3" \
	--fps 30 --width 720 --encoder video
