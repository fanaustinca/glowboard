// Match timer: 3-2-1 countdown beeps, start horn, 2:30 match, reminders at 1:00 and 0:30, long end horn.
// Sounds are synthesised with Web Audio (no audio files), so they work offline and have no licence strings attached.
import { esc } from './ui.js';

export const MATCH_SECONDS = 150;
export const REMINDERS = [60, 30]; // seconds left when the reminder chime plays
export const COUNTDOWN = 3;

export function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function mountTimer(root) {
  root.innerHTML = `
    <section class="card timer" id="tm">
      <div class="tm-stage"><div class="tm-clock" id="tm-clock" role="timer" aria-live="off">${fmt(MATCH_SECONDS)}</div>
        <div class="tm-sub" id="tm-sub" aria-live="polite">Ready — 2:30 match</div></div>
      <div class="tm-btns">
        <button class="btn primary big" id="tm-go" type="button">Start</button>
        <button class="btn big" id="tm-reset" type="button">Reset</button>
        <button class="btn" id="tm-full" type="button">⛶ Full screen</button>
      </div>
      <div class="tm-opts">
        <label class="tm-vol">🔊 Volume <input id="tm-vol" type="range" min="0" max="100" value="80" aria-label="Volume"></label>
        <button class="btn small" id="tm-test" type="button">Test sounds</button>
      </div>
      <div class="tm-pop" id="tm-pop" role="dialog" aria-modal="true" aria-labelledby="tm-pop-h">
        <div class="card"><div class="tm-pop-ico" aria-hidden="true">🔊</div><h2 id="tm-pop-h">Turn your sound up</h2>
          <p>The timer starts with 3-2-1 beeps and a horn, and signals the match end with a loud horn. Make sure the volume on this device (and any speaker) is up.</p>
          <div class="tm-btns"><button class="btn" id="tm-pop-test" type="button">Play a test sound</button><button class="btn primary" id="tm-pop-ok" type="button">Sound is up</button></div></div>
      </div>
      <p class="muted tm-help">Press <b>Start</b>: 3 · 2 · 1 beeps, then the start horn and 2:30 begins. A chime sounds at <b>1:00</b> and <b>0:30</b>, and a long horn ends the match. Space starts or pauses.</p>
    </section>`;
  const $ = (s) => root.querySelector(s);
  let ctx = null, master = null, timer = null, wake = null;
  let phase = 'idle'; // idle | count | run | paused | done
  let t0 = 0, elapsed = 0, fired = new Set();

  // ---- sound ----
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.value = +$('#tm-vol').value / 100;
    return ctx;
  }
  function tone(freq, dur, { type = 'sine', gain = .6, at = 0, detune = [0] } = {}) {
    const c = audio(); if (!c) return;
    const t = c.currentTime + at;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + .015);
    g.gain.setValueAtTime(gain, t + Math.max(.02, dur - .06));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    for (const d of detune) { const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = d; o.connect(g); o.start(t); o.stop(t + dur + .02); }
  }
  const beep = () => tone(880, .18, { type: 'square', gain: .35 });
  const chime = () => { tone(1320, .22, { gain: .5 }); tone(1320, .22, { gain: .5, at: .32 }); };
  // A horn: stacked detuned saw/square waves, low and loud.
  const horn = (dur) => { tone(233, dur, { type: 'sawtooth', gain: .55, detune: [-8, 0, 9] }); tone(466, dur, { type: 'square', gain: .25, detune: [-5, 6] }); };
  const startHorn = () => horn(1.1);
  const endHorn = () => { horn(1.6); horn(1.6, 0); tone(233, 1.6, { type: 'sawtooth', gain: .55, at: 1.9, detune: [-8, 0, 9] }); tone(466, 1.6, { type: 'square', gain: .25, at: 1.9, detune: [-5, 6] }); };

  // ---- state ----
  const now = () => performance.now() / 1000;
  const left = () => MATCH_SECONDS - elapsed - (phase === 'run' ? now() - t0 : 0);
  function paint(sub) {
    const clock = $('#tm-clock');
    if (phase === 'count') clock.textContent = String(Math.max(1, Math.ceil(COUNTDOWN - (now() - t0))));
    else clock.textContent = fmt(phase === 'done' ? 0 : left());
    const l = left();
    $('#tm').dataset.phase = phase;
    $('#tm').dataset.zone = phase === 'done' ? 'end' : phase === 'run' && l <= 30 ? 'warn' : phase === 'run' && l <= 60 ? 'soft' : '';
    if (sub) $('#tm-sub').textContent = sub;
    $('#tm-go').textContent = phase === 'run' || phase === 'count' ? 'Pause' : phase === 'paused' ? 'Resume' : 'Start';
    $('#tm-go').disabled = phase === 'done';
  }
  function tick() {
    if (phase === 'count') {
      const e = now() - t0;
      for (let i = 0; i < COUNTDOWN; i++) if (e >= i && !fired.has('c' + i)) { fired.add('c' + i); beep(); }
      if (e >= COUNTDOWN) { startHorn(); phase = 'run'; t0 = now(); elapsed = 0; paint('Match running'); return; }
      paint('Get ready…'); return;
    }
    if (phase !== 'run') return;
    const l = left();
    for (const r of REMINDERS) if (l <= r && !fired.has('r' + r)) { fired.add('r' + r); chime(); $('#tm-sub').textContent = `${fmt(r)} left`; }
    if (l <= 0) { phase = 'done'; endHorn(); stop(); paint('Time! Match over'); return; }
    paint();
  }
  function loop() { if (!timer) timer = setInterval(tick, 25); }
  function stop() { clearInterval(timer); timer = null; releaseWake(); }
  async function holdWake() { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ } }
  function releaseWake() { try { wake?.release(); } catch { /* ignore */ } wake = null; }

  function start() {
    audio(); // must be created inside the tap so phones allow sound
    if (phase === 'done') return;
    if (phase === 'idle') { fired = new Set(); elapsed = 0; phase = 'count'; t0 = now(); holdWake(); loop(); tick(); return; }
    if (phase === 'paused') { phase = 'run'; t0 = now(); holdWake(); loop(); paint('Match running'); return; }
  }
  function pause() {
    if (phase === 'count') { phase = 'idle'; fired = new Set(); stop(); paint('Ready — 2:30 match'); return; }
    if (phase === 'run') { elapsed += now() - t0; phase = 'paused'; stop(); paint('Paused'); }
  }
  function reset() { stop(); phase = 'idle'; elapsed = 0; fired = new Set(); paint('Ready — 2:30 match'); }
  const toggle = () => (phase === 'run' || phase === 'count' ? pause() : start());

  $('#tm-go').addEventListener('click', toggle);
  $('#tm-reset').addEventListener('click', reset);
  $('#tm-test').addEventListener('click', () => { audio(); beep(); setTimeout(chime, 500); setTimeout(() => horn(1.2), 1300); });
  $('#tm-vol').addEventListener('input', () => { if (master) master.gain.value = +$('#tm-vol').value / 100; });
  $('#tm-full').addEventListener('click', () => {
    const el = $('#tm');
    if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {});
  });
  const key = (e) => {
    if (e.code !== 'Space' || /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    e.preventDefault(); toggle();
  };
  document.addEventListener('keydown', key);
  const pop = $('#tm-pop');
  const closePop = () => { pop.hidden = true; $('#tm-go').focus(); };
  $('#tm-pop-ok').addEventListener('click', () => { audio(); closePop(); });
  $('#tm-pop-test').addEventListener('click', () => { audio(); beep(); setTimeout(chime, 500); setTimeout(() => horn(1.0), 1300); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  setTimeout(() => $('#tm-pop-ok')?.focus(), 0);
  paint();

  return {
    destroy() { stop(); document.removeEventListener('keydown', key); try { ctx?.close(); } catch { /* ignore */ } },
    // for tests
    _debug: { get phase() { return phase; }, setClock(sec) { elapsed = MATCH_SECONDS - sec; } },
  };
}

export function timerView(root) {
  root.innerHTML = '<h1 class="page-title">Match timer</h1><div id="tmw"></div>';
  const t = mountTimer(root.querySelector('#tmw'));
  return { destroy: () => t.destroy() };
}
