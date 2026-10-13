import * as THREE from 'three';

// ============================================================================
// Core utilities, field geometry, pitch types, audio and commentary
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
const FENCE_H = 9.5;   // a standard outfield wall
const BALL_R = 0.12;

// ------------------------------------------------------------- ballparks ----
// The 30 MLB parks (dimensions approximate): the wall's distance down the left-field line, to
// left-center, center, right-center and down the right-field line, and its height in left,
// center and right. Angles are spray angles: negative is left field. air: how thin the air is
// up there (Coors Field is a mile high): less drag, so the ball carries, and less break.
const PARKS = {
  FC: { name: 'Full Count Park', d: [330, 372, 400, 372, 330], h: [9.5, 9.5, 9.5] },
  AZ: { name: 'Chase Field', d: [330, 374, 407, 374, 334], h: [7.6, 25, 7.6], air: 0.96 },
  ATH: { name: 'Sutter Health Park', d: [330, 388, 403, 388, 325], h: [8, 12, 8] },
  ATL: { name: 'Truist Park', d: [335, 385, 400, 375, 325], h: [11, 8, 16], air: 0.97 },
  BAL: { name: 'Oriole Park at Camden Yards', d: [333, 376, 400, 373, 318], h: [8, 7, 21] },
  BOS: { name: 'Fenway Park', d: [310, 379, 390, 380, 302], h: [37.2, 17, 5] },
  CHC: { name: 'Wrigley Field', d: [355, 368, 400, 368, 353], h: [11.5, 11.5, 11.5] },
  CWS: { name: 'Rate Field', d: [330, 377, 400, 372, 335], h: [8, 8, 8] },
  CIN: { name: 'Great American Ball Park', d: [328, 379, 404, 370, 325], h: [12, 8, 8] },
  CLE: { name: 'Progressive Field', d: [325, 370, 400, 375, 325], h: [19, 9, 9] },
  COL: { name: 'Coors Field', d: [347, 390, 415, 375, 350], h: [8, 8, 14], air: 0.82 },
  DET: { name: 'Comerica Park', d: [345, 370, 412, 365, 330], h: [7, 7, 8.5] },
  HOU: { name: 'Daikin Park', d: [315, 362, 409, 373, 326], h: [21, 10, 7] },
  KC: { name: 'Kauffman Stadium', d: [330, 387, 410, 387, 330], h: [8.5, 8.5, 8.5] },
  LAA: { name: 'Angel Stadium', d: [347, 387, 396, 370, 350], h: [5, 8, 18] },
  LAD: { name: 'Dodger Stadium', d: [330, 375, 395, 375, 330], h: [4, 8, 4] },
  MIA: { name: 'loanDepot park', d: [344, 386, 400, 387, 335], h: [11, 8, 11] },
  MIL: { name: 'American Family Field', d: [344, 371, 400, 374, 345], h: [8, 8, 8] },
  MIN: { name: 'Target Field', d: [339, 377, 411, 367, 328], h: [8, 8, 23] },
  NYM: { name: 'Citi Field', d: [335, 370, 408, 375, 330], h: [8, 8, 8] },
  NYY: { name: 'Yankee Stadium', d: [318, 399, 408, 385, 314], h: [8, 8, 8] },
  PHI: { name: 'Citizens Bank Park', d: [329, 374, 401, 369, 330], h: [10.5, 6, 13] },
  PIT: { name: 'PNC Park', d: [325, 389, 399, 375, 320], h: [6, 10, 21] },
  SD: { name: 'Petco Park', d: [336, 390, 396, 391, 322], h: [8, 8, 8] },
  SF: { name: 'Oracle Park', d: [339, 364, 391, 415, 309], h: [8, 8, 24] },
  SEA: { name: 'T-Mobile Park', d: [331, 378, 401, 381, 326], h: [8, 8, 8] },
  STL: { name: 'Busch Stadium', d: [336, 375, 400, 375, 335], h: [8, 8, 8] },
  TB: { name: 'Tropicana Field', d: [315, 370, 404, 370, 322], h: [9.5, 9.5, 9.5] },
  TEX: { name: 'Globe Life Field', d: [329, 372, 407, 374, 326], h: [8, 8, 8] },
  TOR: { name: 'Rogers Centre', d: [328, 368, 400, 359, 328], h: [12, 10, 12] },
  WSH: { name: 'Nationals Park', d: [337, 377, 402, 370, 335], h: [8, 8, 12] },
  // classic ballparks, for the decade teams that played in them
  CROS: { name: 'Crosley Field', d: [328, 380, 387, 383, 366], h: [12, 14, 12], classic: 1 },
  RIVF: { name: 'Riverfront Stadium', d: [330, 375, 404, 375, 330], h: [12, 12, 12], classic: 1 },
  ASTR: { name: 'Astrodome', d: [340, 390, 406, 390, 340], h: [10, 10, 10], classic: 1 },
  SHEA: { name: 'Shea Stadium', d: [338, 371, 410, 371, 338], h: [8, 8, 8], classic: 1 },
  TRS: { name: 'Three Rivers Stadium', d: [335, 375, 400, 375, 335], h: [10, 10, 10], classic: 1 },
  VET: { name: 'Veterans Stadium', d: [330, 371, 408, 371, 330], h: [12, 12, 12], classic: 1 },
  CMS: { name: 'Connie Mack Stadium', d: [334, 387, 447, 390, 329], h: [12, 12, 32], classic: 1 },
  FORB: { name: 'Forbes Field', d: [365, 406, 435, 408, 300], h: [12, 14, 28], classic: 1 },
  CAND: { name: 'Candlestick Park', d: [335, 365, 400, 365, 328], h: [8, 8, 8], classic: 1 },
  BUSC: { name: 'Busch Memorial Stadium', d: [330, 372, 402, 372, 330], h: [10.5, 10.5, 10.5], classic: 1 },
  SPRT: { name: "Sportsman's Park", d: [351, 379, 422, 354, 310], h: [11, 11, 33], classic: 1 },
  OLYM: { name: 'Olympic Stadium', d: [325, 375, 404, 375, 325], h: [12, 12, 12], classic: 1 },
  JARY: { name: 'Jarry Park', d: [340, 368, 420, 368, 340], h: [8, 8, 8], classic: 1 },
  TIGR: { name: 'Tiger Stadium', d: [340, 365, 440, 370, 325], h: [9, 9, 10], classic: 1 },
  COMI: { name: 'Old Comiskey Park', d: [347, 382, 409, 382, 347], h: [9.5, 9.5, 9.5], classic: 1 },
  KING: { name: 'The Kingdome', d: [331, 376, 405, 385, 312], h: [11.5, 11.5, 23], classic: 1 },
  DOME: { name: 'Metrodome', d: [343, 385, 408, 367, 327], h: [7, 7, 23], classic: 1 },
  METS: { name: 'Metropolitan Stadium', d: [344, 375, 402, 375, 330], h: [8, 8, 8], classic: 1 },
  MEMO: { name: 'Memorial Stadium', d: [309, 376, 405, 376, 309], h: [7, 7, 7], classic: 1 },
  FULT: { name: 'Atlanta-Fulton County Stadium', d: [330, 385, 402, 385, 330], h: [10, 10, 10], air: 0.97, classic: 1 },
  TUR: { name: 'Turner Field', d: [335, 380, 401, 390, 330], h: [8, 8, 8], air: 0.97, classic: 1 },
  CNTY: { name: 'Milwaukee County Stadium', d: [315, 362, 402, 362, 315], h: [10, 10, 10], classic: 1 },
  CLEV: { name: 'Cleveland Stadium', d: [320, 377, 400, 377, 320], h: [8, 8, 8], classic: 1 },
  JACK: { name: 'Jack Murphy Stadium', d: [327, 370, 405, 370, 327], h: [10, 10, 10], classic: 1 },
  ARLS: { name: 'Arlington Stadium', d: [330, 380, 400, 380, 330], h: [11, 11, 11], classic: 1 },
  BALL: { name: 'The Ballpark in Arlington', d: [332, 390, 400, 381, 325], h: [14, 8, 8], classic: 1 },
  RFK: { name: 'RFK Stadium', d: [335, 385, 410, 385, 335], h: [8, 8, 8], classic: 1 },
  EXH: { name: 'Exhibition Stadium', d: [330, 375, 400, 375, 330], h: [12, 12, 12], classic: 1 },
  OAK: { name: 'Oakland Coliseum', d: [330, 388, 400, 388, 330], h: [8, 8, 8], classic: 1 },
  MUNI: { name: 'Municipal Stadium', d: [330, 375, 421, 375, 338], h: [10, 10, 10], classic: 1 },
  JRS: { name: 'Joe Robbie Stadium', d: [330, 385, 404, 385, 345], h: [10, 33, 8], classic: 1 },
};
let PARK = PARKS.FC;   // the park this game is in (setPark, in 20-world.js)
// the wall's distance at a spray angle, eased between the five measured points
function parkDist(P, th) {
  const u = (clamp(th, -45, 45) + 45) / 22.5, i = Math.min(3, Math.floor(u)), f = u - i;
  return lerp(P.d[i], P.d[i + 1], (1 - Math.cos(f * Math.PI)) / 2);
}
function fenceDist(th) { return parkDist(PARK, th); }
// the wall's height at a spray angle: left, center or right, blended over a few degrees
function fenceH(th) {
  const [l, c, r] = PARK.h, a = clamp(th, -45, 45);
  return a < 0 ? lerp(l, c, clamp((a + 18) / 6 + 0.5, 0, 1)) : lerp(c, r, clamp((a - 18) / 6 + 0.5, 0, 1));
}
// Closed boundary of the playing field (fence + foul-territory walls + backstop), as [x, z].
// Rebuilt in place for each park, so everything holding these arrays sees the new one.
const FENCE_PTS = [], BOUNDARY = [];
function buildBoundary() {
  FENCE_PTS.length = 0; BOUNDARY.length = 0;
  for (let th = -45; th <= 45.001; th += 1.5) { const d = fenceDist(th); FENCE_PTS.push([d * Math.sin(th * DEG), -d * Math.cos(th * DEG)]); }
  const u = [Math.SQRT1_2, -Math.SQRT1_2], n = [Math.SQRT1_2, Math.SQRT1_2];
  const side = (s, off) => [u[0] * s + n[0] * off, u[1] * s + n[1] * off];
  // the foul wall runs from just inside the foul pole back around to the backstop
  const foul = (line) => [side(line - 12, 12), side(250, 22), side(170, 34), side(105, 44), [92, -14], [76, 18], [52, 42], [26, 56], [0, 61]];
  const right = foul(fenceDist(45)), left = foul(fenceDist(-45)).slice(0, -1).reverse().map(([x, z]) => [-x, z]);
  BOUNDARY.push(...FENCE_PTS, ...right, ...left);
}
buildBoundary();
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
// The clubs and players are real: src/12-mlb.js (built by tools/mlb-import.mjs), unpacked in 14-teams.js.
const POS_LIST = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const SKINS = ['#f1c7a5', '#e3b08c', '#c98a63', '#a96c48', '#8a5536', '#6b4029', '#f5d4bb', '#d9a07a'];

