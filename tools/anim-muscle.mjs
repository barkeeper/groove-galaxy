// anim-muscle.mjs — shared Unity-humanoid muscle definitions + helpers, used by both the
// converter (unity-anim-to-vrma.mjs) and the calibration tool (_calibrate.mjs) so they can
// never drift out of sync on the muscle list / parsing.

// [muscleName, bone, axis, defaultMinDeg, defaultMaxDeg] — axis/min/max are only used by the
// legacy Euler fallback; the calibrated path fits a linear muscle→rotation-vector map instead.
export const MUSCLES = [
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

  ['Left Shoulder Down-Up',     'leftShoulder',  'z',  15, -15],
  ['Left Shoulder Front-Back',  'leftShoulder',  'y', -15, 15],
  ['Left Arm Down-Up',          'leftUpperArm',  'z',  60, -100],
  ['Left Arm Front-Back',       'leftUpperArm',  'y', -60, 60],
  ['Left Arm Twist In-Out',     'leftUpperArm',  'x', -90, 90],
  ['Left Forearm Stretch',      'leftLowerArm',  'z',  -80, 80],
  ['Left Forearm Twist In-Out', 'leftLowerArm',  'x', -90, 90],
  ['Left Hand Down-Up',         'leftHand',      'z', -40, 40],
  ['Left Hand In-Out',          'leftHand',      'y', -40, 40],

  ['Right Shoulder Down-Up',    'rightShoulder', 'z', -15, 15],
  ['Right Shoulder Front-Back', 'rightShoulder', 'y',  15, -15],
  ['Right Arm Down-Up',         'rightUpperArm', 'z', -60, 100],
  ['Right Arm Front-Back',      'rightUpperArm', 'y',  60, -60],
  ['Right Arm Twist In-Out',    'rightUpperArm', 'x',  90, -90],
  ['Right Forearm Stretch',     'rightLowerArm', 'z',  80, -80],
  ['Right Forearm Twist In-Out','rightLowerArm', 'x',  90, -90],
  ['Right Hand Down-Up',        'rightHand',     'z',  40, -40],
  ['Right Hand In-Out',         'rightHand',     'y',  40, -40],

  ['Left Upper Leg Front-Back', 'leftUpperLeg',  'x', -90, 50],
  ['Left Upper Leg In-Out',     'leftUpperLeg',  'z',  60, -60],
  ['Left Upper Leg Twist In-Out','leftUpperLeg', 'y', -60, 60],
  ['Left Lower Leg Stretch',    'leftLowerLeg',  'x',   0, 80],
  ['Left Lower Leg Twist In-Out','leftLowerLeg', 'y', -30, 30],
  ['Left Foot Up-Down',         'leftFoot',      'x', -50, 50],
  ['Left Foot Twist In-Out',    'leftFoot',      'y', -30, 30],

  ['Right Upper Leg Front-Back','rightUpperLeg', 'x', -90, 50],
  ['Right Upper Leg In-Out',    'rightUpperLeg', 'z', -60, 60],
  ['Right Upper Leg Twist In-Out','rightUpperLeg','y', 60, -60],
  ['Right Lower Leg Stretch',   'rightLowerLeg', 'x',   0, 80],
  ['Right Lower Leg Twist In-Out','rightLowerLeg','y', 30, -30],
  ['Right Foot Up-Down',        'rightFoot',     'x', -50, 50],
  ['Right Foot Twist In-Out',   'rightFoot',     'y',  30, -30],
];

// bone -> [muscleName, ...] in MUSCLES table order (the fixed per-bone muscle vector order).
export function musclesByBone() {
  const m = new Map();
  for (const [name, bone] of MUSCLES) { if (!m.has(bone)) m.set(bone, []); m.get(bone).push(name); }
  return m;
}

// Sample piecewise-linear {t,v} keyframes at time t.
export function sample(keys, t) {
  if (!keys || !keys.length) return 0;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  let lo = 0, hi = keys.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (keys[mid].t <= t) lo = mid; else hi = mid; }
  const a = keys[lo], b = keys[hi]; const f = (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * f;
}

// Minimal Unity AnimationClip float-curve extractor: scans `- curve:` blocks for the wanted
// `attribute:` names and pulls their {time,value} keyframes. (The file is too big to YAML-parse.)
export function extractCurves(text, wanted) {
  const out = new Map();
  const blocks = text.split(/\n  - curve:\n/);
  for (let i = 1; i < blocks.length; i++) {
    const blk = blocks[i];
    const aMatch = blk.match(/\n    attribute:\s*"?([^"\n]+?)"?\n/);
    if (!aMatch) continue;
    const attr = aMatch[1].trim();
    if (!wanted.has(attr)) continue;
    const keys = [];
    const keyRx = /\n      - serializedVersion:[\s\S]*?\n        time:\s*([\-0-9.eE]+)\n        value:\s*([\-0-9.eE]+)/g;
    let m; while ((m = keyRx.exec(blk)) !== null) keys.push({ t: +m[1], v: +m[2] });
    if (keys.length) out.set(attr, keys);
  }
  return out;
}

// rotation-vector (axis*angle, radians) → quaternion [x,y,z,w]
export function expmapToQuat(r) {
  const ang = Math.hypot(r[0], r[1], r[2]);
  if (ang < 1e-9) return [0, 0, 0, 1];
  const h = ang / 2, s = Math.sin(h) / ang;
  return [r[0] * s, r[1] * s, r[2] * s, Math.cos(h)];
}

// quaternion [x,y,z,w] → rotation-vector (axis*angle, radians), shortest (w forced ≥ 0)
export function quatToLog(q) {
  let [x, y, z, w] = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return [0, 0, 0];
  const ang = 2 * Math.atan2(s, w);
  const k = ang / s;
  return [x * k, y * k, z * k];
}
