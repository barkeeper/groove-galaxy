# video-to-dance

Turn a YouTube dance video into a Set List dance: a loudness-normalised MP3 + a retargeted `.vrma`
clip the VRM character performs. Three stages, all free / self-hosted, decoupled by an intermediate
landmarks JSON.

```
youtube url ─▶ fetch.py  ─▶ music/<id>.mp3 (−16 LUFS) + tmp/<id>.mp4
tmp/<id>.mp4 ─▶ pose.py   ─▶ out/<id>.landmarks.json   (MediaPipe world + image landmarks)
landmarks    ─▶ retarget (--engine builtin|kalido) ─▶ assets/vrma/<id>.vrma
             ─▶ run.mjs wires DANCE_CLIPS / DANCES / shell-files.json / NO_ANCHOR
```

**Two retarget engines** (sharing `common.mjs` for hip translation, FK foot-leveling, smoothing, pack):
- **builtin** (`retarget.mjs`) — bend-plane basis solver: bone direction + roll pinned by the joint
  bend normal (`upperDir×lowerDir`), so elbows/knees bend in-plane and hands don't twist through.
- **kalido** (`retarget-kalido.mjs`) — the Kalidokit Pose solver (3D+2D landmarks → local Eulers).
Build both from one capture with `--reuse` to compare and pick the better one.

## One-time setup

MediaPipe has no wheel for Python 3.13, so the venv uses Python 3.10. `ffmpeg` is supplied by the
`imageio-ffmpeg` pip package (a bundled static binary) — no system install needed.

```bash
py -3.10 -m venv tools/video-to-dance/.venv
tools/video-to-dance/.venv/Scripts/python.exe -m pip install mediapipe opencv-python numpy yt-dlp imageio-ffmpeg
npm install kalidokit          # engine B (MIT)
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
node tools/video-to-dance/run.mjs "<url>" Pokemon --engine kalido --title "Pokémon"
# two engine variants from ONE capture (no re-download/pose):
node tools/video-to-dance/run.mjs "<url>" PokemonBuiltin --engine builtin
node tools/video-to-dance/run.mjs "<url>" PokemonKolido  --engine kalido --reuse PokemonBuiltin
# tuning re-runs: --skip-fetch (re-pose+retarget) or --skip-fetch --skip-pose (retarget only)
```
Then reload the app and tap the new row in the Set List.

## Tuning
- **builtin** (`retarget.mjs`): `ARM`/`LEG` hinge signs (flip if a joint inverts); `common.AXIS`
  (a 180° Y flip faces the camera). **kalido** (`retarget-kalido.mjs`): `FLIP` / `HIPS_YAW_DEG`.
- `common.smoothTrack` alpha — lower = smoother (more lag); higher = snappier (more jitter).

## Quality / non-goals
Single dancer. No multi-person, fingers, face, or limb twist. Both engines pin limb roll (bend plane /
Kalidokit) so hands stop passing through the body; feet are levelled flat and lift freely (not anchored).
Fast 360° spins, occlusion, motion blur, and camera cuts still degrade or pop.
