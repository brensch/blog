# capture

Scripts that film each project doing its thing and encode the animated WebPs
on the project pages (`static/img/projects/<name>-demo.webp`).

```sh
npm install && python3 -m venv .venv && .venv/bin/pip install pillow imageio-ffmpeg
./snek.sh        # plays a real game against the hard bot on snek.brensch.com
./ppp.sh         # SF → LA, sushi only, on ppp.brensch.com
./schniffer.sh   # the map flow on schniff.brensch.com, then the Discord side (see below)
./schlift.sh     # the app on the Android emulator against a seeded local backend
cp out/<name>.webp ../static/img/projects/<name>-demo.webp
```

- `lib/record.mjs` records only the page (Chrome's screencast), with a tap
  ripple, marks, and pause/resume for jump cuts.
- `lib/encode.py` turns frames or a video into a looping WebP: trims, speed-ups,
  squashed dead time, crop, cross-faded loop. Writes a `.sheet.jpg` to eyeball.
- `schlift/promo_video_test.dart` is a Flutter integration test copied into a
  throwaway lift worktree (`~/lift-capture`, from `origin/main`); your own lift
  checkout is never touched. `schlift/peek.sh 1 5 9 …` makes a contact sheet
  of the raw recording at those seconds.
- The Discord half of the schniffer clip is a local page
  (`schniffer/discord.html`) using the bot's real message templates and a real
  past alert; nothing is sent to Discord.
