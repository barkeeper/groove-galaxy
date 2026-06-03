# Groove Galaxy — project rules (delta over `../AGENTS.md`)

Read `../AGENTS.md` first, then this file.

## Pasting a YouTube URL = add a dance
When the user pastes a **YouTube / YouTube Shorts URL** (with no other instruction, or asking to "add
this dance / song"), run the **video→dance pipeline** and add it to the Set List:

```bash
node tools/video-to-dance/run.mjs "<url>"
```

- The dance **id + title are auto-derived from the video title** (slugified CamelCase); the artist is the
  uploader. Only pass an explicit id/`--title`/`--artist` if the user gives a name.
- **Feet are not anchored** by default (the user's standing preference). Pass `--anchor` only if asked.
- The script downloads the audio (→ `music/<id>.mp3`, −16 LUFS), runs MediaPipe pose capture, retargets to
  `assets/vrma/<id>.vrma`, and wires `DANCE_CLIPS` / `DANCES` / `shell-files.json` automatically.
- After it finishes, **verify with Playwright** (clip loads, row plays, `__face.status().currentClip`
  matches, visualiser active = audio playing) and screenshot the dancer; tune `retarget.mjs` constants
  (`AXIS`, `SMOOTH_ALPHA`, `TRANS_*`) if the pose is mirrored / sunk / jittery.

See `tools/video-to-dance/README.md` for setup and tuning, and `project.md` for the design.
