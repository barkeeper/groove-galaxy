// retarget.mjs — ENGINE A ("builtin"): MediaPipe world landmarks → VRMA via a bend-plane basis solve.
//
// For each limb the bone direction comes from the joint positions AND its ROLL is pinned by the joint
// hinge normal n = (upperDir × lowerDir): the elbow/knee bends in the observed plane, so hands stop
// twisting through the body and knees bend the right way. Each bone's world rotation is built from a
// full orthonormal basis (primary = bone axis, hinge local axis = n), then localised down the hierarchy.
// Feet are levelled flat, hips/torso from the body basis, hip translation + smoothing in common.mjs.
//
// Usage: node retarget.mjs --in <landmarks.json> --out <out.vrma> [--name <id>]
import {
  L, conv, basisToQuat, boneBasis, finalizeAndWrite, loadLandmarks,
} from './common.mjs';
import {
  HUMANOID_BONES, HUMANOID_TREE,
  quatNormalize, quatMul, quatConj, vSub, vNorm, vMid, vCross,
} from '../vrma-writer.mjs';

// hinge sign per side (the mirror flips the bend normal); tune from screenshots if a joint inverts
const ARM = { L: { prim: 'x',  hinge: 'z', sign: +1 }, R: { prim: '-x', hinge: 'z', sign: -1 } };
const LEG = { L: { prim: '-y', hinge: 'x', sign: +1 }, R: { prim: '-y', hinge: 'x', sign: -1 } };

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; }
const inPath = arg('in'), outPath = arg('out'), name = arg('name', 'clip');
if (!inPath || !outPath) { console.error('usage: node retarget.mjs --in <landmarks.json> --out <out.vrma> [--name <id>]'); process.exit(2); }

const data = loadLandmarks(inPath);
const F = data.frames, frames = F.length;
if (frames < 2) { console.error('need >=2 frames'); process.exit(1); }

const PARENT = Object.fromEntries(HUMANOID_TREE.map(([n, p]) => [n, p]));
const boneQuats = new Map();
for (const b of HUMANOID_BONES) boneQuats.set(b, new Float32Array(frames * 4));
const times = new Float32Array(frames);

const len = (v) => Math.hypot(v[0], v[1], v[2]);
function hinge(d1, d2, fallback) { const n = vCross(d1, d2); return len(n) < 0.1 ? fallback : vNorm(n); }
const signed = (s, v) => (s < 0 ? [-v[0], -v[1], -v[2]] : v);

for (let f = 0; f < frames; f++) {
  times[f] = F[f].t;
  const w = F[f].world;
  const J = (k) => k === 'SC' ? vMid(conv(w[L.LS]), conv(w[L.RS]))
                 : k === 'HC' ? vMid(conv(w[L.LH]), conv(w[L.RH]))
                 : conv(w[L[k]]);

  // body basis -> hips/torso
  const bodyX = vNorm(vSub(J('LH'), J('RH')));
  let bodyUp = vNorm(vSub(J('SC'), J('HC')));
  const bodyFwd = vNorm(vCross(bodyX, bodyUp));
  bodyUp = vNorm(vCross(bodyFwd, bodyX));
  const qW = {};
  qW.hips = basisToQuat(bodyX, bodyUp, bodyFwd);
  qW.spine = qW.chest = qW.upperChest = qW.neck = qW.head = qW.hips;   // torso carried by hips

  // arms
  for (const [S, sh, el, wr, ix, U, Lo, Hn] of [
    ['L', 'LS', 'LE', 'LW', 'LIdx', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
    ['R', 'RS', 'RE', 'RW', 'RIdx', 'rightUpperArm', 'rightLowerArm', 'rightHand']]) {
    const d1 = vNorm(vSub(J(el), J(sh))), d2 = vNorm(vSub(J(wr), J(el)));
    const n = signed(ARM[S].sign, hinge(d1, d2, bodyFwd));
    qW[U]  = boneBasis(ARM[S].prim, d1, ARM[S].hinge, n);
    qW[Lo] = boneBasis(ARM[S].prim, d2, ARM[S].hinge, n);
    const dH = vSub(J(ix), J(wr));
    qW[Hn] = len(dH) < 1e-4 ? qW[Lo] : boneBasis(ARM[S].prim, vNorm(dH), ARM[S].hinge, n);
  }
  // shoulders (gentle: aim outward, roll from body forward)
  qW.leftShoulder  = boneBasis('x',  vNorm(vSub(J('LS'), J('SC'))), 'z', bodyFwd);
  qW.rightShoulder = boneBasis('-x', vNorm(vSub(J('RS'), J('SC'))), 'z', bodyFwd);

  // legs
  for (const [S, hp, kn, an, U, Lo] of [
    ['L', 'LH', 'LK', 'LA', 'leftUpperLeg', 'leftLowerLeg'],
    ['R', 'RH', 'RK', 'RA', 'rightUpperLeg', 'rightLowerLeg']]) {
    const d1 = vNorm(vSub(J(kn), J(hp))), d2 = vNorm(vSub(J(an), J(kn)));
    const n = signed(LEG[S].sign, hinge(d1, d2, bodyX));
    qW[U]  = boneBasis(LEG[S].prim, d1, LEG[S].hinge, n);
    qW[Lo] = boneBasis(LEG[S].prim, d2, LEG[S].hinge, n);
  }

  // localise: qLocal = inv(parentWorld) * boneWorld
  const setQ = (b, q) => { const a = boneQuats.get(b); a[f*4]=q[0]; a[f*4+1]=q[1]; a[f*4+2]=q[2]; a[f*4+3]=q[3]; };
  setQ('hips', qW.hips);
  for (const b of HUMANOID_BONES) {
    if (b === 'hips' || b === 'leftFoot' || b === 'rightFoot') continue;  // feet levelled in common
    const par = PARENT[b];
    const pw = qW[par] || [0, 0, 0, 1];
    const bw = qW[b]   || [0, 0, 0, 1];
    setQ(b, quatNormalize(quatMul(quatConj(pw), bw)));
  }
}

const res = finalizeAndWrite({ F, frames, times, boneQuats, name }, outPath);
console.log(`[builtin] wrote ${outPath} (${(res.totalLen/1024).toFixed(1)} KB, ${res.frames} frames @ ${data.fps}fps, hipTrans ${res.transDerived ? 'image' : 'rest'})`);
