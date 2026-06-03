## Why

Adding a dance today requires a Unity `.anim` mocap file converted via `tools/unity-anim-to-vrma.mjs`.
For a song that only exists as a YouTube dance video (no mocap), there is no path to get the character
to perform it. We want to point the tool at a YouTube URL and get back a playable Set List entry: the
song's audio plus a `.vrma` clip that approximates the dancer's motion.

## What Changes

- New **video→dance pipeline** (`tools/video-to-dance/`) with three self-hostable stages, all free/OSS:
  1. **fetch** — `yt-dlp` + `ffmpeg`: download the video, extract audio to `music/<id>.mp3`, loudness-
     normalise to −16 LUFS (matching every existing track).
  2. **pose** — Python (MediaPipe Pose / BlazePose GHUM) reads the video frame-by-frame and emits
     per-frame 3D world landmarks (33 joints, hip-centred, metres) to an intermediate JSON.
  3. **retarget+pack** — Node converts landmark positions → VRM humanoid **local bone quaternions**
     (per-limb swing solve + hierarchy localisation) and writes `assets/vrma/<id>.vrma` by reusing the
     existing glTF / `VRMC_vrm_animation` writer.
- New CLI orchestrator: `node tools/video-to-dance/run.mjs <youtube-url> <id>` runs all stages and
  wires the result into the app (DANCE_CLIPS, DANCES, shell-files.json).
- First delivered dance: id **`hiphop`** from a user-supplied YouTube URL, added to the Set List.

Quality is explicitly **approximate** (single front-facing dancer; fast spins / floor work / occlusion
degrade). MediaPipe is the v1 backend (CPU/GPU, trivial install); a heavier SMPL/GPU backend (the box
has an RTX 4070) is a possible later upgrade behind the same intermediate-JSON contract.

## Capabilities

### New Capabilities
- `video-to-dance`: convert a YouTube dance video into a normalised MP3 + a retargeted VRMA clip and
  register it as a Set List dance.

### Modified Capabilities
<!-- None: the app's dance-playback contract is unchanged; this only produces new assets + list entries. -->

## Impact

- **New deps:** `yt-dlp` (pip), a Python 3.10 venv with `mediapipe` + `opencv-python` + `numpy`
  (Python 3.13 has no MediaPipe wheel). `ffmpeg` already present.
- **New code:** `tools/video-to-dance/` (fetch, pose `.py`, retarget+pack `.mjs`, orchestrator).
  Refactor `tools/unity-anim-to-vrma.mjs` to expose its VRMA writer for reuse.
- **New assets:** `music/hiphop.mp3`, `assets/vrma/hiphop.vrma`.
- **Edited:** `face.js` (DANCE_CLIPS), `app.js` (DANCES), `shell-files.json`, `project.md`, `CHANGELOG.md`.
- **No backend, no recurring cost, no paid APIs.**
