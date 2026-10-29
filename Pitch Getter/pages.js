(() => {
'use strict';
/* ---------- helpers & data ---------- */
const STORE = 'pitchPracticePageData', OLD = 'pitchGetterProgressV1';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
let params = new URLSearchParams(location.search), routeGen = 0;
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'], LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiName = m => SN[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const nameMidi = n => { const k = /^([A-G])([♯#]?)(-?\d+)$/.exec(n); return k ? LETTER[k[1]] + (k[2] ? 1 : 0) + (+k[3] + 1) * 12 : 60; };
// New notes (natural notes inside the user's sung range) are introduced starting from the middle of that range.
const SHARPS = [1, 3, 6, 8, 10];
function learnOrder() {
  if (!data.range) return []; const { low, high } = data.range, c = (low + high) / 2, out = [];
  for (let m = low; m <= high; m++) if (!SHARPS.includes(((m % 12) + 12) % 12)) out.push(m);
  return out.sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b).map(midiName);
}
const MAX_LEARNING = 2, MAX_QUEUE = 5, PASSES_TO_LEARN = 2, PERFECT_ALMOST = 3, PERFECT_MASTER = 5;
const SPK = '<svg viewBox="0 0 34 34" aria-hidden="true"><path d="M5 13h6l8-6v20l-8-6H5z" fill="currentColor"/><path d="M23 11c3 3 3 9 0 12M27 7c5 5 5 15 0 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const blank = () => ({ learning: [], learned: [], mastered: [], queue: [], stats: {}, range: null });
const load = () => { try { const d = Object.assign(blank(), JSON.parse(localStorage.getItem(STORE)) || {}); d.stats = d.stats || {}; return d; } catch { return blank(); } };
let data = load();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* storage unavailable */ } };
const byPitch = (a, b) => nameMidi(a) - nameMidi(b);
const statusOf = n => data.learning.includes(n) ? 'learning' : data.learned.includes(n) ? 'learned' : data.mastered.includes(n) ? 'mastered' : null;
const stat = n => data.stats[n] || (data.stats[n] = { pass: 0, perfect: 0 });
const isAlmost = n => data.learned.includes(n) && stat(n).perfect >= PERFECT_ALMOST;
const move = (n, from, to) => { data[from] = data[from].filter(x => x !== n); if (!data[to].includes(n)) data[to].push(n); };
function fillLearning() { // open learning slots with the next unseen notes
  for (const n of learnOrder()) { if (data.learning.length >= MAX_LEARNING) break; if (!statusOf(n)) data.learning.push(n); }
  save(); return data.learning;
}
function recordPass(n, perfect) {
  const s = stat(n);
  if (data.learning.includes(n)) { if (++s.pass >= PASSES_TO_LEARN) { move(n, 'learning', 'learned'); s.pass = 0; s.perfect = 0; } }
  else if (data.learned.includes(n) && perfect && ++s.perfect >= PERFECT_MASTER) move(n, 'learned', 'mastered');
  save();
}
function recordRequeue(n) { if (data.learned.includes(n)) stat(n).perfect = 0; save(); }

/* ---------- audio ---------- */
let actx; const BPM = 80, beatSec = 60 / BPM;
function tone(m, dur = 1.3, delay = 0) {
  actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume();
  const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = 440 * 2 ** ((m - 69) / 12);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.2, t + .04); g.gain.setValueAtTime(.2, t + Math.max(.05, dur - .15)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + .02);
}
function click(delay = 0, accent = false) { // short metronome tick
  actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume();
  const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(accent ? .3 : .2, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + .07);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .08);
}
function playItems(items, onNote) {
  if (items.length === 1 && !items[0].beats) { tone(items[0].m, 1.4); return; }
  let t = 0; items.forEach((n, i) => { const d = (n.beats || 1) * beatSec; tone(n.m, Math.max(.2, d * .92), t); if (onNote) setTimeout(() => onNote(i), t * 1000); t += d; });
  if (onNote) setTimeout(() => onNote(-1), t * 1000);
}

