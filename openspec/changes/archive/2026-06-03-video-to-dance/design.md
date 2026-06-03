# Design — video-to-dance

## Pipeline shape

```
youtube url ──▶ [1 fetch].py/ffmpeg ──▶ music/<id>.mp3 (−16 LUFS)
                                    └──▶ tmp/<id>.mp4 (video)
tmp/<id>.mp4 ──▶ [2 pose].py (MediaPipe) ──▶ tools/video-to-dance/out/<id>.landmarks.json
landmarks.json ─▶ [3 retarget+pack].mjs ──▶ assets/vrma/<id>.vrma
                                        └──▶ edits face.js / app.js / shell-files.json
```

Stage 2 (Python) and stage 3 (Node) are decoupled by the **landmarks JSON contract**, so the pose
backend can be swapped later (e.g. an SMPL/GPU model on the RTX 4070) without touching the retargeter.

## Intermediate JSON contract

```jsonc
{
  "id": "hiphop",
  "fps": 30,
  "width": 1080, "height": 1920,
  "frames": [
    { "t": 0.0,
      "world":  [[x,y,z], ... 33],   // metres, origin = midpoint of hips, MediaPipe axes
      "vis":    [v0, ... 33] }       // visibility 0..1
  ]
}
```

MediaPipe world-landmark axes: `+x` = subject's right in image, `+y` = **down**, `+z` = toward camera.
Convert to VRM (Y-up, +Z front) at retarget time: `vrm = ( x, -y, -z )` as the starting convention,
verified empirically with screenshots (axis flips live in one `AXIS` constant so they're easy to tune).

## Stage 1 — fetch (`fetch.py`)
- `yt-dlp -f "bv*+ba/b" -o tmp/<id>.%(ext)s <url>` → mux to `tmp/<id>.mp4` (or keep best).
- Audio: `ffmpeg -i video -vn` → first pass `loudnorm ... print_format=json` (measure), second pass with
  measured values → `music/<id>.mp3` (libmp3lame, 192k). Mirrors the project's existing normalisation.

## Stage 2 — pose (`pose.py`, Python 3.10 venv)
- `mediapipe.solutions.pose.Pose(model_complexity=2, smooth_landmarks=True, min_*_confidence=0.5)`.
- Iterate frames with OpenCV; use `pose_world_landmarks` (3D metres). Record `t = frame_index / fps`.
- Optional frame stride for long videos; default sample every frame up to fps cap 30.

## Stage 3 — retarget + pack (`retarget.mjs` + reused VRMA writer)
Per-limb **swing solve** (twist ignored in v1):
1. Build a VRM rest skeleton: arms along ±X, legs along −Y, spine +Y, look +Z.
2. Hips: world basis from hip vector (R hip→L hip) and spine-up (hips→shoulder-centre) → yaw/tilt.
   Hips translation from vertical motion of hip-centre (scaled to the rig), then the app's `anchorFeet()`
   keeps soles grounded.
3. For each bone with a `(fromJoint → toJoint)` landmark pair, world dir `d = norm(toPos − fromPos)`;
   `qWorld = shortestArc(restDirWorld, d)`; localise: `qLocal = inv(parentWorldQ) · qWorld`; recurse
   down the chain accumulating `parentWorldQ`.
4. Bone map: spine/chest from hip-centre→shoulder-centre; neck/head from shoulder-centre→nose/ears;
   upper/lower arm from shoulder→elbow→wrist; upper/lower leg from hip→knee→ankle; foot from
   ankle→foot_index (then levelled flat like the existing converter to avoid tiptoe).
5. Temporal smoothing: slerp/EMA over rotations (window ~3 frames) to kill jitter; clamp per-frame
   angular delta to suppress landmark popping.
6. Pack: reuse `unity-anim-to-vrma.mjs`'s glTF + `VRMC_vrm_animation` writer (factored into an exported
   `writeVrma(tracks, outPath)`); tracks = `{ bone: { times[], quats[] }, hips.translation }`.

## Quality / non-goals (v1)
- One front-facing dancer. No multi-person, no hands/fingers, no facial capture, no twist DOF.
- Fast 360° spins, ground/floor moves, heavy occlusion and motion blur will degrade or pop.
- Camera cuts/zooms in the source confuse world landmarks; best on a single continuous shot.

## Testing
- `node tools/serve.mjs` on :5173, then Playwright: load app, click the `hiphop` row, screenshot the
  dancer mid-clip, assert `__face.status().currentClip === 'hiphop'` and audio playing. Iterate the
  `AXIS`/scale constants until the pose reads as the same dance.
