// ============================================================================
// Custom rosters: build your own team on a point budget. Rosters are saved on
// this device, and to your Google account when you're signed in (67-cloud.js).
// A roster is plain data (a "def"); buildCustomTeam turns it into the same team
// shape as the built-in clubs (14-teams.js), so the rest of the game can't tell the difference.
// ============================================================================

const RATING_MIN = 40, RATING_MAX = 99, VELO_MIN = 86, VELO_MAX = 100;
const HIT_KEYS = [
  ['con', 'CON', 'Contact: a bigger PCI and squarer contact'],
  ['pow', 'POW', 'Power: exit velocity off the bat'],
  ['eye', 'EYE', 'Eye: lays off pitches outside the zone'],
  ['spd', 'SPD', 'Speed: on the bases and in the field'],
  ['arm', 'ARM', 'Arm: throw speed and accuracy'],
  ['fld', 'FLD', 'Fielding: fewer errors, better dives'],
];
const PIT_KEYS = [
  ['velo', 'VELO', 'Fastball velocity in mph'],
  ['ctl', 'CTL', 'Control: how close he hits his spot'],
  ['stuff', 'STF', 'Stuff: how much his pitches move'],
  ['stam', 'STA', 'Stamina: pitches before he tires'],
];
const PITCH_MAX = [5, 4, 4, 4];   // the starter can carry five pitches, relievers four
// Every rating starts at 40 for free. Each point above that costs 1, points above 70 cost 2
// and points above 85 cost 3, so stars are expensive. The budget is about what the
// built-in teams are worth, so a balanced custom team plays like an average club.
const ROSTER_BUDGET = 3100;
function ratingCost(v) { v = clamp(Math.round(v), RATING_MIN, RATING_MAX); return v - RATING_MIN + Math.max(0, v - 70) + Math.max(0, v - 85); }
const veloRating = (mph) => RATING_MIN + ((mph - VELO_MIN) * (RATING_MAX - RATING_MIN)) / (VELO_MAX - VELO_MIN);
const stuffToBrk = (s) => 0.8 + ((s - RATING_MIN) / (RATING_MAX - RATING_MIN)) * 0.45;
function hitterCost(h) { return HIT_KEYS.reduce((s, [k]) => s + ratingCost(h[k]), 0); }
function pitcherCost(p) { return ratingCost(veloRating(p.velo)) + ratingCost(p.ctl) + ratingCost(p.stuff) + ratingCost(p.stam); }
function rosterCost(d) { return d.hitters.reduce((s, h) => s + hitterCost(h), 0) + d.pitchers.reduce((s, p) => s + pitcherCost(p), 0); }
function hitterOvr(h) { return Math.round((h.con * 1.2 + h.pow * 1.2 + h.eye * 0.8 + h.spd * 0.6 + h.arm * 0.5 + h.fld * 0.7) / 5); }
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
  const d = {
    v: 1, id: /^X[a-z0-9]{4,16}$/i.test(r.id) ? r.id : 'X' + randId(), updated: Number.isFinite(+r.updated) ? +r.updated : Date.now(),
    city: str(r.city, 18, 'Hometown'), name: str(r.name, 18, 'Sluggers'),
    abbr: String(r.abbr || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'CUS',
    c1: hex(r.c1, '#2b4c7e'), c2: hex(r.c2, '#f2c14e'), hitters: [], order: [], pitchers: [],
  };
  if (d.abbr.length < 2) d.abbr = (d.abbr + 'X').slice(0, 2);
  const src = Array.isArray(r.hitters) ? r.hitters : [];
  POS_LIST.forEach((pos, i) => {
    const h = src.find((x) => x && x.pos === pos) || {};
    const o = { pos, name: str(h.name, 24, `${pos} Player`), num: no(h.num, i + 1), bats: hand(h.bats, ['R', 'L', 'S'], 'R'), throws: hand(h.throws, ['R', 'L'], 'R'), skin: skin(h.skin) };
    for (const [k] of HIT_KEYS) o[k] = rat(h[k]);
    d.hitters.push(o);
  });
  const seen = new Set();
  for (const p of Array.isArray(r.order) ? r.order : []) if (POS_LIST.includes(p) && !seen.has(p)) { seen.add(p); d.order.push(p); }
  for (const p of POS_LIST) if (!seen.has(p)) d.order.push(p);
  const ps = Array.isArray(r.pitchers) ? r.pitchers : [];
  for (let i = 0; i < 4; i++) {
    const p = ps[i] || {};
    let pitches = [];
    for (const t of Array.isArray(p.pitches) ? p.pitches : []) if (PITCH_TYPES[t] && !pitches.includes(t)) pitches.push(t);
    pitches = pitches.slice(0, PITCH_MAX[i]);
    for (const t of ['FF', 'SL', 'CH']) if (pitches.length < 2 && !pitches.includes(t)) pitches.push(t);
    d.pitchers.push({
      name: str(p.name, 24, i ? `Reliever ${i}` : 'Starter'), num: no(p.num, 40 + i), throws: hand(p.throws, ['R', 'L'], 'R'), skin: skin(p.skin),
      velo: clamp(Math.round(Number.isFinite(+p.velo) ? +p.velo : 93), VELO_MIN, VELO_MAX), ctl: rat(p.ctl), stuff: rat(p.stuff), stam: rat(p.stam, i ? 45 : 85), pitches,
    });
  }
  return d;
}
function randomName(used) { for (;;) { const n = pick(FIRST) + ' ' + pick(LAST); if (!used.has(n)) { used.add(n); return n; } } }
function newRoster() {
  const used = new Set(), nums = [...Array(78).keys()].map((i) => i + 1).sort(() => Math.random() - 0.5);
  return cleanRoster({
    id: 'X' + randId(), updated: Date.now(), city: 'Hometown', name: 'Sluggers', abbr: 'HMT', c1: '#2b4c7e', c2: '#f2c14e',
    hitters: POS_LIST.map((pos, i) => ({ pos, name: randomName(used), num: nums[i], bats: Math.random() < 0.3 ? 'L' : 'R', throws: 'R', skin: pick(SKINS), con: 60, pow: 60, eye: 60, spd: 60, arm: 60, fld: 60 })),
    pitchers: [0, 1, 2, 3].map((i) => ({ name: randomName(used), num: nums[9 + i], throws: Math.random() < 0.3 ? 'L' : 'R', skin: pick(SKINS), velo: 93, ctl: 60, stuff: 60, stam: i ? 45 : 85, pitches: i ? ['FF', 'SL', 'CH'] : ['FF', 'SL', 'CU', 'CH'] })),
  });
}
// a built-in team as a roster: a template to start from, and how mirror matchups work online
function teamToDef(t, id) {
  return cleanRoster({
    id: id || 'X' + randId(), updated: Date.now(), city: t.city, name: t.name, abbr: t.id, c1: t.c1, c2: t.c2,
    hitters: t.hitters.map((h) => ({ ...h, team: undefined })), order: t.lineup.map((h) => h.pos),
    pitchers: t.pitchers.map((p) => ({ name: p.name, num: p.num, throws: p.throws, skin: p.skin, velo: p.velo, ctl: p.ctl, stam: p.stam, pitches: p.pitches.map((x) => x.type),
      stuff: Math.round(RATING_MIN + ((p.pitches.reduce((s, x) => s + x.brk, 0) / p.pitches.length - 0.8) / 0.45) * (RATING_MAX - RATING_MIN)) })),
  });
}
const _teamCache = new Map();
function buildCustomTeam(def) {
  const d = cleanRoster(def), sig = JSON.stringify(d);
  if (_teamCache.has(sig)) return _teamCache.get(sig);
  const team = { id: d.abbr, key: 'X:' + d.id, ver: String(d.updated), city: d.city, name: d.name, c1: d.c1, c2: d.c2, custom: true, roster: d, hitters: [], pitchers: [] };
  const pid = (s) => d.id + '-' + s;
  for (const h of d.hitters) {
    const o = { id: pid(h.pos), name: h.name, num: h.num, pos: h.pos, bats: h.bats, throws: h.throws, skin: h.skin, team };
    for (const [k] of HIT_KEYS) o[k] = h[k];
    team.hitters.push(o);
  }
  team.lineup = d.order.map((pos) => team.hitters.find((h) => h.pos === pos));
  d.pitchers.forEach((p, i) => {
    const brk = stuffToBrk(p.stuff);
    team.pitchers.push({
      id: pid('P' + i), name: p.name, num: p.num, pos: i ? 'RP' : 'SP', throws: p.throws, bats: p.throws, skin: p.skin, team,
      velo: p.velo, ctl: p.ctl, stam: p.stam, spd: 45, arm: 72, fld: 62, con: 22, pow: 15, eye: 25,
      pitches: p.pitches.map((t) => ({ type: t, velo: p.velo + PITCH_TYPES[t].d, brk })),
    });
  });
  team.ovr = teamOvr(team);
  team.cost = rosterCost(d);
  _teamCache.set(sig, team);
  return team;
}

