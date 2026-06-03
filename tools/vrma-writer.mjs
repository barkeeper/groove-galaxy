// vrma-writer.mjs — shared VRMA (glTF binary + VRMC_vrm_animation) writer + the humanoid
// rest hierarchy + quaternion helpers. Used by both unity-anim-to-vrma.mjs (muscle mocap)
// and video-to-dance/retarget.mjs (MediaPipe landmarks). Keeping the GLB packing in one
// place means both converters emit byte-identical container structure.
import fs from 'node:fs';

// Humanoid bone hierarchy + approximate VRM-standard rest translations (metres, from parent).
// three-vrm-animation rebinds these onto the target VRM, but a coherent hierarchy with
// non-zero offsets is required for the rebinding to work.  [boneName, parent, [tx,ty,tz]]
export const HUMANOID_TREE = [
  ['hips',          null,           [0,    0.95, 0   ]],
  ['spine',         'hips',         [0,    0.10, 0   ]],
  ['chest',         'spine',        [0,    0.15, 0   ]],
  ['upperChest',    'chest',        [0,    0.10, 0   ]],
  ['neck',          'upperChest',   [0,    0.10, 0   ]],
  ['head',          'neck',         [0,    0.08, 0   ]],
  ['leftShoulder',  'upperChest',   [ 0.04, 0.08, 0  ]],
  ['leftUpperArm',  'leftShoulder', [ 0.10, 0,    0  ]],
  ['leftLowerArm',  'leftUpperArm', [ 0.25, 0,    0  ]],
  ['leftHand',      'leftLowerArm', [ 0.25, 0,    0  ]],
  ['rightShoulder', 'upperChest',   [-0.04, 0.08, 0  ]],
  ['rightUpperArm', 'rightShoulder',[-0.10, 0,    0  ]],
  ['rightLowerArm', 'rightUpperArm',[-0.25, 0,    0  ]],
  ['rightHand',     'rightLowerArm',[-0.25, 0,    0  ]],
  ['leftUpperLeg',  'hips',         [ 0.08,-0.05, 0  ]],
  ['leftLowerLeg',  'leftUpperLeg', [ 0,   -0.40, 0  ]],
  ['leftFoot',      'leftLowerLeg', [ 0,   -0.40, 0  ]],
  ['rightUpperLeg', 'hips',         [-0.08,-0.05, 0  ]],
  ['rightLowerLeg', 'rightUpperLeg',[ 0,   -0.40, 0  ]],
  ['rightFoot',     'rightLowerLeg',[ 0,   -0.40, 0  ]],
];
export const HUMANOID_BONES = HUMANOID_TREE.map(([n]) => n);

// ---------- quaternion / vector helpers ([x,y,z,w]) ----------
export function quatNormalize(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0]/l, q[1]/l, q[2]/l, q[3]/l]; }
export function quatMul(a, b) { return [
  a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
  a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
  a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
  a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
]; }
export function quatConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
export function twistY(q) { const n = Math.hypot(q[1], q[3]) || 1; return [0, q[1]/n, 0, q[3]/n]; }
export function quatDot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]; }

