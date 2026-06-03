// retarget.mjs — Stage 3: MediaPipe landmark JSON → VRMA clip.
//
// Converts per-frame 3D world landmarks into VRM humanoid LOCAL bone quaternions using a
// per-limb swing solve (rotate each bone's rest direction onto the landmark-derived target
// direction) followed by hierarchy localisation (qLocal = inv(parentWorld)·boneWorld). Feet
// are levelled flat to the floor like tools/unity-anim-to-vrma.mjs (MediaPipe foot landmarks
// are noisy). Output is temporally smoothed (zero-phase EMA) then packed via vrma-writer.mjs.
//
// Coordinate convention (normalized VRM humanoid): Y up, character faces +Z, T-pose with the
// avatar's LEFT limbs along +X. MediaPipe world axes (x right, y down, z toward camera) are
// mapped in via AXIS; flip its signs if a screenshot shows the dance mirrored/upside-down.
//
// Usage: node retarget.mjs --in out/hiphop.landmarks.json --out ../../assets/vrma/hiphop.vrma --name hiphop
import fs from 'node:fs';
import {
  HUMANOID_TREE, writeVrma,
  quatNormalize, quatMul, quatConj, twistY, quatFromTo, slerp, quatDot,
  vSub, vMid, vNorm, vCross, vDot,
} from '../vrma-writer.mjs';

// ---- tunables (validated empirically against screenshots) ----
const AXIS = { sx: -1, sy: -1, sz: 1 };   // MediaPipe(x,y,z) -> VRM world(x,y,z); 180° about Y so she faces the camera
const FLIP_HANDED = false;                  // negate X if the pose comes out mirrored
const SMOOTH_ALPHA = 0.55;                  // EMA weight on the new sample (lower = smoother)
const FOOT_LEVEL = true;                    // level soles flat (ignore noisy foot landmarks)
// hip translation reconstructed from the normalized image landmarks (jumps / squats / sway) so
// the body actually leaves the floor instead of being anchored. World landmarks are hip-centred
// and carry no global motion, so this comes from image space (mean-removed -> oscillates, no drift).
const TRANS_SCALE = 1.0;                     // overall gain (0 = locked in place)
const TRANS_AXES = { x: 0.6, y: 1.0, z: 0 }; // per-axis gain (image depth z is unreliable)
const RIG_HEIGHT = 1.5;                      // metres head->floor, to scale normalized motion
const REST_HIPS = [0, 0.95, 0];              // rest hips position (matches vrma-writer HUMANOID_TREE);
                                             // the translation channel REPLACES it, so we ride motion on top

// ---- args ----
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const inPath = arg('in');
const outPath = arg('out');
const name = arg('name', 'clip');
if (!inPath || !outPath) { console.error('usage: node retarget.mjs --in <landmarks.json> --out <out.vrma> [--name <id>]'); process.exit(2); }

const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const F = data.frames;
const frames = F.length;
if (frames < 2) { console.error('need >=2 frames'); process.exit(1); }

// ---- landmark indices ----
const L = { NOSE:0, LS:11, RS:12, LE:13, RE:14, LW:15, RW:16, LIdx:19, RIdx:20,
            LH:23, RH:24, LK:25, RK:26, LA:27, RA:28, LFI:31, RFI:32 };

// convert a MediaPipe world landmark to VRM-world coords
function conv(p) {
  let x = p[0] * AXIS.sx, y = p[1] * AXIS.sy, z = p[2] * AXIS.sz;
  if (FLIP_HANDED) x = -x;
  return [x, y, z];
}

