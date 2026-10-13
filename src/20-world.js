// ============================================================================
// World: renderer, lights, ballpark, crowd, videoboards, ball, overlays, camera
// ============================================================================

const canvasEl = $('c');
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1530, 1300, 3400);
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.3, 6000);

// ---------------------------------------------------------------- lights ----
const hemi = new THREE.HemisphereLight(0xd4e0ff, 0x2a3d1e, 1.15);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xfff2de, 2.5);
keyLight.position.set(-230, 400, 190);
keyLight.target.position.set(0, 0, -110);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
{
  const sc = keyLight.shadow.camera;
  sc.left = -210; sc.right = 210; sc.top = 210; sc.bottom = -210; sc.near = 60; sc.far = 1200;
  keyLight.shadow.bias = -0.0005; keyLight.shadow.normalBias = 0.5;
}
scene.add(keyLight, keyLight.target);
const fillLight = new THREE.DirectionalLight(0xc2d6ff, 0.85);
fillLight.position.set(280, 320, -420);
scene.add(fillLight);

// ------------------------------------------------------------------- sky ----
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(3600, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x02040b) }, mid: { value: new THREE.Color(0x091634) }, hor: { value: new THREE.Color(0x2b3f72) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top, mid, hor; varying vec3 vP; void main(){ float h = vP.y; vec3 c = mix(hor, mid, smoothstep(0.0, 0.16, h)); c = mix(c, top, smoothstep(0.16, 0.75, h)); if (h < 0.0) c = hor * 0.5; gl_FragColor = vec4(c, 1.0); }',
  }),
);
sky.renderOrder = -10;
scene.add(sky);
{
  const n = 1400, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(0.12, 1)), r = 3400;
    p[i * 3] = r * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = r * Math.cos(ph); p[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75, depthWrite: false }));
  sky.add(stars);
}

// ---------------------------------------------------------------- ground ----
const outerGround = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshLambertMaterial({ color: 0x0b120b }));
outerGround.rotation.x = -Math.PI / 2; outerGround.position.y = -0.2;
scene.add(outerGround);

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(cv, repeat) {
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; }
  return t;
}

const FT = { x0: -320, z0: -460, span: 640, size: 2048 };
function drawFieldCanvas() {
  const { x0, z0, span, size: S } = FT, k = S / span;
  const cv = makeCanvas(S, S), g = cv.getContext('2d');
  g.fillStyle = '#18261a'; g.fillRect(0, 0, S, S);
  g.setTransform(k, 0, 0, k, -x0 * k, -z0 * k);
  const poly = () => { g.beginPath(); BOUNDARY.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.closePath(); };
  g.save(); poly(); g.clip();
  g.fillStyle = '#2f7b31'; g.fillRect(x0, z0, span, span);
  g.save(); g.rotate(Math.PI / 4);
  const w = 20;
  for (let i = -36; i < 36; i++) for (let j = -36; j < 36; j++) { g.fillStyle = (i + j) & 1 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.06)'; g.fillRect(i * w, j * w, w, w); }
  g.restore();
  for (let i = 0; i < 42000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(18,60,20,0.22)' : 'rgba(140,200,110,0.08)';
    g.fillRect(x0 + Math.random() * span, z0 + Math.random() * span, 0.6, 0.6);
  }
  g.lineJoin = 'round'; g.strokeStyle = '#8b5d3b'; g.lineWidth = 30; poly(); g.stroke();
  g.strokeStyle = 'rgba(60,35,20,0.35)'; g.lineWidth = 2; g.setLineDash([0.5, 1.7]);
  for (let w = 4; w < 30; w += 3.5) { g.lineWidth = w; poly(); g.stroke(); }
  g.setLineDash([]);
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 0.5;
  for (const s of [-1, 1]) { const c = fenceDist(s * 45) / Math.SQRT2; g.beginPath(); g.moveTo(0, 0); g.lineTo(s * c, -c); g.stroke(); }
  return cv;
}
const fieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(FT.span, FT.span), new THREE.MeshStandardMaterial({ roughness: 0.95 }));   // the grass is drawn by setPark
fieldMesh.rotation.x = -Math.PI / 2;
fieldMesh.position.set(FT.x0 + FT.span / 2, 0, FT.z0 + FT.span / 2);
fieldMesh.receiveShadow = true;
scene.add(fieldMesh);

