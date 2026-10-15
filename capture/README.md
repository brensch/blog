# capture

Scripts that film each project doing its thing and encode the looping videos
on the project pages: `static/video/<name>.{av1,h264}.mp4` plus a poster at
`static/img/projects/<name>-poster.webp`.

```sh
npm install && python3 -m venv .venv && .venv/bin/pip install pillow imageio-ffmpeg
./snek.sh        # plays a real game against the hard bot on snek.brensch.com
./ppp.sh         # Mountain View → LA, sushi only, on ppp.brensch.com
./schniffer.sh   # the map flow on schniff.brensch.com, then the Discord side (see below)
./schlift.sh     # the app on the Android emulator against a seeded local backend
cp out/<name>.{av1,h264}.mp4 ../static/video/ && cp out/<name>.poster.webp ../static/img/projects/<name>-poster.webp
```

- `lib/record.mjs` records only the page (Chrome's screencast), with a tap
  ripple, marks, and pause/resume for jump cuts.
- `lib/encode.py` turns frames or a video into a loop: trims, speed-ups,
  squashed dead time, crop, cross-faded loop. `--encoder video` writes AV1 and
  H.264 faststart MP4s and a poster (sized ~2x how big the page shows them);
  the WebP encoders are still there. Writes a `.sheet.jpg` to eyeball.
- `schlift.sh` runs the app in profile mode (release-like frames) and visits
  every screen once off camera so first-time shader compiles don't stutter.
- `schlift/promo_video_test.dart` is a Flutter integration test copied into a
  throwaway lift worktree (`~/lift-capture`, from `origin/main`); your own lift
  checkout is never touched. `schlift/peek.sh 1 5 9 …` makes a contact sheet
  of the raw recording at those seconds.
- The Discord half of the schniffer clip is a local page
  (`schniffer/discord.html`) using the bot's real message templates and a real
  past alert; nothing is sent to Discord.