// ---- bone solve table: [bone, restDir, fromJoint, toJoint] ----
// joints are landmark keys or derived 'SC'/'HC'
const REST = { px:[1,0,0], nx:[-1,0,0], py:[0,1,0], ny:[0,-1,0], pz:[0,0,1] };
const BONES = [
  ['spine',         REST.py, 'HC', 'SC'],
  ['chest',         REST.py, 'HC', 'SC'],
  ['upperChest',    REST.py, 'HC', 'SC'],
  // neck/head follow the torso axis (HC->SC) rather than craning toward the nose (which points
  // up-and-forward and tips the head back). Keeps the head upright with the body.
  ['neck',          REST.py, 'HC', 'SC'],
  ['head',          REST.py, 'HC', 'SC'],
  ['leftShoulder',  REST.px, 'SC', 'LS'],
  ['leftUpperArm',  REST.px, 'LS', 'LE'],
  ['leftLowerArm',  REST.px, 'LE', 'LW'],
  ['leftHand',      REST.px, 'LW', 'LIdx'],
  ['rightShoulder', REST.nx, 'SC', 'RS'],
  ['rightUpperArm', REST.nx, 'RS', 'RE'],
  ['rightLowerArm', REST.nx, 'RE', 'RW'],
  ['rightHand',     REST.nx, 'RW', 'RIdx'],
  ['leftUpperLeg',  REST.ny, 'LH', 'LK'],
  ['leftLowerLeg',  REST.ny, 'LK', 'LA'],
  ['leftFoot',      REST.pz, 'LA', 'LFI'],
  ['rightUpperLeg', REST.ny, 'RH', 'RK'],
  ['rightLowerLeg', REST.ny, 'RK', 'RA'],
  ['rightFoot',     REST.pz, 'RA', 'RFI'],
];

// parent lookup from the shared humanoid tree
const PARENT = Object.fromEntries(HUMANOID_TREE.map(([n, p]) => [n, p]));

// rotation matrix (columns x,y,z basis) -> quaternion [x,y,z,w]
function basisToQuat(X, Y, Z) {
  const m00=X[0], m10=X[1], m20=X[2];
  const m01=Y[0], m11=Y[1], m21=Y[2];
  const m02=Z[0], m12=Z[1], m22=Z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21-m12)/s, (m02-m20)/s, (m10-m01)/s, 0.25*s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25*s, (m01+m10)/s, (m02+m20)/s, (m21-m12)/s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01+m10)/s, 0.25*s, (m12+m21)/s, (m02-m20)/s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02+m20)/s, (m12+m21)/s, 0.25*s, (m10-m01)/s]; }
  return quatNormalize(q);
}

// per-bone quaternion buffers
const boneQuats = new Map();
const ALL = BONES.map((b) => b[0]).concat(['hips']);
for (const b of ALL) boneQuats.set(b, new Float32Array(frames * 4));
const hipsTrans = new Float32Array(frames * 3);   // filled from image landmarks below (not ~0)

const times = new Float32Array(frames);

for (let f = 0; f < frames; f++) {
  times[f] = F[f].t;
  const w = F[f].world;
  const J = (key) => {
    if (key === 'SC') return vMid(conv(w[L.LS]), conv(w[L.RS]));
    if (key === 'HC') return vMid(conv(w[L.LH]), conv(w[L.RH]));
    return conv(w[L[key]]);
  };

  // ---- hips world basis from the torso ----
  const bodyX = vNorm(vSub(J('LH'), J('RH')));          // +X = avatar's left
  let bodyUp = vNorm(vSub(J('SC'), J('HC')));            // +Y up the spine
  let bodyFwd = vNorm(vCross(bodyX, bodyUp));            // +Z facing
  bodyUp = vNorm(vCross(bodyFwd, bodyX));                // re-orthonormalise
  const qWorld = {};
  qWorld.hips = basisToQuat(bodyX, bodyUp, bodyFwd);

  // ---- per-bone swing solve in world ----
  for (const [bone, rest, from, to] of BONES) {
    const dir = vSub(J(to), J(from));
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    qWorld[bone] = len < 1e-6 ? [0, 0, 0, 1] : quatFromTo(rest, vNorm(dir));
  }

  // ---- localise: qLocal = inv(parentWorld) * boneWorld ----
  const setQ = (bone, q) => { const a = boneQuats.get(bone); a[f*4]=q[0]; a[f*4+1]=q[1]; a[f*4+2]=q[2]; a[f*4+3]=q[3]; };
  setQ('hips', qWorld.hips);
  for (const [bone] of BONES) {
    const par = PARENT[bone];
    const pw = qWorld[par] || [0, 0, 0, 1];
    setQ(bone, quatNormalize(quatMul(quatConj(pw), qWorld[bone])));
  }

  // ---- foot leveling (flat sole facing the leg's yaw), like the unity converter ----
  if (FOOT_LEVEL) {
    for (const [lo, foot] of [['leftLowerLeg', 'leftFoot'], ['rightLowerLeg', 'rightFoot']]) {
      const legWorld = qWorld[lo];
      setQ(foot, quatNormalize(quatMul(quatConj(legWorld), twistY(legWorld))));
    }
  }
}