/* ---------- microphone / pitch engine ---------- */
const Engine = (() => {
  let ctx, stream, an, buf, run = false, raf = 0, last = 0, hist = [], sm = null, cand = null, cf = 0, nulls = 0, cb = () => {};
  function detect(b, sr) {
    const n = b.length; let e = 0; for (let i = 0; i < n; i++) e += b[i] * b[i];
    if (Math.sqrt(e / n) < .01) return null;
    const minLag = Math.floor(sr / 1000), maxLag = Math.min(Math.floor(sr / 70), n >> 1), c = new Float32Array(maxLag + 1); c[0] = e;
    for (let lag = minLag; lag <= maxLag; lag++) { let s = 0, k = 0; for (let i = 0; i < n - lag; i++) { s += b[i] * b[i + lag]; k++; } c[lag] = s / k; }
    for (let lag = minLag + 1; lag < maxLag; lag++) { if (!(c[lag] > c[lag - 1] && c[lag] >= c[lag + 1])) continue; if (c[lag] / (c[0] / n) < .3) continue; return sr / lag; }
    return null;
  }
  function tick() {
    if (!an || !run) return;
    if (performance.now() - last < 32) { raf = requestAnimationFrame(tick); return; }
    last = performance.now(); an.getFloatTimeDomainData(buf);
    const hz = detect(buf, ctx.sampleRate);
    if (hz) {
      nulls = 0; hist.push(69 + 12 * Math.log2(hz / 440)); if (hist.length > 5) hist.shift();
      const med = [...hist].sort((a, b) => a - b)[hist.length >> 1];
      if (sm === null) { sm = med; cand = med; }
      else if (Math.abs(med - sm) > .65) { if (cand !== null && Math.abs(med - cand) < .25) cf++; else { cand = med; cf = 1; } if (cf >= 3) { sm = med; cf = 0; } }
      else { cand = med; cf = 0; sm = sm * .72 + med * .28; }
      cb(sm);
    } else { if (++nulls > 4) { hist = []; sm = null; } cb(null); }
    raf = requestAnimationFrame(tick);
  }
  async function start(callback) {
    cb = callback || cb;
    if (stream) { if (!run) { run = true; sm = null; hist = []; try { await ctx.resume(); } catch { /* ignore */ } tick(); } return true; } // permission already granted: just resume listening
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
      an = ctx.createAnalyser(); an.fftSize = 4096; ctx.createMediaStreamSource(stream).connect(an); buf = new Float32Array(an.fftSize);
      run = true; tick(); return true;
    } catch (e) { api.error = e && e.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it from the lock icon in your browser\'s address bar, then try again.' : (e && e.message) || 'Microphone unavailable'; stop(); return false; }
  }
  function pause() { stop(); } // not listening = microphone fully released (browser's recording indicator goes off)
  function stop() {
    run = false; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
    if (ctx) ctx.close(); ctx = null; an = null; sm = null; hist = []; cand = null; cf = 0; nulls = 0;
  }
  const api = { start, stop, pause, error: '', get on() { return run; } };
  window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  return api;
})();

/* ---------- grand staff (SVG) ---------- */
const NAT = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const dia = m => (Math.floor(m / 12) - 1) * 7 + NAT[((m % 12) + 12) % 12];
const yOf = m => 84 - (dia(m) - 30) * 8;           // treble lines 20..84, bass lines 116..180, middle C at 100
const sharp = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
function ledgers(y) {
  const L = []; if (y === 100) L.push(100);
  if (y <= 4) for (let l = 4; y <= l; l -= 16) L.push(l);
  if (y >= 196) for (let l = 196; y >= l; l += 16) L.push(l);
  return L;
}
function noteSVG(x, y, n, cls, color) {
  const b = n.beats, hollow = b >= 2, whole = b >= 4, up = y > (y < 100 ? 52 : 148);
  let s = `<g class="note ${cls || ''}"${color ? ` style="color:${color}"` : ''}>`;
  s += ledgers(y).map(l => `<line x1="${x - 14}" x2="${x + 14}" y1="${l}" y2="${l}" stroke="currentColor" stroke-width="1.4"/>`).join('');
  if (sharp(n.m)) s += `<text class="acc" x="${x - 22}" y="${y + 7}">♯</text>`;
  s += whole ? `<ellipse cx="${x}" cy="${y}" rx="9" ry="5.8" fill="#fff" stroke="currentColor" stroke-width="2"/>`
    : `<ellipse cx="${x}" cy="${y}" rx="8" ry="5.6" transform="rotate(-18 ${x} ${y})" fill="${hollow ? '#fff' : 'currentColor'}" stroke="currentColor" stroke-width="1.8"/>`;
  if (b && !whole) {
    const sx = up ? x + 7.4 : x - 7.4, ey = up ? y - 36 : y + 36;
    s += `<line x1="${sx}" x2="${sx}" y1="${y}" y2="${ey}" stroke="currentColor" stroke-width="1.8"/>`;
    if (b <= .5) s += `<path d="M${sx} ${ey} q11 ${up ? 6 : -6} 7 ${up ? 18 : -18}" fill="none" stroke="currentColor" stroke-width="2.4"/>`;
  }
  return s + '</g>';
}
function staffSVG(items, user, cur) {
  let s = '<svg class="staff-svg" viewBox="0 -28 300 240" role="img" aria-label="Notes on a grand staff">';
  for (const base of [20, 116]) for (let i = 0; i < 5; i++) s += `<line class="sl" x1="48" x2="294" y1="${base + i * 16}" y2="${base + i * 16}"/>`;
  s += '<line class="sl" x1="48" x2="48" y1="20" y2="180"/><text class="clef" data-clef="treble">𝄞</text><text class="clef" data-clef="bass">𝄢</text>';
  const n = items.length, xs = n === 1 ? [168] : items.map((_, i) => 120 + i * (150 / (n - 1)));
  if (cur && cur.i >= 0 && xs[cur.i] != null) { // moving indicator: arrow + highlight on the note being sung now, dot = the pitch you are singing
    const x = xs[cur.i], y = yOf(items[cur.i].m);
    s += `<line x1="${x}" x2="${x}" y1="-12" y2="196" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4 4" opacity=".5"/><path d="M${x - 8} -27L${x + 8} -27L${x} -13Z" fill="#ef4444"/><ellipse cx="${x}" cy="${y}" rx="17" ry="14" fill="rgba(255,168,74,.3)" stroke="#ef4444" stroke-width="1.6"/>`;
  }
  items.forEach((it, i) => { s += noteSVG(xs[i], yOf(it.m), it, it.cls); });
  if (cur && cur.i >= 0 && cur.live && xs[cur.i] != null) s += `<circle cx="${xs[cur.i]}" cy="${yOf(cur.live.m)}" r="6" fill="${cur.live.color}" stroke="#fff" stroke-width="1.6"/>`;
  if (user) s += noteSVG(xs[0] + 42, yOf(user.m), { m: user.m }, 'user', user.color);
  return s + '</svg>';
}

