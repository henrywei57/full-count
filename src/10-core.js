import * as THREE from 'three';

// ============================================================================
// Core utilities, field geometry, rosters, audio and commentary
// Units are feet. Home plate is the origin, center field is toward -Z,
// first base toward +X. Spray angle 0 = straight away center, + toward right.
// ============================================================================

const V3 = THREE.Vector3;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = (a) => a[(Math.random() * a.length) | 0];
const DEG = Math.PI / 180;
const MPH = 1.46667;
const G_ACC = 32.17;
const UP = new V3(0, 1, 0);
const DOWN = new V3(0, -1, 0);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// keyframe interpolation with smoothstep easing between keys
function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      return a[1] + (b[1] - a[1]) * smooth((t - a[0]) / (b[0] - a[0]));
    }
  }
  return keys[keys.length - 1][1];
}
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function shortName(n) { const p = n.split(' '); return p.length < 2 ? n : p[0][0] + '. ' + p.slice(1).join(' '); }
function lastName(n) { return n.split(' ').slice(1).join(' ') || n; }
// escape text that came from a player (custom roster names, friends' names) before it goes into innerHTML
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

// ---------------------------------------------------------------- field ----
const BASES = [new V3(0, 0, 0), new V3(63.64, 0, -63.64), new V3(0, 0, -127.28), new V3(-63.64, 0, -63.64), new V3(0, 0, 0)];
const MOUND_Z = -60.5, MOUND_H = 0.83, MOUND_R = 9;
const ZONE = { halfW: 0.83, bot: 1.55, top: 3.45 };
const FENCE_H = 9.5;
const BALL_R = 0.12;

function fenceDist(th) {
  const a = Math.min(45, Math.abs(th));
  const pts = [[0, 400], [10, 394], [20, 377], [30, 358], [38, 342], [45, 330]];
  for (let i = 1; i < pts.length; i++) {
    if (a <= pts[i][0]) { const [a0, d0] = pts[i - 1], [a1, d1] = pts[i]; return lerp(d0, d1, (a - a0) / (a1 - a0)); }
  }
  return 330;
}
// Closed boundary of the playing field (fence + foul-territory walls + backstop), as [x, z]
const FENCE_PTS = [];
const BOUNDARY = (() => {
  const pts = [];
  for (let th = -45; th <= 45.001; th += 1.5) { const d = fenceDist(th); const p = [d * Math.sin(th * DEG), -d * Math.cos(th * DEG)]; pts.push(p); FENCE_PTS.push(p); }
  const u = [Math.SQRT1_2, -Math.SQRT1_2], n = [Math.SQRT1_2, Math.SQRT1_2];
  const side = (s, off) => [u[0] * s + n[0] * off, u[1] * s + n[1] * off];
  const right = [side(318, 12), side(250, 22), side(170, 34), side(105, 44), [92, -14], [76, 18], [52, 42], [26, 56], [0, 61]];
  pts.push(...right);
  const left = right.slice(0, -1).reverse().map(([x, z]) => [-x, z]);
  pts.push(...left);
  return pts;
})();
function inPoly(x, z, poly = BOUNDARY) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function groundY(x, z) { const d = Math.hypot(x, z - MOUND_Z); return d < MOUND_R ? MOUND_H * clamp((MOUND_R - d) / 6.4, 0, 1) : 0; }
function sprayOf(x, z) { return Math.atan2(x, -z) / DEG; }
function isFairAngle(th) { return Math.abs(th) <= 45.4; }
function isDirt(x, z) {
  const r = Math.hypot(x, z);
  if (r < 13) return true;
  if (Math.hypot(x, z - MOUND_Z) < MOUND_R) return true;
  const th = Math.abs(sprayOf(x, z));
  if (th > 50 || Math.hypot(x, z - MOUND_Z) > 95) return false;
  // inside the inset grass square?
  const u = (x - z) / Math.SQRT2, v = (-x - z) / Math.SQRT2; // rotated axes along baselines
  return !(u > 3 && v > 3 && u < 87 && v < 87);
}
function inZone(x, y) { return Math.abs(x) <= ZONE.halfW + BALL_R && y >= ZONE.bot - BALL_R && y <= ZONE.top + BALL_R; }