const IT = { x0: -110, z0: -180, span: 220, size: 2048 };
function drawInfieldCanvas() {
  const { x0, z0, span, size: S } = IT, k = S / span;
  const cv = makeCanvas(S, S), g = cv.getContext('2d');
  g.setTransform(k, 0, 0, k, -x0 * k, -z0 * k);
  const dirt = '#b47c4c';
  g.save();
  g.beginPath(); g.moveTo(0, 0);
  const W = 50 * DEG;
  g.lineTo(-Math.sin(W) * 220, -Math.cos(W) * 220); g.lineTo(0, -320); g.lineTo(Math.sin(W) * 220, -Math.cos(W) * 220); g.closePath(); g.clip();
  g.fillStyle = dirt; g.beginPath(); g.arc(0, MOUND_Z, 95, 0, Math.PI * 2); g.fill();
  g.restore();
  // infield grass
  g.globalCompositeOperation = 'destination-out';
  const ins = 3 * Math.SQRT2;
  g.beginPath(); g.moveTo(0, -ins); g.lineTo(63.64 - ins, -63.64); g.lineTo(0, -127.28 + ins); g.lineTo(-63.64 + ins, -63.64); g.closePath(); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = dirt;
  for (const [x, z, r] of [[0, 0, 13], [0, MOUND_Z, MOUND_R], [63.64, -63.64, 12], [-63.64, -63.64, 12], [0, -127.28, 12]]) { g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2); g.fill(); }
  // grain
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 70000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(90,52,28,0.28)' : 'rgba(225,175,125,0.18)';
    const s = Math.random() * 0.35 + 0.1;
    g.fillRect(x0 + Math.random() * span, z0 + Math.random() * span, s, s);
  }
  // raked arcs and darker cutouts around bases
  g.strokeStyle = 'rgba(80,45,22,0.18)'; g.lineWidth = 0.4;
  for (let r = 70; r < 95; r += 2.2) { g.beginPath(); g.arc(0, MOUND_Z, r, -Math.PI * 0.95, -Math.PI * 0.05); g.stroke(); }
  for (const [x, z] of [[0, 0], [63.64, -63.64], [-63.64, -63.64], [0, -127.28]]) {
    const rg = g.createRadialGradient(x, z, 0, x, z, 9); rg.addColorStop(0, 'rgba(95,55,28,0.35)'); rg.addColorStop(1, 'rgba(95,55,28,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, z, 9, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  // chalk
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 0.28;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 5.3, -5.3); g.lineTo(s * 125, -125); g.stroke(); }
  for (const s of [-1, 1]) {
    g.strokeRect(s > 0 ? 1.21 : -5.21, -3, 4, 6);
    g.beginPath(); g.moveTo(s * 1.75, 3); g.lineTo(s * 1.75, 11); g.stroke();
  }
  g.beginPath(); g.moveTo(-1.75, 11); g.lineTo(1.75, 11); g.stroke();
  // first-base running lane
  g.beginPath(); g.moveTo(31.8, -31.8); g.lineTo(31.8 + 2.1, -31.8 + 2.1); g.lineTo(31.8 + 2.1 + 31.8, -31.8 + 2.1 - 31.8); g.stroke();
  return cv;
}
const infieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(IT.span, IT.span), new THREE.MeshStandardMaterial({ map: canvasTex(drawInfieldCanvas()), roughness: 1, transparent: true, depthWrite: false }));
infieldMesh.rotation.x = -Math.PI / 2;
infieldMesh.position.set(IT.x0 + IT.span / 2, 0.04, IT.z0 + IT.span / 2);
infieldMesh.receiveShadow = true;
infieldMesh.renderOrder = 1;
scene.add(infieldMesh);

// --------------------------------------------------- mound, bases, plate ----
const dirtMat = new THREE.MeshStandardMaterial({ color: 0xa8714a, roughness: 1 });
const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.6, MOUND_R, MOUND_H, 48), dirtMat);
mound.position.set(0, MOUND_H / 2, MOUND_Z); mound.receiveShadow = true; scene.add(mound);
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.6 });
const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.5), whiteMat);
rubber.position.set(0, MOUND_H + 0.02, MOUND_Z); scene.add(rubber);
for (let i = 1; i <= 3; i++) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 1.25), whiteMat);
  b.position.set(BASES[i].x, 0.14, BASES[i].z); b.rotation.y = Math.PI / 4; b.castShadow = true; b.receiveShadow = true; scene.add(b);
}
{
  const s = new THREE.Shape();
  s.moveTo(-0.708, 0.71); s.lineTo(0.708, 0.71); s.lineTo(0.708, 0); s.lineTo(0, -0.71); s.lineTo(-0.708, 0); s.closePath();
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(s), whiteMat);
  plate.rotation.x = -Math.PI / 2; plate.position.y = 0.06; plate.receiveShadow = true; scene.add(plate);
}

