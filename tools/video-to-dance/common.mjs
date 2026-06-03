// common.mjs — shared bits for both retarget engines (builtin basis solver + kalidokit).
// Landmark loading, MediaPipe→VRM axis convert, image-space hip translation, FK foot leveling,
// zero-phase smoothing, and the final pack via tools/vrma-writer.mjs.
import fs from 'node:fs';
import {
  HUMANOID_BONES, HUMANOID_TREE, writeVrma,
  quatNormalize, quatMul, quatConj, twistY, slerp, quatDot,
  vMid, vSub, vNorm,
} from '../vrma-writer.mjs';

// MediaPipe Pose landmark indices
export const L = { NOSE:0, LS:11, RS:12, LE:13, RE:14, LW:15, RW:16, LIdx:19, RIdx:20,
                   LH:23, RH:24, LK:25, RK:26, LA:27, RA:28, LHeel:29, RHeel:30, LFI:31, RFI:32 };

// MediaPipe world (x right, y down, z toward cam) -> VRM world (Y up). Used only by the builtin
// engine. {sx:1, sz:-1} faces the camera for this capture; flip both to turn her 180° about Y.
export const AXIS = { sx: 1, sy: -1, sz: -1 };
export const conv = (p, a = AXIS) => [p[0]*a.sx, p[1]*a.sy, p[2]*a.sz];

export const REST_HIPS = [0, 0.95, 0];   // matches HUMANOID_TREE hips translation

export function loadLandmarks(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// rotation matrix with columns (X,Y,Z basis) -> quaternion [x,y,z,w]
export function basisToQuat(X, Y, Z) {
  const m00=X[0], m10=X[1], m20=X[2], m01=Y[0], m11=Y[1], m21=Y[2], m02=Z[0], m12=Z[1], m22=Z[2];
  const tr = m00 + m11 + m22; let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21-m12)/s, (m02-m20)/s, (m10-m01)/s, 0.25*s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25*s, (m01+m10)/s, (m02+m20)/s, (m21-m12)/s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01+m10)/s, 0.25*s, (m12+m21)/s, (m02-m20)/s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02+m20)/s, (m12+m21)/s, 0.25*s, (m10-m01)/s]; }
  return quatNormalize(q);
}

// build a bone's world rotation from a primary axis (the bone direction) + a hinge axis,
// mapping the bone's rest-local axes (rest local == world at rest) onto the target frame.
// primAxis: which local axis is the bone's geometric direction ('x'|'-x'|'y'|'-y'|'z'|'-z')
// hingeAxis: which local axis is the joint hinge ('x'|'y'|'z'); maps to the world bend normal `n`.
export function boneBasis(primAxis, dir, hingeAxis, n) {
  // target directions for whichever local axes are primary / hinge; third = cross
  const T = { x: null, y: null, z: null };
  const set = (axis, v) => { const k = axis.replace('-', ''); T[k] = axis[0] === '-' ? [-v[0], -v[1], -v[2]] : v; };
  set(primAxis, dir);
  set(hingeAxis, n);
  // fill the remaining axis so (X,Y,Z) is right-handed: Z = X×Y, etc.
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  if (!T.x) T.x = cross(T.y, T.z);
  else if (!T.y) T.y = cross(T.z, T.x);
  else T.z = cross(T.x, T.y);
  return basisToQuat(vNorm(T.x), vNorm(T.y), vNorm(T.z));
}

// forward-kinematic world rotation of a bone by walking up HUMANOID_TREE parents
const PARENT = Object.fromEntries(HUMANOID_TREE.map(([n, p]) => [n, p]));
function worldQuat(boneQuats, f, bone) {
  let q = [0, 0, 0, 1];
  for (let b = bone; b; b = PARENT[b]) {
    const a = boneQuats.get(b);
    const lq = a ? [a[f*4], a[f*4+1], a[f*4+2], a[f*4+3]] : [0, 0, 0, 1];
    q = quatMul(lq, q);
  }
  return q;
}