// Music glyphs differ from font to font, so measure each clef and fit it to its staff.
function setStaff(el, items, user, cur) {
  el.innerHTML = staffSVG(items, user, cur);
  const fit = { treble: { y: -6, h: 106 }, bass: { y: 116, h: 52 } };
  $$('[data-clef]', el).forEach(t => {
    try {
      const f = fit[t.dataset.clef], b = t.getBBox(); if (!b.height || !b.width) return;
      const k = Math.min(f.h / b.height, 40 / b.width);
      t.setAttribute('transform', `translate(${6 - b.x * k} ${f.y - b.y * k}) scale(${k})`);
    } catch { /* getBBox unavailable: keep the default glyph size */ }
  });
}

/* ---------- pitch matcher: hold within 25 cents for 1s ---------- */
function matcher(target, h) {
  let held = 0, sum = 0, n = 0, wrongM = null, wrongSince = 0, counted = false;
  return m => {
    const now = performance.now();
    if (m == null) { held = 0; sum = 0; n = 0; wrongM = null; h.idle(); return; }
    const delta = (m - target) * 100, r = Math.round(m), cls = Math.abs(delta) <= 25 ? 'good' : delta < 0 ? 'flat' : 'sharp';
    h.sung(r, cls, delta);
    if (cls === 'good') {
      if (!held) held = now; sum += Math.abs(delta); n++; wrongM = null; counted = false;
      const t = (now - held) / 1000; h.hold(Math.min(t, 1)); if (t >= 1) h.pass(sum / n <= 12);
    } else {
      held = 0; sum = 0; n = 0;
      if (wrongM !== r) { wrongM = r; wrongSince = now; counted = false; }
      if (!counted && now - wrongSince >= 700) { counted = true; wrongSince = now; h.miss(r, cls); }
      else if (counted && now - wrongSince >= 2000) { counted = false; wrongSince = now - 700; } // still wrong: count another miss
    }
  };
}
// Same gradual ramp as the original: green when in tune, fading to blue (flat) or red (sharp) by 25 cents.
const tuneColor = c => { const amt = Math.min(1, Math.abs(c) / 25), a = [0, 128, 0], b = c < 0 ? [0, 0, 255] : [255, 0, 0]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * amt)).join(',')})`; };
const hzOf = m => 440 * 2 ** ((m - 69) / 12);
const rangeText = (m, c = 25) => `Acceptable range: within ±${c} cents of ${midiName(m)} (${(hzOf(m) * 2 ** (-c / 1200)).toFixed(1)}–${(hzOf(m) * 2 ** (c / 1200)).toFixed(1)} Hz)`;
function answerMatches(txt, m) { // typed note name: C, c4, F#3, Bb, D♭4 ...
  const k = /^([a-g])\s*(#|♯|sharp|b|♭|flat)?\s*(-?\d+)?$/i.exec(txt.trim()); if (!k) return false;
  const base = LETTER[k[1].toUpperCase()] + (!k[2] ? 0 : /^(#|♯|s)/i.test(k[2]) ? 1 : -1);
  return k[3] == null ? (((base - m) % 12) + 12) % 12 === 0 : base + (+k[3] + 1) * 12 === m;
}
const sungText = (r, d, target) => `${midiName(r)} · ${d >= 0 ? '+' : ''}${d.toFixed(0)} cents vs ${midiName(target)}`;

/* ---------- shared header behaviour ---------- */
$$('[data-clear-data]').forEach(b => b.addEventListener('click', () => {
  if (!confirm('Clear saved notes and practice progress? This cannot be undone.')) return;
  localStorage.removeItem(STORE); localStorage.removeItem(OLD); go('practice.html');
}));

/* ---------- CSV export / import (account menu) ---------- */
$$('[data-export-csv]').forEach(b => b.addEventListener('click', () => {
  const rows = [['type', 'note', 'midi', 'pass', 'perfect', 'low', 'high']];
  if (data.range) rows.push(['range', '', '', '', '', data.range.low, data.range.high]);
  for (const g of ['learning', 'learned', 'mastered']) data[g].forEach(n => { const s = stat(n); rows.push([g, n, nameMidi(n), s.pass, s.perfect, '', '']); });
  data.queue.forEach(n => rows.push(['queue', n, nameMidi(n), '', '', '', '']));
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(r => r.join(',')).join('\r\n')], { type: 'text/csv' })), a = document.createElement('a');
  a.href = url; a.download = 'pitch-practice-progress.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
$$('[data-import-csv]').forEach(inp => inp.addEventListener('change', async () => {
  const file = inp.files[0]; inp.value = ''; if (!file) return;
  try {
    const d = blank(); let count = 0;
    for (const line of (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean)) {
      const [type, note, , pass, perfect, low, high] = line.split(',');
      if (type === 'range' && low !== '' && high !== '' && Number.isFinite(+low) && Number.isFinite(+high)) d.range = { low: +low, high: +high };
      else if (['learning', 'learned', 'mastered', 'queue'].includes(type) && /^[A-G][♯#]?\d+$/.test(note || '')) {
        const n = midiName(nameMidi(note));
        if (type === 'queue') { if (d.queue.length < MAX_QUEUE && !d.queue.includes(n)) d.queue.push(n); }
        else { d[type].push(n); d.stats[n] = { pass: +pass || 0, perfect: +perfect || 0 }; count++; }
      }
    }
    if (!count && !d.range) throw new Error('empty');
    if (!confirm('Replace your current notes and progress with this file?')) return;
    data = d; save(); alert(`Imported ${count} note${count === 1 ? '' : 's'}.`); render();
  } catch { alert('Could not read that CSV file.'); }
}));
document.addEventListener('click', e => { const d = $('.account-menu'); if (d && d.open && !d.contains(e.target)) d.open = false; });
document.addEventListener('keydown', e => { const d = $('.account-menu'); if (e.key === 'Escape' && d) d.open = false; });

/* ---------- Pitcher (live gauge) ---------- */
function pitcher() {
  const g = $('[data-gauge]'); if (!g) return;
  const needle = $('#needle'), hub = $('#hubNote'), pt = $('[data-pitch-text]'), ct = $('[data-cents-text]'), btn = $('[data-mic-toggle]'), status = $('[data-mic-status]');
  const reset = () => { hub.textContent = '--'; hub.style.fill = ''; needle.style.transform = 'rotate(0deg)'; pt.textContent = 'Pitch: --'; ct.textContent = 'Cents Off: --'; };
  const ui = on => { btn.textContent = on ? 'Mic On' : 'Mic Off'; btn.setAttribute('aria-pressed', String(on)); };
  function show(m) {
    const r = Math.round(m), c = (m - r) * 100;
    hub.textContent = SN[((r % 12) + 12) % 12]; hub.style.fill = tuneColor(c);
    pt.textContent = `Pitch: ${midiName(r)}`; ct.textContent = `Cents Off: ${Math.round(c) > 0 ? '+' : ''}${Math.round(c)}`;
    needle.style.transform = `rotate(${clamp(c, -50, 50) * 1.8}deg)`;
  }
  btn.addEventListener('click', async () => {
    if (Engine.on) { Engine.pause(); ui(false); reset(); status.textContent = ''; return; }
    status.textContent = 'Starting microphone…';
    if (await Engine.start(m => { if (m != null) show(m); })) { ui(true); status.textContent = 'Listening… In tune = within ±25 cents of the note.'; }
    else status.textContent = 'Microphone error: ' + Engine.error;
  });
  reset();
}

/* ---------- Range setup (first time learning) ---------- */
function setupRange() {
  const box = $('[data-range]'); box.hidden = false;
  const st = $('[data-range-status]'), out = $('[data-range-result]'), go = $('[data-range-go]'), btns = { low: $('[data-range-low]'), high: $('[data-range-high]') };
  const got = { low: null, high: null }, wait = ms => new Promise(r => setTimeout(r, ms));
  const show = () => { out.textContent = `Lowest: ${got.low == null ? '--' : midiName(got.low)} · Highest: ${got.high == null ? '--' : midiName(got.high)}`; go.disabled = got.low == null || got.high == null; };
  async function record(which) {
    if (Engine.on) return; st.className = 'feedback'; st.textContent = 'Starting microphone…'; const vals = [];
    if (!await Engine.start(m => { if (m != null) vals.push(m); })) { st.textContent = 'Microphone error: ' + Engine.error; return; }
    Object.values(btns).forEach(b => b.disabled = true); go.disabled = true;
    for (let s = 3; s > 0; s--) { st.textContent = `Hold your ${which === 'low' ? 'lowest' : 'highest'} comfortable note… ${s}`; await wait(1000); }
    Engine.pause(); Object.values(btns).forEach(b => b.disabled = false);
    if (vals.length < 8) { st.textContent = 'No steady pitch heard. Try again and hold the note clearly.'; show(); return; }
    const m = Math.round(vals.sort((a, b) => a - b)[vals.length >> 1]), prev = got[which]; got[which] = m;
    const lo = got.low, hi = got.high;
    if (lo != null && hi != null && hi - lo < 4) { got[which] = prev; st.className = 'feedback sharp'; st.textContent = `${midiName(m)} is too close to your other note. Your highest should be at least 4 notes above your lowest.`; show(); return; }
    st.className = 'feedback good'; st.textContent = `Saved ${which === 'low' ? 'lowest' : 'highest'} note: ${midiName(m)}.${got.low == null || got.high == null ? ' Now record the other one.' : ' Looks good!'}`;
    btns[which].textContent = `Re-record ${which === 'low' ? 'lowest' : 'highest'} note`; show();
  }
  btns.low.addEventListener('click', () => record('low')); btns.high.addEventListener('click', () => record('high'));
  go.addEventListener('click', () => { data.range = { low: got.low, high: got.high }; save(); render(); });
  show();
}

/* ---------- Learn a note ---------- */
function learn() {
  const root = $('[data-learn]'); if (!root) return;
  if (!data.range) { root.hidden = true; setupRange(); return; }
  const session = fillLearning(), i = clamp(+params.get('n') || 0, 0, Math.max(0, session.length - 1));
  const note = session[i], fb = $('[data-feedback]', root), staff = $('[data-staff]', root), testBtn = $('[data-test]', root), ready = $('[data-ready]', root), back = $('[data-back]', root);
  back.href = i > 0 ? `learn-note.html?n=${i - 1}` : 'practice.html';
  if (!note) { $('.learn-title', root).textContent = 'No new notes'; $('.learn-copy', root).innerHTML = '<p>You have learned every note in your range.</p>'; staff.hidden = testBtn.hidden = ready.hidden = true; return; }
  $('[data-redo-range]', root).addEventListener('click', () => { Engine.pause(); data.range = null; save(); render(); });
  const say = (cls, t, col) => { fb.className = 'feedback ' + cls; fb.style.color = col || ''; fb.textContent = t; };
  const m = nameMidi(note); let items = [{ m }]; $('[data-range-text]', root).textContent = rangeText(m);
  $$('[data-current-note]', root).forEach(e => e.textContent = note);
  const draw = user => setStaff(staff, items, user);
  draw(); $('[data-hear]', root).innerHTML = SPK; $('[data-hear]', root).addEventListener('click', () => tone(m, 1.4));
  ready.addEventListener('click', () => { Engine.pause(); go(i < session.length - 1 ? `learn-note.html?n=${i + 1}` : 'review.html?mode=learn'); });
  const stopTest = () => { Engine.pause(); testBtn.textContent = 'Test It!'; };
  testBtn.addEventListener('click', async () => {
    if (Engine.on) { stopTest(); say('', 'Listen, find its place on the staff, then test your pitch.'); draw(); return; }
    say('', 'Starting microphone…');
    let last = '';
    const M = matcher(m, {
      sung(r, cls, d) { const key = r + ':' + Math.round(Math.abs(d) / 2) + cls; if (key !== last) { last = key; draw({ m: r, cls, color: tuneColor(d) }); } say('', sungText(r, d, m) + (cls === 'flat' ? ' — flat' : cls === 'sharp' ? ' — sharp' : ''), tuneColor(d)); },
      hold(t) { fb.textContent = `Good — hold it steady (${t.toFixed(1)} / 1.0 s)`; },
      idle() { if (!last) say('', `Listening… sing ${note}.`); },
      pass() { stopTest(); say('good', `Great match! Click “Okay, Ready!” when you want to move on.`); },
      miss() {}
    });
    if (await Engine.start(M)) testBtn.textContent = 'Stop'; else say('', 'Microphone error: ' + Engine.error);
  });
}

/* ---------- Choose notes ---------- */
function choose() {
  if (!$('[data-note-list="learning"]')) return;
  const mode = params.get('mode') === 'melodies' ? 'melodies' : 'notes';
  data.queue = data.queue.filter(n => statusOf(n)); save();
  const total = data.learning.length + data.learned.length + data.mastered.length;
  if (!total) $('[data-empty-hint]').hidden = false;
  const chip = n => `<button class="note-chip" type="button" data-note="${esc(n)}" aria-pressed="${data.queue.includes(n)}">${esc(n)}</button>`;
  const fill = (key, list) => { const el = $(`[data-note-list="${key}"]`); el.innerHTML = list.sort(byPitch).map(chip).join(''); };
  function draw() {
    fill('learning', [...data.learning]); fill('learned', data.learned.filter(n => !isAlmost(n))); fill('almost', data.learned.filter(isAlmost)); fill('mastered', [...data.mastered]);
    $('[data-learn-full]').hidden = data.learning.length < MAX_LEARNING;
    $('[data-queue]').innerHTML = data.queue.map(n => `<li>${esc(n)}</li>`).join('');
    $('[data-queue-count]').textContent = data.queue.length;
    $$('[data-note]').forEach(b => b.onclick = () => {
      const n = b.dataset.note;
      if (data.queue.includes(n)) data.queue = data.queue.filter(x => x !== n); else if (data.queue.length < MAX_QUEUE) data.queue.push(n); else return;
      save(); draw();
    });
  }
  draw();
  $('[data-clear-queue]').addEventListener('click', () => { data.queue = []; save(); draw(); });
  $('[data-ready]').addEventListener('click', () => { if (!data.queue.length) { alert('Choose at least one note to practice.'); return; } go('review.html?mode=' + mode); });
}

/* ---------- Notes list (from the account menu) ---------- */
function list() {
  const title = $('[data-list-title]'); if (!title) return;
  const group = params.get('group') || 'learning', labels = { learning: 'New Notes', learned: 'Learned Notes', mastered: 'Mastered Notes' };
  title.textContent = labels[group] || 'Notes';
  const notes = [...(data[group] || [])].sort(byPitch);
  $('[data-all-notes]').innerHTML = notes.map(n => `<li><span>${esc(n)}</span><button type="button" data-add-note="${esc(n)}">${data.queue.includes(n) ? 'Added' : 'Add to practice'}</button></li>`).join('') || '<li>No notes in this group yet.</li>';
  $$('[data-add-note]').forEach(b => b.addEventListener('click', () => {
    const n = b.dataset.addNote;
    if (!data.queue.includes(n)) { if (data.queue.length >= MAX_QUEUE) { b.textContent = 'Queue is full'; return; } data.queue.push(n); save(); }
    b.textContent = 'Added';
  }));
}

/* ---------- Flashcard review ---------- */
function review() {
  const cardEl = $('[data-card]'); if (!cardEl) return;
  const mode = ['learn', 'melodies'].includes(params.get('mode')) ? params.get('mode') : 'notes';
  const notes = mode === 'learn' ? [...data.learning] : data.queue.filter(n => statusOf(n));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const before = Object.fromEntries(notes.map(n => [n, statusOf(n)]));
  if (!notes.length) { cardEl.innerHTML = `<div class="done-box"><h2>No notes to practice</h2><p>Learn a few notes first, then choose them to practice.</p><div class="note-actions"><a class="button back" href="practice.html">Back</a><a class="button primary" href="learn-note.html">Learn Notes</a></div></div>`; return; }
  const cards = [];
  if (mode === 'melodies') {
    const pats = [[1, 1, 2], [2, 1, 1], [1, .5, .5, 2], [.5, .5, 1, 2], [1, 1, 1, 1], [2, 2]], pool = notes.map(nameMidi);
    notes.forEach(n => cards.push({ type: 'beat', note: n, miss: 0, items: pick(pats).map(b => ({ m: nameMidi(n), beats: b })) }));
    for (let i = 0; i < Math.max(2, Math.ceil(notes.length / 2)); i++) {
      const seq = []; for (let k = 0; k < 4; k++) { let m = pick(pool); if (pool.length > 1) while (seq.length && seq[seq.length - 1].m === m) m = pick(pool); seq.push({ m, beats: 1 }); }
      cards.push({ type: 'melody', miss: 0, items: seq });
    }
  } else notes.forEach(n => { ['pitch', 'note'].forEach(type => cards.push({ type, note: n, miss: 0, items: [{ m: nameMidi(n) }] })); });
  let todo = shuffle(cards), done = [], run = 0, timer = 0; const gen = routeGen, alive = () => gen === routeGen;
  const TXT = { pitch: ['What is the Pitch?', 'How do you sing this pitch?'], note: ['What is the Note?', 'What note is this?'], beat: ['What is the beat?', 'How do you sing this beat?'], melody: ['What is the melody?', 'How do you sing this pattern?'] };
  const stackHTML = (n, side) => n ? Array.from({ length: Math.min(n, 5) }, (_, i) => `<div class="sliver" style="--i:${i}"></div>`).join('') + `<span class="stack-count">${n}</span>` : '';
  function render() {
    if (!alive()) return; run++; clearTimeout(timer); Engine.pause();
    $('[data-stack="left"]').innerHTML = stackHTML(done.length, 'left'); $('[data-stack="right"]').innerHTML = stackHTML(Math.max(0, todo.length - 1), 'right');
    $('[data-counts]').textContent = `${done.length} finished · ${Math.max(0, todo.length - 1)} to go`;
    if (!todo.length) return finish();
    const c = todo[0], T = TXT[c.type];
    const side = c.type === 'note' ? `<p>${T[1]}</p><input type="text" class="answer-input" data-answer placeholder="Answer" aria-label="Type the note name" autocomplete="off" spellcheck="false" maxlength="8"><span class="answer-hint">Type the note, then press Enter</span>` : `<p>${T[1]}</p><p>Hear it! <button type="button" class="icon-btn" data-hear aria-label="Hear it">${SPK}</button></p>`;
    cardEl.innerHTML = `<h2>${T[0]}</h2><div class="card-body"><div data-staff></div><div class="card-side">${side}<button type="button" class="primary test" data-test>Test It!</button></div></div><p class="feedback" data-feedback></p><p class="range-text" data-range-text></p>`;
    const staff = $('[data-staff]', cardEl), fb = $('[data-feedback]', cardEl), btn = $('[data-test]', cardEl);
    setStaff(staff, c.items);
    const seq = c.type === 'beat' || c.type === 'melody', cur = i => setStaff(staff, c.items, null, i < 0 ? null : { i }), playIt = () => playItems(c.items, seq ? cur : null);
    const hear = $('[data-hear]', cardEl); if (hear) hear.onclick = playIt;
    const ans = $('[data-answer]', cardEl), rt = $('[data-range-text]', cardEl);
    rt.textContent = c.type === 'pitch' ? rangeText(c.items[0].m) : c.type === 'note' ? '' : 'Each note: within ±35 cents of its target pitch. The red arrow follows the beat; the dot shows the pitch you are singing.';
    if (ans) {
      const reveal = () => { ans.value = c.note; ans.disabled = true; $('.answer-hint', cardEl).outerHTML = `<p>Hear it! <button type="button" class="icon-btn" data-hear2 aria-label="Hear it">${SPK}</button></p>`; $('[data-hear2]', cardEl).onclick = playIt; rt.textContent = rangeText(c.items[0].m); };
      if (c.answered) reveal();
      ans.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !ans.value.trim()) return;
        if (answerMatches(ans.value, c.items[0].m)) { c.answered = true; reveal(); setFb('good', `Correct — that's ${c.note}. Now sing it!`); }
        else { const t = ans.value.trim(); ans.select(); missed(`“${t}” isn't it — check the clef and the line or space`); }
      });
    }
    const setFb = (cls, t, col) => { fb.className = 'feedback ' + (cls || ''); fb.style.color = col || ''; fb.textContent = t; };
    const idle = () => { btn.textContent = 'Test It!'; };
    const finishCard = (ok, perfect) => {
      Engine.pause(); idle(); const my = run;
      if (ok) { setFb('good', perfect ? 'Perfect!' : 'Nice work!'); if (c.note && (c.type === 'pitch' || c.type === 'note')) recordPass(c.note, perfect && c.miss === 0); timer = setTimeout(() => { if (my !== run || !alive()) return; done.push(todo.shift()); render(); }, 1000); }
    };
    const missed = text => {
      c.miss++;
      if (c.miss >= 3) { Engine.pause(); idle(); run++; const my = run; setFb('', 'Three misses — this card moves to the end of your stack.'); if (c.note) recordRequeue(c.note); c.miss = 0; c.answered = false; timer = setTimeout(() => { if (my !== run || !alive()) return; todo.push(todo.shift()); render(); }, 1400); }
      else setFb('', `${text} (${3 - c.miss} more miss${3 - c.miss === 1 ? '' : 'es'} before this card returns to the stack)`);
    };
    btn.onclick = async () => {
      if (Engine.on) { Engine.pause(); run++; idle(); setFb('', ''); setStaff(staff, c.items); return; }
      if (c.type === 'note' && !c.answered) { setFb('', 'Type the note name first, then press Enter.'); ans.focus(); return; }
      setFb('', 'Starting microphone…'); const my = ++run;
      if (c.type === 'pitch' || c.type === 'note') {
        const target = c.items[0].m; let last = '', over = false;
        const M = matcher(target, {
          sung(r, cls, d) { const key = r + ':' + Math.round(Math.abs(d) / 2) + cls; if (key !== last) { last = key; setStaff(staff, c.items, { m: r, cls, color: tuneColor(d) }); } setFb('', sungText(r, d, target), tuneColor(d)); },
          hold(t) { fb.className = 'feedback'; fb.textContent = `Good — hold it steady (${t.toFixed(1)} / 1.0 s)`; },
          idle() { if (!last) setFb('', `Listening… sing the note.`); },
          pass(perfect) { if (over) return; over = true; finishCard(true, perfect); },
          miss(r) { if (over) return; missed(`Detected ${midiName(r)}`); if (c.miss === 0) over = true; }
        });
        if (await Engine.start(M)) btn.textContent = 'Stop'; else setFb('', 'Microphone error: ' + Engine.error);
      } else {
        const frames = []; let t0 = 0, rec = false, shown = '';
        const bounds = []; { let acc = 0; c.items.forEach(n => { acc += n.beats * beatSec * 1000; bounds.push(acc); }); }
        const slotAt = t => { const i = bounds.findIndex(b => t < b); return i < 0 ? c.items.length - 1 : i; };
        const showCursor = (i, m) => { const k = i + ':' + (m == null ? '-' : Math.round(m * 2)); if (k === shown) return; shown = k; setStaff(staff, c.items, null, { i, live: m == null ? null : { m: Math.round(m), color: tuneColor((m - c.items[i].m) * 100) } }); };
        if (!await Engine.start(m => { if (!rec) return; const t = performance.now() - t0; frames.push({ t, m }); showCursor(slotAt(t), m); })) { setFb('', 'Microphone error: ' + Engine.error); return; }
        btn.textContent = 'Stop'; const wait = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 4; i++) { click(i * beatSec, i === 0); setTimeout(() => { if (my === run && alive()) setFb('', `Count-in at ${BPM} BPM: ${i + 1}`); }, i * beatSec * 1000); } // audible count-in so you can hear the tempo
        await wait(4 * beatSec * 1000); if (my !== run || !alive()) return;
        setFb('', 'Sing now!'); t0 = performance.now(); rec = true; showCursor(0, null);
        const total = c.items.reduce((s, n) => s + n.beats, 0) * beatSec * 1000; await wait(total + 250); if (my !== run || !alive()) return; rec = false;
        let acc = 0;
        const res = c.items.map(n => {
          const s = acc * beatSec * 1000, d = n.beats * beatSec * 1000; acc += n.beats;
          const v = frames.filter(f => f.m != null && f.t >= s + d * .15 && f.t <= s + d * .9).map(f => f.m).sort((a, b) => a - b);
          if (v.length < 3) return 'miss'; const cents = (v[v.length >> 1] - n.m) * 100; return Math.abs(cents) <= 35 ? 'good' : cents < 0 ? 'flat' : 'sharp';
        });
        Engine.pause(); idle(); setStaff(staff, c.items.map((n, i) => ({ ...n, cls: res[i] })));
        const hits = res.filter(r => r === 'good').length;
        if (hits === res.length) finishCard(true, c.miss === 0); else missed(`${hits} of ${res.length} notes matched (blue = flat, red = sharp, gray = not heard)`);
      }
    };
  }
  function finish() {
    const changes = notes.map(n => [n, statusOf(n)]).filter(([n, s]) => s !== before[n]).map(([n, s]) => `<li>${esc(n)} moved to ${s === 'learned' ? 'Learned' : s === 'mastered' ? 'Mastered' : s}</li>`).join('');
    cardEl.innerHTML = `<div class="done-box"><h2>Practice complete!</h2><p>You finished all of your cards.</p>${changes ? `<ul>${changes}</ul>` : ''}<div class="note-actions"><a class="button back" href="practice.html">Back to Practice</a>${mode === 'learn' ? '<a class="button primary" href="learn-note.html">Learn More Notes</a>' : ''}</div></div>`;
  }
  render();
}

