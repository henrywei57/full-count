// ============================================================================
// The MLB player pool and the 30 built-in clubs, unpacked from src/12-mlb.js.
// Every built-in and custom team ends up in the same shape (custom rosters are
// built in 66-roster.js). team.key names a team in menus and online games.
// ============================================================================

const POOL_H = new Map(), POOL_P = new Map();   // mlb id -> player
for (const [id, name, club, bats, throws, num, con, pow, eye, spd, skin, def] of MLB_HITTERS) {
  const d = {};
  for (const part of def ? def.split('|') : []) { const [pos, arm, fld] = part.split(' '); d[pos] = { arm: +arm, fld: +fld }; }
  const elig = Object.keys(d);
  POOL_H.set(id, { id, name, club: MLB_CLUBS[club][0], bats, throws, num, con, pow, eye, spd, skinIdx: skin, def: d, elig, main: elig[0] || 'DH' });
}
for (const [id, name, club, role, throws, num, velo, ctl, stuff, stam, skin, arsenal] of MLB_PITCHERS) {
  const pitches = arsenal.split(' ').map((s) => ({ type: s.slice(0, 2), velo: +s.slice(2) })).filter((x) => PITCH_TYPES[x.type]);
  POOL_P.set(id, { id, name, club: MLB_CLUBS[club][0], role, throws, num, velo, ctl, stuff, stam, skinIdx: skin, pitches });
}
// a hitter's ratings at a position: his arm and glove there, a step worse anywhere he doesn't play
function hitterAt(h, pos) {
  const main = h.def[h.main] || { arm: 66, fld: 66 };
  const d = h.def[pos] || (pos === 'DH' ? { arm: main.arm, fld: 45 } : { arm: Math.max(38, main.arm - 8), fld: Math.max(38, main.fld - 12) });
  return { con: h.con, pow: h.pow, eye: h.eye, spd: h.spd, arm: d.arm, fld: d.fld };
}
const stuffBreak = (s) => 0.8 + ((s - 40) / 59) * 0.45;   // stuff: how much his pitches move

// a game-ready hitter (at a position) or pitcher, from the pool
function mlbHitter(team, pid, pos, id) {
  const h = POOL_H.get(pid);
  return { id, mlbId: pid, name: h.name, num: h.num, pos, bats: h.bats, throws: h.throws, ...hitterAt(h, pos), skin: SKINS[h.skinIdx % SKINS.length], team };
}
function mlbPitcher(team, pid, role, id) {
  const p = POOL_P.get(pid), brk = stuffBreak(p.stuff);
  return {
    id, mlbId: pid, name: p.name, num: p.num, pos: role, throws: p.throws, bats: p.throws, skin: SKINS[p.skinIdx % SKINS.length], team,
    velo: p.velo, ctl: p.ctl, stuff: p.stuff, stam: p.stam, spd: 45, arm: 72, fld: 62, con: 22, pow: 15, eye: 25,
    pitches: p.pitches.map((x) => ({ type: x.type, velo: x.velo, brk })),
  };
}
// Every team: nine starters (team.hitters, in batting order as team.lineup), a bench, a
// rotation and a bullpen. team.pitchers is today's starter followed by the bullpen.
function buildMlbTeam([club, lineup, rotation, bullpen, bench], idx) {
  const [abbr, city, name, c1, c2] = MLB_CLUBS[club];
  const team = { id: abbr, key: abbr, ver: '', idx, city, name, c1, c2 };
  team.hitters = lineup.map(([pos, pid]) => mlbHitter(team, pid, pos, abbr + '-' + pos));
  team.lineup = [...team.hitters];   // MLB_TEAMS lists the lineup in batting order
  team.bench = bench.map((pid, i) => { const h = POOL_H.get(pid); return mlbHitter(team, pid, h.main, abbr + '-B' + i); });
  team.rotation = rotation.map((pid, i) => mlbPitcher(team, pid, 'SP', abbr + '-S' + i));
  team.bullpen = bullpen.map((pid, i) => mlbPitcher(team, pid, 'RP', abbr + '-R' + i));
  team.pitchers = [team.rotation[0], ...team.bullpen];
  team.ovr = teamOvr(team);
  return team;
}
const TEAMS = MLB_TEAMS.map(buildMlbTeam);
for (const t of TEAMS) for (const p of teamPlayers(t)) PBYID[p.id] = p;
// everyone on a team: starters, bench, rotation and bullpen
function teamPlayers(t) { return [...t.hitters, ...(t.bench || []), ...(t.rotation || []), ...t.pitchers]; }

