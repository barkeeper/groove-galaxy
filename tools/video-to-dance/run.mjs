// run.mjs — orchestrate the video→dance pipeline end to end and register the dance.
//
//   node tools/video-to-dance/run.mjs <youtube-url> <id> [--title "T"] [--artist "A"]
//        [--skip-fetch] [--skip-pose]    (re-use cached intermediates while tuning)
//
// Stages: fetch.py (mp3 + video) → pose.py (landmarks json) → retarget.mjs (vrma) → wire app.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const py = path.join(here, '.venv', 'Scripts', 'python.exe');
const model = path.join(here, 'models', 'pose_landmarker_heavy.task');

// parse: <url> [id]  with --title/--artist taking a value, everything else a flag
const raw = process.argv.slice(2);
const VALUE_OPTS = new Set(['title', 'artist']);
const flags = new Set();
const opts = {};
const pos = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a.startsWith('--')) { const k = a.slice(2); if (VALUE_OPTS.has(k)) opts[k] = raw[++i]; else flags.add(a); }
  else pos.push(a);
}
const url = pos[0];
if (!url) { console.error('usage: node run.mjs <youtube-url> [id] [--title T] [--artist A] [--anchor] [--skip-fetch] [--skip-pose]'); process.exit(2); }

// slugify a video title into a safe CamelCase dance id
function slugify(s) {
  if (!s) return '';
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ').trim()
    .split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
    .slice(0, 40);
}
// fetch title / id / uploader without downloading, so we can name the dance from the video
function ytMeta(u) {
  try {
    const out = execFileSync(py, ['-m', 'yt_dlp', '--skip-download', '--no-playlist', '--no-warnings',
      '--print', '%(title)s\n%(id)s\n%(uploader)s', u], { encoding: 'utf8' });
    const [title, ytid, uploader] = out.trim().split(/\r?\n/);
    return { title: (title || '').trim(), ytid: (ytid || '').trim(), uploader: (uploader || '').trim() };
  } catch (e) { console.error('could not read video metadata:', e.message); return { title: '', ytid: '', uploader: '' }; }
}

let id = pos[1];
let title = opts.title;
let artist = opts.artist;
if (!id || !title || !artist) {
  console.log('reading video metadata\u2026');
  const m = ytMeta(url);
  if (!id) id = slugify(m.title) || ('yt' + m.ytid.replace(/[^A-Za-z0-9]/g, ''));
  if (!title) title = (m.title || id).slice(0, 48);
  if (!artist) artist = m.uploader || 'Video capture';
  console.log(`name from video \u2192 id='${id}'  title='${title}'  artist='${artist}'`);
}
if (!id) { console.error('could not derive an id; pass one explicitly'); process.exit(2); }
const noAnchor = !flags.has('--anchor');   // video dances carry their own foot motion by default

const landmarks = path.join(here, 'out', `${id}.landmarks.json`);
const vrma = path.join(root, 'assets', 'vrma', `${id}.vrma`);
const mp3 = path.join(root, 'music', `${id}.mp3`);

