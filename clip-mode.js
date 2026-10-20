// "Your clip" tab for BRACE Marker: label the moves in your own video the same way as Watch & name.
// Set In/Out, name the move from the dictionary, save. Optional: track the body with MediaPipe Pose
// (runs in the browser, nothing uploaded) to draw the skeleton and suggest where each move in your
// typed sequence sits. It can't recognise a move by name on its own; your names are the labels.
// Local prototype only (the shared page can't load the tracking model).
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]; // MediaPipe 33 -> COCO 17
const FPS = 15;
const $ = id => document.getElementById(id);
const norm = s => String(s || '').trim().toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MOVES = window.MOVES || [];
const findMove = n => { const k = norm(n); return k ? MOVES.find(m => [m.name, ...m.aliases].some(x => norm(x) === k)) : null; };
const canon = n => { const m = findMove(n); return m ? m.name : String(n).trim(); };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const COLV = { Toprock: '--toprock', Footwork: '--footwork', Power: '--power', Freeze: '--freeze' };

const vid = $('clipVideo'), cv = $('clipCanvas'), ctx = cv.getContext('2d'), tl = $('clipTl'), tctx = tl.getContext('2d');
let landmarker = null, track = null, progress = null, recog = null, moves = [], sel = { in: null, out: null }, editing = -1, playing = false, showSkel = true, showLabels = true;
const status = t => { $('clipStatus').textContent = t; };
const dur = () => vid.duration || 0;
const fmt = t => `${t.toFixed(1)}s`;

// ---------- saving: per clip, in this browser ----------
let currentClip = '';
const clipKey = () => 'brace-marker-clip:' + currentClip;
function save() { window.__clip = { track, moves }; try { localStorage.setItem(clipKey(), JSON.stringify(moves)); } catch (e) {} window.dispatchEvent(new Event('brace-sessions-changed')); if (typeof renderSessions === 'function') renderSessions(); if (typeof renderCombos === 'function') renderCombos(); }
function restore() { try { const m = JSON.parse(localStorage.getItem(clipKey())); moves = Array.isArray(m) ? m.filter(x => typeof x.t0 === 'number') : []; } catch (e) { moves = []; } window.__clip = { track, moves }; }

// ---------- dictionary info, like Watch & name ----------
function showInfo(name) {
  const el = $('clipInfo'), m = findMove(name);
  if (!m) { el.hidden = true; return; }
  const who = [m.created_by.length ? `created by <b>${esc(m.created_by.join(', '))}</b>` : '', m.taught_by.length ? `learned from <b>${esc(m.taught_by.join(', '))}</b> (frague)` : ''].filter(Boolean).join(' · ');
  el.innerHTML = `<b>${esc(m.name)}</b> · ${esc(m.section || m.col)}${m.aliases.length ? ` · aka ${esc(m.aliases.join(', '))}` : ''}${who ? `<br>${who}` : ''}` + (m.wiki ? `<br>${esc(m.wiki.text)}` : '');
  el.hidden = false;
}
$('clipName').addEventListener('input', () => showInfo($('clipName').value));
$('clipName').addEventListener('change', () => { const m = findMove($('clipName').value); if (m) { $('clipName').value = m.name; $('clipCol').value = m.col; } showInfo($('clipName').value); });

// ---------- named moves list ----------
function renderMoves() {
  const el = $('clipMoves');
  moves.sort((a, b) => a.t0 - b.t0);
  if (!moves.length) { el.innerHTML = '<div class="note">Nothing yet. Set In and Out around a move, name it, save.</div>'; return; }
  el.innerHTML = '';
  moves.forEach((m, k) => {
    const d = document.createElement('div'); d.className = 'mitem'; if (k === editing) d.style.borderColor = css('--accent');
    d.innerHTML = `<span><b>${esc(m.name)}</b>${m.variant ? ` · <i>${esc(m.variant)}</i>` : ''}${m.suggested ? ' <span class="note">(suggested)</span>' : ''}<br><span class="note">${fmt(m.t0)}–${fmt(m.t1)} · held ${(m.t1 - m.t0).toFixed(1)}s</span></span><span class="x" title="delete">✕</span>`;
    d.onclick = e => {
      if (e.target.classList.contains('x')) { moves.splice(k, 1); if (editing === k) stopEditing(); save(); renderMoves(); draw(); return; }
      editing = k; sel = { in: m.t0, out: m.t1 }; $('clipName').value = m.name; $('clipCol').value = m.col || 'Freeze'; $('clipVar').value = m.variant || '';
      showInfo(m.name); $('clipUpdate').hidden = false; seekTo(m.t0); renderMoves();
    };
    el.appendChild(d);
  });
}
function stopEditing() { editing = -1; $('clipUpdate').hidden = true; }
function formMove() {
  const name = canon($('clipName').value); if (!name) { status('Name the move first.'); return null; }
  if (sel.in == null || sel.out == null) { status('Set In and Out around the move first.'); return null; }
  return { name, col: $('clipCol').value, variant: $('clipVar').value.trim(), t0: Math.min(sel.in, sel.out), t1: Math.max(sel.in, sel.out) };
}
$('clipSave').onclick = () => { const m = formMove(); if (!m) return; moves.push(m); stopEditing(); sel = { in: null, out: null }; $('clipVar').value = ''; save(); renderMoves(); draw(); status(`Saved: ${m.name}.`); };
$('clipUpdate').onclick = () => { const m = formMove(); if (!m || editing < 0) return; moves[editing] = m; stopEditing(); sel = { in: null, out: null }; save(); renderMoves(); draw(); status(`Updated: ${m.name}.`); };
$('clipCopy').onclick = () => { const t = moves.map(m => `${m.name}${m.variant ? ' (' + m.variant + ')' : ''}\t${m.t0.toFixed(2)}\t${m.t1.toFixed(2)}`).join('\n'); navigator.clipboard.writeText(t).then(() => status('Timings copied.'), () => status(t)); };