// ---------------------------------------------------------- pitch types ----
// d: mph relative to the pitcher's fastball, h: horizontal break toward arm side (in), v: vertical vs. a spinless pitch (in)
const PITCH_TYPES = {
  FF: { name: '4-Seam Fastball', short: '4SFB', d: 0, h: 7, v: 15, col: '#ff5a5f' },
  SI: { name: 'Sinker', short: 'SNK', d: -2, h: 15, v: 6, col: '#ff9f43' },
  FC: { name: 'Cutter', short: 'CUT', d: -6, h: -3, v: 8, col: '#f8d64e' },
  SL: { name: 'Slider', short: 'SL', d: -9, h: -7, v: 1, col: '#5aa8ff' },
  SW: { name: 'Sweeper', short: 'SWP', d: -13, h: -15, v: 0, col: '#8f86ff' },
  CU: { name: 'Curveball', short: 'CB', d: -16, h: -8, v: -14, col: '#3fd38a' },
  KC: { name: 'Knuckle Curve', short: 'KC', d: -13, h: -6, v: -11, col: '#2ec4b6' },
  CH: { name: 'Changeup', short: 'CH', d: -9, h: 14, v: 5, col: '#c77dff' },
  FS: { name: 'Splitter', short: 'SPL', d: -8, h: 9, v: 0, col: '#ff7eb6' },
};
const FASTBALLS = new Set(['FF', 'SI']);
const BREAKING = new Set(['SL', 'SW', 'CU', 'KC', 'FC']);

// ---------------------------------------------------------------- teams ----
const TEAM_DEFS = [
  { id: 'HAW', city: 'Harbor City', name: 'Hawks', c1: '#13294b', c2: '#f26a21', bat: 78, pit: 76, def: 74 },
  { id: 'RAT', city: 'Mesa', name: 'Rattlers', c1: '#7a1f2b', c2: '#e0b973', bat: 74, pit: 80, def: 73 },
  { id: 'LUM', city: 'Northport', name: 'Lumberjacks', c1: '#1e4d2b', c2: '#e3b23c', bat: 81, pit: 72, def: 73 },
  { id: 'COM', city: 'Capital', name: 'Comets', c1: '#b3122e', c2: '#dfe6f5', bat: 76, pit: 77, def: 78 },
  { id: 'GAT', city: 'Bayou', name: 'Gators', c1: '#0d6e6e', c2: '#f2c14e', bat: 72, pit: 79, def: 80 },
  { id: 'FRG', city: 'Steel City', name: 'Forge', c1: '#1b1b1f', c2: '#f2b51b', bat: 80, pit: 74, def: 71 },
  { id: 'VAQ', city: 'Rio Grande', name: 'Vaqueros', c1: '#7b3f14', c2: '#7fd6c9', bat: 75, pit: 75, def: 79 },
  { id: 'PKS', city: 'Summit', name: 'Peaks', c1: '#1f6fb2', c2: '#e8f3ff', bat: 77, pit: 78, def: 75 },
];
const FIRST = ['Marcus', 'Diego', 'Tyler', 'Kenji', 'Andre', 'Luis', 'Jalen', 'Cole', 'Mateo', 'Owen', 'Rafael', 'Darius', 'Hunter', 'Yuki', 'Elijah', 'Santiago', 'Brady', 'Malik', 'Nolan', 'Javier', 'Cameron', 'Isaiah', 'Trevor', 'Kai', 'Wesley', 'Dominic', 'Reggie', 'Felix', 'Logan', 'Emilio', 'Grant', 'Tomas', 'Xavier', 'Shane', 'Hector', 'Bryce', 'Jonah', 'Andres', 'Caleb', 'Rico', 'Damon', 'Ian', 'Victor', 'Austin', 'Gabe', 'Theo', 'Ramon', 'Miles', 'Oscar', 'Ezra', 'Quinn', 'Silas', 'Joaquin', 'Desmond', 'Ty', 'Royce', 'Callum', 'Nico', 'Tobias', 'Ahmad'];
const LAST = ['Vale', 'Okafor', 'Brennan', 'Whitlock', 'Holloway', 'Pruitt', 'Marsh', 'Kowalski', 'Fairbanks', 'Ibarra', 'Lindqvist', 'Thorne', 'Quintero', 'Hargrove', 'Calloway', 'Strand', 'Ocampo', 'Fujimoto', 'Ashby', 'Bellamy', 'Duquette', 'Kessler', 'Abernathy', 'Lark', 'Winslow', 'Gallardo', 'Draper', 'Nakamura', 'Corbin', 'Hale', 'Bishop', 'Kemper', 'Sutton', 'Ferris', 'Oduya', 'Haskins', 'Prentice', 'Cordero', 'Maddox', 'Iwata', 'Carrow', 'Solano', 'Teague', 'Mercer', 'Banda', 'Aldana', 'Pike', 'Rutledge', 'Esparza', 'Okonjo', 'Linwood', 'Del Toro', 'Halvorsen', 'Quarles', 'Ybarra', 'Coyle', 'Barrientos', 'Nwosu', 'Kimura', 'Stroud', 'Pellegrini', 'Archuleta', 'Tolliver', 'Vance', 'Huxley'];
const POS_LIST = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const PROFILE = {
  C: { con: -3, pow: 2, eye: 0, spd: -16, arm: 8, fld: 4 },
  '1B': { con: 2, pow: 10, eye: 3, spd: -10, arm: -8, fld: -2 },
  '2B': { con: 4, pow: -6, eye: 2, spd: 6, arm: -2, fld: 6 },
  '3B': { con: 0, pow: 5, eye: 0, spd: -3, arm: 10, fld: 4 },
  SS: { con: 1, pow: -3, eye: 0, spd: 8, arm: 10, fld: 10 },
  LF: { con: 2, pow: 5, eye: 1, spd: 2, arm: -4, fld: -4 },
  CF: { con: 2, pow: -2, eye: 1, spd: 14, arm: 3, fld: 10 },
  RF: { con: 0, pow: 6, eye: 0, spd: 3, arm: 12, fld: 2 },
  DH: { con: 3, pow: 12, eye: 4, spd: -8, arm: -10, fld: -15 },
};
const SKINS = ['#f1c7a5', '#e3b08c', '#c98a63', '#a96c48', '#8a5536', '#6b4029', '#f5d4bb', '#d9a07a'];