/* ---------- page switching inside ONE document, so the microphone permission and stream are kept ---------- */
const ROUTES = window.ROUTES || {};
function parseRoute() { const h = location.hash.replace(/^#\/?/, ''); return h && ROUTES[h.split('?')[0]] ? h : (location.pathname.split('/').pop() || 'index.html') + location.search; }
function render() {
  const [file, q = ''] = parseRoute().split('?'), R = ROUTES[file]; routeGen++; params = new URLSearchParams(q);
  if (R) { $('main').outerHTML = R.html; document.title = R.title + ' · Pitch Practice'; $$('.site-nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === (R.active === 'pitcher' ? 'index.html' : 'practice.html'))); }
  const menu = $('.account-menu'); if (menu) menu.open = false; window.scrollTo(0, 0);
  pitcher(); learn(); choose(); list(); review();
}
function go(url) { if (!ROUTES[url.split('?')[0]]) { location.href = url; return; } Engine.pause(); history.pushState(null, '', '#/' + url); render(); }
window.addEventListener('popstate', () => { Engine.pause(); render(); });
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  const h = a.getAttribute('href'); if (/^[a-z]+:/i.test(h) || h.startsWith('#')) return;
  if (ROUTES[h.split('?')[0]]) { e.preventDefault(); go(h); }
});
render();
})();
