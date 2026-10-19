/*
 * The Almanac's 3D viewer: draws a model as the game drew it - its corners, colours, texture places and light exactly
 * as the game's renderers handed them over - with WebGL 2. Models and textures arrive as small scripts
 * (AOA.model, AOA.texture), so the page works opened straight from the disk.
 */
(function () {
  'use strict';
  var AOA = window.AOA = window.AOA || {};
  var waiting = {}, models = {}, textures = {};

  // ------------------------------------------------------------------ loading
  function script(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { s.remove(); ok(); };
      s.onerror = function () { s.remove(); fail(new Error('missing ' + src)); };
      document.head.appendChild(s);
    });
  }
  function wait(kind, key, src) {
    var id = kind + ':' + key;
    var have = kind === 'm' ? models[key] : textures[key];
    if (have) return Promise.resolve(have);
    if (!waiting[id]) {
      var w = waiting[id] = {};
      w.promise = new Promise(function (ok, fail) { w.ok = ok; w.fail = fail; });
      script(src).catch(function (e) { w.fail(e); delete waiting[id]; });
    }
    return waiting[id].promise;
  }
  AOA.model = function (key, meta, b64) {
    models[key] = { meta: meta, b64: b64 };
    var w = waiting['m:' + key]; if (w) { w.ok(models[key]); delete waiting['m:' + key]; }
  };
  AOA.texture = function (key, meta, pngs) {
    textures[key] = { meta: meta, pngs: pngs };
    var w = waiting['t:' + key]; if (w) { w.ok(textures[key]); delete waiting['t:' + key]; }
  };
  AOA.loadModel = function (key) { return wait('m', key, 'models/' + key + '.js'); };
  AOA.loadTexture = function (key) { return wait('t', key, 'textures/' + key + '.js'); };

  function bytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser is too old to unpack the models'));
    var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer();
  }

  // ------------------------------------------------------------------ maths (column-major 4x4)
  var M = {
    ident: function () { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    mul: function (a, b) {
      var o = new Float32Array(16);
      for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    persp: function (fov, asp, n, f) {
      var t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
    },
    ortho: function (l, r, b, t, n, f) {
      var o = M.ident();
      o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
      o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); return o;
    },
    trans: function (x, y, z) { var o = M.ident(); o[12] = x; o[13] = y; o[14] = z; return o; },
    rotX: function (a) { var c = Math.cos(a), s = Math.sin(a), o = M.ident(); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; },
    rotY: function (a) { var c = Math.cos(a), s = Math.sin(a), o = M.ident(); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; },
    lookAt: function (e, t) {
      var zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2], zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
      var xx = zz, xy = 0, xz = -zx, xl = Math.hypot(xx, xz) || 1; xx /= xl; xz /= xl;
      var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      var o = M.ident();
      o[0] = xx; o[4] = xy; o[8] = xz; o[1] = yx; o[5] = yy; o[9] = yz; o[2] = zx; o[6] = zy; o[10] = zz;
      o[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); o[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); o[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
      return o;
    }
  };

  // ------------------------------------------------------------------ shaders
  var VS = '#version 300 es\n' +
    'in vec3 aPos;in vec3 aPos2;in vec2 aUV;in vec4 aCol;in vec3 aNrm;in float aLight;\n' +
    'uniform mat4 uView,uProj;uniform vec3 uMin,uStep;uniform float uMix;uniform vec4 uUV;uniform int uMode;uniform float uDay;\n' +
    'out vec2 vUV;out vec4 vCol;out float vShade;out float vDist;\n' +
    'const vec3 L0=vec3(0.24,0.82,0.52);const vec3 L1=vec3(-0.46,0.55,0.70);\n' +
    'float curve(float l){float b=l/(4.0-3.0*l);return mix(b,1.0-pow(1.0-b,4.0),0.5);}\n' +
    'void main(){vec3 p=uMin+mix(aPos,aPos2,uMix)*uStep;vec4 v=uView*vec4(p,1.0);gl_Position=uProj*v;vDist=length(v.xyz);\n' +
    ' vUV=uUV.xy+aUV*uUV.zw;vCol=aCol;\n' +
    ' if(uMode==0){vec3 n=normalize(mat3(uView)*aNrm+vec3(0.0,0.0,1e-5));vShade=min(1.0,0.4+0.6*(max(0.0,dot(n,normalize(L0)))+max(0.0,dot(n,normalize(L1)))));}\n' +
    ' else if(uMode==1){float sky=mod(aLight,16.0)/15.0;float blk=floor(aLight/16.0+0.001)/15.0;vShade=0.04+0.96*curve(max(sky*uDay,blk));}\n' +
    ' else{vShade=1.0;}}';
  var FS = '#version 300 es\nprecision highp float;\n' +
    'in vec2 vUV;in vec4 vCol;in float vShade;in float vDist;uniform sampler2D uTex;uniform int uMode;uniform float uCut;uniform int uTextured;\n' +
    'uniform vec3 uFog;uniform vec2 uFogRange;uniform int uFogOn;out vec4 o;\n' +
    'void main(){vec4 t=(uTextured==1?texture(uTex,vUV):vec4(1.0))*vCol;if(t.a<uCut)discard;vec3 c=t.rgb*vShade;\n' +
    ' if(uFogOn==1){float f=clamp((vDist-uFogRange.x)/max(1.0,uFogRange.y-uFogRange.x),0.0,1.0);c=mix(c,uFog,f);}\n' +
    ' o=vec4(c,t.a);}';
  var SHADOW_VS = '#version 300 es\nin vec2 aP;uniform mat4 uView,uProj;uniform vec3 uC;uniform float uR;out vec2 vP;\n' +
    'void main(){vP=aP;gl_Position=uProj*uView*vec4(uC+vec3(aP.x*uR,0.0,aP.y*uR),1.0);}';
  var SHADOW_FS = '#version 300 es\nprecision mediump float;in vec2 vP;uniform float uA;out vec4 o;\n' +
    'void main(){float d=length(vP);o=vec4(0.0,0.0,0.0,uA*smoothstep(1.0,0.0,d)*smoothstep(1.0,0.35,d));}';

  function compile(gl, vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    var at = {}, m = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (var k = 0; k < m; k++) { var b = gl.getActiveAttrib(p, k); at[b.name] = gl.getAttribLocation(p, b.name); }
    return { p: p, u: u, a: at };
  }

  // ------------------------------------------------------------------ the viewer
  function Viewer(canvas, opts) {
    opts = opts || {};
    this.still = !!opts.still;
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: !!opts.still });
    if (!gl) throw new Error('This browser has no WebGL 2');
    this.gl = gl; this.canvas = canvas;
    this.prog = compile(gl, VS, FS);
    this.shadow = compile(gl, SHADOW_VS, SHADOW_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.tex = {};
    this.white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.model = null;
    this.state = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0, ortho: false };
    this.time = 0; this.playing = true; this.spinning = false; this.vel = 0; this.velP = 0;
    this.dirty = true;
    if (this.still) return;                               // a still (the gallery's pictures): drawn when asked, no loop, no pointer
    this.input();
    var self = this, last = performance.now();
    (function frame(now) {
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      self.step(dt);
      self.raf = requestAnimationFrame(frame);
    })(last);
  }

  Viewer.prototype.texture = function (key) {
    var self = this, gl = this.gl;
    if (!key) return Promise.resolve(null);
    if (this.tex[key]) return this.tex[key];
    return this.tex[key] = AOA.loadTexture(key).then(function (t) {
      return Promise.all(t.pngs.map(function (src) {
        var img = new Image(); img.src = src;
        return img.decode().then(function () { return img; });
      })).then(function (imgs) {
        var id = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, id);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        imgs.forEach(function (img, level) { gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); });
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, imgs.length > 1 ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, imgs.length - 1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        return id;
      });
    }).catch(function () { return null; });
  };

  /** Loads a model (and its textures) and shows it; resolves when it is on the screen. */
  Viewer.prototype.show = function (key, opts) {
    var self = this, gl = this.gl, token = this.token = {};
    opts = opts || {};
    return AOA.loadModel(key).then(function (m) {
      return inflate(bytes(m.b64)).then(function (buf) {
        if (token !== self.token) return;
        var meta = m.meta;
        var layers = meta.layers.map(function (L) {
          var n = L.n, at = L.at, frames = meta.frames;
          var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
          var pos0 = new Uint16Array(buf, at, n * 3);
          var posBufs = [];
          var cur = new Uint16Array(pos0);
          posBufs.push(upload(gl, cur));
          for (var f = 1; f < frames; f++) {
            var d = new Int16Array(buf, at + n * 18 + (f - 1) * n * 6, n * 3);
            var next = new Uint16Array(n * 3);
            for (var i = 0; i < n * 3; i++) next[i] = (cur[i] + d[i]) & 0xFFFF;
            posBufs.push(upload(gl, next)); cur = next;
          }
          var P = self.prog.a;
          var uv = upload(gl, new Uint16Array(buf, at + n * 6, n * 2));
          gl.bindBuffer(gl.ARRAY_BUFFER, uv); gl.enableVertexAttribArray(P.aUV); gl.vertexAttribPointer(P.aUV, 2, gl.UNSIGNED_SHORT, true, 0, 0);
          var col = upload(gl, new Uint8Array(buf, at + n * 10, n * 4));
          gl.bindBuffer(gl.ARRAY_BUFFER, col); gl.enableVertexAttribArray(P.aCol); gl.vertexAttribPointer(P.aCol, 4, gl.UNSIGNED_BYTE, true, 0, 0);
          var nl = upload(gl, new Uint8Array(buf, at + n * 14, n * 4));
          gl.bindBuffer(gl.ARRAY_BUFFER, nl);
          if (P.aNrm !== undefined) { gl.enableVertexAttribArray(P.aNrm); gl.vertexAttribPointer(P.aNrm, 3, gl.BYTE, true, 4, 0); }
          if (P.aLight !== undefined) { gl.enableVertexAttribArray(P.aLight); gl.vertexAttribPointer(P.aLight, 1, gl.UNSIGNED_BYTE, false, 4, 3); }
          var quads = n >> 2, idx = new Uint32Array(quads * 6);
          for (var q = 0; q < quads; q++) {
            var b = q * 4, o = q * 6;
            idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
          }
          var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
          gl.bindVertexArray(null);
          return { L: L, vao: vao, pos: posBufs, count: quads * 6, kind: L.k, tex: null, bufs: posBufs.concat([uv, col, nl, ib]) };
        });
        return Promise.all(layers.map(function (l) { return self.texture(l.L.tex).then(function (t) { l.tex = t; }); })).then(function () {
          if (token !== self.token) { layers.forEach(function (l) { l.bufs.forEach(function (b) { gl.deleteBuffer(b); }); }); return; }
          self.drop();
          var mn = meta.min, st = meta.step, mx = [mn[0] + st[0] * 65535, mn[1] + st[1] * 65535, mn[2] + st[2] * 65535];
          if (meta.frames > 1) {
            // a creature is framed as it stands at the start of its round (a dragon's whole flight would leave it small, off to one side)
            var lo = [65535, 65535, 65535], hi = [0, 0, 0];
            meta.layers.forEach(function (L) {
              var p = new Uint16Array(buf, L.at, L.n * 3);
              for (var i = 0; i < p.length; i += 3) for (var a = 0; a < 3; a++) { if (p[i + a] < lo[a]) lo[a] = p[i + a]; if (p[i + a] > hi[a]) hi[a] = p[i + a]; }
            });
            mx = [mn[0] + st[0] * hi[0], mn[1] + st[1] * hi[1], mn[2] + st[2] * hi[2]];
            mn = [mn[0] + st[0] * lo[0], mn[1] + st[1] * lo[1], mn[2] + st[2] * lo[2]];
          }
          var c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
          var r = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 + 0.05;
          self.model = { meta: meta, layers: layers, centre: c, radius: r, min: mn, max: mx, kind: meta.kind, scene: meta.scene };
          self.time = 0; self.spinning = meta.kind === 'item'; self.playing = true;
          self.reset();
          return self.model;
        });
      });
    });
  };

  function upload(gl, arr) {
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return b;
  }

  Viewer.prototype.drop = function () {
    var gl = this.gl;
    if (this.model) this.model.layers.forEach(function (l) { l.bufs.forEach(function (b) { gl.deleteBuffer(b); }); gl.deleteVertexArray(l.vao); });
    this.model = null; this.dirty = true;
  };

  /** Where the camera starts: as the book shows it (a creature three-quarters on, a structure from above a corner). */
  Viewer.prototype.reset = function () {
    var m = this.model, s = this.state;
    s.zoom = 1; s.panX = 0; s.panY = 0; this.vel = this.velP = 0;
    if (m && m.scene) { s.yaw = 0; s.pitch = 0; }
    else if (m && m.kind === 'mob') { s.yaw = 28; s.pitch = 10; s.zoom = 1.1; }
    else if (m && m.kind === 'item') { s.yaw = 30; s.pitch = 18; s.zoom = 1.25; }
    else { s.yaw = 45 + 180; s.pitch = 30; }
    this.dirty = true;
  };

  Viewer.prototype.step = function (dt) {
    var m = this.model, s = this.state, moving = false;
    if (!m) return;
    if (this.playing && m.meta.frames > 1) { this.time += dt; moving = true; }
    if (this.spinning) { s.yaw += dt * 24; moving = true; }
    if (!this.dragging && (Math.abs(this.vel) > 0.01 || Math.abs(this.velP) > 0.01)) {
      s.yaw += this.vel * dt * 60; s.pitch += this.velP * dt * 60;
      var k = Math.pow(0.9, dt * 60); this.vel *= k; this.velP *= k; moving = true;
    }
    if (moving || this.dirty) { this.draw(); this.dirty = false; }
  };

  Viewer.prototype.camera = function (w, h) {
    var m = this.model, s = this.state, asp = w / h, fov = 40 * Math.PI / 180;
    h = this.still ? h : this.canvas.clientHeight || h;   // pan is in the page's own pixels
    var view, proj, unit;
    if (m.scene) {
      var sc = m.scene, look = sc.look, eye = sc.eye;
      var dx = eye[0] - look[0], dy = eye[1] - look[1], dz = eye[2] - look[2];
      var dist = Math.hypot(dx, dy, dz) / s.zoom;
      var yaw0 = Math.atan2(dx, dz), pitch0 = Math.asin(dy / (Math.hypot(dx, dy, dz) || 1));
      var yaw = yaw0 + s.yaw * Math.PI / 180, pitch = Math.max(-1.4, Math.min(1.45, pitch0 + s.pitch * Math.PI / 180));
      var e = [look[0] + Math.sin(yaw) * Math.cos(pitch) * dist, look[1] + Math.sin(pitch) * dist, look[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
      var f = (sc.fov || 70) * Math.PI / 180;
      unit = 2 * Math.max(2, dist) * Math.tan(f / 2) / h;
      view = M.mul(M.trans(s.panX * unit, -s.panY * unit, 0), M.lookAt(e, look));
      proj = M.persp(f, asp, 0.05, Math.max(256, (sc.fogEnd || 200) * 1.5));
      return { view: view, proj: proj };
    }
    var r = m.radius, halfH, d;
    if (s.ortho) {
      halfH = r * 1.05 / s.zoom; d = r * 3;
      proj = M.ortho(-halfH * asp, halfH * asp, -halfH, halfH, 0.05, d + r * 3);
    } else {
      d = r / Math.sin(fov / 2) * 1.04 / s.zoom; halfH = d * Math.tan(fov / 2);
      proj = M.persp(fov, asp, Math.max(0.01, d - r * 2), d + r * 4);
    }
    unit = 2 * halfH / h;
    view = M.mul(M.trans(s.panX * unit, -s.panY * unit, -d), M.mul(M.rotX(s.pitch * Math.PI / 180), M.mul(M.rotY(s.yaw * Math.PI / 180),
      M.trans(-m.centre[0], -m.centre[1], -m.centre[2]))));
    return { view: view, proj: proj };
  };

  Viewer.prototype.draw = function () {
    var gl = this.gl, c = this.canvas, m = this.model;
    var dpr = Math.min(2, window.devicePixelRatio || 1), w, h;
    if (this.still) { w = c.width; h = c.height; }
    else {
      w = Math.max(1, Math.round(c.clientWidth * dpr)); h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!m) return;
    var cam = this.camera(w, h), P = this.prog, meta = m.meta;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    // a soft shadow under a creature or an item, where it stands
    if (!m.scene && m.kind !== 'blocks' && !this.still) {
      var S = this.shadow;
      gl.useProgram(S.p);
      gl.uniformMatrix4fv(S.u.uView, false, cam.view); gl.uniformMatrix4fv(S.u.uProj, false, cam.proj);
      var span = Math.max(m.max[0] - m.min[0], m.max[2] - m.min[2]);
      gl.uniform3f(S.u.uC, m.centre[0], m.min[1] - (m.kind === 'item' ? m.radius * 0.35 : 0.0), m.centre[2]);
      gl.uniform1f(S.u.uR, span * 0.62 + 0.15); gl.uniform1f(S.u.uA, 0.42);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(S.a.aP); gl.vertexAttribPointer(S.a.aP, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(S.a.aP); gl.depthMask(true);
    }
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uView, false, cam.view); gl.uniformMatrix4fv(P.u.uProj, false, cam.proj);
    gl.uniform3f(P.u.uMin, meta.min[0], meta.min[1], meta.min[2]);
    gl.uniform3f(P.u.uStep, meta.step[0], meta.step[1], meta.step[2]);
    gl.uniform1f(P.u.uDay, 1.0);
    if (m.scene) {
      var fc = hex(m.scene.fog);
      gl.uniform1i(P.u.uFogOn, 1); gl.uniform3f(P.u.uFog, fc[0], fc[1], fc[2]);
      gl.uniform2f(P.u.uFogRange, m.scene.fogStart || 40, m.scene.fogEnd || 120);
    } else gl.uniform1i(P.u.uFogOn, 0);
    // which frames, and how far between them (the round loops back to its start smoothly)
    var frames = meta.frames, f0 = 0, f1 = 0, mix = 0;
    if (frames > 1) {
      var t = (this.time * meta.fps) % frames; f0 = Math.floor(t); f1 = (f0 + 1) % frames; mix = t - f0;
    }
    gl.uniform1f(P.u.uMix, mix);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(P.u.uTex, 0);
    var mode = m.kind === 'mob' || m.kind === 'item' ? 0 : 1;
    var order = ['cut', 'blend', 'glow'];
    for (var pass = 0; pass < 3; pass++) {
      var kind = order[pass];
      if (kind === 'cut') { gl.disable(gl.BLEND); gl.depthMask(true); }
      else if (kind === 'blend') { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true); }
      else { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); }
      for (var i = 0; i < m.layers.length; i++) {
        var l = m.layers[i];
        if (l.kind !== kind) continue;
        gl.bindVertexArray(l.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, l.pos[f0]); gl.enableVertexAttribArray(P.a.aPos); gl.vertexAttribPointer(P.a.aPos, 3, gl.UNSIGNED_SHORT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, l.pos[f1]); gl.enableVertexAttribArray(P.a.aPos2); gl.vertexAttribPointer(P.a.aPos2, 3, gl.UNSIGNED_SHORT, false, 0, 0);
        var uvr = l.L.uv; gl.uniform4f(P.u.uUV, uvr[0], uvr[1], uvr[2], uvr[3]);
        gl.uniform1i(P.u.uMode, kind === 'glow' ? 2 : mode);
        gl.uniform1f(P.u.uCut, kind === 'cut' ? 0.1 : 0.004);
        gl.uniform1i(P.u.uTextured, l.tex ? 1 : 0);
        gl.bindTexture(gl.TEXTURE_2D, l.tex || this.white);
        if (m.kind === 'blocks' || m.scene) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
        gl.drawElements(gl.TRIANGLES, l.count, gl.UNSIGNED_INT, 0);
      }
    }
    gl.bindVertexArray(null); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    if (this.capture) { var cb = this.capture; this.capture = null; cb(c.toDataURL('image/png')); }
  };

  function hex(s) {
    var v = parseInt(String(s || '#000').slice(1), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }

  Viewer.prototype.snapshot = function () {
    var self = this;
    return new Promise(function (ok) { self.capture = ok; self.dirty = true; });
  };

  // ------------------------------------------------------------------ the mouse and fingers, as in the book
  Viewer.prototype.input = function () {
    var self = this, c = this.canvas, s = this.state, pts = {}, lastX = 0, lastY = 0, button = 0, lastT = 0;
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    c.addEventListener('pointerdown', function (e) {
      c.setPointerCapture(e.pointerId); pts[e.pointerId] = [e.clientX, e.clientY];
      button = e.button === 2 || e.button === 1 || e.shiftKey ? 2 : 0;
      lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
      self.dragging = true; self.vel = self.velP = 0; self.spinning = false; c.classList.add('grabbing');
      if (self.onTouch) self.onTouch();
    });
    c.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        // two fingers: pinch to zoom, move together to pan
        var other = pts[ids[0] == e.pointerId ? ids[1] : ids[0]], old = pts[e.pointerId];
        var d0 = Math.hypot(old[0] - other[0], old[1] - other[1]), d1 = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
        if (d0 > 0) self.zoomAt(d1 / d0, (e.clientX + other[0]) / 2, (e.clientY + other[1]) / 2);
        s.panX += (e.clientX - old[0]) / 2; s.panY += (e.clientY - old[1]) / 2;
        pts[e.pointerId] = [e.clientX, e.clientY]; self.dirty = true; return;
      }
      var dx = e.clientX - lastX, dy = e.clientY - lastY, now = performance.now();
      lastX = e.clientX; lastY = e.clientY; pts[e.pointerId] = [e.clientX, e.clientY];
      if (button === 2) { s.panX += dx; s.panY += dy; }
      else {
        s.yaw += dx * 0.45; s.pitch += dy * 0.45;
        var dt = Math.max(1, now - lastT); self.vel = dx * 0.45 * 16 / dt; self.velP = dy * 0.45 * 16 / dt;
      }
      lastT = now; self.dirty = true;
    });
    function up(e) {
      delete pts[e.pointerId];
      if (!Object.keys(pts).length) {
        self.dragging = false; c.classList.remove('grabbing');
        if (performance.now() - lastT > 80) { self.vel = self.velP = 0; }     // a flick spins on; a drag that stopped does not
      }
    }
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.zoomAt(Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 33 : 1)), e.clientX, e.clientY);
      if (self.onTouch) self.onTouch();
    }, { passive: false });
    c.addEventListener('dblclick', function () { self.reset(); });
  };

  /** Zooms by {@code k} towards the pointer: what is under it stays under it. */
  Viewer.prototype.zoomAt = function (k, x, y) {
    var s = this.state, r = this.canvas.getBoundingClientRect();
    var nz = Math.max(0.25, Math.min(40, s.zoom * k)); k = nz / s.zoom;
    if (!(this.model && this.model.scene)) {
      var cx = x - r.left - r.width / 2, cy = y - r.top - r.height / 2;
      s.panX = cx - (cx - s.panX) * k; s.panY = cy - (cy - s.panY) * k;
    }
    s.zoom = nz; this.dirty = true;
  };

  AOA.Viewer = Viewer;

  // ------------------------------------------------------------------ the gallery's pictures of creatures and items, drawn here from their models
  var still = null, queue = Promise.resolve(), made = {};
  /** A picture of a model (a data URL), as its viewer first shows it; one at a time, and kept. */
  AOA.thumb = function (key) {
    if (made[key]) return made[key];
    return made[key] = queue = queue.then(function () {
      if (!still) {
        var c = document.createElement('canvas'); c.width = 320; c.height = 320;
        still = new Viewer(c, { still: true });
      }
      return still.show(key).then(function (m) {
        if (!m) return null;
        if (m.kind === 'item') still.state.zoom = 1.05;
        still.draw();
        var url = still.canvas.toDataURL('image/png');
        still.drop();
        return url;
      });
    }).catch(function () { return null; });
  };
})();