// ------------------------------------------------------------ ad panels ----
const SPONSORS = [
  ['PINE TAR & CO.', '#f4d35e', '#1b2a41'], ['GRAND SLAM BURGERS', '#ffffff', '#c1272d'], ['KNUCKLEBALL COLD BREW', '#1b1b1b', '#f2e8cf'],
  ['BULLPEN AUTO GLASS', '#ffffff', '#0a5c8f'], ['DOUBLE PLAY DENTAL', '#0d3b2e', '#d8f3dc'], ['STOLEN BASE SNEAKERS', '#ffffff', '#111111'],
  ['RALLY CAP INSURANCE', '#ffb703', '#023047'], ['SEVENTH INNING SODA', '#ffffff', '#8338ec'], ['FOUL POLE PIZZA', '#fff3b0', '#9e2a2b'],
];
function adCanvas(h = 128, pad = '#173a2a') {
  const panelW = 640, cv = makeCanvas(panelW * SPONSORS.length, h), g = cv.getContext('2d');
  SPONSORS.forEach(([txt, fg, bg], i) => {
    const x = i * panelW;
    g.fillStyle = bg; g.fillRect(x + 6, 10, panelW - 12, h - 16);
    g.fillStyle = fg; g.font = `800 ${Math.round(h * 0.42)}px "Barlow Condensed", Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, x + panelW / 2, h / 2 + 2, panelW - 50);
    g.fillStyle = pad; g.fillRect(x, 0, 6, h); g.fillRect(x + panelW - 6, 0, 6, h);
  });
  g.fillStyle = pad; g.fillRect(0, 0, cv.width, 10);
  g.fillStyle = '#f2c230'; g.fillRect(0, 0, cv.width, 4);
  return cv;
}
const adTex = canvasTex(adCanvas(), true);
const adTexLow = canvasTex(adCanvas(96, '#16213a'), true);

function wallStrip(points, y0, y1, tex, panelLen, color = 0x2a6139) {
  const at = (v, i) => (Array.isArray(v) ? v[i] : v);
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    if (i) acc += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    pos.push(x, at(y0, i), z, x, at(y1, i), z);
    uv.push(acc / panelLen, 0, acc / panelLen, 1);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(tex ? { map: tex, roughness: 0.8, side: THREE.DoubleSide } : { color, roughness: 0.9, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

// distance markers
function textPlate(text, w, h, fg = '#ffffff', bg = 'rgba(0,0,0,0)', font = 800) {
  const cv = makeCanvas(256, Math.round(256 * h / w)), g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg; g.font = `${font} ${Math.round(cv.height * 0.8)}px "Barlow Condensed", Impact, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cv.width / 2, cv.height / 2 + 4);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(cv), transparent: true, side: THREE.DoubleSide }));
  return m;
}

