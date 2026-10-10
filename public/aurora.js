/* Aurora glow for the hero tile (shader from Direction A "Cinematic").
 * Rendered small and upscaled in a fixed decorative palette. It does not
 * classify financial health. Outputs light with alpha, so the same
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
  const noop = () => {};
  const Aurora = {
    ok: false,
    destroy() {
      const dispose = this._dispose;
      this._dispose = null;
      if (dispose) dispose();
      this.ok = false;
      this.pointer = this.kick = this.resize = this.setLight = noop;
      document.documentElement.classList.remove('has-aurora');
    },
    init(canvas, opts = {}) {
      this.destroy();
      if (!canvas) return;
      const media = typeof root.matchMedia === 'function'
        ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
      const reduce = !!opts.reduce || !!media?.matches;
      const html = document.documentElement;
      html.classList.toggle('reduce', reduce);
      html.classList.remove('has-aurora', 'no-webgl');
      canvas.hidden = reduce;
      // This state is decorative only. Preserve its phase when the native
      // surface remounts; a period change must not restart the curtain.
      const state = this._motion || (this._motion = {
        time: 9.4, kick: 0, mx: .5, my: .5, tmx: .5, tmy: .5, light: 1,
      });
      this.target = PAL.healthy;
      this.setLight = value => { if (Number.isFinite(value)) state.light = value; };
      let disposed = false, gl = null, program = null, buffer = null;
      let observer = null, size = noop;
      const shaders = [];
      const releaseGraphics = () => {
        if (!gl) return;
        gl.useProgram(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        shaders.splice(0).forEach(shader => gl.deleteShader(shader));
        buffer = program = null;
      };
      const onMotion = event => {
        if (disposed) return;
        if (!canvas.isConnected) { this.destroy(); return; }
        this.init(canvas, { ...opts, reduce: event.matches });
      };
      if (media?.addEventListener) media.addEventListener('change', onMotion);
      else if (media?.addListener) media.addListener(onMotion);
      this._dispose = () => {
        disposed = true;
        if (this._frame) cancelAnimationFrame(this._frame);
        this._frame = 0;
        root.removeEventListener('resize', size);
        observer?.disconnect();
        if (media?.removeEventListener) media.removeEventListener('change', onMotion);
        else if (media?.removeListener) media.removeListener(onMotion);
        releaseGraphics();
        canvas.hidden = true;
      };
      // No WebGL work or animation loop while reduced motion is requested.
      // Keep the preference listener so changing it can resume this same canvas.
      if (reduce) return;
      try { gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true }); } catch (e) { gl = null; }
      if (!gl) { html.classList.add('no-webgl'); return; }
      const shader = (type, source) => {
        const result = gl.createShader(type);
        shaders.push(result);
        gl.shaderSource(result, source);
        gl.compileShader(result);
        if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
        return result;
      };
      const U = {};
      try {
        program = gl.createProgram();
        gl.attachShader(program, shader(gl.VERTEX_SHADER, VS));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        gl.useProgram(program);
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        ['R', 'T', 'A', 'B', 'C', 'E', 'K', 'M', 'L'].forEach(key => { U[key] = gl.getUniformLocation(program, key); });
      } catch (e) {
        releaseGraphics();
        html.classList.add('no-webgl');
        return;
      }
      this.ok = true;
      html.classList.add('has-aurora');
      let last = 0, visible = true;
      const scale = opts.scale || 0.45;
      size = () => {
        if (disposed || !canvas.isConnected) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(64, Math.round(rect.width * scale));
        const height = Math.max(64, Math.round(rect.height * scale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width; canvas.height = height;
          gl.viewport(0, 0, width, height);
        }
      };
      size();
      root.addEventListener('resize', size);
      if ('IntersectionObserver' in root) {
        observer = new root.IntersectionObserver(([entry]) => { if (!disposed && entry) visible = entry.isIntersecting; });
        observer.observe(canvas);
      }
      const frame = ts => {
        if (disposed) return;
        this._frame = 0;
        if (!canvas.isConnected) { this.destroy(); return; }
        this._frame = requestAnimationFrame(frame);
        const dt = last ? Math.min(.05, Math.max(.001, (ts - last) / 1000)) : .016;
        last = ts;
        const body = document.body;
        if (!visible || document.hidden || body.classList.contains('is-open')
          || body.classList.contains('budget-detail-open')) return;
        // Fixed healthy palette is artwork, not a health classification.
        const palette = PAL.healthy;
        state.time += dt * (0.28 + palette.e * 0.8 + state.kick * 1.6);
        state.kick *= Math.exp(-dt * 2.2);
        state.mx = lerp(state.mx, state.tmx, 1 - Math.exp(-dt * 3));
        state.my = lerp(state.my, state.tmy, 1 - Math.exp(-dt * 3));
        gl.uniform2f(U.R, canvas.width, canvas.height);
        gl.uniform1f(U.T, state.time);
        gl.uniform3fv(U.A, palette.a); gl.uniform3fv(U.B, palette.b); gl.uniform3fv(U.C, palette.c);
        gl.uniform1f(U.E, palette.e); gl.uniform1f(U.K, state.kick); gl.uniform1f(U.L, state.light);
        gl.uniform2f(U.M, state.mx, state.my);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      this._frame = requestAnimationFrame(frame);
      this.pointer = (x, y) => { state.tmx = x; state.tmy = 1 - y; };
      this.kick = (value = 1) => { state.kick = Math.min(1.6, state.kick + value); };
      this.resize = size;
    },
    set() { if (this.ok) this.target = PAL.healthy; },
    pointer: noop, kick: noop, resize: noop, setLight: noop,
  };
  root.Aurora = Aurora;
})(globalThis);
