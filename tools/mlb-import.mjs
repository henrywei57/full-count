#!/usr/bin/env node
// Builds src/12-mlb.js: all 30 MLB clubs with their current rosters, rated for
// Full Count from real numbers (MLB Stats API + Baseball Savant leaderboards).
//
//   node tools/mlb-import.mjs          the latest season (blended with the one before)
//   node tools/mlb-import.mjs 2025     a specific season
//
// Then run ./build.sh. Needs Node 18+ (built-in fetch). Unofficial: not
// affiliated with or endorsed by MLB, the MLBPA or any club.
//
// How players become ratings (centered where the game's balance expects them, roughly 75-80
// for an average regular, one standard deviation about 12):
//   CON  batting average and strikeout rate       POW  isolated power and barrel rate
//   EYE  walk rate and strikeout rate              SPD  Statcast sprint speed
//   ARM  Statcast arm strength (catchers: pop time) FLD  outs above average
//   VELO each pitch's real average speed           CTL  walk rate
//   STF  strikeout rate                            STA  pitches per outing
// This season counts double last season, and everyone is pulled toward league
// average a little, so a hot month doesn't make a superstar.
import { writeFile } from 'node:fs/promises';

const API = 'https://statsapi.mlb.com/api/v1';
const SAVANT = 'https://baseballsavant.mlb.com/leaderboard';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Full Count roster import)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v) => { const n = parseFloat(String(v ?? '').replace('%', '')); return Number.isFinite(n) ? n : null; };

async function get(url, as = 'json') {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return as === 'json' ? r.json() : r.text();
      if (r.status === 404) break;
    } catch (e) { /* retry */ }
    await sleep(700 * (i + 1));
  }
  throw new Error('Could not fetch ' + url);
}
// Savant CSVs: quoted fields, commas inside quotes, a BOM up front
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
async function savant(path, idKey) {
  try {
    const rows = parseCSV(await get(`${SAVANT}/${path}`, 'text'));
    return new Map(rows.map((r) => [+r[idKey], r]));
  } catch (e) { console.warn('  (skipped ' + path.split('?')[0] + ')'); return new Map(); }
}
async function bulk(group, season) {
  const j = await get(`${API}/stats?stats=season&group=${group}&season=${season}&sportId=1&playerPool=ALL&limit=5000`);
  return (j.stats && j.stats[0] && j.stats[0].splits) || [];
}

// colors per club (MLB team id): primary, secondary; text contrast is fixed up below
const COLORS = {
  109: ['#a71930', '#e3d4ad'], 144: ['#13274f', '#ce1141'], 110: ['#df4601', '#000000'], 111: ['#bd3039', '#0c2340'],
  112: ['#0e3386', '#cc3433'], 145: ['#27251f', '#c4ced4'], 113: ['#c6011f', '#000000'], 114: ['#00385d', '#e50022'],
  115: ['#33006f', '#c4ced4'], 116: ['#0c2340', '#fa4616'], 117: ['#002d62', '#eb6e1f'], 118: ['#004687', '#bd9b60'],
  108: ['#ba0021', '#003263'], 119: ['#005a9c', '#ffffff'], 146: ['#00a3e0', '#000000'], 158: ['#12284b', '#ffc52f'],
  142: ['#002b5c', '#d31145'], 121: ['#002d72', '#ff5910'], 147: ['#0c2340', '#c4ced3'], 133: ['#003831', '#efb21e'],
  143: ['#e81828', '#002d72'], 134: ['#27251f', '#fdb827'], 135: ['#2f241d', '#ffc425'], 137: ['#fd5a1e', '#27251f'],
  136: ['#0c2c56', '#00a094'], 138: ['#c41e3a', '#fedb00'], 139: ['#092c5c', '#8fbce6'], 140: ['#003278', '#c0111f'],
  141: ['#134a8e', '#e8291c'], 120: ['#ab0003', '#14225a'],
};
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function teamColors(id) {
  let [c1, c2] = COLORS[id] || ['#334455', '#ffffff'];
  if (contrast(c1, c2) < 3) c2 = contrast(c1, '#ffffff') >= contrast(c1, '#000000') ? '#ffffff' : '#000000';
  return [c1, c2];
}

