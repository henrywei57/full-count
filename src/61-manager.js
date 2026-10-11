// ============================================================================
// The game roster and the manager: each side's batting order, who plays where,
// the bench and the bullpen. Pinch hitters, pinch runners, defensive subs and
// pitching changes, for you (the Team panel) and for the CPU (cpuManager).
// A player who comes out of the game can't go back in.
// ============================================================================

function initGameRoster(ti, starter) {
  const t = G.teams[ti];
  G.lu[ti] = t.lineup.slice();
  G.pos[ti] = Object.fromEntries(t.hitters.map((h) => [h.pos, h]));
  G.bench[ti] = (t.bench || []).slice();
  G.bullpen[ti] = (t.bullpen || t.pitchers.slice(1)).slice();
  G.pitcher[ti] = starter || (t.rotation ? t.rotation[0] : t.pitchers[0]);
  G.bullpen[ti] = G.bullpen[ti].filter((p) => p !== G.pitcher[ti]);
  G.pen[ti] = 0; G.gone[ti] = new Set();
  G.played[ti] = t.lineup.map((h) => ({ pl: h, pos: h.pos }));   // for the box score, in order of appearance
  G.pitched[ti] = [G.pitcher[ti]];
}
// the same player at another position: his arm and glove there (a step worse where he doesn't play)
function gamePlayer(pl, pos) {
  if (!pl || pl.pos === pos) return pl;
  if (pl.def) {
    const main = Object.values(pl.def)[0] || { arm: pl.arm, fld: pl.fld }, d = pl.def[pos] || (pos === 'DH' ? { arm: main.arm, fld: 45 } : { arm: Math.max(38, main.arm - 8), fld: Math.max(38, main.fld - 12) });
    return { ...pl, pos, arm: d.arm, fld: d.fld };
  }
  const P = pl.mlbId && POOL_H.get(pl.mlbId);
  const r = P ? hitterAt(P, pos) : pos === 'DH' ? { fld: 45 } : { arm: Math.max(38, pl.arm - 8), fld: Math.max(38, pl.fld - 12) };
  return { ...pl, pos, ...(r.arm != null ? { arm: r.arm } : {}), fld: r.fld };
}
const batScore = (h) => h.con + h.pow * 1.1 + h.eye * 0.6;
// the CPU's reliever for the situation: the closer for a save chance in the last inning,
// a top arm late and close, otherwise someone from the back of the pen
function pickReliever(ti) {
  const pen = G.bullpen[ti].slice().sort((a, b) => pitcherOvr(b) - pitcherOvr(a));
  const lead = G.score[ti] - G.score[1 - ti], last = G.inning >= G.innings;
  if (last && lead >= 0 && lead <= 3) return pen[0];
  if (G.inning >= G.innings - 1 && Math.abs(lead) <= 2) return pen[Math.min(1, pen.length - 1)];
  return pen[pen.length - 1];
}