// level both soles flat to the floor, facing the leg's yaw (works for any engine via FK)
export function levelFeetFK(boneQuats, frames) {
  for (let f = 0; f < frames; f++) {
    for (const [lo, foot] of [['leftLowerLeg', 'leftFoot'], ['rightLowerLeg', 'rightFoot']]) {
      const legWorld = worldQuat(boneQuats, f, lo);
      const footWorld = twistY(legWorld);
      const parentWorld = worldQuat(boneQuats, f, PARENT[foot]); // = lowerLeg world
      const local = quatNormalize(quatMul(quatConj(parentWorld), footWorld));
      const a = boneQuats.get(foot); a[f*4]=local[0]; a[f*4+1]=local[1]; a[f*4+2]=local[2]; a[f*4+3]=local[3];
    }
  }
}

// zero-phase EMA smoothing of one quaternion track (hemisphere-aligned)
export function smoothTrack(arr, frames, alpha) {
  const q = (i) => [arr[i*4], arr[i*4+1], arr[i*4+2], arr[i*4+3]];
  const set = (i, v) => { arr[i*4]=v[0]; arr[i*4+1]=v[1]; arr[i*4+2]=v[2]; arr[i*4+3]=v[3]; };
  for (let i = 1; i < frames; i++) if (quatDot(q(i-1), q(i)) < 0) set(i, q(i).map((x) => -x));
  let s = q(0);
  for (let i = 1; i < frames; i++) { s = quatNormalize(slerp(s, q(i), alpha)); set(i, s); }
  s = q(frames - 1);
  for (let i = frames - 2; i >= 0; i--) { s = quatNormalize(slerp(s, q(i), alpha)); set(i, s); }
}

// reconstruct hip translation from normalized image landmarks (sway/bob/jump on top of rest height)
export function reconstructHipsTrans(F, frames, { rigHeight = 1.5, scale = 1.0, axes = { x: 0.6, y: 1.0, z: 0 } } = {}) {
  const out = new Float32Array(frames * 3);
  if (!F.every((fr) => fr.img)) {
    for (let f = 0; f < frames; f++) { out[f*3]=REST_HIPS[0]; out[f*3+1]=REST_HIPS[1]; out[f*3+2]=REST_HIPS[2]; }
    return { out, derived: false };
  }
  const ihip = F.map((fr) => vMid(fr.img[L.LH], fr.img[L.RH]));
  const heights = F.map((fr) => Math.max(fr.img[L.LA][1], fr.img[L.RA][1]) - fr.img[L.NOSE][1]).filter((h) => h > 1e-3).sort((a, b) => a - b);
  const medH = heights.length ? heights[heights.length >> 1] : 0.5;
  const s = (rigHeight / medH) * scale;
  const mean = ihip.reduce((a, p) => [a[0]+p[0], a[1]+p[1]], [0, 0]).map((v) => v / ihip.length);
  for (let f = 0; f < frames; f++) {
    out[f*3]   = REST_HIPS[0] + (ihip[f][0] - mean[0]) * s * axes.x;
    out[f*3+1] = REST_HIPS[1] - (ihip[f][1] - mean[1]) * s * axes.y;
    out[f*3+2] = REST_HIPS[2];
  }
  for (let c = 0; c < 3; c++) {
    let v = out[c];
    for (let f = 1; f < frames; f++) { v += 0.55 * (out[f*3+c] - v); out[f*3+c] = v; }
    v = out[(frames-1)*3+c];
    for (let f = frames-2; f >= 0; f--) { v += 0.55 * (out[f*3+c] - v); out[f*3+c] = v; }
  }
  return { out, derived: true };
}

// foot-level + smooth all bones + reconstruct hips translation + pack to a .vrma
export function finalizeAndWrite({ F, frames, times, boneQuats, name, smoothAlpha = 0.5, levelFeet = true }, outPath) {
  if (levelFeet) levelFeetFK(boneQuats, frames);
  for (const b of HUMANOID_BONES) { const a = boneQuats.get(b); if (a) smoothTrack(a, frames, smoothAlpha); }
  const { out: hipsTrans, derived } = reconstructHipsTrans(F, frames);
  const res = writeVrma({ times, boneQuats, hipsTrans, name }, outPath);
  return { ...res, transDerived: derived };
}