// ------------------------------------------------------------------ main ----
async function pickSeason() {
  const arg = +process.argv[2];
  if (arg > 1900) return arg;
  const y = new Date().getFullYear();
  const j = await get(`${API}/seasons/${y}?sportId=1`);
  const s = j.seasons && j.seasons[0];
  // a season counts once it's about six weeks old; the prior season fills in the rest
  return s && Date.now() > new Date(s.regularSeasonStartDate).getTime() + 42 * 864e5 ? y : y - 1;
}
const S = await pickSeason(), P = S - 1;
console.log(`Full Count roster import: ${S} season, blended with ${P}`);

const teamsRaw = (await get(`${API}/teams?sportId=1&season=${S}`)).teams.filter((t) => t.active !== false && t.sport && t.sport.id === 1);
console.log(`  ${teamsRaw.length} clubs`);
const [hitS, hitP, pitS, pitP, fldS, fldP] = await Promise.all([bulk('hitting', S), bulk('hitting', P), bulk('pitching', S), bulk('pitching', P), bulk('fielding', S), bulk('fielding', P)]);
const byId = (rows) => new Map(rows.map((r) => [r.player.id, r.stat]));
const H1 = byId(hitS), H0 = byId(hitP), P1 = byId(pitS), P0 = byId(pitP);
// games at each position: this season, and both seasons together (for who can play where)
const posGames = new Map(), posGames2 = new Map();
for (const [rows, maps] of [[fldS, [posGames, posGames2]], [fldP, [posGames2]]]) {
  for (const r of rows) {
    const pos = r.position && r.position.abbreviation; if (!pos) continue;
    for (const map of maps) { const m = map.get(r.player.id) || {}; m[pos] = (m[pos] || 0) + (r.stat.games || 0); map.set(r.player.id, m); }
  }
}
const sv = (path, key) => Promise.all([savant(path.replace('{Y}', S), key), savant(path.replace('{Y}', P), key)]);
const [[speedS, speedP], [usageS, usageP], [sprintS, sprintP], [evS, evP]] = await Promise.all([
  sv('pitch-arsenals?year={Y}&min=1&type=avg_speed&hand=&csv=true', 'pitcher'),
  sv('pitch-arsenals?year={Y}&min=1&type=n_&hand=&csv=true', 'pitcher'),
  sv('sprint_speed?year={Y}&position=&team=&min=1&csv=true', 'player_id'),
  sv('statcast?type=batter&year={Y}&position=&team=&min=1&csv=true', 'player_id'),
]);
const [oaa, arms, pops] = await Promise.all([
  savant(`outs_above_average?type=Fielder&startYear=${S}&endYear=${S}&split=no&team=&range=year&min=1&pos=&roles=&viz=hide&csv=true`, 'player_id'),
  savant(`arm-strength?type=player&year=${S}&minThrows=1&pos=&team=&csv=true`, 'player_id'),
  savant(`poptime?year=${S}&team=&min2b=1&min3b=0&csv=true`, 'entity_id'),
]);

