/* Aurora glow for the hero tile (shader from Direction A "Cinematic").
 * Rendered small and upscaled; colour and energy follow the period's health:
 * calm green, warm amber, deep red. Outputs light with alpha, so the same
 * frame sits on the light or the dark tile. Falls back to CSS blobs. */
(function (root) {
  const PAL = {
    healthy: { a: [0.16, 0.92, 0.62], b: [0.04, 0.56, 0.60], c: [0.30, 0.52, 0.95], e: 0.16 },
    tight:   { a: [1.00, 0.74, 0.26], b: [0.98, 0.50, 0.16], c: [0.92, 0.34, 0.22], e: 0.42 },
    short:   { a: [1.00, 0.26, 0.32], b: [0.78, 0.08, 0.22], c: [0.62, 0.10, 0.48], e: 0.85 },
  };
  const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  const FS = `
precision highp float;
uniform vec2 R; uniform float T; uniform vec3 A,B,C; uniform float E,K,L; uniform vec2 M;
varying vec2 v;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*n(p);p=m*p;a*=.5;}return s;}
vec3 curtain(vec2 p,float base,float amp,float seed,float t,vec3 lo,vec3 hi,float rayF){
  float wx=p.x+.35*fbm(vec2(p.x*1.1+seed,p.y*.9+t*.06))-.15;
  float w=base+amp*(fbm(vec2(wx*.55+seed,t*.04))-.5)*2.6+.03*sin(wx*2.3+t*.38+seed);
  float d=p.y-w;
  float r=pow(n(vec2(wx*rayF+seed*7.,t*.18+seed)),2.)*1.25+pow(n(vec2(wx*rayF*.28-seed,t*.09)),1.5)*.9;
  r*=.7+.5*n(vec2(wx*rayF*2.3-seed,t*.35));
  float pres=.3+.7*smoothstep(.2,.66,fbm(vec2(wx*.42+seed*3.,t*.025+seed)));
  float body=smoothstep(-.014,.004,d)*exp(-max(d,0.)*(2.6-E*.6));
  float edge=exp(-d*d*900.)*1.1;
  float I=(body*r+edge*(.5+.6*r))*pres;
  return mix(lo,hi,smoothstep(.0,.34,d))*I;
}
void main(){
  float asp=R.x/R.y; vec2 uv=v;
  vec2 p=vec2(uv.x*asp,uv.y)+(M-.5)*vec2(.12,.05);
  float t=T; vec3 c=vec3(0.);
  c+=curtain(p,.40,.08,1.3,t,A,C,13.)*1.2;
  c+=curtain(p+vec2(.9,0.),.58,.06,4.7,t*1.15,mix(A,B,.5),C,19.)*.6;
  c+=curtain(p+vec2(2.1,0.),.30,.05,8.1,t*.9,B,A,9.)*.3;
  float f=fbm(p*1.3+vec2(t*.04,-t*.03));
  c+=mix(B,C,f)*pow(f,3.)*.55;
  c*=1.+K*.7;
  float vig=smoothstep(1.5,.15,length((uv-vec2(.62,.6))*vec2(asp*.55,1.05)));
  c*=vig;
  c=c/(1.+c*.85);
  float a=clamp(max(c.r,max(c.g,c.b))*L,0.,1.);
  gl_FragColor=vec4(c*min(1.,L),a);
}`;
  const lerp = (a, b, t) => a + (b - a) * t;
  const Aurora = {
    ok: false,
    init(canvas, opts = {}) {
      const reduce = !!opts.reduce;
      if (this._frame) cancelAnimationFrame(this._frame);
      if (reduce) {
        document.documentElement.classList.add('reduce');
        return;
      }
      let gl = null;
      try { gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true }); } catch (e) { gl = null; }
      if (!gl) { document.documentElement.classList.add('no-webgl'); return; }
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      let U = {};
      try {
        const pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        ['R', 'T', 'A', 'B', 'C', 'E', 'K', 'M', 'L'].forEach(k => { U[k] = gl.getUniformLocation(pr, k); });
      } catch (e) { document.documentElement.classList.add('no-webgl'); return; }
      this.ok = true;
      document.documentElement.classList.add('has-aurora');
      const cur = { a: PAL.healthy.a.slice(), b: PAL.healthy.b.slice(), c: PAL.healthy.c.slice(), e: PAL.healthy.e };
      this.target = PAL.healthy;
      let time = 9.4, kick = 0, mx = .5, my = .5, tmx = .5, tmy = .5, dirty = true, last = 0, visible = true, light = 1;
      const scale = opts.scale || 0.45;
      const size = () => {
        const r = canvas.getBoundingClientRect();
        const w = Math.max(64, Math.round(r.width * scale)), hgt = Math.max(64, Math.round(r.height * scale));
        if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; gl.viewport(0, 0, w, hgt); dirty = true; }
      };
      size(); addEventListener('resize', size);
      if ('IntersectionObserver' in root) new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
      this.setLight = v => { light = v; dirty = true; };
      const self = this;
      const frame = ts => {
        self._frame = requestAnimationFrame(frame);
        const dt = last ? Math.min(.05, Math.max(.001, (ts - last) / 1000)) : .016; last = ts;
        if (!visible || document.hidden || document.body.classList.contains('is-open')) return; // paused under the panel so the morph stays smooth
        const tg = this.target, s = reduce ? 1 : 1 - Math.exp(-dt * 2.6);
        let moved = false;
        ['a', 'b', 'c'].forEach(k => { for (let i = 0; i < 3; i++) { const nv = lerp(cur[k][i], tg[k][i], s); if (Math.abs(nv - cur[k][i]) > 1e-4) moved = true; cur[k][i] = nv; } });
        cur.e = lerp(cur.e, tg.e, s);
        if (reduce) { if (!moved && !dirty) return; dirty = false; }
        else { time += dt * (0.28 + cur.e * 0.8 + kick * 1.6); kick *= Math.exp(-dt * 2.2); mx = lerp(mx, tmx, 1 - Math.exp(-dt * 3)); my = lerp(my, tmy, 1 - Math.exp(-dt * 3)); }
        gl.uniform2f(U.R, canvas.width, canvas.height);
        gl.uniform1f(U.T, time);
        gl.uniform3fv(U.A, cur.a); gl.uniform3fv(U.B, cur.b); gl.uniform3fv(U.C, cur.c);
        gl.uniform1f(U.E, cur.e); gl.uniform1f(U.K, reduce ? 0 : kick); gl.uniform1f(U.L, light);
        gl.uniform2f(U.M, mx, my);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      this._frame = requestAnimationFrame(frame);
      this.pointer = (x, y) => { if (!reduce) { tmx = x; tmy = 1 - y; } };
      this.kick = (v = 1) => { if (!reduce) kick = Math.min(1.6, kick + v); };
      this.resize = size;
    },
    set() { if (this.ok) this.target = PAL.healthy; },
    pointer() {}, kick() {}, resize() {}, setLight() {},
  };
  root.Aurora = Aurora;
})(globalThis);
