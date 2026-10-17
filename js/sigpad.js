// Minimal pointer-based signature pad (mouse, touch, pen). Exports a small PNG data URL.
export class SigPad {
  constructor(canvas, onChange = () => {}) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.onChange = onChange;
    this.drawing = false; this.dirty = false;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(ev, () => this.up());
    this.resize();
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const keep = this.dirty ? this.c.toDataURL() : null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineWidth = 2.4; this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#111';
    if (keep) { const img = new Image(); img.onload = () => this.ctx.drawImage(img, 0, 0, r.width, r.height); img.src = keep; }
  }
  pos(e) { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  down(e) {
    e.preventDefault(); this.drawing = true; this.c.setPointerCapture?.(e.pointerId);
    const [x, y] = this.pos(e); this.ctx.beginPath(); this.ctx.moveTo(x, y); this.ctx.lineTo(x + 0.01, y + 0.01); this.ctx.stroke();
    this.mark();
  }
  move(e) { if (!this.drawing) return; e.preventDefault(); const [x, y] = this.pos(e); this.ctx.lineTo(x, y); this.ctx.stroke(); this.mark(); }
  up() { this.drawing = false; }
  mark() { if (!this.dirty) { this.dirty = true; } this.onChange(true); }
  clear() {
    const r = this.c.getBoundingClientRect();
    this.ctx.clearRect(0, 0, r.width, r.height); this.dirty = false; this.onChange(false);
  }
  get isEmpty() { return !this.dirty; }
  // White-background PNG scaled to ≤ 480px wide, so a score doc stays small.
  toDataURL() {
    const w = Math.min(480, this.c.width), h = Math.round(this.c.height * (w / this.c.width));
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    const x = o.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(this.c, 0, 0, w, h);
    return o.toDataURL('image/png');
  }
}