// ------------------------------------------------------------- decade teams ----
// Every club's team for each decade from the 1960s on (src/13-classic.js), rated against its
// own era. Key: today's abbreviation and the decade ('LAD@1970'). Built the first time it's picked.
const CLASSIC = new Map(CLASSIC_TEAMS.map((r) => [r[0], r]));
const CLASSIC_BY_CLUB = new Map();
for (const r of CLASSIC_TEAMS) { if (!CLASSIC_BY_CLUB.has(r[1])) CLASSIC_BY_CLUB.set(r[1], []); CLASSIC_BY_CLUB.get(r[1]).push(r[0]); }
const _classic = new Map();
function classicHitter(team, row, pos, id) {
  const [mlbId, name, bats, throws, num, con, pow, eye, spd, skin, defs] = row;
  const def = {};
  for (const part of defs ? defs.split('|') : []) { const [p, arm, fld] = part.split(' '); def[p] = { arm: +arm, fld: +fld }; }
  const main = Object.values(def)[0] || { arm: 66, fld: 66 };
  const at = def[pos] || (pos === 'DH' ? { arm: main.arm, fld: 45 } : { arm: Math.max(38, main.arm - 8), fld: Math.max(38, main.fld - 12) });
  return { id, mlbId, name, num, pos, bats, throws, con, pow, eye, spd, arm: at.arm, fld: at.fld, skin: SKINS[skin % SKINS.length], team, def };
}
function classicPitcher(team, row, role, id) {
  const [mlbId, name, , throws, num, velo, ctl, stuff, stam, skin, ars] = row, brk = stuffBreak(stuff);
  return {
    id, mlbId, name, num, pos: role, throws, bats: throws, skin: SKINS[skin % SKINS.length], team, velo, ctl, stuff, stam, spd: 45, arm: 72, fld: 62, con: 22, pow: 15, eye: 25,
    pitches: ars.split(' ').map((s) => ({ type: s.slice(0, 2), velo: +s.slice(2), brk })).filter((x) => PITCH_TYPES[x.type]),
  };
}
const isClassic = (key) => CLASSIC.has(String(key || '').replace(/#2$/, ''));
// key + '#2': a second copy, for a game between the same decade team
function classicTeam(key) {
  if (_classic.has(key)) return _classic.get(key);
  const copy = /#2$/.test(key), r = CLASSIC.get(key.replace(/#2$/, ''));
  if (!r) return null;
  const [, club, decade, abbr, city, name, colors, park, lineup, rotation, bullpen, bench] = r;
  const base = TEAMS.find((t) => t.key === club) || TEAMS[0], yy = String(decade).slice(2);
  const team = { id: abbr + yy, key, ver: '', idx: base.idx, city, name, c1: colors ? colors[0] : base.c1, c2: colors ? colors[1] : base.c2, club, era: decade, park };
  const pre = club + yy + (copy ? 'b' : '');
  team.hitters = lineup.map(([pos, i]) => classicHitter(team, CLASSIC_H[i], pos, `${pre}-${pos}`));
  team.lineup = [...team.hitters];
  team.bench = bench.map((i, k) => { const row = CLASSIC_H[i]; return classicHitter(team, row, (row[10] || 'DH').split(' ')[0] || 'DH', `${pre}-B${k}`); });
  team.rotation = rotation.map((i, k) => classicPitcher(team, CLASSIC_P[i], 'SP', `${pre}-S${k}`));
  team.bullpen = bullpen.map((i, k) => classicPitcher(team, CLASSIC_P[i], 'RP', `${pre}-R${k}`));
  team.pitchers = [team.rotation[0], ...team.bullpen];
  team.ovr = teamOvr(team);
  for (const p of teamPlayers(team)) PBYID[p.id] = p;
  _classic.set(key, team);
  return team;
}
// the club a team belongs to (today's abbreviation), and its decade (0 for today's roster)
const clubOf = (t) => (t.club || (TEAMS.includes(t) ? t.key : null));
const eraName = (t) => (t.era ? `${t.era}s` : `${MLB_SEASON}`);