// ------------------------------------------------------------ substitutions ----
// swap a bench player in for someone in the lineup; he takes that player's spot and position
function subIn(ti, outPl, inPl, pos = outPl.pos) {
  const i = G.lu[ti].findIndex((p) => p.id === outPl.id);
  if (i < 0 || !G.bench[ti].includes(inPl)) return null;
  const np = gamePlayer(inPl, pos);
  G.lu[ti][i] = np;
  if (G.pos[ti][outPl.pos] && G.pos[ti][outPl.pos].id === outPl.id) delete G.pos[ti][outPl.pos];
  G.pos[ti][pos] = np;
  G.bench[ti] = G.bench[ti].filter((p) => p !== inPl);
  G.gone[ti].add(outPl.id);
  G.played[ti].push({ pl: np, pos, for: outPl.id });
  PBYID[np.id] = np;
  return np;
}
// is this side yours to manage right now, and what can you do?
function canManage(ti) {
  return G.teams && !G.drill && G.mode !== 'derby' && G.mode !== 'lock' && !G.replay && (G.phase === 'prePitch' || G.phase === 'halfIntro') && !(G.phase === 'prePitch' && G.pitchUI.state !== 'aim' && pitchCtrl() === 'local');
}
function subRules(ti) {
  const ok = canManage(ti), bat = ti === G.half, pre = G.phase === 'prePitch';
  return {
    ph: ok && bat && pre && !G.abPitches.length && G.bench[ti].length > 0,
    pr: ok && bat && pre && G.bench[ti].length > 0,
    def: ok && G.bench[ti].length > 0,
    pen: ok && !bat && pre && G.bullpen[ti].length > 0,
    ibb: ok && !bat && pre && !!G.batter,
  };
}
// kind: 'ph' (bat for the batter), 'pr' (run for the runner on base `target`), 'def' (replace
// the player at position `target`), 'pen' (bring in reliever `inId`)
function doSub(ti, kind, target, inId) {
  const R = subRules(ti);
  if (kind === 'ibb') return R.ibb && intentionalWalk(ti);
  if (kind === 'pen') {
    const p = G.bullpen[ti].find((x) => x.id === inId);
    if (!R.pen || !p || !bringReliever(ti, p)) return false;
    enterPrePitch(); hudPitcher(); return true;
  }
  const inPl = G.bench[ti].find((x) => x.id === inId);
  if (!inPl) return false;
  if (kind === 'ph') {
    if (!R.ph || G.batter.id === G.lock) return false;
    const old = G.batter, np = subIn(ti, old, inPl); if (!np) return false;
    hudBanner('PINCH HITTER', `${np.name} bats for ${lastName(old.name)}`, '');
    Caster.line(`${np.name} will pinch-hit for ${lastName(old.name)}.`);
    G.batter = np; G.batSide = sideFor(np); G.batterModel = getModel(np);
    applyAlignment(); enterPrePitch(); hudBatter(); return true;
  }
  if (kind === 'pr') {
    const old = G.bases[+target];
    if (!R.pr || !old) return false;
    const np = subIn(ti, old, inPl); if (!np) return false;
    G.bases[+target] = np;
    hudBanner('PINCH RUNNER', `${np.name} runs for ${lastName(old.name)}`, '');
    Caster.line(`${np.name} comes in to run for ${lastName(old.name)}.`);
    enterPrePitch(); return true;
  }
  if (kind === 'def') {
    const old = G.pos[ti][target];
    if (!R.def || !old) return false;
    const np = subIn(ti, old, inPl, target); if (!np) return false;
    if (old === G.batter) { G.batter = np; G.batterModel = getModel(np); }
    for (const b of [1, 2, 3]) if (G.bases[b] && G.bases[b].id === old.id) G.bases[b] = np;
    if (ti === 1 - G.half && target !== 'DH') setupFielders();
    hudBanner('DEFENSIVE CHANGE', `${np.name} in at ${target}`, '');
    Caster.line(`A defensive change: ${np.name} comes in to play ${POS_NAME[target]}.`, false);
    if (G.phase === 'prePitch') enterPrePitch();
    return true;
  }
  return false;
}
const POS_NAME = { C: 'catcher', '1B': 'first', '2B': 'second', '3B': 'third', SS: 'short', LF: 'left', CF: 'center', RF: 'right', DH: 'designated hitter' };

// the CPU manager, before each batter: pinch-hit a weak bat late and close, pinch-run for a
// slow runner in scoring position, and (in maybePitchingChange) go to the bullpen
function cpuManager() {
  if (G.drill || G.mode === 'derby') return;
  const ti = G.half;
  if (sideCtrl(ti) !== 'cpu' || G.lock) return;
  const lateClose = G.inning >= G.innings - 1 && Math.abs(G.score[0] - G.score[1]) <= 2;
  if (!lateClose || !G.bench[ti].length) return;
  const next = G.lu[ti][G.order[ti] % 9];
  const best = G.bench[ti].slice().sort((a, b) => batScore(b) - batScore(a))[0];
  // keep the only catcher in the game
  const playsC = (p) => (p.def ? !!p.def.C : !!(p.mlbId && POOL_H.get(p.mlbId) && POOL_H.get(p.mlbId).def.C));
  const lastC = next.pos === 'C' && !G.bench[ti].some(playsC);
  if (best && !lastC && batScore(best) - batScore(next) >= 18 && Math.random() < 0.7) {
    const np = subIn(ti, next, best);
    if (np) { hudBanner('PINCH HITTER', `${np.name} bats for ${lastName(next.name)}`, ''); Caster.line(`${np.name} will pinch-hit for ${lastName(next.name)}.`, true, { queue: true }); }
  }
  for (const b of [3, 2]) {
    const r = G.bases[b];
    if (!r || r.spd >= 60) continue;
    const fast = G.bench[ti].slice().sort((a, c) => c.spd - a.spd)[0];
    if (fast && fast.spd - r.spd >= 22 && Math.random() < 0.6) {
      const np = subIn(ti, r, fast);
      if (np) { G.bases[b] = np; hudBanner('PINCH RUNNER', `${np.name} runs for ${lastName(r.name)}`, ''); }
      break;
    }
  }
}

