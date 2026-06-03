# video-to-dance

Turn a YouTube dance video into a Set List dance: a loudness-normalised MP3 + a retargeted `.vrma`
clip the VRM character performs. Three stages, all free / self-hosted, decoupled by an intermediate
landmarks JSON.

```
youtube url ─▶ fetch.py  ─▶ music/<id>.mp3 (−16 LUFS) + tmp/<id>.mp4
tmp/<id>.mp4 ─▶ pose.py   ─▶ out/<id>.landmarks.json   (MediaPipe 3D world landmarks)
landmarks    ─▶ retarget.mjs ─▶ assets/vrma/<id>.vrma  (swing solve + foot leveling + smoothing)
             ─▶ run.mjs wires DANCE_CLIPS / DANCES / shell-files.json
```

## One-time setup

MediaPipe has no wheel for Python 3.13, so the venv uses Python 3.10. `ffmpeg` is supplied by the
`imageio-ffmpeg` pip package (a bundled static binary) — no system install needed.

```bash
py -3.10 -m venv tools/video-to-dance/.venv
tools/video-to-dance/.venv/Scripts/python.exe -m pip install mediapipe opencv-python numpy yt-dlp imageio-ffmpeg
# pose model (heavy ~29 MB):
curl -L -o tools/video-to-dance/models/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
```

## Use

The **id is optional** — omit it and the dance is named from the video's title (slugified to CamelCase),
with the artist taken from the uploader. Feet are **not anchored** by default (pass `--anchor` to pin them).

```bash
node tools/video-to-dance/run.mjs "<youtube-url>"                      # auto-name from the video title
node tools/video-to-dance/run.mjs "<youtube-url>" pokedance           # explicit id
node tools/video-to-dance/run.mjs "<url>" pokedance --title "Pokédance" --artist "…"
# tuning re-runs (reuse cached download / landmarks — pass the id so paths match):
node tools/video-to-dance/run.mjs "<url>" pokedance --skip-fetch            # re-pose + retarget
node tools/video-to-dance/run.mjs "<url>" pokedance --skip-fetch --skip-pose # retarget only
```
Then reload the app and tap the new row in the Set List.

## Tuning (in `retarget.mjs`)
- `AXIS` / `FLIP_HANDED` — fix a mirrored or upside-down pose (sign flips on the MediaPipe→VRM map).
- `SMOOTH_ALPHA` — lower = smoother (more lag); higher = snappier (more jitter).
- `FOOT_LEVEL` — keep soles flat (default) vs. use the noisy foot landmarks.

## Quality / non-goals
Single, mostly front-facing dancer. No multi-person, fingers, face, or limb twist. World landmarks are
hip-centred so global translation (steps/jumps) is dropped — the dance plays in place (feet anchored by
the app). Fast 360° spins, floor work, occlusion, motion blur, and camera cuts degrade or pop.