// ---------------------------------------------------------------- stands ----
// o.h0: the height the first row starts at, one number or one per point of the path
let crowdSeats = [];
function buildTiers(path, o, group) {
  const n = path.length, N = [], H = (i) => (Array.isArray(o.h0) ? o.h0[i] : o.h0);
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    let nx = tz, nz = -tx; const p = path[i];
    if (inPoly(p[0] + nx * 4, p[1] + nz * 4)) { nx = -nx; nz = -nz; }
    N.push([nx, nz]);
  }
  const pos = [], col = [];
  const c1 = new THREE.Color(o.color), c2 = new THREE.Color(o.color2 || o.color);
  const quad = (A, B, C, D, c) => { pos.push(...A, ...B, ...C, ...A, ...C, ...D); for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b); };
  const at = (p, nn, d, y) => [p[0] + nn[0] * d, y, p[1] + nn[1] * d];
  for (let r = 0; r < o.rows; r++) {
    const d0 = o.start + r * o.depth, d1 = d0 + o.depth;
    const cc = r % 2 ? c1 : c2;
    for (let i = 0; i < n - 1; i++) {
      const P = path[i], Q = path[i + 1], nP = N[i], nQ = N[i + 1];
      const yP0 = H(i) + r * o.rise, yQ0 = H(i + 1) + r * o.rise, yP1 = yP0 + o.rise, yQ1 = yQ0 + o.rise;
      const A0 = at(P, nP, d0, yP0), B0 = at(Q, nQ, d0, yQ0), A1 = at(P, nP, d0, yP1), B1 = at(Q, nQ, d0, yQ1), A2 = at(P, nP, d1, yP1), B2 = at(Q, nQ, d1, yQ1);
      quad(A0, B0, B1, A1, c1);
      quad(A1, B1, B2, A2, cc);
      if (o.seats) {
        const segL = Math.hypot(Q[0] - P[0], Q[1] - P[1]), steps = Math.max(1, Math.round(segL / 2.1));
        for (let s = 0; s < steps; s++) {
          if (Math.random() > o.fill) continue;
          const u = (s + 0.5) / steps;
          const x = lerp(A1[0], B1[0], u) * 0.6 + lerp(A2[0], B2[0], u) * 0.4, z = lerp(A1[2], B1[2], u) * 0.6 + lerp(A2[2], B2[2], u) * 0.4;
          const nx = lerp(nP[0], nQ[0], u), nz = lerp(nP[1], nQ[1], u);
          crowdSeats.push({ x, y: lerp(yP1, yQ1, u), z, yaw: Math.atan2(-nx, -nz), sec: o.sec });
        }
      }
    }
  }
  // back wall
  const dEnd = o.start + o.rows * o.depth, rise = o.rows * o.rise;
  for (let i = 0; i < n - 1; i++) {
    const P = path[i], Q = path[i + 1], nP = N[i], nQ = N[i + 1], yP = H(i) + rise, yQ = H(i + 1) + rise;
    quad(at(P, nP, dEnd, yP), at(Q, nQ, dEnd, yQ), at(Q, nQ, dEnd, yQ + o.back), at(P, nP, dEnd, yP + o.back), new THREE.Color(0x1a2233));
    if (o.fascia) {
      const d = o.start - 0.2;
      quad(at(P, nP, d, H(i) - o.fascia), at(Q, nQ, d, H(i + 1) - o.fascia), at(Q, nQ, d, H(i + 1)), at(P, nP, d, H(i)), new THREE.Color(0x111827));
      quad(at(P, nP, d, H(i) - o.fascia), at(Q, nQ, d, H(i + 1) - o.fascia), at(Q, nQ, dEnd, H(i + 1) - o.fascia), at(P, nP, dEnd, H(i) - o.fascia), new THREE.Color(0x0e1420));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  group.add(mesh);
  return { mesh, N };
}
function offsetPath(path, N, d) { return path.map((p, i) => [p[0] + N[i][0] * d, p[1] + N[i][1] * d]); }
// dugouts
for (const s of [-1, 1]) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(62, 7, 12), new THREE.MeshLambertMaterial({ color: 0x05070b }));
  shell.position.y = -0.4; g.add(shell);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(64, 1.0, 14), new THREE.MeshLambertMaterial({ color: 0x1b2638 }));
  roof.position.y = 3.6; g.add(roof);
  // centered just outside the foul wall, long axis parallel to the baseline
  const u = [Math.SQRT1_2 * s, -Math.SQRT1_2], n = [Math.SQRT1_2 * s, Math.SQRT1_2];
  g.position.set(u[0] * 110 + n[0] * 52, 0, u[1] * 110 + n[1] * 52);
  g.rotation.y = s * Math.PI / 4;
  scene.add(g);
}

