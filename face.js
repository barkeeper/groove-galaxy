// ============================================================
// face.js — VRoid VRM dancer (three.js WebGL + @pixiv/three-vrm).
// Two clip categories, both from pixiv's VRMA Motion Pack (via three-vrm-animation):
//   • IDLE  — VRMA_01 "Show full body" boots the scene, then VRMA_02..07 auto-cycle
//             whenever no dance is selected (the ambient "living" loop).
//   • DANCE — the music-paired showstoppers, triggered by name from the UI (playDance)
//             and looped until idle() is called.
// Blinks + gaze stay procedural via the VRM expression manager and lookAt target,
// layered on top of whatever body clip is playing.
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// pixiv VRMA Motion Pack — credit: "Animation credits to pixiv Inc.'s VRoid Project"
// (terms in assets/vrma/Readme_VRMA_MotionPack_EN.txt)
const VRMA_BASE = './assets/vrma/';
const VRMA_INTRO = 'VRMA_01.vrma';                   // "Show full body" — the walk-in
// IDLE category — auto-cycled whenever no dance is selected (ambient motion).
const VRMA_IDLE  = [
  'VRMA_02.vrma', // Greeting
  'VRMA_03.vrma', // Peace sign
  'VRMA_04.vrma', // Shoot
  'VRMA_05.vrma', // Spin
  'VRMA_06.vrma', // Model pose
  'VRMA_07.vrma', // Squat
];
// DANCE category — music-paired showstoppers, listed in the UI and triggered by name.
// Each <Name>.vrma pairs with ./music/<Name>.mp3; loops while the track plays.
const DANCE_CLIPS = [
  'OtonaBlue.vrma',
  'BabyYou.vrma',
  'TocaToca.vrma',
  'RareDance_3.vrma',
  'RareDance_5.vrma',
  'Soiree.vrma',
];

