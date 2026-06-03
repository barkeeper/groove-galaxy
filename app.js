// ============================================================
// app.js — Groove Galaxy controller.
// The 3D character (face.js) idles on its own; this file just builds the Set List,
// plays a chosen dance + its music track, and drives a little spectrum visualizer.
// No LLM, no voice — pure dance floor.
// ============================================================
import { createFace } from './face.js';

const CFG = window.__GROOVE__;
const A = CFG.assets;

// Set List — each id maps to ./assets/vrma/<id>.vrma (the dance) + ./music/<id>.mp3 (the track).
// Add a new dance by dropping both files in place and appending an entry here.
const DANCES = [
  { id: 'OtonaBlue',   title: 'Otona Blue',   artist: 'New Jeans' },
  { id: 'BabyYou',     title: 'Baby You',     artist: 'Groove Galaxy' },
  { id: 'TocaToca',    title: 'Toca Toca',    artist: 'Fly Project' },
  { id: 'RareDance_3', title: 'Sorry for Being Cute', artist: 'HoneyWorks' },
  { id: 'RareDance_5', title: 'Rhapsody of Blue Sky', artist: 'fhána' },
  { id: 'Soiree',       title: 'Soirée',                            artist: 'Hoshimachi Suisei' },
];

// Dance floors — animated video backdrops in ./assets/dancefloor/<id>.mp4 (+ <id>.jpg first-frame thumb).
// The selected one fades in behind the dancer while a dance plays, then fades back to the still image.
const FLOORS = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `floor${n}` }));

// Models — the dancer can be swapped. Each VRM lives in ./assets/models/<id>.vrm (+ <id>.jpg preview).
// `idles` is a per-model idle-animation list (./assets/vrma/...) so each character idles differently;
// null = the shared pixiv idle pool. Picking a model persists it and reloads (clean re-init of the
// rig + re-retargeting of every clip onto the new body).
const MODELS = [
  { id: 'avatar', name: 'Sakura', url: A.face,                       idles: null },
  { id: 'kamome', name: 'Kamome', url: './assets/models/kamome.vrm', idles: ['VRMA_05.vrma', 'VRMA_06.vrma', 'VRMA_02.vrma'] },
  { id: 'papeko', name: 'Papeko', url: './assets/models/papeko.vrm', idles: ['VRMA_04.vrma', 'VRMA_07.vrma', 'VRMA_03.vrma'] },
];

const MUSIC_DELAY_MS = 1200;  // let the dance wind up before the track drops in
const DEFAULT_VOLUME = 0.5;    // 50% on first run
const DEFAULT_FLOOR = 'floor1';
const DEFAULT_MODEL = 'avatar';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  faceCanvas: $('face'), faceFallback: $('faceFallback'), wave: $('wave'),
  tracks: $('tracks'), floors: $('floors'), floor: $('floor'), models: $('models'),
  muteBtn: $('muteBtn'), volume: $('volume'), themeBtn: $('themeBtn'), installBtn: $('installBtn'),
  np: $('nowplaying'), npText: $('npText'),
};

const storedVol = localStorage.getItem('groove.volume');
const settings = {
  muted: localStorage.getItem('groove.muted') === '1',
  volume: storedVol == null ? DEFAULT_VOLUME : Math.max(0, Math.min(1, +storedVol || 0)),
  floor: localStorage.getItem('groove.floor') || DEFAULT_FLOOR,
  model: localStorage.getItem('groove.model') || DEFAULT_MODEL,
};

let face = null;
let audio = null, audioTimer = null, current = null, deferredPrompt = null, floorPauseTimer = null;
let audioCtx = null, analyser = null, freqBuf = null;

// ---------- audio graph (lazy — needs a user gesture to start) ----------
function ensureAnalyser() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.connect(audioCtx.destination);
    freqBuf = new Uint8Array(analyser.frequencyBinCount);
  } catch (e) { console.warn('AudioContext unavailable:', e?.message || e); }
}

function stopMusic() {
  if (audioTimer) { clearTimeout(audioTimer); audioTimer = null; }
  if (audio) { try { audio.pause(); audio.src = ''; } catch {} audio = null; }
}

// ---------- now-playing + set-list state ----------
function markActive(id) {
  for (const li of el.tracks.querySelectorAll('.track')) {
    const playing = li.dataset.id === id;
    li.classList.toggle('is-playing', playing);
    const glyph = li.querySelector('.track__glyph .material-symbols-outlined');
    if (glyph) glyph.textContent = playing ? 'stop' : 'play_arrow';   // swap play ⇄ stop right on the row
  }
}
function setNowPlaying(d) {
  el.np.dataset.active = d ? 'true' : 'false';
  el.npText.textContent = d ? d.title : 'idle';
}