// ----------------------------------------------------------------- crowd ----
const crowdU = { uTime: { value: 0 }, uEx: { value: 0 } };
let crowdBody = null, crowdHead = null, crowdExTarget = 0, crowdTeams = null;
function crowdMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = crowdU.uTime; sh.uniforms.uEx = crowdU.uEx;
    sh.vertexShader = 'attribute float aPhase;\nuniform float uTime;\nuniform float uEx;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nfloat jmp = max(0.0, sin(uTime * (7.0 + aPhase * 5.0) + aPhase * 40.0));\ntransformed.y += uEx * jmp * 1.4 * step(0.25, aPhase) + 0.06 * sin(uTime * 1.3 + aPhase * 30.0);',
    );
  };
  return m;
}
function buildCrowd(group) {
  const N = crowdSeats.length;
  const bodyGeo = new THREE.BoxGeometry(1.45, 2.2, 1.1); bodyGeo.translate(0, 1.1, 0);
  const headGeo = new THREE.SphereGeometry(0.4, 6, 4); headGeo.translate(0, 2.62, 0.05);
  const ph = new Float32Array(N); for (let i = 0; i < N; i++) ph[i] = Math.random();
  bodyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
  headGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
  crowdBody = new THREE.InstancedMesh(bodyGeo, crowdMaterial(), N);
  crowdHead = new THREE.InstancedMesh(headGeo, crowdMaterial(), N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(), p = new V3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const st = crowdSeats[i];
    q.setFromAxisAngle(UP, st.yaw); const sc = rand(0.85, 1.12); s.set(sc, sc * rand(0.9, 1.1), sc);
    p.set(st.x, st.y, st.z); m4.compose(p, q, s);
    crowdBody.setMatrixAt(i, m4); crowdHead.setMatrixAt(i, m4);
    crowdHead.setColorAt(i, c.set(pick(SKINS)));
    crowdBody.setColorAt(i, c.set(0x888888));
  }
  group.add(crowdBody, crowdHead);
  if (crowdTeams) setCrowdColors(...crowdTeams);
}
function setCrowdColors(home, away) {
  crowdTeams = [home, away];
  if (!crowdBody) return;
  const c = new THREE.Color();
  const pal = ['#e8e8e8', '#2b2b2b', '#5a6b8c', '#8c3b3b', '#d9c9a3', '#3d6b4f', '#c26a2c', '#6d4c8c', '#f2f2f2'];
  for (let i = 0; i < crowdSeats.length; i++) {
    const r = Math.random();
    const col = r < 0.42 ? (Math.random() < 0.6 ? home.c1 : home.c2) : r < 0.52 ? (Math.random() < 0.6 ? away.c1 : away.c2) : pick(pal);
    c.set(col); c.offsetHSL(0, 0, rand(-0.06, 0.06));
    crowdBody.setColorAt(i, c);
  }
  crowdBody.instanceColor.needsUpdate = true;
}
function excite(level, secs = 3) { crowdExTarget = level; clearTimeout(excite.t); excite.t = setTimeout(() => (crowdExTarget = 0), secs * 1000); }

