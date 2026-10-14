// ============================================================================
// Players: procedural rig, uniforms, and pose library
// Model space: forward = +Z, up = +Y, the character's left side = +X.
// ============================================================================

// ---------------------------------------------------------------- geometry ----
const xf = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(sx, sy, sz));
// several pieces baked into one geometry (one draw call): [geometry, matrix] pairs, positions and normals
function mergeGeo(parts) {
  const gs = parts.map(([g, m]) => { const n = g.index ? g.toNonIndexed() : g.clone(); if (m) n.applyMatrix4(m); g.dispose(); return n; });
  const count = gs.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of gs) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
// a limb hanging from its joint: rounded at both ends, r1 at the joint tapering to r2, len long
function limbGeo(r1, r2, len, seg = 10) {
  const pts = [];
  for (let i = 0; i <= 4; i++) { const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r2, -len + Math.sin(a) * r2)); }
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r1, Math.sin(a) * r1)); }
  return new THREE.LatheGeometry(pts, seg);
}
// the torso's profile (radius, height above the waist), turned and squashed front to back:
// broad through the chest and shoulders, in at the waist
const TORSO = [[0.001, -0.02], [0.47, -0.02], [0.49, 0.05], [0.5, 0.3], [0.53, 0.6], [0.58, 0.95], [0.6, 1.25], [0.6, 1.52], [0.56, 1.72], [0.45, 1.87], [0.25, 1.97], [0.001, 2.0]];
const TORSO_S = [1.2, 1, 0.74];
function torsoR(y) {
  for (let i = 1; i < TORSO.length; i++) if (y <= TORSO[i][1]) { const [r0, y0] = TORSO[i - 1], [r1, y1] = TORSO[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0); }
  return 0;
}
// a patch of jersey just off the torso (the lettering, the name and number), mapped edge to edge
function torsoPatch(y0, y1, phi0, phiLen, off = 0.02) {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const y = y0 + ((y1 - y0) * i) / 6; pts.push(new THREE.Vector2(torsoR(y) + off, y)); }
  const g = new THREE.LatheGeometry(pts, 10, phi0, phiLen); g.scale(...TORSO_S);
  return g;
}
const PGEO = {
  pelvis: new THREE.SphereGeometry(0.55, 22, 14),
  torso: (() => { const g = new THREE.LatheGeometry(TORSO.map(([r, y]) => new THREE.Vector2(r, y)), 18); g.scale(...TORSO_S); return g; })(),
  belt: new THREE.CylinderGeometry(0.5, 0.5, 0.1, 18),
  chest: torsoPatch(0.95, 1.33, -0.62, 1.24),
  back: torsoPatch(0.7, 1.68, Math.PI - 0.62, 1.24),
  // neck, skull, nose and ears
  head: mergeGeo([
    [new THREE.CylinderGeometry(0.15, 0.17, 0.42, 10), xf(0, 0.1, -0.02)],
    [new THREE.SphereGeometry(0.4, 18, 14), xf(0, 0.42, 0, 0.88, 1.08, 0.97)],
    [new THREE.SphereGeometry(0.07, 8, 6), xf(0, 0.37, 0.38, 0.75, 1.1, 1)],
    [new THREE.SphereGeometry(0.09, 8, 6), xf(0.355, 0.41, 0, 0.45, 1, 0.75)],
    [new THREE.SphereGeometry(0.09, 8, 6), xf(-0.355, 0.41, 0, 0.45, 1, 0.75)],
  ]),
  // crown, a curved-down bill and the button on top
  cap: mergeGeo([
    [new THREE.SphereGeometry(0.43, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), xf(0, 0.47, -0.01, 0.95, 0.9, 1.02)],
    [new THREE.CylinderGeometry(0.3, 0.3, 0.035, 16, 1, false, -Math.PI / 2, Math.PI), xf(0, 0.5, 0.28, 1.1, 1, 1.3, 0.12)],
    [new THREE.SphereGeometry(0.045, 6, 4), xf(0, 0.47 + 0.43 * 0.9, -0.01)],
  ]),
  capLogo: (() => { const g = new THREE.SphereGeometry(0.44, 6, 4, Math.PI / 2 - 0.42, 0.84, 0.5, 0.62); g.applyMatrix4(xf(0, 0.47, -0.01, 0.95, 0.9, 1.02)); return g; })(),
  helmet: mergeGeo([
    [new THREE.SphereGeometry(0.47, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), xf(0, 0.42, 0)],
    [new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14, 1, false, -Math.PI / 2, Math.PI), xf(0, 0.5, 0.36, 1.05, 1, 0.8, 0.08)],
  ]),
  helmLogo: (() => { const g = new THREE.SphereGeometry(0.477, 6, 4, Math.PI / 2 - 0.4, 0.8, 0.5, 0.6); g.applyMatrix4(xf(0, 0.42, 0)); return g; })(),
  // the hair below the back of the cap
  hair: (() => { const g = new THREE.SphereGeometry(0.405, 14, 6, Math.PI * 1.05, Math.PI * 0.9, 1.0, 0.75); g.applyMatrix4(xf(0, 0.42, -0.01, 0.9, 1.08, 0.98)); return g; })(),
  flap: new THREE.SphereGeometry(0.2, 10, 8),
  sleeve: limbGeo(0.195, 0.18, 0.46),
  uarm: limbGeo(0.165, 0.14, 1.02),
  farm: limbGeo(0.145, 0.11, 0.98),
  hand: (() => { const g = new THREE.SphereGeometry(0.13, 10, 8); g.applyMatrix4(xf(0, -0.07, 0.01, 0.78, 1.2, 0.95)); return g; })(),
  glove: (tx) => mergeGeo([
    [new THREE.SphereGeometry(0.3, 14, 10), xf(0, -0.1, 0.05, 0.95, 1.15, 0.42)],
    [new THREE.SphereGeometry(0.2, 10, 8), xf(0, 0.2, 0.05, 1.2, 0.65, 0.42)],
    [new THREE.SphereGeometry(0.12, 8, 6), xf(tx, -0.06, 0.07, 0.8, 1.6, 0.6, 0, 0, tx > 0 ? -0.4 : 0.4)],
    [new THREE.CylinderGeometry(0.14, 0.15, 0.14, 10), xf(0, -0.42, 0.02)],
  ]),
  thigh: limbGeo(0.3, 0.215, 1.45, 14),
  shinShort: limbGeo(0.225, 0.2, 0.5),
  shinLong: limbGeo(0.225, 0.185, 1.22),
  sock: limbGeo(0.19, 0.13, 1.33),
  // a cleat: rounded upper on a flat sole
  foot: mergeGeo([
    [new THREE.CapsuleGeometry(0.15, 0.5, 4, 10), xf(0, -0.08, 0.19, 1.1, 1, 0.75, Math.PI / 2)],
    [new THREE.BoxGeometry(0.3, 0.05, 0.78), xf(0, -0.175, 0.19)],
  ]),
  bat: (() => { const g = new THREE.CylinderGeometry(0.115, 0.048, 2.8, 12); g.translate(0, 1.4, 0); return g; })(),
  mask: new THREE.BoxGeometry(0.62, 0.6, 0.18),
  protector: new THREE.BoxGeometry(1.1, 1.35, 0.3),
  pad: new THREE.CapsuleGeometry(0.24, 0.7, 3, 8),
};
PGEO.gloveL = PGEO.glove(-0.25); PGEO.gloveR = PGEO.glove(0.25);
const _mats = new Map();
function pmat(color, rough = 0.72) {
  const key = color + '|' + rough;
  if (!_mats.has(key)) _mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }));
  return _mats.get(key);
}
// lettering on the uniform: a cutout drawn on a canvas, pulled toward the camera so it never
// flickers into the cloth even far away
const _texMats = new Map();
function letterMat(key, w, h, draw) {
  if (_texMats.has(key)) return _texMats.get(key);
  const cv = makeCanvas(w, h), g = cv.getContext('2d');
  draw(g, w, h);
  const m = new THREE.MeshStandardMaterial({ map: canvasTex(cv), transparent: true, alphaTest: 0.35, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  _texMats.set(key, m);
  return m;
}
function fitText(g, text, x, y, maxW, size, font) {
  g.font = `${font} ${size}px "Barlow Condensed", Impact, sans-serif`;
  const w = g.measureText(text).width;
  if (w > maxW) { size *= maxW / w; g.font = `${font} ${size}px "Barlow Condensed", Impact, sans-serif`; }
  g.lineWidth = Math.max(3, size * 0.1); g.lineJoin = 'round';
  g.strokeText(text, x, y); g.fillText(text, x, y);
}
// the back of the jersey: last name over the number
function backMat(name, num, fill, stroke) {
  return letterMat(`back|${name}|${num}|${fill}|${stroke}`, 256, 256, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fill; g.strokeStyle = stroke;
    if (name) fitText(g, name.toUpperCase(), 128, 34, 220, 44, '700');
    if (num != null) fitText(g, String(num), 128, 158, 230, 158, '800');
  });
}
// the front: the club's name across the chest
function chestMat(text, fill, stroke) {
  return letterMat(`chest|${text}|${fill}|${stroke}`, 512, 128, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fill; g.strokeStyle = stroke;
    fitText(g, text, 256, 68, 480, 100, 'italic 800');
  });
}
function capLogoMat(text, fill, stroke) {
  return letterMat(`cap|${text}|${fill}|${stroke}`, 128, 128, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fill; g.strokeStyle = stroke;
    fitText(g, text, 64, 70, 116, 92, '800');
  });
}