// --- hitting: this season + half of last season, plus 150 PA of league average
const sumHit = (id) => {
  const o = { pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0, sb: 0, cs: 0, paS: 0 };
  for (const [st, w] of [[H1.get(id), 1], [H0.get(id), 0.5]]) {
    if (!st) continue;
    o.pa += w * st.plateAppearances; o.ab += w * st.atBats; o.h += w * st.hits; o.d += w * st.doubles; o.t += w * st.triples;
    o.hr += w * st.homeRuns; o.bb += w * (st.baseOnBalls + st.hitByPitch); o.k += w * st.strikeOuts; o.sb += w * st.stolenBases; o.cs += w * st.caughtStealing;
  }
  o.paS = (H1.get(id) || {}).plateAppearances || 0;
  return o;
};
const lg = { pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0 };
for (const st of H1.values()) { lg.pa += st.plateAppearances; lg.ab += st.atBats; lg.h += st.hits; lg.d += st.doubles; lg.t += st.triples; lg.hr += st.homeRuns; lg.bb += st.baseOnBalls + st.hitByPitch; lg.k += st.strikeOuts; }
const rate = (o, prior = 150) => {
  const f = prior / lg.pa, pa = o.pa + lg.pa * f, ab = o.ab + lg.ab * f, h = o.h + lg.h * f;
  const tb = h + (o.d + lg.d * f) + 2 * (o.t + lg.t * f) + 3 * (o.hr + lg.hr * f);
  return { avg: h / ab, iso: (tb - h) / ab, bb: (o.bb + lg.bb * f) / pa, k: (o.k + lg.k * f) / pa };
};
const barrel = (id) => { for (const m of [evS, evP]) { const r = m.get(id); if (r && num(r.attempts) >= 40) return num(r.brl_pa); } return null; };
// league spread, from regulars
const regulars = [...H1.entries()].filter(([, s]) => s.plateAppearances >= 250).map(([id]) => ({ r: rate(sumHit(id)), b: barrel(id) }));
const dist = (vals) => { const v = vals.filter((x) => x != null), m = v.reduce((a, b) => a + b, 0) / v.length; return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1 }; };
const D = { avg: dist(regulars.map((x) => x.r.avg)), iso: dist(regulars.map((x) => x.r.iso)), bb: dist(regulars.map((x) => x.r.bb)), k: dist(regulars.map((x) => x.r.k)), brl: dist(regulars.map((x) => x.b)) };
const z = (k, v) => (v - D[k].m) / D[k].sd;
const rt = (v) => clamp(Math.round(v), 38, 99);
const POS_ARM = { C: 82, '1B': 66, '2B': 72, '3B': 84, SS: 86, LF: 74, CF: 80, RF: 86, DH: 60 };
const POS_FLD = { C: 77, '1B': 71, '2B': 77, '3B': 77, SS: 79, LF: 73, CF: 79, RF: 75, DH: 45 };
const IF = new Set(['1B', '2B', '3B', 'SS']), OF = new Set(['LF', 'CF', 'RF']);
const armMean = (() => {
  const g = { inf: [], of: [] };
  for (const r of arms.values()) { const i = num(r.arm_inf), o = num(r.arm_of); if (i) g.inf.push(i); if (o) g.of.push(o); }
  return { inf: dist(g.inf).m, of: dist(g.of).m };
})();
function hitterRatings(id, pos) {
  const r = rate(sumHit(id)), b = barrel(id), o = sumHit(id);
  const con = 76 + 12 * (0.45 * z('avg', r.avg) - 0.65 * z('k', r.k));
  const pow = 79 + 11 * (b != null ? 0.55 * z('iso', r.iso) + 0.45 * z('brl', b) : z('iso', r.iso));
  const eye = 78 + 12 * (0.8 * z('bb', r.bb) - 0.3 * z('k', r.k));
  const sprint = num((sprintS.get(id) || sprintP.get(id) || {}).sprint_speed);
  const spd = sprint ? 70 + (sprint - 27) * 8.5 : 58 + 120 * ((o.sb + o.cs) / Math.max(1, o.pa));
  let arm = POS_ARM[pos] ?? 66;
  const a = arms.get(id), pop = num((pops.get(id) || {}).pop_2b_sba);
  if (pos === 'C' && pop) arm = 78 + (1.95 - pop) * 110;
  else if (a && OF.has(pos) && num(a.arm_of)) arm = 78 + (num(a.arm_of) - armMean.of) * 2.4 + (pos === 'RF' ? 4 : pos === 'LF' ? -4 : 0);
  else if (a && IF.has(pos) && num(a.arm_inf)) arm = 78 + (num(a.arm_inf) - armMean.inf) * 2.4 + (pos === 'SS' || pos === '3B' ? 4 : pos === '1B' ? -8 : 0);
  const oa = num((oaa.get(id) || {}).outs_above_average);
  const fld = pos === 'DH' ? 45 : oa != null && pos !== 'C' ? POS_FLD[pos] + clamp(oa, -15, 20) * 1.5 : POS_FLD[pos] ?? 66;
  return { con: rt(con), pow: rt(pow), eye: rt(eye), spd: rt(spd), arm: rt(arm), fld: rt(fld) };
}

