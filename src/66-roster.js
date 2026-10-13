// ============================================================================
// Teams as data: a club or a team built from real players ("def"), how a team travels in a
// game config or over the network (teamSpec / teamFromSpec), and the copy a mirror match
// online needs (distinctSpecs). buildCustomTeam turns a def into the same team shape as the
// built-in clubs (14-teams.js), with each player's current ratings from the pool.
// ============================================================================

const RATING_MIN = 38, RATING_MAX = 99, VELO_MIN = 86, VELO_MAX = 100;
const HIT_KEYS = [
  ['con', 'CON', 'Contact: a bigger PCI and squarer contact'],
  ['pow', 'POW', 'Power: exit velocity off the bat'],
  ['eye', 'EYE', 'Eye: lays off pitches outside the zone'],
  ['spd', 'SPD', 'Speed: on the bases and in the field'],
  ['arm', 'ARM', 'Arm: throw speed and accuracy'],
  ['fld', 'FLD', 'Fielding: range, fewer errors, better dives'],
];
const PIT_KEYS = [
  ['velo', 'VELO', 'Fastball velocity in mph'],
  ['ctl', 'CTL', 'Control: how close he hits his spot'],
  ['stuff', 'STF', 'Stuff: how much his pitches move'],
  ['stam', 'STA', 'Stamina: pitches before he tires'],
];
// A rating costs a point per step above 40, two above 70 and three above 85, so stars are expensive.
const veloRating = (mph) => 40 + ((mph - VELO_MIN) * 59) / (VELO_MAX - VELO_MIN);
const ROSTER_SIZES = { bench: 4, rotation: 5, bullpen: 7 };
// overall: the whole player at a fielding spot; a DH is judged on his bat alone
function pitcherOvr(p) { return Math.round((veloRating(p.velo) * 1.1 + p.ctl * 1.2 + p.stuff * 1.0 + p.stam * 0.3) / 3.6); }
const randId = (n = 8) => Array.from({ length: n }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[(Math.random() * 32) | 0]).join('');

