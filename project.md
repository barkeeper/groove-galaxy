# Project Log — Groove Galaxy (in-browser 3D VRM dancer)

Single-page web app: a VRM character that idles and dances to music, 100% in-browser. No backend.

---

## Groove Galaxy refactor (2026-06-02)

The project began life as **ANCHOR/SAKURA**, a local in-browser AI presenter (LLM chat + Kokoro TTS
voice + Whisper STT, all fused with the VRM face). That pivot is now complete: **all LLM and voice
features were removed** and the app is purely the dancing character.

**Removed:** `infer.js`, `llm-worker.js`, `tts-worker.js`, `speech.js`, `stt.js`, `stt-worker.js`,
`emotion.js`, `persist.js`, the whole `models/` tree (~270 MB of SmolLM2 / Kokoro / Whisper weights),
the `vendor/` offline-vendored libraries, the legacy single-file `index2.html`, `tools/fetch-offline.ps1`,
and every LLM/TTS/STT/old-UI Playwright probe in `tools/`.

**Renamed:** SAKURA → **Groove Galaxy** (title, top-bar brand, manifest, package). The Kanji sigil is
now **踊** ("dance"). `localStorage` keys use the `groove.*` namespace.

**Reworked UI:** the chat console on the right became the **Set List** — the dances are listed there
and tapping one plays it. The header "Dance" button is gone. Idle / dance animations are split into
explicit categories (see below) and only dances are listed.

### Animation categories (`face.js`)
- **IDLE** — `VRMA_01` (intro walk-in) + `VRMA_02..07` (Greeting, Peace sign, Shoot, Spin, Model pose,
  Squat). Auto-cycle via the mixer `finished` event whenever no dance is selected — exactly the ambient
  behaviour from the old project, minus the random rare-dance auto-fire (dances are manual now).
- **DANCE** — `OtonaBlue`, `BabyYou`, `TocaToca`, `RareDance_3`, `RareDance_5`, `RabbitHole`, `Soiree`, `Kidding`,
  `BoomBoom`, `SakuyuiTaiso`, `Flower`, `BounceDance`, `March`. Triggered by name from
  the UI (`playDance(name)`), **looped** while the matching `music/<name>.mp3` plays. When the track
  ends (or Stop is pressed) `idle()` crossfades back to the idle cycle.

### Dance floor (`app.js` + `assets/dancefloor/`)
- Right column is split: **Set List** (60%) + **Dance Floor** picker (40%, 6 first-frame thumbnails).
- `FLOORS` lists `floor1..6`; the picked id persists in `groove.floor`. A single `<video id="floor">`
  sits over the still image (`face-bg.jpg`); `showFloor()`/`hideFloor()` toggle `.is-active` to crossfade
  the selected `assets/dancefloor/<id>.mp4` in when a dance starts and back to the still image when it ends.
  Switching floors mid-dance swaps the source live; the video pauses after the fade to save decoding.

### Music + visualizer (`app.js`)
- Tapping a track calls `face.playDance(id, { loop: true })`, then after `MUSIC_DELAY_MS` (1.2 s, lets
  the dance wind up) starts `music/<id>.mp3` at 60 % volume.
- The audio is routed through a Web Audio `AnalyserNode` to drive the HUD spectrum strip.
- Mute toggle (header) applies to the music; theme toggle persists in `groove.theme`.

---

## File-by-file summary