// --- pitching
const sumPit = (id) => {
  const o = { bf: 0, k: 0, bb: 0, g: 0, gs: 0, np: 0, ip: 0, sv: 0, hld: 0, ipS: 0, gsS: 0 };
  const ipOf = (s) => { const [w, f] = String(s || '0').split('.'); return +w + (+f || 0) / 3; };
  for (const [st, w] of [[P1.get(id), 1], [P0.get(id), 0.5]]) {
    if (!st) continue;
    o.bf += w * st.battersFaced; o.k += w * st.strikeOuts; o.bb += w * (st.baseOnBalls + st.hitByPitch); o.g += w * st.gamesPlayed; o.gs += w * st.gamesStarted;
    o.np += w * (st.numberOfPitches || 0); o.ip += w * ipOf(st.inningsPitched); o.sv += w * (st.saves || 0); o.hld += w * (st.holds || 0);
  }
  const s1 = P1.get(id) || {};
  o.ipS = ipOf(s1.inningsPitched); o.gsS = s1.gamesStarted || 0;
  return o;
};
const lp = { bf: 0, k: 0, bb: 0 };
for (const st of P1.values()) { lp.bf += st.battersFaced; lp.k += st.strikeOuts; lp.bb += st.baseOnBalls + st.hitByPitch; }
const prate = (o) => { const f = 100 / lp.bf; return { k: (o.k + lp.k * f) / (o.bf + lp.bf * f), bb: (o.bb + lp.bb * f) / (o.bf + lp.bf * f) }; };
const arms2 = [...P1.entries()].filter(([, s]) => s.battersFaced >= 150).map(([id]) => prate(sumPit(id)));
const DP = { k: dist(arms2.map((x) => x.k)), bb: dist(arms2.map((x) => x.bb)) };
// Savant pitch codes -> the game's pitch types
const PITCH_MAP = { ff: 'FF', si: 'SI', fc: 'FC', sl: 'SL', st: 'SW', sv: 'SW', cu: 'CU', ch: 'CH', fs: 'FS' };
const FAST = new Set(['FF', 'SI', 'FC']);
const PITCH_D = { FF: 0, SI: -2, FC: -6, SL: -9, SW: -13, CU: -16, KC: -13, CH: -9, FS: -8 };
function pitcherRatings(id, starter) {
  const o = sumPit(id), r = prate(o);
  const stuff = 64 + 13 * ((r.k - DP.k.m) / DP.k.sd);
  const ctl = 78 + 12 * (-(r.bb - DP.bb.m) / DP.bb.sd);
  const perG = o.g ? o.np / o.g : starter ? 88 : 17;
  const stam = starter ? clamp(perG - 2, 66, 99) : clamp(perG * 2.3, 34, 62);
  // the real arsenal: anything thrown at least 4% of the time, most used first
  const usage = usageS.get(id) || usageP.get(id), speeds = speedS.get(id) || speedP.get(id);
  let list = [];
  if (usage) {
    const seen = new Set();
    for (const [code, type] of Object.entries(PITCH_MAP)) {
      const u = num(usage['n_' + code]);
      if (u == null || u < 4) continue;
      const v = num(speeds && speeds[code + '_avg_speed']);
      const ex = list.find((x) => x.type === type);
      if (ex) { ex.u += u; continue; }
      seen.add(type); list.push({ type, u, velo: v });
    }
    list.sort((a, b) => b.u - a.u);
  }
  const fb = list.find((x) => FAST.has(x.type) && x.velo);
  const velo = fb ? (fb.type === 'FC' ? fb.velo + 4 : fb.type === 'SI' ? fb.velo + 1 : fb.velo) : 93 + (r.k - DP.k.m) / DP.k.sd * 1.2;
  if (!list.some((x) => FAST.has(x.type))) list.unshift({ type: 'FF', velo, u: 0 });
  if (list.length < 2) list.push({ type: 'SL', velo: null, u: 0 });
  list = list.slice(0, starter ? 5 : 4).map((x) => ({ type: x.type, velo: Math.round(x.velo || velo + PITCH_D[x.type]) }));
  return { velo: clamp(Math.round(velo), 85, 103), ctl: rt(ctl), stuff: rt(stuff), stam: Math.round(stam), pitches: list };
}

