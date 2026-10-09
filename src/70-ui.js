// ============================================================================
// Presentation: cameras, HUD, videoboards, input, replays, menus, main loop
// ============================================================================

// ---------------------------------------------------------------- cameras ----
const _c1 = new V3(), _c2 = new V3();
function batCam(snap) { G.prevCam = 'bat'; camTo(_c1.set(0, 6.0, 16.5), _c2.set(0, 1.0, -30), 33, 5, snap); }
function pitchCam(snap) { G.prevCam = 'pitch'; const L = curPitcher().throws === 'L'; camTo(_c1.set(L ? -2.4 : 2.4, 8.4, -75), _c2.set(0, 2.9, 0), 13.5, 5, snap); }
function cfCam(snap) { G.prevCam = 'cf'; camTo(_c1.set(-9, 42, -450), _c2.set(0, 3.4, 0), 2.7, 5, snap); }
function wideCam(snap) { G.prevCam = 'wide'; camTo(_c1.set(-60, 130, 170), _c2.set(0, 0, -150), 50, 1.4, snap); }
function menuCam(dt, snap = false) {
  G.menuAng += dt * 0.035;
  const a = G.menuAng;
  camTo(_c1.set(Math.sin(a) * 390, 150 + Math.sin(a * 0.7) * 30, -150 + Math.cos(a) * 390), _c2.set(0, 10, -150), 45, 2, snap);
}
function playCam() {
  const cut = G.prevCam === 'pitch' || G.prevCam === 'cf';
  G.prevCam = 'play';
  let fx, fy, fz;
  if (isGuest() && G.camFocus) [fx, fy, fz] = G.camFocus;
  else {
    const b = ballMesh.position, pl = G.play;
    fx = b.x; fz = b.z; fy = b.y;
    if (pl && pl.hr && G.bb && pl.t > G.bb.hrT + 1.6) { const br = pl.R.find((r) => r.isBatter); fx = br.pos.x; fz = br.pos.z; fy = 0; }
    G.camFocus = [fx, fy, fz];
  }
  const r = Math.hypot(fx, fz);
  _c2.set(fx * 0.92, Math.min(fy * 0.35, 35), fz * 0.92 + 4);
  _c1.set(fx * 0.28, 34 + r * 0.17 + Math.min(fy, 150) * 0.12, 54 - r * 0.1);
  camTo(_c1, _c2, 48, 2.6, cut);
}

// ----------------------------------------------------------- first person ----
// Player Lock can be played through the locked player's eyes. Hitting keeps the
// strike-zone view (you can't see the plate from the batter's eyes).
const _eye = new V3(), _look = new V3(), _fwd = new V3();
let fpvHidden = null, fpvOn = false;
function fpvActive() { return G.mode === 'lock' && G.fpv && !G.replay && ['prePitch', 'windup', 'pitch', 'postPitch', 'postFoul', 'live', 'postPlay', 'absReview'].includes(G.phase); }
function lockRole() {
  if (G.half === 1 - G.lockSide) {
    const f = G.fielders.find((x) => x.pl.id === G.lock);
    return f ? { role: 'field', m: f.m, f } : { role: 'dugout' };
  }
  const pl = G.play;
  if (pl && (G.phase === 'live' || G.phase === 'postPlay')) {
    const r = pl.R.find((x) => x.pl.id === G.lock && (x.state === 'run' || x.state === 'base'));
    if (r) return { role: 'run', m: r.m, r };
    if (G.batter && G.batter.id === G.lock && G.phase === 'live') return { role: 'dugout' };
  }
  if (G.batter && G.batter.id === G.lock && G.phase !== 'live' && G.phase !== 'postPlay') return { role: 'bat' };
  const r = (G.baseRunners || []).find((x) => x.pl.id === G.lock);
  return r ? { role: 'run', m: r.m, r } : { role: 'dugout' };
}
function setModelLayer(m, layer) { m.root.traverse((o) => { if (o.isMesh) o.layers.set(layer); }); }
function fpvHide(m) {
  if (fpvHidden === m) return;
  if (fpvHidden) setModelLayer(fpvHidden, 0);
  fpvHidden = m || null;
  if (m) setModelLayer(m, 1);
}
function fpvCam() {
  if (!fpvActive()) { fpvHide(null); fpvOn = false; return false; }
  const L = lockRole();
  if (L.role === 'bat') { fpvHide(null); fpvOn = false; return false; }
  let fov = 64;
  if (L.role === 'dugout') {
    fpvHide(null);
    const sgn = G.lockSide === 1 ? 1 : -1;
    _eye.set(sgn * 106, 2.6, -41); _look.set(0, 3, -48); fov = 55;
  } else {
    const m = L.m;
    fpvHide(m);
    m.root.updateMatrixWorld(true);
    m.j.neck.getWorldPosition(_eye); _eye.y += 0.5;
    const yaw = m.root.rotation.y; _eye.x += Math.sin(yaw) * 0.35; _eye.z += Math.cos(yaw) * 0.35;
    const pl = G.play, b = ballMesh.position;
    if ((G.phase === 'live' || G.phase === 'postPlay') && pl) {
      if (pl.ball.holder && pl.ball.holder.m === m) _look.set(0, 3, -64);
      else _look.copy(b);
      if (_look.distanceTo(_eye) < 2.5) _look.set(_eye.x + Math.sin(yaw) * 10, _eye.y - 2, _eye.z + Math.cos(yaw) * 10);
      fov = 68;
    } else if (L.role === 'field' && L.f.role === 'P') { _look.set(0, 2.6, 0); fov = userPitches() ? 21 : 45; }
    else if (L.role === 'field' && L.f.role === 'C') { _look.set(0, 5.5, -58); fov = 48; }
    else if (L.role === 'field') { _look.set(0, 3.2, 0); fov = 44; if (G.phase === 'pitch') _look.lerp(b, 0.25); }
    else _look.set(0, 3, 0);
  }
  if (!fpvOn) { camRig.look.copy(_look); camRig.fov = fov; }
  camRig.pos.copy(_eye); camRig.tp.copy(_eye); camRig.tl.copy(_look); camRig.tf = fov; camRig.rate = 9;
  fpvOn = true;
  return true;
}

