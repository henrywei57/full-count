#!/usr/bin/env node
// Builds src/13-classic.js: every club's team for each decade from the 1960s to the 2010s
// (the 1970s Dodgers, the 1990s Braves, the 1980s Expos...), from the MLB Stats API.
//
//   node tools/classic-import.mjs
//
// Then run ./build.sh. Needs Node 18+ (built-in fetch). Unofficial: not affiliated with or
// endorsed by MLB, the MLBPA or any club.
//
// A decade team is the franchise's best players of those ten years: its regulars at each
// position, a bench, five starters and a bullpen, with their numbers for that club over the
// decade. Ratings are against the league of that decade (a .290 hitter in the 1960s rates
// higher than one in the 1990s), on the same scale as today's players:
//   CON  average and strikeout rate      POW  isolated power      EYE  walk and strikeout rate
//   SPD  steal attempts and triples      ARM  caught stealing (C), outfield assists, position
//   FLD  fielding percentage and range against others at his position
//   STF  strikeout rate (and keeping it in the park)   CTL  walk rate
//   VELO estimated from strikeouts and the era (no radar guns back then)   STA  innings per start
import { writeFile } from 'node:fs/promises';

const API = 'https://statsapi.mlb.com/api/v1';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Full Count classic import)' };
const DECADES = [1960, 1970, 1980, 1990, 2000, 2010];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
async function get(url) {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(url, { headers: HEADERS }); if (r.ok) return r.json(); if (r.status === 404) break; } catch (e) { /* retry */ }
    await sleep(800 * (i + 1));
  }
  throw new Error('Could not fetch ' + url);
}
const bulk = async (group, y) => ((await get(`${API}/stats?stats=season&group=${group}&season=${y}&sportId=1&playerPool=ALL&limit=6000`)).stats[0] || {}).splits || [];
const ipOf = (s) => { const [w, f] = String(s || '0').split('.'); return +w + (+f || 0) / 3; };