// ---------------------------------------------------------- my rosters ----
let ROSTERS = [];
try { ROSTERS = (JSON.parse(localStorage.getItem('fullcount.rosters') || '[]') || []).map(cleanRoster).filter(Boolean); } catch (e) { ROSTERS = []; }
function saveRostersLocal() { try { localStorage.setItem('fullcount.rosters', JSON.stringify(ROSTERS)); } catch (e) { /* storage full or blocked */ } }
// every team you can pick: the eight built-in clubs, then your rosters
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
const RS = { sel: null, saveT: 0 };
function rsCur() { return ROSTERS.find((r) => r.id === RS.sel) || null; }
function openRosters() {
  if (!RS.sel || !rsCur()) RS.sel = ROSTERS.length ? ROSTERS[0].id : null;
  $('rosterScreen').classList.remove('hidden');
  rsRenderList(); rsRenderEdit();
}
function closeRosters() { rsFlush(); $('rosterScreen').classList.add('hidden'); renderMenu(); }
// persist soon after an edit: locally right away, to the cloud a beat later
function rsTouched(full) {
  const d = rsCur(); if (!d) return;
  d.updated = Date.now();
  saveRostersLocal();
  clearTimeout(RS.saveT); RS.saveT = setTimeout(rsFlush, 1200); RS.dirty = d.id;
  rsPoints(); rsListCard(d);
  if (full) rsRenderEdit();
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
  el.innerHTML = `${rsBadge(d, 'xs')}<div><b>${esc(d.city)} ${esc(d.name)}</b><span>BAT ${t.ovr.bat} · PIT ${t.ovr.pit} · DEF ${t.ovr.def}</span></div>`;
}
function rsRenderList() {
  $('rsList').innerHTML = ROSTERS.length ? ROSTERS.map((d) => `<button class="rs-card ${d.id === RS.sel ? 'on' : ''}" data-id="${d.id}"></button>`).join('') : '<div class="rs-empty">No rosters yet. Make one!</div>';
  for (const d of ROSTERS) rsListCard(d);
  $('rsSync').textContent = rsSyncText();
  $('rsTemplate').innerHTML = '<option value="">Blank roster (all 60s)</option>' + TEAMS.map((t) => `<option value="${t.key}">Copy the ${esc(t.city)} ${esc(t.name)}</option>`).join('');
}
function rsPoints() {
  const d = rsCur(); if (!d) return;
  const used = rosterCost(d), left = ROSTER_BUDGET - used;
  $('rsPts').innerHTML = `<b>${used.toLocaleString()}</b> / ${ROSTER_BUDGET.toLocaleString()} points used &middot; <span class="${left < 0 ? 'over' : ''}">${left < 0 ? `${(-left).toLocaleString()} over the cap` : `${left.toLocaleString()} left`}</span>`;
  $('rsBar').style.width = clamp(used / ROSTER_BUDGET, 0, 1) * 100 + '%';
  $('rsBar').classList.toggle('over', left < 0);
  for (const tr of $('rsEdit').querySelectorAll('tr[data-h]')) { const h = d.hitters.find((x) => x.pos === tr.dataset.h); tr.querySelector('.ovr').textContent = hitterOvr(h); tr.querySelector('.cost').textContent = hitterCost(h); }
  for (const tr of $('rsEdit').querySelectorAll('tr[data-p]')) { const p = d.pitchers[+tr.dataset.p]; tr.querySelector('.ovr').textContent = pitcherOvr(p); tr.querySelector('.cost').textContent = pitcherCost(p); }
  const b = $('rsEdit').querySelector('.rs-ident .badge'); if (b) b.outerHTML = rsBadge(d);
}
function rsRenderEdit() {
  const d = rsCur(), el = $('rsEdit');
  if (!d) { el.innerHTML = '<div class="rs-empty big">Pick a roster on the left, or make a new one.</div>'; return; }
  const sel = (k, v, opts) => `<select data-k="${k}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  const numIn = (k, v, lo = RATING_MIN, hi = RATING_MAX) => `<input type="number" class="rt" data-k="${k}" min="${lo}" max="${hi}" value="${v}">`;
  const hRows = d.order.map((pos, i) => {
    const h = d.hitters.find((x) => x.pos === pos);
    return `<tr data-h="${pos}"><td class="ord"><button data-mv="-1" title="Move up" ${i ? '' : 'disabled'}>&#9650;</button><b>${i + 1}</b><button data-mv="1" title="Move down" ${i < 8 ? '' : 'disabled'}>&#9660;</button></td>`
      + `<td class="pos">${pos}</td><td><input class="nm" data-k="name" maxlength="24" value="${esc(h.name)}"></td><td><input type="number" class="no" data-k="num" min="0" max="99" value="${h.num}"></td>`
      + `<td>${sel('bats', h.bats, ['R', 'L', 'S'])}</td><td>${sel('throws', h.throws, ['R', 'L'])}</td>`
      + HIT_KEYS.map(([k]) => `<td>${numIn(k, h[k])}</td>`).join('') + `<td class="ovr"></td><td class="cost"></td></tr>`;
  }).join('');
  const pRows = d.pitchers.map((p, i) => `<tr data-p="${i}"><td class="pos">${i ? 'RP' + i : 'SP'}</td><td><input class="nm" data-k="name" maxlength="24" value="${esc(p.name)}"></td><td><input type="number" class="no" data-k="num" min="0" max="99" value="${p.num}"></td><td>${sel('throws', p.throws, ['R', 'L'])}</td>`
    + PIT_KEYS.map(([k]) => `<td>${k === 'velo' ? numIn(k, p.velo, VELO_MIN, VELO_MAX) : numIn(k, p[k])}</td>`).join('')
    + `<td class="chips">${Object.keys(PITCH_TYPES).map((t) => `<button class="chip ${p.pitches.includes(t) ? 'on' : ''}" data-pitch="${t}" title="${PITCH_TYPES[t].name}" style="--pc:${PITCH_TYPES[t].col}">${PITCH_TYPES[t].short}</button>`).join('')}</td><td class="ovr"></td><td class="cost"></td></tr>`).join('');
  el.innerHTML = `
    <div class="rs-ident">${rsBadge(d)}
      <label>City<input data-f="city" maxlength="18" value="${esc(d.city)}"></label>
      <label>Team name<input data-f="name" maxlength="18" value="${esc(d.name)}"></label>
      <label class="short">Abbr.<input data-f="abbr" maxlength="4" value="${esc(d.abbr)}"></label>
      <label class="short">Colors<span class="cols"><input type="color" data-f="c1" value="${d.c1}" aria-label="Primary color"><input type="color" data-f="c2" value="${d.c2}" aria-label="Secondary color"></span></label>
    </div>
    <div class="rs-points"><div class="rs-track"><i id="rsBar"></i></div><div id="rsPts"></div></div>
    <p class="rs-help">Every rating starts at 40. Raising one costs 1 point a step, 2 above 70 and 3 above 85. Spend your ${ROSTER_BUDGET.toLocaleString()} points however you like: a lineup of stars and a weak bullpen, or a team with no holes. Hover a column for what it does.</p>
    <h3>LINEUP <small>batting order top to bottom</small></h3>
    <div class="rs-scroll"><table class="rs-table"><thead><tr><th>#</th><th>POS</th><th>NAME</th><th>NO.</th><th title="Bats">B</th><th title="Throws">T</th>${HIT_KEYS.map(([, l, tip]) => `<th title="${tip}">${l}</th>`).join('')}<th>OVR</th><th>PTS</th></tr></thead><tbody>${hRows}</tbody></table></div>
    <h3>PITCHING STAFF <small>pick 2&ndash;${PITCH_MAX[0]} pitches for the starter, 2&ndash;${PITCH_MAX[1]} for relievers</small></h3>
    <div class="rs-scroll"><table class="rs-table"><thead><tr><th>ROLE</th><th>NAME</th><th>NO.</th><th title="Throws">T</th>${PIT_KEYS.map(([, l, tip]) => `<th title="${tip}">${l}</th>`).join('')}<th>PITCHES</th><th>OVR</th><th>PTS</th></tr></thead><tbody>${pRows}</tbody></table></div>
    <div class="row-actions rs-actions"><button class="ghost" data-act="names">Random names</button><button class="ghost" data-act="even">Spend points evenly</button><button class="ghost" data-act="reset">Reset ratings to 60</button><button class="ghost" data-act="dup">Duplicate</button><button class="ghost danger" data-act="del">Delete roster</button></div>`;
  rsPoints();
}
// raise or lower a rating, but never past the point cap
function rsSetRating(obj, k, v, isVelo) {
  const d = rsCur(), lo = isVelo ? VELO_MIN : RATING_MIN, hi = isVelo ? VELO_MAX : RATING_MAX;
  v = clamp(Math.round(v), lo, hi);
  const old = obj[k];
  obj[k] = v;
  while (obj[k] > old && rosterCost(d) > ROSTER_BUDGET) obj[k]--;
  return obj[k];
}
// spread whatever is left over the whole roster, one point at a time, cheapest ratings first
function rsSpendEvenly(d) {
  const slots = [];
  for (const h of d.hitters) for (const [k] of HIT_KEYS) slots.push([h, k, RATING_MAX]);
  for (const p of d.pitchers) for (const k of ['ctl', 'stuff', 'stam']) slots.push([p, k, RATING_MAX]);
  for (let guard = 0; guard < 6000; guard++) {
    let best = null;
    for (const s of slots) if (s[0][s[1]] < s[2] && (!best || s[0][s[1]] < best[0][best[1]])) best = s;
    if (!best) break;
    best[0][best[1]]++;
    if (rosterCost(d) > ROSTER_BUDGET) { best[0][best[1]]--; break; }
  }
}
function buildRosterUI() {
  $('rsClose').addEventListener('click', closeRosters);
  $('rsNew').addEventListener('click', () => {
    const tk = $('rsTemplate').value, src = tk ? TEAMS.find((t) => t.key === tk) : null;
    const d = src ? teamToDef(src) : newRoster();
    if (src) { d.city = src.city; d.name = src.name + ' II'; }
    ROSTERS.push(d); RS.sel = d.id; RS.dirty = d.id; saveRostersLocal(); rsFlush();
    rsRenderList(); rsRenderEdit();
  });
  $('rsList').addEventListener('click', (e) => { const b = e.target.closest('.rs-card'); if (!b) return; rsFlush(); RS.sel = b.dataset.id; rsRenderList(); rsRenderEdit(); });
  const ed = $('rsEdit');
  const onEdit = (e, commit) => {
    const d = rsCur(), t = e.target; if (!d || !t.dataset) return;
    if (t.dataset.f) {
      const f = t.dataset.f;
      if (f === 'c1' || f === 'c2') d[f] = t.value;
      else if (commit || f !== 'abbr') d[f] = t.value;
      if (commit) { const c = cleanRoster(d); d.city = c.city; d.name = c.name; d.abbr = c.abbr; if (t.value !== d[f]) t.value = d[f]; }
      rsTouched(); return;
    }
    const k = t.dataset.k; if (!k) return;
    const tr = t.closest('tr'), obj = tr.dataset.h ? d.hitters.find((x) => x.pos === tr.dataset.h) : d.pitchers[+tr.dataset.p];
    if (k === 'name') { obj.name = t.value.replace(/[<>]/g, '').slice(0, 24); if (commit) { obj.name = obj.name.trim() || obj.name; } rsTouched(); return; }
    if (t.tagName === 'SELECT') { obj[k] = t.value; rsTouched(); return; }
    if (t.value === '' || !Number.isFinite(+t.value)) return;
    if (k === 'num') { obj.num = clamp(Math.round(+t.value), 0, 99); if (commit) t.value = obj.num; rsTouched(); return; }
    const isVelo = k === 'velo', lo = isVelo ? VELO_MIN : RATING_MIN;
    if (!commit && +t.value < lo) return;   // still typing
    const got = rsSetRating(obj, k, +t.value, isVelo);
    if (commit || got !== +t.value) t.value = got;
    if (got < +t.value) { $('rsBar').parentElement.classList.remove('flash'); void $('rsBar').offsetWidth; $('rsBar').parentElement.classList.add('flash'); }
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
    if (b.dataset.pitch) {
      const i = +b.closest('tr').dataset.p, p = d.pitchers[i], t = b.dataset.pitch;
      if (p.pitches.includes(t)) { if (p.pitches.length > 2) p.pitches = p.pitches.filter((x) => x !== t); }
      else if (p.pitches.length < PITCH_MAX[i]) p.pitches.push(t);
      for (const c of b.parentElement.querySelectorAll('.chip')) c.classList.toggle('on', p.pitches.includes(c.dataset.pitch));
      rsTouched(); return;
    }
    const act = b.dataset.act;
    if (act === 'names') { const used = new Set(); for (const x of [...d.hitters, ...d.pitchers]) x.name = randomName(used); rsTouched(true); }
    else if (act === 'reset') { for (const h of d.hitters) for (const [k] of HIT_KEYS) h[k] = 60; for (const p of d.pitchers) { p.ctl = 60; p.stuff = 60; p.velo = 93; } rsTouched(true); }
    else if (act === 'even') { rsSpendEvenly(d); rsTouched(true); }
    else if (act === 'dup') { const c = cleanRoster({ ...JSON.parse(JSON.stringify(d)), id: 'X' + randId(), name: d.name + ' 2', updated: Date.now() }); ROSTERS.push(c); RS.sel = c.id; RS.dirty = c.id; saveRostersLocal(); rsFlush(); rsRenderList(); rsRenderEdit(); }
    else if (act === 'del') {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Click again to delete'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Delete roster'; }, 3000); return; }
      ROSTERS = ROSTERS.filter((r) => r.id !== d.id); saveRostersLocal();
      if (typeof Cloud !== 'undefined') Cloud.deleteRoster(d.id);
      RS.sel = ROSTERS.length ? ROSTERS[0].id : null; rsRenderList(); rsRenderEdit();
    }
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