// ---------- playback + marking ----------
function seekTo(t) { vid.currentTime = Math.max(0, Math.min(dur(), t)); draw(); }
function setPlay(p) {
  playing = p; $('clipPlay').textContent = p ? '❚❚ Pause' : '▶ Play';
  if (!p) { vid.pause(); return; }
  if (sel.in != null && sel.out != null) { const lo = Math.min(sel.in, sel.out), hi = Math.max(sel.in, sel.out); if (vid.currentTime < lo || vid.currentTime >= hi) vid.currentTime = lo; }
  vid.play();
}
const act = {
  in: () => { sel.in = vid.currentTime; if (sel.out != null && sel.out < sel.in) sel.out = null; draw(); },
  out: () => { sel.out = vid.currentTime; if (sel.in == null) sel.in = 0; draw(); },
};
$('clipPlay').onclick = () => setPlay(!playing);
$('clipIn').onclick = act.in; $('clipOut').onclick = act.out;
$('clipClear').onclick = () => { sel = { in: null, out: null }; stopEditing(); renderMoves(); draw(); };
$('clipSpeed').onchange = () => { vid.playbackRate = +$('clipSpeed').value; };
$('clipSkel').onclick = e => { showSkel = !showSkel; e.currentTarget.classList.toggle('on', showSkel); draw(); };
$('clipLabels').onclick = e => { showLabels = !showLabels; e.currentTarget.classList.toggle('on', showLabels); draw(); };
cv.onclick = () => setPlay(!playing);
let dragging = false;
const tlSeek = e => { const r = tl.getBoundingClientRect(); setPlay(false); seekTo((e.clientX - r.left) / r.width * dur()); };
tl.addEventListener('mousedown', e => { dragging = true; tlSeek(e); });
window.addEventListener('mousemove', e => { if (dragging) tlSeek(e); });
window.addEventListener('mouseup', () => dragging = false);
document.addEventListener('keydown', e => {
  if (!$('v-clip').classList.contains('on') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); setPlay(!playing); }
  else if (k === 'arrowright' || k === 'arrowleft') { setPlay(false); seekTo(vid.currentTime + (k === 'arrowright' ? 1 : -1) / 30); }
  else if (k === 'i') act.in(); else if (k === 'o') act.out();
});
vid.ontimeupdate = () => { if (playing && sel.in != null && sel.out != null && vid.currentTime > Math.max(sel.in, sel.out)) vid.currentTime = Math.min(sel.in, sel.out); };
vid.onended = () => setPlay(false);

