// unity-anim-to-vrma.mjs — convert a Unity Humanoid AnimationClip (.anim YAML)
// into a VRMA (.vrma) file: glTF binary + VRMC_vrm_animation extension.
//
// Every humanoid bone is driven by Unity's muscle curves (the canonical Mecanim humanoid
// representation). The muscle→bone-rotation mapping is taken from tools/muscle-calib.json
// (fit once from a known-good reference clip by tools/calibrate-muscles.mjs); without it the
// code falls back to a crude default-range Euler approximation. Hips get RootQ (also calibrated
// into the VRM coordinate convention); root translation is applied to the hips bone.
//
// Limitations: finger curves, blend shapes, eye/jaw muscles are ignored; the calibration is a
// per-bone linear-in-rotation-vector fit, so very large 3-DOF shoulder poses can drift a little.
//
// Usage: node tools/unity-anim-to-vrma.mjs <input.anim> <output.vrma>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sample, extractCurves, expmapToQuat, quatToLog } from './anim-muscle.mjs';
import { HUMANOID_TREE, HUMANOID_BONES, quatNormalize, quatMul, quatConj, twistY, writeVrma } from './vrma-writer.mjs';

// Optional empirical calibration produced by tools/calibrate-muscles.mjs from a known-good reference
// clip: bone -> { muscles:[names in order], M:[3][n], b:[3] }. When present, a calibrated bone's
// local rotation is rotvec = M·(muscle values) + b → quaternion — reproducing the rig's real
// Mecanim muscle→bone mapping instead of the crude default-range Euler fallback below.
const CALIB = (() => {
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), 'muscle-calib.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  } catch { return {}; }
})();

// ---------- Unity default muscle definitions ----------
// Each entry: [muscleName, bone, axis, defaultMin (deg), defaultMax (deg)]
// Sourced from Unity's HumanTrait.MuscleDefaultMin/Max for the standard humanoid avatar.
// Axis is the VRM/glTF rotation axis in the bone's local frame after Unity Mecanim normalization.
const MUSCLES = [
  // Spine / Chest / Neck / Head
  ['Spine Front-Back',          'spine',      'x', -40, 40],
  ['Spine Left-Right',          'spine',      'z', -40, 40],
  ['Spine Twist Left-Right',    'spine',      'y', -40, 40],
  ['Chest Front-Back',          'chest',      'x', -20, 20],
  ['Chest Left-Right',          'chest',      'z', -20, 20],
  ['Chest Twist Left-Right',    'chest',      'y', -20, 20],
  ['UpperChest Front-Back',     'upperChest', 'x', -20, 20],
  ['UpperChest Left-Right',     'upperChest', 'z', -20, 20],
  ['UpperChest Twist Left-Right','upperChest','y', -20, 20],
  ['Neck Nod Down-Up',          'neck',       'x', -40, 40],
  ['Neck Tilt Left-Right',      'neck',       'z', -40, 40],
  ['Neck Turn Left-Right',      'neck',       'y', -40, 40],
  ['Head Nod Down-Up',          'head',       'x', -40, 40],
  ['Head Tilt Left-Right',      'head',       'z', -40, 40],
  ['Head Turn Left-Right',      'head',       'y', -40, 40],

  // Left arm chain
  ['Left Shoulder Down-Up',     'leftShoulder',  'z',  15, -15],
  ['Left Shoulder Front-Back',  'leftShoulder',  'y', -15, 15],
  ['Left Arm Down-Up',          'leftUpperArm',  'z',  60, -100],
  ['Left Arm Front-Back',       'leftUpperArm',  'y', -60, 60],
  ['Left Arm Twist In-Out',     'leftUpperArm',  'x', -90, 90],
  ['Left Forearm Stretch',      'leftLowerArm',  'z',  -80, 80],
  ['Left Forearm Twist In-Out', 'leftLowerArm',  'x', -90, 90],
  ['Left Hand Down-Up',         'leftHand',      'z', -40, 40],
  ['Left Hand In-Out',          'leftHand',      'y', -40, 40],

  // Right arm chain (mirrored)
  ['Right Shoulder Down-Up',    'rightShoulder', 'z', -15, 15],
  ['Right Shoulder Front-Back', 'rightShoulder', 'y',  15, -15],
  ['Right Arm Down-Up',         'rightUpperArm', 'z', -60, 100],
  ['Right Arm Front-Back',      'rightUpperArm', 'y',  60, -60],
  ['Right Arm Twist In-Out',    'rightUpperArm', 'x',  90, -90],
  ['Right Forearm Stretch',     'rightLowerArm', 'z',  80, -80],
  ['Right Forearm Twist In-Out','rightLowerArm', 'x',  90, -90],
  ['Right Hand Down-Up',        'rightHand',     'z',  40, -40],
  ['Right Hand In-Out',         'rightHand',     'y',  40, -40],

  // Left leg
  ['Left Upper Leg Front-Back', 'leftUpperLeg',  'x', -90, 50],
  ['Left Upper Leg In-Out',     'leftUpperLeg',  'z',  60, -60],
  ['Left Upper Leg Twist In-Out','leftUpperLeg', 'y', -60, 60],
  ['Left Lower Leg Stretch',    'leftLowerLeg',  'x',   0, 80],
  ['Left Lower Leg Twist In-Out','leftLowerLeg', 'y', -30, 30],
  ['Left Foot Up-Down',         'leftFoot',      'x', -50, 50],
  ['Left Foot Twist In-Out',    'leftFoot',      'y', -30, 30],

  // Right leg (mirrored)
  ['Right Upper Leg Front-Back','rightUpperLeg', 'x', -90, 50],
  ['Right Upper Leg In-Out',    'rightUpperLeg', 'z', -60, 60],
  ['Right Upper Leg Twist In-Out','rightUpperLeg','y', 60, -60],
  ['Right Lower Leg Stretch',   'rightLowerLeg', 'x',   0, 80],
  ['Right Lower Leg Twist In-Out','rightLowerLeg','y', 30, -30],
  ['Right Foot Up-Down',        'rightFoot',     'x', -50, 50],
  ['Right Foot Twist In-Out',   'rightFoot',     'y',  30, -30],
];

