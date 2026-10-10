/* The pay-period river (Direction A "Cinematic" date selector, adapted).
 * The year as a line of light: height = each period's Balance After Deductions,
 * amber/red beads glow for tight/short periods. Drag or scrub like a film; the
 * playhead springs to the nearest pay period on release (with fling).
 * Changes from A: it lives in the page flow (no fixed dock, so nothing sits
 * under it on phones), it carries month groups and each period's value, and
 * when the year is wider than the screen it pans under a centred playhead. */
(function (root) {
  class Spring {
    constructor(v, o = {}) { this.x = v; this.v = 0; this.target = v; this.k = o.k || 170; this.c = o.c || 26; }
    step(dt) {
      const n = Math.ceil(dt / 0.008), h = dt / n;
      for (let i = 0; i < n; i++) { const a = -this.k * (this.x - this.target) - this.c * this.v; this.v += a * h; this.x += this.v * h; }
      if (Math.abs(this.v) < 1e-3 && Math.abs(this.x - this.target) < 1e-3) { this.x = this.target; this.v = 0; }
      return this.x;
    }
    get settled() { return this.x === this.target && this.v === 0; }
    set(v) { this.x = this.target = v; this.v = 0; }
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const COL = { healthy: [92, 242, 176], tight: [255, 190, 92], short: [255, 86, 102] };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const sprites = new Map();
  const glow = c => {
    const key = c.join(',');
    if (sprites.has(key)) return sprites.get(key);
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.38, `rgba(${key},.55)`); g.addColorStop(1, `rgba(${key},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); sprites.set(key, cv); return cv;
  };
  function monotone(xs, ys) {
    const n = xs.length, d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return m;
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const River = {
    init(o) {
      Object.assign(this, o);
      this.N = this.periods.length;
      this.ctx = this.canvas.getContext('2d');
      this.head = new Spring(this.index, { k: 190, c: 27 });
      this.dragging = false;
      this.parts = Array.from({ length: 40 }, (_, i) => ({ u: (i * 0.6180339) % 1, sp: 0.03 + ((i * 7) % 11) / 220, r: 0.6 + ((i * 5) % 9) / 6, o: (i * 0.37) % 1 }));
      this.reveal = this.reduce || o.noIntro ? 1 : 0;
      this.layout();
      addEventListener('resize', () => this.layout());
      this.bind();
      let last = 0;
      const loop = ts => { requestAnimationFrame(loop); const dt = last ? Math.min(.05, Math.max(.001, (ts - last) / 1000)) : .016; last = ts; if (document.body.classList.contains('is-open')) return; /* paused under the panel: keeps the tile ↔ panel morph smooth */ this.frame(dt, ts / 1000); };
      requestAnimationFrame(loop);
    },
    layout() {
      const r = this.el.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      this.W = r.width; this.H = r.height;
      if (!this.W) return;
      this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mobile = this.W < 640;
      this.padL = mobile ? 26 : 36; this.padR = this.padL;
      this.top = 52; this.bot = this.H - (mobile ? 50 : 52);
      const fit = (this.W - this.padL - this.padR) / (this.N - 1), minSp = mobile ? 44 : 52;
      this.pan = fit < minSp;
      this.sp = this.pan ? minSp : fit;
      this.CW = this.padL + this.sp * (this.N - 1) + this.padR;
      this.build();
      this.labels();
      this.place(this.head.x);
    },
    build() {
      const vals = this.periods.map(p => p.bad);
      const vmax = Math.max(...vals), vmin = Math.min(0, ...vals), span = vmax - vmin || 1;
      this.yOf = v => this.bot - (v - vmin) / span * (this.bot - this.top);
      this.xs = this.periods.map((_, i) => this.xc(i));
      this.ys = vals.map(this.yOf);
      this.ms = monotone(this.xs, this.ys);
      this.y0 = this.yOf(0);
      this.path = new Path2D();
      this.path.moveTo(this.xs[0], this.ys[0]);
      for (let i = 0; i < this.N - 1; i++) {
        const h = this.xs[i + 1] - this.xs[i];
        this.path.bezierCurveTo(this.xs[i] + h / 3, this.ys[i] + this.ms[i] * h / 3, this.xs[i + 1] - h / 3, this.ys[i + 1] - this.ms[i + 1] * h / 3, this.xs[i + 1], this.ys[i + 1]);
      }
      this.area = new Path2D(this.path);
      this.area.lineTo(this.xs[this.N - 1], this.bot + 6); this.area.lineTo(this.xs[0], this.bot + 6); this.area.closePath();
      const g = (k) => { const gr = this.ctx.createLinearGradient(this.xs[0], 0, this.xs[this.N - 1], 0);
        this.periods.forEach((p, i) => { const c = COL[p.state]; gr.addColorStop(i / (this.N - 1), rgba(k ? c.map(v => Math.round(v + (255 - v) * k)) : c, 1)); }); return gr; };
      this.grad = g(0); this.gradCore = g(0.55);
      this.monthX = [];
      this.periods.forEach((p, i) => { const prev = this.periods[i - 1]; if (i && prev.start.slice(0, 7) !== p.start.slice(0, 7)) this.monthX.push(this.xs[i] - this.sp / 2); });
    },
    /* periods changed (e.g. a Confirm): redraw the curve and labels */
    update() { this.build(); this.labels(); },
    labels() {
      const fmt = this.fmt;
      let mh = '', vh = '', yearDone = false;
      // first month only gets a label if it owns at least 2 periods (otherwise it collides with the next)
      const firstNew = this.periods.findIndex((p, i) => i && p.start.slice(0, 7) !== this.periods[i - 1].start.slice(0, 7));
      this.periods.forEach((p, i) => {
        const x = this.xs[i], prev = this.periods[i - 1];
        if (!prev ? firstNew === -1 || firstNew >= 2 : prev.start.slice(0, 7) !== p.start.slice(0, 7)) {
          const m = +p.start.slice(5, 7) - 1, yr = m === 0 || !yearDone;
          yearDone = true;
          mh += `<span style="left:${(Math.max(x - this.sp / 2, 0) + 6).toFixed(1)}px"${m === 0 ? ' class="is-year"' : ''}>${MON[m]}${yr ? ` <b>${p.start.slice(0, 4)}</b>` : ''}</span>`;
        }
        vh += `<span class="rv" data-i="${i}" data-state="${p.state}" style="left:${x.toFixed(1)}px">${fmt(p.bad)}</span>`;
      });
      this.monthsEl.innerHTML = mh;
      this.valsEl.innerHTML = vh;
      this.valEls = Array.from(this.valsEl.children);
      this.mark(this.index);
    },
    mark(i) { if (this.valEls) this.valEls.forEach((e, k) => { e.classList.toggle('is-sel', k === i); e.classList.toggle('is-past', k < this.cur); }); },
    xc(f) { return this.padL + f * this.sp; },
    offFor(f) { return this.pan ? clamp(this.xc(f) - this.W / 2, 0, this.CW - this.W) : 0; },
    fOfScreen(x) { return clamp((x + this.off - this.padL) / this.sp, 0, this.N - 1); },
    yAt(f) {
      const i = clamp(Math.floor(f), 0, this.N - 2), t = f - i, h = this.xs[i + 1] - this.xs[i];
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * this.ys[i] + (t3 - 2 * t2 + t) * h * this.ms[i] + (-2 * t3 + 3 * t2) * this.ys[i + 1] + (t3 - t2) * h * this.ms[i + 1];
    },
    bind() {
      const el = this.el;
      let lastX = 0, lastT = 0, vel = 0, downX = 0, downF = 0, moved = false, pid = null;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        pid = e.pointerId; this.dragging = true; moved = false; downX = e.clientX; downF = this.head.x;
        lastX = e.clientX; lastT = performance.now(); vel = 0;
        el.classList.add('is-dragging');
        if (!this.pan) { const r = el.getBoundingClientRect(); this.head.target = this.fOfScreen(e.clientX - r.left); }
      });
      el.addEventListener('pointermove', e => {
        if (!this.dragging || e.pointerId !== pid) return;
        if (Math.abs(e.clientX - downX) > 5 && !moved) { moved = true; try { el.setPointerCapture(e.pointerId); } catch (er) { /* gone */ } }
        const now = performance.now(), dt = Math.max(1, now - lastT);
        vel = 0.75 * vel + 0.25 * ((e.clientX - lastX) / dt);
        lastX = e.clientX; lastT = now;
        if (this.pan) { if (moved) this.head.target = clamp(downF - (e.clientX - downX) / this.sp, 0, this.N - 1); }
        else { const r = el.getBoundingClientRect(); this.head.target = this.fOfScreen(e.clientX - r.left); }
        const i = Math.round(this.head.target);
        if (moved && i !== this.index) { this.index = i; this.mark(i); this.onChange && this.onChange(i, 'scrub'); }
      });
      const end = e => {
        if (!this.dragging) return;
        this.dragging = false; el.classList.remove('is-dragging');
        if (this.pan && !moved) { const r = el.getBoundingClientRect(); this.go(Math.round(this.fOfScreen(e.clientX - r.left))); return; }
        const fresh = performance.now() - lastT < 80 && Math.abs(vel) > 0.6;
        const fling = moved && fresh ? clamp((this.pan ? -vel : vel) * 140 / this.sp, -4, 4) : 0;
        this.go(Math.round(clamp(this.head.target + fling, 0, this.N - 1)));
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('keydown', e => {
        const k = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 6, PageDown: -6 }[e.key];
        if (k) { e.preventDefault(); this.go(clamp(this.index + k, 0, this.N - 1)); }
        else if (e.key === 'Home') { e.preventDefault(); this.go(0); }
        else if (e.key === 'End') { e.preventDefault(); this.go(this.N - 1); }
      });
      let acc = 0, accT = 0;
      el.addEventListener('wheel', e => {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        e.preventDefault();
        if (performance.now() - accT > 400) acc = 0;
        accT = performance.now(); acc += d;
        if (Math.abs(acc) > 60) { this.go(clamp(this.index + Math.sign(acc), 0, this.N - 1)); acc = 0; }
      }, { passive: false });
      if (matchMedia('(hover: hover)').matches) {
        el.addEventListener('pointermove', e => { if (this.dragging) return; const r = el.getBoundingClientRect(); this.hover = Math.round(this.fOfScreen(e.clientX - r.left)); this.hoverVal(); });
        el.addEventListener('pointerleave', () => { this.hover = null; this.hoverVal(); });
      }
    },
    hoverVal() { if (this.valEls) this.valEls.forEach((e, k) => e.classList.toggle('is-hover', k === this.hover)); },
    go(i, instant) {
      const changed = i !== this.index;
      this.index = i; this.head.target = i; this.mark(i);
      if (instant || this.reduce) this.head.set(i);
      if (changed || !instant) this.onChange && this.onChange(i, 'commit');
    },
    place(f) {
      this.off = this.offFor(f);
      const x = this.xc(f) - this.off, y = this.yAt(f);
      this.playhead.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      this.playhead.style.setProperty('--orb-y', `${y.toFixed(2)}px`);
      this.playhead.style.setProperty('--beam-top', `${this.top - 12}px`);
      this.slide.style.transform = `translate3d(${(-this.off).toFixed(2)}px,0,0)`;
      const pw = this.pill.offsetWidth || 160;
      const shift = clamp(-pw / 2, -x + 8, this.W - x - pw - 8);
      this.pill.style.transform = `translate3d(${shift.toFixed(2)}px,0,0)`;
    },
    frame(dt, t) {
      if (!this.W) { this.layout(); if (!this.W) return; }
      const f = this.head.step(dt);
      this.place(f);
      if (this.reveal < 1) this.reveal = Math.min(1, this.reveal + dt / 1.6);
      if (this.reduce && this._drawn && this.head.settled && !this.dragging && this._lastF === f && !this._dirty) return;
      this._drawn = true; this._lastF = f; this._dirty = false;
      this.draw(t, f);
    },
    draw(t, f) {
      const c = this.ctx, W = this.W, H = this.H, off = this.off;
      c.clearRect(0, 0, W, H);
      c.save(); c.translate(-off, 0);
      const rev = 1 - Math.pow(1 - this.reveal, 3);
      const revX = this.xs[0] + (this.xs[this.N - 1] - this.xs[0] + 20) * rev;
      c.beginPath(); c.rect(off - 10, 0, revX - off + 10, H); c.clip();
      const xCur = this.xc(this.cur - 0.5);
      /* month groups */
      c.fillStyle = 'rgba(255,255,255,.07)';
      this.monthX.forEach(x => c.fillRect(Math.round(x), this.top - 26, 1, this.bot - this.top + 34));
      /* river body */
      c.save();
      c.globalAlpha = 0.22; c.fillStyle = this.grad; c.fill(this.area);
      c.globalCompositeOperation = 'destination-out';
      const fade = c.createLinearGradient(0, this.top, 0, this.bot + 6);
      fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
      c.globalAlpha = 1; c.fillStyle = fade; c.fillRect(off - 10, this.top - 40, W + 20, this.bot - this.top + 50);
      c.restore();
      /* zero line */
      c.save(); c.setLineDash([2, 6]); c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(this.xs[0] - 18, this.y0 + .5); c.lineTo(this.xs[this.N - 1] + 18, this.y0 + .5); c.stroke(); c.restore();
      /* glow + core, past dimmed */
      const pass = a => {
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = this.grad; c.lineCap = 'round'; c.lineJoin = 'round';
        c.globalAlpha = 0.07 * a; c.lineWidth = 16; c.stroke(this.path);
        c.globalAlpha = 0.16 * a; c.lineWidth = 7; c.stroke(this.path);
        c.globalAlpha = 0.95 * a; c.lineWidth = 2; c.strokeStyle = this.gradCore; c.stroke(this.path);
      };
      c.save(); c.beginPath(); c.rect(off - 10, 0, xCur - off + 10, H); c.clip(); pass(0.42); c.restore();
      c.save(); c.beginPath(); c.rect(xCur, 0, W + off - xCur + 10, H); c.clip(); pass(1); c.restore();
      /* period beads: amber / red glow for tight / short */
      c.globalCompositeOperation = 'lighter';
      this.periods.forEach((p, i) => {
        const x = this.xs[i], y = this.ys[i], col = COL[p.state], a = i < this.cur ? 0.5 : 1;
        if (x < off - 30 || x > off + W + 30) return;
        if (p.state !== 'healthy') {
          const pulse = this.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * (p.state === 'short' ? 4 : 2.2) + i);
          const rr = (p.state === 'short' ? 15 : 10) + pulse * 4;
          const g = c.createRadialGradient(x, y, 0, x, y, rr);
          g.addColorStop(0, rgba(col, 0.6 * a)); g.addColorStop(1, rgba(col, 0));
          c.fillStyle = g; c.globalAlpha = 1; c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill();
        }
        c.globalAlpha = a; c.fillStyle = rgba(col.map(v => Math.round(v + (255 - v) * 0.4)), 1);
        c.beginPath(); c.arc(x, y, p.state === 'healthy' ? 2.4 : 3.6, 0, 7); c.fill();
      });
      /* light flowing downstream */
      if (!this.reduce) {
        this.parts.forEach(pt => {
          pt.u += pt.sp * 0.016 * (this.dragging ? 2.2 : 1);
          if (pt.u > 1) pt.u -= 1;
          const ff = pt.u * (this.N - 1), x = this.xc(ff);
          if (x < off - 20 || x > off + W + 20) return;
          const y = this.yAt(ff), col = COL[this.periods[Math.round(ff)].state];
          const a = (ff < this.cur - 0.5 ? 0.35 : 0.9) * (0.5 + 0.5 * Math.sin(t * 3 + pt.o * 6));
          const rr = 3 + pt.r * 3;
          c.globalAlpha = Math.max(0, a); c.drawImage(glow(col), x - rr, y - rr, rr * 2, rr * 2);
        });
      }
      /* today */
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      const xt = this.xs[this.cur], yt = this.y0;
      c.fillStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.moveTo(xt, yt - 5); c.lineTo(xt + 5, yt); c.lineTo(xt, yt + 5); c.lineTo(xt - 5, yt); c.closePath(); c.fill();
      /* lens: brighten the selected stretch */
      const xs = this.xc(f), ys = this.yAt(f);
      const lg = c.createRadialGradient(xs, ys, 0, xs, ys, 90);
      lg.addColorStop(0, 'rgba(255,255,255,.10)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalCompositeOperation = 'lighter'; c.fillStyle = lg; c.fillRect(xs - 90, 0, 180, H);
      c.restore();
    },
  };
  root.River = River;
})(globalThis);