// ---------------------------------------------------------------- Team panel ----
const TM = { pending: null };   // { kind: 'ph' | 'pr' | 'def', target }
function mySide() { return G.mode === 'online' ? localSide() : G.ctrl ? G.ctrl.indexOf('local') : -1; }
function openTeam() {
  const ti = mySide();
  if (ti < 0 || !G.teams || G.mode === 'lock' || G.drill || G.mode === 'derby') return;
  TM.pending = null;
  $('teamScreen').classList.remove('hidden');
  // the game waits while you think (online it keeps going: your friend is waiting too)
  if (!G.paused && G.mode !== 'online') { TM.paused = true; togglePause(true); $('pause').classList.add('hidden'); } else TM.paused = false;
  renderTeam();
}
function closeTeam() {
  $('teamScreen').classList.add('hidden');
  if (TM.paused) { TM.paused = false; togglePause(false); }
}
function renderTeam() {
  if ($('teamScreen').classList.contains('hidden')) return;
  const ti = mySide(), t = G.teams[ti], R = subRules(ti), bat = ti === G.half, P = TM.pending;
  const stat = (pl) => { const s = G.stats.get(pl.id); return s && s.pa ? statLine(s) : '&ndash;'; };
  const situation = !canManage(ti) ? 'Changes can be made between pitches.' : bat ? 'Your team is batting.' : 'Your team is in the field.';
  const hit = (pl, k) => `<td class="rv">${pl[k]}</td>`;
  const lu = G.lu[ti].map((pl, i) => {
    const onBase = [1, 2, 3].find((b) => G.bases[b] && G.bases[b].id === pl.id && bat);
    const isBatter = bat && G.batter && G.batter.id === pl.id;
    const btns = [];
    if (isBatter && R.ph) btns.push(`<button class="ghost fr-mini" data-tm="ph">Pinch hit</button>`);
    if (onBase && R.pr) btns.push(`<button class="ghost fr-mini" data-tm="pr" data-t="${onBase}">Pinch run</button>`);
    if (R.def && !isBatter) btns.push(`<button class="ghost fr-mini" data-tm="def" data-t="${pl.pos}">Replace</button>`);
    const sel = P && ((P.kind === 'ph' && isBatter) || (P.kind === 'pr' && +P.target === onBase) || (P.kind === 'def' && P.target === pl.pos));
    return `<tr class="${sel ? 'sel' : ''}"><td>${i + 1}</td><td class="pos">${pl.pos}</td><td class="who"><b>${esc(pl.name)}</b>${isBatter ? '<span class="rs-club">AT BAT</span>' : onBase ? `<span class="rs-club">ON ${['', '1ST', '2ND', '3RD'][onBase]}</span>` : ''}</td>`
      + ['con', 'pow', 'eye', 'spd'].map((k) => hit(pl, k)).join('') + `<td class="tm-line">${stat(pl)}</td><td>${btns.join('')}</td></tr>`;
  }).join('');
  const bench = G.bench[ti].map((pl) => {
    const P2 = !pl.def && pl.mlbId && POOL_H.get(pl.mlbId), plays = pl.def ? Object.keys(pl.def).join(' ') || 'DH' : P2 ? (P2.elig.join(' ') || 'DH') : pl.pos;
    return `<tr><td class="who"><b>${esc(pl.name)}</b></td><td class="plays">${plays}</td>` + ['con', 'pow', 'eye', 'spd', 'arm', 'fld'].map((k) => hit(pl, k)).join('')
      + `<td>${P ? `<button class="cta fr-mini" data-tmin="${esc(pl.id)}">PUT IN</button>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="tm-empty">Nobody left on the bench.</td></tr>';
  const cur = G.pitcher[ti], cps = pstat(cur), st = clamp(1 - cps.pc / pitchLimit(cur), 0, 1);
  const pen = G.bullpen[ti].map((p) => `<tr><td class="who"><b>${esc(p.name)}</b></td><td>${p.throws}</td>` + ['velo', 'ctl', 'stam'].map((k) => `<td class="rv">${p[k]}</td>`).join('')
    + `<td class="rv">${p.pitches.length ? p.pitches.map((x) => PITCH_TYPES[x.type].short).join(' ') : ''}</td><td>${R.pen ? `<button class="cta fr-mini" data-tmpen="${esc(p.id)}">BRING IN</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="7" class="tm-empty">The bullpen is empty.</td></tr>';
  $('tmSub').textContent = `${t.city} ${t.name} · ${situation}`;
  $('tmBody').innerHTML = `
    ${P ? `<p class="fr-note good">Pick a bench player to ${P.kind === 'ph' ? 'bat for ' + esc(lastName(G.batter.name)) : P.kind === 'pr' ? 'run for ' + esc(lastName(G.bases[P.target].name)) : 'play ' + POS_NAME[P.target]} &middot; <a href="#" data-tm="cancel">cancel</a></p>` : ''}
    <h3>LINEUP</h3>
    <div class="rs-scroll"><table class="rs-table tm-table"><thead><tr><th>#</th><th>POS</th><th>PLAYER</th><th>CON</th><th>POW</th><th>EYE</th><th>SPD</th><th>TODAY</th><th></th></tr></thead><tbody>${lu}</tbody></table></div>
    <h3>BENCH</h3>
    <div class="rs-scroll"><table class="rs-table tm-table"><thead><tr><th>PLAYER</th><th>PLAYS</th><th>CON</th><th>POW</th><th>EYE</th><th>SPD</th><th>ARM</th><th>FLD</th><th></th></tr></thead><tbody>${bench}</tbody></table></div>
    <h3>PITCHING <small>${esc(cur.name)} &middot; ${cps.pc} pitches &middot; ${st > 0.45 ? 'fresh' : st > 0.2 ? 'tiring' : 'gassed'}</small></h3>
    ${R.ibb ? `<p class="tm-acts"><button class="ghost fr-mini" data-tm="ibb">Intentional walk: put ${esc(lastName(G.batter.name))} on first (I)</button></p>` : ''}
    <div class="tm-stam"><i style="width:${st * 100}%;background:${st > 0.45 ? 'var(--ball)' : st > 0.2 ? 'var(--gold)' : 'var(--strike)'}"></i></div>
    <div class="rs-scroll"><table class="rs-table tm-table"><thead><tr><th>BULLPEN</th><th>T</th><th>VELO</th><th>CTL</th><th>STA</th><th>PITCHES</th><th></th></tr></thead><tbody>${pen}</tbody></table></div>`;
}
// ask for a move: done here, or sent to the host when you're the online guest
function teamMove(kind, target, inId) {
  const ti = mySide();
  if (isGuest()) { netSend({ t: 'act', a: 'sub', kind, target, inId }); TM.pending = null; setTimeout(renderTeam, 400); return; }
  if (doSub(ti, kind, target, inId)) { TM.pending = null; SND.init(); if (SND.ctx) SND.tick(); }
  renderTeam();
}
// I: put the batter on intentionally (your team in the field, before a pitch)
function requestIBB() { const ti = mySide(); if (ti >= 0 && subRules(ti).ibb) teamMove('ibb', null, ''); }
function buildTeamUI() {
  $('tmClose').addEventListener('click', closeTeam);
  $('btnTeam').addEventListener('click', () => { togglePause(false); openTeam(); });
  $('btnTeamHud').addEventListener('click', openTeam);
  $('tmBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tm],[data-tmin],[data-tmpen]'); if (!b) return;
    e.preventDefault();
    if (b.dataset.tmpen) { teamMove('pen', null, b.dataset.tmpen); return; }
    if (b.dataset.tmin) { const P = TM.pending; if (P) teamMove(P.kind, P.target, b.dataset.tmin); return; }
    const k = b.dataset.tm;
    if (k === 'ibb') { teamMove('ibb', null, ''); closeTeam(); return; }
    TM.pending = k === 'cancel' ? null : { kind: k, target: b.dataset.t || null };
    renderTeam();
  });
}
