(function () {
'use strict';
var KT = window.LAENDER, KC = KT.C;
var $ = function (s) { return document.querySelector(s); };
var root = document.documentElement;
var statusEl = $('#status'), hudA = $('#hudA'), hudB = $('#hudB');
var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
var TEST = !!window.DF_TEST;
var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function lerp(a, b, t) { return a + (b - a) * t; }
function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function num(n) { n = Math.round(n); return (n < 0 ? '−' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function hm(n) { n = Math.round(n); return (n < 0 ? '−' : '') + Math.abs(n); }
function hx(n) { return n % 1 ? dec(n) : hm(n); }  // amtliche Höhe, z. B. 32,5 m in Bremen
function dec(x, d) { return x.toFixed(d == null ? 1 : d).replace('.', ','); }
function km2(v) { return v >= 1000 ? num(v) : dec(v); }
function nb(s) { return s.replace(/(\d) (?=(?:km²|km|m|ha)(?![A-Za-zÄÖÜäöüß]))/g, '$1\u00a0').replace(/n\. Chr\./g, 'n.\u00a0Chr.'); }  // geschützte Leerzeichen vor Einheiten
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function wappen(code) { return 'data/wappen/' + code + '.svg'; }
function shade(hex, f) {
  var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return '#' + [r, g, b].map(function (v) { return ('0' + Math.round(v * f).toString(16)).slice(-2); }).join('');
}

/* ---------------- Landesfarben als CSS ---------------- */
(function themeCSS() {
  var light = [], dark = [];
  Object.keys(KC).forEach(function (code) {
    var c = KC[code].color, f = c.flag, n = f.length, stops = [];
    for (var i = 0; i < n; i++) stops.push(f[i] + ' ' + (i / n * 100).toFixed(2) + '% ' + ((i + 1) / n * 100).toFixed(2) + '%');
    var flag = 'linear-gradient(90deg,' + stops.join(',') + ')';
    var isBlack = c.brand === '#141414';
    var sel = code === 'DE' ? ':root' : ':root[data-land="' + code + '"]';
    light.push(sel + '{--brand:' + c.brand + ';--brand-text:' + c.text + ';--on-brand:' + c.on + ';--flag:' + flag +
      ';--m-hi:' + c.brand + ';--m-line:' + c.brand + ';--m-side:' + c.brand + ';--m-side-2:' + (isBlack ? '#000000' : shade(c.brand, 0.55)) + '}');
    var dsel = code === 'DE' ? '' : '[data-land="' + code + '"]';
    var dk = '--brand:' + (isBlack ? '#E9E9E9' : c.brand) + ';--on-brand:' + (isBlack ? '#141414' : c.on) + ';--brand-text:' + c.textDark +
      ';--m-hi:' + (isBlack ? '#E9E9E9' : c.brand) + ';--m-line:' + (isBlack ? '#E9E9E9' : c.textDark) + ';--m-side:' + (isBlack ? '#2B2B2B' : shade(c.brand, 0.7)) + ';--m-side-2:#020305';
    dark.push(':root' + dsel + ':not([data-theme="light"]){' + dk + '}');
    dark.push('__D__:root' + dsel + '[data-theme="dark"]{' + dk + '}');
  });
  var css = light.join('\n') + '\n@media (prefers-color-scheme: dark){\n' + dark.filter(function (s) { return s.indexOf('__D__') < 0; }).join('\n') + '\n}\n' +
    dark.filter(function (s) { return s.indexOf('__D__') === 0; }).map(function (s) { return s.slice(5); }).join('\n');
  var st = document.createElement('style'); st.id = 'landesfarben'; st.textContent = css; document.head.appendChild(st);
})();

/* ---------------- Daten laden ---------------- */
function fail(msg) {
  root.classList.add('noscene');
  statusEl.textContent = msg; hudA.textContent = 'Relief nicht verfügbar'; hudB.textContent = '';
}
function gunzip(buf) {
  var ds = new DecompressionStream('gzip');
  return new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
}
function loadImage(src) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; }); }
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

var D = null, BYCODE = {}, BYID = [], MARKS = {};
var hgtP = fetch('data/hgt.bin').then(function (r) { if (!r.ok) throw new Error('hgt ' + r.status); return r.arrayBuffer(); });
hgtP.catch(function () {});
var geoP = fetch('data/geo.json').then(function (r) { if (!r.ok) throw new Error('geo ' + r.status); return r.json(); });

geoP.then(function (g) {
  D = g;
  D.laender.forEach(function (c) { BYCODE[c.code] = c; BYID[c.id] = c; });
  var pm = (D.places && D.places.marks) || {};
  KT.ORDER.forEach(function (code) {
    MARKS[code] = (KC[code].marks || []).map(function (m, i) {
      var p = (pm[code] || []).filter(function (x) { return x.name === m[0]; })[0] || (pm[code] || [])[i];
      return p ? { name: m[0], text: m[1], E: p.E, N: p.N } : null;
    }).filter(Boolean);
  });
  fillText();
  start();
}).catch(function (e) { console.error(e); fail('Die Geodaten konnten nicht geladen werden.'); });

/* ---------------- Texte aus den Daten ---------------- */
var tilesEl = $('#tiles'), detailEl = $('#detail');
function fillText() {
  var de = D.de;
  $('#chH').textContent = '16 Länder auf ' + num(de.km2) + '\u00a0km²';
  $('#chFacts').innerHTML = [['Fläche', num(de.km2) + '\u00a0km²'], ['Einwohner', num(de.pop)], ['Länder', '16'], ['Kreise und kreisfreie Städte', num(de.krs)],
    ['Gemeinden', num(de.gem)], ['Höchster Punkt', 'Zugspitze, ' + hm(de.hmax) + '\u00a0m']].map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('');
  Array.prototype.forEach.call(document.querySelectorAll('[data-rows]'), function (ul) {
    ul.innerHTML = KT.REGIONS[ul.dataset.rows].map(function (code) {
      var c = BYCODE[code];
      return '<li><span><img src="' + wappen(code) + '" alt="">' + KC[code].name + '</span><span>' + km2(c.km2) + '\u00a0km² · ' + num(c.pop) + '\u00a0Einw.</span></li>';
    }).join('');
  });
  tilesEl.innerHTML = KT.ORDER.map(function (code) {
    return '<button type="button" data-k="' + code + '" aria-pressed="false" title="' + esc(KC[code].name) + '" aria-label="' + esc(KC[code].name) + '"><img src="' + wappen(code) + '" alt="">' + code + '</button>';
  }).join('') + '<button type="button" class="all" data-k="DE" aria-pressed="true" title="Ganz Deutschland" aria-label="Ganz Deutschland"><img src="' + wappen('DE') + '" alt="">DE</button>';
  renderDetail();
}
function renderDetail() {
  var code = selected ? selected.code : null;
  if (!code) {
    detailEl.innerHTML = '<p class="sel">Für Familien in allen 16 Ländern. Wählen Sie oben ein Land.</p>';
    return;
  }
  var K = KC[code], c = BYCODE[code];
  var marks = MARKS[code] || [];
  detailEl.innerHTML =
    '<div class="dhead"><img src="' + wappen(code) + '" alt="Wappen ' + esc(K.name) + '"><div><h3>' + esc(K.name) + '</h3><p>' + esc(K.official) + '</p></div></div>' +
    '<div class="flagbar" aria-hidden="true"></div>' +
    '<dl class="facts">' +
    [K.cityState ? ['Status', 'Stadtstaat'] : ['Landeshauptstadt', K.capital], ['Bundesland seit', K.since], ['Fläche', km2(c.km2) + '\u00a0km²'], ['Einwohner', num(c.pop)]]
      .concat(K.parts ? [K.parts] : [['Kreise und kreisfreie Städte', String(c.krs)], ['Gemeinden', num(c.gem)]])
      .concat(c.hmax != null ? [['Höchster Punkt', c.hname + ', ' + hx(c.hmax) + '\u00a0m']] : [])
      .map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') +
    '</dl>' +
    '<p class="kicker" style="margin:18px 0 0">Wahrzeichen</p>' +
    '<ul class="marks">' + marks.map(function (m, i) {
      return '<li><button type="button" data-m="' + i + '" aria-pressed="' + (selMark === i ? 'true' : 'false') + '"><b>' + esc(m.name) + '</b><small>' + esc(nb(m.text)) + '</small></button></li>';
    }).join('') + '</ul>';
}

/* ---------------- Auswahl und Farbwechsel ---------------- */
var selected = null, selMark = -1;
function applyBrand(code) {
  if (code && code !== 'DE') root.setAttribute('data-land', code); else root.removeAttribute('data-land');
  var K = KC[code || 'DE'];
  var t = K.adj + ' Familien';
  $('#heroT').textContent = t; $('#markT').textContent = K.adj; $('#sig').textContent = t;
  document.title = t;
  ['#heroW', '#markW', '#pickW'].forEach(function (s) { $(s).src = wappen(code || 'DE'); });
  $('#heroE').textContent = code && code !== 'DE' ? K.official + ' · Bundesland seit ' + K.since : 'Deutschland · 51° 10′ N · 10° 27′ O';
  $('#pickT').textContent = code && code !== 'DE' ? K.name : 'Land wählen';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  meta.content = K.color.brand;
}
function selectLand(code, opts) {
  opts = opts || {};
  var c = code && code !== 'DE' ? BYCODE[code] : null;
  selected = c; selMark = -1;
  applyBrand(c ? c.code : null);
  Array.prototype.forEach.call(tilesEl.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', (c ? c.code : 'DE') === b.dataset.k ? 'true' : 'false'); });
  renderDetail();
  if (!opts.noHash) { try { history.replaceState(null, '', c ? '#' + c.code.toLowerCase() : location.pathname + location.search); } catch (e) {} }
  if (window.__onSelect) window.__onSelect(c);
  if (opts.scroll && !inFinale()) document.getElementById('laender').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
}
tilesEl.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-k]'); if (!b) return;
  var code = b.dataset.k;
  selectLand(code === 'DE' || (selected && selected.code === code) ? null : code, { scroll: true });
});
detailEl.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-m]'); if (!b) return;
  var i = +b.dataset.m;
  selMark = selMark === i ? -1 : i;
  Array.prototype.forEach.call(detailEl.querySelectorAll('button[data-m]'), function (x) { x.setAttribute('aria-pressed', +x.dataset.m === selMark ? 'true' : 'false'); });
});
function hashLand() { var h = location.hash.replace('#', '').toUpperCase(); return KC[h] && h !== 'DE' ? h : null; }
window.addEventListener('hashchange', function () { var h = hashLand(); if (h && D) selectLand(h, { noHash: true }); });
function inFinale() { var y = window.scrollY + window.innerHeight * 0.5; return y > anchorY('laender') - window.innerHeight * 0.45; }