// ---------- dance-floor background (video over the still image) ----------
function floorSrc(id) { return `./assets/dancefloor/${id}.mp4`; }
// Fade the selected floor video in (called when a dance starts).
function showFloor() {
  clearTimeout(floorPauseTimer);
  const src = floorSrc(settings.floor);
  if (el.floor.getAttribute('src') !== src) el.floor.setAttribute('src', src);
  el.floor.play?.().catch((e) => console.warn('floor video failed:', e?.message || e));
  el.floor.classList.add('is-active');
}
// Fade the floor out, revealing the still image; pause once the crossfade finishes.
function hideFloor() {
  el.floor.classList.remove('is-active');
  clearTimeout(floorPauseTimer);
  floorPauseTimer = setTimeout(() => { try { el.floor.pause(); } catch {} }, 950); // matches the .9s opacity fade
}
function markFloorSelected(id) {
  for (const li of el.floors.querySelectorAll('.floor-thumb')) li.classList.toggle('is-selected', li.dataset.id === id);
}
function selectFloor(id) {
  settings.floor = id; localStorage.setItem('groove.floor', id);
  markFloorSelected(id);
  if (current) showFloor();   // a dance is playing → swap the backdrop live
}
function buildFloors() {
  el.floors.innerHTML = '';
  FLOORS.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'floor-thumb'; li.dataset.id = f.id; li.tabIndex = 0; li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `Dance floor ${i + 1}`);
    li.innerHTML =
      `<img src="./assets/dancefloor/${f.id}.jpg" alt="" loading="lazy" />` +
      `<span class="floor-thumb__no">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="floor-thumb__check material-symbols-outlined">check</span>`;
    li.addEventListener('click', () => selectFloor(f.id));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFloor(f.id); } });
    el.floors.appendChild(li);
  });
  markFloorSelected(settings.floor);
}

// ---------- model picker (swap the dancer; persists + reloads for a clean rig re-init) ----------
function markModelSelected(id) {
  for (const li of el.models.querySelectorAll('.model-thumb')) li.classList.toggle('is-selected', li.dataset.id === id);
}
function selectModel(id) {
  if (id === settings.model) return;
  localStorage.setItem('groove.model', id);
  location.reload();   // a reload re-inits the rig and re-retargets every dance/idle clip to the new body
}
function buildModels() {
  el.models.innerHTML = '';
  MODELS.forEach((m) => {
    const li = document.createElement('li');
    li.className = 'model-thumb'; li.dataset.id = m.id; li.tabIndex = 0; li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `Dancer ${m.name}`);
    li.innerHTML =
      `<span class="model-thumb__ph material-symbols-outlined" aria-hidden="true">person</span>` +
      `<img src="./assets/models/${m.id}.jpg" alt="" loading="lazy" />` +
      `<span class="model-thumb__name">${m.name}</span>` +
      `<span class="floor-thumb__check material-symbols-outlined">check</span>`;
    li.querySelector('img').addEventListener('error', (e) => { e.target.style.display = 'none'; });
    li.addEventListener('click', () => selectModel(m.id));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectModel(m.id); } });
    el.models.appendChild(li);
  });
  markModelSelected(settings.model);
}

// Stop the current dance: kill the music and crossfade the body back to the idle cycle.
function stopDance() {
  stopMusic(); current = null; markActive(null); setNowPlaying(null);
  hideFloor();
  face?.idle?.();
}

function selectDance(d) {
  if (!face) return;
  ensureAnalyser();
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  if (current === d.id) { stopDance(); return; }   // tapping the playing track stops it

  const name = face.playDance(d.id, { loop: true });
  if (!name) { console.warn('dance clip not loaded:', d.id); return; }
  stopMusic();
  current = d.id; markActive(d.id); setNowPlaying(d);
  showFloor();   // fade the picked dance floor in behind her

  audioTimer = setTimeout(() => {
    audioTimer = null;
    audio = new Audio(`./music/${encodeURIComponent(d.id)}.mp3`);
    audio.volume = settings.volume;
    audio.muted = settings.muted;
    if (analyser) { try { audioCtx.createMediaElementSource(audio).connect(analyser); } catch (e) { console.warn('analyser tap failed:', e?.message || e); } }
    audio.addEventListener('ended', stopDance);
    audio.play().catch((e) => console.warn('music failed:', e?.message || e));
  }, MUSIC_DELAY_MS);
}

