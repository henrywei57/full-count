// ============================================================================
// Season mode: a schedule against the real clubs, division standings, league leaders
// and the playoffs. You play (or sim) your team's games; every other game is played
// out by a quick plate-appearance sim. Saved on this device and to your account.
// ============================================================================

// -------------------------------------------------------------- quick sim ----
// Every batter against every pitcher, from their ratings, tuned to big-league rates
// (about 22% strikeouts, 8-9% walks, 3% homers, .290 on balls in play). A simmed game
// keeps the same box score as one you play.
const SIMK = { k: 0.222, bb: 0.084, hr: 0.0255, babip: 0.279, err: 0.012 };
let _LG = null;
function leagueAvg() {
  if (_LG) return _LG;
  const hs = TEAMS.flatMap((t) => t.lineup), ps = TEAMS.flatMap((t) => [...t.rotation, ...t.bullpen]);
  const avg = (xs, f) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
  _LG = { con: avg(hs, (h) => h.con), pow: avg(hs, (h) => h.pow), eye: avg(hs, (h) => h.eye), spd: avg(hs, (h) => h.spd), velo: avg(ps, (p) => p.velo), ctl: avg(ps, (p) => p.ctl), stuff: avg(ps, (p) => p.stuff ?? 60) };
  return _LG;
}
// how a park plays: home runs (wall distance and height, thin air) and hits in play (outfield size)
function parkSim(key) {
  const P = PARKS[key] || PARKS.FC, mean = (Q) => { let s = 0, n = 0; for (let th = -40; th <= 40; th += 5) { s += parkDist(Q, th); n++; } return s / n; };
  const m = mean(P), mf = mean(PARKS.FC), h = (P.h[0] + P.h[1] + P.h[2]) / 3, air = P.air || 1;
  return { hr: Math.pow(mf / m, 5) * Math.pow(1 / air, 1.6) * Math.pow(9.5 / h, 0.15), babip: 1 + (m - mf) / 400 + (1 - air) * 0.3 };
}
function simPA(b, p, fat, park, L) {
  const st = p.stuff ?? 60;
  const kP = SIMK.k * Math.exp(0.022 * (st - L.stuff) + 0.02 * (p.velo - L.velo) - 0.024 * (b.con - L.con) - 0.008 * (b.eye - L.eye)) * (1 - fat * 0.3);
  const bbP = SIMK.bb * Math.exp(-0.026 * (p.ctl - L.ctl) + 0.025 * (b.eye - L.eye)) * (1 + fat * 0.6);
  const hrP = SIMK.hr * Math.exp(0.04 * (b.pow - L.pow) - 0.012 * (st - L.stuff)) * park.hr * (1 + fat * 0.5);
  const x = Math.random();
  if (x < kP) return 'K';
  if (x < kP + bbP) return 'BB';
  if (x < kP + bbP + hrP) return 'HR';
  if (Math.random() < SIMK.err) return 'E';
  const babip = SIMK.babip * Math.exp(0.009 * (b.con - L.con) + 0.005 * (b.spd - L.spd) - 0.006 * (st - L.stuff)) * park.babip * (1 + fat * 0.2);
  if (Math.random() >= babip) return 'OUT';
  const y = Math.random(), t3 = clamp(0.018 + 0.0012 * (b.spd - L.spd), 0.003, 0.05), d2 = clamp(0.22 + 0.004 * (b.pow - L.pow), 0.1, 0.36);
  return y < t3 ? '3B' : y < t3 + d2 ? '2B' : '1B';
}
// teams: [away, home]; starters: their starting pitchers. Returns the score, line score and box score.
function simGame(teams, innings, starters, parkKey) {
  const L = leagueAvg(), park = parkSim(parkKey);
  const S = [0, 1].map((ti) => {
    const t = teams[ti], sp = starters[ti] || t.rotation[0];
    return { t, lu: t.lineup, i: 0, p: sp, pen: t.bullpen.filter((x) => x !== sp), pitched: [sp], enter: {}, C: t.lineup.find((h) => h.pos === 'C') || t.lineup[0] };
  });
  const bat = new Map(), pit = new Map();
  const BL = (pl) => { let x = bat.get(pl.id); if (!x) bat.set(pl.id, (x = { pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, k: 0, sb: 0, cs: 0 })); return x; };
  const PL = (pl) => { let x = pit.get(pl.id); if (!x) pit.set(pl.id, (x = { outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0, pc: 0 })); return x; };
  const lim = (p) => (p.pos === 'SP' ? p.stam + 12 : p.stam * 0.75);
  const fat = (p) => { const l = lim(p); return clamp((PL(p).pc - 0.7 * l) / (0.5 * l), 0, 1); };
  const score = [0, 0], line = [[], []], hits = [0, 0], errs = [0, 0];
  let dec = null, inning = 1, over = false;
  // the manager: the starter comes out when he's spent or getting hit hard, a reliever after his inning
  const change = (ti, newInning) => {
    const d = S[ti], p = d.p, s = PL(p), sp = p.pos === 'SP';
    if (!d.pen.length) return;
    const tired = s.pc >= lim(p) * (sp ? rand(0.95, 1.1) : 1), shelled = sp && s.r >= 6 && inning <= 6, done = !sp && newInning && s.outs >= 3 && Math.random() < 0.75;
    if (!(tired || shelled || done)) return;
    const lead = score[ti] - score[1 - ti], pen = d.pen.slice().sort((a, b) => pitcherOvr(b) - pitcherOvr(a));
    let np;
    if (inning >= innings && lead >= 1 && lead <= 3) np = pen[0];
    else if (inning >= innings - 1 && Math.abs(lead) <= 2) np = pen[Math.min(1, pen.length - 1)];
    else np = pen[Math.floor(rand(pen.length / 2, pen.length))] || pen[pen.length - 1];
    d.pen = d.pen.filter((x) => x !== np); d.p = np; d.pitched.push(np); d.enter[np.id] = lead;
  };
  const tally = (half, scorers, batter, rbi) => {
    if (!scorers.length) return;
    const before = score.slice(), d = S[1 - half];
    score[half] += scorers.length; line[half][inning - 1] += scorers.length; PL(d.p).r += scorers.length;
    for (const r of scorers) BL(r).r++;
    if (rbi) BL(batter).rbi += scorers.length;
    if (before[half] - before[1 - half] <= 0 && score[half] - score[1 - half] > 0) dec = { team: half, w: S[half].p, l: d.p };
  };
  while (!over) {
    for (let half = 0; half < 2 && !over; half++) {
      if (half === 1 && inning >= innings && score[1] > score[0]) { over = true; break; }
      const o = S[half], dti = 1 - half, b = [null, null, null, null];
      line[half][inning - 1] = 0;
      if (inning > innings) b[2] = o.lu[(o.i + 8) % 9];   // extra innings: a runner on second
      let outs = 0;
      change(dti, true);
      while (outs < 3) {
        change(dti, false);
        const p = S[dti].p, ps = PL(p);
        // a steal of second
        const r1 = b[1];
        if (r1 && !b[2] && outs < 2 && r1.spd >= 62 && Math.random() < clamp((r1.spd - 60) / 95, 0, 0.35)) {
          if (Math.random() < clamp(0.72 + (r1.spd - 72) * 0.01 - ((S[dti].C.arm ?? 65) - 65) * 0.005, 0.4, 0.95)) { b[2] = r1; b[1] = null; BL(r1).sb++; }
          else { b[1] = null; BL(r1).cs++; outs++; ps.outs++; if (outs >= 3) break; }
        }
        const bt = o.lu[o.i % 9], bl = BL(bt);
        o.i++;
        const res = simPA(bt, p, fat(p), park, L);
        ps.pc += Math.max(1, Math.round((res === 'K' ? 4.8 : res === 'BB' ? 5.6 : res === 'HR' ? 3.6 : 3.4) + rand(-0.7, 0.7)));
        bl.pa++;
        const sc = [];
        let rbi = true;
        if (res === 'K') { bl.ab++; bl.k++; ps.k++; outs++; ps.outs++; }
        else if (res === 'BB') { bl.bb++; ps.bb++; if (b[1]) { if (b[2]) { if (b[3]) sc.push(b[3]); b[3] = b[2]; } b[2] = b[1]; } b[1] = bt; }
        else if (res === 'HR') { bl.ab++; bl.h++; bl.hr++; ps.h++; ps.hr++; hits[half]++; for (const k of [3, 2, 1]) if (b[k]) sc.push(b[k]); b[1] = b[2] = b[3] = null; sc.push(bt); }
        else if (res === '3B') { bl.ab++; bl.h++; bl.t++; ps.h++; hits[half]++; for (const k of [3, 2, 1]) if (b[k]) sc.push(b[k]); b[1] = b[2] = null; b[3] = bt; }
        else if (res === '2B') {
          bl.ab++; bl.h++; bl.d++; ps.h++; hits[half]++;
          for (const k of [3, 2]) if (b[k]) sc.push(b[k]);
          const r = b[1]; b[1] = b[2] = b[3] = null;
          if (r) { if (Math.random() < 0.42 + (r.spd - 72) * 0.008) sc.push(r); else b[3] = r; }
          b[2] = bt;
        } else if (res === '1B') {
          bl.ab++; bl.h++; ps.h++; hits[half]++;
          if (b[3]) sc.push(b[3]);
          const r2 = b[2], r = b[1]; b[1] = b[2] = b[3] = null;
          if (r2) { if (Math.random() < 0.6 + (r2.spd - 72) * 0.008) sc.push(r2); else b[3] = r2; }
          if (r) { if (!b[3] && Math.random() < 0.28 + (r.spd - 72) * 0.006) b[3] = r; else b[2] = r; }
          b[1] = bt;
        } else if (res === 'E') { bl.ab++; errs[dti]++; rbi = false; if (b[3]) sc.push(b[3]); b[3] = b[2]; b[2] = b[1]; b[1] = bt; }
        else {
          bl.ab++;
          const kind = Math.random();
          if (kind < 0.45) {
            // a ground ball: two with a runner on first (no RBI), otherwise the runners move up
            if (b[1] && outs < 2 && Math.random() < clamp(0.5 - (bt.spd - 72) * 0.008, 0.2, 0.75)) {
              b[1] = null; outs += 2; ps.outs += 2; rbi = false;
              if (outs < 3) { if (b[3]) sc.push(b[3]); b[3] = b[2]; b[2] = null; }
            } else {
              outs++; ps.outs++;
              if (outs < 3) {
                if (b[3] && Math.random() < 0.45) { sc.push(b[3]); b[3] = null; }
                if (b[2] && !b[3] && Math.random() < 0.55) { b[3] = b[2]; b[2] = null; }
                if (b[1] && !b[2]) { b[2] = b[1]; b[1] = null; }
              }
            }
          } else if (kind < 0.8) {
            // a fly ball: deep enough to score from third (a sac fly), now and then a tag to third
            outs++; ps.outs++;
            if (outs < 3 && b[3] && Math.random() < 0.6 + (b[3].spd - 72) * 0.006) { sc.push(b[3]); b[3] = null; bl.ab--; }
            if (outs < 3 && b[2] && !b[3] && Math.random() < 0.3) { b[3] = b[2]; b[2] = null; }
          } else { outs++; ps.outs++; }   // a liner or a popup: nobody moves
        }
        tally(half, sc, bt, rbi);
        if (half === 1 && inning >= innings && score[1] > score[0]) { over = true; break; }   // walk-off
      }
    }
    if (!over && inning >= innings && score[0] !== score[1]) over = true;
    if (!over && inning >= 30) { over = true; if (score[0] === score[1]) { score[1]++; line[1][inning - 1]++; } }   // never in practice
    if (!over) inning++;
  }
  const decs = {};
  if (dec) {
    decs[dec.w.id] = 'W'; decs[dec.l.id] = 'L';
    const win = S[dec.team], fin = win.p, lead = win.enter[fin.id];
    if (fin !== dec.w && lead >= 1 && lead <= 3 && PL(fin).outs > 0) decs[fin.id] = 'S';
  }
  return {
    score, line, hits, errs, inn: inning,
    bat: S.map((s) => s.lu.map((pl) => { const x = BL(pl); return [statKey(pl), pl.name, pl.pos, x.pa, x.ab, x.r, x.h, x.d, x.t, x.hr, x.rbi, x.bb, x.k, x.sb, x.cs, 0]; })),
    pit: S.map((s) => s.pitched.map((p) => { const x = PL(p); return [statKey(p), p.name, x.outs, x.h, x.r, x.bb, x.k, x.hr, x.pc, decs[p.id] || '']; })),
  };
}