/* ---------------- Szene ---------------- */
var anchors = [];
function measure() {
  anchors = Array.prototype.map.call(document.querySelectorAll('[data-cam]'), function (s) {
    var r = s.getBoundingClientRect();
    return { key: s.dataset.cam, y: r.top + window.scrollY + r.height * 0.5, el: s };
  });
}
function anchorY(key) { for (var i = 0; i < anchors.length; i++) if (anchors[i].key === key) return anchors[i].y; return 0; }

function start() {
  var h0 = hashLand(); if (h0) selectLand(h0, { noHash: true });
  if (!window.THREE) { fail('Die 3D-Bibliothek konnte nicht geladen werden. Die Texte bleiben lesbar.'); return; }
  if (typeof DecompressionStream === 'undefined') { fail('Dieser Browser kann die Geodaten nicht entpacken. Die Texte bleiben lesbar.'); return; }
  THREE.ColorManagement.enabled = false;

  var canvas = $('#scene');
  canvas.style.opacity = '0';
  canvas.style.transition = reduce ? 'none' : 'opacity 1.4s ease';
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { fail('WebGL ist in diesem Browser nicht verfügbar. Die Texte bleiben lesbar.'); return; }
  if (!renderer.capabilities.isWebGL2) { fail('Das Relief benötigt WebGL 2. Die Texte bleiben lesbar.'); return; }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  var small = Math.min(screen.width, screen.height) < 700;

  /* ---------------- Geografie ---------------- */
  var G = D.grid, EC = (G.E0 + G.E1) / 2, NC = (G.N0 + G.N1) / 2, H0 = 0, VZ = 4.0;
  function X(E) { return E - EC; } function Z(N) { return NC - N; } function Y(h) { return (h - H0) * VZ; }
  var nx = G.nx, ny = G.ny, HT = new Float32Array(nx * ny);
  function hAt(E, N) {
    var fx = (E - G.E0) / G.step, fy = (G.N1 - N) / G.step;
    fx = clamp(fx, 0, nx - 1); fy = clamp(fy, 0, ny - 1);
    var i = Math.min(nx - 2, fx | 0), j = Math.min(ny - 2, fy | 0), tx = fx - i, ty = fy - j, k = j * nx + i;
    return (HT[k] * (1 - tx) + HT[k + 1] * tx) * (1 - ty) + (HT[k + nx] * (1 - tx) + HT[k + nx + 1] * tx) * ty;
  }
  function inGrid(E, N) { return E >= G.E0 && E <= G.E1 && N >= G.N0 && N <= G.N1; }
  var HALF_W = (G.E1 - G.E0) / 2, HALF_H = (G.N1 - G.N0) / 2;

  /* ---------------- Materialien ---------------- */
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(30, 1, 20, 2000000);
  var U = {
    uFog: { value: new THREE.Color() }, uFogNear: { value: 1e6 }, uFogFar: { value: 2e6 },
    uTime: { value: 0 }, uDark: { value: 0 }, uPx: { value: 0.001 }
  };
  var C = {}, CT = {};
  ['--paper', '--m-land', '--m-lit', '--m-shade', '--m-forest', '--m-out', '--m-water', '--m-water-deep', '--m-contour', '--m-hi',
   '--m-side', '--m-side-2', '--m-line', '--m-nation', '--m-cant', '--m-river', '--m-shore', '--ink'
  ].forEach(function (k) { C[k] = new THREE.Color(); CT[k] = new THREE.Color(); });

  var COMMON_FRAG = [
    'float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }',
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x), u.y); }'
  ].join('\n');

  var NK = 17;
  var terrainMat = new THREE.ShaderMaterial({
    uniforms: {
      uRelief: { value: null }, uMaskL: { value: null }, uMaskN: { value: null }, uHgt: { value: null },
      uHgtSize: { value: new THREE.Vector2(nx, ny) },
      uLand: { value: C['--m-land'] }, uLit: { value: C['--m-lit'] }, uShade: { value: C['--m-shade'] }, uForest: { value: C['--m-forest'] },
      uOut: { value: C['--m-out'] }, uWater: { value: C['--m-water'] }, uWaterDeep: { value: C['--m-water-deep'] },
      uContour: { value: C['--m-contour'] }, uHi: { value: C['--m-hi'] },
      uFocus: { value: 0.3 }, uContourA: { value: 0.3 }, uHover: { value: -1 }, uHiv: { value: new Array(NK).fill(0) }, uHiAny: { value: 0 },
      uFog: U.uFog, uFogNear: U.uFogNear, uFogFar: U.uFogFar, uTime: U.uTime, uDark: U.uDark
    },
    vertexShader: [
      'varying vec2 vUv; varying vec3 vW; varying float vDist;',
      'void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vDist=distance(w.xyz,cameraPosition);',
      '  gl_Position=projectionMatrix*viewMatrix*w; }'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uRelief; uniform sampler2D uMaskL; uniform sampler2D uMaskN; uniform sampler2D uHgt; uniform vec2 uHgtSize;',
      'uniform vec3 uLand, uLit, uShade, uForest, uOut, uWater, uWaterDeep, uContour, uHi, uFog;',
      'uniform float uFocus, uContourA, uHover, uTime, uFogNear, uFogFar, uDark, uHiAny; uniform float uHiv[' + NK + '];',
      'varying vec2 vUv; varying vec3 vW; varying float vDist;',
      COMMON_FRAG,
      'void main(){',
      '  vec3 ml = texture2D(uMaskL, vUv).rgb;',
      '  float idf = floor(texture2D(uMaskN, vUv).r*255.0/9.0+0.5); int id = int(idf);',
      '  float inside = step(0.5, idf);',
      '  float rel = texture2D(uRelief, vUv).r;',
      '  float water = smoothstep(0.30, 0.70, ml.b);',
      '  float k = 1.0 + (rel/0.69 - 1.0)*1.6;',
      '  vec3 col = k < 1.0 ? mix(uShade, uLand, smoothstep(0.05, 1.0, k)) : mix(uLand, uLit, clamp((k-1.0)*1.6, 0.0, 1.0));',
      '  col = mix(col, col*uForest, ml.g*0.85);',
      '  vec2 uvH = (vUv*(uHgtSize-1.0)+0.5)/uHgtSize; float h = texture2D(uHgt, uvH).r;',
      '  float h100=h/100.0, w100=max(fwidth(h100),1e-5); float l100 = 1.0-clamp(abs(fract(h100-0.5)-0.5)/w100, 0.0, 1.0);',
      '  float h500=h/500.0, w500=max(fwidth(h500),1e-5); float l500 = 1.0-clamp(abs(fract(h500-0.5)-0.5)/(w500*1.3), 0.0, 1.0);',
      '  float cont = max(l100*0.10*(1.0-smoothstep(0.05,0.18,w100)), l500*0.34*(1.0-smoothstep(0.15,0.4,w500)))*(1.0-0.45*uDark);',
      '  col = mix(col, uContour, cont*uContourA*(0.2+0.8*inside)*(1.0-water));',
      '  float hv = 0.0; for(int i=0;i<' + NK + ';i++){ if(i==id) hv=uHiv[i]; }',
      '  float hov = (abs(idf-uHover)<0.5) ? inside : 0.0;',
      '  col = mix(col, uOut, clamp(uHiAny-hv, 0.0, 1.0)*0.42*inside*(1.0-water));',
      '  col = mix(col, uHi, clamp(hv*0.07+hov*0.12, 0.0, 0.3)*(1.0-water)*(0.55+0.45*clamp(k,0.0,1.0)));',
      '  float depth = (1.0-rel)*230.0;',
      '  vec3 wc = mix(uWater, uWaterDeep, smoothstep(0.0, 165.0, depth));',
      '  float n = noise(vW.xz*0.0012+vec2(uTime*0.018, uTime*0.011))*0.6 + noise(vW.xz*0.005-vec2(uTime*0.045))*0.4;',
      '  wc *= 0.95+n*0.1;',
      '  vec3 V = normalize(cameraPosition-vW);',
      '  wc = mix(wc, uLit, pow(1.0-clamp(V.y,0.0,1.0), 3.0)*0.32*(1.0-uDark*0.5));',
      '  col = mix(col, wc, water);',
      '  col = mix(col, uOut, uFocus*(1.0-inside)*0.55);',
      '  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDist));',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });

  var sideMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uA: { value: C['--m-side'] }, uB: { value: C['--m-side-2'] }, uFog: U.uFog, uFogNear: U.uFogNear, uFogFar: U.uFogFar },
    vertexShader: 'attribute float aT; varying float vT; varying float vDist; void main(){ vT=aT; vec4 w=modelMatrix*vec4(position,1.0); vDist=distance(w.xyz,cameraPosition); gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: 'uniform vec3 uA,uB,uFog; uniform float uFogNear,uFogFar; varying float vT; varying float vDist; void main(){ vec3 c=mix(uA,uB,smoothstep(0.0,1.0,vT)); c=mix(c,uFog,smoothstep(uFogNear,uFogFar,vDist)*0.85); gl_FragColor=vec4(c,1.0); }'
  });

  var shadowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uC: { value: C['--ink'] }, uA: { value: 0.16 }, uS: { value: new THREE.Vector2(HALF_W, HALF_H) } },
    vertexShader: 'varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uC; uniform float uA; uniform vec2 uS; varying vec2 vP; void main(){ vec2 q=abs(vP)/uS; float d=length(max(q-0.8,0.0))*3.0; float a=(1.0-smoothstep(0.0,1.0,d))*uA; gl_FragColor=vec4(uC,a); }'
  });

  function ribbonMat(colorKey, widthPx, opacity, opts) {
    opts = opts || {};
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
      uniforms: {
        uColor: { value: C[colorKey] }, uWidth: { value: widthPx }, uOpacity: { value: opacity }, uDraw: { value: 1 },
        uDash: { value: opts.dash ? 1 : 0 }, uFlow: { value: opts.flow ? 1 : 0 },
        uPx: U.uPx, uTime: U.uTime, uFog: U.uFog, uFogNear: U.uFogNear, uFogFar: U.uFogFar
      },
      vertexShader: [
        'attribute vec3 aDir; attribute float aSide; attribute float aAlong; attribute float aM;',
        'uniform float uWidth; uniform float uPx;',
        'varying float vAlong; varying float vSide; varying float vDist; varying float vM; varying float vPxW;',
        'void main(){ vec4 w=modelMatrix*vec4(position,1.0); float dist=distance(w.xyz,cameraPosition);',
        '  float pxw=uPx*dist; float hw=uWidth*pxw*0.5+0.6;',
        '  w.xyz += aDir*aSide*hw; w.y += 6.0 + hw*1.2;',
        '  vAlong=aAlong; vSide=aSide; vDist=dist; vM=aM; vPxW=pxw;',
        '  gl_Position=projectionMatrix*viewMatrix*w; }'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor, uFog; uniform float uOpacity, uDraw, uDash, uFlow, uTime, uFogNear, uFogFar;',
        'varying float vAlong; varying float vSide; varying float vDist; varying float vM; varying float vPxW;',
        'void main(){',
        '  if(vAlong > uDraw) discard;',
        '  float a = 1.0 - smoothstep(0.55, 1.0, abs(vSide));',
        '  if(uDash > 0.5){ float per = vPxW*12.0; a *= step(fract(vM/per), 0.62); }',
        '  vec3 c = uColor;',
        '  if(uFlow > 0.5){ float pulse = smoothstep(0.8, 1.0, fract(vM/(vPxW*140.0) - uTime*0.5)); c = mix(c, vec3(1.0), pulse*0.4); }',
        '  c = mix(c, uFog, smoothstep(uFogNear, uFogFar, vDist)*0.9);',
        '  gl_FragColor = vec4(c, a*uOpacity);',
        '}'
      ].join('\n')
    });
  }

  /* ---------------- Farben: CSS lesen, im Takt nachführen ---------------- */
  var themeFirst = true;
  function readTheme() {
    var cs = getComputedStyle(root);
    Object.keys(CT).forEach(function (k) {
      var v = cs.getPropertyValue(k).trim(); if (!v) return;
      CT[k].set(v);
    });
    U.uDark.value = parseFloat(cs.getPropertyValue('--m-dark')) || 0;
    shadowMat.uniforms.uA.value = U.uDark.value > 0.5 ? 0.35 : 0.15;
    if (themeFirst || reduce || TEST) { Object.keys(CT).forEach(function (k) { C[k].copy(CT[k]); }); themeFirst = false; }
  }
  function stepTheme(kf) {
    Object.keys(CT).forEach(function (k) { C[k].lerp(CT[k], kf); });
    U.uFog.value.copy(C['--paper']);
    shadowMat.uniforms.uC.value = U.uDark.value > 0.5 ? new THREE.Color(0, 0, 0) : C['--ink'];
  }
  readTheme(); stepTheme(1);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
  new MutationObserver(readTheme).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-land', 'class', 'style'] });

  /* ---------------- Gelände ---------------- */
  function buildTerrain(stride) {
    var cols = Math.floor((nx - 1) / stride) + 1, rows = Math.floor((ny - 1) / stride) + 1;
    var pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
    for (var r = 0; r < rows; r++) {
      var j = Math.min(ny - 1, r * stride), N = G.N1 - j * G.step;
      for (var c = 0; c < cols; c++) {
        var i = Math.min(nx - 1, c * stride), E = G.E0 + i * G.step, k = r * cols + c;
        pos[k * 3] = X(E); pos[k * 3 + 1] = Y(HT[j * nx + i]); pos[k * 3 + 2] = Z(N);
        uv[k * 2] = (E - G.E0) / (G.E1 - G.E0); uv[k * 2 + 1] = (N - G.N0) / (G.N1 - G.N0);
      }
    }
    var idx = new Uint32Array((cols - 1) * (rows - 1) * 6), t = 0;
    for (r = 0; r < rows - 1; r++) for (c = 0; c < cols - 1; c++) {
      var a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx[t++] = a; idx[t++] = d; idx[t++] = b; idx[t++] = b; idx[t++] = d; idx[t++] = e;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    scene.add(new THREE.Mesh(geo, terrainMat));
    // Blockseiten
    var BOT = Y(-300) - 4000, sp = [], st = [], si = [], vi = 0;
    function side(list) {
      for (var q = 0; q < list.length; q++) {
        var p = list[q]; sp.push(p[0], p[1], p[2], p[0], BOT, p[2]); st.push(0, 1);
        if (q > 0) { si.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi); }
        vi += 2;
      }
    }
    function edge(fixedRow, fixedCol) {
      var L = [];
      if (fixedRow !== null) for (var i = 0; i < nx; i += stride) L.push([X(G.E0 + i * G.step), Y(HT[fixedRow * nx + i]), Z(G.N1 - fixedRow * G.step)]);
      else for (var j = 0; j < ny; j += stride) L.push([X(G.E0 + fixedCol * G.step), Y(HT[j * nx + fixedCol]), Z(G.N1 - j * G.step)]);
      return L;
    }
    side(edge(0, null)); side(edge(ny - 1, null)); side(edge(null, 0)); side(edge(null, nx - 1));
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('aT', new THREE.Float32BufferAttribute(st, 1));
    sg.setIndex(si);
    scene.add(new THREE.Mesh(sg, sideMat));
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2.6, HALF_H * 2.6), shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(HALF_W * 0.02, BOT - 120, HALF_H * 0.03); shadow.renderOrder = -1;
    scene.add(shadow);
  }

  /* ---------------- Bänder (Grenzen, Flüsse) ---------------- */
  function toLines(arrs) {
    return arrs.map(function (a) { var o = []; for (var i = 0; i < a.length; i += 2) o.push([a[i] + G.E0, a[i + 1] + G.N0]); return o; });
  }
  function buildRibbon(lines, mat, gapBetween) {
    var P = [], DIR = [], SIDE = [], AL = [], AM = [], IDX = [], base = 0, cum = 0, SEG = G.step * 0.5;
    lines.forEach(function (pts, li) {
      if (li > 0 && gapBetween) { var pe = lines[li - 1][lines[li - 1].length - 1]; cum += Math.hypot(pts[0][0] - pe[0], pts[0][1] - pe[1]); }
      var dp = [];
      for (var i = 0; i < pts.length; i++) {
        if (i > 0) {
          var a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / SEG);
          for (var s = 1; s < n; s++) dp.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]);
        }
        dp.push(pts[i]);
      }
      var m = dp.length; if (m < 2) return;
      for (i = 0; i < m; i++) {
        var p = dp[i], pr = dp[Math.max(0, i - 1)], nxp = dp[Math.min(m - 1, i + 1)];
        if (i > 0) cum += Math.hypot(p[0] - pr[0], p[1] - pr[1]);
        var tx = X(nxp[0]) - X(pr[0]), tz = Z(nxp[1]) - Z(pr[1]), tl = Math.hypot(tx, tz) || 1;
        var dx = -tz / tl, dz = tx / tl, y = Y(hAt(p[0], p[1]));
        for (var sd = -1; sd <= 1; sd += 2) { P.push(X(p[0]), y, Z(p[1])); DIR.push(dx, 0, dz); SIDE.push(sd); AM.push(cum); }
        if (i < m - 1) { var q = base + 2 * i; IDX.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      }
      base += 2 * m;
    });
    for (var k = 0; k < AM.length; k++) AL.push(cum > 0 ? AM[k] / cum : 0);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(DIR, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(SIDE, 1));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(AL, 1));
    g.setAttribute('aM', new THREE.Float32BufferAttribute(AM, 1));
    g.setIndex(IDX); g.computeBoundingSphere();
    var mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false;
    scene.add(mesh); return mesh;
  }
  var R = {}, RING = {};
  function ringFor(code) {
    if (RING[code]) return RING[code];
    var m = buildRibbon(toLines(D.rings[code]), ribbonMat('--m-line', small ? 3 : 3.6, 0), true);
    m.renderOrder = 6; m.userData.o = 0; m.userData.draw = 0;
    return (RING[code] = m);
  }

  /* ---------------- Beschriftungen ---------------- */
  var labelsEl = $('#labels'), LBL = [], LBL_ORDER = [], PRIO = { land: 0, poi: 1, lake: 2, peak: 3 };
  function addLabel(text, kind, E, N, sections, sub, elev, extra) {
    var el = document.createElement('div');
    el.className = 'lbl ' + kind;
    if (kind === 'land') el.innerHTML = esc(text) + (sub ? '<small>' + esc(sub) + '</small>' : '');
    else if (kind === 'peak') el.innerHTML = '<span>' + esc(text) + '</span><em>' + elev + '</em>';
    else el.textContent = text;
    labelsEl.appendChild(el);
    var lift = kind === 'peak' ? 90 : kind === 'poi' ? 70 : 120;
    var L = { el: el, kind: kind, name: text, p: new THREE.Vector3(X(E), Y(hAt(E, N)) + lift, Z(N)), s: sections, o: 0, occ: false, n: LBL.length, w: 0 };
    if (extra) Object.keys(extra).forEach(function (k) { L[k] = extra[k]; });
    LBL.push(L); return L;
  }
  function regionOf(code) { return KC[code] && KC[code].region; }

  /* ---------------- Kamerafahrt ---------------- */
  var KEYS = {
    hero:        { E: 610000, N: 5700000, d: 1650000, hd: -10, p: 42, ox: 0.04, oy: -0.16 },
    deutschland: { E: 600000, N: 5668000, d: 1750000, hd: 0, p: 62, ox: 0.18, oy: 0.02 },
    norden:      { E: 560000, N: 5880000, d: 1000000, hd: -8, p: 52, ox: 0.17, oy: 0.03 },
    nordosten:   { E: 765000, N: 5880000, d: 900000, hd: 10, p: 52, ox: 0.17, oy: 0.03 },
    mitte:       { E: 705000, N: 5675000, d: 820000, hd: 6, p: 50, ox: 0.17, oy: 0.03 },
    westen:      { E: 420000, N: 5700000, d: 560000, hd: -14, p: 50, ox: 0.17, oy: 0.03 },
    rhein:       { E: 440000, N: 5550000, d: 760000, hd: 10, p: 50, ox: 0.17, oy: 0.03 },
    sueden:      { E: 600000, N: 5370000, d: 900000, hd: 6, p: 40, ox: 0.17, oy: 0.03 },
    laender:     { E: 600000, N: 5668000, d: 1700000, hd: 6, p: 58, ox: 0.24, oy: 0.02 }
  };
  var HI = { hero: [], deutschland: [], laender: [] };
  Object.keys(KT.REGIONS).forEach(function (r) { HI[r] = KT.REGIONS[r]; });
  var PAR = {
    hero: { focus: 0.35, cont: 0.2, cant: 0.25 }, deutschland: { focus: 1, cont: 0.7, cant: 1 }, laender: { focus: 1, cont: 0.7, cant: 1 }
  };
  Object.keys(KT.REGIONS).forEach(function (r) { PAR[r] = { focus: 1, cont: 0.8, cant: 0.9 }; });

  function landKey(c) {
    var size = Math.sqrt(c.km2 * 1e6), cx = (c.bb[0] + c.bb[2]) / 2, cy = (c.bb[1] + c.bb[3]) / 2;
    return { E: (c.at[0] + cx) / 2, N: (c.at[1] + cy) / 2, d: clamp(size * 2.9, 45000, 760000), hd: 8 + (c.id * 37) % 50 - 25, p: 50, ox: 0.2, oy: 0.03 };
  }
  function markKey(m) { return { E: m.E, N: m.N, d: 32000, hd: 10, p: 42, ox: 0.2, oy: 0.04 }; }
  function story() {
    var y = window.scrollY + window.innerHeight * 0.5, i = 0;
    while (i < anchors.length - 1 && y >= anchors[i + 1].y) i++;
    if (i >= anchors.length - 1) return { a: anchors.length - 1, b: anchors.length - 1, t: 0, y: y };
    var A = anchors[i], B = anchors[i + 1];
    return { a: i, b: i + 1, t: clamp((y - A.y) / (B.y - A.y), 0, 1), y: y };
  }
  function angLerp(a, b, t) { var d = ((b - a + 540) % 360) - 180; return a + d * t; }
  function keyFor(k) {
    if (k === 'laender' && selected) {
      var ms = MARKS[selected.code];
      if (selMark >= 0 && ms && ms[selMark]) return markKey(ms[selMark]);
      return landKey(selected);
    }
    return KEYS[k];
  }
  function portraitAdjust(c) {
    var asp = window.innerWidth / window.innerHeight, narrow = window.innerWidth < 760;
    var f = asp < 1.25 ? clamp(1.25 / asp, 1, 2.3) : 1;
    var isHero = c === KEYS.hero;
    return { E: c.E, N: c.N, d: c.d * f, hd: c.hd, p: c.p, ox: narrow ? (isHero ? 0.1 : 0) : c.ox, oy: narrow ? (isHero ? -0.13 : -0.2) : c.oy };
  }
  function desiredCam(st) {
    var A = portraitAdjust(keyFor(anchors[st.a].key)), B = portraitAdjust(keyFor(anchors[st.b].key));
    var t = sstep(0.16, 0.84, st.t);
    var sep = Math.hypot(A.E - B.E, A.N - B.N), hop = clamp(sep / Math.min(A.d, B.d) * 0.22, 0, 0.9) * Math.sin(Math.PI * t);
    var d = Math.exp(lerp(Math.log(A.d), Math.log(B.d), t)) * (1 + hop);
    return { E: lerp(A.E, B.E, t), N: lerp(A.N, B.N, t), d: d, hd: angLerp(A.hd, B.hd, t), p: lerp(A.p, B.p, t) - hop * 6, ox: lerp(A.ox, B.ox, t), oy: lerp(A.oy, B.oy, t), t: t };
  }
  var cam = null, ptr = { x: 0, y: 0, sx: 0, sy: 0, cx: -1, cy: -1, moved: false, over: false }, drag = { on: false, hd: 0, p: 0, lx: 0, ly: 0, id: null };
  function placeCamera(c, W, H) {
    var th = c.hd * Math.PI / 180, ph = c.p * Math.PI / 180, cp = Math.cos(ph), sp = Math.sin(ph);
    var h = hAt(c.E, c.N), tx = X(c.E), ty = Y(h), tz = Z(c.N);
    var px = tx - Math.sin(th) * cp * c.d, py = ty + sp * c.d, pz = tz + Math.cos(th) * cp * c.d;
    var gE = px + EC, gN = NC - pz, ground = inGrid(gE, gN) ? Y(hAt(gE, gN)) : -1000;
    if (py < ground + 300) py = ground + 300;
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    camera.near = clamp(c.d * 0.012, 4, 6000); camera.far = c.d * 5 + 200000;
    camera.aspect = W / H;
    camera.setViewOffset(W, H, -c.ox * W, -c.oy * H, W, H);
    camera.updateProjectionMatrix();
    U.uPx.value = 2 * Math.tan(camera.fov * Math.PI / 360) / H;
    U.uFogNear.value = c.d * 1.1; U.uFogFar.value = c.d * 3.6;
  }

  /* ---------------- Picking ---------------- */
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ids = null, IDW = D.tex[0], IDH = D.tex[1], PXM = (G.E1 - G.E0) / IDW;
  function idAt(E, N) {
    if (!ids || !inGrid(E, N)) return 0;
    var c = Math.min(IDW - 1, Math.floor((E - G.E0) / PXM)), r = Math.min(IDH - 1, Math.floor((G.N1 - N) / PXM));
    return Math.round(ids[(r * IDW + c) * 4] / 9);
  }
  function pick(cx, cy) {
    ndc.set(cx / window.innerWidth * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    var o = ray.ray.origin, d = ray.ray.direction, t = camera.near, prev = t, step = Math.max(18, cam.d / 320);
    for (var s = 0; s < 1800; s++) {
      var x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, E = x + EC, N = NC - z;
      if (inGrid(E, N) && y <= Y(hAt(E, N))) {
        var lo = prev, hi = t;
        for (var k = 0; k < 14; k++) { var m = (lo + hi) / 2, xm = o.x + d.x * m, ym = o.y + d.y * m, zm = o.z + d.z * m, Em = xm + EC, Nm = NC - zm;
          if (inGrid(Em, Nm) && ym <= Y(hAt(Em, Nm))) hi = m; else lo = m; }
        x = o.x + d.x * hi; z = o.z + d.z * hi; E = x + EC; N = NC - z;
        return { E: E, N: N, h: hAt(E, N) };
      }
      if (y < -4000) return null;
      prev = t; t += step;
    }
    return null;
  }

  /* ---------------- Bedienung ---------------- */
  var tip = $('#tip'), tipT = $('#tipT'), tipA = $('#tipA'), tipB = $('#tipB'), hoverId = 0;
  function overUI(el) { return el && el.closest && el.closest('.card, .nav, button, a, .tip'); }
  window.addEventListener('pointermove', function (e) {
    ptr.x = e.clientX / window.innerWidth * 2 - 1; ptr.y = e.clientY / window.innerHeight * 2 - 1;
    ptr.cx = e.clientX; ptr.cy = e.clientY; ptr.moved = true; ptr.over = e.pointerType === 'mouse' && !overUI(e.target);
    if (drag.on && e.pointerId === drag.id) {
      drag.hd -= (e.clientX - drag.lx) * 0.18; drag.p = clamp(drag.p + (e.clientY - drag.ly) * 0.12, -22, 26);
      drag.lx = e.clientX; drag.ly = e.clientY;
    }
  }, { passive: true });
  document.addEventListener('pointerleave', function () { ptr.over = false; });
  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0 || overUI(e.target)) return;
    e.preventDefault();
    drag.on = true; drag.id = e.pointerId; drag.lx = e.clientX; drag.ly = e.clientY; drag.sx = e.clientX; drag.sy = e.clientY;
    document.body.style.cursor = 'grabbing';
  });
  window.addEventListener('pointerup', function (e) {
    if (!drag.on) return;
    drag.on = false; document.body.style.cursor = '';
    var moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
    if (moved < 5 && hoverId > 0 && inFinale()) selectLand(BYID[hoverId].code);
  });

  /* ---------------- Bildschleife ---------------- */
  var HUDtick = 0, tReady = 0, last = performance.now(), navLinks = Array.prototype.slice.call(document.querySelectorAll('#nav a')),
      prog = $('#prog'), mark = $('#mark'), north = $('#north'), docH = 1, ready = false, hiCur = new Array(NK).fill(0), cur = { focus: 0.35, cont: 0.2, cant: 0.25 };
  var tmpV = new THREE.Vector3();
  var prCap = small ? 1.5 : 2, frameTimes = [], prLowered = false;
  function applyPR(W, H) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, prCap, Math.sqrt(3.4e6 / (W * H)))); }
  function resize() {
    var W = window.innerWidth, H = canvas.clientHeight || window.innerHeight;
    applyPR(W, H);
    renderer.setSize(W, H, false);
    measure();
    LBL.forEach(function (L) { L.bw = 0; });
    docH = document.documentElement.scrollHeight;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('load', resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  window.__onSelect = function () { LBL.forEach(function (L) { L.bw = 0; }); };

  function frame(now) {
    var rawDt = (now - last) / 1000, dt = Math.min(0.05, rawDt); last = now;
    if (!TEST && !prLowered && ready && rawDt > 0 && rawDt < 0.5) { frameTimes.push(rawDt); if (frameTimes.length > 90) { frameTimes.shift(); var avg = frameTimes.reduce(function (a, b) { return a + b; }, 0) / frameTimes.length; if (avg > 0.034) { prLowered = true; prCap = Math.max(1, prCap * 0.7); resize(); } } }
    var W = window.innerWidth, H = canvas.clientHeight || window.innerHeight;
    if (!reduce) U.uTime.value = now / 1000;
    var st = story(), want = desiredCam(st);
    var keyA = anchors[st.a].key, keyB = anchors[st.b].key, tb = want.t;
    var heroW = keyA === 'hero' ? 1 - tb : 0;
    ptr.sx = lerp(ptr.sx, fine ? ptr.x : 0, 1 - Math.exp(-dt * 2.5)); ptr.sy = lerp(ptr.sy, fine ? ptr.y : 0, 1 - Math.exp(-dt * 2.5));
    if (!drag.on && !inFinale()) { drag.hd *= Math.exp(-dt * 1.2); drag.p *= Math.exp(-dt * 1.2); }
    want.hd += ptr.sx * 4 + drag.hd + (reduce ? 0 : Math.sin(now / 1000 * 0.09) * 7 * heroW);
    want.p = clamp(want.p - ptr.sy * 2.5 + drag.p, 12, 82);
    if (!cam) { cam = { E: want.E, N: want.N, d: want.d, hd: want.hd, p: want.p, ox: want.ox, oy: want.oy };
      if (!reduce && !TEST && st.a === 0 && st.t < 0.05) { cam.d *= 1.4; cam.hd -= 24; cam.p += 12; } }
    var kf = TEST ? 1 : 1 - Math.exp(-dt * 3.2);
    stepTheme(TEST ? 1 : 1 - Math.exp(-dt * 4));
    cam.E = lerp(cam.E, want.E, kf); cam.N = lerp(cam.N, want.N, kf);
    cam.d = Math.exp(lerp(Math.log(cam.d), Math.log(want.d), kf));
    cam.hd = angLerp(cam.hd, want.hd, kf); cam.p = lerp(cam.p, want.p, kf); cam.ox = lerp(cam.ox, want.ox, kf); cam.oy = lerp(cam.oy, want.oy, kf);
    placeCamera(cam, W, H);

    // Parameter je Kapitel
    var pa = PAR[keyA], pb = PAR[keyB];
    ['focus', 'cont', 'cant'].forEach(function (k) { cur[k] = lerp(cur[k], lerp(pa[k], pb[k], tb), kf); });
    var hiTarget = new Array(NK).fill(0);
    (HI[keyA] || []).forEach(function (c) { hiTarget[BYCODE[c].id] += 1 - tb; });
    (HI[keyB] || []).forEach(function (c) { hiTarget[BYCODE[c].id] += tb; });
    var finW = (keyA === 'laender' ? 1 - tb : 0) + (keyB === 'laender' ? tb : 0);
    if (selected) hiTarget[selected.id] = Math.max(hiTarget[selected.id], finW);
    for (var i = 0; i < NK; i++) hiCur[i] = lerp(hiCur[i], hiTarget[i], kf);
    var TU = terrainMat.uniforms;
    TU.uFocus.value = cur.focus; TU.uContourA.value = cur.cont; TU.uHiv.value = hiCur; TU.uHiAny.value = Math.min(1, Math.max.apply(null, hiCur));
    var intro = (reduce || TEST) ? 1 : sstep(0, 1, (now - tReady) / 2600);
    if (R.nation) R.nation.material.uniforms.uDraw.value = ready ? intro : 0;
    if (R.cant) R.cant.material.uniforms.uOpacity.value = 0.75 * Math.max(cur.cant, 0) * intro;
    // Umriss des gewählten Landes
    Object.keys(RING).forEach(function (code) {
      var m = RING[code], on = selected && selected.code === code ? 1 : 0;
      m.userData.o = lerp(m.userData.o, on * Math.max(finW, 0.35), kf);
      m.userData.draw = on ? Math.min(1, m.userData.draw + dt * (reduce || TEST ? 99 : 0.7)) : 0;
      m.material.uniforms.uOpacity.value = m.userData.o; m.material.uniforms.uDraw.value = m.userData.draw * 1.001;
      m.visible = m.userData.o > 0.01;
    });
    if (selected) ringFor(selected.code);

    // Hover
    if (ptr.moved || drag.on || (ptr.over && HUDtick % 4 === 0)) {
      ptr.moved = false;
      var hit = (ready && ptr.over && fine) ? pick(ptr.cx, ptr.cy) : null;
      hoverId = hit ? idAt(hit.E, hit.N) : 0;
      TU.uHover.value = hoverId > 0 ? hoverId : -1;
      if (hit && hoverId > 0 && !drag.on) {
        var c = BYID[hoverId];
        tipT.innerHTML = '<img src="' + wappen(c.code) + '" alt="">' + esc(KC[c.code].name);
        tipA.textContent = km2(c.km2) + '\u00a0km² · ' + num(c.pop) + '\u00a0Einw.';
        tipB.textContent = 'Hier ' + hm(hit.h) + '\u00a0m · E ' + Math.round(hit.E) + ' · N ' + Math.round(hit.N);
        var tx = ptr.cx + 18, ty = ptr.cy + 18;
        if (tx > W - 240) tx = ptr.cx - 240; if (ty > window.innerHeight - 90) ty = ptr.cy - 90;
        tip.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
        tip.classList.add('on');
        document.body.style.cursor = inFinale() ? 'pointer' : '';
      } else { tip.classList.remove('on'); if (!drag.on) document.body.style.cursor = ''; }
    }

    // Beschriftungen: Sichtbarkeit, Verdeckung, Kollision nach Rang
    var wA = 1 - tb, wB = tb, placed = [], selCode = selected ? selected.code : null;
    for (i = 0; i < LBL.length; i++) {
      var L = LBL[i], want_o = 0;
      if (L.s.indexOf(keyA) >= 0) want_o += wA;
      if (L.s.indexOf(keyB) >= 0) want_o += wB;
      if (L.code && L.code === selCode) {
        if (L.kind === 'poi' || L.kind === 'land') want_o = Math.max(want_o, finW);
      } else if (L.kind === 'poi' && selCode) want_o *= 1 - finW;
      if (L.kind === 'poi') { var isOn = L.code === selCode && L.mi === selMark; if (isOn !== L.on) { L.on = isOn; L.el.classList.toggle('on', isOn); L.bw = 0; } }
      want_o = sstep(0.35, 0.85, want_o);
      if (!ready) want_o = 0;
      tmpV.copy(L.p).project(camera);
      var vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.08 && Math.abs(tmpV.y) < 1.08;
      if (want_o > 0.01 && vis && (HUDtick + L.n) % 5 === 0) {
        L.occ = false;
        for (var s = 1; s <= 9; s++) {
          var f = s / 10 * 0.7, px = lerp(L.p.x, camera.position.x, f), py = lerp(L.p.y, camera.position.y, f), pz = lerp(L.p.z, camera.position.z, f);
          var E = px + EC, N = NC - pz;
          if (inGrid(E, N) && Y(hAt(E, N)) > py + 10) { L.occ = true; break; }
        }
      }
      if (!vis || L.occ) want_o = 0;
      L.sx = (tmpV.x + 1) / 2 * W; L.sy = (1 - tmpV.y) / 2 * H; L.want = want_o;
    }
    for (i = 0; i < LBL_ORDER.length; i++) {
      L = LBL_ORDER[i];
      if (L.want > 0.01) {
        if (!L.bw) { L.el.style.opacity = '0'; L.el.style.transform = 'translate3d(-9999px,0,0)'; L.bw = L.el.offsetWidth; L.bh = L.el.offsetHeight; }
        var left = (L.kind === 'peak' || L.kind === 'poi') ? L.sx - 5 : L.sx - L.bw / 2, tries = L.kind === 'land' ? [0, -15, 15] : [0], ok = false;
        for (var tr = 0; tr < tries.length && !ok; tr++) {
          var top = L.sy - L.bh / 2 + tries[tr], hitL = false;
          for (var q = 0; q < placed.length; q++) { var P = placed[q]; if (left < P[2] + 6 && left + L.bw + 6 > P[0] && top < P[3] + 2 && top + L.bh + 2 > P[1]) { hitL = true; break; } }
          if (!hitL) { ok = true; L.dy = lerp(L.dy || 0, tries[tr], TEST ? 1 : 1 - Math.exp(-dt * 8)); placed.push([left, top, left + L.bw, top + L.bh]); }
        }
        if (!ok) L.want = 0;
      }
      L.o = TEST ? L.want : lerp(L.o, L.want, 1 - Math.exp(-dt * 6));
      if (L.o < 0.01) { if (L.w !== 0) { L.el.style.opacity = '0'; L.w = 0; } continue; }
      var off = (L.kind === 'peak' || L.kind === 'poi') ? 'translate(-5px,-50%)' : 'translate(-50%,-50%)';
      L.el.style.transform = 'translate3d(' + L.sx.toFixed(1) + 'px,' + (L.sy + (L.dy || 0)).toFixed(1) + 'px,0) ' + off;
      L.el.style.opacity = L.o.toFixed(3); L.w = 1;
    }

    // HUD, Fortschritt, Navigation
    HUDtick++;
    if (ready && HUDtick % 4 === 0) {
      var hh = hAt(cam.E, cam.N), id = idAt(cam.E, cam.N);
      hudA.textContent = 'E ' + Math.round(cam.E) + ' · N ' + Math.round(cam.N);
      hudB.textContent = (id ? KC[BYID[id].code].name + ' · ' : '') + hm(hh) + '\u00a0m ü.\u00a0NHN';
    }
    north.style.transform = 'rotate(' + (-cam.hd).toFixed(1) + 'deg)';
    var pr = clamp(window.scrollY / Math.max(1, docH - window.innerHeight), 0, 1);
    prog.style.transform = 'scaleX(' + pr.toFixed(4) + ')';
    mark.classList.toggle('on', window.scrollY > window.innerHeight * 0.55);
    var active = st.t < 0.5 ? keyA : keyB;
    for (i = 0; i < navLinks.length; i++) navLinks[i].classList.toggle('on', navLinks[i].dataset.for === active);

    renderer.render(scene, camera);
    if (!TEST) requestAnimationFrame(frame);
  }
  if (TEST) { window.__frame = function () { frame(performance.now()); return true; }; window.__R = R; window.__RING = RING; }

  /* ---------------- Start ---------------- */
  (async function boot() {
    try {
      statusEl.textContent = 'Relief wird aufgebaut …';
      resize();
      var buf = await hgtP;
      var raw = await gunzip(buf);
      var n = nx * ny, lo = raw.subarray(0, n), hi = raw.subarray(n, 2 * n), q = new Int32Array(n);
      for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
        var k = j * nx + i, zz = lo[k] | (hi[k] << 8), r = (zz >>> 1) ^ -(zz & 1), p = 0;
        if (j === 0) { if (i > 0) p = q[k - 1]; } else if (i === 0) p = q[k - nx]; else p = q[k - 1] + q[k - nx] - q[k - nx - 1];
        q[k] = p + r; HT[k] = q[k] * 0.5;
      }
      var hd = new Uint16Array(n);
      for (j = 0; j < ny; j++) { var rr = ny - 1 - j; for (i = 0; i < nx; i++) hd[rr * nx + i] = THREE.DataUtils.toHalfFloat(HT[j * nx + i]); }
      var hTex = new THREE.DataTexture(hd, nx, ny, THREE.RedFormat, THREE.HalfFloatType);
      hTex.magFilter = hTex.minFilter = THREE.LinearFilter; hTex.needsUpdate = true;
      terrainMat.uniforms.uHgt.value = hTex;

      var imgs = await Promise.all([loadImage('data/relief.jpg'), loadImage('data/mask.png')]);
      var relTex = new THREE.Texture(imgs[0]);
      relTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); relTex.needsUpdate = true;
      var mL = new THREE.Texture(imgs[1]); mL.needsUpdate = true; mL.generateMipmaps = false; mL.minFilter = THREE.LinearFilter;
      var mN = new THREE.Texture(imgs[1]); mN.needsUpdate = true; mN.generateMipmaps = false; mN.minFilter = mN.magFilter = THREE.NearestFilter;
      terrainMat.uniforms.uRelief.value = relTex; terrainMat.uniforms.uMaskL.value = mL; terrainMat.uniforms.uMaskN.value = mN;
      var cv = document.createElement('canvas'); cv.width = IDW; cv.height = IDH;
      var cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(imgs[1], 0, 0);
      ids = cx.getImageData(0, 0, IDW, IDH).data;
      await tick();

      buildTerrain(small ? 2 : 1);
      var Ls = D.lines;
      R.shore = buildRibbon(toLines(Ls.shore), ribbonMat('--m-shore', 1.0, 0.55));
      R.rivers = buildRibbon(toLines(Ls.rivers), ribbonMat('--m-river', 1.5, 0.75));
      R.cant = buildRibbon(toLines(Ls.land), ribbonMat('--m-cant', 1.4, 0, { dash: true }));
      R.nation = buildRibbon(toLines(Ls.nation), ribbonMat('--m-nation', small ? 2.6 : 3.2, 1), true);
      R.shore.renderOrder = 1; R.rivers.renderOrder = 2; R.cant.renderOrder = 3; R.nation.renderOrder = 4;

      D.laender.forEach(function (c) {
        var secs = ['deutschland', 'laender'], reg = regionOf(c.code); if (reg) secs.push(reg);
        addLabel(KC[c.code].name, 'land', c.at[0], c.at[1], secs, null, null, { code: c.code });
      });
      var PL = D.places || {};
      (PL.lakes || []).forEach(function (l) {
        var secs = l.big ? ['hero', 'deutschland', 'laender'] : [];
        (l.regions || []).forEach(function (r) { secs.push(r); });
        var L = addLabel(l.name, 'lake', l.E, l.N, secs);
        if (l.sea) L.el.classList.add('sea');
      });
      (PL.peaks || []).forEach(function (pk) {
        var secs = pk.big ? ['deutschland'] : []; (pk.regions || []).forEach(function (r) { secs.push(r); });
        addLabel(pk.name, 'peak', pk.E, pk.N, secs, null, hx(pk.h));
      });
      Object.keys(MARKS).forEach(function (code) {
        MARKS[code].forEach(function (m, mi) {
          addLabel(m.name, 'poi', m.E, m.N, [regionOf(code)], null, null, { code: code, mi: mi });
        });
      });
      LBL_ORDER = LBL.slice().sort(function (a, b) { return PRIO[a.kind] - PRIO[b.kind] || a.n - b.n; });

      ready = true; tReady = performance.now();
      canvas.style.opacity = '1';
      statusEl.textContent = '';
      hudA.textContent = '';
      resize();
      if (!TEST) requestAnimationFrame(frame);
    } catch (err) {
      console.error(err);
      fail('Das Relief konnte nicht aufgebaut werden. Die Texte bleiben lesbar.');
    }
  })();
}
})();
