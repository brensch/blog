#!/usr/bin/env bash
# Contact sheet of the raw recording at the given times: schlift/peek.sh 1 4 6 ...
set -euo pipefail
cd "$(dirname "$0")/.."
F=$(.venv/bin/python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
D=out/schlift/peek; rm -rf $D; mkdir -p $D
i=0; for t in "$@"; do $F -v error -ss $t -i out/schlift/raw.mp4 -frames:v 1 -vf scale=270:-1 $D/$(printf %02d $i).png; i=$((i+1)); done
.venv/bin/python - <<'PY'
from PIL import Image, ImageDraw; import glob, sys
fs=sorted(glob.glob('out/schlift/peek/[0-9]*.png')); ims=[Image.open(f) for f in fs]; w,h=ims[0].size
cols=7; s=Image.new('RGB',(w*cols,h*((len(ims)+cols-1)//cols)),'white')
for i,im in enumerate(ims): s.paste(im,((i%cols)*w,(i//cols)*h))
s.save('out/schlift/peek/sheet.png')
PY
