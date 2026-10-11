// ============================================================================
// Custom rosters: build your own team out of real MLB players, under a point cap.
// Every player costs points from his ratings, so you can't sign every star.
// Rosters are saved on this device, and to your Google account when you're signed
// in (67-cloud.js). A roster is plain data (a "def"): each spot holds a real
// player's MLB id plus a snapshot of him. buildCustomTeam turns it into the same
// team shape as the built-in clubs (14-teams.js), with the real player's current
// ratings looked up from the pool, so the rest of the game can't tell the difference.
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
function ratingCost(v) { v = clamp(Math.round(v), 40, RATING_MAX); return v - 40 + Math.max(0, v - 70) + Math.max(0, v - 85); }
const veloRating = (mph) => 40 + ((mph - VELO_MIN) * 59) / (VELO_MAX - VELO_MIN);
function hitterCost(h) { return HIT_KEYS.reduce((s, [k]) => s + ratingCost(h[k]), 0); }
function pitcherCost(p) { return ratingCost(veloRating(p.velo)) + ratingCost(p.ctl) + ratingCost(p.stuff) + ratingCost(p.stam); }
function rosterCost(d) {
  const r = resolveRoster(d);
  return [...r.hitters, ...r.bench].reduce((s, h) => s + hitterCost(h), 0) + [...r.rotation, ...r.bullpen].reduce((s, p) => s + pitcherCost(p), 0);
}
const ROSTER_SIZES = { bench: 4, rotation: 5, bullpen: 7 };
// overall: the whole player at a fielding spot; a DH is judged on his bat alone
function hitterOvr(h, pos) { return pos === 'DH' ? Math.round((h.con * 1.2 + h.pow * 1.2 + h.eye * 0.8 + h.spd * 0.4) / 3.6) : Math.round((h.con * 1.2 + h.pow * 1.2 + h.eye * 0.8 + h.spd * 0.6 + h.arm * 0.5 + h.fld * 0.7) / 5); }
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
  team.cost = rosterCost(d);
  _teamCache.set(sig, team);
  return team;
}
// The cap is what the priciest real club costs: any real team fits, and beating it
// means choosing where to spend.
const ROSTER_BUDGET = Math.ceil(Math.max(...TEAMS.map((t) => rosterCost(teamToDef(t)))) / 50) * 50;

// ---------------------------------------------------------- my rosters ----
let ROSTERS = [];
// stored rosters pick up the latest real ratings each time the game loads
try { ROSTERS = (JSON.parse(localStorage.getItem('fullcount.rosters') || '[]') || []).map(cleanRoster).filter(Boolean).map((d) => cleanRoster(resolveRoster(d))); } catch (e) { ROSTERS = []; }
function saveRostersLocal() { try { localStorage.setItem('fullcount.rosters', JSON.stringify(ROSTERS)); } catch (e) { /* storage full or blocked */ } }
// every team you can pick: the 30 clubs, then your rosters
function allTeams() { return [...TEAMS, ...ROSTERS.map(buildCustomTeam)]; }
const _remoteTeams = new Map();
function teamByKey(key) {
  const t = TEAMS.find((x) => x.key === key);
  if (t) return t;
  const r = ROSTERS.find((x) => 'X:' + x.id === key);
  if (r) return buildCustomTeam(r);
  return _remoteTeams.get(key) || null;
}
// how a team travels in a game config or over the network
function teamSpec(t) { return t.custom ? { c: t.roster } : { b: t.key }; }
function teamFromSpec(s) {
  if (s && s.c) { const t = buildCustomTeam(s.c); _remoteTeams.set(t.key, t); return t; }
  return TEAMS.find((x) => x.key === (s && s.b)) || TEAMS[0];
}
// two copies of the same team (a mirror match online): rename the second one's players
function distinctSpecs(a, b) {
  const ta = teamFromSpec(a), tb = teamFromSpec(b);
  if (ta.key !== tb.key) return [a, b];
  const d = ta.custom ? { ...ta.roster } : teamToDef(ta, 'X' + ta.key.replace(/[^a-z0-9]/gi, '') + 'zz');
  d.id = (d.id + 'b').slice(0, 17);
  return [a, { c: d }];
}

