// ============================================================================
// Records: pitcher decisions, the box score, saving and resuming a game, and the
// stats that build up across your games (kept on this device, and in your Google
// account when you're signed in). A finished game is kept as a compact record:
//   bat[team] rows: [key, name, pos, pa, ab, r, h, 2b, 3b, hr, rbi, bb, k, sb, cs, sub]
//   pit[team] rows: [key, name, outs, h, r, bb, k, hr, pitches, decision]
// key is the player's MLB id, so his numbers add up whichever team he plays for.
// ============================================================================

// ------------------------------------------------------------ decisions ----
// Whoever was pitching for a team when it took the lead for good gets the win; the pitcher
// who gave that lead up takes the loss. A reliever who finishes the win after coming in
// with a lead of three runs or less gets the save.
function noteLead(bi, before) {
  const was = before[bi] - before[1 - bi], now = G.score[bi] - G.score[1 - bi];
  if (was <= 0 && now > 0) G.dec = { team: bi, w: G.pitcher[bi], l: curPitcher() };
}
function decisions() {
  if (G.decIds) return G.decIds;   // an online guest gets them from the host
  const d = G.dec, out = {};
  if (!d || !d.w || !d.l) return out;
  out[d.w.id] = 'W'; out[d.l.id] = 'L';
  const fin = G.pitcher[d.team], lead = G.enterLead[fin.id];
  if (fin !== d.w && lead >= 1 && lead <= 3 && (pstat(fin).outs || 0) > 0) out[fin.id] = 'S';
  return out;
}

// ---------------------------------------------------------- game records ----
const statKey = (pl) => String(pl.mlbId || pl.id);
function gameRecord() {
  const dec = G.phase === 'final' ? decisions() : {};
  const bat = [0, 1].map((ti) => (G.played[ti] || []).map(({ pl, pos, for: f }) => {
    const s = G.stats.get(pl.id) || {};
    return [statKey(pl), pl.name, pos, s.pa | 0, s.ab | 0, s.r | 0, s.h | 0, s.d | 0, s.t | 0, s.hr | 0, s.rbi | 0, s.bb | 0, s.k | 0, s.sb | 0, s.cs | 0, f ? 1 : 0];
  }));
  const pit = [0, 1].map((ti) => (G.pitched[ti] || []).map((p) => {
    const s = G.pstats.get(p.id) || {};
    return [statKey(p), p.name, s.outs | 0, s.h | 0, s.r | 0, s.bb | 0, s.k | 0, s.hr | 0, s.pc | 0, dec[p.id] || '', s.er ?? s.r ?? 0];
  }));
  const lockPl = G.lock && PBYID[G.lock];
  return {
    v: 1, id: G.gameId, at: Date.now(), mode: G.mode, park: G.parkKey, innings: G.innings, inn: G.inning, half: G.half, done: G.phase === 'final',
    teams: G.teams.map((t) => ({ key: t.key, id: t.id, city: t.city, name: t.name, c1: t.c1, c2: t.c2 })),
    score: G.score.slice(), line: G.line.map((l) => l.slice()), hits: G.hits.slice(), errs: G.errs.slice(), bat, pit, you: mySide(),
    season: G.season ? G.season.id : null,
    lock: lockPl ? statKey(lockPl) : null,   // Player Lock: your numbers are his
    opp: G.mode === 'online' && !G.coop && NET.role !== 'spec' ? (NET.opp ? { uid: NET.opp.uid, name: NET.opp.name } : { uid: '', name: '' }) : null,
    coop: G.coop ? { with: NET.opp ? NET.opp.name : '' } : null,
  };
}
const RECORD_MODES = ['exhibition', 'lock', 'online', 'season'];
// a finished game goes into your records (and your account)
function recordGame() {
  if (!RECORD_MODES.includes(G.mode) || G.drill || !G.played || G.recorded === G.gameId) return null;
  G.recorded = G.gameId;
  const rec = gameRecord();
  const all = gamesList().filter((g) => g.id !== rec.id);
  all.push(rec);
  saveGames(all);
  if (typeof Cloud !== 'undefined') Cloud.saveGameRec(rec);
  return rec;
}
const GAMES_KEY = 'fullcount.games';
let _games = null;
function gamesList() {
  if (!_games) { try { _games = JSON.parse(localStorage.getItem(GAMES_KEY) || '[]').filter(gameOK); } catch (e) { _games = []; } }
  return _games;
}
function saveGames(list) {
  list.sort((a, b) => a.at - b.at);
  _games = list.slice(-500);
  try { localStorage.setItem(GAMES_KEY, JSON.stringify(_games)); } catch (e) { /* storage full or blocked */ }
}
// a record from storage or the cloud has the shape we expect
function gameOK(g) {
  return g && typeof g.id === 'string' && Array.isArray(g.teams) && g.teams.length === 2 && Array.isArray(g.bat) && g.bat.length === 2 && Array.isArray(g.pit) && g.pit.length === 2
    && Array.isArray(g.score) && Array.isArray(g.line) && g.bat.every(Array.isArray) && g.pit.every(Array.isArray);
}
// games from your account join the ones on this device
function mergeGames(list) {
  const have = new Map(gamesList().map((g) => [g.id, g]));
  let added = 0;
  for (const g of list) if (gameOK(g) && !have.has(g.id)) { have.set(g.id, g); added++; }
  if (added) saveGames([...have.values()]);
  return added;
}

