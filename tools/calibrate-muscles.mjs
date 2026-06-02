// calibrate-muscles.mjs — derive the muscle→bone-rotation mapping empirically from a known-good
// reference clip (its source .anim muscles + its correct .vrma rotations), so the converter can
// reproduce the rig's real Mecanim mapping. Fits, per bone: rotvec = M·(muscle vector) + b
// (least squares with tiny ridge). Writes tools/muscle-calib.json.
//
// Usage: node tools/calibrate-muscles.mjs <reference.anim> <reference_good.vrma> [moreAnim moreVrma ...]
import fs from 'node:fs';
import { MUSCLES, musclesByBone, sample, extractCurves, quatToLog } from './anim-muscle.mjs';
const qnorm=(q)=>{const l=Math.hypot(q[0],q[1],q[2],q[3])||1;return[q[0]/l,q[1]/l,q[2]/l,q[3]/l];};

function parseGLB(buf){ let off=12,json=null,bin=null; while(off<buf.length){const len=buf.readUInt32LE(off),type=buf.readUInt32LE(off+4),data=buf.subarray(off+8,off+8+len); if(type===0x4e4f534a)json=JSON.parse(data.toString('utf8')); else if(type===0x004e4942)bin=Buffer.from(data); off+=8+len;} return {json,bin}; }
function accF32(json,bin,i){ const a=json.accessors[i],bv=json.bufferViews[a.bufferView]; const o=(bv.byteOffset||0)+(a.byteOffset||0); const comp=a.type==='VEC4'?4:a.type==='VEC3'?3:1; const out=new Float32Array(a.count*comp); for(let k=0;k<out.length;k++) out[k]=bin.readFloatLE(o+k*4); return out; }
function loadVrmaRot(file){
  const {json,bin}=parseGLB(fs.readFileSync(file));
  const hb=json.extensions?.VRMC_vrm_animation?.humanoid?.humanBones||{};
  const n2b={}; for(const [b,v] of Object.entries(hb)) if(v&&typeof v.node==='number') n2b[v.node]=b;
  const anim=json.animations[0]; const rot={};
  for(const ch of anim.channels){ const s=anim.samplers[ch.sampler]; if(ch.target.path==='rotation'){ const b=n2b[ch.target.node]; if(b) rot[b]={t:accF32(json,bin,s.input),q:accF32(json,bin,s.output)}; } }
  return rot;
}
// solve (A^T A + ridge) x = A^T y  for x, A is rows×cols (cols≤4)
function solveLS(rows, ys){
  const cols=rows[0].length;
  const AtA=Array.from({length:cols},()=>new Array(cols).fill(0));
  const Aty=new Array(cols).fill(0);
  for(let r=0;r<rows.length;r++){ const row=rows[r]; for(let i=0;i<cols;i++){ Aty[i]+=row[i]*ys[r]; for(let j=0;j<cols;j++) AtA[i][j]+=row[i]*row[j]; } }
  for(let i=0;i<cols;i++) AtA[i][i]+=1e-6; // ridge
  // Gaussian elimination
  const M=AtA.map((r,i)=>[...r,Aty[i]]);
  for(let c=0;c<cols;c++){ let p=c; for(let r=c+1;r<cols;r++) if(Math.abs(M[r][c])>Math.abs(M[p][c])) p=r; [M[c],M[p]]=[M[p],M[c]]; const pv=M[c][c]||1e-12; for(let r=0;r<cols;r++){ if(r===c)continue; const f=M[r][c]/pv; for(let k=c;k<=cols;k++) M[r][k]-=f*M[c][k]; } }
  return M.map((r,i)=>r[cols]/(r[i]||1e-12));
}

const args=process.argv.slice(2);
const pairs=[]; for(let i=0;i<args.length;i+=2) pairs.push([args[i],args[i+1]]);
if(!pairs.length){ console.error('usage: calibrate-muscles.mjs <ref.anim> <ref_good.vrma> [...]'); process.exit(2); }