function genTeam(def, idx) {
  const r = mulberry32(9137 + idx * 7919);
  const g = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const used = new Set(), nums = new Set();
  const nm = () => { for (;;) { const n = FIRST[(r() * FIRST.length) | 0] + ' ' + LAST[(r() * LAST.length) | 0]; if (!used.has(n)) { used.add(n); return n; } } };
  const num = () => { for (;;) { const n = 1 + ((r() * 78) | 0); if (!nums.has(n)) { nums.add(n); return n; } } };
  const rt = (base, d, sd = 8) => clamp(Math.round(base + d + g() * sd), 38, 99);
  const skin = () => SKINS[(r() * SKINS.length) | 0];
  const team = { ...def, idx, hitters: [], pitchers: [] };
  for (const pos of POS_LIST) {
    const P = PROFILE[pos];
    const bats = r() < 0.32 ? 'L' : r() < 0.07 ? 'S' : 'R';
    team.hitters.push({
      id: def.id + '-' + pos, name: nm(), num: num(), pos, bats, throws: (bats === 'L' && ['1B', 'LF', 'RF', 'DH', 'CF'].includes(pos) && r() < 0.6) ? 'L' : 'R',
      con: rt(def.bat, P.con), pow: rt(def.bat, P.pow, 10), eye: rt(def.bat, P.eye), spd: rt(70, P.spd, 10),
      arm: rt(def.def, P.arm), fld: rt(def.def, P.fld), skin: skin(), team,
    });
  }
  // batting order
  const hs = [...team.hitters];
  const take = (score) => { hs.sort((a, b) => score(b) - score(a)); return hs.shift(); };
  const order = [
    take((h) => h.spd * 0.6 + h.con * 0.7 + h.eye * 0.3),
    take((h) => h.con + h.eye * 0.5),
    take((h) => h.con * 0.8 + h.pow),
    take((h) => h.pow * 1.2 + h.con * 0.4),
    take((h) => h.pow + h.con * 0.5),
  ];
  hs.sort((a, b) => b.con + b.pow - (a.con + a.pow));
  team.lineup = order.concat(hs);
  // pitching staff: one starter, three relievers
  const pool = ['SL', 'CU', 'CH', 'FC', 'SW', 'FS', 'KC'];
  for (let i = 0; i < 4; i++) {
    const sp = i === 0, L = r() < 0.3;
    const p = {
      id: def.id + '-P' + i, name: nm(), num: num(), pos: sp ? 'SP' : 'RP', throws: L ? 'L' : 'R', bats: L ? 'L' : 'R',
      velo: clamp(Math.round((sp ? 93.5 : 95.5) + (def.pit - 76) * 0.25 + g() * 1.8), 89, 101),
      ctl: rt(def.pit, sp ? 2 : -2), stam: sp ? rt(90, 0, 5) : rt(42, 0, 6),
      spd: 45, arm: 72, fld: 62, con: 22, pow: 15, eye: 25, skin: skin(), team,
    };
    const fast = r() < 0.75 ? 'FF' : 'SI';
    const ars = [fast];
    if (sp && fast === 'FF' && r() < 0.4) ars.push('SI');
    const n = sp ? 4 + (r() < 0.35 ? 1 : 0) : 3;
    while (ars.length < n) {
      const t = pool[(r() * pool.length) | 0];
      if (ars.includes(t)) continue;
      if ((t === 'KC' && ars.includes('CU')) || (t === 'CU' && ars.includes('KC'))) continue;
      if ((t === 'SW' && ars.includes('SL')) || (t === 'SL' && ars.includes('SW'))) continue;
      ars.push(t);
    }
    p.pitches = ars.map((t) => ({ type: t, velo: p.velo + PITCH_TYPES[t].d + Math.round(g() * 1.2), brk: clamp(0.88 + r() * 0.3 + (def.pit - 76) * 0.01, 0.78, 1.3) }));
    team.pitchers.push(p);
  }
  team.ovr = teamOvr(team);
  return team;
}
function teamOvr(team) {
  const avg = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) / arr.length);
  return {
    bat: avg(team.hitters, (h) => (h.con + h.pow + h.eye) / 3),
    pit: avg(team.pitchers, (p) => p.ctl * 0.6 + (p.velo - 85) * 2.2),
    def: avg(team.hitters.filter((h) => h.pos !== 'DH'), (h) => (h.fld + h.arm) / 2),
  };
}
// built-in teams; custom rosters are added in 66-roster.js. team.key names a team in menus and online.
const TEAMS = TEAM_DEFS.map(genTeam);
for (const t of TEAMS) { t.key = t.id; t.ver = ''; }

