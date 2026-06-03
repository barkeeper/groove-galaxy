# video-to-dance Specification

## Purpose
TBD - created by archiving change video-to-dance. Update Purpose after archive.
## Requirements
### Requirement: Fetch and normalise audio from a YouTube URL
The pipeline SHALL download a YouTube video and produce `music/<id>.mp3` whose loudness is normalised
to −16 LUFS (two-pass EBU R128, TP −1.5, LRA 11), matching every existing track. It SHALL also retain
the downloaded video locally for the pose stage.

#### Scenario: Audio extracted and normalised
- **WHEN** the orchestrator runs with a valid YouTube URL and id `hiphop`
- **THEN** `music/hiphop.mp3` exists, is a valid MP3, and is loudness-normalised to −16 LUFS

#### Scenario: Invalid or unreachable URL
- **WHEN** the URL is invalid or download fails
- **THEN** the pipeline exits non-zero with a clear error and writes no partial `music/<id>.mp3`

### Requirement: Extract 3D pose from video
The pipeline SHALL run a pose estimator over the video frames and emit an intermediate JSON containing,
per sampled frame, a timestamp and 33 hip-centred 3D world landmarks (metres) with visibility scores.

#### Scenario: Pose JSON produced
- **WHEN** the pose stage runs on the downloaded video
- **THEN** an intermediate `*.landmarks.json` is written with `fps` and a non-empty `frames` array,
  each frame having `t` and 33 `[x,y,z]` world landmarks

### Requirement: Retarget landmarks to a VRMA clip
The pipeline SHALL convert the landmark JSON into VRM humanoid local bone rotations and write a
`assets/vrma/<id>.vrma` (glTF binary with the `VRMC_vrm_animation` extension) using the project's
existing VRMA writer. Output rotations SHALL be temporally smoothed and the feet kept grounded.

#### Scenario: VRMA written and loadable
- **WHEN** the retarget stage runs on a valid landmark JSON
- **THEN** `assets/vrma/<id>.vrma` exists and loads as an animation clip in the app (no parser error)

### Requirement: Name the dance from the video
When no id is given, the pipeline SHALL derive the dance id and title from the YouTube video's title
(slugified to a safe identifier) and the artist from the uploader, so pasting a bare URL produces a
named Set List entry.

#### Scenario: Auto-named from title
- **WHEN** the orchestrator runs with only a URL (no id)
- **THEN** it reads the video metadata and registers a dance whose id/title come from the video title
  and whose artist is the uploader

#### Scenario: Non-Latin or empty title
- **WHEN** the slugified title is empty (e.g. a fully non-Latin title)
- **THEN** the pipeline falls back to an id derived from the YouTube video id

### Requirement: Feet are not anchored by default
Video-captured dances SHALL play with the app's `anchorFeet()` disabled (registered in a `NO_ANCHOR`
set) and carry their own reconstructed hip translation, so the feet can leave the floor (steps / bob /
jump) instead of being pinned. An explicit opt-in SHALL re-enable anchoring.

#### Scenario: Feet move freely
- **WHEN** a video dance plays
- **THEN** the app does not pin the lowest foot to the floor line and the body stands at rest height
  (not sunk), with the feet lifting as the capture dictates

### Requirement: Register the dance in the Set List
The pipeline SHALL register the new dance so it appears in the Set List and plays its audio: appending
the clip to `DANCE_CLIPS` (`face.js`), the entry to `DANCES` (`app.js`), and both asset paths to
`shell-files.json`.

#### Scenario: Dance appears and plays
- **WHEN** the app loads after the pipeline registers id `hiphop`
- **THEN** a "hiphop" row appears in the Set List, and tapping it loops the VRMA clip while
  `music/hiphop.mp3` plays