// -------------------------------------------------------------------- HUD ----
let fbTimer = 0;
function setHint(html) { const el = $('hint'); el.innerHTML = html; el.style.opacity = html ? 1 : 0; }
function liveHint() {
  const parts = [];
  if (userFields()) parts.push('<kbd>WASD</kbd> move', '<kbd>Space</kbd> dive', G.lock ? '' : '<kbd>Q</kbd> switch', '<kbd>&larr;&uarr;&rarr;&darr;</kbd> throw');
  if (userRuns()) parts.push('<kbd>E</kbd> advance runners', '<kbd>Q</kbd> go back');
  return parts.filter(Boolean).join(' &middot; ');
}
function landingAssist() { return settings.guide && G.diff && G.diff.name !== 'Hall of Fame'; }
function teamHead(el, team) { el.style.background = team.c1; el.style.color = team.c2; }
function hudTeams() {
  const [a, h] = G.teams, st = document.documentElement.style;
  st.setProperty('--team-a', a.c1); st.setProperty('--team-a2', a.c2); st.setProperty('--team-h', h.c1); st.setProperty('--team-h2', h.c2);
  $('bugA').querySelector('.bug-abbr').textContent = a.id;
  $('bugH').querySelector('.bug-abbr').textContent = h.id;
  hudScore();
}
function hudScore() {
  $('bugA').querySelector('.bug-runs').textContent = G.score[0];
  $('bugH').querySelector('.bug-runs').textContent = G.score[1];
  $('absA').textContent = G.ump === 1 ? '●'.repeat(G.challenges[0]) : '';
  $('absH').textContent = G.ump === 1 ? '●'.repeat(G.challenges[1]) : '';
  $('bugA').classList.toggle('bat', G.half === 0); $('bugH').classList.toggle('bat', G.half === 1);
}
function hudCount() {
  $('bugCount').textContent = `${G.balls}-${G.strikes}`;
  $('bo1').classList.toggle('on', G.outs >= 1); $('bo2').classList.toggle('on', G.outs >= 2);
  for (const b of [1, 2, 3]) $('bd' + b).classList.toggle('on', !!G.bases[b]);
  $('bugArrow').innerHTML = G.half ? '&#9660;' : '&#9650;';
  $('bugArrow').classList.toggle('bot', G.half === 1);
  $('bugInn').textContent = G.inning;
  const p = curPitcher(); $('bugPC').textContent = p ? pstat(p).pc : 0;
}
function statLine(s) {
  const parts = [`${s.h}-for-${s.ab}`];
  if (s.hr) parts.push(s.hr > 1 ? `${s.hr} HR` : 'HR');
  if (s.d) parts.push(s.d > 1 ? `${s.d} 2B` : '2B');
  if (s.t) parts.push('3B');
  if (s.rbi) parts.push(`${s.rbi} RBI`);
  if (s.bb) parts.push(s.bb > 1 ? `${s.bb} BB` : 'BB');
  if (s.k) parts.push(s.k > 1 ? `${s.k} K` : 'K');
  return parts.join(' · ');
}
function hudBatter() {
  const b = G.batter; if (!b) return;
  const s = G.stats.get(b.id);
  teamHead($('batterCard').querySelector('.plate-head'), b.team);
  $('bHead').textContent = `#${b.num} · ${b.pos}`;
  $('bSide').textContent = `BATS ${G.batSide}`;
  $('bName').textContent = b.name;
  let line = s && s.pa ? statLine(s) : 'First at-bat tonight';
  if (G.mode === 'derby') line = `Home Run Derby · ${G.derby.hr} HR`;
  $('bLine').textContent = line;
  $('bRat').innerHTML = [['CON', b.con], ['POW', b.pow], ['EYE', b.eye], ['SPD', b.spd]].map(([k, v]) => `<div><b class="${v >= 80 ? 'r-hi' : v < 55 ? 'r-lo' : ''}">${v}</b><span>${k}</span></div>`).join('');
  hudLock();
}
function hudPitcher() {
  const p = curPitcher(); if (!p) return;
  const ps = pstat(p), up = userPitches();
  teamHead($('pitcherCard').querySelector('.plate-head'), p.team);
  $('pHead').textContent = `#${p.num} · ${p.pos === 'SP' ? 'STARTER' : 'RELIEVER'}`;
  $('pHand').textContent = p.throws === 'L' ? 'LHP' : 'RHP';
  $('pName').textContent = p.name;
  $('pLine').textContent = `${ps.pc} P · ${Math.floor(ps.outs / 3)}.${ps.outs % 3} IP · ${ps.k} K · ${ps.h} H · ${ps.bb} BB`;
  const st = clamp(1 - ps.pc / pitchLimit(p), 0, 1);
  $('pStam').style.width = st * 100 + '%';
  $('pStam').style.background = st > 0.45 ? 'var(--ball)' : st > 0.2 ? 'var(--gold)' : 'var(--strike)';
  $('pitcherCard').classList.toggle('cpu', !up);
  $('pitchList').innerHTML = p.pitches.map((pt, i) => `<div class="pitch-row ${up && i === G.pitchUI.sel ? 'sel' : ''}" data-i="${i}"><span class="key">${i + 1}</span><span class="pname"><i class="dot" style="background:${PITCH_TYPES[pt.type].col}"></i>${PITCH_TYPES[pt.type].name}</span><span class="mph">${Math.round(pt.velo - fatigue(p) * 2.4)} mph</span></div>`).join('');
  hudLock();
}
function hudLock() {
  if (G.mode !== 'lock' || !G.lock) return;
  const p = PBYID[G.lock], s = G.stats.get(p.id), ps = G.pstats.get(p.id);
  $('lockName').textContent = shortName(p.name);
  let line = `${p.pos} · #${p.num}`;
  if (p.pos === 'SP') { if (ps && (ps.outs || ps.pc)) line = `${Math.floor(ps.outs / 3)}.${ps.outs % 3} IP · ${ps.k} K · ${ps.r} R`; }
  else if (s && s.pa) line = statLine(s);
  $('lockLine').textContent = line;
}
function hudCall(text, cls) { const el = $('call'); el.className = ''; el.textContent = text; void el.offsetWidth; el.className = 'show ' + cls; }
function hudBanner(main, sub, cls) {
  const el = $('banner'); el.className = '';
  el.querySelector('.b-main').textContent = main; el.querySelector('.b-sub').textContent = sub || '';
  void el.offsetWidth; el.className = 'show ' + (cls || '');
}
let piTimer = 0;
function hudPitchInfo(info) {
  info = info || (G.P && { mph: G.P.mph, type: G.P.type });
  if (!info) return;
  $('piMph').innerHTML = `${Math.round(info.mph)}<small>MPH</small>`;
  $('piType').textContent = PITCH_TYPES[info.type].name;
  $('pitchInfo').classList.add('show');
  clearTimeout(piTimer); piTimer = setTimeout(() => $('pitchInfo').classList.remove('show'), 3500);
}
function hudDerby() {
  const D = G.derby;
  $('dHR').textContent = D.hr; $('dOuts').textContent = D.outs; $('dLong').textContent = D.longest ? D.longest : '–';
  hudBatter();
}
function showFeedback(c) {
  const fb = $('feedback');
  fb.querySelector('.fb-top').style.display = c ? '' : 'none';
  fb.querySelector('.fb-bar').style.display = c && c.timing !== 'BUNT' ? '' : 'none';
  if (c) {
    const tEl = $('fbTiming');
    tEl.textContent = c.timing;
    tEl.style.color = c.timing === 'PERFECT' ? 'var(--ball)' : c.timing === 'GOOD' ? '#b6f09c' : c.timing.startsWith('VERY') ? 'var(--strike)' : 'var(--gold)';
    $('fbContact').textContent = c.contact;
    $('fbMark').style.left = clamp(c.e / (c.wo * 1.6), -1, 1) * 50 + 50 + '%';
  }
  $('fbStats').style.display = c && c.miss ? 'none' : '';
  $('fbEV').textContent = '–'; $('fbLA').textContent = '–'; $('fbDist').textContent = '–';
  fb.classList.add('show');
  clearTimeout(fbTimer); fbTimer = setTimeout(hideFeedback, 5000);
}
function hideFeedback() { $('feedback').classList.remove('show'); }
function updateFeedbackStats(d) {
  if (!d) return;
  $('fbEV').textContent = d.ev.toFixed(1);
  $('fbLA').textContent = Math.round(d.la) + '°';
  $('fbDist').textContent = d.showDist ? Math.round(d.dist) + ' ft' : '–';
  if ($('feedback').classList.contains('show')) { clearTimeout(fbTimer); fbTimer = setTimeout(hideFeedback, 4000); }
}
function drawTracker() {
  const cv = $('zoneMini'), g = cv.getContext('2d');
  g.clearRect(0, 0, 300, 340);
  const X = (x) => 150 + x * 68, Y = (y) => 296 - (y - 0.5) * 68;
  g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(X(-ZONE.halfW), Y(ZONE.top), ZONE.halfW * 2 * 68, (ZONE.top - ZONE.bot) * 68);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5;
  for (const f of [1 / 3, 2 / 3]) {
    const x = X(-ZONE.halfW + 2 * ZONE.halfW * f), y = Y(ZONE.bot + (ZONE.top - ZONE.bot) * f);
    g.beginPath(); g.moveTo(x, Y(ZONE.top)); g.lineTo(x, Y(ZONE.bot)); g.stroke();
    g.beginPath(); g.moveTo(X(-ZONE.halfW), y); g.lineTo(X(ZONE.halfW), y); g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3;
  g.strokeRect(X(-ZONE.halfW), Y(ZONE.top), ZONE.halfW * 2 * 68, (ZONE.top - ZONE.bot) * 68);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.beginPath(); g.moveTo(X(-0.71), 318); g.lineTo(X(0.71), 318); g.lineTo(X(0.71), 326); g.lineTo(X(0), 334); g.lineTo(X(-0.71), 326); g.closePath(); g.fill();
  const col = (r) => (r === 'Ball' || r === 'HBP' ? '#3fd38a' : r === 'Foul' ? '#ffc94a' : r === 'In play' ? '#5aa8ff' : '#ff5a5f');
  G.abPitches.forEach((p, i) => {
    const x = clamp(X(p.x), 12, 288), y = clamp(Y(p.y), 12, 310);
    g.fillStyle = col(p.res); g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#081020'; g.font = '700 17px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(i + 1), x, y + 1);
  });
  $('trackList').innerHTML = G.abPitches.slice(-5).map((p, k, arr) => `<div><b>${G.abPitches.length - arr.length + k + 1}</b><span>${PITCH_TYPES[p.type].short} ${p.mph}</span><span style="color:${col(p.res)}">${p.res}</span></div>`).join('');
}
function drawBoards() {
  if (!G.teams) return;
  const LP = G.P || G.lastP;
  {
    const g = boardA.cv.getContext('2d'), W = 1024;
    g.fillStyle = '#04070d'; g.fillRect(0, 0, W, 410);
    const n = Math.max(G.innings, G.inning, 9 > G.innings ? G.innings : 9);
    const x0 = 210, cw = Math.min(56, (W - x0 - 190) / n);
    g.font = '700 30px "Barlow Condensed", Impact, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = '#7f8da6';
    for (let i = 1; i <= n; i++) g.fillText(i, x0 + (i - 0.5) * cw, 36);
    ['R', 'H', 'E'].forEach((k, i) => g.fillText(k, W - 150 + i * 56, 36));
    for (let t = 0; t < 2; t++) {
      const y = 92 + t * 66, team = G.teams[t];
      g.fillStyle = team.c1; g.fillRect(16, y - 28, 178, 56);
      g.fillStyle = team.c2; g.textAlign = 'left'; g.font = '800 40px "Barlow Condensed", Impact, sans-serif'; g.fillText(team.id, 30, y + 2);
      g.textAlign = 'center'; g.font = '700 34px "Barlow Condensed", Impact, sans-serif';
      for (let i = 0; i < n; i++) { const v = G.line[t][i]; g.fillStyle = '#e8edf5'; if (v != null) g.fillText(v, x0 + (i + 0.5) * cw, y + 2); }
      g.fillStyle = '#ffc94a';
      [G.score[t], G.hits[t], G.errs[t]].forEach((v, i) => g.fillText(v, W - 150 + i * 56, y + 2));
    }
    g.fillStyle = '#101a2c'; g.fillRect(0, 200, W, 2);
    if (G.batter) {
      const b = G.batter, s = G.stats.get(b.id);
      g.textAlign = 'left'; g.fillStyle = '#7f8da6'; g.font = '700 26px "Barlow Condensed", Impact, sans-serif'; g.fillText('AT BAT', 24, 238);
      g.fillStyle = '#ffffff'; g.font = '800 54px "Barlow Condensed", Impact, sans-serif'; g.fillText(`${b.num}  ${b.name.toUpperCase()}`, 24, 286, 600);
      g.fillStyle = '#c3cede'; g.font = '600 30px "Barlow Condensed", Impact, sans-serif';
      g.fillText(s && s.pa ? `TODAY ${s.h}-${s.ab}${s.hr ? ', ' + s.hr + ' HR' : ''}${s.rbi ? ', ' + s.rbi + ' RBI' : ''}` : `${b.pos} · BATS ${G.batSide}`, 24, 330);
      const p = curPitcher();
      if (p) {
        g.textAlign = 'right'; g.fillStyle = '#7f8da6'; g.font = '700 26px "Barlow Condensed", Impact, sans-serif'; g.fillText('PITCHING', W - 24, 238);
        g.fillStyle = '#ffffff'; g.font = '800 40px "Barlow Condensed", Impact, sans-serif'; g.fillText(p.name.toUpperCase(), W - 24, 280, 360);
        g.fillStyle = '#c3cede'; g.font = '600 30px "Barlow Condensed", Impact, sans-serif'; g.fillText(`PITCHES ${pstat(p).pc}`, W - 24, 322);
      }
      g.textAlign = 'center'; g.font = '800 46px "Barlow Condensed", Impact, sans-serif';
      g.fillStyle = '#3fd38a'; g.fillText(`B ${G.balls}`, 380, 382); g.fillStyle = '#ff5a5f'; g.fillText(`S ${G.strikes}`, 512, 382); g.fillStyle = '#ffc94a'; g.fillText(`O ${G.outs}`, 644, 382);
    }
    boardA.tex.needsUpdate = true;
  }
  {
    const g = boardB.cv.getContext('2d'), W = 768;
    g.fillStyle = '#04070d'; g.fillRect(0, 0, W, 410);
    g.fillStyle = G.teams[1].c1; g.fillRect(0, 0, W, 74);
    g.fillStyle = G.teams[1].c2; g.font = '800 italic 52px "Barlow Condensed", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${G.teams[1].city.toUpperCase()} ${G.teams[1].name.toUpperCase()}`, W / 2, 40, W - 40);
    g.fillStyle = '#7f8da6'; g.font = '700 32px "Barlow Condensed", Impact, sans-serif'; g.fillText('LAST PITCH', W / 2, 120);
    g.fillStyle = '#ffffff'; g.font = '800 170px "Barlow Condensed", Impact, sans-serif';
    g.fillText(LP ? Math.round(LP.mph) : '--', W / 2 - 40, 230);
    g.fillStyle = '#ffc94a'; g.font = '700 46px "Barlow Condensed", Impact, sans-serif'; g.fillText('MPH', W / 2 + 150, 262);
    g.fillStyle = '#c3cede'; g.font = '700 40px "Barlow Condensed", Impact, sans-serif'; g.fillText(LP ? PITCH_TYPES[LP.type].name.toUpperCase() : '', W / 2, 350);
    boardB.tex.needsUpdate = true;
  }
}
function meterDraw() {
  const U = G.pitchUI;
  $('mCur').style.bottom = `calc(${clamp(U.meter, -0.06, 1) * 100}% - 2px)`;
  $('mFill').style.height = (U.state === 'up' ? clamp(U.meter, 0, 1) : U.state === 'down' || U.state === 'done' ? clamp(U.power, 0, 1) : 0) * 100 + '%';
  $('mAcc').style.bottom = `calc(${ACC_LINE * 100}% - 1px)`;
  $('mPow').classList.toggle('hidden', U.state !== 'down');
  $('mPow').style.bottom = `calc(${clamp(U.power, 0, 1) * 100}% - 1px)`;
}
function meterGrade(gr) {
  const el = $('meter').querySelector('.m-label');
  el.textContent = gr; el.style.color = gr === 'PERFECT' ? 'var(--gold)' : gr === 'GOOD' ? 'var(--ball)' : gr === 'POOR' ? 'var(--strike)' : '';
  setTimeout(() => { el.textContent = 'METER'; el.style.color = ''; }, 1600);
}
function showScreen(id) {
  for (const s of ['menu', 'breakCard', 'final']) $(s).classList.toggle('hidden', s !== id);
  if (id === 'final') {
    const online = G.mode === 'online';
    $('btnAgain').textContent = online ? 'REMATCH' : 'PLAY AGAIN';
  }
}

// ------------------------------------------------------------ ABS review ----
let absTimer = 0, absPitch = null;
function drawABS(x, y, truth) {
  const g = $('absCanvas').getContext('2d'), W = 400, H = 440;
  g.clearRect(0, 0, W, H);
  const k = 120, X = (v) => W / 2 + v * k, Y = (v) => H - 40 - (v - ZONE.bot + 0.55) * k;
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(X(-ZONE.halfW), Y(ZONE.top), 2 * ZONE.halfW * k, (ZONE.top - ZONE.bot) * k);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4;
  g.strokeRect(X(-ZONE.halfW), Y(ZONE.top), 2 * ZONE.halfW * k, (ZONE.top - ZONE.bot) * k);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.moveTo(X(-0.71), H - 22); g.lineTo(X(0.71), H - 22); g.lineTo(X(0.71), H - 12); g.lineTo(X(0), H - 2); g.lineTo(X(-0.71), H - 12); g.closePath(); g.fill();
  const bx = clamp(X(x), 20, W - 20), by = clamp(Y(y), 20, H - 30);
  g.fillStyle = truth == null ? '#ffffff' : truth === 'STRIKE' ? '#ff5a5f' : '#3fd38a';
  g.beginPath(); g.arc(bx, by, BALL_R * k, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#081020'; g.lineWidth = 3; g.stroke();
}
function absShow(team, x, y, called) {
  absPitch = { x, y };
  $('absTeam').textContent = `${team} CHALLENGE · CALLED ${called}`;
  drawABS(x, y, null);
  $('absRes').textContent = 'REVIEWING…'; $('absRes').className = 'abs-res';
  $('absCard').classList.remove('hidden');
  clearTimeout(absTimer);
}
function absReveal(overturned, truth) {
  if (absPitch) drawABS(absPitch.x, absPitch.y, truth);
  $('absRes').textContent = overturned ? `OVERTURNED · ${truth}` : `CALL STANDS · ${truth}`;
  $('absRes').className = 'abs-res ' + (overturned ? 'over' : 'stand');
  SND.pop(0.5);
  absTimer = setTimeout(() => $('absCard').classList.add('hidden'), 2300);
}
function requestChallenge() {
  if (isGuest()) { if (G.chkSide === localSide()) netSend({ t: 'act', a: 'challenge' }); return; }
  const c = G.challengeable;
  if (c && c.who === 'local') startChallenge(c.side);
}

// ------------------------------------------------------------ runner map ----
// live mini diamond: where every runner, fielder and the ball are right now
function drawMiniMap() {
  const el = $('miniMap');
  const show = G.teams && G.mode !== 'derby' && G.mode !== 'menu' && !G.replay && !['menu', 'boot', 'break', 'final', 'wait', 'halfIntro'].includes(G.phase)
    && (G.mode === 'lock' || G.phase === 'live' || G.phase === 'postPlay' || G.bases.some(Boolean));
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const g = el.getContext('2d'), s = 1.02, ox = 150, oy = 262;
  const P = (x, z) => [clamp(ox + x * s, 10, 290), clamp(oy + z * s, 10, 290)];
  g.clearRect(0, 0, 300, 300);
  g.fillStyle = 'rgba(54,120,58,0.35)'; g.beginPath(); g.moveTo(ox, oy); g.arc(ox, oy, 205, -Math.PI * 0.75, -Math.PI * 0.25); g.closePath(); g.fill();
  const c = [0, 1, 2, 3].map((i) => P(BASES[i].x, BASES[i].z));
  g.strokeStyle = 'rgba(190,135,85,0.85)'; g.lineWidth = 10; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(...c[0]); g.lineTo(...c[1]); g.lineTo(...c[2]); g.lineTo(...c[3]); g.closePath(); g.stroke();
  g.fillStyle = 'rgba(190,135,85,0.85)'; g.beginPath(); g.arc(...P(0, MOUND_Z), 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  for (let i = 1; i <= 3; i++) { g.save(); g.translate(...c[i]); g.rotate(Math.PI / 4); g.fillRect(-6, -6, 12, 12); g.restore(); }
  g.beginPath(); g.moveTo(c[0][0] - 6, c[0][1] - 5); g.lineTo(c[0][0] + 6, c[0][1] - 5); g.lineTo(c[0][0] + 6, c[0][1]); g.lineTo(c[0][0], c[0][1] + 6); g.lineTo(c[0][0] - 6, c[0][1]); g.closePath(); g.fill();
  const ufKey = isGuest() ? NET.snap && NET.snap.pl && NET.snap.pl.uf : G.play && G.play.uf && G.play.uf.m.key;
  const dot = (x, z, r, fill, stroke, w = 3) => { const [px, py] = P(x, z); g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); if (stroke) { g.lineWidth = w; g.strokeStyle = stroke; g.stroke(); } };
  for (const m of MODELS) {
    if (!m.root.visible && m !== fpvHidden) continue;
    if (m.kind === 'ump' || !m.pl) continue;
    const p = m.root.position, me = m.pl.id === G.lock;
    if (m.fielding) dot(p.x, p.z, me ? 9 : 7, m.pl.team.c1, me ? '#ffc94a' : m.key === ufKey ? '#ffc94a' : 'rgba(255,255,255,0.8)', me || m.key === ufKey ? 4 : 2);
    else if (m.j.helmet.visible) dot(p.x, p.z, me ? 11 : 9, '#ffc94a', me ? '#ffffff' : '#081020', 4);
  }
  if (ballMesh.visible) { const b = ballMesh.position; dot(b.x, b.z, 4 + Math.min(5, b.y / 25), '#ffffff', '#081020', 2); }
}

// ------------------------------------------------------------ fireworks ----
const FW = [];
function fireworks(n = 5) { for (let k = 0; k < n; k++) setTimeout(burst, k * 380); }
function burst() {
  const N = 170, pos = new Float32Array(N * 3), vel = [];
  const c = new V3(rand(-140, 140), rand(170, 250), rand(-560, -460));
  for (let i = 0; i < N; i++) {
    pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z;
    vel.push(new V3(randn(), randn(), randn()).normalize().multiplyScalar(rand(45, 75)));
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.9, 0.62), size: 3.4, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const pts = new THREE.Points(geo, mat); scene.add(pts);
  FW.push({ pts, vel, t: 0 });
  SND.thud(0.5);
}
function updateFireworks(dt) {
  for (let k = FW.length - 1; k >= 0; k--) {
    const f = FW[k]; f.t += dt;
    const a = f.pts.geometry.attributes.position;
    for (let i = 0; i < f.vel.length; i++) {
      const v = f.vel[i]; v.y -= 26 * dt; v.multiplyScalar(1 - dt * 0.9);
      a.array[i * 3] += v.x * dt; a.array[i * 3 + 1] += v.y * dt; a.array[i * 3 + 2] += v.z * dt;
    }
    a.needsUpdate = true; f.pts.material.opacity = clamp(1 - f.t / 2.4, 0, 1);
    if (f.t > 2.4) { scene.remove(f.pts); f.pts.geometry.dispose(); f.pts.material.dispose(); FW.splice(k, 1); }
  }
}

// ------------------------------------------------------------ live play ----
function updateLive(dt) {
  const pl = G.play, fc = fieldCtrl();
  if (fc === 'local') { const v = fieldVec(); pl.setInput(v.x, v.z); }
  else if (fc === 'remote') pl.setInput(G.remoteIn.x, G.remoteIn.z);
  pl.update(dt);
  ballMesh.position.copy(pl.ball.pos);
  for (const r of pl.R) {
    const m = r.m;
    if (r.state === 'out') { if (pl.t - r.outT > 1.6) m.root.visible = false; else setAnim(m, 'idle'); continue; }
    if (r.state === 'scored') { if (r.goneT == null) r.goneT = pl.t; if (pl.t - r.goneT > 1.1) m.root.visible = false; else setAnim(m, 'jog'); continue; }
    m.root.visible = true;
    if (r.isBatter && r.base === 0 && r.state === 'run' && r.delay > 0) continue;
    r.sync(BASES[0]);
    if (r.state === 'run') setAnim(m, pl.hr || pl.awarded ? 'jog' : 'run'); else setAnim(m, 'ready');
  }
  for (const e of pl.events) onPlayEvent(e);
  pl.events.length = 0;
  if (pl.umpCall) {
    const u = pl.umpCall.base === 1 || pl.umpCall.base === 2 ? G.umps[1] : pl.umpCall.base === 3 ? G.umps[2] : G.umps[0];
    setAnim(u, 'ump', { callT: 0, call: pl.umpCall.call });
    pl.umpCall = null;
  }
  const localField = fc === 'local';
  $('throwPrompt').classList.toggle('hidden', !(localField && pl.prompt && pl.userDef));
  ctrlRing.visible = localField && !!pl.uf && !pl.done && !pl.hr;
  if (ctrlRing.visible) ctrlRing.position.set(pl.uf.pos.x, groundY(pl.uf.pos.x, pl.uf.pos.z) + 0.12, pl.uf.pos.z);
  const land = localField && landingAssist() ? pl.landingSpot() : null;
  landMark.visible = !!land; if (land) landMark.position.set(land[0], 0.1, land[1]);
  $('runHelp').classList.toggle('hidden', !(userRuns() && !pl.hr && !pl.awarded && !pl.done));
  if (!fpvActive()) playCam();
  if (pl.done) { setHint(''); ctrlRing.visible = false; landMark.visible = false; $('runHelp').classList.add('hidden'); finishPlay(); }
}
function onPlayEvent(e) {
  const homeBats = G.half === 1;
  if (e === 'land' || e === 'hrGone') updateFeedbackStats(fbData());
  if (e === 'hrGone' && (homeBats || G.mode === 'derby')) fireworks(6);
  if (e === 'catch' && !homeBats) SND.roar(0.22, 0.4, 1.5);
  if (e === 'run' && homeBats) SND.roar(0.38, 0.8, 2);
  if (e === 'error') SND.roar(0.25, 0.5, 1.5);
}

// ---------------------------------------------------------------- replay ----
function recFrame() {
  const fr = { t: G.now, b: [ballMesh.position.x, ballMesh.position.y, ballMesh.position.z, ballMesh.visible ? 1 : 0], m: [] };
  for (const m of MODELS) {
    if (!m.root.visible) continue;
    const prm = m.prm && m.prm.glove ? { glove: m.prm.glove.clone() } : m.prm;
    fr.m.push([m.idx, m.root.position.x, m.root.position.y, m.root.position.z, m.root.rotation.y, m.anim, G.now - m.t0, prm, m.phase]);
  }
  G.rec.push(fr);
  if (G.rec.length > 3000) G.rec.shift();
}
function applyFrame(fr) {
  for (const m of MODELS) m.root.visible = false;
  for (const e of fr.m) {
    const m = MODELS[e[0]]; m.root.visible = true;
    m.root.position.set(e[1], e[2], e[3]); m.root.rotation.y = e[4];
    applyPose(m, e[5], e[6], e[7], e[8]);
  }
  ballMesh.position.set(fr.b[0], fr.b[1], fr.b[2]); ballMesh.visible = !!fr.b[3];
}
function startReplay() {
  if (G.replay || !G.bb || !G.rec.length || !['postPlay', 'derbyResult'].includes(G.phase)) return;
  if (G.mode === 'derby' && !G.bb.hr) return;
  let i0 = G.rec.findIndex((f) => f.t >= G.contactT - 0.9); if (i0 < 0) i0 = 0;
  G.replay = { i: i0, t: G.rec[i0].t, style: G.bb.hr || G.bb.la > 22 ? 'low' : 'side', pre: true, snap: true };
  document.body.classList.add('letterbox'); $('replayTag').classList.remove('hidden'); $('hud').classList.add('replaying');
  hideFeedback(); trailReset(); ballShadow.visible = false;
}
function updateReplay(dt) {
  const R = G.replay, rec = G.rec;
  R.t += dt * 0.55;
  while (R.i < rec.length - 1 && rec[R.i + 1].t <= R.t) R.i++;
  applyFrame(rec[R.i]);
  const b = ballMesh.position;
  if (R.t < G.contactT) { cfCam(R.snap); R.snap = false; }
  else {
    const first = R.pre; R.pre = false;
    if (R.style === 'low') camTo(_c1.set(b.x * 0.12, 4.5, 26), b, 40, 3.5, first);
    else camTo(_c1.set(118, 16, 34), b, 30, 3.5, first);
  }
  if (R.i >= rec.length - 1) endReplay();
}
function endReplay() {
  if (!G.replay) return;
  applyFrame(G.rec[G.rec.length - 1]);
  G.replay = null;
  document.body.classList.remove('letterbox'); $('replayTag').classList.add('hidden'); $('hud').classList.remove('replaying');
  G.pt = Math.max(0, Math.min(G.pt, G.dur - 1.2));
  for (const m of MODELS) if (m.root.visible) updateModel(m, G.now);
}

// ------------------------------------------------------------------ input ----
const mouseNDC = new THREE.Vector2(0, -0.25);
let mouseMoved = false, lastPointer = 'mouse';
const raycaster = new THREE.Raycaster(), platePlane = new THREE.Plane(new V3(0, 0, 1), 0), _hit = new V3();
const keys = new Set();
function setMouse(e) { mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); mouseMoved = true; lastPointer = e.pointerType || 'mouse'; }
canvasEl.addEventListener('pointermove', setMouse);
canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
canvasEl.addEventListener('pointerdown', (e) => {
  SND.init(); setMouse(e);
  if (e.pointerType === 'touch') aimUpdate(0, true);
  primaryAction(e.button === 2 ? 'power' : e.button === 1 ? 'contact' : 'normal');
  e.preventDefault();
});
// field movement is relative to the camera: W runs where you're looking
function fieldVec() {
  let ix = 0, iy = 0;
  if (keys.has('a')) ix -= 1; if (keys.has('d')) ix += 1; if (keys.has('w')) iy += 1; if (keys.has('s')) iy -= 1;
  if (G.stick) { ix += G.stick.x; iy += G.stick.y; }
  if (!ix && !iy) return { x: 0, z: 0 };
  _fwd.copy(camRig.tl).sub(camRig.tp); _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
  _fwd.normalize();
  let x = -_fwd.z * ix + _fwd.x * iy, z = _fwd.x * ix + _fwd.z * iy;
  const L = Math.hypot(x, z); if (L > 1) { x /= L; z /= L; }
  return { x, z };
}
function actThrow(b) { if (isGuest()) netSend({ t: 'act', a: 'throw', base: b }); else if (G.play) G.play.userThrow(b); }
function actDive() { if (isGuest()) netSend({ t: 'act', a: 'dive' }); else if (G.play) G.play.userDive(); }
function actSwitch() { if (isGuest()) netSend({ t: 'act', a: 'switch' }); else if (G.play) G.play.userSwitch(); }
function actRun(kind) { if (isGuest()) netSend({ t: 'act', a: 'run', kind }); else if (G.play) G.play.runCmd(kind); }
const trotOn = () => (isGuest() ? !!(NET.snap && NET.snap.pl && NET.snap.pl.hr) : !!(G.play && (G.play.hr || G.play.awarded)));
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' || (k === 'p' && G.phase !== 'menu')) { togglePause(); return; }
  if (G.phase === 'menu' || G.phase === 'boot' || G.paused) return;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  SND.init();
  if (G.phase === 'live' && !trotOn()) {
    if (userFields()) {
      const tmap = { arrowright: 1, arrowup: 2, arrowleft: 3, arrowdown: 4, 1: 1, 2: 2, 3: 3, 4: 4 };
      if (k in tmap) { actThrow(tmap[k]); return; }
      if (k === ' ' || k === 'shift') { actDive(); return; }
      if (k === 'q') { actSwitch(); return; }
      if ('wasd'.includes(k)) return;
    }
    if (userRuns()) {
      if (k === 'e') { actRun('go'); return; }
      if (k === 'q') { actRun('back'); return; }
    }
  }
  if (k === ' ' || k === 'k') primaryAction('normal');
  else if (k === 'j') primaryAction('contact');
  else if (k === 'l') primaryAction('power');
  else if (k === 'b') primaryAction('bunt');
  else if (k >= '1' && k <= '5') selectPitch(+k - 1);
  else if (k === 'r') startReplay();
  else if (k === 'enter') { if (G.replay) endReplay(); else skip(); }
  else if (k === 'f' && G.mode === 'spectate') { G.ff = G.ff === 1 ? 3 : 1; setHint(G.ff > 1 ? 'Fast-forward <kbd>F</kbd>' : ''); }
  else if (k === 'z') toggleZone();
  else if (k === 'm') toggleSound();
  else if (k === 'c') requestChallenge();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
$('pitchList').addEventListener('click', (e) => { const row = e.target.closest('.pitch-row'); if (row) selectPitch(+row.dataset.i); });
for (const b of $('throwPrompt').querySelectorAll('button')) b.addEventListener('pointerdown', (e) => { e.stopPropagation(); actThrow(+b.dataset.base); });
for (const b of $('runHelp').querySelectorAll('button')) b.addEventListener('pointerdown', (e) => { e.stopPropagation(); actRun(b.dataset.run); });

let gpPrev = [];
function pollGamepad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null; for (const x of list || []) if (x) { gp = x; break; }
  if (!gp) return null;
  const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed), edge = (i) => pressed(i) && !gpPrev[i];
  const dz = (v) => (Math.abs(v) > 0.18 ? v : 0);
  const stick = { x: dz(gp.axes[0] || 0), y: -dz(gp.axes[1] || 0) };
  if (edge(9)) togglePause();
  if (!G.paused && G.phase !== 'menu') {
    if (gp.buttons.some((b, i) => edge(i))) SND.init();
    if (G.replay) { if (edge(0) || edge(1)) endReplay(); }
    else if (G.phase === 'live' && !trotOn() && (userFields() || userRuns())) {
      if (userFields()) { if (edge(1)) actThrow(1); if (edge(3)) actThrow(2); if (edge(2)) actThrow(3); if (edge(0)) actThrow(4); if (edge(5) || edge(7)) actDive(); if (edge(4)) actSwitch(); }
      else { if (edge(5)) actRun('go'); if (edge(4)) actRun('back'); }
    } else if (userPitches() && G.phase === 'prePitch') {
      const n = curPitcher().pitches.length;
      if (edge(4) || edge(14)) selectPitch((G.pitchUI.sel + n - 1) % n);
      if (edge(5) || edge(15)) selectPitch((G.pitchUI.sel + 1) % n);
      if (edge(0)) primaryAction('normal');
    } else if (G.phase === 'postPitch' && edge(3)) requestChallenge();
    else {
      if (edge(0)) primaryAction('normal'); if (edge(2)) primaryAction('power'); if (edge(1)) primaryAction('contact'); if (edge(3)) primaryAction('bunt');
      if (edge(8)) startReplay();
    }
  }
  gpPrev = gp.buttons.map((b) => b.pressed);
  return stick;
}
function aimUpdate(dt, snap = false) {
  const ub = userBats() && ['prePitch', 'windup', 'pitch', 'halfIntro', 'wait'].includes(G.phase) && !G.swing;
  const up = userPitches() && G.phase === 'prePitch' && G.pitchUI.state === 'aim';
  if (!ub && !up) return;
  const tgt = ub ? G.pci : G.pitchUI.aim;
  let vx = 0, vy = 0;
  if (keys.has('arrowleft') || keys.has('a')) vx -= 1; if (keys.has('arrowright') || keys.has('d')) vx += 1;
  if (keys.has('arrowup') || keys.has('w')) vy += 1; if (keys.has('arrowdown') || keys.has('s')) vy -= 1;
  if (G.stick) { vx += G.stick.x * 1.3; vy += G.stick.y * 1.3; }
  if (vx || vy) { tgt.x += vx * dt * 3.2; tgt.y += vy * dt * 3.2; mouseMoved = false; }
  else if (mouseMoved) {
    raycaster.setFromCamera(mouseNDC, camera);
    if (raycaster.ray.intersectPlane(platePlane, _hit)) {
      const k = snap ? 1 : 1 - Math.exp(-dt * 28);
      tgt.x = lerp(tgt.x, _hit.x, k); tgt.y = lerp(tgt.y, _hit.y, k);
    }
  }
  if (ub) { tgt.x = clamp(tgt.x, -1.7, 1.7); tgt.y = clamp(tgt.y, 0.8, 4.4); const d = pciDims('normal'); pci.position.set(tgt.x, tgt.y, 0); pci.scale.set(d.w, d.h, 1); }
  else { tgt.x = clamp(tgt.x, -2.2, 2.2); tgt.y = clamp(tgt.y, 0.4, 4.8); reticle.position.set(tgt.x, tgt.y, 0); }
}
function primaryAction(kind) {
  if (G.paused) return;
  if (G.replay) { endReplay(); return; }
  const ph = G.phase;
  if (ph === 'menu' || ph === 'boot' || ph === 'final' || ph === 'wait') return;
  if (ph === 'prePitch' || ph === 'windup' || ph === 'pitch') {
    if (userBats()) userSwing(kind);
    else if (userPitches() && ph === 'prePitch' && (kind === 'normal' || lastPointer === 'touch')) pitchPress();
    return;
  }
  if (ph === 'live') {
    if (isGuest()) { if (trotOn()) netSend({ t: 'act', a: 'trot' }); }
    else if (G.play && (G.play.hr || G.play.awarded) && G.play.t > 2) G.play.skipTrot();
    return;
  }
  skip();
}
function skip(force) {
  if (isGuest()) { netSend({ t: 'act', a: 'skip' }); return; }
  if (['postPitch', 'postPlay', 'postFoul', 'halfIntro', 'break', 'derbyResult'].includes(G.phase) && (force || G.pt > 0.3)) G.pt = G.dur;
}
function toggleZone() { settings.zone = !settings.zone; saveSettings(); zoneGroup.visible = settings.zone && (userBats() || userPitches()) && ['prePitch', 'windup', 'pitch'].includes(G.phase); $('btnZone').textContent = `Strike zone: ${settings.zone ? 'On' : 'Off'}`; }
function toggleSound() { SND.init(); SND.setOn(!settings.sound); muteIcon(); }
function muteIcon() { $('btnMute').style.opacity = settings.sound ? 1 : 0.45; }
function togglePause(force, remote) {
  if (['menu', 'boot', 'final', 'wait'].includes(G.phase)) return;
  if (!$('help').classList.contains('hidden')) { $('help').classList.add('hidden'); return; }
  const v = force ?? !G.paused;
  if (isGuest() && !remote) { netSend({ t: 'act', a: 'pause', v }); return; }
  G.paused = v;
  $('pause').classList.toggle('hidden', !G.paused);
  if (isHost()) netSend({ t: 'pause', v });
  const me = localSide();
  const penOK = ['exhibition', 'online'].includes(G.mode) && me >= 0 && me === 1 - G.half && G.phase === 'prePitch' && G.pen[me] < 3;
  $('btnPen').disabled = !penOK; $('btnPen').style.opacity = penOK ? 1 : 0.45;
  try { if (G.paused) speechSynthesis.pause(); else speechSynthesis.resume(); } catch (e) { /* none */ }
}