// -------------------------------------------------------------- box score ----
const ipStr = (o) => `${Math.floor(o / 3)}.${o % 3}`;
const colorOK = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#33415c');
function linescoreFrom(g) {
  const n = Math.max(g.innings || 9, g.inn || 1, g.line[0].length, g.line[1].length);
  let h = '<tr><th></th>';
  for (let i = 1; i <= n; i++) h += `<th>${i}</th>`;
  h += '<th>R</th><th>H</th><th>E</th></tr>';
  for (let t = 0; t < 2; t++) {
    h += `<tr><td>${esc(g.teams[t].id)}</td>`;
    for (let i = 0; i < n; i++) {
      const v = g.line[t][i];
      h += `<td>${v ?? (t === 1 && i === n - 1 && g.done && g.score[1] > g.score[0] ? 'x' : '')}</td>`;
    }
    h += `<td class="rhe">${g.score[t] | 0}</td><td class="rhe">${g.hits[t] | 0}</td><td class="rhe">${g.errs[t] | 0}</td></tr>`;
  }
  return h;
}
function boxScoreHTML(g) {
  const team = (ti) => {
    const t = g.teams[ti], B = g.bat[ti], P = g.pit[ti], tot = [];
    for (const r of B) for (let k = 4; k <= 14; k++) tot[k] = (tot[k] || 0) + (r[k] | 0);
    const rows = B.map((r) => `<tr><td class="who">${r[15] ? '<span class="bx-sub"></span>' : ''}${esc(r[1])}<span class="bx-pos">${esc(r[2])}</span></td>${[4, 5, 6, 10, 11, 12].map((k) => `<td>${r[k] | 0}</td>`).join('')}</tr>`).join('');
    const note = (k, label) => {
      const xs = B.filter((r) => r[k] > 0).map((r) => esc(lastName(r[1])) + (r[k] > 1 ? ' ' + r[k] : ''));
      return xs.length ? `<b>${label}</b> ${xs.join(', ')}` : '';
    };
    const notes = [note(7, '2B'), note(8, '3B'), note(9, 'HR'), note(13, 'SB'), note(14, 'CS')].filter(Boolean).join(' &middot; ');
    const prow = P.map((p) => `<tr><td class="who">${esc(p[1])}${p[9] ? `<span class="bx-dec">${p[9] === 'S' ? 'SV' : esc(p[9])}</span>` : ''}</td><td>${ipStr(p[2] | 0)}</td><td>${p[3] | 0}</td><td>${p[4] | 0}</td><td>${erOf(p)}</td>${[5, 6, 7, 8].map((k) => `<td>${p[k] | 0}</td>`).join('')}</tr>`).join('');
    return `<div class="bx-team"><h3 style="background:${colorOK(t.c1)};color:${colorOK(t.c2)}">${esc(t.city)} ${esc(t.name)}</h3>
      <table class="rs-table bx-table"><thead><tr><th>BATTING</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th></tr></thead>
      <tbody>${rows}<tr class="bx-tot"><td class="who">Totals</td>${[4, 5, 6, 10, 11, 12].map((k) => `<td>${tot[k] || 0}</td>`).join('')}</tr></tbody></table>
      ${notes ? `<p class="bx-notes">${notes}</p>` : ''}
      <table class="rs-table bx-table"><thead><tr><th>PITCHING</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>HR</th><th>PC</th></tr></thead><tbody>${prow}</tbody></table></div>`;
  };
  return `<div class="bx-ls"><table class="linescore">${linescoreFrom(g)}</table></div><div class="bx-grid">${team(0)}${team(1)}</div>`;
}
function gameTitle(g) {
  const [a, h] = g.teams, park = (PARKS[g.park] || PARKS.FC).name;
  const when = new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${a.city} ${a.name} ${g.score[0]}, ${h.city} ${h.name} ${g.score[1]} · ${park} · ${when}`;
}
function openBox(g, sub) {
  $('bxBody').innerHTML = boxScoreHTML(g);
  $('bxSub').textContent = sub || gameTitle(g);
  $('boxScreen').classList.remove('hidden');
}
function closeBox() { $('boxScreen').classList.add('hidden'); }
// the box score so far, from the pause menu (or the final one)
function openLiveBox() {
  if (!G.teams || !G.played) return;
  const g = gameRecord();
  if (G.phase === 'final') { g.done = true; openBox(g, `Final${G.inning > G.innings ? ` (${G.inning})` : ''} · ${(PARKS[G.parkKey] || PARKS.FC).name}`); return; }
  openBox(g, `${G.half ? 'Bottom' : 'Top'} of the ${ordinal(G.inning)} · ${(PARKS[G.parkKey] || PARKS.FC).name}`);
}

// ------------------------------------------------------- save and resume ----
// Exhibition, Player Lock and Season games save themselves before every batter. Quit whenever you
// like and pick it back up from the main menu; starting another game replaces the save.
const SAVE_KEY = 'fullcount.save';
function canSave() { return ['exhibition', 'lock', 'season'].includes(G.mode) && !G.drill && !!G.teams; }
function autoSave() {
  if (!canSave()) return;
  const id = (p) => (p ? p.id : null);
  const s = {
    inning: G.inning, half: G.half, outs: G.outs, score: G.score, line: G.line, hits: G.hits, errs: G.errs, order: G.order, pen: G.pen,
    challenges: G.challenges, reviews: G.reviews, bases: G.bases.map(id), pitcher: G.pitcher.map(id),
    lu: G.lu.map((l) => l.map((p) => [p.id, p.pos])), bench: G.bench.map((b) => b.map(id)), bullpen: G.bullpen.map((b) => b.map(id)),
    gone: G.gone.map((g) => [...g]), played: G.played.map((l) => l.map((x) => [x.pl.id, x.pos, x.for || null])), pitched: G.pitched.map((l) => l.map(id)),
    stats: [...G.stats], pstats: [...G.pstats], dec: G.dec ? { team: G.dec.team, w: id(G.dec.w), l: id(G.dec.l) } : null, enterLead: G.enterLead, gameId: G.gameId,
  };
  const [a, h] = G.teams;
  const label = `${a.id} ${G.score[0]}, ${h.id} ${G.score[1]} · ${G.half ? 'Bottom' : 'Top'} ${ordinal(G.inning)} · ${G.mode === 'lock' ? 'Player Lock' : G.mode === 'season' ? 'Season' : 'Exhibition'}`;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, at: Date.now(), cfg: G.cfg, s, label })); } catch (e) { /* storage full or blocked */ }
}
function loadSave() {
  try { const sv = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return sv && sv.v === 1 && sv.cfg && sv.s ? sv : null; } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* blocked */ } }
// put a saved game back (called by startGame once the teams are built); false if it doesn't fit
function restoreSave(s) {
  const P = (id) => (id == null ? null : PBYID[id] || null);
  try {
    if (!s.lu.every((l) => l.length === 9 && l.every(([id]) => P(id)))) return false;
    Object.assign(G, { inning: s.inning, half: s.half, outs: s.outs, score: s.score, line: s.line, hits: s.hits, errs: s.errs, order: s.order, pen: s.pen });
    G.challenges = s.challenges || [2, 2]; G.reviews = s.reviews || [1, 1]; G.enterLead = s.enterLead || {}; G.gameId = s.gameId || G.gameId;
    for (let ti = 0; ti < 2; ti++) {
      G.lu[ti] = s.lu[ti].map(([id, pos]) => gamePlayer(P(id), pos));
      for (const p of G.lu[ti]) PBYID[p.id] = p;
      G.pos[ti] = Object.fromEntries(G.lu[ti].map((p) => [p.pos, p]));
      G.bench[ti] = s.bench[ti].map(P).filter(Boolean);
      G.bullpen[ti] = s.bullpen[ti].map(P).filter(Boolean);
      G.gone[ti] = new Set(s.gone[ti]);
      G.played[ti] = s.played[ti].map(([id, pos, f]) => ({ pl: gamePlayer(P(id), pos), pos, for: f })).filter((x) => x.pl);
      G.pitched[ti] = s.pitched[ti].map(P).filter(Boolean);
      G.pitcher[ti] = P(s.pitcher[ti]) || G.pitcher[ti];
    }
    G.bases = s.bases.map((id) => (id ? G.lu[G.half].find((p) => p.id === id) || P(id) : null));
    G.stats = new Map(s.stats); G.pstats = new Map(s.pstats);
    G.dec = s.dec ? { team: s.dec.team, w: P(s.dec.w), l: P(s.dec.l) } : null;
    return true;
  } catch (e) { console.warn('[save]', e); return false; }
}
// back in the game: the batter who was up when it was saved
function resumeHalf() {
  setupFielders();
  hudScore(); hudCount();
  hudBanner('GAME RESUMED', `${G.half ? 'BOTTOM' : 'TOP'} OF THE ${ordinal(G.inning).toUpperCase()} · ${G.outs} OUT${G.outs === 1 ? '' : 'S'}`, '');
  Caster.line(`We're back at ${PARK.name}. ${G.score[0] === G.score[1] ? `All tied at ${G.score[0]}` : `The ${G.teams[G.score[1] > G.score[0] ? 1 : 0].name} lead ${Math.max(...G.score)} to ${Math.min(...G.score)}`}, ${G.half ? 'bottom' : 'top'} of the ${ordinal(G.inning)}.`);
  setPhase('halfIntro', 2.6);
  G.batter = G.lu[G.half][G.order[G.half] % 9];
  G.batSide = sideFor(G.batter);
  G.batterModel = getModel(G.batter);
  applyAlignment();
  placeForPitch();
  hudBatter(); hudPitcher();
  wideCam(true);
  drawBoards();
}
function resumeSaved() {
  const sv = loadSave();
  if (!sv) { renderResume(); return; }
  SND.init();
  startGame({ ...sv.cfg, resume: sv.s });
}
function renderResume() {
  const sv = loadSave();
  $('resumeBox').classList.toggle('hidden', !sv);
  if (sv) $('resumeLabel').textContent = sv.label || 'A game in progress';
}