// --- the player pool: everyone on a 40-man roster who played (the Roster Builder signs from it)
function hashSkin(id) { let h = 2166136261; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 8; }
const FIELD = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const POS_ORDER = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];
const group = (p) => (p === 'C' ? 'C' : IF.has(p) ? 'IF' : OF.has(p) || p === 'OF' ? 'OF' : p === 'DH' || p === 'TWP' ? 'DH' : 'P');
const clubs = teamsRaw.sort((a, b) => a.name.localeCompare(b.name));
const rosters = await Promise.all(clubs.map((t) => get(`${API}/teams/${t.id}/roster?rosterType=40Man&season=${S}&hydrate=person`).then((j) => j.roster || [])));
const HIT = new Map(), PIT = new Map();   // mlb id -> pool entry
clubs.forEach((t, ci) => {
  for (const r of rosters[ci]) {
    const pp = r.person, primary = (pp.primaryPosition || r.position).abbreviation;
    const base = { id: pp.id, name: pp.fullName, club: ci, num: parseInt(r.jerseyNumber || pp.primaryNumber, 10), bats: (pp.batSide || {}).code || 'R', throws: (pp.pitchHand || {}).code || 'R', skin: hashSkin(pp.id), primary };
    if (!Number.isFinite(base.num)) base.num = 0;
    if (primary !== 'P' && sumHit(pp.id).pa >= 50) {
      // where he plays: 10+ games at a spot over the two seasons, his main spot first
      const g2 = posGames2.get(pp.id) || {}, g1 = posGames.get(pp.id) || {};
      const elig = FIELD.filter((p) => (g2[p] || 0) >= 10).sort((a, b) => (g1[b] || 0) - (g1[a] || 0) || (g2[b] || 0) - (g2[a] || 0));
      if (!elig.length && FIELD.includes(primary)) elig.push(primary);
      if (!elig.length && primary === 'OF') elig.push('CF');
      const bat = hitterRatings(pp.id, elig[0] || 'DH');
      HIT.set(pp.id, { ...base, con: bat.con, pow: bat.pow, eye: bat.eye, spd: bat.spd, def: elig.map((pos) => { const r2 = hitterRatings(pp.id, pos); return [pos, r2.arm, r2.fld]; }) });
    }
    if ((primary === 'P' || primary === 'TWP') && sumPit(pp.id).ip >= 10) {
      const o = sumPit(pp.id), role = o.gs >= 3 && o.gs >= o.g * 0.5 ? 'SP' : 'RP';
      PIT.set(pp.id, { ...base, role, ...pitcherRatings(pp.id, role === 'SP') });
    }
  }
});
console.log(`  pool: ${HIT.size} hitters, ${PIT.size} pitchers`);
const defAt = (h, pos) => h.def.find((d) => d[0] === pos);