// pitchScale: slows pitch flight; pci: PCI size; win: timing windows (perfect, good, contact) in seconds;
// assist: how far the PCI is pulled toward the pitch on a swing; guide: show where the pitch will cross
const DIFFS = [
  { name: 'Rookie', pitchScale: 1.75, pci: 1.8, win: [0.034, 0.07, 0.14], assist: 0.55, guide: 0.35, cpuCtl: 1.6, cpuBat: -0.18, cpuEye: 0.75, meter: 0.8 },
  { name: 'Veteran', pitchScale: 1.45, pci: 1.5, win: [0.027, 0.056, 0.115], assist: 0.35, guide: 0.6, cpuCtl: 1.3, cpuBat: -0.08, cpuEye: 0.9, meter: 1.0 },
  { name: 'All-Star', pitchScale: 1.2, pci: 1.2, win: [0.019, 0.042, 0.09], assist: 0.15, guide: 0, cpuCtl: 1.0, cpuBat: 0, cpuEye: 1.0, meter: 1.2 },
  { name: 'Hall of Fame', pitchScale: 1.0, pci: 1.0, win: [0.014, 0.032, 0.072], assist: 0, guide: 0, cpuCtl: 0.85, cpuBat: 0.08, cpuEye: 1.12, meter: 1.4 },
];
const PBYID = {};
for (const t of TEAMS) for (const p of [...t.hitters, ...t.pitchers]) PBYID[p.id] = p;