// HUMANOID_TREE / HUMANOID_BONES are imported from ./vrma-writer.mjs (shared with retarget.mjs).

// (extractCurves + sample now live in ./anim-muscle.mjs, shared with the calibration tool.)

// Muscle normalized value [-1,1] → angle in radians, using Unity's default range.
// Negative muscle uses min, positive uses max; rest at 0.
function muscleToRad(value, minDeg, maxDeg) {
  const deg = value >= 0 ? value * maxDeg : (-value) * minDeg * -1;
  // wait — Unity does: value * (max), then value * (-min) for negative. Cleaner:
  // pose_deg = (value >= 0) ? value * max : value * (-min)
  const v = value >= 0 ? value * maxDeg : value * (-minDeg);
  return v * Math.PI / 180;
}

// Compose XYZ Euler (intrinsic) into a quaternion (glTF/three.js convention)
function eulerXYZToQuat(rx, ry, rz) {
  const c1 = Math.cos(rx / 2), c2 = Math.cos(ry / 2), c3 = Math.cos(rz / 2);
  const s1 = Math.sin(rx / 2), s2 = Math.sin(ry / 2), s3 = Math.sin(rz / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,  // x
    c1 * s2 * c3 - s1 * c2 * s3,  // y
    c1 * c2 * s3 + s1 * s2 * c3,  // z
    c1 * c2 * c3 - s1 * s2 * s3,  // w
  ];
}

// quatNormalize / quatMul / quatConj / twistY are imported from ./vrma-writer.mjs.

// ---------- main ----------
const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: node unity-anim-to-vrma.mjs <input.anim> <output.vrma>'); process.exit(2); }

const text = fs.readFileSync(inPath, 'utf8');
const stopTime = parseFloat((text.match(/m_StopTime:\s*([\-0-9.eE]+)/) || [])[1] || '0');
const sampleRate = parseFloat((text.match(/m_SampleRate:\s*([\-0-9.eE]+)/) || [])[1] || '30');
if (!stopTime) { console.error('no m_StopTime'); process.exit(1); }
const wanted = new Set(MUSCLES.map((m) => m[0]));
for (const c of ['RootT.x','RootT.y','RootT.z','RootQ.x','RootQ.y','RootQ.z','RootQ.w']) wanted.add(c);
const curves = extractCurves(text, wanted);
console.log(`parsed ${curves.size} curves; duration ${stopTime.toFixed(2)}s @ ${sampleRate}fps; calibrated bones: ${Object.keys(CALIB).length}`);

// Per-bone muscle list for fast frame composition
const bonePerturb = new Map(); // bone -> [{name, axis, min, max, keys}]
for (const [name, bone, axis, min, max] of MUSCLES) {
  const keys = curves.get(name);
  if (!keys) continue;
  if (!bonePerturb.has(bone)) bonePerturb.set(bone, []);
  bonePerturb.get(bone).push({ axis, min, max, keys });
}
console.log('animated bones:', [...bonePerturb.keys()].join(', '));

// Root translation + rotation curves (apply to hips)
const rtx = curves.get('RootT.x'), rty = curves.get('RootT.y'), rtz = curves.get('RootT.z');
const rqx = curves.get('RootQ.x'), rqy = curves.get('RootQ.y'), rqz = curves.get('RootQ.z'), rqw = curves.get('RootQ.w');
const rootRef = { x: sample(rtx, 0), y: sample(rty, 0), z: sample(rtz, 0) };

const fps = sampleRate;
const frames = Math.max(2, Math.round(stopTime * fps) + 1);
const times = new Float32Array(frames);
for (let i = 0; i < frames; i++) times[i] = i / fps;

// Per-bone quaternion frames + hips translation frames
const boneQuats = new Map();      // bone -> Float32Array(frames*4)
const hipsTrans = new Float32Array(frames * 3);