// --- each club's lineup and staff, picked from its own players
function buildTeam(t, ci) {
  const hitters = [...HIT.values()].filter((h) => h.club === ci);
  const pa = (h) => sumHit(h.id).pa;
  // how good he is at the job: his bat, his glove there, discounted if he barely played
  const value = (h, pos) => {
    let glove = 0;
    if (pos !== 'DH') { const d = defAt(h, pos); const r2 = d ? { arm: d[1], fld: d[2] } : hitterRatings(h.id, pos); glove = (r2.arm + r2.fld) * 0.3; }
    return (h.con + h.pow * 1.1 + h.eye * 0.6 + glove) * Math.min(1, pa(h) / 200);
  };
  const best = (list, pos) => list.sort((a, b) => value(b, pos) - value(a, pos))[0];
  const used = new Set(), lineup = [];
  for (const pos of POS_ORDER) {
    const free = hitters.filter((h) => !used.has(h.id));
    let pick = best(free.filter((h) => defAt(h, pos)), pos);   // the best player who actually plays there
    if (!pick) pick = best(free.filter((h) => group(h.primary) === group(pos)), pos);
    if (!pick) pick = best(free, pos);
    if (!pick) continue;
    // playing somewhere new for his club: rate his arm and glove there too
    if (!defAt(pick, pos)) { const r2 = hitterRatings(pick.id, pos); pick.def.push([pos, r2.arm, r2.fld]); }
    used.add(pick.id); lineup.push({ h: pick, pos });
  }
  const dh = best(hitters.filter((h) => !used.has(h.id)), 'DH');
  if (dh) lineup.push({ h: dh, pos: 'DH' });
  if (lineup.length < 9) throw new Error(`${t.abbreviation}: only ${lineup.length} hitters with stats`);
  // batting order, the way the game orders lineups: table-setter, contact, power in the middle
  const pool = lineup.map(({ h }) => h), order = [];
  const take = (f) => { pool.sort((a, b) => f(b) - f(a)); order.push(pool.shift()); };
  take((h) => h.spd * 0.6 + h.con * 0.7 + h.eye * 0.3);
  take((h) => h.con + h.eye * 0.5);
  take((h) => h.con * 0.8 + h.pow);
  take((h) => h.pow * 1.2 + h.con * 0.4);
  take((h) => h.pow + h.con * 0.5);
  pool.sort((a, b) => b.con + b.pow - (a.con + a.pow));
  order.push(...pool);
  // the rotation: the five with the most starts (the ace first), then the bullpen: the top
  // seven relief arms by saves, holds and innings, the closer first
  const arms = [...PIT.values()].filter((p) => p.club === ci);
  const starts = (p) => sumPit(p.id).gsS * 10 + sumPit(p.id).gs + sumPit(p.id).ipS * 0.05;
  const rotation = arms.filter((p) => p.role === 'SP').sort((a, b) => starts(b) - starts(a)).slice(0, 5);
  for (const p of arms.slice().sort((a, b) => starts(b) - starts(a))) if (rotation.length < 5 && !rotation.includes(p)) rotation.push(p);
  const lev = (p) => { const o = sumPit(p.id); return o.sv * 3 + o.hld * 2 + o.ip * 0.3 - o.gs * 4; };
  const bullpen = arms.filter((p) => !rotation.includes(p)).sort((a, b) => lev(b) - lev(a)).slice(0, 7);
  if (rotation.length < 1 || bullpen.length < 3) throw new Error(`${t.abbreviation}: only ${rotation.length + bullpen.length} pitchers with stats`);
  // the bench: a backup catcher if there is one, then the best infielder, outfielder and bat left
  const left = hitters.filter((h) => !used.has(h.id) && h !== dh), bench = [];
  const addBench = (f, pos) => { const h = best(left.filter((x) => !bench.includes(x) && f(x)), pos); if (h) bench.push(h); };
  addBench((h) => defAt(h, 'C'), 'C');
  addBench((h) => h.def.some((d) => IF.has(d[0])), 'SS');
  addBench((h) => h.def.some((d) => OF.has(d[0])), 'CF');
  while (bench.length < 4 && left.some((x) => !bench.includes(x))) addBench(() => true, 'DH');
  return {
    club: ci, lineup: order.map((h) => [lineup.find((x) => x.h === h).pos, h.id]),
    rotation: rotation.map((p) => p.id), bullpen: bullpen.map((p) => p.id), bench: bench.map((h) => h.id),
  };
}
const teams = [];
clubs.forEach((t, ci) => { try { teams.push(buildTeam(t, ci)); } catch (e) { console.warn(`  ${t.name}: ${e.message}`); } });
console.log(`  built ${teams.length} teams`);
if (teams.length < 20) throw new Error('Too few teams built; not writing the file.');
const clubRows = clubs.map((t) => {
  const [c1, c2] = teamColors(t.id);
  const city = t.name.replace(new RegExp('\\s*' + t.teamName + '$'), '') || t.locationName || t.name;
  return [t.abbreviation, city, t.teamName, c1, c2];
});
// compact rows; src/14-teams.js unpacks them
const hitRows = [...HIT.values()].map((h) => [h.id, h.name, h.club, h.bats, h.throws, h.num, h.con, h.pow, h.eye, h.spd, h.skin, h.def.map((d) => d.join(' ')).join('|')]);
const pitRows = [...PIT.values()].map((p) => [p.id, p.name, p.club, p.role, p.throws, p.num, p.velo, p.ctl, p.stuff, p.stam, p.skin, p.pitches.map((x) => x.type + x.velo).join(' ')]);
const rowsOut = (rows) => '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]';
const out = `// Generated by tools/mlb-import.mjs on ${new Date().toISOString().slice(0, 10)} from the MLB Stats API and
// Baseball Savant (${S} season, blended with ${P}). Re-run the script to refresh rosters; don't edit by hand.
// Unofficial fan project: not affiliated with or endorsed by MLB, the MLBPA or any club.
const MLB_SEASON = ${S};
// [abbreviation, city, team name, primary color, secondary color]
const MLB_CLUBS = ${rowsOut(clubRows)};
// [mlb id, name, club, bats, throws, number, CON, POW, EYE, SPD, skin, "POS ARM FLD|..." for each position he plays]
const MLB_HITTERS = ${rowsOut(hitRows)};
// [mlb id, name, club, SP/RP, throws, number, VELO, CTL, STF, STA, skin, "pitch+mph ..." most used first]
const MLB_PITCHERS = ${rowsOut(pitRows)};
// each club: [club, lineup in batting order as [position, mlb id], rotation (ace first), bullpen (closer first), bench], players by mlb id
const MLB_TEAMS = ${rowsOut(teams.map((t) => [t.club, t.lineup, t.rotation, t.bullpen, t.bench]))};
`;
await writeFile(new URL('../src/12-mlb.js', import.meta.url), out);
console.log(`  wrote src/12-mlb.js (${(out.length / 1024).toFixed(0)} KB)`);