// --------------------------------------------------------------- editor ----
const RS = { sel: null, saveT: 0, pick: null };
function rsCur() { return ROSTERS.find((r) => r.id === RS.sel) || null; }
function openRosters() {
  if (!RS.sel || !rsCur()) RS.sel = ROSTERS.length ? ROSTERS[0].id : null;
  $('rosterScreen').classList.remove('hidden');
  rsRenderList(); rsRenderEdit();
}
function closeRosters() { rsClosePick(); rsFlush(); $('rosterScreen').classList.add('hidden'); renderMenu(); }
// persist soon after an edit: locally right away, to the cloud a beat later
function rsTouched(full) {
  const d = rsCur(); if (!d) return;
  d.updated = Date.now();
  saveRostersLocal();
  clearTimeout(RS.saveT); RS.saveT = setTimeout(rsFlush, 1200); RS.dirty = d.id;
  rsListCard(d);
  if (full) rsRenderEdit(); else rsPoints();
}
function rsFlush() { clearTimeout(RS.saveT); if (RS.dirty) { const d = ROSTERS.find((r) => r.id === RS.dirty); RS.dirty = null; if (d && typeof Cloud !== 'undefined') Cloud.saveRoster(d); } }
function rsSyncText() {
  if (typeof Cloud === 'undefined' || Cloud.state === 'off') return 'Saved on this device';
  if (Cloud.user) return `Saved to your Google account (${Cloud.user.displayName || 'signed in'})`;
  return 'Saved on this device. Sign in with Google to keep your rosters everywhere.';
}
function rsBadge(d, cls = '') { return `<div class="badge ${cls}" style="background:${d.c1};color:${d.c2};border-color:${d.c2}">${esc(d.abbr)}</div>`; }
function rsListCard(d) {
  const el = $('rsList').querySelector(`[data-id="${d.id}"]`); if (!el) return;
  const t = buildCustomTeam(d);
  el.innerHTML = `${rsBadge(d, 'xs')}<div><b>${esc(d.city)} ${esc(d.name)}</b><span>BAT ${t.ovr.bat} · PIT ${t.ovr.pit} · DEF ${t.ovr.def}${t.cost > ROSTER_BUDGET ? ' · <em>OVER CAP</em>' : ''}</span></div>`;
}
function rsRenderList() {
  $('rsList').innerHTML = ROSTERS.length ? ROSTERS.map((d) => `<button class="rs-card ${d.id === RS.sel ? 'on' : ''}" data-id="${d.id}"></button>`).join('') : '<div class="rs-empty">No rosters yet. Start one from any club below.</div>';
  for (const d of ROSTERS) rsListCard(d);
  $('rsSync').textContent = rsSyncText();
  const keep = $('rsTemplate').value;
  $('rsTemplate').innerHTML = TEAMS.map((t) => `<option value="${t.key}">Start from the ${esc(t.city)} ${esc(t.name)}</option>`).join('');
  $('rsTemplate').value = keep || TEAMS[(Math.random() * TEAMS.length) | 0].key;
}
function rsPoints() {
  const d = rsCur(); if (!d) return;
  const used = rosterCost(d), left = ROSTER_BUDGET - used;
  $('rsPts').innerHTML = `<b>${used.toLocaleString()}</b> / ${ROSTER_BUDGET.toLocaleString()} points used &middot; <span class="${left < 0 ? 'over' : ''}">${left < 0 ? `${(-left).toLocaleString()} over the cap` : `${left.toLocaleString()} left`}</span>`;
  $('rsBar').style.width = clamp(used / ROSTER_BUDGET, 0, 1) * 100 + '%';
  $('rsBar').classList.toggle('over', left < 0);
  const b = $('rsEdit').querySelector('.rs-ident .badge'); if (b) b.outerHTML = rsBadge(d);
}
const clubTag = (id, pool) => { const P = id && pool.get(id); return P ? `<span class="rs-club">${esc(P.club)}</span>` : '<span class="rs-club custom">CUSTOM</span>'; };
const posWord = { C: 'catcher', '1B': 'first baseman', '2B': 'second baseman', '3B': 'third baseman', SS: 'shortstop', LF: 'left fielder', CF: 'center fielder', RF: 'right fielder', DH: 'designated hitter' };
function rsRenderEdit() {
  const d = rsCur(), el = $('rsEdit');
  if (!d) { el.innerHTML = '<div class="rs-empty big">Pick a roster on the left, or start a new one from any club.</div>'; return; }
  const r = resolveRoster(d);
  const hRows = d.order.map((pos, i) => {
    const h = r.hitters.find((x) => x.pos === pos), P = h.mlbId && POOL_H.get(h.mlbId);
    const off = P && pos !== 'DH' && !P.def[pos] ? '<span class="rs-off" title="He doesn\'t play here: his arm and glove take a hit">OUT OF POSITION</span>' : '';
    return `<tr data-h="${pos}"><td class="ord"><button data-mv="-1" title="Move up" ${i ? '' : 'disabled'}>&#9650;</button><b>${i + 1}</b><button data-mv="1" title="Move down" ${i < 8 ? '' : 'disabled'}>&#9660;</button></td>`
      + `<td class="pos">${pos}</td><td class="who"><b>${esc(h.name)}</b>${clubTag(h.mlbId, POOL_H)}${off}</td><td>${h.bats}</td>`
      + HIT_KEYS.map(([k]) => `<td class="rv ${h[k] >= 85 ? 'hi' : h[k] < 60 ? 'lo' : ''}">${h[k]}</td>`).join('')
      + `<td class="ovr">${hitterOvr(h, pos)}</td><td class="cost">${hitterCost(h)}</td><td><button class="ghost rs-swap" data-swap-h="${pos}">Change</button></td></tr>`;
  }).join('');
  const pRow = (p, i, list) => {
    const role = list === 'rotation' ? 'SP' + (i + 1) : i === 0 ? 'CL' : 'RP' + i, min = 1;
    if (!p) return `<tr class="rs-empty-row"><td class="pos">${role}</td><td class="who" colspan="9"><span class="rs-open">Open spot</span></td><td><button class="cta rs-swap" data-swap-${list === 'rotation' ? 's' : 'r'}="${i}">SIGN</button></td></tr>`;
    return `<tr><td class="pos">${role}</td><td class="who"><b>${esc(p.name)}</b>${clubTag(p.mlbId, POOL_P)}</td><td>${p.throws}</td>`
      + PIT_KEYS.map(([k]) => `<td class="rv">${p[k]}</td>`).join('')
      + `<td class="chips">${p.pitches.map((t, k) => `<span class="chip on" style="--pc:${PITCH_TYPES[t].col}" title="${PITCH_TYPES[t].name}">${PITCH_TYPES[t].short} ${(p.pv && p.pv[k]) || p.velo + PITCH_TYPES[t].d}</span>`).join('')}</td>`
      + `<td class="ovr">${pitcherOvr(p)}</td><td class="cost">${pitcherCost(p)}</td><td class="rs-btns"><button class="ghost rs-swap" data-swap-${list === 'rotation' ? 's' : 'r'}="${i}">Change</button>${r[list].length > min ? `<button class="ghost rs-x" data-drop="${list}" data-i="${i}" title="Release him">&times;</button>` : ''}</td></tr>`;
  };
  const slots = (list, n) => Array.from({ length: n }, (_, i) => r[list][i] || null);
  const rotRows = slots('rotation', ROSTER_SIZES.rotation).map((p, i) => pRow(p, i, 'rotation')).join('');
  const penRows = slots('bullpen', ROSTER_SIZES.bullpen).map((p, i) => pRow(p, i, 'bullpen')).join('');
  const benchRows = slots('bench', ROSTER_SIZES.bench).map((h, i) => {
    if (!h) return `<tr class="rs-empty-row"><td class="pos">BN</td><td class="who" colspan="10"><span class="rs-open">Open spot</span></td><td><button class="cta rs-swap" data-swap-b="${i}">SIGN</button></td></tr>`;
    const P = h.mlbId && POOL_H.get(h.mlbId), plays = P ? P.elig.join(' ') || 'DH' : h.pos;
    return `<tr><td class="pos">BN</td><td class="who"><b>${esc(h.name)}</b>${clubTag(h.mlbId, POOL_H)}<span class="rs-plays">${plays}</span></td><td>${h.bats}</td>`
      + HIT_KEYS.map(([k]) => `<td class="rv ${h[k] >= 85 ? 'hi' : h[k] < 60 ? 'lo' : ''}">${h[k]}</td>`).join('')
      + `<td class="ovr">${hitterOvr(h, h.pos)}</td><td class="cost">${hitterCost(h)}</td><td class="rs-btns"><button class="ghost rs-swap" data-swap-b="${i}">Change</button><button class="ghost rs-x" data-drop="bench" data-i="${i}" title="Release him">&times;</button></td></tr>`;
  }).join('');
  const pHead = `<thead><tr><th>ROLE</th><th>PLAYER</th><th title="Throws">T</th>${PIT_KEYS.map(([, l, tip]) => `<th title="${tip}">${l}</th>`).join('')}<th>PITCHES</th><th>OVR</th><th>PTS</th><th></th></tr></thead>`;
  el.innerHTML = `
    <div class="rs-ident">${rsBadge(d)}
      <label>City<input data-f="city" maxlength="18" value="${esc(d.city)}"></label>
      <label>Team name<input data-f="name" maxlength="18" value="${esc(d.name)}"></label>
      <label class="short">Abbr.<input data-f="abbr" maxlength="4" value="${esc(d.abbr)}"></label>
      <label class="short">Colors<span class="cols"><input type="color" data-f="c1" value="${d.c1}" aria-label="Primary color"><input type="color" data-f="c2" value="${d.c2}" aria-label="Secondary color"></span></label>
    </div>
    <div class="rs-points"><div class="rs-track"><i id="rsBar"></i></div><div id="rsPts"></div></div>
    <p class="rs-help">Sign real MLB players to every spot. Each one costs points from his ratings (a point a step above 40, two above 70, three above 85), and the whole roster has to fit under the ${ROSTER_BUDGET.toLocaleString()}-point cap, what the priciest real club costs. Click <b>Change</b> to swap anyone out, or <b>&times;</b> to release a bench player or pitcher and free up points. Hover a column for what it means.</p>
    <h3>LINEUP <small>batting order top to bottom</small></h3>
    <div class="rs-scroll"><table class="rs-table"><thead><tr><th>#</th><th>POS</th><th>PLAYER</th><th title="Bats">B</th>${HIT_KEYS.map(([, l, tip]) => `<th title="${tip}">${l}</th>`).join('')}<th>OVR</th><th>PTS</th><th></th></tr></thead><tbody>${hRows}</tbody></table></div>
    <h3>BENCH <small>pinch hitters, pinch runners and defensive subs, up to ${ROSTER_SIZES.bench}</small></h3>
    <div class="rs-scroll"><table class="rs-table"><thead><tr><th>POS</th><th>PLAYER</th><th title="Bats">B</th>${HIT_KEYS.map(([, l, tip]) => `<th title="${tip}">${l}</th>`).join('')}<th>OVR</th><th>PTS</th><th></th></tr></thead><tbody>${benchRows}</tbody></table></div>
    <h3>ROTATION <small>SP1 starts single games; a season rotates through all ${ROSTER_SIZES.rotation}</small></h3>
    <div class="rs-scroll"><table class="rs-table">${pHead}<tbody>${rotRows}</tbody></table></div>
    <h3>BULLPEN <small>the closer first, up to ${ROSTER_SIZES.bullpen} arms</small></h3>
    <div class="rs-scroll"><table class="rs-table">${pHead}<tbody>${penRows}</tbody></table></div>
    <div class="row-actions rs-actions"><button class="ghost" data-act="dup">Duplicate</button><button class="ghost danger" data-act="del">Delete roster</button></div>`;
  rsPoints();
}