// -------------------------------------------------------------- ballparks ----
// Everything the park's shape decides (the field, the wall, the foul poles, the stands and
// the crowd) is built here, and built again when the game moves to another ballpark.
const parkGroup = new THREE.Group(); scene.add(parkGroup);
adTex.userData.keep = true; adTexLow.userData.keep = true;
function clearGroup(g) {
  for (const o of [...g.children]) {
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) for (const m of [].concat(c.material)) { if (m.map && !m.map.userData.keep) m.map.dispose(); m.dispose(); }
    });
    g.remove(o);
  }
}
function setPark(key) {
  PARK = PARKS[key] || PARKS.FC;
  buildBoundary();
  const old = fieldMesh.material.map;
  fieldMesh.material.map = canvasTex(drawFieldCanvas()); fieldMesh.material.needsUpdate = true;
  if (old) old.dispose();
  clearGroup(parkGroup);
  // the outfield wall: ad panels along the bottom; a taller wall (the Green Monster) is solid green above them
  const pts = [], hs = [];
  for (let th = -45; th <= 45.001; th += 0.75) { const d = fenceDist(th); pts.push([d * Math.sin(th * DEG), -d * Math.cos(th * DEG)]); hs.push(fenceH(th)); }
  parkGroup.add(wallStrip(pts, 0, hs.map((h) => Math.min(h, FENCE_H)), adTex, 640 * SPONSORS.length / 64));
  if (hs.some((h) => h > FENCE_H + 0.2)) parkGroup.add(wallStrip(pts, FENCE_H, hs.map((h) => Math.max(h, FENCE_H)), null, 1));
  const foulPath = BOUNDARY.slice(FENCE_PTS.length);
  foulPath.unshift(FENCE_PTS[FENCE_PTS.length - 1]); foulPath.push(FENCE_PTS[0]);
  parkGroup.add(wallStrip(foulPath, 0, 4.2, adTexLow, 640 * SPONSORS.length / 40));
  for (const th of [-44.2, -22, 0, 22, 44.2]) {
    const d = fenceDist(th) + 1.5, y = fenceH(th) + 2.4, m = textPlate(String(Math.round(fenceDist(th))), 9, 4.5, '#ffd54a', '#173a2a');
    m.position.set(d * Math.sin(th * DEG), y, -d * Math.cos(th * DEG));
    m.lookAt(0, y, 0);
    parkGroup.add(m);
  }
  // foul poles, where the wall meets the lines
  for (const s of [-1, 1]) {
    const c = fenceDist(s * 45) / Math.SQRT2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 80, 10), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x332600 }));
    pole.position.set(s * c, 40, -c); parkGroup.add(pole);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3, 60), new THREE.MeshStandardMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    screen.position.set(s * c + s * 1.2, 45, -c + 1.2); screen.lookAt(0, 45, 0); parkGroup.add(screen);
  }
  // batter's eye
  const be = new THREE.Mesh(new THREE.BoxGeometry(84, 34, 10), new THREE.MeshLambertMaterial({ color: 0x0b1410 }));
  be.position.set(0, 17, -fenceDist(0) - 12); parkGroup.add(be);
  // stands: outfield bleachers on top of the wall, the lower bowl, and an upper deck around the infield
  crowdSeats = [];
  const fl = FENCE_PTS.length, n0 = Math.floor(fl * 0.4), n1 = Math.ceil(fl * 0.6), wallAt = (i) => fenceH(-45 + 1.5 * i);
  const lfBleach = FENCE_PTS.slice(0, n0), rfBleach = FENCE_PTS.slice(n1);
  buildTiers(lfBleach, { start: 2, rows: 16, depth: 3, rise: 1.5, h0: lfBleach.map((_, i) => wallAt(i)), color: 0x24324a, color2: 0x2a3a55, seats: true, fill: 0.86, back: 10, sec: 'of' }, parkGroup);
  buildTiers(rfBleach, { start: 2, rows: 16, depth: 3, rise: 1.5, h0: rfBleach.map((_, i) => wallAt(n1 + i)), color: 0x24324a, color2: 0x2a3a55, seats: true, fill: 0.86, back: 10, sec: 'of' }, parkGroup);
  const bowl = [FENCE_PTS[fl - 1], ...BOUNDARY.slice(fl), FENCE_PTS[0]];
  const lower = buildTiers(bowl, { start: 1, rows: 26, depth: 3, rise: 1.25, h0: 4.2, color: 0x1f2b44, color2: 0x253352, seats: true, fill: 0.9, back: 6, sec: 'lower' }, parkGroup);
  const near = bowl.filter((p) => Math.hypot(p[0], p[1]) < 270);
  const nearN = near.map((p) => lower.N[bowl.indexOf(p)]);
  const up = offsetPath(near, nearN, 0);
  buildTiers(up, { start: 72, rows: 20, depth: 3.2, rise: 2.0, h0: 44, color: 0x1c2740, color2: 0x223050, seats: true, fill: 0.88, back: 24, fascia: 8, sec: 'upper' }, parkGroup);
  // LED ribbon on the upper-deck fascia
  const ribbon = makeCanvas(2048, 64), rg = ribbon.getContext('2d');
  rg.fillStyle = '#05070c'; rg.fillRect(0, 0, 2048, 64);
  rg.font = '800 44px "Barlow Condensed", Impact, sans-serif'; rg.textBaseline = 'middle';
  const msgs = [`WELCOME TO ${PARK.name.toUpperCase()}`, 'FULL COUNT BASEBALL', 'MAKE SOME NOISE', 'PINE TAR & CO.', 'GRAND SLAM BURGERS'];
  let x = 20; let k = 0;
  while (x < 2048) { const m = msgs[k++ % msgs.length]; rg.fillStyle = k % 2 ? '#ffc94a' : '#ffffff'; rg.fillText(m, x, 34); x += rg.measureText(m).width + 80; }
  const ribbonMesh = wallStrip(offsetPath(up, nearN, 71.6), 0, 4, canvasTex(ribbon, true), 300);
  ribbonMesh.position.y = 37.8;
  const rm = ribbonMesh.material; ribbonMesh.material = new THREE.MeshBasicMaterial({ map: rm.map, side: THREE.DoubleSide }); rm.dispose();
  parkGroup.add(ribbonMesh);
  buildCrowd(parkGroup);
}
setPark('FC');

// ---------------------------------------------------------- light towers ----
const glowTex = (() => {
  const cv = makeCanvas(128, 128), g = cv.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,245,1)'); rg.addColorStop(0.18, 'rgba(255,248,220,0.55)'); rg.addColorStop(0.5, 'rgba(255,240,200,0.12)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  return canvasTex(cv);
})();
{
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a4152 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbea });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x1a1f2a });
  for (const [th, r, h] of [[-64, 430, 150], [64, 430, 150], [-38, 560, 160], [38, 560, 160], [-128, 270, 130], [128, 270, 130]]) {
    const x = r * Math.sin(th * DEG), z = -r * Math.cos(th * DEG);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(3.5, h, 3.5), poleMat); pole.position.set(x, h / 2, z); scene.add(pole);
    const bank = new THREE.Group(); bank.position.set(x, h + 8, z);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 1.5), frameMat); bank.add(frame);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(4.6, 4.6, 0.6), lampMat);
      lamp.position.set(-15 + i * 6, -6 + j * 6, 1); bank.add(lamp);
    }
    bank.lookAt(0, 0, -140);
    scene.add(bank);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff5dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.85 }));
    glow.scale.set(150, 95, 1); glow.position.set(x, h + 8, z); scene.add(glow);
  }
}

