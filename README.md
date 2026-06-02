# Groove Galaxy 踊

A single-page app where a **3D VRM character dances** to a set list of tracks — runs **100% in the browser**, no backend.

- **Dancer** — a [VRoid VRM](https://vroid.com/en) avatar rendered with [three.js](https://threejs.org) + [@pixiv/three-vrm](https://github.com/pixiv/three-vrm). She idles on her own and dances on demand.
- **Motion** — [VRMA](https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm-animation) mocap clips: an intro walk-in, an ambient idle loop, and the music-paired dances.
- **Set List** — pick a track on the right; she loops that dance while the song plays, with a live equalizer.
- **Dance Floor** — pick an animated video backdrop; it crossfades in behind her while a dance plays and fades back to the still image when it ends.

## Animation categories

| Category | Clips | Behaviour |
|---|---|---|
| **Idle** | `VRMA_01` (intro) + `VRMA_02..07` | Auto-cycle whenever no dance is selected — the ambient "living" loop. |
| **Dance** | `OtonaBlue`, `BabyYou`, `TocaToca`, `RareDance_3`, `RareDance_5`, `RabbitHole`, `Soiree`, `Kidding`, `BoomBoom`, `SakuyuiTaiso`, `Flower`, `BounceDance`, `March` | Listed in the Set List. Triggered by tap, looped until stopped, paired with `music/<name>.mp3`. |
| **Dance Floor** | `assets/dancefloor/floor1..6.mp4` (+ `floorN.jpg` first-frame thumbs) | Animated backdrops; the picked one fades in behind the dancer while a dance plays. |

## Run

Serve over HTTP (ES modules + service worker need a real origin). Use the bundled
**no-store** dev server so the browser never serves stale code/assets (plain
`python -m http.server` caches forever, which breaks service-worker updates):

```powershell
node tools/serve.mjs            # → http://127.0.0.1:5173/  (pass a port to change it)
```

Open the page and tap a track. First run pulls three.js from the CDN and caches it (works offline after).

> The dancer needs **WebGL2** (any recent Chrome / Edge / Firefox / Safari).

## Add a dance

1. Drop `MyDance.vrma` into `assets/vrma/` and `MyDance.mp3` into `music/`.
2. Add the filename to `DANCE_CLIPS` in `face.js`.
3. Add an entry to `DANCES` in `app.js` (`id` must match the filenames):
   ```js
   { id: 'MyDance', title: 'My Dance', artist: 'Someone' },
   ```
4. Add both files to `shell-files.json` so they precache for offline.

Convert a Unity humanoid `.anim` to `.vrma` with the bundled tool:

```powershell
node tools/unity-anim-to-vrma.mjs source.anim assets/vrma/MyDance.vrma
```

## Layout

```
index.html        bootstrap: CSP + import map (three / three-vrm) + SW/PWA + theme → loads app.js
app.js            Set List + music player + spectrum visualizer (no LLM, no voice)
face.js           three.js VRM dancer — idle cycle, named dances (playDance), blink + gaze
styles.css        analog dance-floor design system (2 themes)
sw.js             offline service worker        manifest.webmanifest   icons/
assets/avatar.vrm + assets/vrma/*.vrma + assets/face-bg.jpg
music/*.mp3       one track per dance
tools/            VRMA authoring helpers (inspect / patch / unity converter)
```

`node_modules/` and `package-lock.json` are git-ignored.

## DevTools probes

```js
__face.status()            // { dances, currentClip, idleCount }
__face.playDance('BabyYou')// trigger a dance immediately
__face.sampleBones()       // verify a clip is actually driving the rig
```

## Credits

- **VRoid model** — Zelená Terra / "Little Black Dress #6" by BEAMER3K.
- **VRMA Motion Pack (intro + idle)** — pixiv VRoid Project — credit required: *"Animation credits to pixiv Inc.'s VRoid Project"* (see `assets/vrma/Readme_VRMA_MotionPack_EN.txt`).
- **Dance clips** — user-supplied VRMA pack.