// ---------- drawing ----------
const BL = [[5, 7], [7, 9], [11, 13], [13, 15], [5, 11]], BR = [[6, 8], [8, 10], [12, 14], [14, 16], [6, 12]];
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
const colourOf = m => css(COLV[m.col] || '--freeze');
function draw() {
  const W = cv.width = vid.videoWidth || 720, H = cv.height = vid.videoHeight || 1280, t = vid.currentTime, u = W / 720;
  ctx.clearRect(0, 0, W, H);
  const f = track && track.frames[Math.min(track.frames.length - 1, Math.round(t * FPS))];
  if (f && showSkel) {
    ctx.lineCap = 'round';
    const line = (a, b, c) => { if (f[a][2] < 0.2 || f[b][2] < 0.2) return; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 9 * u; ctx.beginPath(); ctx.moveTo(f[a][0], f[a][1]); ctx.lineTo(f[b][0], f[b][1]); ctx.stroke(); ctx.strokeStyle = c; ctx.lineWidth = 5 * u; ctx.stroke(); };
    BL.forEach(([a, b]) => line(a, b, '#ffffff')); BR.forEach(([a, b]) => line(a, b, '#7ea2ff')); line(5, 6, '#ffffff'); line(11, 12, '#ffffff');
  }
  if (progress) {
    const bw = W * 0.76, bx = (W - bw) / 2, by = H * 0.46;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; rr(ctx, bx - 24 * u, by - 70 * u, bw + 48 * u, 130 * u, 20 * u); ctx.fill();
    ctx.font = `600 ${26 * u}px Inter, Helvetica, sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText(progress.label, bx, by - 24 * u);
    ctx.fillStyle = 'rgba(255,255,255,.2)'; rr(ctx, bx, by, bw, 18 * u, 9 * u); ctx.fill();
    ctx.fillStyle = css('--accent'); rr(ctx, bx, by, Math.max(18 * u, bw * progress.v), 18 * u, 9 * u); ctx.fill();
    drawTL(); return;
  }
  if (recog && showLabels) { drawRecog(t, W, H, u); drawTL(); return; }
  const list = moves, cur = list.findIndex(m => t >= m.t0 && t <= m.t1);
  if (showLabels && cur >= 0) {
    const m = list[cur], pop = Math.min(1, (t - m.t0) / 0.25);
    bigTitle(m, m.name.toUpperCase(), [`${cur + 1} of ${list.length} · held ${Math.max(0, Math.min(t, m.t1) - m.t0).toFixed(1)}s`, m.variant], 36 * u, 76 * u, W, u, 56, pop, 0.85 + 0.15 * pop);
  } else if (showLabels && list.length && t > list[0].t0 && t < list[list.length - 1].t1) {
    ctx.font = `500 ${26 * u}px Inter, Helvetica, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText('transition', 36 * u, 76 * u);
  }
  if (showLabels && list.length) {
    ctx.font = `600 ${22 * u}px Inter, Helvetica, sans-serif`;
    const pad = 14 * u, gap = 10 * u, rowH = 44 * u;
    const chips = list.map((m, k) => { const label = clipLabel(m.name, W - 48 * u - 2 * pad); return { k, label, w: ctx.measureText(label).width + 2 * pad }; });
    const rows = [[]]; let rw = 0;
    chips.forEach(c => { if (rw + c.w > W - 48 * u && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push(c); rw += c.w + gap; });
    let y = H - 24 * u - rows.length * (rowH + gap);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; rr(ctx, 12 * u, y - 12 * u, W - 24 * u, rows.length * (rowH + gap) + 16 * u, 16 * u); ctx.fill();
    rows.forEach(r => { let x = 24 * u; r.forEach(c => {
      const m = list[c.k], done = t > m.t1, now = c.k === cur, col = colourOf(m);
      rr(ctx, x, y, c.w, rowH, rowH / 2);
      if (now) { ctx.fillStyle = col; ctx.fill(); } else { ctx.strokeStyle = done ? col : 'rgba(255,255,255,.35)'; ctx.lineWidth = 2.5 * u; ctx.stroke(); }
      ctx.fillStyle = now ? '#111' : done ? col : 'rgba(255,255,255,.45)'; ctx.fillText(c.label, x + pad, y + rowH * 0.66);
      x += c.w + gap; }); y += rowH + gap; });
  }
  drawTL();
}
// long names: wrap onto up to 3 lines, shrinking the text until it fits the frame
function fitText(text, maxW, size, weight, maxLines = 3) {
  for (let sz = size; ; sz *= 0.9) {
    ctx.font = `${weight} ${sz}px Inter, Helvetica, sans-serif`;
    const lines = [''];
    for (const w of text.split(/\s+/)) { const tryL = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w; if (ctx.measureText(tryL).width <= maxW || !lines[lines.length - 1]) lines[lines.length - 1] = tryL; else lines.push(w); }
    if ((lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) || sz < size * 0.45) return { lines, sz, w: Math.max(...lines.map(l => ctx.measureText(l).width)) };
  }
}
const clipLabel = (t, maxW) => { if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t.trimEnd() + '…'; };
function bigTitle(m, title, sub, x, y, W, u, size, alpha, scale) {
  const maxW = W - x - 54 * u, T = fitText(title, maxW, size * u, 700), lh = T.sz * 1.08;
  ctx.font = `500 ${24 * u}px Inter, Helvetica, sans-serif`;
  const subs = sub.filter(Boolean).flatMap(v => fitText(v, maxW, 24 * u, 500, 2).lines), sw = Math.max(0, ...subs.map(l => ctx.measureText(l).width));
  const tw = Math.max(T.w, sw, 220 * u), h = T.sz * 0.95 + (T.lines.length - 1) * lh + subs.length * 34 * u + 30 * u;
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(ctx, -18 * u, -T.sz - 4 * u, tw + 36 * u, h + 4 * u, 18 * u); ctx.fill();
  ctx.font = `700 ${T.sz}px Inter, Helvetica, sans-serif`; ctx.fillStyle = colourOf(m);
  T.lines.forEach((l, i) => ctx.fillText(l, 0, i * lh));
  let yy = (T.lines.length - 1) * lh + 40 * u; ctx.font = `500 ${24 * u}px Inter, Helvetica, sans-serif`;
  subs.forEach((l, i) => { ctx.fillStyle = i ? 'rgba(255,255,255,.75)' : '#fff'; ctx.fillText(l, 0, yy); yy += 34 * u; });
  ctx.restore();
}
function drawTL() {
  const W = tl.width, H = tl.height, D = dur() || 1, X = t => t / D * W;
  tctx.clearRect(0, 0, W, H); tctx.fillStyle = css('--line'); tctx.fillRect(0, 14, W, 12);
  moves.forEach(m => { tctx.fillStyle = colourOf(m); tctx.fillRect(X(m.t0), 14, Math.max(2, X(m.t1) - X(m.t0)), 12); });
  if (sel.in != null) { const b = sel.out ?? vid.currentTime; tctx.fillStyle = css('--accent'); tctx.globalAlpha = .3; tctx.fillRect(X(Math.min(sel.in, b)), 0, Math.abs(X(b) - X(sel.in)), H); tctx.globalAlpha = 1; }
  tctx.fillStyle = css('--ink'); tctx.fillRect(X(vid.currentTime) - 1.5, 0, 3, H);
}
(function loop() { if ($('v-clip').classList.contains('on')) draw(); requestAnimationFrame(loop); })();

// ---------- optional: body tracking + suggestions ----------
async function getLandmarker() {
  if (landmarker) return landmarker;
  status('Loading the body tracker (first time takes a few seconds)…');
  const v = await import(`${MP}/vision_bundle.mjs`);
  const fs = await v.FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const opts = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO', numPoses: 3, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
  try { landmarker = await v.PoseLandmarker.createFromOptions(fs, opts('GPU')); } catch (e) { landmarker = await v.PoseLandmarker.createFromOptions(fs, opts('CPU')); }
  return landmarker;
}
const seekWait = t => new Promise(r => { vid.addEventListener('seeked', r, { once: true }); vid.currentTime = t; });
async function trackBody() {
  if (!vid.src) return status('Load a video first.');
  const lm = await getLandmarker(); setPlay(false);
  const D = dur(), W = vid.videoWidth, H = vid.videoHeight, n = Math.ceil(D * FPS), slots = new Array(n).fill(undefined);
  const off = document.createElement('canvas'); off.width = W; off.height = H; const octx = off.getContext('2d');
  const centre = f => [(f[11][0] + f[12][0]) / 2, (f[11][1] + f[12][1]) / 2], size = f => { const xs = f.map(p => p[0]), ys = f.map(p => p[1]); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
  let prev = null, lastTs = 0;
  // Play the clip through and sample frames as they are actually shown: jumping around with seeks can
  // leave the picture stale in this browser, which feeds the tracker the same frame over and over.
  const rate = vid.playbackRate, wasMuted = vid.muted; vid.playbackRate = 1; vid.muted = true; vid.currentTime = 0;
  await new Promise((resolve, reject) => {
    const onFrame = (now, meta) => {
      const t = meta.mediaTime, i = Math.min(n - 1, Math.round(t * FPS));
      if (slots[i] === undefined) {
        octx.drawImage(vid, 0, 0, W, H);
        const ts = Math.max(lastTs + 1, Math.round(t * 1000)); lastTs = ts;
        const r = lm.detectForVideo(off, ts), cands = (r.landmarks || []).map(p => COCO.map(j => [p[j].x * W, p[j].y * H, p[j].visibility ?? 1]));
        // several people in frame: start with the biggest body, then follow whoever is closest to it
        const pick = !cands.length ? null : prev ? cands.reduce((a, b) => Math.hypot(...centre(a).map((v, k) => v - centre(prev)[k])) <= Math.hypot(...centre(b).map((v, k) => v - centre(prev)[k])) ? a : b) : cands.reduce((a, b) => size(a) >= size(b) ? a : b);
        slots[i] = pick; if (pick) prev = pick;
        progress = { v: t / D, label: `Tracking the body… ${Math.round(t / D * 100)}%` }; if (i % 5 === 0) status(progress.label);
      }
      if (vid.ended || t >= D - 1.5 / FPS) { vid.pause(); resolve(); } else vid.requestVideoFrameCallback(onFrame);
    };
    vid.addEventListener('ended', () => resolve(), { once: true });
    vid.requestVideoFrameCallback(onFrame);
    vid.play().catch(reject);
  });
  vid.playbackRate = rate; vid.muted = wasMuted;
  // fill any frames the sampler skipped with their nearest tracked neighbour
  const frames = slots.map((f, i) => { if (f !== undefined) return f; for (let d = 1; d < n; d++) { if (slots[i - d]) return slots[i - d]; if (slots[i + d]) return slots[i + d]; } return null; });
  progress = null;
  track = { fps: FPS, w: W, h: H, duration: D, frames, missing: frames.filter(f => !f).length, sampled: slots.filter(f => f !== undefined).length };
  window.__clip = { track, moves }; vid.currentTime = 0; setPlay(false); saveTrack();
  status(`Tracked. The tracker lost you on ${track.missing} of ${frames.length} frames. Name the moves, or type your sequence and press Suggest.`);
}
function suggest() {
  const seq = $('clipSeq').value.split(/>|\n|,|→/).map(s => s.trim()).filter(Boolean);
  if (!track) return status('Track your body first, then suggest.');
  if (seq.length < 2) return status('Type at least two moves, in order.');
  const F = track.frames.map((f, i, a) => f || a.slice(0, i).reverse().find(Boolean) || a.find(Boolean));
  const mid = (f, a, b) => [(f[a][0] + f[b][0]) / 2, (f[a][1] + f[b][1]) / 2];
  const torsos = F.map(f => { const s = mid(f, 5, 6), h = mid(f, 11, 12); return Math.hypot(s[0] - h[0], s[1] - h[1]); }).sort((a, b) => a - b);
  const torso = torsos[Math.floor(torsos.length / 2)] || 1;
  const tilt = f => { const s = mid(f, 5, 6), h = mid(f, 11, 12); return Math.acos(Math.max(-1, Math.min(1, -(s[1] - h[1]) / (Math.hypot(s[0] - h[0], s[1] - h[1]) || 1)))) * 180 / Math.PI; };
  const active = F.map(f => tilt(f) > 35), s0 = active.indexOf(true), s1 = active.lastIndexOf(true);
  const J = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const desc = F.map(f => { const c = mid(f, 11, 12); return J.flatMap(j => [(f[j][0] - c[0]) / torso, (f[j][1] - c[1]) / torso]); });
  const Dm = desc[0].length, N = s1 - s0 + 1, K = Math.min(seq.length, Math.floor(N / 3));
  // split the off-your-feet stretch into K pieces where the body's shape is most constant (optimal piecewise fit)
  const P = [new Array(Dm).fill(0)], Q = [0];
  for (let i = 0; i < N; i++) { const v = desc[s0 + i]; P.push(P[i].map((x, d) => x + v[d])); Q.push(Q[i] + v.reduce((a, x) => a + x * x, 0)); }
  const cost = (a, b) => { const n = b - a; let c = Q[b] - Q[a]; for (let d = 0; d < Dm; d++) { const m = P[b][d] - P[a][d]; c -= m * m / n; } return c; };
  const best = Array.from({ length: K + 1 }, () => new Array(N + 1).fill(Infinity)), arg = Array.from({ length: K + 1 }, () => new Array(N + 1).fill(0));
  best[0][0] = 0;
  for (let k = 1; k <= K; k++) for (let b = k * 2; b <= N; b++) for (let a = (k - 1) * 2; a <= b - 2; a++) { const v = best[k - 1][a] + cost(a, b); if (v < best[k][b]) { best[k][b] = v; arg[k][b] = a; } }
  const cuts = []; let b = N; for (let k = K; k > 0; k--) { const a = arg[k][b]; cuts.unshift([a, b]); b = a; }
  moves = cuts.map(([a, b], k) => {
    const idx = []; for (let i = s0 + a; i < s0 + b; i++) idx.push(i);
    const avg = desc[0].map((_, d) => idx.reduce((s, i) => s + desc[i][d], 0) / idx.length);
    const dist = idx.map(i => Math.hypot(...desc[i].map((x, d) => x - avg[d])));
    const lim = [...dist].sort((x, y) => x - y)[Math.floor(dist.length * 0.6)] * 1.15;
    let bestRun = [idx[0], idx[0]], run = null;
    idx.forEach((i, n) => { if (dist[n] <= lim) { run = run ? [run[0], i] : [i, i]; if (run[1] - run[0] > bestRun[1] - bestRun[0]) bestRun = run.slice(); } else run = null; });
    const m = findMove(seq[k]);
    return { name: canon(seq[k]), col: m ? m.col : 'Freeze', variant: '', t0: bestRun[0] / FPS, t1: (bestRun[1] + 1) / FPS, suggested: true };
  });
  save(); renderMoves(); draw();
  status(`Suggested ${moves.length} moves. It's a first guess: click each one, check it, and fix In/Out or the name.`);
}
$('clipTrack').onclick = () => trackBody().catch(err => status('The tracker could not run here: ' + err.message));
$('clipSuggest').onclick = suggest;

// ---------- loading ----------
function saveTrack() {
  if (!track) return;
  const compact = { ...track, frames: track.frames.map(f => f && f.map(p => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2] * 10) / 10])) };
  try { localStorage.setItem('brace-marker-track:' + currentClip, JSON.stringify(compact)); } catch (e) { status('Tracking is too big to keep in this browser; it will need re-running next time.'); }
  window.dispatchEvent(new Event('brace-sessions-changed'));
}
function restoreTrack() { try { const t = JSON.parse(localStorage.getItem('brace-marker-track:' + currentClip)); track = t && t.frames ? t : null; } catch (e) { track = null; } }
function loadSrc(src, id, then) {
  currentClip = id || src.split('/').pop().split('?')[0];
  track = null; recog = null; progress = null; sel = { in: null, out: null }; stopEditing(); vid.src = src; renderRecog();
  vid.onloadedmetadata = () => {
    $('clipStage').style.aspectRatio = `${vid.videoWidth} / ${vid.videoHeight}`; restore(); restoreTrack(); renderMoves(); renderSessions(); renderCombos(); draw();
    status(`${sessLabel(currentClip)}: ${dur().toFixed(1)}s${moves.length ? `, ${moves.length} moves named` : ''}${track ? ', skeleton ready' : ''}. Set In and Out around a move, name it, save.`);
    if (then) then();
  };
}