// ------------------------------------------------------------ videoboards ----
const boardA = { cv: makeCanvas(1024, 410) }, boardB = { cv: makeCanvas(768, 410) };
for (const [b, th, r, w, h] of [[boardA, 24, 520, 132, 53], [boardB, -24, 520, 100, 53]]) {
  b.tex = canvasTex(b.cv);
  const x = r * Math.sin(th * DEG), z = -r * Math.cos(th * DEG);
  const grp = new THREE.Group(); grp.position.set(x, 78, z); grp.lookAt(0, 70, 0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 5, h + 5, 3), new THREE.MeshLambertMaterial({ color: 0x0c111b })); frame.position.z = -1.6; grp.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: b.tex, toneMapped: false })); grp.add(screen);
  scene.add(grp);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(4, 60, 4), new THREE.MeshLambertMaterial({ color: 0x2b3240 }));
    leg.position.set(x + s * (w / 3) * Math.cos(th * DEG), 26, z + s * (w / 3) * Math.sin(th * DEG)); scene.add(leg);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6b8cff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.22 }));
  glow.scale.set(w * 1.6, h * 1.8, 1); glow.position.set(x, 78, z); scene.add(glow);
}

// ------------------------------------------------------------------ ball ----
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x777777, roughness: 0.4 }));
ballMesh.castShadow = true;
scene.add(ballMesh);
const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
ballShadow.rotation.x = -Math.PI / 2; ballShadow.renderOrder = 2;
scene.add(ballShadow);
const TRAIL_N = 60;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
trail.frustumCulled = false; trail.visible = false;
scene.add(trail);
const trailPts = [];
function trailReset() { trailPts.length = 0; trail.visible = false; }
function trailPush(p) {
  trailPts.push(p.x, p.y, p.z); if (trailPts.length > TRAIL_N * 3) trailPts.splice(0, 3);
  const arr = trailGeo.attributes.position.array, n = trailPts.length / 3;
  for (let i = 0; i < TRAIL_N; i++) { const k = Math.min(i, n - 1) * 3; arr[i * 3] = trailPts[k]; arr[i * 3 + 1] = trailPts[k + 1]; arr[i * 3 + 2] = trailPts[k + 2]; }
  trailGeo.attributes.position.needsUpdate = true; trail.visible = n > 1;
}

