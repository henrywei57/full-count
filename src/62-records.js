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
    return [statKey(p), p.name, s.outs | 0, s.h | 0, s.r | 0, s.bb | 0, s.k | 0, s.hr | 0, s.pc | 0, dec[p.id] || ''];
  }));
  return {
    v: 1, id: G.gameId, at: Date.now(), mode: G.mode, park: G.parkKey, innings: G.innings, inn: G.inning, half: G.half, done: G.phase === 'final',
    teams: G.teams.map((t) => ({ key: t.key, id: t.id, city: t.city, name: t.name, c1: t.c1, c2: t.c2 })),
    score: G.score.slice(), line: G.line.map((l) => l.slice()), hits: G.hits.slice(), errs: G.errs.slice(), bat, pit, you: mySide(),
    season: G.season ? G.season.id : null,
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
    const prow = P.map((p) => `<tr><td class="who">${esc(p[1])}${p[9] ? `<span class="bx-dec">${p[9] === 'S' ? 'SV' : esc(p[9])}</span>` : ''}</td><td>${ipStr(p[2] | 0)}</td>${[3, 4, 5, 6, 7, 8].map((k) => `<td>${p[k] | 0}</td>`).join('')}</tr>`).join('');
    return `<div class="bx-team"><h3 style="background:${colorOK(t.c1)};color:${colorOK(t.c2)}">${esc(t.city)} ${esc(t.name)}</h3>
      <table class="rs-table bx-table"><thead><tr><th>BATTING</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th></tr></thead>
      <tbody>${rows}<tr class="bx-tot"><td class="who">Totals</td>${[4, 5, 6, 10, 11, 12].map((k) => `<td>${tot[k] || 0}</td>`).join('')}</tr></tbody></table>
      ${notes ? `<p class="bx-notes">${notes}</p>` : ''}
      <table class="rs-table bx-table"><thead><tr><th>PITCHING</th><th>IP</th><th>H</th><th>R</th><th>BB</th><th>K</th><th>HR</th><th>PC</th></tr></thead><tbody>${prow}</tbody></table></div>`;
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

// ------------------------------------------------------------- your stats ----
function careerTotals(filter) {
  const H = new Map(), P = new Map();
  for (const g of gamesList()) {
    if (filter && !filter(g)) continue;
    for (const rows of g.bat) for (const r of rows) {
      let h = H.get(r[0]);
      if (!h) H.set(r[0], (h = { name: r[1], g: 0, pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, k: 0, sb: 0, cs: 0 }));
      h.name = r[1]; h.g++;
      ['pa', 'ab', 'r', 'h', 'd', 't', 'hr', 'rbi', 'bb', 'k', 'sb', 'cs'].forEach((k, i) => { h[k] += r[i + 3] | 0; });
    }
    for (const rows of g.pit) for (const r of rows) {
      let p = P.get(r[0]);
      if (!p) P.set(r[0], (p = { name: r[1], g: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0, pc: 0, w: 0, l: 0, sv: 0 }));
      p.name = r[1]; p.g++;
      ['outs', 'h', 'r', 'bb', 'k', 'hr', 'pc'].forEach((k, i) => { p[k] += r[i + 2] | 0; });
      if (r[9] === 'W') p.w++; else if (r[9] === 'L') p.l++; else if (r[9] === 'S') p.sv++;
    }
  }
  for (const h of H.values()) {
    h.avg = h.ab ? h.h / h.ab : 0; h.obp = h.pa ? (h.h + h.bb) / h.pa : 0;
    h.slg = h.ab ? (h.h + h.d + 2 * h.t + 3 * h.hr) / h.ab : 0; h.ops = h.obp + h.slg;
  }
  for (const p of P.values()) { p.ra9 = p.outs ? (p.r * 27) / p.outs : 0; p.whip = p.outs ? ((p.h + p.bb) * 3) / p.outs : 0; }
  return { H: [...H.values()], P: [...P.values()] };
}
const ST = { tab: 'bat', sort: { bat: 'pa', pit: 'outs' }, dir: { bat: -1, pit: -1 }, filter: 'all' };
const rate3 = (x) => x.toFixed(3).replace(/^0/, '');
const BAT_COLS = [['g', 'G'], ['pa', 'PA'], ['ab', 'AB'], ['h', 'H'], ['d', '2B'], ['t', '3B'], ['hr', 'HR'], ['rbi', 'RBI'], ['r', 'R'], ['bb', 'BB'], ['k', 'K'], ['sb', 'SB'], ['avg', 'AVG', rate3], ['obp', 'OBP', rate3], ['slg', 'SLG', rate3], ['ops', 'OPS', rate3]];
const PIT_COLS = [['g', 'G'], ['w', 'W'], ['l', 'L'], ['sv', 'SV'], ['outs', 'IP', ipStr], ['h', 'H'], ['r', 'R'], ['bb', 'BB'], ['k', 'K'], ['hr', 'HR'], ['ra9', 'RA9', (x) => x.toFixed(2)], ['whip', 'WHIP', (x) => x.toFixed(2)]];
function openStats() { $('statsScreen').classList.remove('hidden'); renderStats(); }
function closeStats() { $('statsScreen').classList.add('hidden'); }
function renderStats() {
  if ($('statsScreen').classList.contains('hidden')) return;
  const games = gamesList(), mine = (g) => g.you >= 0;
  for (const b of $('stTabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.t === ST.tab);
  $('stSub').textContent = games.length ? `${games.length} game${games.length === 1 ? '' : 's'} played${typeof Cloud !== 'undefined' && Cloud.user ? ' · saved to your account' : ' · on this device'}` : '';
  if (!games.length) { $('stBody').innerHTML = '<p class="fr-note">Finish a game (Play Ball, Player Lock, Online or Season) and every player\'s numbers start adding up here, along with the box score.</p>'; return; }
  if (ST.tab === 'games') {
    const rows = games.slice().reverse().map((g) => {
      const [a, h] = g.teams, you = g.you >= 0 ? g.teams[g.you] : null, won = you && g.score[g.you] > g.score[1 - g.you];
      return `<tr data-g="${esc(g.id)}"><td class="who">${new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td><td class="who">${esc(a.id)} ${g.score[0]}, ${esc(h.id)} ${g.score[1]}${g.inn > g.innings ? ` (${g.inn})` : ''}</td>`
        + `<td class="who">${esc((PARKS[g.park] || PARKS.FC).name)}</td><td>${{ exhibition: 'Exhibition', lock: 'Player Lock', online: 'Online', season: 'Season' }[g.mode] || ''}</td><td>${you ? (won ? '<b class="good">W</b>' : '<b class="bad">L</b>') : ''}</td><td><button class="ghost fr-mini" data-g="${esc(g.id)}">Box score</button></td></tr>`;
    }).join('');
    $('stBody').innerHTML = `<div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>DATE</th><th>FINAL</th><th>PARK</th><th>MODE</th><th>YOU</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    return;
  }
  const { H, P } = careerTotals(ST.filter === 'mine' ? mine : null);
  const bat = ST.tab === 'bat', cols = bat ? BAT_COLS : PIT_COLS, key = ST.sort[ST.tab], dir = ST.dir[ST.tab];
  // rate stats only for players with enough to go on
  const RATE = ['avg', 'obp', 'slg', 'ops', 'ra9', 'whip'], enough = (x) => (bat ? x.pa >= 10 : x.outs >= 9);
  const list = (bat ? H : P).filter((x) => !RATE.includes(key) || enough(x));
  list.sort((a, b) => (b[key] - a[key]) * -dir || a.name.localeCompare(b.name));
  const head = cols.map(([k, l]) => `<th data-sort="${k}" class="${k === key ? 'on' : ''}">${l}</th>`).join('');
  const cell = (x, k, f) => (RATE.includes(k) && !enough(x) ? '&ndash;' : f ? f(x[k]) : x[k]);
  const rows = list.slice(0, 150).map((x) => `<tr><td class="who">${esc(x.name)}</td>${cols.map(([k, , f]) => `<td>${cell(x, k, f)}</td>`).join('')}</tr>`).join('');
  $('stBody').innerHTML = `<div class="st-filter seg"><button data-f="all" class="${ST.filter === 'all' ? 'on' : ''}">All your games</button><button data-f="mine" class="${ST.filter === 'mine' ? 'on' : ''}">Only games you played in</button></div>
    <div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>${bat ? 'HITTER' : 'PITCHER'}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="fr-note">Click a column to sort. ${bat ? 'Rate stats need 10 plate appearances.' : 'RA9 is runs allowed per nine innings (earned and unearned); rate stats need 3 innings.'}</p>`;
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
    const s = e.target.closest('[data-sort]'), f = e.target.closest('[data-f]'), gb = e.target.closest('[data-g]');
    if (s) { const k = s.dataset.sort; if (ST.sort[ST.tab] === k) ST.dir[ST.tab] *= -1; else { ST.sort[ST.tab] = k; ST.dir[ST.tab] = -1; } renderStats(); }
    else if (f) { ST.filter = f.dataset.f; renderStats(); }
    else if (gb) { const g = gamesList().find((x) => x.id === gb.dataset.g); if (g) openBox(g); }
  });
  renderResume();
}