function teamOvr(team) {
  const avg = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) / arr.length);
  return {
    bat: avg(team.hitters, (h) => (h.con + h.pow + h.eye) / 3),
    pit: avg(team.pitchers, (p) => p.ctl * 0.6 + (p.velo - 85) * 2.2),
    def: avg(team.hitters.filter((h) => h.pos !== 'DH'), (h) => (h.fld + h.arm) / 2),
  };
}

// pitchScale: slows pitch flight; pci: PCI size; win: timing windows (perfect, good, contact) in seconds;
// assist: how far the PCI is pulled toward the pitch on a swing; guide: show where the pitch will cross
const DIFFS = [
  { name: 'Rookie', pitchScale: 1.75, pci: 1.8, win: [0.034, 0.07, 0.14], assist: 0.55, guide: 0.35, cpuCtl: 1.6, cpuBat: -0.18, cpuEye: 0.75, meter: 0.8 },
  { name: 'Veteran', pitchScale: 1.45, pci: 1.5, win: [0.027, 0.056, 0.115], assist: 0.35, guide: 0.6, cpuCtl: 1.3, cpuBat: -0.08, cpuEye: 0.9, meter: 1.0 },
  { name: 'All-Star', pitchScale: 1.2, pci: 1.2, win: [0.019, 0.042, 0.09], assist: 0.15, guide: 0, cpuCtl: 1.0, cpuBat: 0, cpuEye: 1.0, meter: 1.2 },
  { name: 'Hall of Fame', pitchScale: 1.0, pci: 1.0, win: [0.014, 0.032, 0.072], assist: 0, guide: 0, cpuCtl: 0.85, cpuBat: 0.08, cpuEye: 1.12, meter: 1.4 },
];
const PBYID = {};   // player id -> player, filled in by 14-teams.js and each game's teams

const settings = { sound: true, voice: true, zone: true, manual: true, guide: true, batCam: 0, vcVol: 1, vcPTT: false, vcNear: true, netName: '' };
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
    this.master = c.createGain(); this.master.gain.value = settings.sound ? settings.volume ?? 0.8 : 0; this.master.connect(c.destination);
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
  setOn(v) { settings.sound = v; saveSettings(); if (this.master) this.master.gain.value = v ? settings.volume ?? 0.8 : 0; if (!v) try { speechSynthesis.cancel(); } catch (e) { /* none */ } },
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
      u.rate = opt.rate || 1.12; u.pitch = opt.pitch ?? 0.95; u.volume = (opt.vol ?? 1) * (settings.voiceVol ?? 1);
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