// ------------------------------------------------------------------ menus ----
const menu = { mode: 'exhibition', away: 0, home: 3, side: 1, innings: 3, diff: 1, manual: 1, batter: 3, lockPick: 'h3', ump: 1, fpv: 1 };
try { Object.assign(menu, JSON.parse(localStorage.getItem('fullcount.menu') || '{}')); } catch (e) { /* ignore */ }
function teamPickHTML(label, idx, key) {
  const t = TEAMS[idx];
  return `<div class="tp-label">${label}</div>
  <div class="tp-row"><button class="arrow" data-k="${key}" data-d="-1" aria-label="Previous team">&lsaquo;</button>
  <div class="badge" style="background:${t.c1};color:${t.c2};border-color:${t.c2}">${t.id}</div>
  <button class="arrow" data-k="${key}" data-d="1" aria-label="Next team">&rsaquo;</button></div>
  <div class="team-name"><small>${t.city.toUpperCase()}</small>${t.name}</div>
  <div class="team-ovr"><span>BAT <b>${t.ovr.bat}</b></span><span>PIT <b>${t.ovr.pit}</b></span><span>DEF <b>${t.ovr.def}</b></span></div>`;
}
function lockOptions(team) {
  return [...team.lineup.map((h, i) => [`h${i}`, `${h.name} · ${h.pos} · ${i + 1}${['st', 'nd', 'rd'][i] || 'th'} in the order`]), ['p0', `${team.pitchers[0].name} · Starting pitcher`]];
}
function renderMenu() {
  const m = menu.mode, derby = m === 'derby', spec = m === 'spectate', lock = m === 'lock', online = m === 'online';
  const guest = online && NET.role === 'guest', host = online && NET.role === 'host';
  const L = guest && NET.lobby ? NET.lobby : menu;
  const showTeams = !online || host || (guest && NET.open && NET.lobby);
  $('netPanel').classList.toggle('hidden', !online);
  $('netShare').classList.toggle('hidden', !(host && NET.code));
  $('netHostRow').classList.toggle('hidden', online && NET.open);
  $('netOr').classList.toggle('hidden', online && (NET.open || host));
  $('netJoinRow').classList.toggle('hidden', online && (NET.open || host));
  $('matchup').classList.toggle('hidden', !showTeams);
  $('pickA').innerHTML = teamPickHTML(derby ? 'BP PITCHER FROM' : 'AWAY', L.away, 'away');
  $('pickH').innerHTML = teamPickHTML(derby ? 'YOUR TEAM' : 'HOME', L.home, 'home');
  $('pickA').classList.toggle('readonly', guest); $('pickH').classList.toggle('readonly', guest);
  $('pickA').classList.toggle('hidden', derby); $('vsLabel').classList.toggle('hidden', derby);
  $('optSide').classList.toggle('hidden', derby || spec || !showTeams);
  $('optSide').querySelector('span').textContent = lock ? 'YOUR TEAM' : 'YOU PLAY AS';
  $('optInn').classList.toggle('hidden', derby || !showTeams);
  $('optDiff').classList.toggle('hidden', spec || !showTeams);
  $('optThrow').classList.toggle('hidden', derby || spec || online);
  $('optBatter').classList.toggle('hidden', !derby);
  $('optLock').classList.toggle('hidden', !lock);
  $('optView').classList.toggle('hidden', !lock);
  $('optUmp').classList.toggle('hidden', derby || !showTeams);
  for (const el of ['optSide', 'optInn', 'optDiff', 'optUmp']) $(el).style.pointerEvents = guest ? 'none' : '';
  for (const b of $('modes').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === m);
  for (const seg of document.querySelectorAll('.seg[data-key]')) {
    let v = L[seg.dataset.key] ?? menu[seg.dataset.key];
    if (guest && seg.dataset.key === 'side') v = 1 - L.side;
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === +v);
  }
  const sel = $('derbyBatter');
  sel.innerHTML = TEAMS[menu.home].lineup.map((h, i) => `<option value="${i}">${h.name} · ${h.pos} · POW ${h.pow}</option>`).join('');
  sel.value = String(menu.batter);
  if (lock) {
    const team = TEAMS[menu.side === 1 ? menu.home : menu.away];
    $('lockPick').innerHTML = lockOptions(team).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    $('lockPick').value = menu.lockPick;
    if ($('lockPick').value !== menu.lockPick) { menu.lockPick = 'h3'; $('lockPick').value = 'h3'; }
  }
  const play = $('btnPlay');
  play.classList.toggle('hidden', online && !host);
  play.disabled = host && !NET.open;
  play.textContent = derby ? 'START DERBY' : spec ? 'WATCH GAME' : lock ? 'PLAY AS ' + (lock ? lockName() : '') : online ? (NET.open ? 'START ONLINE GAME' : 'WAITING FOR FRIEND') : 'PLAY BALL';
  try { localStorage.setItem('fullcount.menu', JSON.stringify(menu)); } catch (e) { /* ignore */ }
  if (host && NET.open) netSendLobby();
}
function lockName() {
  const team = TEAMS[menu.side === 1 ? menu.home : menu.away];
  const p = menu.lockPick[0] === 'p' ? team.pitchers[0] : team.lineup[+menu.lockPick.slice(1)] || team.lineup[3];
  return lastName(p.name).toUpperCase();
}
function buildMenu() {
  if (menu.home === menu.away) menu.away = (menu.home + 1) % TEAMS.length;
  $('matchup').addEventListener('click', (e) => {
    const b = e.target.closest('.arrow'); if (!b || NET.role === 'guest') return;
    const k = b.dataset.k, other = k === 'away' ? 'home' : 'away';
    let v = (menu[k] + +b.dataset.d + TEAMS.length) % TEAMS.length;
    if (v === menu[other] && menu.mode !== 'derby') v = (v + +b.dataset.d + TEAMS.length) % TEAMS.length;
    menu[k] = v;
    if (k === 'home') { const lu = TEAMS[v].lineup; menu.batter = lu.indexOf(lu.reduce((a, c) => (c.pow > a.pow ? c : a))); }
    renderMenu();
  });
  $('modes').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (menu.mode === 'online' && b.dataset.mode !== 'online') { netClose(); netStatus(''); }
    menu.mode = b.dataset.mode;
    if (menu.mode === 'derby') { const lu = TEAMS[menu.home].lineup; menu.batter = lu.indexOf(lu.reduce((a, c) => (c.pow > a.pow ? c : a))); }
    renderMenu();
  });
  for (const seg of document.querySelectorAll('.seg[data-key]')) seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || NET.role === 'guest') return; menu[seg.dataset.key] = +b.dataset.v; renderMenu(); });
  $('derbyBatter').addEventListener('change', (e) => { menu.batter = +e.target.value; renderMenu(); });
  $('lockPick').addEventListener('change', (e) => { menu.lockPick = e.target.value; renderMenu(); });
  $('btnHost').addEventListener('click', () => { SND.init(); netHost(); });
  $('btnJoin').addEventListener('click', () => { SND.init(); netJoin($('joinCode').value); });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { SND.init(); netJoin($('joinCode').value); } });
  $('btnCopyLink').addEventListener('click', () => {
    const link = inviteLink(NET.code || '');
    const done = () => netStatus('Invite link copied. Send it to your friend!', 'good');
    try { navigator.clipboard.writeText(link).then(done, () => netStatus('Copy failed. Share the code or the link shown above.', 'bad')); } catch (e) { netStatus('Share the code or the link shown above.'); }
  });
  $('btnPlay').addEventListener('click', () => {
    SND.init();
    if (menu.mode === 'online') { hostStartOnline(); return; }
    let away = menu.away; if (menu.mode === 'derby' && away === menu.home) away = (menu.home + 1) % TEAMS.length;
    startGame({ mode: menu.mode, away, home: menu.home, side: menu.side, innings: menu.innings, diff: menu.diff, manual: menu.manual, batter: menu.batter, lockPick: menu.lockPick, ump: menu.ump, fpv: menu.fpv });
  });
  const openHelp = () => { $('help').classList.remove('hidden'); };
  $('btnHow').addEventListener('click', openHelp);
  $('btnHow2').addEventListener('click', openHelp);
  $('btnHelpClose').addEventListener('click', () => $('help').classList.add('hidden'));
  $('btnResume').addEventListener('click', () => togglePause(false));
  $('btnPause').addEventListener('click', () => togglePause(true));
  $('btnMute').addEventListener('click', toggleSound);
  $('btnVoice').addEventListener('click', () => { settings.voice = !settings.voice; saveSettings(); $('btnVoice').textContent = `Commentary voice: ${settings.voice ? 'On' : 'Off'}`; if (!settings.voice) try { speechSynthesis.cancel(); } catch (e) { /* none */ } });
  $('btnZone').addEventListener('click', toggleZone);
  $('btnPen').addEventListener('click', () => {
    if (isGuest()) { netSend({ t: 'act', a: 'pen' }); togglePause(false); return; }
    if (bringReliever(localSide())) { togglePause(false); enterPrePitch(); hudPitcher(); }
  });
  $('btnQuit').addEventListener('click', () => { togglePause(false); toMenu(); });
  $('btnMenu').addEventListener('click', toMenu);
  $('btnAgain').addEventListener('click', () => {
    if (G.mode === 'online') { if (isGuest()) { netSend({ t: 'act', a: 'again' }); $('finalSub').textContent = 'Rematch requested. Waiting for the host…'; } else if (isHost()) hostRestart(); return; }
    showScreen(null); startGame(G.cfg);
  });
  $('btnVoice').textContent = `Commentary voice: ${settings.voice ? 'On' : 'Off'}`;
  $('btnZone').textContent = `Strike zone: ${settings.zone ? 'On' : 'Off'}`;
  muteIcon();
  renderMenu();
}
function toMenu() {
  try { speechSynthesis.cancel(); } catch (e) { /* none */ }
  if (G.mode === 'online') netClose();
  G.mode = 'menu'; G.paused = false; G.replay = null; G.play = null; G.lock = null; G.ctrl = ['cpu', 'cpu']; G.localPitch = false;
  setPhase('menu');
  $('hud').classList.add('hidden'); $('pause').classList.add('hidden');
  document.body.classList.remove('letterbox');
  for (const m of MODELS) m.root.visible = false;
  ballMesh.visible = false; ballShadow.visible = false; trailReset();
  pci.visible = false; reticle.visible = false; zoneGroup.visible = false; pitchMark.visible = false; pitchGuide.visible = false; ctrlRing.visible = false; landMark.visible = false;
  fpvHide(null); fpvOn = false; $('absCard').classList.add('hidden'); $('runHelp').classList.add('hidden'); $('throwPrompt').classList.add('hidden');
  showScreen('menu');
  renderMenu();
}