// ----------------------------------------------------------- head to head ----
// Your record against each opponent you've played online (both signed in). Kept on this
// device and, for a friend, on your friends list in your account.
const H2H_KEY = 'fullcount.h2h';
function h2hLocal() { try { return JSON.parse(localStorage.getItem(H2H_KEY) || '{}') || {}; } catch (e) { return {}; } }
function h2hGet(uid) {
  const f = typeof Cloud !== 'undefined' && Cloud.friends.find((x) => x.uid === uid), loc = h2hLocal()[uid];
  const w = Math.max((f && f.w) | 0, (loc && loc.w) | 0), l = Math.max((f && f.l) | 0, (loc && loc.l) | 0);
  return w + l ? { w, l } : null;
}
function h2hResult() {
  const opp = NET.opp, me = mySide();
  if (!opp || me < 0 || G.h2hDone === G.gameId || typeof Cloud === 'undefined' || !Cloud.profile) return;
  G.h2hDone = G.gameId;
  const won = G.score[me] > G.score[1 - me], cur = h2hGet(opp.uid) || { w: 0, l: 0 }, rec = { w: cur.w + (won ? 1 : 0), l: cur.l + (won ? 0 : 1) };
  const all = h2hLocal(); all[opp.uid] = { name: opp.name, ...rec, at: Date.now() };
  try { localStorage.setItem(H2H_KEY, JSON.stringify(all)); } catch (e) { /* blocked */ }
  if (Cloud.friends.some((f) => f.uid === opp.uid)) Cloud.saveH2H(opp.uid, rec);
  const sub = $('finalSub');
  if (sub) sub.textContent = `${sub.textContent} You're ${rec.w}-${rec.l} against ${opp.name}.`.trim();
}

