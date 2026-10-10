// ============================================================================
// Built-in teams: the 30 MLB clubs from src/12-mlb.js, in the same shape the rest
// of the game uses for every team (custom rosters are built the same way in
// 66-roster.js). team.key names a team in menus and online games.
// ============================================================================

function buildMlbTeam(d, idx) {
  const team = { id: d.id, key: d.id, ver: '', idx, city: d.city, name: d.name, c1: d.c1, c2: d.c2, hitters: [], pitchers: [] };
  for (const h of d.hitters) {
    team.hitters.push({ id: d.id + '-' + h.pos, name: h.name, num: h.num, pos: h.pos, bats: h.bats, throws: h.throws, con: h.con, pow: h.pow, eye: h.eye, spd: h.spd, arm: h.arm, fld: h.fld, skin: SKINS[h.skin % SKINS.length], team });
  }
  team.lineup = d.order.map((pos) => team.hitters.find((h) => h.pos === pos));
  d.pitchers.forEach((p, i) => {
    const brk = 0.8 + ((p.stuff - 40) / 59) * 0.45;   // stuff: how much his pitches move
    team.pitchers.push({
      id: d.id + '-P' + i, name: p.name, num: p.num, pos: i ? 'RP' : 'SP', throws: p.throws, bats: p.throws, skin: SKINS[p.skin % SKINS.length], team,
      velo: p.velo, ctl: p.ctl, stam: p.stam, spd: 45, arm: 72, fld: 62, con: 22, pow: 15, eye: 25,
      pitches: p.pitches.filter((x) => PITCH_TYPES[x.type]).map((x) => ({ type: x.type, velo: x.velo, brk })),
    });
  });
  team.ovr = teamOvr(team);
  return team;
}
const TEAMS = MLB_TEAMS.map(buildMlbTeam);
for (const t of TEAMS) for (const p of [...t.hitters, ...t.pitchers]) PBYID[p.id] = p;