// shortest-arc rotation taking unit vector `from` to unit vector `to`
export function quatFromTo(from, to) {
  const f = vNorm(from), t = vNorm(to);
  let d = f[0]*t[0] + f[1]*t[1] + f[2]*t[2];
  if (d >= 1 - 1e-8) return [0, 0, 0, 1];
  if (d <= -1 + 1e-8) {            // opposite: rotate 180° about any perpendicular axis
    let axis = vCross([1, 0, 0], f);
    if (vLen(axis) < 1e-6) axis = vCross([0, 1, 0], f);
    axis = vNorm(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = vCross(f, t);
  const w = 1 + d;
  return quatNormalize([c[0], c[1], c[2], w]);
}
export function slerp(a, b, t) {
  let d = quatDot(a, b); let bb = b.slice();
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return quatNormalize([
    a[0] + t*(bb[0]-a[0]), a[1] + t*(bb[1]-a[1]), a[2] + t*(bb[2]-a[2]), a[3] + t*(bb[3]-a[3])]);
  const th0 = Math.acos(d), th = th0 * t;
  const s0 = Math.cos(th) - d * Math.sin(th) / Math.sin(th0);
  const s1 = Math.sin(th) / Math.sin(th0);
  return [a[0]*s0 + bb[0]*s1, a[1]*s0 + bb[1]*s1, a[2]*s0 + bb[2]*s1, a[3]*s0 + bb[3]*s1];
}

export function vAdd(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
export function vSub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
export function vScale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
export function vMid(a, b) { return [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2]; }
export function vLen(a) { return Math.hypot(a[0], a[1], a[2]); }
export function vNorm(a) { const l = vLen(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
export function vDot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
export function vCross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
export function vRotByQuat(v, q) {       // q * (v,0) * q^-1
  const [x, y, z, w] = q;
  const ix = w*v[0] + y*v[2] - z*v[1];
  const iy = w*v[1] + z*v[0] - x*v[2];
  const iz = w*v[2] + x*v[1] - y*v[0];
  const iw = -x*v[0] - y*v[1] - z*v[2];
  return [
    ix*w + iw*-x + iy*-z - iz*-y,
    iy*w + iw*-y + iz*-x - ix*-z,
    iz*w + iw*-z + ix*-y - iy*-x,
  ];
}

// ---------- the writer ----------
// tracks = { times: Float32Array(frames), boneQuats: Map<bone, Float32Array(frames*4)>,
//            hipsTrans: Float32Array(frames*3), name?: string }
export function writeVrma(tracks, outPath) {
  const { times, boneQuats, hipsTrans } = tracks;
  const name = tracks.name || 'clip';
  const frames = times.length;
  const bones = HUMANOID_BONES.slice();
  const boneIdx = (b) => bones.indexOf(b);

  // identity-fill any humanoid bone the clip didn't drive
  for (const b of HUMANOID_BONES) {
    if (!boneQuats.has(b)) {
      const a = new Float32Array(frames * 4);
      for (let i = 0; i < frames; i++) a[i * 4 + 3] = 1;
      boneQuats.set(b, a);
    }
  }

  const nodes = HUMANOID_TREE.map(([nm, parent, t]) => {
    const node = { name: nm, translation: t };
    const childNames = HUMANOID_TREE.filter(([, p]) => p === nm).map(([n]) => n);
    if (childNames.length) node.children = childNames.map(boneIdx);
    return node;
  });

  const binChunks = []; const bvList = []; const accList = [];
  let byteOffset = 0;
  function pushAccessor(arr, componentType, type, count, min = null, max = null) {
    const pad = (4 - (byteOffset % 4)) % 4;
    if (pad) { binChunks.push(new Uint8Array(pad)); byteOffset += pad; }
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const bvIndex = bvList.length;
    bvList.push({ buffer: 0, byteOffset, byteLength: buf.byteLength });
    binChunks.push(buf); byteOffset += buf.byteLength;
    const acc = { bufferView: bvIndex, componentType, count, type };
    if (min) acc.min = min; if (max) acc.max = max;
    accList.push(acc); return accList.length - 1;
  }

  const timeAcc = pushAccessor(times, 5126, 'SCALAR', frames, [0], [times[frames - 1]]);
  const samplers = []; const channels = [];
  {
    const accT = pushAccessor(hipsTrans, 5126, 'VEC3', frames);
    samplers.push({ input: timeAcc, output: accT, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: boneIdx('hips'), path: 'translation' } });
  }
  for (const b of bones) {
    const accR = pushAccessor(boneQuats.get(b), 5126, 'VEC4', frames);
    samplers.push({ input: timeAcc, output: accR, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: boneIdx(b), path: 'rotation' } });
  }

  const humanBones = {};
  for (const b of bones) humanBones[b] = { node: boneIdx(b) };
  const gltf = {
    asset: { version: '2.0', generator: 'vrma-writer.mjs' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones } } },
    scene: 0, scenes: [{ nodes: [boneIdx('hips')] }], nodes,
    buffers: [{ byteLength: byteOffset }], bufferViews: bvList, accessors: accList,
    animations: [{ name, samplers, channels }],
  };

  const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const binBuf = Buffer.concat(binChunks);
  const binPadded = Buffer.concat([binBuf, Buffer.alloc((4 - (binBuf.length % 4)) % 4, 0)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4);
  const totalLen = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  header.writeUInt32LE(totalLen, 8);
  const chunk = (type, payload) => { const h = Buffer.alloc(8); h.writeUInt32LE(payload.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, payload]); };
  fs.writeFileSync(outPath, Buffer.concat([header, chunk(0x4E4F534A, jsonPadded), chunk(0x004E4942, binPadded)]));
  return { totalLen, frames, bones: bones.length };
}
