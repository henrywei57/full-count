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
