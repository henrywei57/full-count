// ============================================================================
// Players: procedural rig, uniforms, and pose library
// Model space: forward = +Z, up = +Y, the character's left side = +X.
// ============================================================================

const PGEO = {
  pelvis: new THREE.SphereGeometry(0.55, 14, 10),
  chest: new THREE.CapsuleGeometry(0.55, 1.0, 4, 12),
  head: new THREE.SphereGeometry(0.4, 16, 12),
  capTop: new THREE.SphereGeometry(0.43, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.BoxGeometry(0.6, 0.05, 0.42),
  helmet: new THREE.SphereGeometry(0.47, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
  flap: new THREE.SphereGeometry(0.2, 10, 8),
  uarm: new THREE.CapsuleGeometry(0.17, 0.72, 3, 8),
  farm: new THREE.CapsuleGeometry(0.145, 0.68, 3, 8),
  hand: new THREE.SphereGeometry(0.15, 8, 6),
  glove: new THREE.SphereGeometry(0.36, 10, 8),
  thigh: new THREE.CapsuleGeometry(0.25, 1.0, 3, 8),
  shin: new THREE.CapsuleGeometry(0.2, 0.5, 3, 8),
  sock: new THREE.CapsuleGeometry(0.175, 0.5, 3, 8),
  foot: new THREE.BoxGeometry(0.36, 0.22, 0.85),
  bat: (() => { const g = new THREE.CylinderGeometry(0.115, 0.048, 2.8, 12); g.translate(0, 1.4, 0); return g; })(),
  mask: new THREE.BoxGeometry(0.6, 0.55, 0.16),
  protector: new THREE.BoxGeometry(1.05, 1.25, 0.32),
  pad: new THREE.CapsuleGeometry(0.24, 0.7, 3, 8),
  number: new THREE.PlaneGeometry(0.9, 0.9),
};
const _mats = new Map();
function pmat(color, rough = 0.72) {
  const key = color + '|' + rough;
  if (!_mats.has(key)) _mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }));
  return _mats.get(key);
}
const _numMats = new Map();
function numberMat(num, fill, stroke) {
  const key = num + fill + stroke;
  if (_numMats.has(key)) return _numMats.get(key);
  const cv = makeCanvas(128, 128), g = cv.getContext('2d');
  g.font = '800 104px "Barlow Condensed", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = stroke; g.strokeText(String(num), 64, 70);
  g.fillStyle = fill; g.fillText(String(num), 64, 70);
  const m = new THREE.MeshStandardMaterial({ map: canvasTex(cv), transparent: true, alphaTest: 0.3, roughness: 0.7 });
  _numMats.set(key, m);
  return m;
}

const JOINTS = ['hips', 'torso', 'neck', 'shL', 'elL', 'handL', 'shR', 'elR', 'handR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR'];
const MODELS = [];

