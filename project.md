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
- **DANCE** — `OtonaBlue`, `BabyYou`, `TocaToca`, `RareDance_3`, `RareDance_5`. Triggered by name from
  the UI (`playDance(name)`), **looped** while the matching `music/<name>.mp3` plays. When the track
  ends (or Stop is pressed) `idle()` crossfades back to the idle cycle.

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
| `OtonaBlue / BabyYou / TocaToca / RareDance_3 / RareDance_5 .vrma` | user-provided pack | dance |

### `tools/` — VRMA authoring helpers (kept)
- `unity-anim-to-vrma.mjs` — converts a Unity humanoid `AnimationClip` (`.anim` YAML) into a `.vrma`.
  Parses Mecanim muscle curves, root/IK transforms, outputs glTF binary with `VRMC_vrm_animation`.
  Usage: `node tools/unity-anim-to-vrma.mjs input.anim assets/vrma/MyClip.vrma`
- `inspect-vrma.mjs` / `inspect-vrma2.mjs` — dump a `.vrma`'s tracks / humanoid bones.
- `patch-vrma-specversion.mjs` — stamp a `specVersion` into a `.vrma` that's missing one.

---

## Adding a dance
1. `assets/vrma/MyDance.vrma` + `music/MyDance.mp3`.
2. Append `'MyDance.vrma'` to `DANCE_CLIPS` in `face.js`.
3. Append `{ id: 'MyDance', title: '…', artist: '…' }` to `DANCES` in `app.js`.
4. Add both paths to `shell-files.json` for offline precache.

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
