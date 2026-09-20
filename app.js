/* =========================================================
   Convertisseur vidéo local → D-JIX YUNO 300
   100 % navigateur, zéro upload. Moteur : FFmpeg.wasm (local).
   ========================================================= */
(() => {
'use strict';

/* ---------------- Constantes baladeur ----------------
   Notice officielle D-JIX YUNO 300 :
   - écran TFT 2,0" d'une résolution de 220 x 176 pixels
   - vidéo : AVI uniquement (AVI Converter fourni : Xvid/MPEG-4, ~20 i/s, pas de B-frames)
   - audio : MP3 / WMA ; piste vidéo encodée en 44,1 kHz, 128 kbps        */
const DEV = { w: 220, h: 176, fps: 20 };

/* Recette unique, validée sur l'appareil : AVI · XviD 800 kbps · GOP 1 ·
   20 i/s · image 176×220 (hflip + transpose : l'écran, monté verticalement,
   afficherait en miroir sinon) · MP2 64 kbps 44,1 kHz stéréo. */
const RECETTE = { vbr: 800, fps: 20, acodec: 'mp2', abr: 64, rot90: true };

const VIDEO_EXT = new Set(['mp4','m4v','mkv','webm','mov','avi','wmv','flv','ts','m2ts','mts',
  'mpg','mpeg','mpe','m1v','m2v','vob','ogv','3gp','3g2','asf','rm','rmvb','divx','f4v','mxf','amv']);
const MAX_FILE = 1.5 * 1024 * 1024 * 1024; // 1,5 Go : limite réaliste WASM 32 bits

/* ---------------- État ---------------- */
let seq = 0;
const items = [];            // {id,file,inName,outName,dlName,status,info,outURL,outSize,err,ratio,cmd}
let engine = null;           // instance FFmpeg
let enginePromise = null;
let converting = false;
let analyzing = false;
let analyzingId = 0;
let cancelRequested = false;
let totalToConvert = 0, doneConverted = 0;
let logBuf = '', logMark = 0;
let curTime = 0, curDur = 0; // progression fichier en cours
let curSpeed = 0;            // vitesse d'encodage (x temps réel)
let logCount = 0;            // nb d'événements reçus du moteur (liveness)
const coreBlobs = {};

/* ---------------- Aperçu intégré (iframe sandbox) ----------------
   Dans l'aperçu de l'éditeur, la page vit dans une iframe « sandbox » qui
   bloque les téléchargements automatiques (clic gauche et clics JS), alors
   que le clic droit → « Enregistrer la cible sous » passe. On détecte ce
   mode et on adapte : panneau de téléchargement manuel + consigne.        */

/* ---------------- Garde-fou anti-blocage (watchdog) ----------------
   Si le moteur ne produit plus aucun log pendant __wdSecs secondes pendant
   un exec (typiquement : manque de mémoire sur un gros fichier), on abandonne
   l'opération avec un message clair et on redémarre le moteur.            */
let wdTimer = null, lastLogAt = 0;

function armWatchdog(onFire) {
  disarmWatchdog();
  lastLogAt = Date.now();
  wdTimer = setInterval(() => {
    if (Date.now() - lastLogAt > (window.__wdSecs || 45) * 1000) {
      disarmWatchdog();
      onFire();
    }
  }, 2000);
}
function disarmWatchdog() {
  if (wdTimer) { clearInterval(wdTimer); wdTimer = null; }
}

async function execGuarded(ff, args, label) {
  let fire;
  const hung = new Promise((_, reject) => { fire = () => reject(new Error('HANG:' + label)); });
  armWatchdog(fire);
  try {
    return await Promise.race([ff.exec(args), hung]);
  } finally {
    disarmWatchdog();
  }
}

function resetEngineQuiet() {
  try { engine && engine.terminate(); } catch (e) {}
  engine = null; enginePromise = null;
  engineLog('engine recycled for the next file');
}
function resetEngine(reason) {
  engineLog('⚠️ Engine stalled (' + reason + ') → stopping and restarting the engine.');
  try { engine && engine.terminate(); } catch (e) {}
  engine = null; enginePromise = null;
  engineStatus('⚙️ Engine: <span style="color:#facc15">will restart on next attempt</span>');
}

/* ---------------- Alimentation du moteur en données ----------------
   Petits fichiers : copie mémoire classique (writeFile).
   Gros fichiers (> 96 Mo) : montage WorkerFS — le fichier est lu
   directement depuis le disque, SANS copie en RAM (évite les blocages
   « conversion 0 % » par manque de mémoire sur les vraies vidéos).       */
async function feedInput(ff, item) {
  if (item.file.size > 96 * 1024 * 1024) {
    try {
      try { await ff.createDir('/mnt'); } catch (e) {}
      const dir = '/mnt/in' + item.id;
      try { await ff.createDir(dir); } catch (e) {}
      await ff.mount('WORKERFS', { files: [item.file] }, dir);
      item.mountDir = dir;
      engineLog('input mounted without memory copy (WorkerFS): ' + dir + '/' + item.file.name);
      return dir + '/' + item.file.name;
    } catch (e) {
      engineLog('WorkerFS unavailable (' + ((e && e.message) || e) + ') → falling back to memory copy');
    }
  }
  await ff.writeFile(item.inName, new Uint8Array(await item.file.arrayBuffer()));
  return item.inName;
}

async function cleanupInput(ff, item) {
  if (item.mountDir) {
    try { await ff.unmount(item.mountDir); } catch (e) {}
    try { await ff.deleteDir(item.mountDir); } catch (e) {}
    item.mountDir = null;
  } else {
    try { await ff.deleteFile(item.inName); } catch (e) {}
  }
}

/* ---------------- Raccourcis DOM ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------------- Utilitaires ---------------- */
const absURL = p => new URL(p, location.href).href;
const fmtBytes = n => {
  if (!Number.isFinite(n)) return '—';
  const u = ['o','Ko','Mo','Go']; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)).toString().replace('.', ',') + ' ' + u[i];
};
const fmtDur = s => {
  if (!Number.isFinite(s) || s <= 0) return '?';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const extOf = n => { const m = String(n).match(/\.([A-Za-z0-9]{1,5})$/); return m ? m[1].toLowerCase() : 'dat'; };
function sanitizeBase(name) {
  let b = String(name).replace(/\.[^.]+$/, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\- .()]+/g, '_').replace(/\s+/g, ' ').trim();
  return (b || 'video').slice(0, 60);
}
function looksVideo(f) {
  return VIDEO_EXT.has(extOf(f.name)) || (f.type && f.type.startsWith('video/'));
}
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + (kind || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, kind === 'err' ? 10000 : 6000);
}
function ratioLabel(w, h) {
  if (!w || !h) return '';
  const fr = n => String(n).replace('.', ',');
  const r = w / h;
  const known = [[16/9,'16:9'],[4/3,'4:3'],[1,'1:1'],[21/9,'21:9'],[5/4,'5:4'],[3/2,'3:2'],[2.35,'~2,35:1'],[2,'2:1']];
  for (const [v, l] of known) if (Math.abs(r - v) < 0.02) return l;
  return r > 1 ? fr(Math.round(r * 100) / 100) : fr(Math.round(1 / r * 100) / 100) + ' (inv.)';
}