// ------------------------------------------------- strike zone, PCI, aim ----
const overlay = new THREE.Group(); scene.add(overlay);
function lineMat(color, opacity) { return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }); }
const zoneGroup = new THREE.Group(); overlay.add(zoneGroup);
{
  const w = ZONE.halfW, b = ZONE.bot, t = ZONE.top;
  const box = new THREE.BufferGeometry().setFromPoints([new V3(-w, b, 0), new V3(w, b, 0), new V3(w, t, 0), new V3(-w, t, 0), new V3(-w, b, 0)]);
  const outline = new THREE.Line(box, lineMat(0xffffff, 0.9)); outline.renderOrder = 20; zoneGroup.add(outline);
  const gp = [];
  for (const f of [1 / 3, 2 / 3]) { const x = -w + 2 * w * f, y = b + (t - b) * f; gp.push(new V3(x, b, 0), new V3(x, t, 0), new V3(-w, y, 0), new V3(w, y, 0)); }
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gp), lineMat(0xffffff, 0.22)); grid.renderOrder = 20; grid.name = 'grid'; zoneGroup.add(grid);
}
function ellipsePts(rx, ry, n = 48) { const p = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; p.push(new V3(Math.cos(a) * rx, Math.sin(a) * ry, 0)); } return p; }
const pci = new THREE.Group(); overlay.add(pci); pci.visible = false;
{
  const outer = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ellipsePts(1, 1)), lineMat(0xffffff, 0.95)); outer.renderOrder = 22; pci.add(outer);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthTest: false, depthWrite: false })); fill.renderOrder = 21; pci.add(fill);
  const inner = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ellipsePts(0.32, 0.32)), lineMat(0xffc94a, 0.95)); inner.renderOrder = 22; pci.add(inner);
  const tk = []; for (const [a, b] of [[[-1.25, 0], [-0.75, 0]], [[1.25, 0], [0.75, 0]], [[0, 1.3], [0, 0.8]], [[0, -1.3], [0, -0.8]]]) tk.push(new V3(a[0], a[1], 0), new V3(b[0], b[1], 0));
  const ticks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tk), lineMat(0xffffff, 0.9)); ticks.renderOrder = 22; pci.add(ticks);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), new THREE.MeshBasicMaterial({ color: 0xffc94a, depthTest: false })); dot.renderOrder = 23; pci.add(dot);
}
const reticle = new THREE.Group(); overlay.add(reticle); reticle.visible = false;
const reticleMat = lineMat(0xff5a5f, 1);
{
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ellipsePts(0.16, 0.16, 32)), reticleMat); ring.renderOrder = 22; reticle.add(ring);
  const ring2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ellipsePts(0.3, 0.3, 32)), lineMat(0xffffff, 0.5)); ring2.renderOrder = 22; reticle.add(ring2);
  const tk = [new V3(-0.42, 0, 0), new V3(-0.2, 0, 0), new V3(0.42, 0, 0), new V3(0.2, 0, 0), new V3(0, 0.42, 0), new V3(0, 0.2, 0), new V3(0, -0.42, 0), new V3(0, -0.2, 0)];
  const ticks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tk), reticleMat); ticks.renderOrder = 22; reticle.add(ticks);
}
// Player Lock as the catcher: the mitt you frame the pitch with
const mitt = new THREE.Group(); overlay.add(mitt); mitt.visible = false;
{
  const fill = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false })); fill.renderOrder = 21; mitt.add(fill);
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ellipsePts(0.34, 0.34, 32)), lineMat(0xffc94a, 0.95)); ring.renderOrder = 22; mitt.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), new THREE.MeshBasicMaterial({ color: 0xffc94a, depthTest: false })); dot.renderOrder = 23; mitt.add(dot);
}
// last-pitch location marker
const pitchMark = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
pitchMark.renderOrder = 24; pitchMark.visible = false; overlay.add(pitchMark);

// easier-hitting guide: where the pitch will cross the plate
const pitchGuide = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.17, 28), new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.85, depthTest: false }));
pitchGuide.renderOrder = 24; pitchGuide.visible = false; overlay.add(pitchGuide);
// fielding helpers: ring under the fielder you control, target where a fly ball lands
const ctrlRing = new THREE.Mesh(new THREE.RingGeometry(7.0, 7.5, 48), new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.75, depthWrite: false }));
ctrlRing.rotation.x = -Math.PI / 2; ctrlRing.renderOrder = 3; ctrlRing.visible = false; scene.add(ctrlRing);
const landMark = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.0, 32), new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.85, depthWrite: false }));
landMark.rotation.x = -Math.PI / 2; landMark.renderOrder = 3; landMark.visible = false; scene.add(landMark);
// first-person throwing: the base you're facing lights up
const baseMark = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.2, 32), new THREE.MeshBasicMaterial({ color: 0x3fd38a, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
baseMark.rotation.x = -Math.PI / 2; baseMark.renderOrder = 25; baseMark.visible = false; scene.add(baseMark);

// ------------------------------------------------------------ camera rig ----
const camRig = { pos: new V3(0, 6, 10), look: new V3(0, 2.6, -40), fov: 38, tp: new V3(0, 6, 10), tl: new V3(0, 2.6, -40), tf: 38, rate: 6, shake: 0 };
function camTo(pos, look, fov, rate = 6, snap = false) {
  camRig.tp.copy(pos); camRig.tl.copy(look); camRig.tf = fov; camRig.rate = rate;
  if (snap) { camRig.pos.copy(pos); camRig.look.copy(look); camRig.fov = fov; }
}
function camUpdate(dt) {
  const k = 1 - Math.exp(-camRig.rate * dt);
  camRig.pos.lerp(camRig.tp, k); camRig.look.lerp(camRig.tl, k); camRig.fov = lerp(camRig.fov, camRig.tf, k);
  camera.position.copy(camRig.pos);
  if (camRig.shake > 0) { camRig.shake = Math.max(0, camRig.shake - dt * 2.5); const s = camRig.shake * 0.25; camera.position.x += randn() * s; camera.position.y += randn() * s; }
  camera.lookAt(camRig.look);
  if (Math.abs(camera.fov - camRig.fov) > 0.01) { camera.fov = camRig.fov; camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
}
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