// ---------- sessions: groups of clips, kept in this browser ----------
const SKEY = 'brace-marker-sessions';
const sessions = () => { try { return JSON.parse(localStorage.getItem(SKEY)) || []; } catch (e) { return []; } };
const setSessions = v => { try { localStorage.setItem(SKEY, JSON.stringify(v)); } catch (e) {} };
if (!sessions().length) setSessions([{ id: 's-2026-10-20', name: 'Session · 20 Oct 2026', clips: [
  { file: 'clips/freeze-stack-2026-10-20.mp4', label: 'Freeze stack' },
  { file: 'clips/clip-b-2026-10-20.mp4', label: 'Group session 1' },
  { file: 'clips/clip-c-2026-10-20.mp4', label: 'Group session 2' }] }]);
const idOf = file => file.split('/').pop();
function sessLabel(id) { for (const s of sessions()) for (const c of s.clips) if (idOf(c.file) === id) return c.label; return id; }
let openSess = sessions()[0]?.id;
function renderSessions() {
  const el = $('sessList'); el.innerHTML = '';
  sessions().forEach(s => {
    const head = document.createElement('div'); head.className = 'grp'; head.style.cursor = 'pointer';
    head.innerHTML = `<span data-name>${openSess === s.id ? '▾' : '▸'} ${esc(s.name)}</span><span><span class="ren" title="rename session" style="cursor:pointer;padding:0 6px">✎</span><span class="count">${s.clips.length}</span></span>`;
    head.onclick = () => { openSess = openSess === s.id ? null : s.id; renderSessions(); };
    head.querySelector('.ren').onclick = e => { e.stopPropagation(); renameInline(head.querySelector('[data-name]'), s.name, v => { const S = sessions(); S.find(x => x.id === s.id).name = v; setSessions(S); }); };
    el.appendChild(head);
    if (openSess !== s.id) return;
    s.clips.forEach(c => {
      const id = idOf(c.file); let n = 0; try { n = (JSON.parse(localStorage.getItem('brace-marker-clip:' + id)) || []).length; } catch (e) {}
      const d = document.createElement('div'); d.className = 'item' + (id === currentClip ? ' on' : '');
      d.innerHTML = `<span class="ren" title="rename clip" style="float:right;cursor:pointer;padding:0 4px">✎</span><div style="min-width:0"><b data-name>${esc(c.label)}</b><div class="meta">${n ? `${n} moves named` : 'nothing named yet'}${localStorage.getItem('brace-marker-track:' + id) ? ' · skeleton ready' : ''}</div></div>`;
      d.onclick = () => openClip(c.file);
      d.querySelector('.ren').onclick = e => { e.stopPropagation(); renameInline(d.querySelector('[data-name]'), c.label, v => { const S = sessions(); S.find(x => x.id === s.id).clips.find(x => x.file === c.file).label = v; setSessions(S); }); };
      el.appendChild(d);
    });
  });
}
// click ✎ → the name becomes a text box; Enter or clicking away saves, Esc cancels
function renameInline(el, cur, apply) {
  const i = document.createElement('input'); i.value = cur; i.style.cssText = 'padding:2px 6px;font:inherit;width:100%;text-transform:none;letter-spacing:0';
  i.onclick = e => e.stopPropagation();
  let done = false; const finish = ok => { if (done) return; done = true; const v = i.value.trim(); if (ok && v && v !== cur) { apply(v); window.dispatchEvent(new Event('brace-sessions-changed')); if (currentClip) status(`Renamed to "${v}".`); } renderSessions(); renderCombos(); };
  i.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); };
  i.onblur = () => finish(true);
  el.replaceWith(i); i.focus(); i.select();
}
async function openClip(file, t0, t1) {
  const id = idOf(file);
  const then = () => { if (t0 != null) { sel = { in: t0, out: t1 }; seekTo(t0); const k = moves.findIndex(m => Math.abs(m.t0 - t0) < 0.01); if (k >= 0) $('clipMoves').children[k]?.click(); } };
  if (file.startsWith('upload:')) { const blob = await idbGet(file); if (!blob) return status('That upload is no longer in this browser. Add it again.'); loadSrc(URL.createObjectURL(blob), id, then); }
  else if (id === currentClip && vid.src) then(); else loadSrc(file, id, then);
}
$('sessNew').onclick = () => { const S = sessions(), d = new Date(); const s = { id: 's-' + d.getTime(), name: `Session · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`, clips: [] }; S.unshift(s); setSessions(S); openSess = s.id; renderSessions(); status('New session. Add clips to it.'); };
// uploaded videos go into IndexedDB so they're still here next time
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('brace-marker', 1); r.onupgradeneeded = () => r.result.createObjectStore('clips'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbPut = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('clips', 'readwrite'); t.objectStore('clips').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); };
const idbGet = async k => { const db = await idb(); return new Promise((res, rej) => { const r = db.transaction('clips').objectStore('clips').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); };
$('clipFile').onchange = async e => {
  const files = [...e.target.files]; if (!files.length) return;
  const S = sessions(); let s = S.find(x => x.id === openSess) || S[0];
  if (!s) { s = { id: 's-' + Date.now(), name: 'Session', clips: [] }; S.unshift(s); }
  for (const f of files) { const key = 'upload:' + f.name; try { await idbPut(key, f); } catch (err) { status('Could not keep that video in this browser: ' + err.message); } s.clips.push({ file: key, label: f.name.replace(/\.[^.]+$/, '') }); }
  setSessions(S); openSess = s.id; renderSessions(); openClip(s.clips[s.clips.length - 1].file);
};
renderSessions();
// ?clip=clips/name.mp4&seq=... opens a clip straight away (local testing)
const q = new URLSearchParams(location.search);
if (q.get('clip')) { openClip(q.get('clip')); if (q.get('seq')) $('clipSeq').value = q.get('seq'); document.querySelector('nav button[data-view="clip"]').click(); }
else if (sessions()[0]?.clips[0]) openClip(sessions()[0].clips[0].file);

// ---------- learning from your labels: moves as examples, sequences as combos ----------
// A labelled move becomes an example: the body's shape on each of its frames (joints relative to the hips,
// scaled by torso length). Recognition compares every frame of a clip with every example, mirrored too,
// so a right-side float also matches a left-side one. Saved combos are matched against the order of what it finds.
const TKEY = 'brace-marker-templates', CKEY = 'brace-marker-combos';
const load = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const J = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], MIRROR = { 5: 6, 6: 5, 7: 8, 8: 7, 9: 10, 10: 9, 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 0: 0 };
function filled(frames) { return frames.map((f, i, a) => f || a.slice(0, i).reverse().find(Boolean) || a.find(Boolean)); }
function torsoLen(F) { const t = F.map(f => Math.hypot((f[5][0] + f[6][0] - f[11][0] - f[12][0]) / 2, (f[5][1] + f[6][1] - f[11][1] - f[12][1]) / 2)).sort((a, b) => a - b); return t[Math.floor(t.length / 2)] || 1; }
function descOf(f, torso, mirror = false) {
  const cx = (f[11][0] + f[12][0]) / 2, cy = (f[11][1] + f[12][1]) / 2;
  return J.flatMap(j => { const p = f[mirror ? MIRROR[j] : j]; return [(mirror ? -1 : 1) * (p[0] - cx) / torso, (p[1] - cy) / torso]; });
}
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };
function teach() {
  if (!track || !moves.length) return 0;
  const F = filled(track.frames), torso = torsoLen(F), clip = clipKey().split(':')[1];
  const mine = moves.map(m => ({ name: m.name, col: m.col, variant: m.variant || '', clip,
    frames: (() => { const out = []; for (let i = Math.round(m.t0 * FPS); i <= Math.round(m.t1 * FPS) && i < F.length; i++) out.push(descOf(F[i], torso).map(v => +v.toFixed(3))); return out; })() }));
  store(TKEY, [...load(TKEY).filter(t => t.clip !== clip), ...mine]);
  return mine.length;
}
async function recognise() {
  if (!vid.src) return status('Load a video first.');
  if (!track) await trackBody();
  const T = load(TKEY);
  if (!T.length) { status('No labelled moves to learn from yet. Name some moves on a clip and save them as a combo first.'); return; }
  const F = filled(track.frames), torso = torsoLen(F), n = F.length;
  // how spread out each example is, so the match threshold is relative to real variation
  const spread = T.map(t => { const c = t.frames[0].map((_, d) => t.frames.reduce((s, f) => s + f[d], 0) / t.frames.length); return t.frames.reduce((s, f) => s + dist(f, c), 0) / t.frames.length; }).sort((a, b) => a - b);
  const scale = Math.max(0.35, spread[Math.floor(spread.length / 2)]), limit = 2.6 * scale;
  const best = [];
  // standing upright (shoulders well above hips, head above shoulders) can't be a freeze or a power move
  const upright = F.map(f => { const sy = (f[5][1] + f[6][1]) / 2, hy = (f[11][1] + f[12][1]) / 2; return sy < hy - 0.6 * torso && f[0][1] < sy; });
  for (let i = 0; i < n; i++) {
    const a = descOf(F[i], torso), b = descOf(F[i], torso, true);
    let bi = -1, bd = Infinity;
    T.forEach((t, k) => { if (upright[i] && t.col !== 'Toprock') return; t.frames.forEach(f => { const d = Math.min(dist(a, f), dist(b, f)); if (d < bd) { bd = d; bi = k; } }); });
    best.push({ k: bd <= limit ? bi : -1, d: bd });
    if (i % 10 === 0) { progress = { v: i / n, label: `Matching against ${T.length} moves you've labelled… ${Math.round(i / n * 100)}%` }; await new Promise(r => setTimeout(r)); }
  }
  progress = null;
  // smooth the frame-by-frame guesses, then keep runs of at least 0.4 s
  const lab = best.map((_, i) => { const w = best.slice(Math.max(0, i - 2), i + 3).map(x => x.k); const c = {}; w.forEach(x => c[x] = (c[x] || 0) + 1); return +Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]; });
  const runs = []; let a = 0;
  for (let i = 1; i <= n; i++) if (i === n || lab[i] !== lab[a]) { if (lab[a] >= 0 && i - a >= Math.round(0.4 * FPS)) { const t = T[lab[a]], ds = best.slice(a, i).map(x => x.d); runs.push({ name: t.name, col: t.col, variant: t.variant, t0: a / FPS, t1: i / FPS, conf: Math.max(0, Math.min(1, 1 - (ds.reduce((s, x) => s + x, 0) / ds.length) / limit)) }); } a = i; }
  // merge neighbours with the same name split by a blip
  const found = []; runs.forEach(r => { const l = found[found.length - 1]; if (l && l.name === r.name && r.t0 - l.t1 < 0.3) { l.t1 = r.t1; l.conf = (l.conf + r.conf) / 2; } else found.push({ ...r }); });
  const kept = found.filter(m => m.conf >= 0.7); // weak matches are noise, not moves
  recog = { moves: kept, combo: matchCombo(kept) };
  const found_ = kept;
  renderRecog(); draw();
  status(found_.length ? `Recognised ${found_.length} move${found_.length === 1 ? '' : 's'}${recog.combo ? ` and the combo "${recog.combo.name}"` : ''}. Press play to watch.` : 'Nothing here looks like a move you\'ve labelled before. Label some moves on this clip to teach it.');
}
function matchCombo(found) {
  const seq = found.map(m => norm(m.name)); let best = null;
  load(CKEY).forEach(c => {
    const cs = c.moves.map(m => norm(m.name)), L = Array.from({ length: cs.length + 1 }, () => new Array(seq.length + 1).fill(0));
    for (let i = 1; i <= cs.length; i++) for (let j = 1; j <= seq.length; j++) L[i][j] = cs[i - 1] === seq[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    const hit = L[cs.length][seq.length], ratio = hit / cs.length;
    if (hit >= 3 && ratio >= 0.6 && (!best || ratio > best.ratio)) {
      // which found move lines up with each combo move
      const align = new Array(cs.length).fill(-1); let i = cs.length, j = seq.length;
      while (i > 0 && j > 0) { if (cs[i - 1] === seq[j - 1]) { align[i - 1] = j - 1; i--; j--; } else if (L[i - 1][j] >= L[i][j - 1]) i--; else j--; }
      best = { name: c.name, moves: c.moves, hit, ratio, align };
    }
  });
  return best;
}
function renderRecog() {
  const el = $('clipRecog');
  if (!recog) { el.innerHTML = '<div class="note">Press Recognise moves to see what the app finds by itself.</div>'; return; }
  el.innerHTML = (recog.combo ? `<div class="mitem" style="border-color:var(--accent)"><span><b>${esc(recog.combo.name)}</b><br><span class="note">combo · ${recog.combo.hit} of ${recog.combo.moves.length} moves found</span></span></div>` : '')
    + (recog.moves.length ? recog.moves.map(m => `<div class="mitem" data-t="${m.t0}"><span><b>${esc(m.name)}</b>${m.variant ? ` · <i>${esc(m.variant)}</i>` : ''}<br><span class="note">${fmt(m.t0)}–${fmt(m.t1)} · ${Math.round(m.conf * 100)}% match</span></span></div>`).join('') : '<div class="note">No moves recognised.</div>')
    + '<div class="row" style="margin-top:6px"><button class="pill sm" id="clipRecogClear">Hide recognition</button></div>';
  el.querySelectorAll('[data-t]').forEach(d => d.onclick = () => seekTo(+d.dataset.t));
  $('clipRecogClear').onclick = () => { recog = null; renderRecog(); draw(); };
}
function renderCombos() {
  const el = $('clipCombos'), C = load(CKEY);
  if (!C.length) { el.innerHTML = '<div class="note">None yet. Label the moves in a clip, then Save as a combo.</div>'; return; }
  el.innerHTML = '';
  C.forEach((c, k) => {
    const same = c.clip === currentClip, differs = same && JSON.stringify(c.moves.map(m => [m.name, m.variant || ''])) !== JSON.stringify(moves.map(m => [m.name, m.variant || '']));
    const d = document.createElement('div'); d.className = 'mitem'; d.style.flexWrap = 'wrap';
    d.innerHTML = `<span style="flex:1;min-width:0"><input id="comboname-${k}" value="${esc(c.name)}" style="padding:3px 6px;font-weight:600"><br><span class="note">${c.moves.map(m => esc(m.name + (m.variant ? ` (${m.variant})` : ''))).join(' → ')}</span><br><span class="note">from ${esc(sessLabel(c.clip))}</span></span><span class="x" title="delete">✕</span>`
      + (differs ? '<div class="row" style="width:100%;margin-top:4px"><button class="pill sm" data-upd>update to match this clip\'s labels</button></div>' : '');
    d.querySelector('input').onchange = e => { const C2 = load(CKEY); C2[k].name = e.target.value.trim() || C2[k].name; store(CKEY, C2); renderCombos(); window.dispatchEvent(new Event('brace-sessions-changed')); };
    d.querySelector('.x').onclick = () => { const C2 = load(CKEY); C2.splice(k, 1); store(CKEY, C2); renderCombos(); };
    const u = d.querySelector('[data-upd]'); if (u) u.onclick = () => { const C2 = load(CKEY); C2[k].moves = moves.map(m => ({ name: m.name, col: m.col, variant: m.variant || '' })); store(CKEY, C2); teach(); renderCombos(); status(`Updated "${C2[k].name}" to your current labels.`); };
    el.appendChild(d);
  });
}
function drawRecog(t, W, H, u) {
  const R = recog, cur = R.moves.findIndex(m => t >= m.t0 && t <= m.t1);
  let top = 76 * u;
  if (R.combo) {
    ctx.font = `700 ${30 * u}px Inter, Helvetica, sans-serif`; const name = clipLabel(R.combo.name.toUpperCase(), W - 112 * u), tw = Math.max(ctx.measureText(name).width, 360 * u);
    ctx.fillStyle = css('--accent'); rr(ctx, 24 * u, 24 * u, tw + 40 * u, 84 * u, 14 * u); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(name, 44 * u, 62 * u);
    ctx.font = `500 ${20 * u}px Inter, Helvetica, sans-serif`; ctx.fillText(`combo recognised · ${R.combo.hit} of ${R.combo.moves.length} moves`, 44 * u, 92 * u);
    top = 176 * u;
  }
  if (cur >= 0) {
    const m = R.moves[cur], pop = Math.min(1, (t - m.t0) / 0.25);
    bigTitle(m, m.name.toUpperCase(), [`recognised · ${Math.round(m.conf * 100)}% match`], 36 * u, top, W, u, 52, pop, 1);
  }
  // bottom strip: the combo's moves if a combo was found, otherwise everything recognised
  const items = R.combo ? R.combo.moves.map((m, k) => ({ name: m.name, col: m.col, run: R.combo.align[k] >= 0 ? R.moves[R.combo.align[k]] : null }))
    : R.moves.map(m => ({ name: m.name, col: m.col, run: m }));
  if (!items.length) return;
  ctx.font = `600 ${22 * u}px Inter, Helvetica, sans-serif`;
  const pad = 14 * u, gap = 10 * u, rowH = 44 * u, rows = [[]]; let rw = 0;
  items.forEach((c, k) => { c = { ...c, name: clipLabel(c.name, W - 48 * u - 2 * pad) }; const w = ctx.measureText(c.name).width + 2 * pad; if (rw + w > W - 48 * u && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push({ ...c, w }); rw += w + gap; });
  let y = H - 24 * u - rows.length * (rowH + gap);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; rr(ctx, 12 * u, y - 12 * u, W - 24 * u, rows.length * (rowH + gap) + 16 * u, 16 * u); ctx.fill();
  rows.forEach(r => { let x = 24 * u; r.forEach(c => {
    const col = colourOf(c), now = c.run && t >= c.run.t0 && t <= c.run.t1, done = c.run && t > c.run.t1;
    rr(ctx, x, y, c.w, rowH, rowH / 2);
    if (now) { ctx.fillStyle = col; ctx.fill(); }
    else { ctx.setLineDash(c.run ? [] : [6 * u, 6 * u]); ctx.strokeStyle = done ? col : 'rgba(255,255,255,.35)'; ctx.lineWidth = 2.5 * u; ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = now ? '#111' : done ? col : 'rgba(255,255,255,.45)'; ctx.fillText(c.name, x + pad, y + rowH * 0.66);
    x += c.w + gap; }); y += rowH + gap; });
}
// combo saving: "Save this combo?"
$('clipComboBtn').onclick = () => { if (moves.length < 2) return status('Name at least two moves first.'); $('clipComboAsk').hidden = false; $('clipComboName').focus(); };
$('clipComboCancel').onclick = () => { $('clipComboAsk').hidden = true; };
$('clipComboSave').onclick = () => {
  const name = $('clipComboName').value.trim(); if (!name) return status('Give the combo a name.');
  const C = load(CKEY).filter(c => norm(c.name) !== norm(name));
  C.push({ name, moves: moves.map(m => ({ name: m.name, col: m.col, variant: m.variant || '' })), clip: clipKey().split(':')[1], created: new Date().toISOString() });
  store(CKEY, C); const taught = teach(); $('clipComboAsk').hidden = true; renderCombos();
  status(`Saved "${name}" (${moves.length} moves).` + (taught ? ` It also learned what those ${taught} moves look like, so Recognise can spot them.` : ' Press Track my body first so it can learn what the moves look like.'));
};
$('clipRecognise').onclick = () => recognise().catch(err => { progress = null; status('Recognition could not run here: ' + err.message); });
renderCombos();
window.__clipApi = { recognise, teach, open: (clip, t0, t1) => { let file = clip; for (const s of sessions()) for (const c of s.clips) if (idOf(c.file) === clip) file = c.file; return openClip(file, t0, t1); }, get state() { return { track, moves, recog }; } };