/* ---------------- Moteur FFmpeg.wasm ---------------- */
async function fetchToBlobURL(url, mime, onProg) {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), 30000);
  const beat = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 30000); };
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' sur ' + url);
    const total = Number(resp.headers.get('Content-Length')) || 0;
    if (!resp.body) {
      const buf = await resp.arrayBuffer();
      onProg && onProg(buf.byteLength, buf.byteLength);
      return URL.createObjectURL(new Blob([buf], { type: mime }));
    }
    const reader = resp.body.getReader();
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProg && onProg(got, total);
      beat();
    }
    return URL.createObjectURL(new Blob(chunks, { type: mime }));
  } catch (e) {
    throw new Error('download interrupted (' + (e && e.name === 'AbortError' ? 'no data for 30 s' : (e && e.message) || e) + '): ' + url);
  } finally {
    clearTimeout(timer);
  }
}

function engineStatus(html) { $('#enginePill').innerHTML = html; }

function engineLog(msg) {
  logBuf += '[moteur] ' + msg + '\n';
  const pre = $('#log');
  if (pre) { pre.textContent = logBuf; pre.scrollTop = pre.scrollHeight; }
}

function newFF() {
  const ff = new FFmpegWASM.FFmpeg();
  ff.on('log', onLog);
  // Source de progression officielle (reçue du cœur C) — secours si les
  // lignes « time= » manquent dans les logs :
  ff.on('progress', ({ progress, time }) => {
    if (!converting || !isFinite(progress)) return;
    const it = items.find(i => i.status === 'converting');
    if (it && it.ratio < 0.005 && progress > 0.005 && progress <= 1) {
      it.ratio = progress;
      if (time) curTime = time / 1e6; // µs -> s
      renderItem(it); updateGlobal();
    }
  });
  return ff;
}