// ----------------------------------------------------------------- season ----
// SEASON: { id, team (index into TEAMS), len (games), innings, diff, ump, manual, day,
//   sched: days of [away, home, awayRuns, homeRuns, innings, recordId], rot: each club's
//   place in its rotation, st / sp: hitting and pitching totals by player, po: the playoffs }
const DIVS = [['AL East', ['BAL', 'BOS', 'NYY', 'TB', 'TOR']], ['AL Central', ['CWS', 'CLE', 'DET', 'KC', 'MIN']], ['AL West', ['ATH', 'HOU', 'LAA', 'SEA', 'TEX']],
  ['NL East', ['ATL', 'MIA', 'NYM', 'PHI', 'WSH']], ['NL Central', ['CHC', 'CIN', 'MIL', 'PIT', 'STL']], ['NL West', ['AZ', 'COL', 'LAD', 'SD', 'SF']]];
const SEASON_KEY = 'fullcount.season', SEASON_LENS = [12, 30, 60, 162];
const tIdx = (key) => TEAMS.findIndex((t) => t.key === key);
let SEASON;
function seasonLoad() {
  if (SEASON === undefined) {
    try { SEASON = JSON.parse(localStorage.getItem(SEASON_KEY) || 'null'); } catch (e) { SEASON = null; }
    if (!seasonOK(SEASON)) SEASON = null;
  }
  return SEASON;
}
function seasonOK(s) { return !!s && s.v === 1 && typeof s.id === 'string' && Array.isArray(s.sched) && TEAMS[s.team] && Array.isArray(s.rot) && s.st && s.sp; }
function seasonSave(toCloud = true) {
  if (!SEASON) return;
  SEASON.updated = Date.now();
  try { localStorage.setItem(SEASON_KEY, JSON.stringify(SEASON)); } catch (e) { /* storage full or blocked */ }
  if (toCloud && typeof Cloud !== 'undefined') Cloud.saveSeason(SEASON);
}
// a season from your account, if it's newer than the one here
function seasonFromCloud(s) {
  if (!seasonOK(s)) return false;
  const cur = seasonLoad();
  if (cur && cur.id === s.id && (cur.updated || 0) >= (s.updated || 0)) return false;
  if (cur && cur.id !== s.id && (cur.updated || 0) > (s.updated || 0)) return false;
  SEASON = s; seasonSave(false);
  return true;
}
// three-game series: everyone plays every day, the club with fewer home games so far is at home
function makeSchedule(len) {
  const n = TEAMS.length, home = new Array(n).fill(0), days = [];
  let last = new Set();
  for (let d = 0; d < len; d += 3) {
    let order = null;
    for (let tries = 0; tries < 40; tries++) {
      order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
      let ok = true;
      for (let i = 0; i < n; i += 2) if (last.has(Math.min(order[i], order[i + 1]) + '-' + Math.max(order[i], order[i + 1]))) { ok = false; break; }
      if (ok) break;
    }
    const pairs = [];
    last = new Set();
    for (let i = 0; i < n; i += 2) {
      let a = order[i], h = order[i + 1];
      if (home[a] < home[h] || (home[a] === home[h] && Math.random() < 0.5)) [a, h] = [h, a];
      pairs.push([a, h]); last.add(Math.min(a, h) + '-' + Math.max(a, h));
    }
    for (let k = 0; k < 3 && d + k < len; k++) { days.push(pairs.map(([a, h]) => [a, h, null, null, 0, null])); for (const [, h] of pairs) home[h]++; }
  }
  return days;
}
function startSeason(o) {
  const team = tIdx(o.team);
  if (team < 0) return;
  SEASON = {
    v: 1, id: 's' + Date.now().toString(36), team, len: o.len, innings: o.innings, diff: o.diff, ump: o.ump, manual: o.manual, day: 0,
    sched: makeSchedule(o.len), rot: TEAMS.map(() => (Math.random() * 5) | 0), st: {}, sp: {}, po: null, created: Date.now(),
  };
  SEASON.rot[team] = 0;   // your ace gets opening day
  seasonSave();
}
function seasonStarter(ti) { const r = TEAMS[ti].rotation; return r[SEASON.rot[ti] % r.length]; }
const isMine = (g) => g[0] === SEASON.team || g[1] === SEASON.team;
// regular-season numbers, for the standings and the leaders
function seasonAddLines(rec, tix) {
  const S = SEASON;
  rec.bat.forEach((rows, side) => rows.forEach((r) => {
    const s = S.st[r[0]] || (S.st[r[0]] = [r[1], tix[side], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    s[0] = r[1]; s[1] = tix[side];
    if (r[3] > 0) s[2]++;
    for (let k = 3; k <= 14; k++) s[k] += r[k] | 0;
  }));
  rec.pit.forEach((rows, side) => rows.forEach((r, i) => {
    // [name, team, g, gs, outs, h, r, bb, k, hr, w, l, sv]
    const s = S.sp[r[0]] || (S.sp[r[0]] = [r[1], tix[side], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    s[0] = r[1]; s[1] = tix[side]; s[2]++;
    if (i === 0) s[3]++;
    for (let k = 2; k <= 7; k++) s[k + 2] += r[k] | 0;
    if (r[9] === 'W') s[10]++; else if (r[9] === 'L') s[11]++; else if (r[9] === 'S') s[12]++;
  }));
}
// your team's simmed games keep a box score too
function keepSimRecord(r, A, H) {
  const t = (x) => ({ key: x.key, id: x.id, city: x.city, name: x.name, c1: x.c1, c2: x.c2 });
  const rec = { v: 1, id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), mode: 'season', park: H.key, innings: SEASON.innings, inn: r.inn, half: 1, done: true, teams: [t(A), t(H)], score: r.score, line: r.line, hits: r.hits, errs: r.errs, bat: r.bat, pit: r.pit, you: -1, sim: true, season: SEASON.id };
  saveGames([...gamesList(), rec]);
  if (typeof Cloud !== 'undefined') Cloud.saveGameRec(rec);
  return rec.id;
}
// sim one scheduled game (g: [away, home, ...]) and write its result in
function simInto(g, regular) {
  const A = TEAMS[g[0]], H = TEAMS[g[1]];
  const r = simGame([A, H], SEASON.innings, [seasonStarter(g[0]), seasonStarter(g[1])], H.key);
  g[2] = r.score[0]; g[3] = r.score[1]; g[4] = r.inn;
  if (regular) seasonAddLines(r, [g[0], g[1]]);
  if (isMine(g)) g[5] = keepSimRecord(r, A, H);
}
function nextDay() { for (let i = 0; i < SEASON.rot.length; i++) SEASON.rot[i]++; }
// finish the day: every game not played yet (yours too when simMine)
function seasonSimDay(simMine) {
  const S = SEASON, day = S.sched[S.day];
  if (!day) return;
  for (const g of day) if (g[2] == null && (simMine || !isMine(g))) simInto(g, true);
  if (day.every((g) => g[2] != null)) { nextDay(); S.day++; if (S.day >= S.len && !S.po) startPlayoffs(); }
}

// --------------------------------------------------------------- standings ----
function standings() {
  const T = TEAMS.map(() => ({ w: 0, l: 0, rs: 0, ra: 0, last: [] }));
  for (const day of SEASON.sched) for (const g of day) {
    if (g[2] == null) continue;
    const [a, h, sa, sh] = g, aw = sa > sh;
    T[a].rs += sa; T[a].ra += sh; T[h].rs += sh; T[h].ra += sa;
    T[aw ? a : h].w++; T[aw ? h : a].l++;
    T[a].last.push(aw ? 'W' : 'L'); T[h].last.push(aw ? 'L' : 'W');
  }
  return T;
}
const pctOf = (x) => (x.w + x.l ? x.w / (x.w + x.l) : 0);
function rankCmp(T) { return (a, b) => pctOf(T[b]) - pctOf(T[a]) || (T[b].rs - T[b].ra) - (T[a].rs - T[a].ra) || a - b; }
// six a league: three division winners, then three wild cards
function seedsFor(lg) {
  const T = standings(), cmp = rankCmp(T), divs = DIVS.slice(lg * 3, lg * 3 + 3).map(([, ks]) => ks.map(tIdx));
  const winners = divs.map((d) => d.slice().sort(cmp)[0]).sort(cmp);
  return [...winners, ...divs.flat().filter((t) => !winners.includes(t)).sort(cmp).slice(0, 3)];
}
function divisionOf(ti) { const k = TEAMS[ti].key; return DIVS.findIndex(([, ks]) => ks.includes(k)); }

// ---------------------------------------------------------------- playoffs ----
// MLB's bracket: a wild-card round (3 vs 6, 4 vs 5), the division series against the top
// two seeds, the championship series and the World Series. Short seasons get short series.
const SERIES_HOME = { 1: [1], 3: [1, 1, 1], 5: [1, 1, 0, 0, 1], 7: [1, 1, 0, 0, 0, 1, 1] };   // 1: the higher seed at home
const ROUND_NAME = ['Wild Card', 'Division Series', 'Championship Series', 'World Series'];
function startPlayoffs() {
  const S = SEASON, lens = S.len <= 20 ? [1, 3, 3, 5] : S.len <= 60 ? [3, 3, 5, 7] : [3, 5, 7, 7];
  S.po = { lens, round: 0, seeds: [seedsFor(0), seedsFor(1)], series: [], champ: null };
  for (const lg of [0, 1]) { const s = S.po.seeds[lg]; addSeries(0, lg, s[2], s[5]); addSeries(0, lg, s[3], s[4]); }
}
function addSeries(r, lg, hi, lo) { const P = SEASON.po; P.series.push({ r, lg, hi, lo, w: [0, 0], len: P.lens[r], games: [], win: null }); }
function seriesNext(s) { return SERIES_HOME[s.len][s.games.length] ? [s.lo, s.hi] : [s.hi, s.lo]; }
function seriesAdd(s, g) {
  s.games.push(g);
  const winner = g[2] > g[3] ? g[0] : g[1];
  s.w[winner === s.hi ? 0 : 1]++;
  if (Math.max(...s.w) > s.len / 2) s.win = s.w[0] > s.w[1] ? s.hi : s.lo;
}
function poAdvance() {
  const P = SEASON.po, cur = P.series.filter((s) => s.r === P.round);
  if (cur.some((s) => s.win == null)) return;
  if (P.round === 3) { P.champ = cur[0].win; return; }
  P.round++;
  const order = (lg, x, y) => (P.seeds[lg].indexOf(x) <= P.seeds[lg].indexOf(y) ? [x, y] : [y, x]);
  if (P.round === 1) for (const lg of [0, 1]) {
    const sd = P.seeds[lg], wc = cur.filter((s) => s.lg === lg);
    addSeries(1, lg, sd[0], wc.find((s) => s.hi === sd[3]).win);
    addSeries(1, lg, sd[1], wc.find((s) => s.hi === sd[2]).win);
  } else if (P.round === 2) for (const lg of [0, 1]) { const [x, y] = cur.filter((s) => s.lg === lg).map((s) => s.win); addSeries(2, lg, ...order(lg, x, y)); }
  else {
    const T = standings(), a = cur.find((s) => s.lg === 0).win, n = cur.find((s) => s.lg === 1).win;
    addSeries(3, 2, ...(rankCmp(T)(a, n) <= 0 ? [a, n] : [n, a]));
  }
}
// a day of the postseason: the next game of every series still going (yours too when simMine)
function poSimDay(simMine, skip = -1) {
  const P = SEASON.po;
  if (!P || P.champ != null) return;
  P.series.forEach((s, i) => {
    if (s.r !== P.round || s.win != null || i === skip) return;
    const [a, h] = seriesNext(s), g = [a, h, null, null, 0, null];
    if (!simMine && isMine(g)) return;
    simInto(g, false);
    seriesAdd(s, g);
  });
  nextDay();
  poAdvance();
}

// ---------------------------------------------------------- your next game ----
function seasonNextGame() {
  const S = seasonLoad();
  if (!S) return null;
  if (!S.po) {
    const day = S.sched[S.day], g = day && day.find(isMine);
    return g && g[2] == null ? { kind: 'reg', day: S.day, g } : null;
  }
  const P = S.po;
  if (P.champ != null) return null;
  const i = P.series.findIndex((s) => s.r === P.round && s.win == null && (s.hi === S.team || s.lo === S.team));
  if (i < 0) return null;
  const [a, h] = seriesNext(P.series[i]);
  return { kind: 'po', s: i, n: P.series[i].games.length, g: [a, h, null, null, 0, null] };
}
function seasonPlayNext() {
  const S = seasonLoad(), nx = seasonNextGame();
  if (!S || !nx) return;
  const info = nx.kind === 'reg' ? { id: S.id, day: nx.day } : { id: S.id, po: 1, s: nx.s, n: nx.n };
  // a game of this one already in progress: pick it back up
  const sv = loadSave();
  if (sv && sv.cfg.season && sv.cfg.season.id === S.id && sv.cfg.season.day === info.day && sv.cfg.season.s === info.s && sv.cfg.season.n === info.n) { resumeSaved(); return; }
  const [a, h] = nx.g, side = h === S.team ? 1 : 0;
  SND.init();
  startGame({ mode: 'season', teams: [{ b: TEAMS[a].key }, { b: TEAMS[h].key }], side, innings: S.innings, diff: S.diff, manual: S.manual, ump: S.ump, starters: [seasonStarter(a).id, seasonStarter(h).id], park: '', season: info });
}
// your game is over: write it in, then play out the rest of the day
function seasonGameDone(rec) {
  const S = seasonLoad(), info = G.season;
  if (!S || !info || info.id !== S.id) return;
  if (!info.po) {
    const day = S.sched[info.day], g = day && day.find(isMine);
    if (S.day !== info.day || !g || g[2] != null) return;
    g[2] = rec.score[0]; g[3] = rec.score[1]; g[4] = rec.inn; g[5] = rec.id;
    seasonAddLines(rec, [g[0], g[1]]);
    seasonSimDay(false);
  } else {
    const s = S.po && S.po.series[info.s];
    if (!s || s.win != null || s.games.length !== info.n) return;
    const [a, h] = seriesNext(s);
    seriesAdd(s, [a, h, rec.score[0], rec.score[1], rec.inn, rec.id]);
    poSimDay(false, info.s);
  }
  seasonSave();
}
// sim your next game (and the rest of that day), or a day of the postseason without you
function seasonSimNext() {
  const S = seasonLoad();
  if (!S) return false;
  const sv = loadSave();
  if (sv && sv.cfg.season && sv.cfg.season.id === S.id) clearSave();   // you won't be finishing that one
  if (!S.po) { if (S.day >= S.len) return false; seasonSimDay(true); return true; }
  if (S.po.champ != null) return false;
  poSimDay(true);
  return true;
}
// sim several days without freezing the page; done() when finished
function seasonSimMany(n, done) {
  let left = n;
  const step = () => {
    for (let k = 0; k < 4 && left > 0; k++, left--) if (!seasonSimNext()) { left = 0; break; }
    seasonSave(left <= 0);
    renderSeason();
    if (left > 0) setTimeout(step, 0); else if (done) done();
  };
  step();
}
function seasonAbandon() {
  SEASON = null;
  try { localStorage.removeItem(SEASON_KEY); } catch (e) { /* blocked */ }
  const sv = loadSave(); if (sv && sv.cfg.season) clearSave();
  if (typeof Cloud !== 'undefined') Cloud.deleteSeason();
}

// ----------------------------------------------------------------- leaders ----
function seasonPlayers() {
  const S = SEASON;
  const H = Object.values(S.st).map((s) => {
    const x = { name: s[0], team: s[1], g: s[2], pa: s[3], ab: s[4], r: s[5], h: s[6], d: s[7], t: s[8], hr: s[9], rbi: s[10], bb: s[11], k: s[12], sb: s[13], cs: s[14] };
    x.avg = x.ab ? x.h / x.ab : 0; x.obp = x.pa ? (x.h + x.bb) / x.pa : 0; x.slg = x.ab ? (x.h + x.d + 2 * x.t + 3 * x.hr) / x.ab : 0; x.ops = x.obp + x.slg;
    return x;
  });
  const P = Object.values(S.sp).map((s) => {
    const x = { name: s[0], team: s[1], g: s[2], gs: s[3], outs: s[4], h: s[5], r: s[6], bb: s[7], k: s[8], hr: s[9], w: s[10], l: s[11], sv: s[12] };
    x.ra9 = x.outs ? (x.r * 27) / x.outs : 99; x.whip = x.outs ? ((x.h + x.bb) * 3) / x.outs : 99;
    return x;
  });
  return { H, P };
}

// ---------------------------------------------------------------------- UI ----
const SEA = { tab: 'stand', confirm: 0 };
function teamBadge(t, small) { return `<span class="tbadge${small ? ' sm' : ''}" style="background:${colorOK(t.c1)};color:${colorOK(t.c2)};border-color:${colorOK(t.c2)}">${esc(t.id)}</span>`; }
function seasonStatus() {
  const S = SEASON, T = standings(), me = T[S.team], dv = divisionOf(S.team), [dname, keys] = DIVS[dv];
  const div = keys.map(tIdx).sort(rankCmp(T)), lead = T[div[0]], place = div.indexOf(S.team) + 1;
  const gb = ((lead.w - me.w) + (me.l - lead.l)) / 2;
  let where = me.w + me.l ? `${ordinal(place)} in the ${dname}${gb > 0 ? `, ${gb} back` : ''}` : `Opening day in the ${dname}`;
  if (S.po) {
    const P = S.po, mine = P.series.filter((s) => s.hi === S.team || s.lo === S.team), last = mine[mine.length - 1];
    if (P.champ === S.team) where = 'WORLD SERIES CHAMPIONS';
    else if (!last) where = 'Missed the playoffs';
    else if (last.win != null && last.win !== S.team) where = `Out in the ${ROUND_NAME[last.r]}`;
    else if (last.win == null) { const opp = TEAMS[last.hi === S.team ? last.lo : last.hi]; const w = last.hi === S.team ? last.w : [last.w[1], last.w[0]]; where = `${ROUND_NAME[last.r]} vs ${opp.name}: ${w[0] === w[1] ? 'tied' : w[0] > w[1] ? 'lead' : 'trail'} ${Math.max(...w)}-${Math.min(...w)}`; }
    else where = `Waiting on the ${ROUND_NAME[P.round]}`;
  }
  return { rec: `${me.w}-${me.l}`, where };
}
function renderSeasonPanel() {
  const S = seasonLoad(), el = $('seasonPanel');
  el.classList.toggle('hidden', !(menu.mode === 'season' && S));
  if (!S || menu.mode !== 'season') return;
  const t = TEAMS[S.team], st = seasonStatus(), nx = seasonNextGame();
  let next = '';
  if (nx) {
    const [a, h] = nx.g, home = h === S.team, opp = TEAMS[home ? a : h];
    const label = nx.kind === 'po' ? `${ROUND_NAME[S.po.series[nx.s].r]}, game ${nx.n + 1}` : `Game ${S.day + 1} of ${S.len}`;
    next = `<div class="sea-next"><small>${label}</small><b>${home ? 'vs' : 'at'} ${esc(opp.city)} ${esc(opp.name)}</b><span>${esc((PARKS[TEAMS[h].key] || PARKS.FC).name)} &middot; ${esc(seasonStarter(a).name)} vs ${esc(seasonStarter(h).name)}</span></div>`;
  } else if (S.po && S.po.champ != null) next = `<div class="sea-next"><small>THE SEASON IS OVER</small><b>${esc(TEAMS[S.po.champ].city)} ${esc(TEAMS[S.po.champ].name)} win the World Series</b></div>`;
  else if (S.po) next = `<div class="sea-next"><small>POSTSEASON</small><b>${esc(ROUND_NAME[S.po.round])}</b><span>Your team isn't playing: sim ahead to see who wins it all.</span></div>`;
  const done = S.po && S.po.champ != null;
  el.innerHTML = `<div class="sea-head">${teamBadge(t)}<div><b>${esc(t.city)} ${esc(t.name)}</b><span>${st.rec} &middot; ${esc(st.where)}</span></div></div>${next}
    <div class="row-actions">${nx ? '<button class="cta" data-sea="play">PLAY NEXT GAME</button><button class="ghost" data-sea="sim">Sim game</button>' : done ? '' : '<button class="cta" data-sea="sim">SIM A DAY</button>'}
    ${!done && !S.po ? '<button class="ghost" data-sea="week">Sim 7 days</button><button class="ghost" data-sea="rest">Sim to the playoffs</button>' : !done ? '<button class="ghost" data-sea="all">Sim the postseason</button>' : ''}</div>
    <div class="row-actions"><button class="ghost" data-sea="hub">Standings, leaders &amp; schedule</button><button class="ghost" data-sea="quit">${SEA.confirm ? 'Click again to end it' : done ? 'Start a new season' : 'Abandon season'}</button></div>
    <p class="fr-note" id="seaBusy"></p>`;
}
function renderSeason() { renderSeasonPanel(); renderSeasonHub(); }
function openSeasonHub() { if (!seasonLoad()) return; $('seasonScreen').classList.remove('hidden'); renderSeasonHub(); }
function closeSeasonHub() { $('seasonScreen').classList.add('hidden'); }
function renderSeasonHub() {
  const S = seasonLoad();
  if (!S || $('seasonScreen').classList.contains('hidden')) return;
  const tabs = [['stand', 'Standings'], ['lead', 'Leaders'], ['sched', 'Your games'], ...(S.po ? [['po', 'Playoffs']] : [])];
  if (!tabs.some(([k]) => k === SEA.tab)) SEA.tab = 'stand';
  $('seaTabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === SEA.tab ? 'on' : ''}">${l}</button>`).join('');
  const t = TEAMS[S.team], st = seasonStatus();
  $('seaSub').textContent = `${t.city} ${t.name} · ${st.rec} · ${S.po ? 'Postseason' : `Game ${Math.min(S.day + 1, S.len)} of ${S.len}`}`;
  const T = standings(), body = $('seaBody');
  if (SEA.tab === 'stand') {
    const div = ([name, keys]) => {
      const ids = keys.map(tIdx).sort(rankCmp(T)), lead = T[ids[0]];
      const rows = ids.map((i) => {
        const x = T[i], gb = ((lead.w - x.w) + (x.l - lead.l)) / 2, l10 = x.last.slice(-10), strk = x.last.length ? (() => { const v = x.last[x.last.length - 1]; let n = 0; for (let k = x.last.length - 1; k >= 0 && x.last[k] === v; k--) n++; return v + n; })() : '-';
        return `<tr class="${i === S.team ? 'sel' : ''}"><td class="who">${teamBadge(TEAMS[i], 1)} ${esc(TEAMS[i].name)}</td><td>${x.w}</td><td>${x.l}</td><td>${pctOf(x).toFixed(3).replace(/^0/, '')}</td><td>${gb ? gb : '-'}</td><td>${x.rs}</td><td>${x.ra}</td><td>${l10.filter((r) => r === 'W').length}-${l10.filter((r) => r === 'L').length}</td><td>${strk}</td></tr>`;
      }).join('');
      return `<h3>${esc(name.toUpperCase())}</h3><table class="rs-table st-table"><thead><tr><th>TEAM</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>RS</th><th>RA</th><th>L10</th><th>STRK</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    body.innerHTML = `<div class="sea-cols"><div>${DIVS.slice(0, 3).map(div).join('')}</div><div>${DIVS.slice(3).map(div).join('')}</div></div>
      <p class="fr-note">The top six in each league make the playoffs: the three division winners and three wild cards.</p>`;
  } else if (SEA.tab === 'lead') {
    const { H, P } = seasonPlayers(), days = Math.max(1, S.po ? S.len : S.day);
    const qH = (x) => x.pa >= Math.max(3, days * 2.7 * S.innings / 9), qP = (x) => x.outs >= Math.max(3, days * 2.4 * S.innings / 9);
    const board = (title, list, key, fmt, asc, q) => {
      const xs = list.filter(q || (() => true)).filter((x) => x[key] > 0 || asc).sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key])).slice(0, 5);
      return `<div class="sea-board"><h3>${title}</h3>${xs.map((x, i) => `<div class="sea-ld${x.team === S.team ? ' me' : ''}"><span>${i + 1}</span><b>${esc(x.name)}</b><em>${esc(TEAMS[x.team].id)}</em><i>${fmt ? fmt(x[key]) : x[key]}</i></div>`).join('') || '<p class="fr-note">&ndash;</p>'}</div>`;
    };
    const r3 = (v) => v.toFixed(3).replace(/^0/, ''), f2 = (v) => v.toFixed(2);
    body.innerHTML = `<div class="sea-boards">${board('AVG', H, 'avg', r3, false, qH)}${board('HOME RUNS', H, 'hr')}${board('RBI', H, 'rbi')}${board('OPS', H, 'ops', r3, false, qH)}${board('STOLEN BASES', H, 'sb')}
      ${board('WINS', P, 'w')}${board('RA9', P, 'ra9', f2, true, qP)}${board('STRIKEOUTS', P, 'k')}${board('SAVES', P, 'sv')}${board('WHIP', P, 'whip', f2, true, qP)}</div>
      <p class="fr-note">Regular season, every game in the league. AVG and OPS need about 2.7 plate appearances per team game; RA9 and WHIP about 0.8 innings.</p>`;
  } else if (SEA.tab === 'sched') {
    const rows = [];
    S.sched.forEach((day, d) => {
      const g = day.find(isMine); if (!g) return;
      rows.push(schedRow(`${d + 1}`, g, d === S.day && !S.po));
    });
    if (S.po) S.po.series.forEach((s) => { if (s.hi === S.team || s.lo === S.team) s.games.forEach((g, i) => rows.push(schedRow(`${ROUND_NAME[s.r].split(' ').map((w) => w[0]).join('')} ${i + 1}`, g, false))); });
    body.innerHTML = `<div class="rs-scroll"><table class="rs-table st-table"><thead><tr><th>GAME</th><th>OPPONENT</th><th>RESULT</th><th>STARTERS / PARK</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  } else {
    const P = S.po, rounds = [0, 1, 2, 3].filter((r) => P.series.some((s) => s.r === r));
    const seed = (s, ti) => (s.lg < 2 ? P.seeds[s.lg].indexOf(ti) + 1 : '');
    body.innerHTML = (P.champ != null ? `<div class="sea-champ">${teamBadge(TEAMS[P.champ])}<b>${esc(TEAMS[P.champ].city)} ${esc(TEAMS[P.champ].name)}</b><span>World Series champions</span></div>` : '')
      + rounds.map((r) => `<h3>${ROUND_NAME[r].toUpperCase()} <small>best of ${P.lens[r]}</small></h3>` + P.series.filter((s) => s.r === r).map((s) => {
        const side = (ti, w) => `<span class="${s.win === ti ? 'won' : s.win != null ? 'lost' : ''}${ti === S.team ? ' me' : ''}">${seed(s, ti) ? `<small>${seed(s, ti)}</small>` : ''}${teamBadge(TEAMS[ti], 1)} ${esc(TEAMS[ti].name)} <b>${w}</b></span>`;
        return `<div class="sea-series">${s.lg < 2 ? `<em>${s.lg ? 'NL' : 'AL'}</em>` : ''}${side(s.hi, s.w[0])}${side(s.lo, s.w[1])}</div>`;
      }).join('')).join('');
  }
}
function schedRow(label, g, today) {
  const S = SEASON, home = g[1] === S.team, opp = TEAMS[home ? g[0] : g[1]];
  let res = today ? '<b class="gold">Next</b>' : '';
  if (g[2] != null) { const my = home ? g[3] : g[2], their = home ? g[2] : g[3]; res = `<b class="${my > their ? 'good' : 'bad'}">${my > their ? 'W' : 'L'}</b> ${my}-${their}${g[4] > S.innings ? ` (${g[4]})` : ''}`; }
  const rec = g[5] && gamesList().find((x) => x.id === g[5]);
  return `<tr class="${today ? 'sel' : ''}"><td>${label}</td><td class="who">${home ? 'vs' : '@'} ${teamBadge(opp, 1)} ${esc(opp.name)}</td><td>${res}</td><td class="who">${esc((PARKS[TEAMS[g[1]].key] || PARKS.FC).name)}</td><td>${rec ? `<button class="ghost fr-mini" data-g="${esc(rec.id)}">Box score</button>` : ''}</td></tr>`;
}
function seasonAct(a) {
  const S = seasonLoad();
  if (!S) return;
  if (a !== 'quit') SEA.confirm = 0;
  const busy = (on) => { const b = $('seaBusy'); if (b) b.textContent = on ? 'Simming…' : ''; for (const x of $('seasonPanel').querySelectorAll('button')) x.disabled = on; };
  if (a === 'play') seasonPlayNext();
  else if (a === 'sim') { seasonSimNext(); seasonSave(); renderSeason(); }
  else if (a === 'week') { busy(true); seasonSimMany(7, () => busy(false)); }
  else if (a === 'rest') { busy(true); seasonSimMany(S.len - S.day, () => busy(false)); }
  else if (a === 'all') { busy(true); seasonSimMany(40, () => busy(false)); }
  else if (a === 'hub') openSeasonHub();
  else if (a === 'quit') {
    if (!SEA.confirm) { SEA.confirm = 1; renderSeasonPanel(); setTimeout(() => { SEA.confirm = 0; renderSeasonPanel(); }, 3000); return; }
    SEA.confirm = 0; seasonAbandon(); renderMenu();
  }
}
function buildSeasonUI() {
  $('seasonPanel').addEventListener('click', (e) => { const b = e.target.closest('[data-sea]'); if (b && !b.disabled) seasonAct(b.dataset.sea); });
  $('seaClose').addEventListener('click', closeSeasonHub);
  $('seaTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { SEA.tab = b.dataset.t; renderSeasonHub(); } });
  $('seaBody').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; const g = gamesList().find((x) => x.id === b.dataset.g); if (g) openBox(g); });
}