function step(name, fn) { console.log(`\n=== ${name} ===`); const t = Date.now(); fn(); console.log(`(${name} done in ${((Date.now()-t)/1000).toFixed(1)}s)`); }
function run(cmd, args, opts = {}) { console.log('$', cmd, args.join(' ')); return execFileSync(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', ...opts }); }

let videoPath = null;
if (!flags.has('--skip-fetch')) {
  step('1 fetch (mp3 + video)', () => {
    const out = run(py, [path.join(here, 'fetch.py'), '--url', url, '--id', id,
      '--tmp', path.join(root, 'tmp'), '--music', path.join(root, 'music')]);
    videoPath = out.trim().split(/\r?\n/).filter(Boolean).pop();
    console.log('resolved video:', videoPath);
  });
}
if (!videoPath) {
  const cands = fs.readdirSync(path.join(root, 'tmp')).filter((f) => f.startsWith(id + '.') && /\.(mp4|mkv|webm)$/.test(f));
  if (cands.length) videoPath = path.join(root, 'tmp', cands[0]);
}

if (!flags.has('--skip-pose')) {
  if (!videoPath || !fs.existsSync(videoPath)) { console.error('no video to pose; run without --skip-fetch first'); process.exit(2); }
  step('2 pose (MediaPipe → landmarks)', () => {
    run(py, [path.join(here, 'pose.py'), '--video', videoPath, '--id', id, '--out', landmarks, '--model', model], { stdio: 'inherit' });
  });
}

step('3 retarget (landmarks → vrma)', () => {
  run(process.execPath, [path.join(here, 'retarget.mjs'), '--in', landmarks, '--out', vrma, '--name', id], { stdio: 'inherit' });
});

step('4 wire into the app', () => wire(id, title, artist, noAnchor));
console.log('\n✅ done. Reload the app and tap the new dance in the Set List.');
if (!fs.existsSync(mp3)) console.warn('⚠ music/' + id + '.mp3 missing (fetch skipped?)');

// ---- idempotent registration in face.js / app.js / shell-files.json ----
function insertBeforeClose(src, openMarker, line) {
  const a = src.indexOf(openMarker);
  if (a < 0) throw new Error('marker not found: ' + openMarker);
  const close = src.indexOf('];', a);
  if (close < 0) throw new Error('closing ]; not found after ' + openMarker);
  return src.slice(0, close) + line + src.slice(close);
}
function wire(id, title, artist, noAnchor) {
  // face.js DANCE_CLIPS (+ NO_ANCHOR for video dances)
  const fjP = path.join(root, 'face.js');
  let fj = fs.readFileSync(fjP, 'utf8');
  let fjChanged = false;
  if (!fj.includes(`'${id}.vrma'`)) {
    fj = insertBeforeClose(fj, 'const DANCE_CLIPS = [', `  '${id}.vrma',\n`);
    fjChanged = true; console.log('+ face.js DANCE_CLIPS');
  } else console.log('= face.js DANCE_CLIPS already has', id);
  if (noAnchor) {
    const setStart = 'const NO_ANCHOR = new Set([';
    const a = fj.indexOf(setStart);
    if (a < 0) throw new Error('NO_ANCHOR set not found in face.js');
    const segEnd = fj.indexOf('])', a);
    const seg = fj.slice(a, segEnd);
    if (!seg.includes(`'${id}'`)) {
      const ins = a + setStart.length;
      fj = fj.slice(0, ins) + `'${id}', ` + fj.slice(ins);
      fjChanged = true; console.log('+ face.js NO_ANCHOR (feet not anchored)');
    } else console.log('= face.js NO_ANCHOR already has', id);
  }
  if (fjChanged) fs.writeFileSync(fjP, fj);

  // app.js DANCES
  const ajP = path.join(root, 'app.js');
  let aj = fs.readFileSync(ajP, 'utf8');
  if (!new RegExp(`id:\\s*'${id}'`).test(aj)) {
    aj = insertBeforeClose(aj, 'const DANCES = [', `  { id: '${id}', title: ${JSON.stringify(title)}, artist: ${JSON.stringify(artist)} },\n`);
    fs.writeFileSync(ajP, aj); console.log('+ app.js DANCES');
  } else console.log('= app.js already has', id);

  // shell-files.json
  const sfP = path.join(root, 'shell-files.json');
  const sf = JSON.parse(fs.readFileSync(sfP, 'utf8'));
  let changed = false;
  for (const p of [`./assets/vrma/${id}.vrma`, `./music/${id}.mp3`]) {
    if (!sf.includes(p)) { sf.push(p); changed = true; }
  }
  if (changed) { fs.writeFileSync(sfP, JSON.stringify(sf, null, 2) + '\n'); console.log('+ shell-files.json'); }
  else console.log('= shell-files.json already has', id);
}