const settings = { sound: true, voice: true, zone: true, manual: true, guide: true, batCam: 0 };
try { const s = JSON.parse(localStorage.getItem('fullcount.settings') || '{}'); Object.assign(settings, s); } catch (e) { /* storage unavailable */ }
function saveSettings() { try { localStorage.setItem('fullcount.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- audio ----
const SND = {
  ctx: null, master: null, crowd: null, base: 0.07, voiceObj: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = settings.sound ? 0.8 : 0; this.master.connect(c.destination);
    const len = c.sampleRate * 3, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22; }
    this.pink = buf;
    const wb = c.createBuffer(1, c.sampleRate, c.sampleRate), wd = wb.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.white = wb;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.55;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    this.crowd = c.createGain(); this.crowd.gain.value = this.base;
    src.connect(bp).connect(lp).connect(this.crowd).connect(this.master); src.start();
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lg = c.createGain(); lg.gain.value = 0.018; lfo.connect(lg).connect(this.crowd.gain); lfo.start();
    this.organBus = c.createBiquadFilter(); this.organBus.type = 'lowpass'; this.organBus.frequency.value = 2200; this.organBus.connect(this.master);
  },
  setOn(v) { settings.sound = v; saveSettings(); if (this.master) this.master.gain.value = v ? 0.8 : 0; if (!v) try { speechSynthesis.cancel(); } catch (e) { /* none */ } },
  burst(t, { dur = 0.08, type = 'bandpass', f = 2000, q = 1, gain = 0.6, buf } = {}) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = buf || this.white;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.master); s.start(t, Math.random() * 0.5, dur + 0.05);
  },
  tone(t, { f0 = 800, f1 = 300, dur = 0.08, type = 'triangle', gain = 0.4 } = {}) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  crack(q = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.burst(t, { dur: 0.06 + q * 0.07, f: 1500 + q * 1500, q: 0.9, gain: 0.35 + q * 0.6 });
    this.tone(t, { f0: 900 + q * 900, f1: 380, dur: 0.07, gain: 0.25 + q * 0.35 });
    this.burst(t + 0.004, { dur: 0.18, type: 'lowpass', f: 500, gain: 0.25 * q });
  },
  tick() { if (!this.ctx) return; const t = this.ctx.currentTime; this.burst(t, { dur: 0.04, f: 3200, q: 2, gain: 0.25 }); },
  pop(v = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.burst(t, { dur: 0.05, type: 'lowpass', f: 1400, gain: 0.55 * v });
    this.tone(t, { f0: 190, f1: 70, dur: 0.11, type: 'sine', gain: 0.6 * v });
  },
  thud(v = 0.5) { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(t, { f0: 120, f1: 50, dur: 0.12, type: 'sine', gain: v }); this.burst(t, { dur: 0.06, type: 'lowpass', f: 600, gain: v * 0.5 }); },
  roar(level = 0.35, hold = 1.2, decay = 3) {
    if (!this.ctx) return; const g = this.crowd.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + 0.25); g.setValueAtTime(level, t + 0.25 + hold); g.linearRampToValueAtTime(this.base, t + 0.25 + hold + decay);
  },
  organ(seq, vol = 1) {
    if (!this.ctx) return; let t = this.ctx.currentTime + 0.05;
    for (const [m, d] of seq) {
      if (m) {
        const f = 440 * Math.pow(2, (m - 69) / 12);
        for (const [type, mul, v] of [['square', 1, 0.035], ['sine', 2, 0.05], ['sine', 0.5, 0.06], ['triangle', 3, 0.015]]) {
          const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
          const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * vol, t + 0.015); g.gain.setValueAtTime(v * vol, t + d * 0.75); g.gain.linearRampToValueAtTime(0, t + d * 0.97);
          o.connect(g).connect(this.organBus); o.start(t); o.stop(t + d);
        }
      }
      t += d;
    }
  },
  charge() { this.organ([[67, 0.15], [72, 0.15], [76, 0.15], [79, 0.3], [76, 0.15], [79, 0.7]]); },
  stretch() { this.organ([[60, 0.25], [64, 0.25], [67, 0.25], [72, 0.5], [0, 0.1], [67, 0.25], [72, 0.75]], 0.9); },
  fanfare() { this.organ([[72, 0.12], [76, 0.12], [79, 0.12], [84, 0.5], [79, 0.12], [84, 0.8]], 1.1); },
  pickVoice() {
    if (this.voiceObj !== null) return this.voiceObj || null;
    const vs = speechSynthesis.getVoices(); if (!vs.length) return null;
    for (const p of ['Daniel', 'Alex', 'Google US English', 'Aaron', 'Samantha', 'Fred']) {
      const v = vs.find((x) => x.name.includes(p) && x.lang.startsWith('en'));
      if (v) return (this.voiceObj = v);
    }
    this.voiceObj = vs.find((x) => x.lang.startsWith('en')) || false;
    return this.voiceObj || null;
  },
  say(text, opt = {}) {
    if (!settings.voice || !settings.sound || G.skipping || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opt.rate || 1.12; u.pitch = opt.pitch ?? 0.95; u.volume = opt.vol ?? 1;
      const v = this.pickVoice(); if (v) u.voice = v;
      if (!opt.queue) speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  },
};

const Caster = {
  timer: 0,
  line(text, speak = true, opt) {
    const el = $('caption'); el.textContent = text;
    el.classList.add('show'); clearTimeout(this.timer);
    this.timer = setTimeout(() => el.classList.remove('show'), 5200);
    if (speak) SND.say(text, opt);
  },
  clear() { $('caption').classList.remove('show'); },
};