const HAIR = ['#1b1512', '#2a1d14', '#3b2a1c', '#141414', '#5a3d24', '#20170f', '#6b4a2b', '#151110'];
const JOINTS = ['hips', 'torso', 'neck', 'shL', 'elL', 'handL', 'shR', 'elR', 'handR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR'];
const MODELS = [];

// o: { jersey, pants, trim, cap, sock, skin, num, numFill, numStroke, name, script, scriptFill, scriptStroke,
//      logo, logoFill, logoStroke, lefty, kind: 'catcher' | 'ump' | undefined }
function makePlayer(o) {
  const root = new THREE.Group();
  const j = {};
  // catcher & umpire get their own materials so they can be faded out of the hitter's view
  const own = o.kind === 'catcher' || o.kind === 'ump';
  // shadows come from the big pieces only (the small ones don't change the shadow, and each costs a draw)
  const M = (geo, mat, parent, x = 0, y = 0, z = 0, shadow = true) => { const m = new THREE.Mesh(geo, own ? mat.clone() : mat); m.position.set(x, y, z); m.castShadow = shadow; parent.add(m); return m; };
  const jersey = pmat(o.jersey), trim = pmat(o.trim), pants = pmat(o.pants), skin = pmat(o.skin, 0.6), sock = pmat(o.sock), cleat = pmat('#141414', 0.45), capM = pmat(o.cap, 0.55), glove = pmat(o.glove || '#6a3d1c', 0.55);
  // a little variety: some wear long sleeves under the jersey, some show their socks
  const n = o.num ?? 0, longSleeves = o.kind === 'ump' || n % 3 === 0, highSocks = o.kind !== 'ump' && n % 2 === 0;
  const armM = longSleeves ? trim : skin;
  j.hips = new THREE.Group(); j.hips.position.y = 3.15; root.add(j.hips);
  M(PGEO.pelvis, pants, j.hips).scale.set(1.12, 0.72, 0.78);
  j.torso = new THREE.Group(); j.torso.position.y = 0.2; j.hips.add(j.torso);
  M(PGEO.torso, jersey, j.torso);
  M(PGEO.belt, pmat('#1b1b1d', 0.5), j.torso, 0, 0.02, 0, false).scale.set(1.2, 1, 0.84);
  if (o.script) M(PGEO.chest, chestMat(o.script, o.scriptFill, o.scriptStroke), j.torso, 0, 0, 0, false);
  if (o.num != null || o.name) M(PGEO.back, backMat(o.name || '', o.num, o.numFill, o.numStroke), j.torso, 0, 0, 0, false);
  j.neck = new THREE.Group(); j.neck.position.y = 2.02; j.torso.add(j.neck);
  M(PGEO.head, skin, j.neck);
  M(PGEO.hair, pmat(o.hair || HAIR[(n * 7 + (o.name || '').length) % HAIR.length], 0.9), j.neck, 0, 0, 0, false);
  j.cap = new THREE.Group(); j.neck.add(j.cap);
  M(PGEO.cap, capM, j.cap, 0, 0, 0, false);
  const logo = o.logo ? capLogoMat(o.logo, o.logoFill, o.logoStroke) : null;
  if (logo) M(PGEO.capLogo, logo, j.cap, 0, 0, 0, false);
  j.helmet = new THREE.Group(); j.neck.add(j.helmet); j.helmet.visible = false;
  const helmM = pmat(o.cap, 0.22);
  M(PGEO.helmet, helmM, j.helmet, 0, 0, 0, false);
  if (logo) M(PGEO.helmLogo, logo, j.helmet, 0, 0, 0, false);
  j.flap = M(PGEO.flap, helmM, j.helmet, 0.36, 0.3, 0.05, false);
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? 1 : -1;
    const sh = new THREE.Group(); sh.position.set(0.74 * sx, 1.6, 0); j.torso.add(sh);
    M(PGEO.sleeve, jersey, sh, 0, -0.03, 0);
    M(PGEO.uarm, armM, sh, 0, -0.06, 0, false);
    const el = new THREE.Group(); el.position.y = -1.02; sh.add(el);
    M(PGEO.farm, armM, el);
    const hand = new THREE.Group(); hand.position.y = -0.98; el.add(hand);
    const gloveSide = o.lefty ? 'R' : 'L';
    if (s === gloveSide && o.kind !== 'ump') {
      const gm = M(s === 'L' ? PGEO.gloveL : PGEO.gloveR, glove, hand, 0, -0.04, 0.02, false);
      if (o.kind === 'catcher') gm.scale.set(1.15, 0.95, 1.3);
      j.gloveMesh = gm;
    } else M(PGEO.hand, skin, hand, 0, 0, 0, false);
    j['sh' + s] = sh; j['el' + s] = el; j['hand' + s] = hand;
    const hp = new THREE.Group(); hp.position.set(0.3 * sx, -0.1, 0); j.hips.add(hp);
    M(PGEO.thigh, pants, hp);
    const kn = new THREE.Group(); kn.position.y = -1.45; hp.add(kn);
    M(highSocks ? PGEO.shinShort : PGEO.shinLong, pants, kn);
    if (highSocks) M(PGEO.sock, sock, kn, 0, 0, 0, false);
    const an = new THREE.Group(); an.position.y = -1.35; kn.add(an);
    M(PGEO.foot, cleat, an, 0, 0, 0, false);
    j['hip' + s] = hp; j['knee' + s] = kn; j['ankle' + s] = an;
  }
  j.bat = new THREE.Group(); root.add(j.bat); j.bat.visible = false;
  M(PGEO.bat, pmat(o.batColor || '#c79a62', 0.35), j.bat);
  if (o.kind === 'catcher') {
    M(PGEO.protector, pmat('#1d2130', 0.5), j.torso, 0, 1.0, 0.33);
    M(PGEO.mask, pmat('#25272e', 0.35), j.neck, 0, 0.38, 0.4, false);
    j.helmet.visible = true; j.cap.visible = false;
    for (const s of ['L', 'R']) M(PGEO.pad, pmat('#1d2130', 0.5), j['knee' + s], 0, -0.6, 0.12);
  }
  if (o.kind === 'ump') {
    M(PGEO.protector, pmat(o.jersey, 0.8), j.torso, 0, 1.05, 0.3);
    M(PGEO.mask, pmat('#1a1a1a', 0.35), j.neck, 0, 0.38, 0.4, false);
  }
  const p = { root, j, o, anim: 'idle', t0: 0, prm: null, phase: 0, lean: 0, lefty: !!o.lefty, kind: o.kind || 'player' };
  p.idx = MODELS.length; MODELS.push(p);
  scene.add(root);
  root.visible = false;
  return p;
}
// how far a running player's legs cycle per foot: short quick steps slow, long strides flat out
const STRIDE = (v) => Math.PI / clamp(2.4 + v * 0.2, 3.4, 7.6);
// lean into a turn, harder the faster he's going (call after turning the root)
function turnLean(m, yawBefore, v) {
  const now = G.now, dt = now - (m.leanT ?? now); m.leanT = now;
  const w = dt > 0 && dt < 0.2 ? angDiff(yawBefore, m.root.rotation.y) / dt : 0;
  m.lean = lerp(m.lean || 0, clamp((-v * w) / 60, -0.3, 0.3), 0.2);
}
function setFade(p, a) {
  if (p.fade === a) return;
  p.fade = a;
  p.root.traverse((m) => {
    if (!m.isMesh) return;
    const tr = a < 1 || !!m.material.alphaTest;
    // switching transparency swaps shader variants (opaque ones force alpha to 1)
    if (m.material.transparent !== tr) { m.material.transparent = tr; m.material.needsUpdate = true; }
    m.material.opacity = a; m.material.depthWrite = a >= 1; m.castShadow = a >= 1;
  });
}
function setAnim(p, name, prm = null, now = G.now) {
  if (p.anim !== name || prm !== p.prm) { if (p.anim !== name) animBlend(p, name, now); p.anim = name; p.t0 = now; p.prm = prm; }
}
// Changing animations eases out of the old pose instead of snapping: remember where every
// joint is now and slerp from there into the new pose over a moment.
const BLEND_T = { dive: 0.08, throw: 0.1, pitch: 0.12, run: 0.16, jog: 0.16 };
function animBlend(p, name, now = G.now) {
  if (!p.root.visible) return;
  if (!p.snapQ) { p.snapQ = JOINTS.map(() => new THREE.Quaternion()); p.snapHips = new V3(); }
  JOINTS.forEach((k, i) => p.snapQ[i].copy(p.j[k].quaternion));
  p.snapHips.copy(p.j.hips.position);
  p.blend = { t0: now, dur: BLEND_T[name] ?? 0.14 };
}
const _qb = new THREE.Quaternion();
function applyBlend(p, now) {
  const b = p.blend; if (!b) return;
  const u = (now - b.t0) / b.dur;
  if (u >= 1 || u < 0) { p.blend = null; return; }
  const w = smooth(u);
  JOINTS.forEach((k, i) => { const q = p.j[k].quaternion; _qb.copy(q); q.copy(p.snapQ[i]).slerp(_qb, w); });
  p.j.hips.position.lerpVectors(p.snapHips, _v1.copy(p.j.hips.position), w);
}
function setHelmet(p, on) { if (p.kind === 'catcher') return; p.j.helmet.visible = on; p.j.cap.visible = !on; p.j.flap.position.x = (p.batsL ? -0.36 : 0.36); }