export async function createFace({ canvas, modelUrl, idleFiles }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const size = () => ({ w: canvas.clientWidth || 1, h: canvas.clientHeight || 1 });
  let { w, h } = size();
  renderer.setSize(w, h, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, w / h, 0.1, 30);
  scene.add(camera);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // small blur — 0.5 exceeds the 20-sample cap and warns
  const key = new THREE.DirectionalLight(0xfff4e6, 2.2); key.position.set(1.4, 2.2, 2.4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe3ff, 1.0); rim.position.set(-1.8, 1.2, -1.6); scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  // ---- loader (registered for both VRM and VRMA) ----
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  // ---- load VRM ----
  const gltf = await loader.loadAsync(modelUrl);
  const vrm = gltf.userData.vrm;
  try { VRMUtils.removeUnnecessaryVertices?.(gltf.scene); } catch {}
  try { (VRMUtils.combineSkeletons || VRMUtils.removeUnnecessaryJoints)?.(gltf.scene); } catch {} // combineSkeletons replaces the deprecated removeUnnecessaryJoints
  try { VRMUtils.rotateVRM0?.(vrm); } catch {}                 // normalize VRM0 to face -Z like VRM1
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  vrm.scene.rotation.y = Math.PI;                              // turn to face the camera (+Z)
  scene.add(vrm.scene);

  const expr = vrm.expressionManager;

  // lookAt needs a quaternion proxy in the scene graph for VRMA clips to drive it
  if (vrm.lookAt) {
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = 'lookAtQuaternionProxy';
    vrm.scene.add(proxy);
  }

  // lookAt target rides the camera so the eyes meet the viewer (+ cursor gaze)
  const lookTarget = new THREE.Object3D(); camera.add(lookTarget); lookTarget.position.set(0, 0, -3);
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;

  // prime the rig so bone world positions are valid before framing
  vrm.update(0);
  scene.updateMatrixWorld(true);

  // ---- framing on full body (head to toe) — measured once at rest ----
  let bodyCenterY = 0.85, bodyHeight = 1.7;
  {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    if (isFinite(box.max.y) && isFinite(box.min.y)) {
      bodyHeight = Math.max(box.max.y - box.min.y, 1.2);
      bodyCenterY = (box.max.y + box.min.y) / 2;
    }
  }
  // Fixed full-body framing — measured once, never zooms during animations.
  function reframe() {
    const aspect = Math.max(w / h, 0.0001);
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const padding = 1.18;
    const distV = (bodyHeight * padding) / (2 * Math.tan(vFov / 2));
    const distH = (bodyHeight * padding * 0.45) / (2 * Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distV, distH);
    camera.position.set(0, bodyCenterY, dist);
    camera.lookAt(0, bodyCenterY, 0);
    camera.updateProjectionMatrix();
  }
  reframe();

  // ---- bottom anchor ----
  // Some VRMA clips bake vertical root/hips translation, so in the fixed frame the whole
  // body slowly sinks (or floats) and she changes apparent position between emotions/dances.
  // We pin the lowest foot to a constant floor line (measured once at rest) every frame, with
  // a small tolerance so natural bounce of a few pixels still reads. Pose-driven dips (a squat
  // bending the knees) keep the feet planted, so they pass through untouched.
  const footNodes = ['leftToes', 'rightToes', 'leftFoot', 'rightFoot']
    .map((n) => vrm.humanoid?.getRawBoneNode?.(n)).filter(Boolean);
  const _footV = new THREE.Vector3();
  const lowestFootY = () => {
    let min = Infinity;
    for (const n of footNodes) { n.getWorldPosition(_footV); if (_footV.y < min) min = _footV.y; }
    return isFinite(min) ? min : null;
  };
  const FLOOR_Y = lowestFootY() ?? 0;   // rest-pose feet height (model offset still 0 here)
  const FOOT_TOL = 0.02;                 // ~a few px of slack — small bounce stays
  let footOffsetY = 0;
  function anchorFeet() {
    if (!footNodes.length) return;
    const fy = lowestFootY();
    if (fy == null) return;
    const dev = FLOOR_Y - fy;            // >0 → foot below floor (sinking); <0 → lifted (hop)
    // Hard floor downward — corrected fully in THIS frame (before render) so even a fast root
    // drop can never visibly sink her below the floor line. Soft pull when she floats above it,
    // so genuine hops/bounce still read and a higher-baseline clip eases back down.
    if (dev > FOOT_TOL)        footOffsetY += (dev - FOOT_TOL);         // full: never sinks
    else if (dev < -FOOT_TOL)  footOffsetY += (dev + FOOT_TOL) * 0.2;   // gentle: keep the hop
    vrm.scene.position.y = footOffsetY;
  }

  // ---- load VRMA clips (intro + idle pool + optional rare pool) ----
  async function loadClip(file) {
    const g = await loader.loadAsync(VRMA_BASE + file);
    const anim = g.userData.vrmAnimations?.[0];
    if (!anim) throw new Error(`No animation in ${file}`);
    const clip = createVRMAnimationClip(anim, vrm);
    clip.name = file.replace(/\.vrma$/i, ''); // they're all "Clip" otherwise — name for status/debug
    return clip;
  }
  // Best-effort: missing/optional clips just get skipped, they don't break boot.
  async function tryLoad(file) { try { return await loadClip(file); } catch (e) { console.warn(`[face] skipping ${file}: ${e?.message || e}`); return null; } }
  const introClip = await loadClip(VRMA_INTRO);
  // Per-model idle pool: a model can ship its own idle clips (passed in via idleFiles); otherwise
  // everyone shares the pixiv pack. Missing files are skipped, and we fall back if none load.
  const wantIdle = (Array.isArray(idleFiles) && idleFiles.length) ? idleFiles : VRMA_IDLE;
  let idleClips = (await Promise.all(wantIdle.map(tryLoad))).filter(Boolean);
  if (!idleClips.length) idleClips = (await Promise.all(VRMA_IDLE.map(tryLoad))).filter(Boolean);
  const danceClips = (await Promise.all(DANCE_CLIPS.map(tryLoad))).filter(Boolean);

  const mixer = new THREE.AnimationMixer(vrm.scene);
  let currentAction = null;

  function playClip(clip, { fade = 0.5, loop = false } = {}) {
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    if (currentAction && currentAction !== action) {
      action.play();
      currentAction.crossFadeTo(action, fade, false);
    } else {
      action.play();
    }
    currentAction = action;
    return action;
  }

  // Look up a dance clip by name — the UI triggers these on demand.
  const danceByName = new Map(danceClips.map((c) => [c.name, c]));

  // Auto-cycle IDLE clips when one finishes (the ambient loop). DANCE clips loop
  // (LoopRepeat) so they never fire 'finished' here — they end only when the UI calls idle().
  let nextQueuedAt = 0;
  let queuedClip = null;
  mixer.addEventListener('finished', (e) => {
    // Only react when the CURRENTLY-active clip ends. A manually-triggered dance crossfades
    // out the previous idle, whose LoopOnce action may then fire 'finished' mid-fade — this
    // guard stops that from queuing an idle that would override the dance.
    if (e.action !== currentAction) return;
    let pick;
    do { pick = idleClips[(Math.random() * idleClips.length) | 0]; }
    while (idleClips.length > 1 && pick === currentAction?.getClip());
    queuedClip = pick;
    nextQueuedAt = performance.now() + 1200 + Math.random() * 2000; // small breather between idles
  });

  // boot with the intro
  playClip(introClip, { fade: 0 });

  // expose a small probe so the rare clip can be inspected / triggered from devtools:
  //   window.__face.status()    → { rareLoaded, secondsUntilRare, currentClip }
  //   window.__face.playRare()  → fire the rare clip immediately
  try {
    window.__face = {
      status: () => ({
        dances: danceClips.map((c) => c.name),
        currentClip: currentAction?.getClip()?.name || null,
        idleCount: idleClips.length,
      }),
      anchor: () => ({ floorY: FLOOR_Y, footY: lowestFootY(), offset: footOffsetY }),
      playDance: (name) => { const c = danceByName.get(name); if (!c) return `no clip: ${name}`; queuedClip = null; playClip(c, { fade: 0.4, loop: true }); return `playing: ${c.name}`; },
      // debug: sample a few humanoid bone rotations so a test can detect whether a clip
      // is actually driving the rig (motion) vs. loaded-but-inert (no retargeted tracks).
      sampleBones: () => {
        const out = {};
        for (const n of ['hips', 'spine', 'leftUpperArm', 'rightUpperArm', 'leftLowerLeg', 'head']) {
          const node = vrm.humanoid?.getNormalizedBoneNode?.(n);
          if (node) out[n] = [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w].map((v) => +v.toFixed(4));
        }
        return out;
      },
    };
  } catch {}

  // ---- expressions state (blink + gaze, layered on top of the VRMA body clip) ----
  const gaze = { x: 0, y: 0, tx: 0, ty: 0, sx: 0, sy: 0 };
  let nextSaccade = performance.now() + 900;
  let blink = 0, nextBlink = performance.now() + 1800 + Math.random() * 2400;

  const clock = new THREE.Clock(); clock.getDelta();
  let running = true;

  const setExpr = (name, v) => { try { expr?.setValue(name, v); } catch {} };

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame); // schedule the next frame FIRST so a thrown body can't kill the loop
    try {
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();

    // ---- body animation (VRMA mixer) ----
    mixer.update(dt);
    if (queuedClip && now >= nextQueuedAt) {
      playClip(queuedClip, { fade: 0.6 });
      queuedClip = null;
    }

    // ---- blink (state machine: idle → close→open → schedule next) ----
    if (blink === 0 && now > nextBlink) {
      blink = 0.001;
      nextBlink = now + 2400 + Math.random() * 3200;
    }
    if (blink > 0) {
      blink += dt * 7;
      if (blink >= 1) blink = 0;
    }
    setExpr('blink', clamp01(Math.sin(blink * Math.PI)));

    // ---- gaze (saccades + cursor target → lookAt) ----
    if (now > nextSaccade) {
      gaze.sx = (Math.random() * 2 - 1) * 0.25;
      gaze.sy = (Math.random() * 2 - 1) * 0.15;
      nextSaccade = now + 1200 + Math.random() * 2400;
      setTimeout(() => { gaze.sx = 0; gaze.sy = 0; }, 90 + Math.random() * 140);
    }
    gaze.x = lerp(gaze.x, gaze.tx + gaze.sx, 0.12);
    gaze.y = lerp(gaze.y, gaze.ty + gaze.sy, 0.12);
    lookTarget.position.set(gaze.x * 1.6, gaze.y * 1.1, -3);

    vrm.update(dt);   // bone updates, expressions, lookAt, spring physics
    anchorFeet();     // keep her planted on the floor line (after the rig is posed for this frame)

    renderer.render(scene, camera);
    } catch (e) { // a transient GPU/context hiccup (e.g. under heavy LLM-on-GPU load) must not freeze the avatar
      if (!frame._warned) { frame._warned = true; console.warn('[face] frame error (recovering):', e?.message || e); }
    }
  }
  requestAnimationFrame(frame);

  function resize() { const s = size(); if (s.w === w && s.h === h) return; w = s.w; h = s.h; camera.aspect = w / h; renderer.setSize(w, h, false); reframe(); }

  return {
    setGazeTarget(x, y) { gaze.tx = Math.max(-1, Math.min(1, x)); gaze.ty = Math.max(-1, Math.min(1, y)); },
    // Names of the dance clips that actually loaded (so the UI can flag any that are missing).
    dances() { return danceClips.map((c) => c.name); },
    // Trigger a named dance on demand; loops until idle() is called. Returns the clip name,
    // or null if that dance isn't loaded.
    playDance(name, { loop = true } = {}) {
      const clip = danceByName.get(name);
      if (!clip) return null;
      queuedClip = null;
      playClip(clip, { fade: 0.4, loop });
      return clip.name;
    },
    // Crossfade back to an idle clip (called when a dance / its music stops); the 'finished'
    // handler then resumes the ambient idle cycle.
    idle() { queuedClip = null; const pick = idleClips[(Math.random() * idleClips.length) | 0]; if (pick) playClip(pick, { fade: 0.6 }); },
    resize,
    dispose() { running = false; try { mixer.stopAllAction(); } catch {} try { VRMUtils.deepDispose?.(vrm.scene); } catch {} renderer.dispose(); },
  };
}