function makePlayer(o) {
  const root = new THREE.Group();
  const j = {};
  // catcher & umpire get their own materials so they can be faded out of the hitter's view
  const own = o.kind === 'catcher' || o.kind === 'ump';
  const M = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, own ? mat.clone() : mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const jersey = pmat(o.jersey), trim = pmat(o.trim), pants = pmat(o.pants), skin = pmat(o.skin, 0.6), sock = pmat(o.sock), cleat = pmat('#141414', 0.45), capM = pmat(o.cap, 0.55), glove = pmat(o.glove || '#6a3d1c', 0.55);
  j.hips = new THREE.Group(); j.hips.position.y = 3.15; root.add(j.hips);
  M(PGEO.pelvis, pants, j.hips).scale.set(1.22, 0.72, 0.85);
  j.torso = new THREE.Group(); j.torso.position.y = 0.2; j.hips.add(j.torso);
  M(PGEO.chest, jersey, j.torso, 0, 0.95, 0).scale.set(1.2, 1, 0.78);
  if (o.num != null) {
    const nm = new THREE.Mesh(PGEO.number, numberMat(o.num, o.numFill, o.numStroke));
    nm.position.set(0, 1.15, -0.45); nm.rotation.y = Math.PI; j.torso.add(nm);
  }
  j.neck = new THREE.Group(); j.neck.position.y = 2.02; j.torso.add(j.neck);
  M(PGEO.head, skin, j.neck, 0, 0.4, 0);
  j.cap = new THREE.Group(); j.neck.add(j.cap);
  M(PGEO.capTop, capM, j.cap, 0, 0.46, 0);
  M(PGEO.brim, capM, j.cap, 0, 0.49, 0.42);
  j.helmet = new THREE.Group(); j.neck.add(j.helmet); j.helmet.visible = false;
  const helmM = pmat(o.cap, 0.22);
  M(PGEO.helmet, helmM, j.helmet, 0, 0.42, 0);
  M(PGEO.brim, helmM, j.helmet, 0, 0.5, 0.44).scale.set(0.9, 1, 0.7);
  j.flap = M(PGEO.flap, helmM, j.helmet, 0.36, 0.3, 0.05);
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? 1 : -1;
    const sh = new THREE.Group(); sh.position.set(0.74 * sx, 1.6, 0); j.torso.add(sh);
    M(PGEO.uarm, jersey, sh, 0, -0.5, 0);
    const el = new THREE.Group(); el.position.y = -1.02; sh.add(el);
    M(PGEO.farm, trim, el, 0, -0.47, 0);
    const hand = new THREE.Group(); hand.position.y = -0.98; el.add(hand);
    const gloveSide = o.lefty ? 'R' : 'L';
    if (s === gloveSide && o.kind !== 'ump') { const gm = M(PGEO.glove, glove, hand, 0, -0.14, 0.06); gm.scale.set(0.8, 1.12, 0.5); j.gloveMesh = gm; }
    else M(PGEO.hand, skin, hand);
    j['sh' + s] = sh; j['el' + s] = el; j['hand' + s] = hand;
    const hp = new THREE.Group(); hp.position.set(0.3 * sx, -0.1, 0); j.hips.add(hp);
    M(PGEO.thigh, pants, hp, 0, -0.7, 0);
    const kn = new THREE.Group(); kn.position.y = -1.45; hp.add(kn);
    M(PGEO.shin, pants, kn, 0, -0.35, 0);
    M(PGEO.sock, sock, kn, 0, -0.93, 0);
    const an = new THREE.Group(); an.position.y = -1.35; kn.add(an);
    M(PGEO.foot, cleat, an, 0, -0.1, 0.2);
    j['hip' + s] = hp; j['knee' + s] = kn; j['ankle' + s] = an;
  }
  j.bat = new THREE.Group(); root.add(j.bat); j.bat.visible = false;
  M(PGEO.bat, pmat(o.batColor || '#c79a62', 0.35), j.bat);
  if (o.kind === 'catcher') {
    M(PGEO.protector, pmat('#1d2130', 0.5), j.torso, 0, 1.05, 0.36);
    M(PGEO.mask, pmat('#25272e', 0.35), j.neck, 0, 0.36, 0.36);
    j.helmet.visible = true; j.cap.visible = false;
    for (const s of ['L', 'R']) M(PGEO.pad, pmat('#1d2130', 0.5), j['knee' + s], 0, -0.6, 0.12);
  }
  if (o.kind === 'ump') {
    M(PGEO.protector, pmat(o.jersey, 0.8), j.torso, 0, 1.05, 0.3);
    M(PGEO.mask, pmat('#1a1a1a', 0.35), j.neck, 0, 0.36, 0.36);
  }
  const p = { root, j, o, anim: 'idle', t0: 0, prm: null, phase: 0, lefty: !!o.lefty, kind: o.kind || 'player' };
  p.idx = MODELS.length; MODELS.push(p);
  scene.add(root);
  root.visible = false;
  return p;
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
function poseRun(j, ph, k) {
  const s = Math.sin(ph), c = Math.cos(ph);
  j.hips.position.y = 3.02 + Math.abs(c) * 0.13 * k;
  j.torso.rotation.x = 0.22 * k; j.torso.rotation.y = s * 0.15 * k;
  j.hipL.rotation.x = -0.9 * s * k; j.hipR.rotation.x = 0.9 * s * k;
  j.kneeL.rotation.x = (0.25 + 1.3 * Math.max(0, -s)) * k + 0.1;
  j.kneeR.rotation.x = (0.25 + 1.3 * Math.max(0, s)) * k + 0.1;
  j.shL.rotation.x = 0.75 * s * k; j.shR.rotation.x = -0.75 * s * k;
  j.elL.rotation.x = -1.4; j.elR.rotation.x = -1.4;
  j.shL.rotation.z = 0.15; j.shR.rotation.z = -0.15;
}
function poseReady(j, t) {
  const b = Math.sin(t * 3) * 0.02;
  j.hips.position.y = 2.6 + b;
  j.hipL.rotation.set(-0.55, 0, 0.22); j.hipR.rotation.set(-0.55, 0, -0.22);
  j.kneeL.rotation.x = 0.95; j.kneeR.rotation.x = 0.95;
  j.ankleL.rotation.x = -0.4; j.ankleR.rotation.x = -0.4;
  j.torso.rotation.x = 0.5;
  j.neck.rotation.x = -0.45;
  j.shL.rotation.set(-0.95, 0, 0.2); j.shR.rotation.set(-0.95, 0, -0.2);
  j.elL.rotation.x = -0.5; j.elR.rotation.x = -0.5;
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
function poseThrow(p, t) {
  const j = p.j, T = p.lefty ? 'L' : 'R', Gl = p.lefty ? 'R' : 'L', sg = p.lefty ? -1 : 1;
  j.hips.position.y = kf(t, [[0, 3.0], [0.2, 2.85], [0.5, 2.95]]);
  j['sh' + T].rotation.x = kf(t, [[0, -0.5], [0.12, 1.6], [0.2, 2.6], [0.26, 4.1], [0.36, 4.9], [0.6, 5.4]]);
  j['sh' + T].rotation.z = outZ(T, kf(t, [[0, 0.2], [0.18, 0.7], [0.3, 0.3], [0.6, 0.1]]));
  j['el' + T].rotation.x = kf(t, [[0, -1.2], [0.12, -1.5], [0.26, -0.3], [0.6, -0.5]]);
  j['sh' + Gl].rotation.x = kf(t, [[0, -0.8], [0.16, -1.5], [0.3, -0.6], [0.6, -0.3]]);
  j['el' + Gl].rotation.x = -0.9;
  j.torso.rotation.y = sg * kf(t, [[0, -0.5], [0.16, -0.85], [0.3, 0.45], [0.6, 0.6]]);
  j.torso.rotation.x = kf(t, [[0, 0.1], [0.3, 0.45], [0.6, 0.3]]);
  j['hip' + Gl].rotation.x = kf(t, [[0, 0], [0.14, -0.6], [0.3, -0.4], [0.6, -0.2]]);
  j['knee' + Gl].rotation.x = kf(t, [[0, 0.2], [0.14, 0.7], [0.3, 0.4]]);
  j['hip' + T].rotation.x = kf(t, [[0, 0], [0.3, 0.3], [0.6, 0.6]]);
  j['knee' + T].rotation.x = kf(t, [[0, 0.2], [0.3, 0.5], [0.6, 0.9]]);
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
    case 'idle': j.torso.rotation.x = Math.sin(t * 1.2) * 0.02; break;
    case 'ready': poseReady(j, t); break;
    case 'run': poseRun(j, phase, 1); break;
    case 'jog': poseRun(j, phase, 0.6); break;
    case 'set': poseSet(p, t); break;
    case 'pitch': posePitch(p, t); break;
    case 'bat': poseBat(p, t, prm); break;
    case 'catcher': poseCatcher(p, t, prm); break;
    case 'ump': poseUmp(p, t, prm); break;
    case 'throw': poseThrow(p, t); break;
    case 'catchHigh': poseCatchHigh(p, t); break;
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
