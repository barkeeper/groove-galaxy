# Groove Galaxy — project rules (delta over `../AGENTS.md`)

Read `../AGENTS.md` first, then this file.

## Pasting a YouTube URL = capture BOTH engines + rip the music
When the user pastes a **YouTube / YouTube Shorts URL** (with no other instruction, or asking to "add
this dance / song"), run the **video→dance pipeline in `--both` mode** — it rips the audio + captures the
pose **once**, then produces **both engine variants** and adds **both** to the Set List:

```bash
node tools/video-to-dance/run.mjs "<url>" --both
```

- **Always `--both`.** This delivers two dances to compare: `<Name>Builtin` (bend-plane solver) and
  `<Name>Kalido` (Kalidokit), titled "… · Built-in" / "… · Kalidokit". The expensive steps (download,
  **music rip**, MediaPipe pose) run only once; the second engine reuses that capture via `--reuse`.
- The dance **id + title are auto-derived from the video title** (slugified CamelCase); the artist is the
  uploader. Only pass an explicit id/`--title`/`--artist` if the user gives a name.
- **Music is always ripped** (→ `music/<Name>Builtin.mp3` + a copy `music/<Name>Kalido.mp3`, −16 LUFS).
- **Feet are not anchored** by default (the user's standing preference). Pass `--anchor` only if asked.
- Each variant wires `DANCE_CLIPS` / `DANCES` / `shell-files.json` **+ `NO_ANCHOR`** automatically.
- After it finishes, **verify with Playwright** (both clips load, rows play, `__face.status().currentClip`
  matches, visualiser active = audio playing) and screenshot the dancer; render motion grids and compare
  against a known-good clip (e.g. Soirée) before reporting back. Tune builtin `common.AXIS` / `ARM`/`LEG`
  hinge signs or kalido `FLIP`/`HIPS_YAW_DEG` if a pose is mirrored / back-to-camera / sunk / jittery.

See `tools/video-to-dance/README.md` for setup and tuning, and `project.md` for the design.