// ------------------------------------------------------------ gather ----
const cur = (await get(`${API}/teams?sportId=1&season=2025`)).teams.filter((t) => t.sport && t.sport.id === 1);
const CUR = new Map(cur.map((t) => [t.id, t]));
const H = new Map(), P = new Map(), F = new Map(), TS = new Map();   // keyed team|decade|player (TS: team|decade)
const LH = {}, LP = {};
for (const d of DECADES) { LH[d] = { pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0, sb: 0, cs: 0 }; LP[d] = { bf: 0, k: 0, bb: 0, hr: 0 }; }
const add = (map, key, init) => { let o = map.get(key); if (!o) map.set(key, (o = init())); return o; };
for (const d of DECADES) {
  for (let y = d; y < d + 10; y++) {
    const [hit, pit, fld, teams] = await Promise.all([bulk('hitting', y), bulk('pitching', y), bulk('fielding', y), get(`${API}/teams?sportId=1&season=${y}`)]);
    for (const t of teams.teams) {
      if (!t.sport || t.sport.id !== 1 || !CUR.has(t.id)) continue;
      const ts = add(TS, `${t.id}|${d}`, () => ({ years: new Set(), names: new Map() }));
      ts.years.add(y);
      ts.last = { city: t.locationName, name: t.teamName, abbr: t.abbreviation, venue: t.venue || {} };
      const vn = (t.venue && t.venue.name) || '';
      ts.venues = ts.venues || new Map(); ts.venues.set(vn, (ts.venues.get(vn) || 0) + 1);
      // the city as the club called itself ("New York", not "Bronx")
      const full = t.name.replace(new RegExp('\s*' + t.teamName + '$'), '');
      const nm = `${full && full !== t.name ? full : t.locationName}|${t.teamName}|${t.abbreviation}`;
      ts.names.set(nm, (ts.names.get(nm) || 0) + 1);
    }
    for (const r of hit) {
      if (!r.team || !CUR.has(r.team.id)) continue;
      const s = r.stat, o = add(H, `${r.team.id}|${d}|${r.player.id}`, () => ({ id: r.player.id, name: r.player.fullName, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0, sb: 0, cs: 0, years: new Set() }));
      o.pa += s.plateAppearances || 0; o.ab += s.atBats || 0; o.h += s.hits || 0; o.d += s.doubles || 0; o.t += s.triples || 0; o.hr += s.homeRuns || 0;
      o.bb += (s.baseOnBalls || 0) + (s.hitByPitch || 0); o.k += s.strikeOuts || 0; o.sb += s.stolenBases || 0; o.cs += s.caughtStealing || 0; o.years.add(y);
      const L = LH[d]; L.pa += s.plateAppearances || 0; L.ab += s.atBats || 0; L.h += s.hits || 0; L.d += s.doubles || 0; L.t += s.triples || 0; L.hr += s.homeRuns || 0;
      L.bb += (s.baseOnBalls || 0) + (s.hitByPitch || 0); L.k += s.strikeOuts || 0; L.sb += s.stolenBases || 0; L.cs += s.caughtStealing || 0;
    }
    for (const r of pit) {
      if (!r.team || !CUR.has(r.team.id)) continue;
      const s = r.stat, o = add(P, `${r.team.id}|${d}|${r.player.id}`, () => ({ id: r.player.id, name: r.player.fullName, bf: 0, k: 0, bb: 0, hr: 0, h: 0, er: 0, outs: 0, g: 0, gs: 0, sv: 0 }));
      o.bf += s.battersFaced || 0; o.k += s.strikeOuts || 0; o.bb += (s.baseOnBalls || 0) + (s.hitBatsmen || 0); o.hr += s.homeRuns || 0; o.h += s.hits || 0;
      o.er += s.earnedRuns || 0; o.outs += Math.round(ipOf(s.inningsPitched) * 3); o.g += s.gamesPitched || s.gamesPlayed || 0; o.gs += s.gamesStarted || 0; o.sv += s.saves || 0;
      const L = LP[d]; L.bf += s.battersFaced || 0; L.k += s.strikeOuts || 0; L.bb += (s.baseOnBalls || 0) + (s.hitBatsmen || 0); L.hr += s.homeRuns || 0;
    }
    for (const r of fld) {
      const pos = r.position && r.position.abbreviation;
      if (!r.team || !CUR.has(r.team.id) || !pos || pos === 'P' || pos === 'DH' || pos === 'OF') continue;
      const s = r.stat, o = add(F, `${r.team.id}|${d}|${r.player.id}`, () => ({}));
      const f = o[pos] || (o[pos] = { g: 0, po: 0, a: 0, e: 0, ch: 0, cs: 0, sb: 0 });
      f.g += s.games || s.gamesPlayed || 0; f.po += s.putOuts || 0; f.a += s.assists || 0; f.e += s.errors || 0; f.ch += s.chances || 0;
      f.cs += s.caughtStealing || 0; f.sb += s.stolenBases || 0;
    }
    process.stdout.write(`\r  ${y}`);
  }
}
console.log('\n  gathered', H.size, 'hitter and', P.size, 'pitcher team-decades');

