// retarget-kalido.mjs — ENGINE B ("kalido"): MediaPipe landmarks → VRMA via the Kalidokit Pose solver.
//
// Kalidokit (MIT) takes the 3D world + 2D image landmarks and returns clean LOCAL Euler rotations for
// the VRM humanoid bones (hips, spine, the four arm/leg bones per side, wrists). We convert those to
// quaternions and write them straight into a .vrma (three-vrm-animation applies them the same way
// Kalidokit's three-vrm demo applies them to normalized bone nodes). Feet/shoulders/neck/head have no
// Kalidokit output → feet are levelled flat in common.mjs, the rest stay at rest. Hip translation +
// smoothing also come from common.mjs (shared with the builtin engine).
//
// Usage: node retarget-kalido.mjs --in <landmarks.json> --out <out.vrma> [--name <id>]
import * as Kalidokit from '../../node_modules/kalidokit/dist/kalidokit.es.js';
import { finalizeAndWrite, loadLandmarks } from './common.mjs';
import { HUMANOID_BONES, quatMul } from '../vrma-writer.mjs';

// orientation correction (Kalidokit was tuned for a mirror/VRM0 facing): flip euler axes + extra hips
// yaw so she faces the camera, un-mirrored. Tuned from screenshots.
const FLIP = { x: 1, y: -1, z: -1 };   // per-axis euler sign
const HIPS_YAW_DEG = 0;                 // extra yaw on hips so she faces the camera (±180 turns around)

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; }
const inPath = arg('in'), outPath = arg('out'), name = arg('name', 'clip');
if (!inPath || !outPath) { console.error('usage: node retarget-kalido.mjs --in <landmarks.json> --out <out.vrma> [--name <id>]'); process.exit(2); }

const data = loadLandmarks(inPath);
const F = data.frames, frames = F.length;
if (frames < 2) { console.error('need >=2 frames'); process.exit(1); }
if (!F.every((fr) => fr.img)) { console.error('kalido engine needs image landmarks (re-run pose.py)'); process.exit(1); }

// three.js setFromEuler closed form (supports the orders Kalidokit emits)
function eulerToQuat(x, y, z, order = 'XYZ') {
  const c1 = Math.cos(x/2), c2 = Math.cos(y/2), c3 = Math.cos(z/2);
  const s1 = Math.sin(x/2), s2 = Math.sin(y/2), s3 = Math.sin(z/2);
  switch (order) {
    case 'YXZ': return [s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3-s1*s2*c3, c1*c2*c3+s1*s2*s3];
    case 'ZXY': return [s1*c2*c3-c1*s2*s3, c1*s2*c3+s1*c2*s3, c1*c2*s3+s1*s2*c3, c1*c2*c3-s1*s2*s3];
    case 'ZYX': return [s1*c2*c3-c1*s2*s3, c1*s2*c3+s1*c2*s3, c1*c2*s3-s1*s2*c3, c1*c2*c3+s1*s2*s3];
    case 'YZX': return [s1*c2*c3+c1*s2*s3, c1*s2*c3+s1*c2*s3, c1*c2*s3-s1*s2*c3, c1*c2*c3-s1*s2*s3];
    case 'XZY': return [s1*c2*c3-c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3+s1*s2*c3, c1*c2*c3+s1*s2*s3];
    default:    return [s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3+s1*s2*c3, c1*c2*c3-s1*s2*s3]; // XYZ
  }
}
const yaw = (deg) => { const a = deg * Math.PI / 360; return [0, Math.sin(a), 0, Math.cos(a)]; };
const HIPS_YAW_Q = yaw(HIPS_YAW_DEG);

// Kalidokit rig bone -> VRMA humanoid bone
const MAP = {
  Hips: 'hips', Spine: 'spine',
  LeftUpperArm: 'leftUpperArm', LeftLowerArm: 'leftLowerArm', LeftHand: 'leftHand',
  RightUpperArm: 'rightUpperArm', RightLowerArm: 'rightLowerArm', RightHand: 'rightHand',
  LeftUpperLeg: 'leftUpperLeg', LeftLowerLeg: 'leftLowerLeg',
  RightUpperLeg: 'rightUpperLeg', RightLowerLeg: 'rightLowerLeg',
};

const boneQuats = new Map();
for (const b of HUMANOID_BONES) boneQuats.set(b, new Float32Array(frames * 4));
const times = new Float32Array(frames);

for (let f = 0; f < frames; f++) {
  times[f] = F[f].t;
  const fr = F[f];
  const world = fr.world.map((p, i) => ({ x: p[0], y: p[1], z: p[2], visibility: fr.vis[i] }));
  const img   = fr.img.map((p, i)  => ({ x: p[0], y: p[1], z: p[2], visibility: fr.vis[i] }));
  const rig = Kalidokit.Pose.solve(world, img, {
    runtime: 'mediapipe', imageSize: { width: data.width, height: data.height }, enableLegs: true,
  });
  if (!rig) continue;

  for (const [kk, bone] of Object.entries(MAP)) {
    const r = kk === 'Hips' ? rig.Hips?.rotation : rig[kk];
    if (!r) continue;
    let q = eulerToQuat((r.x || 0) * FLIP.x, (r.y || 0) * FLIP.y, (r.z || 0) * FLIP.z, r.rotationOrder || 'XYZ');
    if (bone === 'hips') q = quatMul(HIPS_YAW_Q, q);   // turn to face the camera
    const a = boneQuats.get(bone); a[f*4]=q[0]; a[f*4+1]=q[1]; a[f*4+2]=q[2]; a[f*4+3]=q[3];
  }
}

const res = finalizeAndWrite({ F, frames, times, boneQuats, name }, outPath);
console.log(`[kalido] wrote ${outPath} (${(res.totalLen/1024).toFixed(1)} KB, ${res.frames} frames @ ${data.fps}fps, hipTrans ${res.transDerived ? 'image' : 'rest'})`);