// ------------------------------------------------------------- your stats ----
// Your numbers are your team's, game by game (in Player Lock, just your player's): your record,
// your hitting and your pitching, against everyone or against one friend in particular.
const BATK = ['pa', 'ab', 'r', 'h', 'd', 't', 'hr', 'rbi', 'bb', 'k', 'sb', 'cs'];   // bat row [3..14]
const erOf = (r) => (r[10] ?? r[4]) | 0;   // earned runs (records from before they were kept: runs)
function sumBat(rows) { const s = { pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, k: 0, sb: 0, cs: 0 }; for (const r of rows) BATK.forEach((k, i) => { s[k] += r[i + 3] | 0; }); return s; }
function sumPit(rows) {
  const s = { outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, pc: 0, w: 0, l: 0, sv: 0 };
  for (const r of rows) {
    s.outs += r[2] | 0; s.h += r[3] | 0; s.r += r[4] | 0; s.er += erOf(r); s.bb += r[5] | 0; s.k += r[6] | 0; s.hr += r[7] | 0; s.pc += r[8] | 0;
    if (r[9] === 'W') s.w++; else if (r[9] === 'L') s.l++; else if (r[9] === 'S') s.sv++;
  }
  return s;
}
function addTo(a, b) { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; }
// your side of a game, and theirs
function sidesOf(g) {
  const y = g.you, mine = (rows) => (g.lock ? rows.filter((r) => r[0] === g.lock) : rows);
  return { bat: sumBat(mine(g.bat[y])), pit: sumPit(mine(g.pit[y])), oBat: sumBat(g.bat[1 - y]), oPit: sumPit(g.pit[1 - y]), won: g.score[y] > g.score[1 - y] };
}
const rate3 = (x) => x.toFixed(3).replace(/^0/, '');
const avgS = (b) => (b.ab ? rate3(b.h / b.ab) : '.000');
const obpOf = (b) => (b.pa ? (b.h + b.bb) / b.pa : 0), slgOf = (b) => (b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0);
const eraS = (p) => (p.outs ? ((p.er * 27) / p.outs).toFixed(2) : '&ndash;');
const whipS = (p) => (p.outs ? (((p.h + p.bb) * 3) / p.outs).toFixed(2) : '&ndash;');
const MODE_NAME = { exhibition: 'Play Ball', lock: 'Player Lock', online: 'Online', season: 'Season' };
const modeOf = (g) => (g.coop ? 'coop' : g.mode);
// an online opponent (players who weren't signed in are grouped together)
function oppOf(g) { if (g.coop || !g.opp) return null; return g.opp.uid ? g.opp : { uid: 'anon', name: 'Opponents who weren’t signed in' }; }
function careerTotals(filter) {
  const H = new Map(), P = new Map();
  for (const g of gamesList()) {
    if (filter && !filter(g)) continue;
    for (const rows of g.bat) for (const r of rows) {
      let h = H.get(r[0]);
      if (!h) H.set(r[0], (h = { name: r[1], g: 0, ...sumBat([]) }));
      h.name = r[1]; h.g++;
      BATK.forEach((k, i) => { h[k] += r[i + 3] | 0; });
    }
    for (const rows of g.pit) for (const r of rows) {
      let p = P.get(r[0]);
      if (!p) P.set(r[0], (p = { name: r[1], g: 0, ...sumPit([]) }));
      p.name = r[1]; p.g++;
      addTo(p, sumPit([r]));
    }
  }
  for (const h of H.values()) { h.avg = h.ab ? h.h / h.ab : 0; h.obp = obpOf(h); h.slg = slgOf(h); h.ops = h.obp + h.slg; }
  for (const p of P.values()) { p.era = p.outs ? (p.er * 27) / p.outs : 0; p.whip = p.outs ? ((p.h + p.bb) * 3) / p.outs : 0; }
  return { H: [...H.values()], P: [...P.values()] };
}
const ST = { tab: 'you', sort: { bat: 'pa', pit: 'outs' }, dir: { bat: -1, pit: -1 }, filter: 'all', mode: 'all', opp: null };
const BAT_COLS = [['g', 'G'], ['pa', 'PA'], ['ab', 'AB'], ['h', 'H'], ['d', '2B'], ['t', '3B'], ['hr', 'HR'], ['rbi', 'RBI'], ['r', 'R'], ['bb', 'BB'], ['k', 'K'], ['sb', 'SB'], ['avg', 'AVG', rate3], ['obp', 'OBP', rate3], ['slg', 'SLG', rate3], ['ops', 'OPS', rate3]];
const PIT_COLS = [['g', 'G'], ['w', 'W'], ['l', 'L'], ['sv', 'SV'], ['outs', 'IP', ipStr], ['h', 'H'], ['r', 'R'], ['er', 'ER'], ['bb', 'BB'], ['k', 'K'], ['hr', 'HR'], ['era', 'ERA', (x) => x.toFixed(2)], ['whip', 'WHIP', (x) => x.toFixed(2)]];
function openStats() { $('statsScreen').classList.remove('hidden'); renderStats(); }
function closeStats() { $('statsScreen').classList.add('hidden'); }
function statCards(rec, b, p) {
  const card = (v, l) => `<div><b>${v}</b><small>${l}</small></div>`;
  return `<div class="st-cards">${card(`${rec.w}-${rec.l}`, 'RECORD')}${card(avgS(b), 'AVG')}${card(b.hr, 'HR')}${card(b.rbi, 'RBI')}${card(rate3(obpOf(b) + slgOf(b)), 'OPS')}${card(eraS(p), 'ERA')}${card(p.k, 'STRIKEOUTS')}${card(whipS(p), 'WHIP')}</div>`;
}
function lineTables(b, p) {
  return `<div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>HITTING</th><th>PA</th><th>AB</th><th>R</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>RBI</th><th>BB</th><th>K</th><th>SB</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th></tr></thead>
    <tbody><tr><td class="who">Totals</td>${BATK.slice(0, 11).map((k) => `<td>${b[k]}</td>`).join('')}<td>${avgS(b)}</td><td>${rate3(obpOf(b))}</td><td>${rate3(slgOf(b))}</td><td>${rate3(obpOf(b) + slgOf(b))}</td></tr></tbody></table></div>
    <div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>PITCHING</th><th>W</th><th>L</th><th>SV</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>HR</th><th>ERA</th><th>WHIP</th></tr></thead>
    <tbody><tr><td class="who">Totals</td><td>${p.w}</td><td>${p.l}</td><td>${p.sv}</td><td>${ipStr(p.outs)}</td><td>${p.h}</td><td>${p.r}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.k}</td><td>${p.hr}</td><td>${eraS(p)}</td><td>${whipS(p)}</td></tr></tbody></table></div>`;
}
// game by game: the result, and how you hit and pitched in it
function gameLog(list) {
  const rows = list.slice().reverse().slice(0, 200).map((g) => {
    const s = sidesOf(g), opp = g.teams[1 - g.you], o = oppOf(g);
    return `<tr><td class="who">${new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>`
      + `<td class="who">${g.you === 1 ? 'vs' : '@'} ${esc(opp.id)}${o && o.uid !== 'anon' ? ` <span class="st-opp">${esc(o.name)}</span>` : ''}</td>`
      + `<td><b class="${s.won ? 'good' : 'bad'}">${s.won ? 'W' : 'L'}</b> ${g.score[g.you]}-${g.score[1 - g.you]}${g.inn > g.innings ? ` (${g.inn})` : ''}</td><td>${MODE_NAME[modeOf(g)] || ''}</td>`
      + `<td>${s.bat.h}-${s.bat.ab}</td><td>${s.bat.hr}</td><td>${s.bat.rbi}</td><td>${avgS(s.bat)}</td><td>${ipStr(s.pit.outs)}</td><td>${s.pit.er}</td><td>${s.pit.k}</td><td>${eraS(s.pit)}</td>`
      + `<td><button class="ghost fr-mini" data-g="${esc(g.id)}">Box score</button></td></tr>`;
  }).join('');
  return `<h3>GAME HISTORY</h3><div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>DATE</th><th>OPPONENT</th><th>RESULT</th><th>MODE</th><th>H-AB</th><th>HR</th><th>RBI</th><th>AVG</th><th>IP</th><th>ER</th><th>K</th><th>ERA</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function totalsOf(list) {
  const t = { rec: { w: 0, l: 0 }, b: sumBat([]), p: sumPit([]), ob: sumBat([]), op: sumPit([]) };
  for (const g of list) { const s = sidesOf(g); t.rec[s.won ? 'w' : 'l']++; addTo(t.b, s.bat); addTo(t.p, s.pit); addTo(t.ob, s.oBat); addTo(t.op, s.oPit); }
  return t;
}
function renderYou() {
  const list = myGames(), t = totalsOf(list);
  const modes = ['all', 'exhibition', 'season', 'online', 'lock'].filter((m) => m === 'all' || gamesList().some((g) => g.you >= 0 && modeOf(g) === m));
  const seg = `<div class="st-filter seg">${modes.map((m) => `<button data-mode="${m}" class="${ST.mode === m ? 'on' : ''}">${m === 'all' ? 'All your games' : MODE_NAME[m]}</button>`).join('')}</div>`;
  if (!list.length) return `${seg}<p class="fr-note">No games here yet.</p>`;
  return `${seg}${statCards(t.rec, t.b, t.p)}${lineTables(t.b, t.p)}
    <p class="fr-note">Your team's hitting and pitching in the games you played${gamesList().some((g) => g.lock) ? ' (in Player Lock, just your player)' : ''}. ERA counts earned runs: runs that score on an error or a passed ball, or by a runner who got on by an error, don't count.</p>
    ${gameLog(list)}`;
}
function renderH2H() {
  const groups = new Map();
  for (const g of gamesList()) {
    const o = oppOf(g); if (!o || g.you < 0) continue;
    let x = groups.get(o.uid); if (!x) groups.set(o.uid, (x = { uid: o.uid, name: o.name, games: [] }));
    x.name = o.name; x.games.push(g);
  }
  if (!groups.size) return '<p class="fr-note">Play someone online and your record against them shows up here: wins and losses, how you hit and pitched against each other, and every game you played. Sign in with Google (both of you) to keep each friend separate.</p>';
  const rows = [...groups.values()].sort((a, b) => b.games.length - a.games.length).map((x) => {
    const t = totalsOf(x.games);
    return `<tr class="st-click ${ST.opp === x.uid ? 'sel' : ''}" data-opp="${esc(x.uid)}"><td class="who"><b>${esc(x.name)}</b></td><td>${x.games.length}</td><td>${t.rec.w}-${t.rec.l}</td>`
      + `<td>${avgS(t.b)}</td><td>${t.b.hr}</td><td>${eraS(t.p)}</td><td>${avgS(t.ob)}</td><td>${t.ob.hr}</td><td>${eraS(t.op)}</td></tr>`;
  }).join('');
  let detail = '';
  const sel = ST.opp && groups.get(ST.opp);
  if (sel) {
    const t = totalsOf(sel.games);
    detail = `<h3>YOU VS ${esc(sel.name.toUpperCase())}</h3>${statCards(t.rec, t.b, t.p)}
      <p class="fr-note">They're hitting <b>${avgS(t.ob)}</b> with ${t.ob.hr} HR against you, with a <b>${eraS(t.op)}</b> ERA against your hitters.</p>${gameLog(sel.games)}`;
  }
  return `<div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>OPPONENT</th><th>G</th><th>W-L</th><th>YOUR AVG</th><th>YOUR HR</th><th>YOUR ERA</th><th>THEIR AVG</th><th>THEIR HR</th><th>THEIR ERA</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="fr-note">Click an opponent for your game history against them.</p>${detail}`;
}
function myGames() { return gamesList().filter((g) => g.you >= 0 && (ST.mode === 'all' || modeOf(g) === ST.mode)); }
function renderStats() {
  if ($('statsScreen').classList.contains('hidden')) return;
  const games = gamesList();
  for (const b of $('stTabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.t === ST.tab);
  $('stSub').textContent = games.length ? `${games.length} game${games.length === 1 ? '' : 's'}${typeof Cloud !== 'undefined' && Cloud.user ? ' · saved to your account' : ' · on this device'}` : '';
  if (!games.length) { $('stBody').innerHTML = '<p class="fr-note">Finish a game (Play Ball, Player Lock, Online or Season) and your record, your hitting and pitching, and every box score start adding up here.</p>'; return; }
  if (ST.tab === 'you') { $('stBody').innerHTML = renderYou(); return; }
  if (ST.tab === 'h2h') { $('stBody').innerHTML = renderH2H(); return; }
  if (ST.tab === 'games') {
    const rows = games.slice().reverse().map((g) => {
      const [a, h] = g.teams, you = g.you >= 0 ? g.teams[g.you] : null, won = you && g.score[g.you] > g.score[1 - g.you];
      return `<tr><td class="who">${new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td><td class="who">${esc(a.id)} ${g.score[0]}, ${esc(h.id)} ${g.score[1]}${g.inn > g.innings ? ` (${g.inn})` : ''}</td>`
        + `<td class="who">${esc((PARKS[g.park] || PARKS.FC).name)}</td><td>${MODE_NAME[modeOf(g)] || ''}${g.sim ? ' (sim)' : ''}</td><td>${you ? (won ? '<b class="good">W</b>' : '<b class="bad">L</b>') : ''}</td><td><button class="ghost fr-mini" data-g="${esc(g.id)}">Box score</button></td></tr>`;
    }).join('');
    $('stBody').innerHTML = `<div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>DATE</th><th>FINAL</th><th>PARK</th><th>MODE</th><th>YOU</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    return;
  }
  const { H, P } = careerTotals(ST.filter === 'mine' ? (g) => g.you >= 0 : null);
  const bat = ST.tab === 'bat', cols = bat ? BAT_COLS : PIT_COLS, key = ST.sort[ST.tab], dir = ST.dir[ST.tab];
  // rate stats only for players with enough to go on
  const RATE = ['avg', 'obp', 'slg', 'ops', 'era', 'whip'], enough = (x) => (bat ? x.pa >= 10 : x.outs >= 9);
  const list = (bat ? H : P).filter((x) => !RATE.includes(key) || enough(x));
  list.sort((a, b) => (b[key] - a[key]) * -dir || a.name.localeCompare(b.name));
  const head = cols.map(([k, l]) => `<th data-sort="${k}" class="${k === key ? 'on' : ''}">${l}</th>`).join('');
  const cell = (x, k, f) => (RATE.includes(k) && !enough(x) ? '&ndash;' : f ? f(x[k]) : x[k]);
  const rows = list.slice(0, 150).map((x) => `<tr><td class="who">${esc(x.name)}</td>${cols.map(([k, , f]) => `<td>${cell(x, k, f)}</td>`).join('')}</tr>`).join('');
  $('stBody').innerHTML = `<div class="st-filter seg"><button data-f="all" class="${ST.filter === 'all' ? 'on' : ''}">All your games</button><button data-f="mine" class="${ST.filter === 'mine' ? 'on' : ''}">Only games you played in</button></div>
    <div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>${bat ? 'HITTER' : 'PITCHER'}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="fr-note">Every MLB player in your games. Click a column to sort. ${bat ? 'Rate stats need 10 plate appearances.' : 'Rate stats need 3 innings.'}</p>`;
}
function buildRecordsUI() {
  $('btnStats').addEventListener('click', openStats);
  $('stClose').addEventListener('click', closeStats);
  $('bxClose').addEventListener('click', closeBox);
  $('btnBox').addEventListener('click', openLiveBox);
  $('btnFinalBox').addEventListener('click', openLiveBox);
  $('btnResumeGame').addEventListener('click', resumeSaved);
  $('btnDiscardSave').addEventListener('click', () => { clearSave(); renderResume(); });
  $('stTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { ST.tab = b.dataset.t; renderStats(); } });
  $('stBody').addEventListener('click', (e) => {
    const s = e.target.closest('[data-sort]'), f = e.target.closest('[data-f]'), gb = e.target.closest('[data-g]'), md = e.target.closest('[data-mode]'), op = e.target.closest('[data-opp]');
    if (gb) { const g = gamesList().find((x) => x.id === gb.dataset.g); if (g) openBox(g); return; }
    if (md) { ST.mode = md.dataset.mode; renderStats(); return; }
    if (op) { ST.opp = ST.opp === op.dataset.opp ? null : op.dataset.opp; renderStats(); return; }
    if (s) { const k = s.dataset.sort; if (ST.sort[ST.tab] === k) ST.dir[ST.tab] *= -1; else { ST.sort[ST.tab] = k; ST.dir[ST.tab] = -1; } renderStats(); }
    else if (f) { ST.filter = f.dataset.f; renderStats(); }
    else if (gb) { const g = gamesList().find((x) => x.id === gb.dataset.g); if (g) openBox(g); }
  });
  renderResume();
}