// Gather per-bone training samples across all reference pairs.
const byBone=musclesByBone();
const wanted=new Set(MUSCLES.map(m=>m[0]));
for(const c of ['RootQ.x','RootQ.y','RootQ.z','RootQ.w']) wanted.add(c);
const train={}; // bone -> { rows:[[v..,1]], y:[[rx],[ry],[rz]] }
for(const [animFile,vrmaFile] of pairs){
  const text=fs.readFileSync(animFile,'utf8');
  const curves=extractCurves(text,wanted);
  const rot=loadVrmaRot(vrmaFile);
  for(const [bone,names] of byBone){
    const tr=rot[bone]; if(!tr) continue;
    const frames=tr.t.length;
    if(!train[bone]) train[bone]={names, rows:[], y:[[],[],[]]};
    for(let i=0;i<frames;i++){
      const tt=tr.t[i];
      const v=names.map(nm=>sample(curves.get(nm),tt));
      const rv=quatToLog([tr.q[i*4],tr.q[i*4+1],tr.q[i*4+2],tr.q[i*4+3]]);
      train[bone].rows.push([...v,1]);
      for(let k=0;k<3;k++) train[bone].y[k].push(rv[k]);
    }
  }
  // hips: map Unity RootQ (as a rotation-vector) -> the reference vrma's hips rotation. A
  // constant Unity->VRM coordinate-convention transform is linear in rotation-vector space.
  const gh=rot['hips'];
  if(gh){
    if(!train['hips']) train['hips']={rootq:true,rows:[],y:[[],[],[]]};
    for(let i=0;i<gh.t.length;i++){
      const tt=gh.t[i];
      const rqv=quatToLog(qnorm([sample(curves.get('RootQ.x'),tt),sample(curves.get('RootQ.y'),tt),sample(curves.get('RootQ.z'),tt),sample(curves.get('RootQ.w'),tt)]));
      train['hips'].rows.push([rqv[0],rqv[1],rqv[2],1]);
      const rv=quatToLog([gh.q[i*4],gh.q[i*4+1],gh.q[i*4+2],gh.q[i*4+3]]);
      for(let k=0;k<3;k++) train['hips'].y[k].push(rv[k]);
    }
  }
}

const calib={};
console.log('bone'.padEnd(15),'n','samples','  in-sample residual (deg)');
for(const [bone,d] of Object.entries(train)){
  const n=d.names?d.names.length:3;
  const coef=[0,1,2].map(k=>solveLS(d.rows,d.y[k])); // each length n+1
  const M=[0,1,2].map(k=>coef[k].slice(0,n));
  const b=[coef[0][n],coef[1][n],coef[2][n]];
  // residual: mean angular error between predicted rotvec and target rotvec (as rotations)
  let sum=0;
  for(let r=0;r<d.rows.length;r++){
    const row=d.rows[r]; const pred=[0,0,0];
    for(let k=0;k<3;k++){ let s=0; for(let j=0;j<=n;j++) s+=coef[k][j]*row[j]; pred[k]=s; }
    const tgt=[d.y[0][r],d.y[1][r],d.y[2][r]];
    // angle between the two rotation vectors' rotations ≈ |pred-tgt| for small diffs; report deg
    const dx=pred[0]-tgt[0],dy=pred[1]-tgt[1],dz=pred[2]-tgt[2];
    sum+=Math.hypot(dx,dy,dz)*180/Math.PI;
  }
  calib[bone]=d.rootq?{rootq:true,M,b}:{muscles:d.names,M,b};
  console.log(bone.padEnd(15),String(n),String(d.rows.length).padStart(6),`  ${(sum/d.rows.length).toFixed(1)}°`);
}
fs.writeFileSync('tools/muscle-calib.json',JSON.stringify(calib,null,1));
console.log(`\nwrote tools/muscle-calib.json (${Object.keys(calib).length} bones)`);