### `index.html`
Bootstrap only: CSP, an import map for `three` / `three/addons` / `@pixiv/three-vrm` /
`@pixiv/three-vrm-animation` (CDN), theme restore, service-worker registration, then loads `app.js`.
No COOP/COEP reload dance anymore (WebGL doesn't need `SharedArrayBuffer`).

### `app.js`
The controller. Defines `DANCES` (the Set List source of truth), builds the list, plays dance + music,
draws the spectrum visualizer, and wires mute / theme / install / cursor-gaze. ~190 lines, no workers.

### `face.js` — VRM character & animation
- Body animation from **VRMA mocap clips** via `@pixiv/three-vrm-animation`.
- Intro `VRMA_01` plays once on load; idle pool `VRMA_02..07` auto-cycles; dances loop on demand.
- Clips named from their filename in `loadClip`, so `__face.status().currentClip` is meaningful.
- Procedural **blink + gaze** (eyes follow cursor + saccades) layered on top via `expressionManager`
  and the `lookAt` target. (The old lip-sync visemes + mood expressions were removed with the voice.)
- Full-body framing measured once at boot; camera fits head-to-toe and never zooms during clips.
- Debug hooks: `__face.status()`, `__face.playDance(name)`, `__face.sampleBones()`.

### `styles.css`
Analog dance-floor design system (Fraunces / JetBrains Mono / IBM Plex Sans, amber + teal, scanlines +
grain, two themes). Set-list rows with a play glyph + per-row equalizer on the active track.

### `sw.js`
Offline service worker: shell precache (from `shell-files.json`), network-first for code,
stale-while-revalidate for static assets (`vrm/vrma/img/mp3/font`), cache-first for the CDN. Cache
`groove-v1`. The old COOP/COEP injection and "cache everything" message handler are gone.

### `assets/vrma/` — animation library
| File | Source | Category |
|---|---|---|
| `VRMA_01..07.vrma` | pixiv VRoid Project (credit required) | idle (intro + pool) |
| `Readme_VRMA_MotionPack_EN.txt` | pixiv | terms — credit "Animation credits to pixiv Inc.'s VRoid Project" |
| `OtonaBlue / BabyYou / TocaToca / RareDance_3 / RareDance_5 / RabbitHole / Soiree / Kidding / BoomBoom / SakuyuiTaiso / Flower / BounceDance / March .vrma` | user-provided pack | dance |

### `assets/dancefloor/` — animated backdrops
`floor1..6.mp4` (720p, audio-stripped, ~0.4–2 MB each) + `floor1..6.jpg` first-frame thumbnails for the picker.

### `tools/` — VRMA authoring helpers (kept)
- `unity-anim-to-vrma.mjs` — converts a Unity humanoid `AnimationClip` (`.anim` YAML) into a `.vrma`
  (glTF binary + `VRMC_vrm_animation`). Every bone is driven by **muscle FK** using the calibrated
  muscle→rotation map in `muscle-calib.json`; hips come from `RootQ` (also calibrated). Falls back to
  a crude default-range Euler approximation if the calib file is missing.
  **Feet are special:** these mocap clips are IK-foot-pinned, so their FK foot *muscles* are unreliable
  (applied as FK they point the toes regardless of pose → constant tiptoe). So the converter ignores the
  foot muscles and **levels each foot flat to the floor**, facing the leg's yaw:
  `footWorld = yaw(legWorld)` ⇒ `footLocal = inv(legWorld)·yaw(legWorld)`. This needs no per-clip foot
  data and keeps soles grounded across every dance.
  Usage: `node tools/unity-anim-to-vrma.mjs input.anim assets/vrma/MyClip.vrma`
- `anim-muscle.mjs` — shared Unity-muscle table + `.anim` curve parser + quaternion exp/log helpers,
  imported by both the converter and the calibrator (so they can't drift apart).
- `calibrate-muscles.mjs` — **fits** the muscle→bone-rotation mapping from a known-good reference
  (its source `.anim` muscles + its correct `.vrma` rotations): per bone, `rotvec = M·(muscle vector) + b`
  (least squares). Writes `muscle-calib.json`. Re-run only if the rig/convention changes.
  Usage: `node tools/calibrate-muscles.mjs ref.anim ref_good.vrma [more pairs…]`
- `muscle-calib.json` — the baked calibration (18 bones), produced from the Soirée reference
  (which ships a correct hand-authored `.vrma` alongside its `.anim`).
- `inspect-vrma.mjs` / `inspect-vrma2.mjs` — dump a `.vrma`'s tracks / humanoid bones.
- `patch-vrma-specversion.mjs` — stamp a `specVersion` into a `.vrma` that's missing one.

#### Why the converter was rewritten (the "collapsed ankles / no elbows" bug)
The original converter ran an analytic two-bone IK that **overrode** the limbs whenever the clip had
Unity Hand/Foot IK-target curves (these dances all do). That IK assumed limbs rest along **-Y** (they
rest along ±X) and pushed every chain to full extension, so **elbows/knees never bent** (stuck ~2°), and
it applied the raw foot IK-target quaternion as a **local** rotation → **collapsed ankles**. The fix:
drop the IK entirely and drive all bones from Mecanim muscle curves, with the muscle→rotation mapping
**calibrated** against the one clip that shipped a correct `.vrma` (Soirée). Validated: re-converting
Soirée from its `.anim` now matches the authored `.vrma` within ~0.1° (spine) to ~14° (elbows), feet
~6°, hips ~6° (was 60–120°).

---

## Adding a dance
1. `assets/vrma/MyDance.vrma` (convert a Unity `.anim` with `tools/unity-anim-to-vrma.mjs`) + `music/MyDance.mp3`.
2. Append `'MyDance.vrma'` to `DANCE_CLIPS` in `face.js`.
3. Append `{ id: 'MyDance', title: '…', artist: '…' }` to `DANCES` in `app.js`.
4. Add both paths to `shell-files.json` for offline precache.

## Layout & responsiveness (`styles.css`)
- Desktop `.stage` is a 2-column grid (dancer ~62% · right column ~38%). The right column (`.rightcol`)
  is a flex stack: **Set List 70%** + **Dance Floor picker 30%** (`flex:7` / `flex:3`); the floor grid is
  **3 thumbnails per row**.
- ≤900px: single column — dancer (48vh) over Set List over Dance Floor, page scrolls; floors stay 3-up.
- ≤480px (phones): tighter chrome (subtitle hidden, smaller track rows), dancer 42vh, floors still 3-up.

## Dancer foot anchor (`face.js`)
Some converted clips carry vertical root translation. `anchorFeet()` pins the lowest foot bone to a
floor line measured once at rest: a **hard floor** downward (no sinking, corrected same-frame) plus a
**soft** upward pull (hops still read). Keeps every clip's apparent bottom within a few px.

## Testing
```
python -m http.server 5173                 # dev server
# In DevTools:
__face.status()                            # idle/dance counts, current clip
__face.playDance('BabyYou')                # fire a dance now
```

## Credits
- **VRoid model** — Zelená Terra / "Little Black Dress #6" by BEAMER3K
  (https://hub.vroid.com/en/characters/6508184899432541268/models/2853061186142051617)
- **VRMA Motion Pack (intro + idle)** — pixiv VRoid Project — credit phrase required:
  *"Animation credits to pixiv Inc.'s VRoid Project"*
- **Dance clips** — user-supplied (VRChat-community VRMA pack)