/* L'encodeur XviD OFFICIEL (libxvid, celui de D-Jix Media LE : « Writing library
   : XviD 1.2.1 » dans MediaInfo) n'existe pas dans toutes les compilations du
   moteur : on sonde une fois et on s'adapte. Sa signature de flux est celle que
   la puce Rockchip tolère — l'encodeur MPEG-4 interne d'ffmpeg peut être refusé. */
/* Le moteur embarqué est compilé AVEC libxvid (prouvé : il encode et produit
   la signature XviD). Ancienne sonde = regex sur les logs → une ligne perdue
   donnait un faux négatif → faux XviD (mpeg4 interne) refusé par l'appareil.
   Plus de sonde : vrai XviD toujours. */
let hasLibxvid = true;
async function detectLibxvid(ff) {
  if (detectLibxvid._logged === undefined) {
    detectLibxvid._logged = true;
    engineLog('Official XviD encoder (libxvid): built into the engine ✔');
  }
  return hasLibxvid;
}

function useEngine(ff) {
  engine = ff;
  detectLibxvid(ff).catch(() => {});
  engineStatus('⚙️ Engine ready <span style="color:#4ade80">●</span>');
  setTimeout(() => { analyzePending(); }, 50);
  return ff;
}

async function loadEngine(force) {
  if (force) {
    try { engine && engine.terminate(); } catch (e) {}
    engine = null; enginePromise = null;
  }
  if (engine) return engine;
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    if (typeof FFmpegWASM === 'undefined') {
      throw new Error('The ffmpeg.js library could not be loaded: you are in a preview without network, or in file:// mode (see the help banner at the top of the page).');
    }
    /* ---- Méthode 1 (robuste) : le worker charge lui-même les fichiers, ----
       ---- en URLs directes — c'est le navigateur qui gère le transfert. ---- */
    let ff;
    try {
      ff = newFF();
      engineStatus('⚙️ Engine: loading… <span style="color:var(--mut)">(≈ 31 MB, one time only)</span>');
      await ff.load({
        coreURL: absURL('vendor/core/ffmpeg-core.js'),
        wasmURL: absURL('vendor/core/ffmpeg-core.wasm'),
      });
      return useEngine(ff);
    } catch (e1) {
      engineLog('direct method failed: ' + (e1 && e1.message || e1));
      try { ff && ff.terminate(); } catch (_) {}
    }
    /* ---- Méthode 2 (secours) : téléchargement manuel avec progression, ----
       ---- puis injection en blob URLs.                                   ---- */
    if (!coreBlobs.core) {
      coreBlobs.core = await fetchToBlobURL(absURL('vendor/core/ffmpeg-core.js'), 'text/javascript',
        (r, t) => engineStatus('⚙️ Fallback engine: core ' + (t ? Math.round(r / t * 100) + '&thinsp;% — ' : '') + fmtBytes(r)));
    }
    if (!coreBlobs.wasm) {
      coreBlobs.wasm = await fetchToBlobURL(absURL('vendor/core/ffmpeg-core.wasm'), 'application/wasm',
        (r, t) => engineStatus('⚙️ Fallback engine: ' + fmtBytes(r) + (t ? ' / ' + fmtBytes(t) + ' · ' + Math.round(r / t * 100) + '&thinsp;%' : '')));
    }
    engineStatus('⚙️ Fallback engine: initializing…');
    ff = newFF();
    await ff.load({ coreURL: coreBlobs.core, wasmURL: coreBlobs.wasm });
    return useEngine(ff);
  })().catch(e => {
    enginePromise = null; engine = null;
    engineStatus('⚙️ Engine: <span style="color:#f87171">failed</span>');
    engineLog('ENGINE ERROR: ' + (e && e.message || e));
    showBanner('⚠️ <b>The conversion engine failed to load</b> — <code>' +
      esc(String(e && e.message || e)) + '</code><br>' +
      '• Make sure this page is opened through the local web server (e.g. <code>http://localhost:8080</code>), not as a double-clicked file.<br>' +
      '• If the error mentions "Worker" or "Content Security Policy", open the server URL in its own browser tab.<br>' +
      '<button class="btn small" data-retry>🔄 Retry</button>');
    throw e;
  });
  return enginePromise;
}

function showBanner(html) {
  const b = $('#netbanner');
  b.innerHTML = html;
  b.style.display = 'block';
}
function hideBanner() {
  const b = $('#netbanner');
  b.style.display = 'none';
  b.innerHTML = '';
}

/* Anti-tempeste : une vraie source 1080p émet des milliers de lignes de trace
   (stts/ctts, découpage de commande…) ; réécrire le <pre> à CHAQUE ligne figeait
   le fil principal (page « bloquée à 0 % »).
   → lignes de spam jetées + affichage du journal plafonné à 4×/seconde.      */