// ----------------------------------------------------------- ratings ----
const dist = (vals) => { const v = vals.filter((x) => Number.isFinite(x)), m = v.reduce((a, b) => a + b, 0) / (v.length || 1); return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1)) || 1 }; };
const rt = (v) => clamp(Math.round(v), 38, 99);
const POS_ARM = { C: 82, '1B': 66, '2B': 72, '3B': 84, SS: 86, LF: 74, CF: 80, RF: 86, DH: 60 };
const POS_FLD = { C: 77, '1B': 71, '2B': 77, '3B': 77, SS: 79, LF: 73, CF: 79, RF: 75, DH: 45 };
const FIELD = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'], OF = new Set(['LF', 'CF', 'RF']), IF = new Set(['1B', '2B', '3B', 'SS']);
// a player's rates, pulled toward the decade's league average by a few hundred plate appearances
const hrate = (o, d) => {
  const L = LH[d], f = 150 / L.pa, pa = o.pa + L.pa * f, ab = o.ab + L.ab * f, h = o.h + L.h * f;
  const tb = h + (o.d + L.d * f) + 2 * (o.t + L.t * f) + 3 * (o.hr + L.hr * f);
  return { avg: h / ab, iso: (tb - h) / ab, bb: (o.bb + L.bb * f) / pa, k: (o.k + L.k * f) / pa, run: (o.sb + o.cs + (L.sb + L.cs) * f) / pa, trip: (o.t + L.t * f) / ab };
};
const prate = (o, d) => { const L = LP[d], f = 100 / L.bf, bf = o.bf + L.bf * f; return { k: (o.k + L.k * f) / bf, bb: (o.bb + L.bb * f) / bf, hr: (o.hr + L.hr * f) / bf }; };
const HD = {}, PD = {}, FD = {};
for (const d of DECADES) {
  const regs = [...H.entries()].filter(([k, o]) => k.split('|')[1] == d && o.pa >= 800).map(([, o]) => hrate(o, d));
  HD[d] = Object.fromEntries(['avg', 'iso', 'bb', 'k', 'run', 'trip'].map((k) => [k, dist(regs.map((r) => r[k]))]));
  const arms = [...P.entries()].filter(([k, o]) => k.split('|')[1] == d && o.bf >= 800).map(([, o]) => prate(o, d));
  PD[d] = Object.fromEntries(['k', 'bb', 'hr'].map((k) => [k, dist(arms.map((r) => r[k]))]));
  FD[d] = {};
  for (const pos of FIELD) {
    const fs = [...F.entries()].filter(([k, o]) => k.split('|')[1] == d && o[pos] && o[pos].g >= 150).map(([, o]) => o[pos]);
    FD[d][pos] = { fp: dist(fs.map((f) => (f.po + f.a) / Math.max(1, f.ch))), rf: dist(fs.map((f) => (f.po + f.a) / Math.max(1, f.g))), a: dist(fs.map((f) => f.a / Math.max(1, f.g))), cs: dist(fs.map((f) => f.cs / Math.max(1, f.cs + f.sb))) };
  }
}
function hitterRatings(o, d) {
  const r = hrate(o, d), D = HD[d], z = (k) => (r[k] - D[k].m) / D[k].sd;
  return {
    con: rt(76 + 12 * (0.45 * z('avg') - 0.65 * z('k'))), pow: rt(79 + 11 * z('iso')), eye: rt(78 + 12 * (0.8 * z('bb') - 0.3 * z('k'))),
    spd: rt(66 + 10 * clamp(z('run'), -1.5, 3.3) + 4 * clamp(z('trip'), -1.5, 2.5)),
  };
}
function defRatings(f, pos, d) {
  if (!f || !f.g) return { arm: Math.max(38, (POS_ARM[pos] ?? 66) - 8), fld: Math.max(38, (POS_FLD[pos] ?? 66) - 12) };
  const N = FD[d][pos], w = Math.min(1, f.g / 200), zz = (v, s) => clamp((v - s.m) / s.sd, -2.5, 2.5) * w;
  const fp = zz((f.po + f.a) / Math.max(1, f.ch), N.fp), rf = zz((f.po + f.a) / f.g, N.rf);
  let arm = POS_ARM[pos];
  if (pos === 'C') arm = 78 + 8 * zz(f.cs / Math.max(1, f.cs + f.sb), N.cs);
  else if (OF.has(pos)) arm += 5 * zz(f.a / f.g, N.a);
  else arm += 2 * rf;
  return { arm: rt(arm), fld: rt(POS_FLD[pos] + 4 * fp + (pos === '1B' ? 2 : 5) * rf) };
}
const ERA_VELO = { 1960: -2.5, 1970: -2, 1980: -1.5, 1990: -1, 2000: -0.3, 2010: 0.8 };
const PITCH_D = { FF: 0, SI: -1, FC: -5, SL: -8, CU: -15, CH: -8, FS: -7 };
function hashOf(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function pitcherRatings(o, d, starter) {
  const r = prate(o, d), D = PD[d], z = (k) => (r[k] - D[k].m) / D[k].sd;
  const stuff = 64 + 13 * z('k') - 3 * z('hr'), ctl = 78 + 12 * -z('bb');
  const velo = clamp(Math.round(93.5 + ERA_VELO[d] + 2 * z('k') + (starter ? 0 : 0.8)), 85, 100);
  const stam = starter ? clamp(Math.round((o.outs / 3 / Math.max(1, o.gs)) * 14 + 3), 66, 99) : clamp(Math.round((o.bf / Math.max(1, o.g)) * 3.85 * 2.3), 34, 62);
  // what he threw: a fastball (a sinker for the ground-ball guys), then breaking stuff and a change
  const h = hashOf(o.id), list = [z('hr') < -0.8 ? 'SI' : 'FF'];
  list.push(h % 3 === 0 ? 'CU' : 'SL');
  if (starter || h % 2) list.push(h % 5 === 0 ? 'FS' : 'CH');
  if (starter && h % 4 === 1) list.push(list.includes('CU') ? 'SL' : 'CU');
  if (h % 7 === 3) list.push('FC');
  return { velo, ctl: rt(ctl), stuff: rt(stuff), stam, pitches: list.slice(0, starter ? 5 : 4).map((t) => t + Math.round(velo + PITCH_D[t])) };
}

// --------------------------------------------------------- the teams ----
// colors for clubs that looked different back then
const ERA_COLORS = { 120: [2004, '#003087', '#e4002b'], 146: [2011, '#00a3ad', '#000000'], 139: [2007, '#00704a', '#ffffff'], 117: [1993, '#eb6e1f', '#002d62'], 140: [1971, '#002d72', '#c8102e'] };
// ballparks by the name the API gives them (see PARKS in src/10-core.js for the old ones)
const VENUE_PARK = {
  'Crosley Field': 'CROS', 'Riverfront Stadium': 'RIVF', 'Cinergy Field': 'RIVF', 'Astrodome': 'ASTR', 'Shea Stadium': 'SHEA', 'Three Rivers Stadium': 'TRS',
  'Veterans Stadium': 'VET', 'Connie Mack Stadium': 'CMS', 'Forbes Field': 'FORB', 'Candlestick Park': 'CAND', '3Com Park at Candlestick Point': 'CAND',
  'Busch Stadium I': 'BUSC', "Sportsman's Park (1909-66)": 'SPRT', 'Olympic Stadium': 'OLYM', 'Jarry Park': 'JARY', 'Tiger Stadium': 'TIGR', 'Comiskey Park': 'COMI',
  'The Kingdome': 'KING', 'Hubert H. Humphrey Metrodome': 'DOME', 'Metropolitan Stadium': 'METS', 'Memorial Stadium': 'MEMO', 'Atlanta Stadium': 'FULT',
  'Atlanta-Fulton County Stadium': 'FULT', 'Turner Field': 'TUR', 'Milwaukee County Stadium': 'CNTY', 'Cleveland Municipal Stadium': 'CLEV',
  'San Diego Stadium': 'JACK', 'Jack Murphy Stadium': 'JACK', 'Qualcomm Stadium': 'JACK', 'Arlington Stadium': 'ARLS', 'The Ballpark at Arlington': 'BALL',
  'Ameriquest Field': 'BALL', 'Rangers Ballpark in Arlington': 'BALL', 'Globe Life Park in Arlington': 'BALL', 'D.C. Stadium': 'RFK', 'Robert F. Kennedy Memorial Stadium': 'RFK',
  'Exhibition Stadium': 'EXH', 'Oakland-Alameda County Coliseum': 'OAK', 'Network Associates Coliseum': 'OAK', 'McAfee Coliseum': 'OAK', 'O.co Coliseum': 'OAK',
  'Oakland Coliseum': 'OAK', 'Municipal Stadium': 'MUNI', 'Joe Robbie Stadium': 'JRS', 'Pro Player Stadium': 'JRS', 'Dolphin Stadium': 'JRS', 'Land Shark Stadium': 'JRS',
  'Sun Life Stadium': 'JRS', 'Hard Rock Stadium': 'JRS', 'Yankee Stadium I': 'NYY', 'SunTrust Park': 'ATL', 'Busch Stadium': 'STL',
  // today's parks under their old names
  'Jacobs Field': 'CLE', 'Progressive Field': 'CLE', 'Anaheim Stadium': 'LAA', 'Angel Stadium of Anaheim': 'LAA', 'Edison International Field': 'LAA', 'Angel Stadium': 'LAA',
  'Bank One Ballpark': 'AZ', 'Chase Field': 'AZ', 'U.S. Cellular Field': 'CWS', 'Guaranteed Rate Field': 'CWS', 'Enron Field': 'HOU', 'Astros Field': 'HOU', 'Minute Maid Park': 'HOU',
  'Royals Stadium': 'KC', 'Kauffman Stadium': 'KC', 'Miller Park': 'MIL', 'PETCO Park': 'SD', 'Petco Park': 'SD', 'Safeco Field': 'SEA', 'T-Mobile Park': 'SEA',
  'AT&T Park': 'SF', 'PacBell Park': 'SF', 'SBC Park': 'SF', 'Oracle Park': 'SF', 'Tropicana Field': 'TB', 'SkyDome': 'TOR', 'Rogers Centre': 'TOR', 'Marlins Park': 'MIA',
};
const HROWS = [], PROWS = [], TEAMS = [];
const people = new Map();
const POS_ORDER = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];
for (const [tkey, ts] of TS) {
  const [tid, dS] = tkey.split('|'), d = +dS, club = CUR.get(+tid);
  if (ts.years.size < 5) continue;   // the club barely existed that decade
  const hit = [...H.entries()].filter(([k]) => k.startsWith(tkey + '|')).map(([k, o]) => ({ ...o, f: F.get(k) || {} }));
  const pit = [...P.entries()].filter(([k]) => k.startsWith(tkey + '|')).map(([, o]) => o);
  const pitIds = new Set(pit.filter((p) => p.bf > 100).map((p) => p.id));
  const hitters = hit.filter((h) => h.pa >= 120 && !(pitIds.has(h.id) && (P.get(`${tkey}|${h.id}`) || { bf: 0 }).bf > h.pa));
  for (const h of hitters) {
    Object.assign(h, hitterRatings(h, d));
    const total = Object.values(h.f).reduce((a, x) => a + x.g, 0);
    h.elig = FIELD.filter((p) => h.f[p] && (h.f[p].g >= 40 || h.f[p].g >= total * 0.25)).sort((a, b) => h.f[b].g - h.f[a].g);
  }
  const value = (h, pos) => {
    const df = pos === 'DH' ? null : defRatings(h.f[pos], pos, d);
    return (h.con + h.pow * 1.1 + h.eye * 0.6 + (df ? (df.arm + df.fld) * 0.3 : 0)) * Math.min(1, h.pa / 1500);
  };
  const best = (list, pos) => list.slice().sort((a, b) => value(b, pos) - value(a, pos))[0];
  const used = new Set(), lineup = [];
  for (const pos of POS_ORDER) {
    const free = hitters.filter((h) => !used.has(h.id));
    const pick = best(free.filter((h) => h.elig.includes(pos)), pos) || best(free.filter((h) => h.f[pos]), pos) || best(free, pos);
    if (!pick) continue;
    used.add(pick.id); lineup.push({ h: pick, pos });
  }
  const dh = best(hitters.filter((h) => !used.has(h.id)), 'DH');
  if (dh) { used.add(dh.id); lineup.push({ h: dh, pos: 'DH' }); }
  if (lineup.length < 9) { console.warn(`  skip ${ts.last.abbr} ${d}s: ${lineup.length} hitters`); continue; }
  // batting order: table-setter, contact, power in the middle
  const pool = lineup.map(({ h }) => h), order = [];
  const take = (f) => { pool.sort((a, b) => f(b) - f(a)); order.push(pool.shift()); };
  take((h) => h.spd * 0.6 + h.con * 0.7 + h.eye * 0.3); take((h) => h.con + h.eye * 0.5); take((h) => h.con * 0.8 + h.pow);
  take((h) => h.pow * 1.2 + h.con * 0.4); take((h) => h.pow + h.con * 0.5);
  pool.sort((a, b) => b.con + b.pow - (a.con + a.pow)); order.push(...pool);
  const left = hitters.filter((h) => !used.has(h.id)), bench = [];
  const addB = (f, pos) => { const h = best(left.filter((x) => !bench.includes(x) && f(x)), pos); if (h) bench.push(h); };
  addB((h) => h.elig.includes('C'), 'C'); addB((h) => h.elig.some((p) => IF.has(p)), 'SS'); addB((h) => h.elig.some((p) => OF.has(p)), 'CF');
  while (bench.length < 4 && left.some((x) => !bench.includes(x))) addB(() => true, 'DH');
  // the staff: five starters by starts and innings, then the bullpen by saves and relief work
  const arms = pit.filter((p) => p.bf >= 120);
  const isSP = (p) => p.gs >= 5 && p.gs >= p.g * 0.5;
  const rotation = arms.filter(isSP).sort((a, b) => (b.gs * 10 + b.outs * 0.05 - b.er * 0.3) - (a.gs * 10 + a.outs * 0.05 - a.er * 0.3)).slice(0, 5);
  for (const p of arms.slice().sort((a, b) => b.gs - a.gs)) if (rotation.length < 5 && !rotation.includes(p)) rotation.push(p);
  const lev = (p) => p.sv * 3 + (p.g - p.gs) * 0.6 + p.outs * 0.02 - p.er * 0.15;
  const bullpen = pit.filter((p) => !rotation.includes(p) && p.bf >= 40).sort((a, b) => lev(b) - lev(a)).slice(0, 7);
  if (rotation.length < 3 || bullpen.length < 3) { console.warn(`  skip ${ts.last.abbr} ${d}s: ${rotation.length}+${bullpen.length} pitchers`); continue; }
  // rows
  const hIdx = (h, pos) => {
    const def = (h.elig.length ? h.elig : pos && pos !== 'DH' ? [pos] : []).slice();
    if (pos && pos !== 'DH' && !def.includes(pos)) def.push(pos);
    const defs = def.map((p) => { const r = defRatings(h.f[p], p, d); return `${p} ${r.arm} ${r.fld}`; }).join('|');
    HROWS.push([h.id, h.name, '', '', 0, h.con, h.pow, h.eye, h.spd, hashOf(h.id) % 8, defs]);
    people.set(h.id, null);
    return HROWS.length - 1;
  };
  const pIdx = (p, starter) => {
    const r = pitcherRatings(p, d, starter);
    PROWS.push([p.id, p.name, starter ? 'SP' : 'RP', '', 0, r.velo, r.ctl, r.stuff, r.stam, hashOf(p.id) % 8, r.pitches.join(' ')]);
    people.set(p.id, null);
    return PROWS.length - 1;
  };
  const [eraName] = [...ts.names.entries()].sort((a, b) => b[1] - a[1])[0];
  const [city, name, abbr] = eraName.split('|');
  const curAbbr = club.abbreviation;
  const ec = ERA_COLORS[+tid];
  const colors = ec && d <= ec[0] ? [ec[1], ec[2]] : null;
  // where it played most that decade: one of the old parks, today's park, or a generic one
  const [venue] = [...ts.venues.entries()].sort((a, b) => b[1] - a[1])[0];
  const park = venue === 'Comiskey Park' && d >= 1990 ? 'CWS' : VENUE_PARK[venue] || (venue === (club.venue || {}).name ? curAbbr : 'FC');
  TEAMS.push([`${curAbbr}@${d}`, curAbbr, d, abbr, city, name, colors, park,
    order.map((h) => [lineup.find((x) => x.h === h).pos, hIdx(h, lineup.find((x) => x.h === h).pos)]),
    rotation.map((p) => pIdx(p, true)), bullpen.map((p) => pIdx(p, false)), bench.map((h) => hIdx(h, null))]);
}
console.log(`  built ${TEAMS.length} decade teams`);
// bats, throws and numbers
const ids = [...people.keys()];
for (let i = 0; i < ids.length; i += 150) {
  const j = await get(`${API}/people?personIds=${ids.slice(i, i + 150).join(',')}&fields=people,id,batSide,code,pitchHand,primaryNumber`);
  for (const p of j.people || []) people.set(p.id, p);
}
for (const r of HROWS) {
  const p = people.get(r[0]) || {};
  r[2] = (p.batSide || {}).code || 'R'; r[3] = (p.pitchHand || {}).code || 'R'; r[4] = parseInt(p.primaryNumber, 10) || 0;
}
// pitchers bat the way they throw (for a pitcher's row, [2] is his role)
for (const r of PROWS) { const p = people.get(r[0]) || {}; r[3] = (p.pitchHand || {}).code || 'R'; r[4] = parseInt(p.primaryNumber, 10) || 0; }
TEAMS.sort((a, b) => a[1].localeCompare(b[1]) || a[2] - b[2]);
const rowsOut = (rows) => '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]';
const out = `// Generated by tools/classic-import.mjs on ${new Date().toISOString().slice(0, 10)} from the MLB Stats API.
// Every club's team for each decade, rated against its own era. Re-run the script to rebuild; don't edit by hand.
// Unofficial fan project: not affiliated with or endorsed by MLB, the MLBPA or any club.
// [key, club (today's abbreviation), decade, abbreviation then, city, name, colors then (or null), home park, lineup as [position, hitter],
//  rotation, bullpen, bench] (hitters and pitchers by their index below)
const CLASSIC_TEAMS = ${rowsOut(TEAMS)};
// [mlb id, name, bats, throws, number, CON, POW, EYE, SPD, skin, "POS ARM FLD|..."]
const CLASSIC_H = ${rowsOut(HROWS)};
// [mlb id, name, SP/RP, throws, number, VELO, CTL, STF, STA, skin, "pitch+mph ..."]
const CLASSIC_P = ${rowsOut(PROWS)};
`;
await writeFile(new URL('../src/13-classic.js', import.meta.url), out);
console.log(`  wrote src/13-classic.js (${(out.length / 1024).toFixed(0)} KB)`);
