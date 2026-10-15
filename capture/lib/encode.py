"""Turn a capture into the animated WebP the site shows.

Input is either a browser recording (out/<name>/manifest.json + frames/, from
record.mjs) or a video file (--video, e.g. the emulator's screenrecord mp4).

    python lib/encode.py snek --width 720 --max-hold 1.5
    python lib/encode.py schlift --video out/schlift/raw.mp4 --crop 0:110:1080:2100

Timeline edits run in this order, all in seconds of the original recording:
  --trim A:B           keep only A..B
  --cut A:B            drop A..B (repeatable)
  --speed A:B:F        play A..B F times faster (repeatable)
  --max-hold S         squash any stretch with no visible change to at most S
Then frames are sampled at --fps, cropped (--crop x:y:w:h in source pixels),
scaled to --width, and the end cross-fades into the start (--loop-fade) so the
loop has no jump.
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def pair(s, n):
    parts = [float(x) for x in s.split(":")]
    if len(parts) != n:
        raise argparse.ArgumentTypeError(f"expected {n} colon-separated numbers: {s}")
    return parts


def load_manifest(name):
    d = ROOT / "out" / name
    m = json.loads((d / "manifest.json").read_text())
    t0 = m["frames"][0]["t"]
    return [(f["t"] - t0, d / "frames" / f["file"]) for f in m["frames"] if f["file"]]


def load_video(path, fps):
    tmp = Path(tempfile.mkdtemp(prefix="enc-"))
    subprocess.run(
        [FFMPEG, "-v", "error", "-i", str(path), "-vf", f"fps={fps}", "-q:v", "2", str(tmp / "%05d.jpg")],
        check=True,
    )
    files = sorted(tmp.glob("*.jpg"))
    return [(i / fps, f) for i, f in enumerate(files)]


def frame_at(frames, t):
    """The frame on screen at time t (last one at or before t)."""
    lo, hi = 0, len(frames) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if frames[mid][0] <= t:
            lo = mid
        else:
            hi = mid - 1
    return frames[lo][1]


def build_timeline(frames, args):
    """Map output time → source time as a list of source sample times at fps."""
    end = frames[-1][0]
    a, b = (args.trim if args.trim else (0.0, end))
    cuts = sorted(args.cut or [])
    speeds = args.speed or []
    step = 1.0 / args.fps
    samples = []
    t = a
    while t <= b:
        if any(c0 <= t < c1 for c0, c1 in cuts):
            t = next(c1 for c0, c1 in cuts if c0 <= t < c1)
            continue
        samples.append(t)
        factor = next((f for s0, s1, f in speeds if s0 <= t < s1), 1.0)
        t += step * factor
    return samples


def load_marks(name):
    """Marks from rec.mark(label), as seconds from the first frame."""
    d = ROOT / "out" / name
    m = json.loads((d / "manifest.json").read_text())
    t0 = m["frames"][0]["t"]
    return {k["label"]: k["t"] - t0 for k in m.get("marks", [])}


def squash_holds(paths, fps, max_hold, times=None, holds=()):
    """Drop repeated frames beyond max_hold seconds of no change.

    holds: (mark_time, seconds) pairs — a still stretch that starts within 8s
    after the most recent mark_time may last up to `seconds` instead (e.g. let
    a result breathe).
    """
    if max_hold is None:
        return paths
    keep, run, prev = [], 0, None
    base_limit = int(max_hold * fps)
    limit, run_start = base_limit, 0.0
    cache = {}

    def small(p):
        if p not in cache:
            cache[p] = Image.open(p).convert("L").resize((96, 96))
        return cache[p]

    for i, p in enumerate(paths):
        same = prev is not None and (
            p == prev or ImageStat.Stat(ImageChops.difference(small(p), small(prev))).mean[0] < 0.6 * 15 / fps
        )
        run = run + 1 if same else 0
        if run == 1 and times is not None:
            run_start = times[i]
            # The most recent mark wins; a still that settles just before its
            # mark (e.g. mark called after a wait) still counts.
            near = [(mt, s) for mt, s in holds if mt - 0.75 <= run_start <= mt + 8]
            limit = int(max(near)[1] * fps) if near else base_limit
        if run < limit:
            keep.append(p)
        prev = p
    return keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--video", type=Path)
    ap.add_argument("--fps", type=float, default=15)
    ap.add_argument("--width", type=int, default=720)
    ap.add_argument("--crop", type=lambda s: [int(v) for v in pair(s, 4)])
    ap.add_argument("--trim", type=lambda s: pair(s, 2))
    ap.add_argument("--cut", type=lambda s: pair(s, 2), action="append")
    ap.add_argument("--speed", type=lambda s: pair(s, 3), action="append")
    ap.add_argument("--max-hold", type=float)
    ap.add_argument(
        "--hold-after",
        action="append",
        default=[],
        help="LABEL:S — the still moment after rec.mark(LABEL) may last S seconds (with --max-hold)",
    )
    ap.add_argument("--loop-fade", type=float, default=0.5)
    ap.add_argument("--quality", type=int, default=72)
    ap.add_argument("--out", type=Path)
    ap.add_argument(
        "--encoder",
        choices=["ffmpeg", "pillow", "video"],
        default="ffmpeg",
        help="pillow = libwebp's own anim encoder: no ghosting from earlier frames on lossy diffs; "
        "video = <name>.av1.mp4 + <name>.h264.mp4 + <name>.poster.webp for a <video> tag",
    )
    ap.add_argument("--av1-crf", type=int, default=34)
    ap.add_argument("--h264-crf", type=int, default=24)
    args = ap.parse_args()

    frames = load_video(args.video, 30) if args.video else load_manifest(args.name)
    times = build_timeline(frames, args)
    holds = []
    if args.hold_after:
        marks = load_marks(args.name)
        for h in args.hold_after:
            label, secs = h.rsplit(":", 1)
            if label in marks:
                holds.append((marks[label], float(secs)))
            else:
                print(f"warning: no mark {label!r}", file=sys.stderr)
    paths = squash_holds([frame_at(frames, t) for t in times], args.fps, args.max_hold, times, holds)

    def prep(p):
        im = Image.open(p).convert("RGB")
        if args.crop:
            x, y, w, h = args.crop
            im = im.crop((x, y, x + w, y + h))
        if not args.width or args.width >= im.width:
            # Native resolution (rounded to even for the encoder).
            return im.crop((0, 0, im.width // 2 * 2, im.height // 2 * 2))
        h = round(im.height * args.width / im.width / 2) * 2
        return im.resize((args.width, h), Image.LANCZOS)

    if args.encoder == "video":
        encode_video(args, paths, prep)
        return

    imgs = [prep(p) for p in paths]
    n = int(args.loop_fade * args.fps)
    if n and len(imgs) > n * 2:
        first = imgs[0]
        for i in range(n):
            k = (i + 1) / (n + 1)
            imgs[-n + i] = Image.blend(imgs[-n + i], first, k)

    out = args.out or ROOT / "out" / f"{args.name}.webp"
    w, h = imgs[0].size
    if args.encoder == "pillow":
        # Merge runs of identical frames into one longer frame, then let
        # libwebp's anim encoder pick keyframes and sub-rectangles itself.
        step = 1000 / args.fps
        merged, durs = [], []
        for im in imgs:
            if merged and im.tobytes() == merged[-1].tobytes():
                durs[-1] += step
            else:
                merged.append(im)
                durs.append(step)
        merged[0].save(
            out, "WEBP", save_all=True, append_images=merged[1:],
            duration=[round(d) for d in durs], loop=0,
            quality=args.quality, method=6, kmin=9, kmax=17, allow_mixed=False,
        )
    else:
        proc = subprocess.Popen(
            [
                FFMPEG, "-v", "error", "-y",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(args.fps), "-i", "-",
                "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", str(args.quality),
                "-compression_level", "6", "-preset", "picture", "-loop", "0",
                str(out),
            ],
            stdin=subprocess.PIPE,
        )
        for im in imgs:
            proc.stdin.write(im.tobytes())
        proc.stdin.close()
        if proc.wait():
            sys.exit("ffmpeg failed")
    secs = len(imgs) / args.fps
    print(f"{out}: {w}x{h}, {len(imgs)} frames, {secs:.1f}s, {out.stat().st_size / 1e6:.2f} MB")

    # A contact sheet of evenly spaced frames, for eyeballing without a player.
    cols = 6
    picks = [imgs[int(i * (len(imgs) - 1) / (cols * 2 - 1))] for i in range(cols * 2)]
    tw = 200
    th = round(h * tw / w)
    sheet = Image.new("RGB", (tw * cols, th * 2), "white")
    for i, im in enumerate(picks):
        sheet.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
    sheet.save(out.with_suffix(".sheet.jpg"), quality=85)


def encode_video(args, paths, prep):
    """Stream frames into AV1 and H.264 encoders at once, never holding the
    whole clip in memory. Both get +faststart so playback starts before the
    download finishes; the poster is the first frame, shown while it loads."""
    cache = {}

    def frame(p):
        if p not in cache:
            if len(cache) > 64:
                cache.pop(next(iter(cache)))
            cache[p] = prep(p)
        return cache[p]

    first = frame(paths[0])
    w, h = first.size
    n = int(args.loop_fade * args.fps)
    fade_from = len(paths) - n if n and len(paths) > n * 2 else len(paths)
    base = ROOT / "out" / args.name
    rate = str(args.fps)
    raw = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", rate, "-i", "-"]
    common = ["-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
              "-colorspace", "bt709", "-g", str(int(args.fps * 5)), "-an", "-movflags", "+faststart"]
    jobs = {
        "av1": [FFMPEG, "-v", "error", "-y", *raw, "-c:v", "libaom-av1", "-crf", str(args.av1_crf),
                "-b:v", "0", "-cpu-used", "4", "-row-mt", "1", "-tiles", "2x2",
                "-aq-mode", "1", *common, f"{base}.av1.mp4"],
        "h264": [FFMPEG, "-v", "error", "-y", *raw, "-c:v", "libx264", "-crf", str(args.h264_crf),
                 "-preset", "veryslow", "-tune", "animation", "-profile:v", "high",
                 *common, f"{base}.h264.mp4"],
    }
    procs = {k: subprocess.Popen(cmd, stdin=subprocess.PIPE) for k, cmd in jobs.items()}
    cols = 6
    pick_at = {int(i * (len(paths) - 1) / (cols * 2 - 1)) for i in range(cols * 2)}
    picks = []
    for i, p in enumerate(paths):
        im = frame(p)
        if i >= fade_from:
            im = Image.blend(im, first, (i - fade_from + 1) / (n + 1))
        data = im.tobytes()
        for proc in procs.values():
            proc.stdin.write(data)
        if i in pick_at:
            picks.append(im.resize((200, round(h * 200 / w))))
    for k, proc in procs.items():
        proc.stdin.close()
        if proc.wait():
            sys.exit(f"ffmpeg {k} failed")
    first.save(f"{base}.poster.webp", quality=80, method=6)
    secs = len(paths) / args.fps
    print(f"{args.name}: {w}x{h}, {secs:.1f}s @ {args.fps:g}fps")
    for suffix in ("av1.mp4", "h264.mp4", "poster.webp"):
        f = Path(f"{base}.{suffix}")
        print(f"  {f.name}: {f.stat().st_size / 1e6:.2f} MB")
    th = picks[0].height
    sheet = Image.new("RGB", (200 * cols, th * 2), "white")
    for i, im in enumerate(picks[: cols * 2]):
        sheet.paste(im, ((i % cols) * 200, (i // cols) * th))
    sheet.save(f"{base}.sheet.jpg", quality=85)


if __name__ == "__main__":
    main()