// ---------- build the Set List ----------
function buildSetList() {
  const loaded = face ? new Set(face.dances()) : null;   // null until the model finishes loading
  el.tracks.innerHTML = '';
  DANCES.forEach((d, i) => {
    const li = document.createElement('li');
    li.className = 'track'; li.dataset.id = d.id; li.tabIndex = 0; li.setAttribute('role', 'button');
    li.innerHTML =
      `<span class="track__no">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="track__glyph"><span class="material-symbols-outlined">play_arrow</span></span>` +
      `<span class="track__meta"><span class="track__title">${d.title}</span><span class="track__artist">${d.artist}</span></span>` +
      `<span class="track__eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
    if (loaded && !loaded.has(d.id)) { li.classList.add('is-missing'); li.title = 'clip not loaded'; }
    else {
      li.addEventListener('click', () => selectDance(d));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDance(d); } });
    }
    el.tracks.appendChild(li);
  });
}

// ---------- spectrum visualizer (reuses the music analyser) ----------
const waveCtx = el.wave.getContext('2d');
function drawWave() {
  requestAnimationFrame(drawWave);
  const c = el.wave, dpr = Math.min(window.devicePixelRatio, 2), w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
  waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0); waveCtx.clearRect(0, 0, w, h);
  if (!analyser) return;                       // nothing playing yet → empty (transparent) strip
  analyser.getByteFrequencyData(freqBuf);
  const css = getComputedStyle(document.documentElement);
  const amber = css.getPropertyValue('--amber').trim() || '#f0a93b', teal = css.getPropertyValue('--teal').trim() || '#46d6c0';
  const bars = 48, step = Math.max(1, Math.floor(freqBuf.length / bars)), bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const v = freqBuf[i * step] / 255, bh = Math.max(2, v * h);
    waveCtx.fillStyle = i % 2 ? teal : amber; waveCtx.globalAlpha = 0.3 + v * 0.7;
    waveCtx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
  }
  waveCtx.globalAlpha = 1;
}

// ---------- mute / theme / install ----------
// Mute and volume are independent: the slider sets the level, the button silences it.
// Glyph reflects both (off when muted or at zero, down below 50%, up otherwise).
function muteGlyph() { return (settings.muted || settings.volume === 0) ? 'volume_off' : settings.volume < 0.5 ? 'volume_down' : 'volume_up'; }
function applyAudio() {
  if (audio) { audio.muted = settings.muted; audio.volume = settings.volume; }
  el.muteBtn.querySelector('.muteglyph').textContent = muteGlyph();
}
el.volume.value = Math.round(settings.volume * 100);
el.volume.addEventListener('input', () => {
  settings.volume = +el.volume.value / 100;
  localStorage.setItem('groove.volume', String(settings.volume));
  if (settings.muted && settings.volume > 0) { settings.muted = false; localStorage.setItem('groove.muted', '0'); }  // dragging up un-mutes
  applyAudio();
});
el.muteBtn.addEventListener('click', () => { settings.muted = !settings.muted; localStorage.setItem('groove.muted', settings.muted ? '1' : '0'); applyAudio(); });
applyAudio();

const updateThemeIcon = () => { el.themeBtn.querySelector('.material-symbols-outlined').textContent = document.documentElement.getAttribute('data-theme') === 'light' ? 'light_mode' : 'dark_mode'; };
el.themeBtn.addEventListener('click', () => { const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); localStorage.setItem('groove.theme', n); updateThemeIcon(); });
updateThemeIcon();

// PWA install via our own header button. We intentionally do NOT call preventDefault() here:
// on desktop there's no native mini-infobar to suppress, and calling it only makes Chrome log
// "Banner not shown… must call prompt()". We just stash the event and fire prompt() on click.
window.addEventListener('beforeinstallprompt', (e) => { deferredPrompt = e; el.installBtn.hidden = false; });
el.installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  const p = deferredPrompt; deferredPrompt = null; el.installBtn.hidden = true;
  try { p.prompt(); await p.userChoice; } catch (e) { console.warn('install prompt unavailable:', e?.message || e); }
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; el.installBtn.hidden = true; });

// ---------- character ----------
window.addEventListener('resize', () => face?.resize());
el.faceCanvas.addEventListener('pointermove', (e) => { const r = el.faceCanvas.getBoundingClientRect(); face?.setGazeTarget(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); });
el.faceCanvas.addEventListener('pointerleave', () => face?.setGazeTarget(0, 0));

// ---------- boot ----------
buildSetList();   // show the list immediately (clicks no-op until the model is ready)
buildModels();    // dancer picker
buildFloors();    // dance-floor picker
drawWave();
(async () => {
  try {
    const model = MODELS.find((m) => m.id === settings.model) || MODELS[0];
    face = await createFace({ canvas: el.faceCanvas, modelUrl: model.url, idleFiles: model.idles });
    buildSetList();   // re-render now that we know which clips actually loaded
  } catch (e) {
    console.error('Character init failed:', e);
    el.faceFallback.hidden = false;
    el.faceFallback.innerHTML = 'The 3D dancer needs WebGL2.<br/>Try a recent Chrome, Edge, or Firefox.';
  }
})();