// --------------------------------------------------------- player picker ----
// RS.pick = { kind: 'h' (lineup spot) | 'b' (bench) | 's' (rotation) | 'r' (bullpen), slot, q, only, club, sort,
//   cmp: up to three players to compare side by side with whoever has the spot now }
function rsOpenPick(kind, slot) {
  RS.pick = { kind, slot, q: '', only: kind !== 'b', club: '', sort: 'ovr', cmp: [] };
  const isH = kind === 'h' || kind === 'b', el = $('rsPick');
  const word = kind === 'h' ? posWord[slot] : kind === 'b' ? 'bench player' : kind === 's' ? 'starting pitcher' : +slot === 0 ? 'closer' : 'reliever';
  const onlyLabel = kind === 'h' ? (slot === 'DH' ? '' : `Only players who play ${slot}`) : kind === 'b' ? '' : kind === 's' ? 'Only starters' : 'Only relievers';
  const sorts = isH ? [['ovr', 'Best overall'], ['cost', 'Cheapest'], ['con', 'Contact'], ['pow', 'Power'], ['eye', 'Eye'], ['spd', 'Speed'], ['fld', 'Fielding']]
    : [['ovr', 'Best overall'], ['cost', 'Cheapest'], ['velo', 'Velocity'], ['ctl', 'Control'], ['stuff', 'Stuff'], ['stam', 'Stamina']];
  el.innerHTML = `<div class="rsp-card" role="dialog" aria-label="Sign a player">
    <div class="rsp-head"><h3>SIGN A ${word.toUpperCase()}</h3><span id="rspNow"></span><button class="ghost" data-pk="close">Close</button></div>
    <div class="rsp-filters"><input id="rspQ" placeholder="Search a player or team" autocomplete="off" spellcheck="false">
      ${onlyLabel ? `<label class="rsp-only"><input type="checkbox" id="rspOnly" checked> ${onlyLabel}</label>` : ''}
      <select id="rspClub" aria-label="Team"><option value="">All teams</option>${MLB_CLUBS.map((c) => `<option>${esc(c[0])}</option>`).join('')}</select>
      <select id="rspSort" aria-label="Sort">${sorts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
    <div class="rsp-cmp hidden" id="rspCmp"></div>
    <div class="rsp-list" id="rspList"></div></div>`;
  el.classList.remove('hidden');
  rsPickList();
  setTimeout(() => { const q = $('rspQ'); if (q) q.focus(); }, 0);
}
function rsClosePick() { RS.pick = null; $('rsPick').classList.add('hidden'); $('rsPick').innerHTML = ''; }
function rsPickList() {
  const P = RS.pick, d = rsCur(); if (!P || !d) return;
  const isH = P.kind === 'h' || P.kind === 'b', r = resolveRoster(d);
  const list0 = P.kind === 'h' ? null : P.kind === 'b' ? r.bench : P.kind === 's' ? r.rotation : r.bullpen;
  const cur = P.kind === 'h' ? r.hitters.find((h) => h.pos === P.slot) : list0[+P.slot] || null;
  const curCost = cur ? (isH ? hitterCost(cur) : pitcherCost(cur)) : 0, room = ROSTER_BUDGET - (rosterCost(d) - curCost);
  const others = isH ? [...r.hitters, ...r.bench] : [...r.rotation, ...r.bullpen];
  const taken = new Set(others.filter((x) => x !== cur).map((x) => x.mlbId).filter(Boolean));
  $('rspNow').innerHTML = `Now: <b>${cur ? esc(cur.name) : 'open spot'}</b> &middot; ${curCost} pts &middot; up to <b>${Math.max(0, room).toLocaleString()}</b> pts for this spot`;
  const q = P.q.trim().toLowerCase();
  let list = [];
  if (isH) {
    for (const h of POOL_H.values()) {
      if (P.kind === 'h' && P.only && P.slot !== 'DH' && !h.def[P.slot]) continue;
      if (P.club && h.club !== P.club) continue;
      if (q && !h.name.toLowerCase().includes(q) && h.club.toLowerCase() !== q) continue;
      const at = P.kind === 'h' ? P.slot : h.main, rr = hitterAt(h, at);
      list.push({ p: h, r: rr, ovr: hitterOvr(rr, at), cost: hitterCost(rr) });
    }
  } else {
    const want = P.kind === 's' ? 'SP' : 'RP';
    for (const p of POOL_P.values()) {
      if (P.only && p.role !== want) continue;
      if (P.club && p.club !== P.club) continue;
      if (q && !p.name.toLowerCase().includes(q) && p.club.toLowerCase() !== q) continue;
      list.push({ p, r: p, ovr: pitcherOvr(p), cost: pitcherCost(p) });
    }
  }
  const key = P.sort;
  list.sort((a, b) => (key === 'ovr' ? b.ovr - a.ovr : key === 'cost' ? a.cost - b.cost : b.r[key] - a.r[key]) || b.ovr - a.ovr);
  const total = list.length;
  list = list.slice(0, 150);
  const cols = isH ? HIT_KEYS.map(([k]) => k) : PIT_KEYS.map(([k]) => k);
  const head = `<tr><th></th><th>PLAYER</th><th>TEAM</th><th>${isH ? 'PLAYS' : 'ROLE'}</th>${(isH ? HIT_KEYS : PIT_KEYS).map(([, l, tip]) => `<th title="${tip}">${l}</th>`).join('')}${isH ? '' : '<th>PITCHES</th>'}<th>OVR</th><th>PTS</th><th>+/&minus;</th><th></th></tr>`;
  const rows = list.map(({ p, r: rr, ovr, cost }) => {
    const diff = cost - curCost, isCur = !!cur && cur.mlbId === p.id, onTeam = taken.has(p.id), over = cost > room;
    const why = isCur ? 'Signed' : onTeam ? 'On your team' : over ? 'Over the cap' : '';
    const plays = isH ? (p.elig.length ? p.elig.join(' ') : 'DH') : p.role;
    const on = P.cmp.includes(p.id);
    return `<tr class="${why ? 'no' : ''}${on ? ' cmp' : ''}"><td><label class="rsp-cmpbox" title="Compare"><input type="checkbox" data-cmp="${p.id}" ${on ? 'checked' : ''} ${!on && P.cmp.length >= 3 ? 'disabled' : ''}></label></td><td class="who"><b>${esc(p.name)}</b></td><td>${esc(p.club)}</td><td class="plays">${plays}</td>`
      + cols.map((k) => `<td class="rv ${rr[k] >= 85 && k !== 'velo' ? 'hi' : rr[k] < 60 && k !== 'velo' ? 'lo' : ''}">${rr[k]}</td>`).join('')
      + (isH ? '' : `<td class="chips">${p.pitches.map((x) => `<span class="chip on" style="--pc:${PITCH_TYPES[x.type].col}" title="${PITCH_TYPES[x.type].name}">${PITCH_TYPES[x.type].short}</span>`).join('')}</td>`)
      + `<td class="ovr">${ovr}</td><td class="cost">${cost}</td><td class="diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' + diff : diff}</td>`
      + `<td>${why ? `<span class="rsp-why">${why}</span>` : `<button class="cta rsp-sign" data-sign="${p.id}">SIGN</button>`}</td></tr>`;
  }).join('');
  rsCompare(isH, cur, curCost, room, taken);
  $('rspList').innerHTML = `<table class="rs-table rsp-table"><thead>${head}</thead><tbody>${rows || ''}</tbody></table>`
    + (total ? (total > list.length ? `<p class="rs-help">Showing the top ${list.length} of ${total}. Search or pick a team to narrow it down.</p>` : '') : '<p class="rs-help">Nobody matches. Try another search, or untick the position filter.</p>');
}
// side by side: whoever has the spot now and the players you ticked, the best of each rating lit up
function rsCompare(isH, cur, curCost, room, taken) {
  const P = RS.pick, el = $('rspCmp');
  if (!P.cmp.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const at = (h) => (P.kind === 'h' ? P.slot : h.main);
  const cols = [];
  if (cur) cols.push({ name: cur.name, r: isH ? cur : cur, ovr: isH ? hitterOvr(cur, cur.pos) : pitcherOvr(cur), cost: curCost, now: true, p: cur });
  for (const id of P.cmp) {
    const p = isH ? POOL_H.get(id) : POOL_P.get(id); if (!p) continue;
    const r = isH ? hitterAt(p, at(p)) : p;
    cols.push({ name: p.name, club: p.club, r, ovr: isH ? hitterOvr(r, at(p)) : pitcherOvr(p), cost: isH ? hitterCost(r) : pitcherCost(p), id, p, plays: isH ? (p.elig.join(' ') || 'DH') : p.role });
  }
  const keys = isH ? HIT_KEYS : PIT_KEYS;
  const best = (k) => Math.max(...cols.map((c) => c.r[k] ?? 0));
  const bar = (v, hi) => `<div class="cmp-bar"><i style="width:${clamp(((v ?? 0) - 30) / 70, 0, 1) * 100}%"></i><b class="${hi ? 'hi' : ''}">${v ?? '&ndash;'}</b></div>`;
  const rows = keys.map(([k, l]) => `<tr><th>${l}</th>${cols.map((c) => `<td>${bar(c.r[k], cols.length > 1 && c.r[k] === best(k))}</td>`).join('')}</tr>`).join('');
  const head = cols.map((c) => `<th><b>${esc(c.name)}</b><small>${c.now ? 'HAS THE SPOT' : `${esc(c.club)} &middot; ${esc(c.plays)}`}</small>${c.now ? '' : `<button class="ghost fr-mini" data-uncmp="${c.id}" title="Remove">&times;</button>`}</th>`).join('');
  const foot = cols.map((c) => {
    const why = c.now ? '' : taken.has(c.id) ? 'On your team' : c.cost > room ? 'Over the cap' : '';
    return `<td><div class="cmp-ovr">${c.ovr}<small>OVR</small></div><div class="cmp-pts">${c.cost} pts${c.now ? '' : ` <span class="${c.cost - curCost > 0 ? 'up' : 'down'}">(${c.cost - curCost > 0 ? '+' : ''}${c.cost - curCost})</span>`}</div>${c.now ? '' : why ? `<span class="rsp-why">${why}</span>` : `<button class="cta rsp-sign" data-sign="${c.id}">SIGN</button>`}</td>`;
  }).join('');
  el.innerHTML = `<table class="cmp-table"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}<tr class="cmp-foot"><th></th>${foot}</tr></tbody></table>`;
  el.classList.remove('hidden');
}
function rsSign(id) {
  const P = RS.pick, d = rsCur(); if (!P || !d) return;
  if (P.kind === 'h') {
    const h = POOL_H.get(id); if (!h) return;
    const i = d.hitters.findIndex((x) => x.pos === P.slot);
    d.hitters[i] = hitterSnap(h, P.slot);
  } else if (P.kind === 'b') {
    const h = POOL_H.get(id); if (!h) return;
    const i = Math.min(+P.slot, d.bench.length);
    d.bench[i] = hitterSnap(h, h.main);
  } else {
    const p = POOL_P.get(id); if (!p) return;
    const list = P.kind === 's' ? d.rotation : d.bullpen, i = Math.min(+P.slot, list.length);
    list[i] = pitcherSnap(p);
  }
  rsClosePick();
  SND.init(); if (SND.ctx) SND.tick();
  rsTouched(true);
}
function buildRosterUI() {
  $('rsClose').addEventListener('click', closeRosters);
  $('rsNew').addEventListener('click', () => {
    const src = TEAMS.find((t) => t.key === $('rsTemplate').value) || TEAMS[0];
    const d = teamToDef(src);
    d.name = src.name + ' II'; d.abbr = (src.id.slice(0, 3) + '2');
    ROSTERS.push(d); RS.sel = d.id; RS.dirty = d.id; saveRostersLocal(); rsFlush();
    rsRenderList(); rsRenderEdit();
  });
  $('rsList').addEventListener('click', (e) => { const b = e.target.closest('.rs-card'); if (!b) return; rsFlush(); RS.sel = b.dataset.id; rsRenderList(); rsRenderEdit(); });
  const ed = $('rsEdit');
  const onEdit = (e, commit) => {
    const d = rsCur(), t = e.target; if (!d || !t.dataset || !t.dataset.f) return;
    const f = t.dataset.f;
    if (f === 'c1' || f === 'c2') d[f] = t.value;
    else if (commit || f !== 'abbr') d[f] = t.value;
    if (commit) { const c = cleanRoster(d); d.city = c.city; d.name = c.name; d.abbr = c.abbr; if (t.value !== d[f]) t.value = d[f]; }
    rsTouched();
  };
  ed.addEventListener('input', (e) => onEdit(e, false));
  ed.addEventListener('change', (e) => onEdit(e, true));
  ed.addEventListener('click', (e) => {
    const d = rsCur(); if (!d) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mv) {
      const pos = b.closest('tr').dataset.h, i = d.order.indexOf(pos), j = i + +b.dataset.mv;
      if (j < 0 || j > 8) return;
      [d.order[i], d.order[j]] = [d.order[j], d.order[i]]; rsTouched(true); return;
    }
    if (b.dataset.swapH) { rsOpenPick('h', b.dataset.swapH); return; }
    if (b.dataset.swapB != null) { rsOpenPick('b', b.dataset.swapB); return; }
    if (b.dataset.swapS != null) { rsOpenPick('s', b.dataset.swapS); return; }
    if (b.dataset.swapR != null) { rsOpenPick('r', b.dataset.swapR); return; }
    if (b.dataset.drop) {
      const list = d[b.dataset.drop];
      if (list && (b.dataset.drop === 'bench' || list.length > 1)) { list.splice(+b.dataset.i, 1); rsTouched(true); }
      return;
    }
    const act = b.dataset.act;
    if (act === 'dup') { const c = cleanRoster({ ...JSON.parse(JSON.stringify(d)), id: 'X' + randId(), name: d.name + ' 2', updated: Date.now() }); ROSTERS.push(c); RS.sel = c.id; RS.dirty = c.id; saveRostersLocal(); rsFlush(); rsRenderList(); rsRenderEdit(); }
    else if (act === 'del') {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Click again to delete'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Delete roster'; }, 3000); return; }
      ROSTERS = ROSTERS.filter((r) => r.id !== d.id); saveRostersLocal();
      if (typeof Cloud !== 'undefined') Cloud.deleteRoster(d.id);
      RS.sel = ROSTERS.length ? ROSTERS[0].id : null; rsRenderList(); rsRenderEdit();
    }
  });
  // the picker
  const pk = $('rsPick');
  pk.addEventListener('click', (e) => {
    if (e.target === pk) { rsClosePick(); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pk === 'close') rsClosePick();
    else if (b.dataset.sign) rsSign(+b.dataset.sign);
    else if (b.dataset.uncmp && RS.pick) { RS.pick.cmp = RS.pick.cmp.filter((x) => x !== +b.dataset.uncmp); rsPickList(); }
  });
  pk.addEventListener('input', (e) => { if (!RS.pick) return; if (e.target.id === 'rspQ') { RS.pick.q = e.target.value; rsPickList(); } });
  pk.addEventListener('change', (e) => {
    if (!RS.pick) return;
    const t = e.target;
    if (t.dataset && t.dataset.cmp) {
      const id = +t.dataset.cmp, c = RS.pick.cmp;
      RS.pick.cmp = t.checked ? (c.includes(id) || c.length >= 3 ? c : [...c, id]) : c.filter((x) => x !== id);
    } else if (t.id === 'rspOnly') RS.pick.only = t.checked;
    else if (t.id === 'rspClub') RS.pick.club = t.value;
    else if (t.id === 'rspSort') RS.pick.sort = t.value;
    else return;
    rsPickList();
  });
}
// cloud rosters arrived after sign-in: keep the newest copy of each, upload the ones only this device has
function mergeRosters(list) {
  const up = [];
  for (const raw of list) {
    const c = cleanRoster(raw); if (!c) continue;
    const i = ROSTERS.findIndex((r) => r.id === c.id);
    if (i < 0) ROSTERS.push(c); else if (c.updated > ROSTERS[i].updated) ROSTERS[i] = c;
  }
  for (const r of ROSTERS) if (!list.some((x) => x && x.id === r.id && +x.updated >= r.updated)) up.push(r);
  saveRostersLocal();
  if (!$('rosterScreen').classList.contains('hidden')) { rsRenderList(); rsRenderEdit(); }
  renderMenu();
  return up;
}