for (const bone of HUMANOID_BONES) {
  // Even bones with no muscle data get an identity track? skip if no perturbation and not hips.
  if (!bonePerturb.has(bone) && bone !== 'hips') continue;
  boneQuats.set(bone, new Float32Array(frames * 4));
}

// Make sure all four limbs have a quaternion buffer (IK targets drive these even if no muscles do)
for (const b of ['leftUpperArm','leftLowerArm','rightUpperArm','rightLowerArm','leftUpperLeg','leftLowerLeg','rightUpperLeg','rightLowerLeg','leftFoot','rightFoot','leftHand','rightHand','hips']) {
  if (!boneQuats.has(b)) boneQuats.set(b, new Float32Array(frames * 4));
}

for (let f = 0; f < frames; f++) {
  const t = times[f];

  // ---- root translation → hips position (relative to first frame) ----
  hipsTrans[f * 3 + 0] = sample(rtx, t) - rootRef.x;
  hipsTrans[f * 3 + 1] = sample(rty, t) - rootRef.y;
  hipsTrans[f * 3 + 2] = sample(rtz, t) - rootRef.z;

  function setBoneQuat(bone, q) {
    const arr = boneQuats.get(bone);
    if (!arr) return;
    arr[f * 4 + 0] = q[0]; arr[f * 4 + 1] = q[1]; arr[f * 4 + 2] = q[2]; arr[f * 4 + 3] = q[3];
  }
  // ---- per-bone rotation from muscles ----
  // Calibrated bones: rotvec = M·(muscle values, in calib order) + b → quaternion (matches the
  // rig's real Mecanim mapping). Uncalibrated bones fall back to crude per-axis Euler.
  for (const [bone, perturbs] of bonePerturb) {
    const cal = CALIB[bone];
    if (cal) {
      const v = cal.muscles.map((name) => sample(curves.get(name), t));
      const r = [cal.b[0], cal.b[1], cal.b[2]];
      for (let k = 0; k < 3; k++) for (let j = 0; j < v.length; j++) r[k] += cal.M[k][j] * v[j];
      setBoneQuat(bone, expmapToQuat(r));
    } else {
      let rx = 0, ry = 0, rz = 0;
      for (const p of perturbs) {
        const ang = muscleToRad(sample(p.keys, t), p.min, p.max);
        if (p.axis === 'x') rx += ang; else if (p.axis === 'y') ry += ang; else rz += ang;
      }
      setBoneQuat(bone, eulerXYZToQuat(rx, ry, rz));
    }
  }

  // ---- root rotation → hips ----
  // Mecanim's RootQ is the whole-body rotation. The calibrated 'hips' entry maps it (as a
  // rotation-vector) into the VRM's coordinate convention; without calibration we apply RootQ raw.
  if (rqw && rqw.length) {
    const rq = quatNormalize([sample(rqx, t), sample(rqy, t), sample(rqz, t), sample(rqw, t)]);
    const ch = CALIB.hips;
    if (ch && ch.rootq) {
      const rqv = quatToLog(rq);
      const r = [ch.b[0], ch.b[1], ch.b[2]];
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) r[k] += ch.M[k][j] * rqv[j];
      setBoneQuat('hips', expmapToQuat(r));
    } else {
      setBoneQuat('hips', rq);
    }
  }

  // ---- foot leveling ----
  // These mocap clips are IK-foot-pinned, so their FK foot *muscles* are unreliable: applied as FK
  // they point the toes regardless of pose (constant tiptoe). Keeping a sole flat needs the leg
  // angle, which a muscle-only foot fit can't capture and doesn't generalize from the reference.
  // So we override each foot to sit flat on the floor, facing the leg's yaw:
  //   footWorld = yaw(legWorld)  ⇒  footLocal = inv(legWorld) · yaw(legWorld)
  // (Other limbs still come from the validated muscle calibration above; the old analytic IK that
  // assumed limbs rest along -Y and collapsed the ankles is gone.)
  const fq = (bone) => { const a = boneQuats.get(bone); return a ? [a[f*4], a[f*4+1], a[f*4+2], a[f*4+3]] : [0, 0, 0, 1]; };
  const hipsQ = fq('hips');
  for (const [up, lo, foot] of [['leftUpperLeg', 'leftLowerLeg', 'leftFoot'], ['rightUpperLeg', 'rightLowerLeg', 'rightFoot']]) {
    const legWorld = quatMul(hipsQ, quatMul(fq(up), fq(lo)));
    setBoneQuat(foot, quatNormalize(quatMul(quatConj(legWorld), twistY(legWorld))));
  }
}

// ---------- pack as VRMA via the shared writer ----------
const res = writeVrma({ times, boneQuats, hipsTrans, name: 'LoliKamiRequiem' }, outPath);
console.log(`wrote ${outPath} (${(res.totalLen/1024).toFixed(1)} KB, ${res.frames} frames, ${res.bones} bones)`);
