# Tasks — video-to-dance

## 1. Environment
- [x] 1.1 Create Python 3.10 venv at `tools/video-to-dance/.venv`; install `mediapipe`, `opencv-python`, `numpy`, `yt-dlp`, `imageio-ffmpeg`
- [x] 1.2 Record exact install/run commands in `tools/video-to-dance/README.md`

## 2. Stage 1 — fetch
- [x] 2.1 `fetch.py`: yt-dlp download video to `tmp/<id>.mp4` (ffmpeg via imageio-ffmpeg, used for merge too)
- [x] 2.2 Two-pass `loudnorm` extract to `music/<id>.mp3` (−16 LUFS, TP −1.5, LRA 11)
- [x] 2.3 Fail cleanly (non-zero, no partial mp3) on bad URL

## 3. Stage 2 — pose
- [x] 3.1 `pose.py`: MediaPipe PoseLandmarker (Tasks API, heavy) → `out/<id>.landmarks.json` per the JSON contract
- [x] 3.2 fps cap + visibility scores + normalized image landmarks (for hip translation)

## 4. Stage 3 — retarget + pack
- [x] 4.1 Refactor `unity-anim-to-vrma.mjs` to share `writeVrma(tracks, outPath)` via `tools/vrma-writer.mjs`
- [x] 4.2 `retarget.mjs`: landmarks → VRM humanoid local quats (swing solve + hierarchy localisation)
- [x] 4.3 Hips basis + grounded feet (level flat) + image-derived hip translation (no sink)
- [x] 4.4 Zero-phase EMA smoothing
- [x] 4.5 Pack to `assets/vrma/<id>.vrma` via `writeVrma`

## 5. Orchestrator + wiring
- [x] 5.1 `run.mjs <url> [id]`: run all stages end-to-end
- [x] 5.2 Append clip to `DANCE_CLIPS` (face.js), entry to `DANCES` (app.js), paths to `shell-files.json`, id to `NO_ANCHOR`
- [x] 5.3 Auto-derive id/title/artist from the video metadata when no id is given

## 6. Deliver `pokedance` (feet not anchored)
- [x] 6.1 Run pipeline on the user's YouTube Shorts URL with id `pokedance`
- [x] 6.2 Playwright: dance appears, plays, `currentClip==='pokedance'`, visualiser active; screenshot mid-clip
- [x] 6.3 Tune `AXIS` (180° face-camera), hip baseline (no sink), neck/head (no craning) until the motion reads right
- [x] 6.4 `NO_ANCHOR` opt-out of `anchorFeet()` so the feet are free

## 7. Docs + close-out
- [x] 7.1 Update `project.md` ("Adding a dance from a YouTube video") + `CHANGELOG.md` + `AGENTS.md`
- [x] 7.2 Run static checks; commit; archive the OpenSpec change