// ------------------------------------------------------------------ poses ----
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3(), _q1 = new THREE.Quaternion();
function aimArm(p, s, target, bend = 0.25) {
  const sh = p.j['sh' + s], el = p.j['el' + s];
  sh.rotation.set(0, 0, 0); sh.updateWorldMatrix(true, false);
  const sp = sh.getWorldPosition(_v1);
  const dir = _v2.copy(target).sub(sp);
  const len = dir.length(); dir.normalize();
  sh.parent.getWorldQuaternion(_q1); _q1.invert(); dir.applyQuaternion(_q1);
  sh.quaternion.setFromUnitVectors(DOWN, dir);
  // bend the elbow more when the target is close
  const b = clamp(bend + (2.0 - len) * 0.9, bend, 1.9);
  el.rotation.set(-b, 0, 0);
}
const outZ = (s, a) => (s === 'L' ? a : -a);

function poseReset(j) {
  for (const k of JOINTS) j[k].rotation.set(0, 0, 0);
  j.hips.position.set(0, 3.15, 0);
  j.shL.rotation.z = 0.12; j.shR.rotation.z = -0.12; j.elL.rotation.x = -0.25; j.elR.rotation.x = -0.25;
}
// running: phase advances with distance covered (STRIDE), k scales the effort (1 sprint, 0.6 jog).
// Each leg: thigh swings through, knee folds up behind him on the way forward and is nearly
// straight at the plant, the foot lands flat and toes off. Arms pump against the legs, shoulders
// counter the hips, the head stays level, and he leans into turns (p.lean).
function poseRun(p, ph, k) {
  const j = p.j, s = Math.sin(ph);
  j.hips.position.y = 2.96 + Math.abs(s) * 0.12 * k;   // lowest with a foot under him, highest in flight
  j.hips.rotation.y = -0.12 * s * k;
  j.hips.rotation.z = p.lean || 0;
  const lean = 0.1 + 0.16 * k;
  j.torso.rotation.x = lean + Math.abs(s) * 0.04 * k;
  j.torso.rotation.y = 0.26 * s * k;
  j.neck.rotation.x = -lean * 0.8;
  j.neck.rotation.y = -0.14 * s * k;
  for (const S of ['L', 'R']) {
    const f = S === 'L' ? ph : ph + Math.PI, sf = Math.sin(f), cf = Math.cos(f);
    const hip = -0.95 * sf * k;
    const knee = 0.28 + k * (1.7 * Math.pow(Math.max(0, Math.cos(f + 0.5)), 1.4) + 0.2 * Math.max(0, -cf));
    const toe = 0.85 * k * Math.pow(Math.max(0, Math.cos(f + Math.PI / 4)), 1.2);   // toes pointed after push-off
    j['hip' + S].rotation.set(hip, 0, S === 'L' ? 0.04 : -0.04);
    j['knee' + S].rotation.x = knee;
    j['ankle' + S].rotation.x = toe - hip - knee;
    // the arm on this side pumps with the other leg
    j['sh' + S].rotation.set(0.8 * sf * k, 0, S === 'L' ? 0.14 : -0.14);
    j['el' + S].rotation.x = -1.45 + 0.28 * sf * k;
  }
}
// standing: breathing, weight shifting from leg to leg, looking around now and then
function poseIdle(p, t) {
  const j = p.j, tt = t + p.idx * 2.3, sw = Math.sin(tt * 0.5);
  j.torso.rotation.x = 0.03 + Math.sin(tt * 1.7) * 0.012;
  j.torso.rotation.z = sw * 0.03; j.neck.rotation.z = -sw * 0.02;
  j.neck.rotation.y = Math.sin(tt * 0.27) * Math.sin(tt * 0.13 + 1) * 0.5;
  for (const [S, w] of [['L', Math.max(0, sw)], ['R', Math.max(0, -sw)]]) {
    const kn = 0.06 + w * 0.14, hz = S === 'L' ? 0.07 : -0.07;
    j['hip' + S].rotation.set(-kn * 0.5, 0, hz); j['knee' + S].rotation.x = kn;
    j['ankle' + S].rotation.set(-kn * 0.5, 0, -hz);
  }
  j.shL.rotation.set(Math.sin(tt * 0.5 + 1) * 0.04, 0, 0.14); j.shR.rotation.set(-Math.sin(tt * 0.5 + 1) * 0.04, 0, -0.14);
  j.elL.rotation.x = -0.22; j.elR.rotation.x = -0.22;
}
// the fielder's crouch: on the balls of his feet, glove out front, bouncing a little
function poseReady(p, t) {
  const j = p.j, tt = t + p.idx * 1.9, b = Math.sin(tt * 3.1) * 0.02, sw = Math.sin(tt * 0.9) * 0.05;
  const T = p.lefty ? 'L' : 'R', Gl = p.lefty ? 'R' : 'L';
  j.hips.position.y = 2.6 + b;
  j.hipL.rotation.set(-0.58, 0, 0.24); j.hipR.rotation.set(-0.58, 0, -0.24);
  j.kneeL.rotation.x = 1.0 + b; j.kneeR.rotation.x = 1.0 + b;
  j.ankleL.rotation.set(-0.42 - b, 0, -0.24); j.ankleR.rotation.set(-0.42 - b, 0, 0.24);
  j.torso.rotation.x = 0.5; j.torso.rotation.z = sw * 0.4;
  j.neck.rotation.x = -0.45; j.neck.rotation.z = -sw * 0.3;
  j['sh' + Gl].rotation.set(-1.05, 0, outZ(Gl, 0.22)); j['el' + Gl].rotation.x = -0.45;
  j['sh' + T].rotation.set(-0.9, 0, outZ(T, 0.2)); j['el' + T].rotation.x = -0.65;
}
function poseFieldLow(j) {
  j.hips.position.y = 2.15;
  j.hipL.rotation.set(-1.0, 0, 0.35); j.hipR.rotation.set(-0.7, 0, -0.35);
  j.kneeL.rotation.x = 1.6; j.kneeR.rotation.x = 1.3;
  j.torso.rotation.x = 0.95; j.neck.rotation.x = -0.6;
  j.shL.rotation.set(-0.7, 0, 0.1); j.shR.rotation.set(-0.7, 0, -0.1);
  j.elL.rotation.x = -0.2; j.elR.rotation.x = -0.3;
}
function poseCatchHigh(p, t) {
  const j = p.j, G_ = p.lefty ? 'R' : 'L', T = p.lefty ? 'L' : 'R';
  j.hips.position.y = 3.1;
  j['sh' + G_].rotation.set(-2.7, 0, outZ(G_, 0.15)); j['el' + G_].rotation.x = -0.3;
  j['sh' + T].rotation.set(-1.7, 0, outZ(T, -0.1)); j['el' + T].rotation.x = -0.8;
  j.neck.rotation.x = -0.3;
}
function poseDive(p, t) {
  const j = p.j, u = clamp(t / 0.35, 0, 1);
  j.hips.position.y = lerp(2.4, 0.95, u);
  j.hips.rotation.x = lerp(0.6, 1.4, u);
  j.neck.rotation.x = -0.9;
  j.shL.rotation.x = -2.9; j.shR.rotation.x = -2.6; j.elL.rotation.x = -0.1; j.elR.rotation.x = -0.2;
  j.hipL.rotation.x = 0.2; j.hipR.rotation.x = -0.1; j.kneeR.rotation.x = 0.6;
}
// catching: the glove goes out to the ball (prm.glove, a point in the world) as far as his arm
// reaches and the bare hand comes over to cover it; he gets down for a low one, stretches for a
// high one, leans toward one off to the side and watches it all the way in. prm.run: still
// running (0 when he's set), so a catch on the move keeps his legs going.
const _vcL = new V3(), _vcT = new V3();
function poseCatch(p, t, prm) {
  const j = p.j, Gl = p.lefty ? 'R' : 'L', T = p.lefty ? 'L' : 'R', bs = T === 'L' ? 1 : -1;
  const at = prm && prm.glove;
  if (!at) { poseReady(p, t); return; }
  p.root.updateMatrixWorld(true);
  const L = p.root.worldToLocal(_vcL.copy(at));   // in his own frame: x to his left, y up, z ahead
  const h = L.y, flat = Math.hypot(L.x, L.z), run = prm.run || 0;
  const low = clamp((2.6 - h) / 2.2, 0, 1), high = clamp((h - 5.4) / 2.5, 0, 1);
  if (run > 0) poseRun(p, p.phase, run);
  else {
    j.hips.position.y = lerp(2.95, 2.15, low) + high * 0.1;
    const hx = -lerp(0.22, 1.0, low), kn = lerp(0.3, 1.55, low);
    j.hipL.rotation.set(hx, 0, 0.28); j.hipR.rotation.set(hx, 0, -0.28);
    j.kneeL.rotation.x = kn; j.kneeR.rotation.x = kn;
    j.ankleL.rotation.set(-(hx + kn), 0, -0.28); j.ankleR.rotation.set(-(hx + kn), 0, 0.28);
  }
  j.torso.rotation.x = lerp(0.18, 0.9, low) - high * 0.22;
  j.torso.rotation.z = clamp(-L.x * 0.07, -0.32, 0.32);
  j.torso.rotation.y = clamp(Math.atan2(L.x, Math.max(0.6, L.z)) * 0.35, -0.5, 0.5);
  const eye = j.hips.position.y + 2.5, up = Math.atan2(h - eye, Math.max(0.5, flat));
  j.neck.rotation.x = clamp(-up - j.torso.rotation.x, -1.0, 0.9);
  j.neck.rotation.y = clamp(Math.atan2(L.x, Math.max(0.3, L.z)) - j.torso.rotation.y - j.hips.rotation.y, -1.1, 1.1);
  p.root.updateMatrixWorld(true);
  aimArm(p, Gl, at, 0.1);
  // the bare hand beside the glove (or by his chest when it's a backhand way out on the glove side)
  const k = L.x * -bs > 1.8 ? 0.35 : 0.85, cy = j.hips.position.y + 1.6;
  _vcT.set(lerp(0, L.x, k) + bs * 0.4, lerp(cy, h, k) - 0.25, lerp(0.5, L.z, k) - 0.2);
  aimArm(p, T, p.root.localToWorld(_vcT), 0.3);
}
// throwing: a stride with the glove-side foot, the arm comes through over the top, and the back
// leg comes off the ground in the follow-through
function poseThrow(p, t) {
  const j = p.j, T = p.lefty ? 'L' : 'R', Gl = p.lefty ? 'R' : 'L', sg = p.lefty ? -1 : 1;
  j.hips.position.y = kf(t, [[0, 3.0], [0.18, 2.82], [0.35, 2.76], [0.6, 2.9]]);
  j['sh' + T].rotation.x = kf(t, [[0, -0.5], [0.12, 1.6], [0.2, 2.6], [0.26, 4.1], [0.36, 4.9], [0.6, 5.4]]);
  j['sh' + T].rotation.z = outZ(T, kf(t, [[0, 0.2], [0.18, 0.7], [0.3, 0.3], [0.6, 0.1]]));
  j['el' + T].rotation.x = kf(t, [[0, -1.2], [0.12, -1.5], [0.26, -0.3], [0.6, -0.5]]);
  j['sh' + Gl].rotation.x = kf(t, [[0, -0.8], [0.16, -1.5], [0.3, -0.6], [0.6, -0.3]]);
  j['el' + Gl].rotation.x = -0.9;
  j.torso.rotation.y = sg * kf(t, [[0, -0.5], [0.16, -0.85], [0.3, 0.45], [0.6, 0.6]]);
  j.torso.rotation.x = kf(t, [[0, 0.1], [0.3, 0.5], [0.6, 0.55]]);
  j.neck.rotation.x = -kf(t, [[0, 0.05], [0.3, 0.35], [0.6, 0.4]]);
  const hg = kf(t, [[0, 0], [0.14, -0.75], [0.3, -0.55], [0.6, -0.35]]), kg = kf(t, [[0, 0.2], [0.14, 0.75], [0.3, 0.5], [0.6, 0.4]]);
  const ht = kf(t, [[0, 0], [0.3, 0.35], [0.6, 0.85]]), kt = kf(t, [[0, 0.2], [0.3, 0.5], [0.6, 1.3]]);
  j['hip' + Gl].rotation.x = hg; j['knee' + Gl].rotation.x = kg; j['ankle' + Gl].rotation.x = -(hg + kg);
  j['hip' + T].rotation.x = ht; j['knee' + T].rotation.x = kt; j['ankle' + T].rotation.x = -(ht + kt) + kf(t, [[0.3, 0], [0.6, 0.7]]);
}
// pitcher in the stretch, getting the sign
function poseSet(p, t) {
  const j = p.j, sg = p.lefty ? -1 : 1;
  j.hips.rotation.y = -1.15 * sg;
  j.neck.rotation.y = 1.0 * sg;
  j.hipL.rotation.z = 0.12; j.hipR.rotation.z = -0.12;
  j.kneeL.rotation.x = 0.15; j.kneeR.rotation.x = 0.15;
  j.shL.rotation.set(-0.55, 0, -0.38); j.shR.rotation.set(-0.55, 0, 0.38);
  j.elL.rotation.x = -1.75; j.elR.rotation.x = -1.75;
  j.torso.rotation.x = 0.05 + Math.sin(t * 1.5) * 0.015;
}
const RELEASE_T = 0.95;
function posePitch(p, t) {
  const j = p.j, T = p.lefty ? 'L' : 'R', Gl = p.lefty ? 'R' : 'L', sg = p.lefty ? -1 : 1;
  j.hips.position.y = kf(t, [[0, 3.15], [0.3, 3.12], [0.6, 2.85], [0.95, 2.6], [1.3, 2.7]]);
  j.hips.position.z = kf(t, [[0, 0], [0.5, 0.3], [0.95, 2.4], [1.3, 2.9]]);
  j.hips.rotation.y = sg * kf(t, [[0, -1.15], [0.6, -1.1], [0.85, -0.35], [1.0, 0.1], [1.3, 0.25]]);
  j.neck.rotation.y = sg * kf(t, [[0, 1.0], [0.6, 1.0], [0.9, 0.3], [1.1, 0]]);
  j.torso.rotation.y = sg * kf(t, [[0, 0], [0.4, -0.25], [0.8, -0.2], [0.95, 0.45], [1.3, 0.7]]);
  j.torso.rotation.x = kf(t, [[0, 0.05], [0.35, -0.08], [0.75, -0.12], [0.95, 0.55], [1.3, 0.8]]);
  j['hip' + Gl].rotation.x = kf(t, [[0, 0], [0.3, -1.5], [0.5, -1.45], [0.8, -0.85], [0.95, -0.7], [1.3, -0.55]]);
  j['knee' + Gl].rotation.x = kf(t, [[0, 0.1], [0.3, 1.7], [0.5, 1.5], [0.8, 0.45], [0.95, 0.35], [1.3, 0.3]]);
  j['hip' + T].rotation.x = kf(t, [[0, 0], [0.6, 0.1], [0.9, 0.6], [1.0, 0.95], [1.3, 1.25]]);
  j['knee' + T].rotation.x = kf(t, [[0, 0.1], [0.6, 0.4], [0.95, 0.9], [1.3, 1.45]]);
  j['sh' + T].rotation.x = kf(t, [[0, -0.55], [0.3, -0.6], [0.55, 1.0], [0.8, 2.4], [0.88, 3.3], [0.95, 4.2], [1.05, 5.0], [1.3, 5.6]]);
  j['sh' + T].rotation.z = outZ(T, kf(t, [[0, -0.38], [0.35, -0.2], [0.55, 0.5], [0.8, 0.9], [0.95, 0.4], [1.3, 0.1]]));
  j['el' + T].rotation.x = kf(t, [[0, -1.75], [0.3, -1.7], [0.55, -0.6], [0.8, -1.6], [0.95, -0.35], [1.1, -0.2], [1.3, -0.6]]);
  j['sh' + Gl].rotation.x = kf(t, [[0, -0.55], [0.3, -0.7], [0.6, -1.45], [0.85, -1.5], [1.0, -0.4], [1.3, -0.3]]);
  j['sh' + Gl].rotation.z = outZ(Gl, kf(t, [[0, -0.38], [0.3, -0.2], [0.6, 0.55], [0.9, 0.4], [1.3, 0.3]]));
  j['el' + Gl].rotation.x = kf(t, [[0, -1.75], [0.6, -0.5], [0.95, -1.6], [1.3, -1.4]]);
}
// batting: prm = { m: +1 RHB / -1 LHB, swingT, dur, hc, hzc, elc, bunt }
const SW_KEYS = {
  phi: [[0, 0.25], [0.2, 0.55], [0.42, 1.62], [0.65, 2.7], [1, 4.0]],
  hx: [[0, -0.55], [0.2, -0.2], [0.42, 0.35], [0.65, 0.6], [1, 0.15]],
  hipY: [[0, -0.1], [0.2, 0.1], [0.42, 0.55], [1, 0.85]],
  torY: [[0, -0.2], [0.2, -0.1], [0.42, 0.25], [0.65, 0.45], [1, 0.6]],
};
const SWING_CONTACT = 0.42;
function poseBat(p, t, prm) {
  const j = p.j, m = prm.m;
  const F = m > 0 ? 'L' : 'R', B = m > 0 ? 'R' : 'L';
  j.hips.position.y = 2.95;
  j['hip' + F].rotation.set(-0.15, 0, outZ(F, 0.24)); j['hip' + B].rotation.set(-0.25, 0, outZ(B, 0.2));
  j['knee' + F].rotation.x = 0.35; j['knee' + B].rotation.x = 0.45;
  j.torso.rotation.x = 0.2;
  j.neck.rotation.y = 1.05 * m;
  let s = -1;
  if (prm.swingT != null && t >= prm.swingT) s = clamp((t - prm.swingT) / prm.dur, 0, 1);
  let phi, el, hx, hy, hz, hipY, torY;
  if (prm.bunt) {
    phi = Math.PI / 2; el = 0.12; hx = 0.45; hy = (prm.hc ?? 2.9) + 0.25; hz = 1.1; hipY = 0.5; torY = 0.4;
    j.hips.position.y = 2.75;
  } else if (s < 0) {
    const w = Math.sin(t * 2.3) * 0.07;
    phi = 0.25 + w; el = 1.05 + w * 0.4; hx = -0.55; hy = 4.75 + w * 0.25; hz = 0.35; hipY = -0.1; torY = -0.2;
    j['hip' + F].rotation.x = -0.15 + Math.max(0, Math.sin(t * 1.1)) * 0.06;
  } else {
    const hc = prm.hc ?? 3.2, elc = prm.elc ?? -0.08, hzc = prm.hzc ?? 0.85;
    phi = kf(s, SW_KEYS.phi); hx = kf(s, SW_KEYS.hx); hipY = kf(s, SW_KEYS.hipY); torY = kf(s, SW_KEYS.torY);
    el = kf(s, [[0, 1.05], [0.2, 0.65], [SWING_CONTACT, elc], [0.65, 0.15], [1, 0.95]]);
    hy = kf(s, [[0, 4.75], [0.2, 4.2], [SWING_CONTACT, hc], [0.65, hc + 0.5], [1, 5.0]]);
    hz = kf(s, [[0, 0.35], [0.2, 0.5], [SWING_CONTACT, hzc], [0.65, 0.7], [1, -0.1]]);
    j['hip' + F].rotation.x = kf(s, [[0, -0.15], [0.15, -0.45], [0.42, -0.25], [1, -0.2]]);
    j['knee' + F].rotation.x = kf(s, [[0, 0.35], [0.15, 0.6], [0.42, 0.15], [1, 0.1]]);
    j['knee' + B].rotation.x = kf(s, [[0, 0.45], [0.42, 0.8], [1, 0.9]]);
    j['hip' + B].rotation.y = m * kf(s, [[0, 0], [0.42, 0.5], [1, 0.8]]);
    j.neck.rotation.y = m * kf(s, [[0, 1.05], [0.42, 0.85], [1, 0.3]]);
  }
  j.hips.rotation.y = hipY * m; j.torso.rotation.y = torY * m;
  const dir = _v3.set(-m * Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
  j.bat.position.set(hx * m, hy, hz);
  j.bat.quaternion.setFromUnitVectors(UP, dir);
  p.root.updateMatrixWorld(true);
  const hw = p.root.localToWorld(_v4.set(hx * m, hy, hz));
  aimArm(p, 'L', hw, 0.15); aimArm(p, 'R', hw, 0.3);
}
// catcher: prm.glove = world target for the mitt
function poseCatcher(p, t, prm) {
  const j = p.j;
  j.hips.position.y = 1.3;
  j.hipL.rotation.set(-1.5, 0, 0.55); j.hipR.rotation.set(-1.5, 0, -0.55);
  j.kneeL.rotation.x = 2.55; j.kneeR.rotation.x = 2.55;
  j.ankleL.rotation.x = -0.95; j.ankleR.rotation.x = -0.95;
  j.torso.rotation.x = 0.42;
  j.neck.rotation.x = -0.15;
  const T = p.lefty ? 'L' : 'R', Gl = p.lefty ? 'R' : 'L';
  j['sh' + T].rotation.set(-0.35, 0, outZ(T, 0.1)); j['el' + T].rotation.x = -1.3;
  if (prm && prm.glove) aimArm(p, Gl, prm.glove, 0.2);
  else { j['sh' + Gl].rotation.set(-1.2, 0, outZ(Gl, 0.2)); j['el' + Gl].rotation.x = -0.6; }
}
function poseUmp(p, t, prm) {
  const j = p.j;
  const callT = prm && prm.callT != null ? t - prm.callT : -1;
  if (callT >= 0 && callT < 1.4 && prm.call) {
    const u = kf(callT, [[0, 0], [0.18, 1], [1.1, 1], [1.4, 0]]);
    j.hips.position.y = lerp(2.5, 3.1, u);
    j.torso.rotation.x = lerp(0.55, 0.05, u);
    if (prm.call === 'strike') {
      j.shR.rotation.set(-0.3 * u, 0, -1.45 * u); j.elR.rotation.set(-1.7 * u, 0, 0);
      j.torso.rotation.y = -0.5 * u;
    } else if (prm.call === 'safe') {
      j.shL.rotation.set(-0.2, 0, 1.4 * u); j.shR.rotation.set(-0.2, 0, -1.4 * u);
    } else if (prm.call === 'out') {
      j.shR.rotation.set(-2.6 * u, 0, -0.3 * u); j.elR.rotation.x = -1.6 * u;
    }
    return;
  }
  j.hips.position.y = 2.5;
  j.hipL.rotation.set(-0.6, 0, 0.35); j.hipR.rotation.set(-0.6, 0, -0.35);
  j.kneeL.rotation.x = 1.05; j.kneeR.rotation.x = 1.05;
  j.torso.rotation.x = 0.55; j.neck.rotation.x = -0.5;
  j.shL.rotation.set(-0.6, 0, 0.1); j.shR.rotation.set(-0.6, 0, -0.1);
  j.elL.rotation.x = -0.9; j.elR.rotation.x = -0.9;
}
// fielder with the ball, gathering to throw: glove at the chest, throwing hand in the glove,
// shoulders turning to the throwing side
function poseGather(p, t) {
  const j = p.j, T = p.lefty ? 'L' : 'R', Gl = p.lefty ? 'R' : 'L', sg = p.lefty ? -1 : 1, u = clamp(t / 0.25, 0, 1);
  j.hips.position.y = lerp(2.7, 2.95, u);
  j.hipL.rotation.set(-0.3, 0, 0.18); j.hipR.rotation.set(-0.3, 0, -0.18);
  j.kneeL.rotation.x = lerp(0.8, 0.45, u); j.kneeR.rotation.x = lerp(0.8, 0.45, u);
  j.torso.rotation.x = lerp(0.45, 0.15, u); j.torso.rotation.y = sg * -0.35 * u;
  j['sh' + Gl].rotation.set(-1.2, 0, outZ(Gl, -0.25)); j['el' + Gl].rotation.x = -1.6;
  j['sh' + T].rotation.set(-1.0 - 0.3 * u, 0, outZ(T, -0.35)); j['el' + T].rotation.x = -1.7;
  j.neck.rotation.y = sg * 0.3 * u;
}
function poseCheer(j, t) {
  j.shL.rotation.set(-2.9 + Math.sin(t * 9) * 0.25, 0, 0.3); j.shR.rotation.set(-2.9 - Math.sin(t * 9) * 0.25, 0, -0.3);
  j.elL.rotation.x = -0.3; j.elR.rotation.x = -0.3;
}
function applyPose(p, name, t, prm, phase) {
  const j = p.j;
  poseReset(j);
  switch (name) {
    case 'idle': poseIdle(p, t); break;
    case 'ready': poseReady(p, t); break;
    case 'run': poseRun(p, phase, 1); break;
    case 'jog': poseRun(p, phase, 0.6); break;
    case 'set': poseSet(p, t); break;
    case 'pitch': posePitch(p, t); break;
    case 'bat': poseBat(p, t, prm); break;
    case 'catcher': poseCatcher(p, t, prm); break;
    case 'ump': poseUmp(p, t, prm); break;
    case 'throw': poseThrow(p, t); break;
    case 'catchHigh': poseCatchHigh(p, t); break;
    case 'catch': poseCatch(p, t, prm); break;
    case 'gather': poseGather(p, t); break;
    case 'fieldLow': poseFieldLow(j); break;
    case 'dive': poseDive(p, t); break;
    case 'cheer': poseCheer(j, t); break;
  }
  j.bat.visible = name === 'bat';
  if (j.gloveMesh) j.gloveMesh.visible = !!p.fielding;
}
function updateModel(p, now) {
  if (!p.root.visible) return;
  applyPose(p, p.anim, now - p.t0, p.prm, p.phase);
  if (p.blend) applyBlend(p, now);
}
function handWorld(p, s, out) { p.root.updateMatrixWorld(true); return p.j['hand' + s].getWorldPosition(out); }
