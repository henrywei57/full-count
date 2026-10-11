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

function buildMlbTeam([club, lineup, staff], idx) {
  const [abbr, city, name, c1, c2] = MLB_CLUBS[club];
  const team = { id: abbr, key: abbr, ver: '', idx, city, name, c1, c2, hitters: [], pitchers: [] };
  for (const [pos, pid] of lineup) {
    const h = POOL_H.get(pid);
    team.hitters.push({ id: abbr + '-' + pos, mlbId: pid, name: h.name, num: h.num, pos, bats: h.bats, throws: h.throws, ...hitterAt(h, pos), skin: SKINS[h.skinIdx % SKINS.length], team });
  }
  team.lineup = [...team.hitters];   // MLB_TEAMS lists the lineup in batting order
  staff.forEach((pid, i) => {
    const p = POOL_P.get(pid), brk = stuffBreak(p.stuff);
    team.pitchers.push({
      id: abbr + '-P' + i, mlbId: pid, name: p.name, num: p.num, pos: i ? 'RP' : 'SP', throws: p.throws, bats: p.throws, skin: SKINS[p.skinIdx % SKINS.length], team,
      velo: p.velo, ctl: p.ctl, stam: p.stam, spd: 45, arm: 72, fld: 62, con: 22, pow: 15, eye: 25,
      pitches: p.pitches.map((x) => ({ type: x.type, velo: x.velo, brk })),
    });
  });
  team.ovr = teamOvr(team);
  return team;
}
const TEAMS = MLB_TEAMS.map(buildMlbTeam);
for (const t of TEAMS) for (const p of [...t.hitters, ...t.pitchers]) PBYID[p.id] = p;