// Rosters arrive from storage, the cloud and online opponents: never trust one, clamp everything.
function cleanRoster(r) {
  if (!r || typeof r !== 'object') return null;
  const str = (s, n, d) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) || d;
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : d);
  const rat = (v, d = 60) => clamp(Math.round(Number.isFinite(+v) ? +v : d), RATING_MIN, RATING_MAX);
  const no = (v, d) => (Number.isFinite(+v) && v !== '' ? clamp(Math.round(+v), 0, 99) : d);
  const skin = (s) => (SKINS.includes(s) ? s : SKINS[1]);
  const hand = (v, ok, d) => (ok.includes(v) ? v : d);
  const mlb = (v) => (Number.isInteger(+v) && +v > 0 ? +v : undefined);
  const d = {
    v: 3, id: /^X[a-z0-9]{4,16}$/i.test(r.id) ? r.id : 'X' + randId(), updated: Number.isFinite(+r.updated) ? +r.updated : Date.now(),
    city: str(r.city, 18, 'Hometown'), name: str(r.name, 18, 'Sluggers'),
    abbr: String(r.abbr || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'CUS',
    c1: hex(r.c1, '#2b4c7e'), c2: hex(r.c2, '#f2c14e'), hitters: [], order: [],
  };
  if (d.abbr.length < 2) d.abbr = (d.abbr + 'X').slice(0, 2);
  const cleanH = (h, pos, i) => {
    h = h || {};
    const o = { pos, mlbId: mlb(h.mlbId), name: str(h.name, 30, `${pos} Player`), num: no(h.num, i + 1), bats: hand(h.bats, ['R', 'L', 'S'], 'R'), throws: hand(h.throws, ['R', 'L'], 'R'), skin: skin(h.skin) };
    for (const [k] of HIT_KEYS) o[k] = rat(h[k]);
    return o;
  };
  const cleanP = (p, i, rp) => {
    p = p || {};
    const pitches = [], pv = [];
    (Array.isArray(p.pitches) ? p.pitches : []).forEach((t, k) => {
      if (!PITCH_TYPES[t] || pitches.includes(t) || pitches.length >= 5) return;
      pitches.push(t); pv.push(clamp(Math.round(+((p.pv || [])[k]) || 0), 0, 105));
    });
    for (const t of ['FF', 'SL']) if (pitches.length < 2 && !pitches.includes(t)) { pitches.push(t); pv.push(0); }
    return {
      mlbId: mlb(p.mlbId), name: str(p.name, 30, rp ? `Reliever ${i + 1}` : `Starter ${i + 1}`), num: no(p.num, 40 + i), throws: hand(p.throws, ['R', 'L'], 'R'), skin: skin(p.skin),
      velo: clamp(Math.round(Number.isFinite(+p.velo) ? +p.velo : 93), VELO_MIN, 103), ctl: rat(p.ctl), stuff: rat(p.stuff), stam: rat(p.stam, rp ? 45 : 85), pitches, pv,
    };
  };
  const src = Array.isArray(r.hitters) ? r.hitters : [];
  POS_LIST.forEach((pos, i) => d.hitters.push(cleanH(src.find((x) => x && x.pos === pos), pos, i)));
  const seen = new Set();
  for (const p of Array.isArray(r.order) ? r.order : []) if (POS_LIST.includes(p) && !seen.has(p)) { seen.add(p); d.order.push(p); }
  for (const p of POS_LIST) if (!seen.has(p)) d.order.push(p);
  // the bench, rotation and bullpen (older rosters had one starter and three relievers in r.pitchers)
  const old = Array.isArray(r.pitchers) ? r.pitchers : [];
  const rot = Array.isArray(r.rotation) ? r.rotation : old.slice(0, 1), pen = Array.isArray(r.bullpen) ? r.bullpen : old.slice(1);
  d.bench = (Array.isArray(r.bench) ? r.bench : []).slice(0, ROSTER_SIZES.bench).map((h, i) => cleanH(h, POS_LIST.includes(h && h.pos) ? h.pos : 'DH', 10 + i));
  d.rotation = (rot.length ? rot : [{}]).slice(0, ROSTER_SIZES.rotation).map((x, i) => cleanP(x, i, false));
  d.bullpen = (pen.length ? pen : [{}]).slice(0, ROSTER_SIZES.bullpen).map((x, i) => cleanP(x, i, true));
  delete d.pitchers;
  return d;
}
// real players' current numbers, from the pool (a snapshot only stands in if he's gone from it)
function hitterSnap(h, pos) {
  return { pos, mlbId: h.id, name: h.name, num: h.num, bats: h.bats, throws: h.throws, skin: SKINS[h.skinIdx % SKINS.length], ...hitterAt(h, pos) };
}
function pitcherSnap(p) {
  return { mlbId: p.id, name: p.name, num: p.num, throws: p.throws, skin: SKINS[p.skinIdx % SKINS.length], velo: p.velo, ctl: p.ctl, stuff: p.stuff, stam: p.stam, pitches: p.pitches.map((x) => x.type), pv: p.pitches.map((x) => x.velo) };
}
function resolveRoster(d) {
  const rh = (h) => { const P = h.mlbId && POOL_H.get(h.mlbId); return P ? hitterSnap(P, h.pos) : h; };
  const rp = (p) => { const P = p.mlbId && POOL_P.get(p.mlbId); return P ? pitcherSnap(P) : p; };
  return { ...d, hitters: d.hitters.map(rh), bench: (d.bench || []).map(rh), rotation: (d.rotation || []).map(rp), bullpen: (d.bullpen || []).map(rp) };
}
// a built-in club as a roster: where a new roster starts, and how mirror matchups work online
function teamToDef(t, id) {
  const hs = (h, pos) => (POOL_H.get(h.mlbId) ? hitterSnap(POOL_H.get(h.mlbId), pos) : { ...h, pos, team: undefined });
  const ps = (p) => (POOL_P.get(p.mlbId) ? pitcherSnap(POOL_P.get(p.mlbId)) : { ...p, team: undefined, pitches: p.pitches.map((x) => x.type), pv: p.pitches.map((x) => x.velo) });
  return cleanRoster({
    id: id || 'X' + randId(), updated: Date.now(), city: t.city, name: t.name, abbr: t.id, c1: t.c1, c2: t.c2,
    hitters: t.hitters.map((h) => hs(h, h.pos)), order: t.lineup.map((h) => h.pos),
    bench: (t.bench || []).map((h) => hs(h, h.pos)),
    rotation: (t.rotation || t.pitchers.slice(0, 1)).map(ps), bullpen: (t.bullpen || t.pitchers.slice(1)).map(ps),
  });
}
const _teamCache = new Map();
function buildCustomTeam(def) {
  const d = cleanRoster(def), sig = JSON.stringify(d);
  if (_teamCache.has(sig)) return _teamCache.get(sig);
  const r = resolveRoster(d);
  const team = { id: d.abbr, key: 'X:' + d.id, ver: String(d.updated), city: d.city, name: d.name, c1: d.c1, c2: d.c2, custom: true, roster: d };
  const pid = (s) => d.id + '-' + s;
  const hitter = (h, id) => { const o = { id, mlbId: h.mlbId, name: h.name, num: h.num, pos: h.pos, bats: h.bats, throws: h.throws, skin: h.skin, team }; for (const [k] of HIT_KEYS) o[k] = h[k]; return o; };
  const pitcher = (p, id, role) => ({
    id, mlbId: p.mlbId, name: p.name, num: p.num, pos: role, throws: p.throws, bats: p.throws, skin: p.skin, team,
    velo: p.velo, ctl: p.ctl, stuff: p.stuff, stam: p.stam, spd: 45, arm: 72, fld: 62, con: 22, pow: 15, eye: 25,
    pitches: p.pitches.map((t, k) => ({ type: t, velo: (p.pv && p.pv[k]) || p.velo + PITCH_TYPES[t].d, brk: stuffBreak(p.stuff) })),
  });
  team.hitters = r.hitters.map((h) => hitter(h, pid(h.pos)));
  team.lineup = d.order.map((pos) => team.hitters.find((h) => h.pos === pos));
  team.bench = r.bench.map((h, i) => hitter(h, pid('B' + i)));
  team.rotation = r.rotation.map((p, i) => pitcher(p, pid('S' + i), 'SP'));
  team.bullpen = r.bullpen.map((p, i) => pitcher(p, pid('R' + i), 'RP'));
  team.pitchers = [team.rotation[0], ...team.bullpen];
  team.ovr = teamOvr(team);
  _teamCache.set(sig, team);
  return team;
}
// The cap is what the priciest real club costs: any real team fits, and beating it
// means choosing where to spend.
// every team you can pick: the 30 clubs (and their decade teams through the era menu)
function allTeams() { return TEAMS; }
const _remoteTeams = new Map();
function teamByKey(key) {
  const t = TEAMS.find((x) => x.key === key) || (isClassic(key) ? classicTeam(key) : null);
  if (t) return t;
  return _remoteTeams.get(key) || null;
}
// how a team travels in a game config or over the network
function teamSpec(t) { return t.custom ? { c: t.roster } : { b: t.key }; }
function teamFromSpec(s) {
  if (s && s.c) { const t = buildCustomTeam(s.c); _remoteTeams.set(t.key, t); return t; }
  return TEAMS.find((x) => x.key === (s && s.b)) || (s && isClassic(s.b) ? classicTeam(s.b) : null) || TEAMS[0];
}
// two copies of the same team (a mirror match online): rename the second one's players
function distinctSpecs(a, b) {
  const ta = teamFromSpec(a), tb = teamFromSpec(b);
  if (ta.key !== tb.key) return [a, b];
  if (ta.era) return [a, { b: ta.key.replace(/#2$/, '') + '#2' }];
  const d = ta.custom ? { ...ta.roster } : teamToDef(ta, 'X' + ta.key.replace(/[^a-z0-9]/gi, '') + 'zz');
  d.id = (d.id + 'b').slice(0, 17);
  return [a, { c: d }];
}