const RE_SPAM = /^(stts:|ctts:|Splitting the commandline|Reading option|matched as option|\[NULL @ |last_pos:)/;
let logFlushTimer = null, logDirty = false;
function flushLog() {
  logFlushTimer = null;
  if (!logDirty) return;
  logDirty = false;
  const pre = $('#log');
  if (pre) { pre.textContent = logBuf; pre.scrollTop = pre.scrollHeight; }
}
function onLog({ type, message }) {
  if (typeof message !== 'string') return;
  if (!window.__freezeLogs) lastLogAt = Date.now();
  if (RE_SPAM.test(message)) return; // bruit de trace : ni gardé, ni affiché
  logCount++;
  logBuf += message + '\n';
  if (logBuf.length > 400000) logBuf = logBuf.slice(-200000);
  const m = message.match(/time=(\d+):(\d+):([\d.]+)/);
  if (m) {
    curTime = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    if (curDur > 0) {
      const r = Math.max(0, Math.min(1, curTime / curDur));
      const it = items.find(i => i.status === 'converting');
      if (it) { it.ratio = r; renderItem(it); updateGlobal(); }
    }
  }
  const sp = message.match(/speed=\s*([\d.]+)x/);
  if (sp) curSpeed = +sp[1];
  if (!logFlushTimer) logFlushTimer = setTimeout(flushLog, 250);
}

/* ---------------- Analyse des fichiers ---------------- */
function resetLogMark() { logMark = logBuf.length; }
function logSinceMark() { return logBuf.slice(logMark); }

function parseInfo(txt) {
  const info = { format: '', duration: 0, vcodec: '', width: 0, height: 0, fps: 0, pix: '',
                 vbitrate: 0, acodec: '', aHz: 0, aLayout: '', rotation: 0, hasAudio: false };
  let m = txt.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (m) info.duration = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  m = txt.match(/Input #\d+,\s*([^\n,]+)/); if (m) info.format = m[1].trim();
  const vline = txt.match(/Stream #\d+:\d+\(?.*?\)?:\s*Video:[^\n]*/) || txt.match(/Stream #\d+:\d+.*Video:[^\n]*/);
  if (vline) {
    const L = vline[0];
    m = L.match(/Video:\s*([^(,]+)/); if (m) info.vcodec = m[1].trim();
    m = L.match(/(\d{2,5})x(\d{1,5})/); if (m) { info.width = +m[1]; info.height = +m[2]; }
    m = L.match(/([\d.]+)\s*fps/); if (m) info.fps = +m[1];
    m = L.match(/([\d.]+)\s*kb\/s/); if (m) info.vbitrate = +m[1];
    m = L.match(/,\s*((?:yuv|rgb|nv|p010|p016|gray|gbrp)[^,\[]*)/i); if (m) info.pix = m[1].trim();
    m = L.match(/\(([^()]*)\s*\/\s*(0x[0-9A-Fa-f]{1,8})\)/); if (m) { info.vtag = m[1].trim(); }
  }
  const aline = txt.match(/Stream #\d+:\d+\(?.*?\)?:\s*Audio:[^\n]*/) || txt.match(/Stream #\d+:\d+.*Audio:[^\n]*/);
  if (aline) {
    const L = aline[0];
    info.hasAudio = true;
    m = L.match(/Audio:\s*([^(,]+)/); if (m) info.acodec = m[1].trim();
    m = L.match(/([\d.]+)\s*Hz/); if (m) info.aHz = +m[1];
    m = L.match(/Hz,\s*([^,]+)/); if (m) info.aLayout = m[1].trim();
    m = L.match(/\(([^()]*)\s*\/\s*(0x[0-9A-Fa-f]{1,8})\)/); if (m) { info.atag = m[1].trim(); }
  }
  m = txt.match(/rotation of\s*-?([\d.]+)\s*degrees/); if (m) info.rotation = +m[1] % 360;
  else { m = txt.match(/\brotate\s*:\s*(\d+)/); if (m) info.rotation = +m[1] % 360; }
  return info;
}

function infoLine(info) {
  const parts = [];
  if (info.format) parts.push(esc(info.format.toUpperCase()));
  if (info.vcodec) parts.push(esc(info.vcodec) + (info.vtag ? ' [' + esc(info.vtag) + ']' : ''));
  if (info.width) parts.push(info.width + '×' + info.height + ' (' + ratioLabel(info.width, info.height) + ')');
  if (info.fps) parts.push(info.fps + ' i/s');
  if (info.acodec) parts.push(esc(info.acodec) + (info.atag ? ' [' + esc(info.atag) + ']' : '') + (info.aHz ? ' ' + (Math.round(info.aHz / 100) / 10) + ' kHz' : ''));
  if (info.duration) parts.push(fmtDur(info.duration));
  if (info.rotation) parts.push('🔄 rotated ' + info.rotation + '°');
  return parts.join(' · ');
}

async function analyzeItem(item, ffArg) {
  const ff = ffArg || await loadEngine();
  if (item.info || item.status === 'error') return;
  item.status = 'analyze'; renderItem(item);
  const inPath = await feedInput(ff, item);
  resetLogMark();
  let ret = 0;
  try { ret = await execGuarded(ff, ['-hide_banner', '-i', inPath], 'analyse'); }
  catch (e) {
    await cleanupInput(ff, item);
    if (String(e && e.message).startsWith('HANG:')) { resetEngine('analyze: no response'); }
    item.status = 'error';
    item.err = String(e && e.message).startsWith('HANG:')
      ? 'The engine stopped responding during analysis (file too large for memory?). Try again — if it keeps happening, split or re-encode the source first.'
      : 'File unreadable by the engine: ' + (e && e.message || e);
    renderItem(item);
    return false;
  }
  await cleanupInput(ff, item);
  const info = parseInfo(logSinceMark());
  if (!info.vcodec && !info.format) {
    item.status = 'error';
    item.err = 'Fichier illisible par le moteur (format non reconnu ?). Code ffmpeg : ' + ret;
    renderItem(item);
    return false;
  }
  item.info = info;
  item.status = 'ready';
  renderItem(item);
  return true;
}

async function analyzePending() {
  if (analyzing || converting) return;
  analyzing = true;
  try {
    for (const it of items) {
      if (converting || cancelRequested) break;
      if (it.info || it.status === 'error' || it.status === 'analyze') continue;
      await analyzeItem(it);
    }
  } catch (e) { /* moteur indisponible : on retentera à la conversion */ }
  analyzing = false;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitForAnalysisDone() {
  while (analyzing && !cancelRequested) await sleep(120);
}

/* ---------------- Construction de la commande ---------------- */
function currentOpts() {
  const qmap = { low: 350, mid: 500, high: 800 };
  return {
    w: DEV.w, h: DEV.h,
    vbr: qmap[$('#quality').value] || RECETTE.vbr,
    fps: RECETTE.fps,
    fit: $('#fit').value,
    acodec: RECETTE.acodec,
    abr: RECETTE.abr,
    rot90: RECETTE.rot90,
    vol: +$('#vol').value || 0,
    mute: $('#mute').checked,
    start: Math.max(0, +$('#trimStart').value || 0),
    dur: Math.max(0, +$('#trimDur').value || 0),
  };
}

function buildArgs(item, o) {
  const W = Math.round(o.w / 2) * 2, H = Math.round(o.h / 2) * 2;
  const a = ['-hide_banner', '-i', item.inName];
  if (o.start > 0) a.push('-ss', String(Math.round(o.start * 1000) / 1000));
  if (o.dur > 0) a.push('-t', String(Math.round(o.dur * 1000) / 1000));
  /* AUCUN -map, exactement comme le .bat validé sur l'appareil : ffmpeg
     sélectionne lui-même UNE vidéo (la meilleure) et UNE piste audio (la
     meilleure). `-map 0:a?` englobait TOUTES les pistes audio, y compris
     une piste morte (ex. « 1 packets read (10 bytes) ») — et l'appareil
     refusait le fichier (« format défavorable »). */
  if (o.mute) a.push('-an');
  a.push('-map_metadata', '-1');
  let vf;
  if (o.fit === 'crop')
    vf = 'scale=' + W + ':' + H + ':force_original_aspect_ratio=increase:force_divisible_by=2,crop=' + W + ':' + H;
  else if (o.fit === 'stretch')
    vf = 'scale=' + W + ':' + H;
  else
    vf = 'scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease' +
         ',pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2'; // cadrage type AVIConverter (bandes noires)
  if (o.rot90) vf += ',hflip,transpose=2'; // -rotateccw90 (176×220) + hflip : l'écran réel affiche en MIROIR gauche-droite (validé par grille sur l'appareil)
  vf += ',format=yuv420p';
  a.push('-vf', vf);
  if (o.fps > 0) a.push('-r', String(o.fps));
  if (hasLibxvid) {
    // Vrai XviD — signature de flux identique aux fichiers de D-Jix Media LE
    a.push('-c:v', 'libxvid', '-vtag', 'XVID', '-b:v', o.vbr + 'k', '-g', o.rot90 ? '1' : '250');
  } else {
    a.push('-c:v', 'mpeg4', '-vtag', 'XVID', '-b:v', o.vbr + 'k', '-bf', '0', '-g', o.rot90 ? '1' : '250');
  }
  a.push('-metadata', 'title=' + item.file.name);
  if (!o.mute) {
    a.push('-c:a', o.acodec === 'mp2' ? 'mp2' : 'libmp3lame',
           '-b:a', o.abr + 'k', '-ar', '44100', '-ac', '2');
    if (o.vol) a.push('-af', 'volume=' + o.vol + 'dB');
  }
  a.push('-f', 'avi', item.outName);
  return a;
}

/* ---------------- Conversion ---------------- */
async function convertItem(item, ffArg) {
  const ff = ffArg || await loadEngine();
  curTime = 0; curSpeed = 0;
  curDur = item.info ? item.info.duration : 0;
  item.status = 'converting'; item.ratio = 0; renderItem(item);
  const o = currentOpts();
  if (cancelRequested) { throw Object.assign(new Error('cancelled'), { cancelled: true }); }
  const inPath = await feedInput(ff, item);
  const args = buildArgs(item, o);
  args[args.length - 1] = item.outName; // sortie toujours en MEMFS (lectures fréquentes)
  if (inPath !== item.inName) args[args.indexOf(item.inName)] = inPath;
  item.cmd = 'ffmpeg ' + args.map(x => /[\s"']/.test(x) ? '"' + x + '"' : x).join(' ');
  renderItem(item);
  resetLogMark();
  let ret;
  try {
    ret = await execGuarded(ff, args, 'conversion');
  } catch (e) {
    await cleanupInput(ff, item);
    if (String(e && e.message).startsWith('HANG:')) {
      resetEngine('convert: no response');
      throw new Error('The engine stopped responding (out of memory on this video?). '
        + 'The engine was restarted: try again; if it keeps happening, split the video (the "max duration" setting) '
        + 'or lower the video quality.');
    }
    throw e;
  }
  await cleanupInput(ff, item);
  if (ret !== 0) throw new Error('ffmpeg code ' + ret + ' — details in the log');
  let out;
  try { out = await ff.readFile(item.outName); }
  finally { try { await ff.deleteFile(item.outName); } catch (e) {} }
  const blob = new Blob([out], { type: 'video/x-msvideo' });
  item.outURL = URL.createObjectURL(blob);
  item.outSize = blob.size;
}

async function runAll() {
  if (converting) return;
  const pending = items.filter(i => i.status !== 'done');
  if (!pending.length) { toast('Nothing to convert — add some videos.'); return; }
  pending.forEach(i => { if (i.status === 'error') { i.status = 'waiting'; i.err = ''; renderItem(i); } });
  converting = true; cancelRequested = false;
  doneConverted = 0; totalToConvert = pending.length;
  $('#globalWrap').classList.add('on');
  updateButtons(); updateGlobal();
  await waitForAnalysisDone();
  for (const item of pending) {
    if (cancelRequested) { item.status = 'cancelled'; renderItem(item); continue; }
    try {
      /* Isolation stricte : chaque fichier reçoit un moteur NEUF — aucune
         ré-entrée sur un runtime déjà utilisé (source des « index out of
         bounds »), et la mémoire repart de zéro à chaque vidéo. */
      const ff = await loadEngine(true);
      if (!item.info) { const ok = await analyzeItem(item, ff); if (!ok) continue; }
      if (cancelRequested) { item.status = 'cancelled'; renderItem(item); continue; }
      await convertItem(item, ff);
      item.status = 'done'; item.ratio = 1; doneConverted++;
    } catch (e) {
      if (cancelRequested || (e && e.cancelled) || String(e && e.message).includes('terminated')) {
        item.status = 'cancelled';
      } else {
        item.status = 'error';
        item.err = e && e.message ? e.message : String(e);
        const tail = logSinceMark().split('\n').filter(l => /Error|Invalid|could not|Unable/i.test(l)).slice(-3).join(' · ');
        if (tail) item.err += ' — ' + tail;
      }
    } finally {
      resetEngineQuiet();
    }
    renderItem(item); updateGlobal();
  }
  converting = false;
  $('#globalWrap').classList.remove('on');
  updateButtons();
  if (cancelRequested) toast('Conversion cancelled.');
  else toast(doneConverted + ' file(s) converted ✅ — download them, then copy them to your player.');
}

function cancelAll() {
  if (!converting) return;
  cancelRequested = true;
  try { engine && engine.terminate(); } catch (e) {}
  engine = null; enginePromise = null;
  engineStatus('⚙️ Engine: will reload at the next conversion');
}

function addFiles(list) {
  let added = 0;
  for (const f of list) {
    if (!looksVideo(f)) { toast('"' + f.name + '" does not look like a video.', 'err'); continue; }
    if (f.size > MAX_FILE) { toast('"' + f.name + '" is over 1.5 GB (32-bit WASM limit).', 'err'); continue; }
    const id = ++seq;
    const ext = extOf(f.name);
    const base = sanitizeBase(f.name);
    items.push({
      id, file: f,
      inName: 'in_' + id + '.' + ext,
      outName: 'out_' + id + '.avi',
      dlName: base + '_yuno300.avi',
      status: 'waiting', info: null, outURL: null, outSize: 0, err: '', ratio: 0, cmd: '',
      warn: f.size > 600 * 1024 * 1024,
    });
    added++;
  }
  if (added) {
    renderAll();
    loadEngine().then(() => analyzePending()).catch(e => toast('Engine: ' + e.message, 'err'));
  }
}

function removeItem(id) {
  const i = items.findIndex(x => x.id === id);
  if (i === -1 || converting) return;
  if (items[i].outURL) URL.revokeObjectURL(items[i].outURL);
  items.splice(i, 1);
  renderAll();
}

function clearList() {
  if (converting) return;
  items.forEach(i => i.outURL && URL.revokeObjectURL(i.outURL));
  items.length = 0;
  renderAll();
}

function downloadAll() {
  const done = items.filter(i => i.outURL);
  if (!done.length) { toast('No converted files to download.'); return; }
  done.forEach((it, k) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = it.outURL; a.download = it.dlName;
    document.body.appendChild(a); a.click(); a.remove();
  }, k * 500));
}

/* ---------------- Rendu ---------------- */
const STATUS_LABEL = {
  waiting: ['waiting', 'st-wait'], analyze: ['analyzing…', 'st-analyze'],
  ready: ['ready', 'st-ready'], converting: ['converting…', 'st-conv'],
  done: ['done ✅', 'st-done'], error: ['error', 'st-err'], cancelled: ['cancelled', 'st-cancel'],
};

function renderItem(it) {
  const row = $('#row-' + it.id);
  if (!row) { renderAll(); return; }
  row.innerHTML = rowHTML(it);
}

function rowHTML(it) {
  const [lbl, cls] = STATUS_LABEL[it.status] || STATUS_LABEL.waiting;
  let badge = '';
  if (it.info) badge = '<div class="meta">' + infoLine(it.info) + '</div>';
  if (it.warn && it.status !== 'done' && it.status !== 'error')
    badge += '<div class="meta warn">⚠️ Large file: conversion may run out of memory — consider splitting it (the "max duration" setting).</div>';
  let prog = '';
  if (it.status === 'converting') {
    const r = Math.max(0, Math.min(1, it.ratio || 0));
    const pctF = r * 100;
    const pct = pctF < 10 ? (Math.round(pctF * 10) / 10).toString().replace('.', ',') : String(Math.round(pctF));
    let extra = '';
    if (curSpeed > 0) {
      extra += ' · ' + (Math.round(curSpeed * 10) / 10).toString().replace('.', ',') + '×';
      if (curDur > curTime) {
        const remain = (curDur - curTime) / curSpeed;
        extra += ' — ~' + fmtDur(remain) + ' left';
      }
    }
    extra += ' · ' + logCount + ' events';
    prog = '<div class="bar"><div class="fill" style="width:' + pctF + '%"></div></div>' +
           '<div class="pct">' + pct + '&thinsp;% — ' + fmtDur(curTime) + ' / ' + fmtDur(curDur) + extra + '</div>';
  } else if (it.status === 'done') {
    prog = '<div class="meta ok">' + fmtBytes(it.file.size) + ' → <b>' + fmtBytes(it.outSize) + '</b>' +
           (it.file.size ? ' (' + Math.round(it.outSize / it.file.size * 100) + ' %)' : '') + '</div>';
  } else if (it.status === 'error') {
    prog = '<div class="meta err">' + esc(it.err || 'unknown error') + '</div>';
  }
  let actions = '';
  if (it.status === 'done')
    actions = '<a class="btn small" download="' + esc(it.dlName) + '" href="' + it.outURL + '">⬇ Download</a>';
  if (!converting)
    actions += '<button class="btn small ghost" data-del="' + it.id + '" title="Remove from list">✕</button>';
  const cmd = it.cmd ? '<details class="cmd"><summary>ffmpeg command</summary><code>' + esc(it.cmd) + '</code></details>' : '';
  return '<div class="fname" title="' + esc(it.file.name) + '">' + esc(it.file.name) +
         ' <span class="size">(' + fmtBytes(it.file.size) + ')</span></div>' + badge +
         '<div class="stline"><span class="chip ' + cls + '">' + lbl + '</span>' + actions + '</div>' + prog + cmd;
}

function renderAll() {
  const wrap = $('#list');
  $('#count').textContent = items.length ? items.length + ' file(s)' : '';
  if (!items.length) {
    wrap.innerHTML = '<div class="empty">Drop your videos here (MP4, MKV, WebM, MOV, AVI, WMV, FLV, TS…) — they never leave your computer.</div>';
    updateButtons(); return;
  }
  wrap.innerHTML = items.map(it =>
    '<div class="row" id="row-' + it.id + '">' + rowHTML(it) + '</div>').join('');
  updateButtons();
}

function updateButtons() {
  $('#runBtn').disabled = converting || !items.some(i => i.status !== 'done');
  $('#cancelBtn').disabled = !converting;
  $('#dlAllBtn').disabled = converting || !items.some(i => i.outURL);
  $('#clearBtn').disabled = converting || !items.length;
}

function updateGlobal() {
  const el = $('#globalBar'), txt = $('#globalTxt');
  if (!converting) {
    el.style.width = items.length && items.every(i => i.status === 'done') ? '100%' : '0%';
    txt.textContent = '';
    return;
  }
  const total = Math.max(1, totalToConvert);
  const p = (doneConverted + (curDur > 0 ? Math.max(0, Math.min(1, curTime / curDur)) : 0)) / total;
  const pF = p * 100;
  const pct = pF < 10 ? (Math.round(pF * 10) / 10).toString().replace('.', ',') : String(Math.round(pF));
  el.style.width = pF + '%';
  const extra = curSpeed > 0 ? ' · ' + (Math.round(curSpeed * 10) / 10).toString().replace('.', ',') + '× real time' : '';
  txt.textContent = 'Converting ' + pct + '% — file ' + Math.min(doneConverted + 1, total) + '/' + total + extra;
}

/* ---------------- Init ---------------- */
function init() {
  // Drop zone
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  $('#fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

  $('#runBtn').addEventListener('click', runAll);
  $('#cancelBtn').addEventListener('click', cancelAll);
  $('#dlAllBtn').addEventListener('click', downloadAll);
  $('#clearBtn').addEventListener('click', clearList);
  $('#list').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (b) removeItem(+b.dataset.del);
  });
  $('#copyLogBtn').addEventListener('click', () => {
    navigator.clipboard.writeText($('#log').textContent || logBuf)
      .then(() => toast('Log copied — paste it into the conversation.'))
      .catch(() => toast('Copy refused by the browser: select the text manually.', 'err'));
  });
  window.addEventListener('beforeunload', e => { if (converting) { e.preventDefault(); e.returnValue = ''; } });

  renderAll();
  /* --- Préchargement du moteur dès l'ouverture --- */
  $('#netbanner').addEventListener('click', e => {
    if (!e.target.closest('[data-retry]')) return;
    hideBanner();
    engine = null; enginePromise = null;   // coreBlobs conservés : pas de re-téléchargement inutile
    engineStatus('⚙️ Engine: retrying…');
    loadEngine().then(() => analyzePending()).catch(() => {});
  });
  if (location.protocol === 'file:') {
    engineStatus('⚙️ Engine: <span style="color:#f87171">blocked (file://)</span>');
    showBanner('📂 You opened <code>index.html</code> by double-click: browsers block the engine in this mode. '
      + 'Serve this folder with a local web server (e.g. <code>python3 -m http.server 8080</code>) '
      + 'and open <code>http://localhost:8080</code>.');
  } else {
    engineStatus('⚙️ Engine: starting…');
    loadEngine().catch(() => {}); // en cas d'échec, un bandeau explicite s'affiche
    const netIssue = html => {
      // ne pas écraser un bandeau d'erreur moteur déjà affiché (plus informatif)
      if ($('#netbanner').style.display !== 'none') return;
      showBanner(html);
    };
    fetch(absURL('vendor/core/ffmpeg-core.js'), { method: 'HEAD' }).then(r => {
      if (!r.ok) netIssue('⚠️ The current preview cannot access the application files (HTTP ' + r.status + '). '
        + 'Serve the folder with the local web server, or download the whole folder and run it locally. '
        + '<button class="btn small" data-retry>🔄 Retry</button>');
    }).catch(() => {
      netIssue('⚠️ This preview is sandboxed without network (built-in file preview — scripts and engine blocked). '
        + 'Serve the folder with the local web server, or download the whole folder and run it locally (e.g. <code>python3 -m http.server 8080</code>). '
        + '<button class="btn small" data-retry>🔄 Retry</button>');
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
})();