// ---- zero-phase EMA smoothing per bone (forward then backward) ----
function smooth(arr) {
  const q = (i) => [arr[i*4], arr[i*4+1], arr[i*4+2], arr[i*4+3]];
  const set = (i, v) => { arr[i*4]=v[0]; arr[i*4+1]=v[1]; arr[i*4+2]=v[2]; arr[i*4+3]=v[3]; };
  // align hemispheres for continuity
  for (let i = 1; i < frames; i++) { if (quatDot(q(i-1), q(i)) < 0) set(i, q(i).map((x) => -x)); }
  let s = q(0);
  for (let i = 1; i < frames; i++) { s = quatNormalize(slerp(s, q(i), SMOOTH_ALPHA)); set(i, s); }
  s = q(frames - 1);
  for (let i = frames - 2; i >= 0; i--) { s = quatNormalize(slerp(s, q(i), SMOOTH_ALPHA)); set(i, s); }
}
for (const b of ALL) smooth(boneQuats.get(b));

// ---- hip translation from image-space hip centre (so feet aren't anchored) ----
if (F.every((fr) => fr.img)) {
  const ihip = F.map((fr) => vMid(fr.img[L.LH], fr.img[L.RH]));          // normalized [x,y(down),z]
  // body height in normalized units (nose -> lower ankle), median for a stable scale
  const heights = F.map((fr) => {
    const ankleY = Math.max(fr.img[L.LA][1], fr.img[L.RA][1]);
    return ankleY - fr.img[L.NOSE][1];
  }).filter((h) => h > 1e-3).sort((a, b) => a - b);
  const medH = heights.length ? heights[heights.length >> 1] : 0.5;
  const scale = (RIG_HEIGHT / medH) * TRANS_SCALE;
  const mean = ihip.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map((v) => v / ihip.length);
  for (let f = 0; f < frames; f++) {
    // image +x = screen right = VRM +x (avatar faces +Z); image +y is down -> VRM up = -y.
    // Baseline = rest hips height so she stands at the right level (the channel replaces, not adds),
    // with the mean-removed dance motion (sway/bob/jump) riding on top — feet free, never sunk.
    hipsTrans[f*3]   = REST_HIPS[0] + (ihip[f][0] - mean[0]) * scale * TRANS_AXES.x;
    hipsTrans[f*3+1] = REST_HIPS[1] - (ihip[f][1] - mean[1]) * scale * TRANS_AXES.y;
    hipsTrans[f*3+2] = REST_HIPS[2];
  }
  // smooth translation (forward/backward EMA), same as rotations
  for (let c = 0; c < 3; c++) {
    let s = hipsTrans[c];
    for (let f = 1; f < frames; f++) { s = s + SMOOTH_ALPHA * (hipsTrans[f*3+c] - s); hipsTrans[f*3+c] = s; }
    s = hipsTrans[(frames-1)*3+c];
    for (let f = frames-2; f >= 0; f--) { s = s + SMOOTH_ALPHA * (hipsTrans[f*3+c] - s); hipsTrans[f*3+c] = s; }
  }
  const span = (c) => { let lo=Infinity,hi=-Infinity; for(let f=0;f<frames;f++){const v=hipsTrans[f*3+c];lo=Math.min(lo,v);hi=Math.max(hi,v);} return (hi-lo).toFixed(3); };
  console.log(`[retarget] hip translation span: x=${span(0)} y=${span(1)} m (image-derived)`);
} else {
  for (let f = 0; f < frames; f++) { hipsTrans[f*3]=REST_HIPS[0]; hipsTrans[f*3+1]=REST_HIPS[1]; hipsTrans[f*3+2]=REST_HIPS[2]; }
  console.log('[retarget] no image landmarks -> hips at rest height (re-run pose.py to enable foot lift)');
}

const res = writeVrma({ times, boneQuats, hipsTrans, name }, outPath);
console.log(`[retarget] wrote ${outPath} (${(res.totalLen/1024).toFixed(1)} KB, ${res.frames} frames @ ${data.fps}fps, ${res.bones} bones)`);