// -------------------------------------------------------------- main loop ----
const LIVE_BALL = new Set(['live', 'derbyFlight', 'postPlay', 'derbyResult']);
// shared per-frame dressing: occluder fading, ball shadow, ball trail
function dressFrame() {
  const ghost = G.prevCam === 'bat' && ['prePitch', 'windup', 'pitch', 'postPitch'].includes(G.phase) ? 0.28 : 1;
  const cm = G.fByRole.C ? G.fByRole.C.m : isGuest() ? MODELS.find((m) => m.root.visible && m.anim === 'catcher') : null;
  if (cm) setFade(cm, ghost);
  if (G.umps[0]) setFade(G.umps[0], ghost);
  const bp = ballMesh.position;
  const inPlay = LIVE_BALL.has(G.phase) && ballMesh.visible;
  ballShadow.visible = inPlay && bp.y > 0.4;
  if (ballShadow.visible) { ballShadow.position.set(bp.x, groundY(bp.x, bp.z) + 0.08, bp.z); const s = clamp(1 + bp.y / 60, 1, 3); ballShadow.scale.set(s, s, s); ballShadow.material.opacity = clamp(0.45 - bp.y / 400, 0.12, 0.45); }
  const flying = isGuest() ? G.phase === 'live' && bp.y > 0.7 : (G.phase === 'live' || G.phase === 'derbyFlight') && G.play?.ball.mode !== 'held';
  if (flying) trailPush(bp); else if (G.phase !== 'postPlay') trailReset();
}
function update(dt) {
  G.now += dt; G.pt += dt;
  if (G.replay) { updateReplay(dt); return; }
  aimUpdate(dt);
  switch (G.phase) {
    case 'menu': menuCam(dt); break;
    case 'halfIntro': if (G.pt >= G.dur) newBatter(); break;
    case 'prePitch': { const pc = pitchCtrl(); if (pc === 'local') updatePitchUI(); else if (pc === 'cpu' && G.pt >= G.cpuPitchAt) startWindup(G.spec); break; }
    case 'windup': updateWindup(); break;
    case 'pitch': updatePitch(dt); break;
    case 'postPitch':
      if (G.challengeable && G.cpuChallengeAt && G.now >= G.cpuChallengeAt) { startChallenge(G.challengeable.side); break; }
      if (G.pt >= G.dur) endPostPitch();
      break;
    case 'absReview': if (G.pt >= G.dur) revealChallenge(); break;
    case 'postFoul': if (G.pt >= G.dur) enterPrePitch(); break;
    case 'live': updateLive(dt); break;
    case 'postPlay': if (G.pt >= G.dur) afterAB(); break;
    case 'break': if (G.pt >= G.dur) nextHalf(); break;
    case 'derbyFlight': updateDerbyFlight(); playCam(); break;
    case 'derbyResult': if (G.pt >= G.dur) endDerbyResult(); break;
    case 'final': menuCam(dt * 0.6); break;
  }
  dressFrame();
  for (const m of MODELS) updateModel(m, G.now);
  if (G.recOn) recFrame();
  fpvCam();
}
// Player Lock: sim quickly through everything the locked player isn't part of
function lockFF() {
  if (G.mode !== 'lock' || G.replay) return 1;
  if (userBats() || userPitches()) return 1;
  const ph = G.phase;
  if (ph === 'live') {
    const pl = G.play; if (!pl) return 1;
    if (pl.uf && (pl.uf === pl.chaser || pl.uf === pl.ball.holder || pl.prompt || pl.ufManual || pl.uf.task === 'cover')) return 1;
    if (pl.R.some((r) => r.pl.id === G.lock && (r.state === 'run' || r.state === 'base'))) return 1;
    return 3;
  }
  // in first person on the field, slow down so you can react to the hit
  if (G.fpv && lockRole().role === 'field') return ph === 'prePitch' || ph === 'postPitch' || ph === 'postFoul' ? 2 : 1;
  if (['prePitch', 'windup', 'pitch', 'postPitch', 'postFoul'].includes(ph)) return 5;
  if (['postPlay', 'halfIntro', 'break'].includes(ph)) return 3;
  return 1;
}
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (ts - (frame.last || ts)) / 1000)); frame.last = ts;
  G.stick = pollGamepad();
  if (!G.paused && !G.hold) {
    if (isGuest()) guestUpdate(dt);
    else { const n = G.mode === 'lock' ? lockFF() : G.ff > 1 ? G.ff : 1; for (let i = 0; i < n; i++) update(dt); }
  }
  netTick();
  camUpdate(dt);
  const d = camera.position.distanceTo(ballMesh.position);
  ballMesh.scale.setScalar(fpvOn ? clamp(d / 40, 1.5, 8) : clamp(d / 80, 1, 7));
  crowdU.uTime.value += dt;
  crowdU.uEx.value = lerp(crowdU.uEx.value, crowdExTarget, 1 - Math.exp(-dt * 3));
  updateFireworks(dt);
  drawMiniMap();
  renderer.render(scene, camera);
}
function boot() {
  makeUmps();
  netInstallHooks();
  buildMenu();
  ballMesh.visible = false;
  setPhase('menu'); G.mode = 'menu';
  menuCam(0, true);
  showScreen('menu');
  $('loading').classList.add('hidden');
  requestAnimationFrame(frame);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    adTex.image = adCanvas(); adTex.needsUpdate = true;
    adTexLow.image = adCanvas(96, '#16213a'); adTexLow.needsUpdate = true;
  });
  try { speechSynthesis.getVoices(); } catch (e) { /* none */ }
  const join = new URLSearchParams(location.search).get('join');
  if (join) { menu.mode = 'online'; $('joinCode').value = join.toUpperCase(); renderMenu(); netJoin(join); }
}
// Debug handle: lets a test harness advance the simulation without waiting on animation frames.
window.__fullcount = {
  G, TEAMS, settings, NET, keys,
  step(sec, dt = 1 / 60) {
    const n = Math.round(sec / dt);
    for (let i = 0; i < n && !G.paused; i++) { if (isGuest()) guestUpdate(dt); else update(dt); netTick(); }
    camUpdate(dt); renderer.render(scene, camera);
  },
  render() { camUpdate(1 / 60); renderer.render(scene, camera); },
  tick(dt = 1 / 30) { if (isGuest()) guestUpdate(dt); else update(dt); netTick(); },
  setBases(list) { const lu = battingTeam().lineup; G.bases = [null, null, null, null]; for (const b of list) G.bases[b] = lu[(b + 4) % 9]; placeForPitch(); },
  // put a specific ball in play from the current pitch setup (for testing fielding / running)
  forceBall(ev, la, spray) {
    G.P = G.P || { type: 'FF', mph: 94 }; G.cross = G.cross || { x: 0, y: 2.5 };
    launch(ev, la, spray, new V3(0, 3, -0.5), 0.8, false);
  },
  start: (cfg) => startGame(Object.assign({ mode: 'spectate', away: 0, home: 3, side: 1, innings: 9, diff: 1, manual: 0, batter: 3 }, cfg)),
  // fire one batted ball at the current defense and run the play headlessly
  testBall(ev, la, spray, bases = [], outs = 0) {
    for (const f of G.fielders) f.snapHome();
    const bb = simBatted(new V3(0, 3, -0.5), ev, la, spray);
    const lu = battingTeam().lineup;
    const rs = [new Runner(G.batter, G.batterModel, 0), ...bases.map((b) => new Runner(lu[b], getModel(lu[b]), b))];
    const pl = new Play({ bb, fielders: G.fielders, runners: rs, outs });
    const c = pl.chaser && pl.chaser.plan ? { role: pl.chaser.role, t: +pl.chaser.plan.t.toFixed(2), air: pl.chaser.plan.air, dive: pl.chaser.plan.dive } : null;
    let n = 0;
    while (!pl.done && n < 4000) { G.now += 1 / 60; pl.update(1 / 60); n++; }
    const s = pl.summary();
    return { c, land: bb.landT && +bb.landT.toFixed(2), dist: Math.round(bb.dist), hr: bb.hr, foul: s.foul, caught: s.caught, bat: s.batterBase, outs: s.outsMade, runs: s.runs, first: s.first, err: s.error, t: +pl.t.toFixed(1), bases: s.bases.slice(1).map((p) => (p ? 1 : 0)).join('') };
  },
};
boot();
