// ============================================================================
// Presentation: cameras, HUD, videoboards, input, replays, menus, main loop
// ============================================================================

// ---------------------------------------------------------------- cameras ----
const _c1 = new V3(), _c2 = new V3();
// hitting cameras, after MLB The Show's: all sit dead center behind the plate.
// low and tight, dead center behind the plate
const BAT_CAM = { pos: [0, 4.4, 13], look: [0, 0.35, -45], fov: 30 };
function batCam(snap) { G.prevCam = 'bat'; const c = BAT_CAM; camTo(_c1.set(...c.pos), _c2.set(...c.look), c.fov, 5, snap); }
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
  // the guest flies the ball itself, so it follows its own ball (the host's focus only for a home run trot)
  if (isGuest() && G.camFocus && NET.snap && NET.snap.pl && NET.snap.pl.hr) [fx, fy, fz] = G.camFocus;
  else if (isGuest()) { const b = ballMesh.position; fx = b.x; fy = b.y; fz = b.z; }
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

// ------------------------------------------------------ Player Lock cams ----
// G.view: 2 = third person behind your player (The Show style), 1 = first person,
// 0 = broadcast. Hitting always keeps the strike-zone view.
const _eye = new V3(), _look = new V3(), _fwd = new V3();
let fpvHidden = null, fpvOn = false;
const VIEW_NAMES = { 0: 'Broadcast view', 1: 'First-person view', 2: 'Third-person view' };
const LOCK_PHASES = ['prePitch', 'windup', 'pitch', 'postPitch', 'postFoul', 'live', 'postPlay', 'absReview', 'reviewWait'];
// free look: 'track' follows the play automatically; 'free' is wherever you point the mouse / right stick
const FL = { mode: 'track', yaw: 0, pitch: 0 };
function lookDelta(dx, dy) {
  if (!fpvOn) return;
  if (FL.mode !== 'free') {
    lookAcc = 0;
    const lx = camRig.look.x - camRig.pos.x, ly = camRig.look.y - camRig.pos.y, lz = camRig.look.z - camRig.pos.z;
    FL.yaw = Math.atan2(lx, lz); FL.pitch = Math.atan2(ly, Math.hypot(lx, lz)); FL.mode = 'free';
  }
  FL.yaw -= dx * 0.0028; FL.pitch = clamp(FL.pitch - dy * 0.0028, -1.3, 1.3);
}
function lookRecenter() { FL.mode = 'track'; }
// Mouse look needs no click: moving the mouse turns the camera (after a few pixels, so a nudge
// doesn't stop it following the play), and resting it near the left or right edge keeps
// turning. Clicking still locks the pointer for unlimited turning.
let mouseIn = false, lookAcc = 0, lookAt = 0;
function mouseLook(dx, dy) {
  if (FL.mode !== 'free') {
    const now = performance.now();
    if (now - lookAt > 300) lookAcc = 0;
    lookAt = now; lookAcc += Math.abs(dx) + Math.abs(dy);
    if (lookAcc < 10) return;
  }
  lookDelta(dx, dy);
}
function edgeTurn(dt) {
  if (!fpvOn || G.paused || !mouseIn || lastPointer !== 'mouse' || document.pointerLockElement === canvasEl || userPitches() || catcherAiming()) return;
  const x = mouseNDC.x, e = 0.85;
  if (Math.abs(x) > e) lookDelta(Math.sign(x) * Math.min(1, (Math.abs(x) - e) / (1 - e)) * 650 * dt, 0);
}
function exitPointerLock() { if (document.pointerLockElement) try { document.exitPointerLock(); } catch (e) { /* not locked */ } }
function fpvActive() { return (G.mode === 'lock' || (!!G.squad && !!G.lock)) && G.view > 0 && !G.replay && LOCK_PHASES.includes(G.phase); }
// Where your player is and what he's doing, for the Player Lock cameras (an online squad too):
// role 'field', 'run', 'bat' or 'dugout', his model, and what the third-person camera needs:
// frole (his position in the field), hasBall / holding (he has it / and it's yours to throw),
// running, to, base and batter (on the bases), live, hr and t (the play and its clock)
function lockRole() {
  if (userCatches() && G.phase !== 'live' && G.phase !== 'postPlay') return { role: 'bat' };   // calling and framing: the strike-zone view
  if (isGuest()) return guestLockRole();
  const pl = G.play, live = (G.phase === 'live' || G.phase === 'postPlay') && !!pl;
  const V = { live, hr: live && !!pl.hr, t: live ? pl.t : 0 };
  if (G.half === 1 - G.lockSide) {
    const f = G.fielders.find((x) => x.pl.id === G.lock);
    if (!f) return { ...V, role: 'dugout' };
    const hasBall = live && pl.ball.holder === f;
    return { ...V, role: 'field', m: f.m, frole: f.role, hasBall, holding: hasBall && !!pl.ctlOf(f) && pl.humanHolder(f) };
  }
  const runner = (r) => (r ? { ...V, role: 'run', m: r.m, running: r.state === 'run', to: heading(r), base: r.base, batter: r.isBatter } : { ...V, role: 'dugout' });
  if (live) return runner(pl.R.find((x) => x.pl.id === G.lock && (x.state === 'run' || x.state === 'base')));
  if (G.batter && G.batter.id === G.lock) return { ...V, role: 'bat' };
  return runner((G.baseRunners || []).find((x) => x.pl.id === G.lock));
}
// the same, on an online guest: from the host's snapshots
function guestLockRole() {
  const live = G.phase === 'live' || G.phase === 'postPlay', sp = NET.lastPl, m = myModel();
  const V = { live, hr: live && !!(sp && sp.hr), t: NET.pclock.t };
  if (G.batter && G.batter.id === G.lock && !live) return { ...V, role: 'bat' };
  if (!m) return { ...V, role: 'dugout' };
  if (m.fielding) {
    const ti = 1 - G.half, me = (G.lu[ti] || []).find((p) => p.id === G.lock);
    const hasBall = live && !!sp && Array.isArray(sp.bm) && sp.bm[0] === 'h' && sp.bm[1] === m.key;
    return { ...V, role: 'field', m, frole: G.pitcher[ti] && G.pitcher[ti].id === G.lock ? 'P' : me ? me.pos : 'P', hasBall, holding: hasBall && userFields() };
  }
  const r = ((NET.snap && NET.snap.run) || []).find((x) => x[0] === G.lock);
  return { ...V, role: 'run', m, running: !!(r && r[4]), to: r ? clamp(r[1] | 0, 1, 4) : 1, base: r ? clamp(r[3] | 0, 0, 3) : 0, batter: !!(r && r[9]) };
}
function setModelLayer(m, layer) { m.root.traverse((o) => { if (o.isMesh) o.layers.set(layer); }); }
function fpvHide(m) {
  if (fpvHidden === m) return;
  if (fpvHidden) setModelLayer(fpvHidden, 0);
  fpvHidden = m || null;
  if (m) setModelLayer(m, 1);
}
// hand the camera back to the broadcast cameras for the current phase
function restoreCam() {
  if (G.replay || !LOCK_PHASES.includes(G.phase)) return;   // other phases set their own camera
  if (G.phase === 'live' || G.phase === 'postPlay') playCam();
  else if (userPitches()) pitchCam(true); else if (userBats() || userCatches()) batCam(true); else cfCam(true);
}
function lockCamOff() {
  fpvHide(null); tpUmpGhost = false;
  if (fpvOn) { fpvOn = false; exitPointerLock(); restoreCam(); }
  return false;
}
function fpvCam(dt = 1 / 60) {
  if (!fpvActive()) return lockCamOff();
  const L = lockRole();
  if (L.role === 'bat') return lockCamOff();
  if (G.view === 2) return tpCam(L, dt) || lockCamOff();
  let fov = 64;
  if (L.role === 'dugout') {
    fpvHide(null);
    // at the dugout rail, in front of the wall, looking in at the field
    const sgn = G.lockSide === 1 ? 1 : -1;
    _eye.set(sgn * Math.SQRT1_2 * 100, 4.8, Math.SQRT1_2 * -40); _look.set(0, 3, -55); fov = 55;
  } else {
    const m = L.m;
    fpvHide(m);
    m.root.updateMatrixWorld(true);
    m.j.neck.getWorldPosition(_eye); _eye.y += 0.5;
    const yaw = m.root.rotation.y; _eye.x += Math.sin(yaw) * 0.35; _eye.z += Math.cos(yaw) * 0.35;
    const b = ballMesh.position;
    if (L.live) {
      if (L.hasBall) _look.set(0, 3, -64);
      else _look.copy(b);
      if (_look.distanceTo(_eye) < 2.5) _look.set(_eye.x + Math.sin(yaw) * 10, _eye.y - 2, _eye.z + Math.cos(yaw) * 10);
      fov = 68;
    } else if (L.role === 'field' && L.frole === 'P') { _look.set(0, 2.6, 0); fov = userPitches() ? 21 : 45; }
    else if (L.role === 'field' && L.frole === 'C') { _look.set(0, 5.5, -58); fov = 48; }
    else if (L.role === 'field') { _look.set(0, 3.2, 0); fov = 44; if (G.phase === 'pitch') _look.lerp(b, 0.25); }
    else _look.set(0, 3, 0);
  }
  if (FL.mode === 'free') {
    if (userPitches()) FL.mode = 'track';
    else {
      const cp = Math.cos(FL.pitch);
      _look.set(_eye.x + Math.sin(FL.yaw) * cp * 60, _eye.y + Math.sin(FL.pitch) * 60, _eye.z + Math.cos(FL.yaw) * cp * 60);
      camRig.look.copy(_look);
    }
  }
  if (!fpvOn) { camRig.look.copy(_look); camRig.fov = fov; }
  camRig.pos.copy(_eye); camRig.tp.copy(_eye); camRig.tl.copy(_look); camRig.tf = fov; camRig.rate = 9;
  fpvOn = true;
  return true;
}

// Third person: the camera sits behind your player and turns toward whatever matters
// (home plate before the pitch, the ball in play, the base you're running to, the base
// you're about to throw to). The mouse / right stick swings it around your player.
const TP = { yaw: 0, pitch: 0, half: 0.45, blend: 0, holding: false, aimYaw: null };
const _tpT = new V3();
let tpUmpGhost = false;
function tpCam(L, dt) {
  const live = L.live;
  if (L.role === 'dugout' || G.simAB) return false;
  if (L.role === 'field' && G.lockFieldSim) return false;
  if (live && L.hr) return false;                                    // watch the home run on TV
  if (L.role === 'field' && L.frole === 'P' && !live && userPitches()) return false;   // behind-the-mound pitching view
  if (L.role === 'run' && L.batter && live && L.t < 1.3) return false;                 // see the ball off the bat first
  fpvHide(null);
  const P = L.m.root.position, b = ballMesh.position;
  // what the camera turns toward
  // deeper fielders get a longer, lower camera so the plate stays in the shot
  const far = clamp((Math.hypot(P.x, P.z) - 120) / 180, 0, 1), TP_DIST = 18 + 6 * far, TP_HEIGHT = 12.5 - 2 * far;
  let yawT = null, minHalf = 0.48;
  const toward = (x, y, z, near = 0) => { _tpT.set(x, y, z); if (Math.hypot(x - P.x, z - P.z) > near) yawT = Math.atan2(x - P.x, z - P.z); };
  const holding = live && L.role === 'field' && L.holding;
  // just got the ball: face the base the smart throw goes to
  if (holding && !TP.holding) TP.aimYaw = G.sug ? Math.atan2(BASES[G.sug].x - P.x, BASES[G.sug].z - P.z) : null;
  TP.holding = holding;
  if (L.role === 'field' && !live) {
    if (L.frole === 'C') toward(0, 4.5, MOUND_Z); else toward(0, 3, 0);
    minHalf = lerp(0.45, 0.38, far);
  } else if (L.role === 'field') {
    if (holding) { _tpT.set(P.x + Math.sin(TP.yaw) * 60, 3, P.z + Math.cos(TP.yaw) * 60); yawT = TP.aimYaw; }
    else if (L.hasBall) _tpT.set(P.x + Math.sin(TP.yaw) * 60, 3, P.z + Math.cos(TP.yaw) * 60);
    else toward(b.x, b.y, b.z, 16);
  } else if (!live) toward(0, 5, MOUND_Z);                            // leading off: watch the pitcher
  else if (L.running && BASES[L.to]) { const nb = BASES[L.to]; toward(nb.x, 3, nb.z, 8); }
  else if (Math.hypot(b.x - P.x, b.z - P.z) > 25) toward(b.x, b.y, b.z);
  else { const nb = BASES[Math.min(4, L.base + 1)]; toward(nb.x, 3, nb.z, 8); }
  const free = FL.mode === 'free';
  if (yawT == null) yawT = TP.yaw;
  if (!fpvOn) { TP.yaw = free ? FL.yaw : yawT; TP.blend = 0.9; }
  else if (free) TP.yaw = FL.yaw;
  else { const d = angDiff(TP.yaw, yawT) * (1 - Math.exp(-(holding ? 8 : 3.5) * dt)), mx = (holding ? 6 : 2.8) * dt; TP.yaw += clamp(d, -mx, mx); }
  // camera spot behind the player, pulled in (and up) when a wall is in the way
  const fx = Math.sin(TP.yaw), fz = Math.cos(TP.yaw);
  let k = 1;
  while (k > 0.25 && !inPoly(P.x - fx * TP_DIST * k, P.z - fz * TP_DIST * k)) k -= 0.1;
  const D = TP_DIST * k;
  _eye.set(P.x - fx * D, P.y + TP_HEIGHT + (1 - k) * 7, P.z - fz * D);
  // tilt / zoom so both your player and the target are in the shot when possible
  const eFeet = Math.atan2(P.y - _eye.y, D);
  const eT = Math.atan2(_tpT.y - _eye.y, Math.max(1, Math.hypot(_tpT.x - _eye.x, _tpT.z - _eye.z)));
  let half = live ? clamp((eT - eFeet) / 1.7, minHalf, 0.62) : minHalf;
  let pitch = Math.max(Math.min(eT, eFeet + half * 0.8), eT - half * (live ? 0.85 : 0.6));   // player low in the frame, target above
  if (free) { pitch = clamp(FL.pitch, -0.75, 1.25); FL.pitch = pitch; half = minHalf; }
  if (!fpvOn) { TP.pitch = pitch; TP.half = half; }
  else { const s = 1 - Math.exp(-(free ? 30 : 5) * dt); TP.pitch = lerp(TP.pitch, pitch, s); TP.half = lerp(TP.half, half, 1 - Math.exp(-4 * dt)); }
  const cp = Math.cos(TP.pitch);
  _look.set(_eye.x + fx * cp * 60, _eye.y + Math.sin(TP.pitch) * 60, _eye.z + fz * cp * 60);
  camRig.tp.copy(_eye); camRig.tl.copy(_look); camRig.tf = (TP.half * 2) / DEG;
  if (TP.blend > 0) { TP.blend -= dt; camRig.rate = 3.2; } else camRig.rate = 20;
  tpUmpGhost = L.role === 'field' && L.frole === 'C' && !live;
  fpvOn = true;
  return true;
}

// -------------------------------------------------------------------- HUD ----
let fbTimer = 0;
function setHint(html) { const el = $('hint'); el.innerHTML = relabelKeys(html); el.style.opacity = html ? 1 : 0; }
function liveHint() {
  const parts = [];
  if (userFields()) parts.push('<kbd>WASD</kbd> move', '<kbd>Space</kbd> dive', G.lock ? '' : '<kbd>Q</kbd> switch', '<kbd>1</kbd>&ndash;<kbd>4</kbd> throw');
  if (userRuns()) parts.push('<kbd>E</kbd> advance', '<kbd>Q</kbd> back', G.lock ? '' : '<b>click a runner</b> to run just him');
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
  const ps = pstat(p), up = userPitches(), calling = !up && G.catchUI.state === 'call' && userCatches();
  const sel = up ? G.pitchUI.sel : calling ? G.catchUI.sel : -1;
  teamHead($('pitcherCard').querySelector('.plate-head'), p.team);
  $('pHead').textContent = `#${p.num} · ${p.pos === 'SP' ? 'STARTER' : 'RELIEVER'}`;
  $('pHand').textContent = p.throws === 'L' ? 'LHP' : 'RHP';
  $('pName').textContent = p.name;
  $('pLine').textContent = `${ps.pc} P · ${Math.floor(ps.outs / 3)}.${ps.outs % 3} IP · ${ps.k} K · ${ps.h} H · ${ps.bb} BB`;
  const st = clamp(1 - ps.pc / pitchLimit(p), 0, 1);
  $('pStam').style.width = st * 100 + '%';
  $('pStam').style.background = st > 0.45 ? 'var(--ball)' : st > 0.2 ? 'var(--gold)' : 'var(--strike)';
  $('pitcherCard').classList.toggle('cpu', !up && !calling);
  $('pitchList').innerHTML = p.pitches.map((pt, i) => `<div class="pitch-row ${i === sel ? 'sel' : ''}" data-i="${i}"><span class="key">${i + 1}</span><span class="pname"><i class="dot" style="background:${PITCH_TYPES[pt.type].col}"></i>${PITCH_TYPES[pt.type].name}</span><span class="mph">${Math.round(pt.velo - fatigue(p) * 2.4)} mph</span></div>`).join('');
  hudLock();
}
function hudLock() {
  if ((G.mode !== 'lock' && !G.squad) || !G.lock || !PBYID[G.lock]) return;
  const p = PBYID[G.lock], s = G.stats.get(p.id), ps = G.pstats.get(p.id);
  $('lockName').textContent = shortName(p.name);
  let line = `${p.pos} · #${p.num}`;
  if (p.pos === 'SP') { if (ps && (ps.outs || ps.pc)) line = `${Math.floor(ps.outs / 3)}.${ps.outs % 3} IP · ${ps.k} K · ${ps.r} R`; }
  else if (s && s.pa) line = statLine(s);
  $('lockLine').textContent = line;
}
function hudCall(text, cls) { G.lastCallText = text; const el = $('call'); el.className = ''; el.textContent = text; void el.offsetWidth; el.className = 'show ' + cls; }
function hudBanner(main, sub, cls) {
  G.lastCallText = main;
  const el = $('banner'); el.className = '';
  el.querySelector('.b-main').textContent = main; el.querySelector('.b-sub').textContent = sub || '';
  void el.offsetWidth; el.className = 'show ' + (cls || '');
}
let piTimer = 0;
function hudPitchInfo(info) {
  info = info || (G.P && { mph: G.P.mph, type: G.P.type });
  if (!info || !info.mph) return;   // a fungo has no pitch
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
// The swing card after every swing, like MLB The Show's: who swung, a swing-timing gauge (early
// on the left, late on the right, the needle where you were) and your PCI against the pitch.
const SA_COL = { PERFECT: '#3fd38a', GOOD: '#b6f09c', EARLY: '#f1c40f', LATE: '#f1c40f', 'VERY EARLY': '#ff5a5f', 'VERY LATE': '#ff5a5f', BUNT: '#e8edf5' };
function saGauge(c) {
  const cx = 80, cy = 84, R = 62, span = (c.wo || 1) * 1.6, ang = (v) => Math.PI - (clamp(v / span, -1, 1) + 1) * (Math.PI / 2);
  const pt = (a, r) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy - Math.sin(a) * r).toFixed(1)}`;
  const arc = (v0, v1, col) => `<path d="M ${pt(ang(v0), R)} A ${R} ${R} 0 0 1 ${pt(ang(v1), R)}" stroke="${col}" stroke-width="15" fill="none"/>`;
  const { wp = 0.1, wg = 0.2, wo = 0.3 } = c, S = span;
  let svg = arc(-S, -wo, '#c0392b') + arc(-wo, -wg, '#e67e22') + arc(-wg, -wp, '#f1c40f') + arc(-wp, wp, '#2ecc71') + arc(wp, wg, '#f1c40f') + arc(wg, wo, '#e67e22') + arc(wo, S, '#c0392b');
  for (const v of [-wo, -wg, -wp, wp, wg, wo]) { const [x1, y1] = pt(ang(v), R - 8).split(' '), [x2, y2] = pt(ang(v), R + 8).split(' '); svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0b1220" stroke-width="1.5"/>`; }
  svg += '<text x="10" y="91" fill="#8b97ad" font-size="8" font-weight="700" letter-spacing="1">EARLY</text><text x="150" y="91" fill="#8b97ad" font-size="8" font-weight="700" letter-spacing="1" text-anchor="end">LATE</text>';
  if (c.timing !== 'BUNT') {
    const a = ang(c.e), [nx, ny] = pt(a, R + 4).split(' ');
    svg += `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="#fff"/>`;
  }
  return svg;
}
function saZone(c) {
  const k = 31, mid = (ZONE.top + ZONE.bot) / 2, X = (x) => 60 + x * k, Y = (y) => 56 - (y - mid) * k;
  const zl = X(-ZONE.halfW), zr = X(ZONE.halfW), zt = Y(ZONE.top), zb = Y(ZONE.bot);
  let svg = `<rect x="${zl}" y="${zt}" width="${zr - zl}" height="${zb - zt}" fill="rgba(255,255,255,.05)" stroke="#e8edf5" stroke-width="2"/>`;
  for (const f of [1 / 3, 2 / 3]) { const x = zl + (zr - zl) * f, y = zt + (zb - zt) * f; svg += `<line x1="${x}" y1="${zt}" x2="${x}" y2="${zb}" stroke="rgba(255,255,255,.25)"/><line x1="${zl}" y1="${y}" x2="${zr}" y2="${y}" stroke="rgba(255,255,255,.25)"/>`; }
  if (c.pci) {
    const p = c.pci;
    svg += `<ellipse cx="${X(p.x)}" cy="${Y(p.y)}" rx="${(p.w || 0.6) * k}" ry="${(p.h || 0.45) * k}" fill="rgba(255,255,255,.1)" stroke="#fff" stroke-width="1.5"/><ellipse cx="${X(p.x)}" cy="${Y(p.y)}" rx="${(p.w || 0.6) * k * 0.32}" ry="${(p.w || 0.6) * k * 0.32}" fill="none" stroke="#ffc94a" stroke-width="1.5"/>`;
  }
  if (c.ball) {
    const col = (PITCH_TYPES[c.pt] || {}).col || '#fff';
    svg += `<circle cx="${X(c.ball.x)}" cy="${Y(c.ball.y)}" r="${Math.max(3.5, BALL_R * k * 1.6)}" fill="${col}" stroke="#0b1220" stroke-width="1.5"/>`;
  }
  return svg;
}
function showFeedback(c) {
  const fb = $('feedback'), b = G.batter;
  if (b && b.team) {
    const lg = $('saLogo'); lg.textContent = b.team.id; lg.style.background = b.team.c1; lg.style.color = b.team.c2; lg.style.borderColor = b.team.c2;
    $('saNum').textContent = b.num ?? ''; $('saSide').textContent = G.batSide || b.bats || ''; const nm = $('saName'); nm.textContent = String(b.name || '').split(' ').slice(1).join(' ') || b.name || ''; nm.title = b.name || '';
    $('saRat').innerHTML = [['CON', b.con], ['POW', b.pow], ['EYE', b.eye]].map(([l, v]) => `<div><b>${v ?? '–'}</b><small>${l}</small></div>`).join('');
  }
  if (c) {
    const tEl = $('fbTiming');
    tEl.textContent = c.timing; tEl.style.color = SA_COL[c.timing] || 'var(--gold)';
    $('saGauge').innerHTML = saGauge(c);
    $('saZone').innerHTML = saZone(c);
    const pt = PITCH_TYPES[c.pt];
    $('saPitch').innerHTML = pt ? `<span style="color:${pt.col}">${pt.short}</span> ${c.mph}mph` : '';
    $('fbContact').textContent = c.contact;
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
  const col = resultCol;
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
    $('btnAgain').classList.toggle('hidden', NET.role === 'spec');
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
  if (isGuest()) { if (G.chkMine) netSend({ t: 'act', a: 'challenge' }); return; }
  if (G.phase === 'reviewWait' && G.review && G.review.who === 'local') { startReview(); return; }
  const c = G.challengeable;
  if (c && (c.who === 'local' || (c.who === 'squad' && c.sids.includes(G.me)))) startChallenge(c.side);
}

// while you hold the ball: 1-4 throw to a base, and the smart throw is ringed in green
const BASE_NAMES = { 1: 'first', 2: 'second', 3: 'third', 4: 'home' };
function updateThrowGuide() {
  const pl = G.play, f = pl && G.phase === 'live' && !pl.done ? pl.ball.holder : null, me = f ? localCtl(pl) : null;
  const mine = !!f && !!me && f === me.f && pl.humanHolder(f) && !f.throwing && fieldCtrl() === 'local';
  if (!mine) G.sugFor = null;
  else if (G.sugFor !== f) { G.sugFor = f; G.sug = pl.chooseThrow(f).base || (f.isOF ? 2 : 0); }
  const sb = mine ? G.sug : 0;
  baseMark.visible = !!sb;
  if (sb) baseMark.position.set(BASES[sb].x, 0.15, BASES[sb].z);
  if (mine !== !!G.aimShown) {
    G.aimShown = mine;
    setHint(mine ? `Throw: <kbd>1</kbd> first &middot; <kbd>2</kbd> second &middot; <kbd>3</kbd> third &middot; <kbd>4</kbd> home${sb ? ` &middot; best: <b>${BASE_NAMES[sb]}</b>` : ''}` : G.phase === 'live' ? liveHint() : '');
  }
}
function skipText() {
  if (G.simAB) return 'Skipping to the next batter';
  const fielding = G.half === 1 - G.lockSide;
  if (fielding && !G.lockFieldSim && G.fielders.some((f) => f.pl.id === G.lock)) return 'In the field: waiting for a ball hit your way';
  const idx = G.lu[G.lockSide].findIndex((p) => p.id === G.lock);
  if (idx < 0) return fielding ? 'Your team is in the field' : 'Your team is batting';
  const k = (idx - G.order[G.lockSide] + 9) % 9;
  if (fielding) return k ? `Next: your at-bat (${ordinal(k + 1)} up next inning)` : 'Next: your at-bat (leading off next inning)';
  return k === 1 ? 'Next: your at-bat (on deck)' : `Next: your at-bat (${k} batters away)`;
}
// the SIMULATING card, with game sound and commentary muted while it's up
function updateSkipUI() {
  const on = G.mode === 'lock' && G.skipping && !G.paused;
  if (on !== !!updateSkipUI.on) {
    updateSkipUI.on = on;
    $('simVeil').classList.toggle('hidden', !on);
    document.body.classList.toggle('skipping', on);
    if (SND.master) SND.master.gain.value = on || !settings.sound ? 0 : gameVolume();
    if (on) { try { speechSynthesis.cancel(); } catch (e) { /* none */ } exitPointerLock(); }
    else $('banner').className = '';   // an inning banner the skip raced past
  }
  if (on) {
    const t = skipText();
    if ($('simNext').dataset.t !== t) { $('simNext').dataset.t = t; $('simNext').innerHTML = t; $('simVeil').querySelector('.sim-foot').textContent = "Player Lock skips plays you aren't part of"; }
  }
}
function updateLockUI() {
  const show = G.mode === 'lock' && !G.simAB && !G.replay && ['prePitch', 'windup', 'pitch', 'postPitch', 'live', 'postPlay', 'postFoul'].includes(G.phase);
  $('simBtn').classList.toggle('hidden', !show);
}

// ------------------------------------------------------- baserunning HUD ----
// Click a runner (on the field, his tag, the mini diamond or the runner panel) to pick
// him; E / Q then run just him. Click him again, or empty grass, to go back to everyone.
// Holding his base key (1-3, 4 = home, same as throwing) with E / Q still works too.
const BASE_KEY = { 1: 1, 2: 2, 3: 3, 4: 4, arrowright: 1, arrowup: 2, arrowleft: 3, arrowdown: 4 };
const BASE_ABBR = ['HOME', '1B', '2B', '3B', 'HOME'];
function heldBase() { for (const k in BASE_KEY) if (keys.has(k)) return BASE_KEY[k]; return 0; }
function runnerList() {
  let L;
  if (isGuest()) {
    const raw = (NET.snap && NET.snap.run) || [];
    L = raw.map(([id, key, to, from, run, rev, user, mk, steal]) => ({ id, key, to, from, run: !!run, rev: !!rev, user: !!user, steal: !!steal, m: modelByKey(mk) }));
  } else L = G.play ? G.play.runnerInfo() : STEAL_PHASES.includes(G.phase) ? stealInfo() : [];
  return G.lock ? L.filter((r) => r.id === G.lock) : L;
}
function runnerIdAt(b) { const L = runnerList(); const r = L.find((x) => x.key === b && x.run) || L.find((x) => x.key === b); return r ? r.id : null; }
// the runner you picked, if he's still out there
function selRunner() { const id = G.selRunner; return id && runnerList().some((r) => r.id === id) ? id : null; }
function selectRunner(id) {
  G.selRunner = id && G.selRunner !== id ? id : null; rhSig = null;
  SND.init(); if (SND.ctx) SND.tick();
}
// E / Q: the runner on a held base key, else the runner you picked, else everyone
function runKey(kind, base = heldBase()) {
  if (base) { const id = runnerIdAt(base); if (id) actRun(kind, id); return; }
  actRun(kind, selRunner());
}
// a click on the field during a play: the runner nearest the click on screen, if any
const _pickV = new V3();
function pickRunnerAt(x, y) {
  let best = null, bd = 70;
  for (const r of runnerList()) {
    const m = r.m; if (!m || !m.root.visible) continue;
    _pickV.copy(m.root.position); _pickV.y += 3.5; _pickV.project(camera);
    if (_pickV.z > 1) continue;
    const d = Math.hypot(((_pickV.x + 1) / 2) * window.innerWidth - x, ((1 - _pickV.y) / 2) * window.innerHeight - y);
    if (d < bd) { bd = d; best = r; }
  }
  if (best) selectRunner(best.id); else if (G.selRunner) selectRunner(null);
}
// the ring under the runner you picked
const selRing = new THREE.Mesh(new THREE.RingGeometry(2.3, 3.0, 40), new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.9, depthWrite: false }));
selRing.rotation.x = -Math.PI / 2; selRing.renderOrder = 3; selRing.visible = false; scene.add(selRing);
// runners on base before the pitch (or breaking during it): key = the base he's on
function stealInfo() {
  return (G.baseRunners || []).filter((r) => r.state === 'run' || r.state === 'base').map((r) => {
    const run = r.state === 'run';
    return { id: r.pl.id, key: run ? r.next : r.base, to: run ? r.next : r.steal ? r.base + 1 : r.base, from: r.base, run, rev: false, user: !!r.steal, steal: !!r.steal, m: r.m };
  });
}
function runnerPath(r) {
  if (r.steal && !r.run) return { cls: 'go', txt: `STEALING ${BASE_ABBR[r.to]}`, tag: `STEAL ${BASE_ABBR[r.to]}` };
  if (!r.run && STEAL_PHASES.includes(G.phase)) return { cls: 'hold', txt: `ON ${BASE_ABBR[r.key]}`, tag: `ON ${BASE_ABBR[r.key]}` };
  if (r.run && r.rev) return { cls: 'back', txt: `BACK TO ${BASE_ABBR[r.to]}`, tag: `&#9664; ${BASE_ABBR[r.to]}` };
  if (r.run) return { cls: 'go', txt: `${BASE_ABBR[r.from]} &rarr; ${BASE_ABBR[r.to]}`, tag: `&rarr; ${BASE_ABBR[r.to]}` };
  if (r.to > r.key) return { cls: 'go', txt: `GOING TO ${BASE_ABBR[r.to]}`, tag: `&rarr; ${BASE_ABBR[r.to]}` };
  return { cls: 'hold', txt: `HOLDING ${BASE_ABBR[r.key]}`, tag: 'HOLD' };
}
let rhSig = null;
const runTagEls = new Map(), _tagV = new V3();
function runnerHUD(show) {
  const L = show ? runnerList() : [];
  $('runHelp').classList.toggle('hidden', !L.length);
  $('runHelp').classList.toggle('pre', STEAL_PHASES.includes(G.phase));   // before the pitch: compact, out of the hitting view
  L.sort((a, b) => b.key - a.key);
  const sel = L.length ? selRunner() : null, pre = STEAL_PHASES.includes(G.phase);
  const sig = L.map((r) => [r.id, r.key, r.to, r.from, r.run, r.rev, r.user].join()).join('|') + '#' + sel + pre;
  if (sig !== rhSig) {
    rhSig = sig;
    const sp = sel && PBYID[sel];
    $('rhTip').innerHTML = sp ? `<b>${esc(lastName(sp.name))}</b> picked &middot; <kbd>E</kbd>/<kbd>Q</kbd> run him &middot; click him again for everyone`
      : `click a runner to pick him, then <kbd>E</kbd>/<kbd>Q</kbd>`;
    $('rhAll').innerHTML = sp ? `<button data-run="go" data-id="${esc(sel)}">Send ${esc(lastName(sp.name))} <kbd>E</kbd></button><button data-run="back" data-id="${esc(sel)}">${pre ? 'Call it off' : 'Hold / back'} <kbd>Q</kbd></button><button data-pickall="1">Pick everyone</button>`
      : `<button data-run="go">${pre ? 'Everyone steals' : 'All advance'} <kbd>E</kbd></button><button data-run="back">${pre ? 'Call it off' : 'All go back'} <kbd>Q</kbd></button>`;
    $('runList').innerHTML = L.map((r) => {
      const p = runnerPath(r), pl = PBYID[r.id];
      return `<div class="rh-row ${r.user ? 'user' : ''} ${r.id === sel ? 'sel' : ''}" data-pickid="${esc(r.id)}" title="Click to pick him"><b class="rh-key">${r.key}</b><span class="rh-name">${esc(pl ? lastName(pl.name) : '')}</span><span class="rh-path ${p.cls}">${p.txt}</span>`
        + `<button data-run="back" data-id="${esc(r.id)}" title="${pre ? 'Call off his steal' : 'Take a base back'}">&#9664;</button><button data-run="go" data-id="${esc(r.id)}" title="${pre ? 'Steal' : 'One more base'}">&#9654;</button></div>`;
    }).join('');
  }
  // a little tag over each runner's head: his key and where he's going
  const seen = new Set(), W = window.innerWidth, H = window.innerHeight;
  for (const r of L) {
    const m = r.m; if (!m || !m.root.visible) continue;
    _tagV.copy(m.root.position); _tagV.y += 7.2; _tagV.project(camera);
    if (_tagV.z > 1 || Math.abs(_tagV.x) > 1.1 || Math.abs(_tagV.y) > 1.1) continue;
    let el = runTagEls.get(r.id);
    if (!el) { el = document.createElement('div'); $('runTags').appendChild(el); runTagEls.set(r.id, el); }
    const p = runnerPath(r), s = `${r.key}|${p.tag}|${r.user}|${r.id === sel}`;
    if (el.dataset.sig !== s) { el.dataset.sig = s; el.dataset.id = r.id; el.className = `run-tag ${p.cls} ${r.user ? 'user' : ''} ${r.id === sel ? 'sel' : ''}`; el.innerHTML = `<b>${r.key}</b>${p.tag}`; }
    el.style.left = ((_tagV.x + 1) / 2) * W + 'px'; el.style.top = ((1 - _tagV.y) / 2) * H + 'px';
    seen.add(r.id);
  }
  for (const [id, el] of runTagEls) if (!seen.has(id)) { el.remove(); runTagEls.delete(id); }
  const sr = sel && L.find((r) => r.id === sel);
  selRing.visible = !!(sr && sr.m && sr.m.root.visible);
  if (selRing.visible) selRing.position.set(sr.m.root.position.x, groundY(sr.m.root.position.x, sr.m.root.position.z) + 0.14, sr.m.root.position.z);
}

// pitching with runners on: buttons to throw over (Shift + 1 / 2 / 3 on the keyboard)
let pickSig = null;
function pickoffHUD() {
  const on = G.phase === 'prePitch' && !G.replay && userPitches() && G.pitchUI.state === 'aim' && G.mode !== 'derby';
  const bases = on ? [1, 2, 3].filter((b) => G.bases[b]) : [];
  const sig = bases.join('');
  if (sig === pickSig) return;
  pickSig = sig;
  $('pickHelp').classList.toggle('hidden', !bases.length);
  $('pickList').innerHTML = bases.map((b) => `<button data-pick="${b}">${BASE_ABBR[b]}<small>Shift+${b}</small></button>`).join('');
}
// practice: a running tally for the drill you're doing
function hudPrac() {
  if (!G.drill || !G.prac) return;
  const p = G.prac, pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');
  const cells = {
    bat: [['PITCHES', p.pitches], ['CONTACT', pct(p.contact, p.swings)], ['HITS', p.hits], ['HR', p.hr], ['AVG EV', p.evN ? (p.evSum / p.evN).toFixed(1) : '–']],
    pitch: [['PITCHES', p.pitches], ['STRIKE %', pct(p.strikes, p.pitches)], ['K', p.k], ['BB', p.bb], ['HITS', p.hits]],
    run: [['STOLEN', p.sb], ['CAUGHT', p.cs], ['RUNS', p.runs], ['OUT ON BASES', p.picked]],
    field: [['BALLS', p.chances], ['OUTS', p.outs], ['ERRORS', p.errors], ['HITS', p.hits]],
  }[G.drill];
  $('pracHud').innerHTML = `<div class="ph-name">${DRILLS[G.drill].name.toUpperCase()}</div>` + cells.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
}

// ------------------------------------------------------------ runner map ----
// live mini diamond: where every runner, fielder and the ball are right now
function drawMiniMap() {
  const el = $('miniMap');
  const show = G.teams && G.mode !== 'derby' && G.mode !== 'menu' && !G.replay && !['menu', 'boot', 'break', 'final', 'wait', 'halfIntro'].includes(G.phase)
    && (G.mode === 'lock' || !!G.squad || G.phase === 'live' || G.phase === 'postPlay' || G.bases.some(Boolean));
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const runners = userRuns() && !G.lock && (G.phase === 'live' || STEAL_PHASES.includes(G.phase)) ? runnerList() : [];
  el.classList.toggle('pick', runners.length > 0);
  const g = el.getContext('2d');
  const P = mapPt, ox = 150, oy = 262;
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
    const p = m.root.position, me = m.pl.id === G.lock, seat = G.squad ? seatOf(m.pl.id) : null;
    const ring = seat ? seat.col : me || m.key === ufKey ? '#ffc94a' : null;   // a squad: everyone's man in his color
    if (m.fielding) dot(p.x, p.z, me || seat ? 9 : 7, m.pl.team.c1, ring || 'rgba(255,255,255,0.8)', ring ? 4 : 2);
    else if (m.j.helmet.visible) dot(p.x, p.z, me || seat ? 11 : 9, seat ? seat.col : '#ffc94a', me ? '#ffffff' : '#081020', 4);
  }
  if (ballMesh.visible) { const b = ballMesh.position; dot(b.x, b.z, 4 + Math.min(5, b.y / 25), '#ffffff', '#081020', 2); }
  const sid = runners.length ? selRunner() : null, sr = sid && runners.find((r) => r.id === sid);
  if (sr && sr.m) { const [px, py] = P(sr.m.root.position.x, sr.m.root.position.z); g.beginPath(); g.arc(px, py, 16, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = '#5aa8ff'; g.stroke(); }
}
// world (x, z) to the mini diamond's 300x300 canvas; far-away things are pulled in to the edge
function mapPt(x, z) {
  const s = 1.02, ox = 150, oy = 262, vx = x * s, vz = z * s;
  const k = Math.min(1, 138 / Math.max(1e-6, Math.abs(vx)), 250 / Math.max(1e-6, -vz), 28 / Math.max(1e-6, vz));
  return [ox + vx * k, oy + vz * k];
}
$('miniMap').addEventListener('pointerdown', (e) => {
  if (!$('miniMap').classList.contains('pick')) return;
  e.preventDefault(); e.stopPropagation();
  const el = $('miniMap'), rc = el.getBoundingClientRect(), x = ((e.clientX - rc.left) / rc.width) * 300, y = ((e.clientY - rc.top) / rc.height) * 300;
  let best = null, bd = 30;
  for (const r of runnerList()) { if (!r.m) continue; const [px, py] = mapPt(r.m.root.position.x, r.m.root.position.z); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = r; } }
  if (best) selectRunner(best.id); else if (G.selRunner) selectRunner(null);
});

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
// the person on this device steering a fielder in this play (if anyone)
function localCtl(pl) { return !pl ? null : G.squad ? pl.ctl.find((c) => c.sid === G.me) || null : fieldCtrl() === 'local' ? pl.c0 : null; }
function updateLive(dt) {
  const pl = G.play, fc = fieldCtrl();
  if (G.squad) {
    // everyone in the field steers his own man: you here, your friends from their devices
    for (const c of pl.ctl) {
      if (c.sid === G.me) { const v = fieldVec(); pl.setInput(v.x, v.z, c); continue; }
      const L = linkBySid(c.sid);
      pl.setInput(L ? L.inp.x : 0, L ? L.inp.z : 0, c);
      c.remotePos = L && L.pos && performance.now() - L.pos.at < 300 ? L.pos : null;
    }
  } else if (fc === 'local') { const v = fieldVec(); pl.setInput(v.x, v.z); }
  else if (fc === 'remote') {
    pl.setInput(G.remoteIn.x, G.remoteIn.z);
    const rp = G.remotePos;
    pl.remotePos = rp && performance.now() - rp.at < 300 ? rp : null;
  }
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
  const localField = fc === 'local', me = localCtl(pl);
  $('throwPrompt').classList.toggle('hidden', !(localField && me && me.prompt && pl.userDef));
  ctrlRing.visible = localField && !!me && !!me.f && !pl.done && !pl.hr;
  if (ctrlRing.visible) ctrlRing.position.set(me.f.pos.x, groundY(me.f.pos.x, me.f.pos.z) + 0.12, me.f.pos.z);
  const land = localField && landingAssist() ? pl.landingSpot() : null;
  landMark.visible = !!land; if (land) landMark.position.set(land[0], 0.1, land[1]);
  runnerHUD(userRuns() && !pl.hr && !pl.awarded && !pl.done);
  if (!fpvOn) playCam();
  if (pl.done) {
    setHint(''); ctrlRing.visible = false; landMark.visible = false; baseMark.visible = false; G.aimShown = 0; runnerHUD(false);
    finishLive(pl);
  }
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
// Every frame of a play is taped (recFrame). When the play is over it's packed into a clip
// (packClip: 30 frames a second in typed arrays, played back smoothly in between) and kept for
// the rest of the game: the Replays list (pause menu, final screen) plays any of them, and R
// replays the one that just happened. Playback has its own controls: pause, slow motion,
// scrubbing, frame steps and eight cameras; closing it puts the game back exactly as it was.
function recFrame() {
  const fr = { t: G.now, b: [ballMesh.position.x, ballMesh.position.y, ballMesh.position.z, ballMesh.visible ? 1 : 0], m: [] };
  for (const m of MODELS) {
    if (!m.root.visible) continue;
    const prm = m.prm && m.prm.glove ? { glove: m.prm.glove.clone() } : m.prm;
    fr.m.push([m.idx, m.root.position.x, m.root.position.y, m.root.position.z, m.root.rotation.y, m.anim, G.now - m.t0, prm, m.phase, m.j.helmet && m.j.helmet.visible ? 1 : 0]);
  }
  G.rec.push(fr);
  if (G.rec.length > 3000) G.rec.shift();
}
// a packed clip: per frame its time, the ball (x, y, z, shown) and every visible model as
// REC_W floats: model, x, y, z, facing, anim, anim time, run phase, anim params, helmet
const REC_W = 10;
function clonePrm(p) { const o = {}; for (const k in p) o[k] = p[k] && p[k].isVector3 ? p[k].clone() : p[k]; return o; }
function packClip(rec, t0, t1 = Infinity) {
  const keep = [];
  let last = -Infinity;
  rec.forEach((f, i) => { if (f.t >= t0 && f.t <= t1 && (f.t - last >= 1 / 30 - 1e-4 || i === rec.length - 1)) { keep.push(f); last = f.t; } });
  if (keep.length < 2) return null;
  const n = keep.length, tot = keep.reduce((s, f) => s + f.m.length, 0);
  const C = { n, t: new Float64Array(n), ball: new Float32Array(n * 4), off: new Uint32Array(n + 1), d: new Float32Array(tot * REC_W), anims: [], prms: [] };
  const ai = new Map(), pi = new Map();
  let o = 0;
  keep.forEach((f, k) => {
    C.t[k] = f.t; C.ball.set(f.b, k * 4); C.off[k] = o;
    for (const e of f.m) {
      let a = ai.get(e[5]); if (a == null) { a = C.anims.length; C.anims.push(e[5]); ai.set(e[5], a); }
      let q = -1;
      if (e[7]) { q = pi.get(e[7]); if (q == null) { q = C.prms.length; C.prms.push(clonePrm(e[7])); pi.set(e[7], q); } }
      C.d.set([e[0], e[1], e[2], e[3], e[4], a, e[6], e[8] || 0, q, e[9] ? 1 : 0], o * REC_W);
      o++;
    }
  });
  C.off[n] = o; C.t0 = C.t[0]; C.t1 = C.t[n - 1];
  return C;
}
// the play that just ended goes on the Replays list (the list keeps 40; the best ones stay)
const HL_SCORE = { 'GRAND SLAM': 12, 'HOME RUN': 10, 'INSIDE THE PARK': 10, TRIPLE: 8, ROBBED: 8, 'WHAT A CATCH': 7, 'STEAL OF HOME': 7, 'DOUBLE PLAY': 6, 'DOUBLE STEAL': 5, 'PICKED OFF': 5, DOUBLE: 5, 'GROUND RULE DOUBLE': 5, 'CAUGHT STEALING': 4, 'STOLEN BASE': 3, SINGLE: 3, 'WILD PITCH': 2, 'PASSED BALL': 2, ERROR: 2, 'THROWING ERROR': 2, 'SAC FLY': 2, "FIELDER'S CHOICE": 2, OUT: 1 };
function archivePlay() {
  if (!G.rec.length || G.mode === 'derby' || G.drill) return;
  const pl = isGuest() ? null : G.play, title = G.lastCallText || '';
  if (!(title in HL_SCORE)) return;   // nothing came of it (a pickoff throw, a pitch blocked in the dirt)
  const hit = pl ? pl.kind === 'hit' : !!G.bb, ct = hit && G.contactT ? G.contactT : pl ? pl.at : G.rec[0].t;
  const C = packClip(G.rec, ct - 1.2); if (!C) return;
  const runs = Math.max(0, G.score[0] + G.score[1] - (G.scoreAtPitch ?? 0)), score = (HL_SCORE[title] ?? 1) + runs * 1.5;
  const clip = { C, ct, style: G.bb && (G.bb.hr || G.bb.la > 22) ? 'low' : 'side', title, desc: $('caption').textContent || '', inning: G.inning, half: G.half, bat: G.teams[G.half].id, score, star: score >= 5, n: (G.clipN = (G.clipN || 0) + 1) };
  G.clips.push(clip); G.lastClip = clip;
  if (G.clips.length > 40) { const i = G.clips.findIndex((c) => !c.star); G.clips.splice(i >= 0 ? i : 0, 1); }
}
function clipIndex(C, t, hint) {
  let k = clamp(hint | 0, 0, C.n - 1);
  if (C.t[k] > t) k = 0;
  while (k < C.n - 1 && C.t[k + 1] <= t) k++;
  return k;
}
// put the field the way it was at time t, in between the two nearest frames
function showClipAt(R, t) {
  const C = R.C, W = REC_W, d = C.d, k = (R.k = clipIndex(C, t, R.k)), k2 = Math.min(C.n - 1, k + 1);
  const span = C.t[k2] - C.t[k], u = span > 0 ? clamp((t - C.t[k]) / span, 0, 1) : 0;
  for (const m of MODELS) m.root.visible = false;
  const a1 = C.off[k + 1], b0 = C.off[k2], b1 = C.off[k2 + 1];
  for (let o = C.off[k], j = b0; o < a1; o++, j++) {
    const x = o * W, m = MODELS[d[x]];
    if (!m) continue;
    let y = -1;
    if (j < b1 && d[j * W] === d[x]) y = j * W;
    else for (let q = b0; q < b1; q++) if (d[q * W] === d[x]) { y = q * W; break; }
    let px = d[x + 1], py = d[x + 2], pz = d[x + 3], ry = d[x + 4], at = d[x + 6], ph = d[x + 7];
    if (y >= 0 && u > 0) {
      px += (d[y + 1] - px) * u; py += (d[y + 2] - py) * u; pz += (d[y + 3] - pz) * u; ry += angDiff(ry, d[y + 4]) * u;
      if (d[y + 5] === d[x + 5]) { at += (d[y + 6] - at) * u; ph += (d[y + 7] - ph) * u; }
    }
    m.root.visible = true; m.root.position.set(px, py, pz); m.root.rotation.y = ry;
    if (m.kind === 'player' && m.j.helmet) { m.j.helmet.visible = !!d[x + 9]; if (m.j.cap) m.j.cap.visible = !d[x + 9]; }
    if (m.fade !== 1) setFade(m, 1);
    applyPose(m, C.anims[d[x + 5]], at, d[x + 8] >= 0 ? C.prms[d[x + 8]] : null, ph);
  }
  const B = C.ball, i = k * 4, i2 = k2 * 4;
  ballMesh.position.set(B[i] + (B[i2] - B[i]) * u, B[i + 1] + (B[i2 + 1] - B[i + 1]) * u, B[i + 2] + (B[i2 + 2] - B[i + 2]) * u);
  ballMesh.visible = !!B[i + 3];
}
// what's on screen right now, to put back when the replay closes
const replayOverlays = () => [pci, reticle, mitt, zoneGroup, pitchMark, pitchGuide, ctrlRing, landMark, baseMark, ballShadow, selRing];
function liveSnap() {
  const s = { m: [], ball: ballMesh.position.clone(), bv: ballMesh.visible, ov: replayOverlays().map((o) => o.visible),
    cam: { pos: camRig.pos.clone(), look: camRig.look.clone(), fov: camRig.fov, tp: camRig.tp.clone(), tl: camRig.tl.clone(), tf: camRig.tf, rate: camRig.rate } };
  for (const m of MODELS) if (m.root.visible) s.m.push([m, m.root.position.clone(), m.root.rotation.y, m.j.helmet ? m.j.helmet.visible : null, m.j.cap ? m.j.cap.visible : null]);
  return s;
}
function restoreSnap(s) {
  for (const m of MODELS) m.root.visible = false;
  for (const [m, p, ry, hv, cv] of s.m) {
    m.root.visible = true; m.root.position.copy(p); m.root.rotation.y = ry;
    if (hv != null) m.j.helmet.visible = hv; if (cv != null) m.j.cap.visible = cv;
    updateModel(m, G.now);
  }
  ballMesh.position.copy(s.ball); ballMesh.visible = s.bv;
  replayOverlays().forEach((o, i) => { o.visible = s.ov[i]; });
  const c = s.cam; Object.assign(camRig, { fov: c.fov, tf: c.tf, rate: c.rate }); camRig.pos.copy(c.pos); camRig.look.copy(c.look); camRig.tp.copy(c.tp); camRig.tl.copy(c.tl);
}
const RP_CAMS = [['auto', 'Auto'], ['tv', 'Broadcast'], ['plate', 'Behind the plate'], ['side', 'First-base side'], ['third', 'Third-base side'], ['high', 'Overhead'], ['ball', 'Follow the ball'], ['orbit', 'Free: drag to orbit']];
const RP_SPEEDS = [0.1, 0.25, 0.5, 1, 2];
// o: { C: clip frames, t: where to start, ct: contact (or the start of the play), style, title,
//      theater: watching from the Replays list, list: clips to step through, li: which one, reel }
function openReplay(o) {
  const R = (G.replay = { k: 0, speed: o.theater ? 1 : 0.55, paused: false, cam: G.replayCam || 'auto', snap: true, pre: true, touched: false, prevB: new V3(), bv: new V3(), orb: { yaw: 0.6, pitch: 0.35, dist: 70 }, ...o });
  R.t = clamp(o.t ?? R.C.t0, R.C.t0, R.C.t1);
  if (!R.restore) R.restore = liveSnap();
  for (const ov of replayOverlays()) ov.visible = false;
  document.body.classList.add('letterbox'); $('replayTag').classList.remove('hidden'); $('hud').classList.add('replaying');
  $('replayTag').textContent = R.review ? 'REPLAY' : R.title ? `REPLAY · ${R.title}` : 'REPLAY';
  $('replayBar').classList.toggle('hidden', !!R.review);
  hideFeedback(); trailReset(); ballShadow.visible = false;
  showClipAt(R, R.t); R.prevB.copy(ballMesh.position);
  replayBarSync(true);
}
function startReplay() {
  if (G.replay || !['postPlay', 'derbyResult'].includes(G.phase)) return;
  if (G.mode === 'derby' && !(G.bb && G.bb.hr)) return;
  const c = G.lastClip;
  if (c) { openReplay({ C: c.C, t: c.ct - 0.9, ct: c.ct, style: c.style, title: c.title }); return; }
  if (!G.bb || !G.rec.length) return;
  const C = packClip(G.rec, G.contactT - 1.2);
  if (C) openReplay({ C, t: G.contactT - 0.9, ct: G.contactT, style: G.bb.hr || G.bb.la > 22 ? 'low' : 'side' });
}
// replay review: the play at the bag again, slowed down, from a camera on that bag.
// Returns how long it runs (0 if there's no tape).
const REVIEW_CAMS = { 1: [96, 6, -76], 2: [26, 6, -150], 3: [-96, 6, -76], 4: [-28, 5, -18] };
function startReviewReplay(c) {
  if (G.replay) return 0;
  const C = packClip(G.rec, c.now - 1.3);
  if (!C || C.n < 6) return 0;
  openReplay({ C, review: true, base: c.base, until: c.now + 0.6, t: C.t0, ct: C.t0 });
  return (Math.min(C.t1, c.now + 0.6) - C.t0) / 0.55;
}
function updateReplay(dt) {
  const R = G.replay, C = R.C;
  if (!R.paused) R.t = Math.min(C.t1, R.t + dt * R.speed);
  showClipAt(R, R.t);
  replayCam(R, dt);
  if (R.review) { if (R.t >= R.until || R.t >= C.t1) endReplay(); return; }
  if (R.t >= C.t1 && !R.paused) {
    if (R.reel && R.li < R.list.length - 1) { replayGo(1); return; }
    if (!R.touched && !R.theater) { endReplay(); return; }
    R.paused = true;
  }
  replayBarSync();
}
function replayCam(R, dt) {
  const b = ballMesh.position, snap = R.snap; R.snap = false;
  if (R.review) { const B = BASES[R.base], c = REVIEW_CAMS[R.base]; camTo(_c1.set(c[0], c[1], c[2]), _c2.set(B.x, 2.5, B.z), 26, 4, snap); return; }
  // the ball's speed, smoothed, for the chase camera
  if (dt > 0 && !R.paused) { R.bv.lerp(_c2.copy(b).sub(R.prevB).divideScalar(Math.max(dt * R.speed, 1e-3)), 0.15); }
  R.prevB.copy(b);
  const live = ballMesh.visible && R.t >= R.ct - 0.05;
  switch (R.cam) {
    case 'tv': {
      const fx = live ? b.x : 0, fz = live ? b.z : -20, fy = live ? b.y : 0, r = Math.hypot(fx, fz);
      camTo(_c1.set(fx * 0.28, 34 + r * 0.17 + Math.min(fy, 150) * 0.12, 54 - r * 0.1), _c2.set(fx * 0.92, Math.min(fy * 0.35, 35), fz * 0.92 + 4), 48, 2.6, snap); break;
    }
    case 'plate': camTo(_c1.set(0, 9, 34), live ? b : _c2.set(0, 3, -60), live ? 34 : 24, 4, snap); break;
    case 'side': camTo(_c1.set(118, 16, 34), live ? b : _c2.set(0, 3, -30), 30, 3.5, snap); break;
    case 'third': camTo(_c1.set(-118, 16, 34), live ? b : _c2.set(0, 3, -30), 30, 3.5, snap); break;
    case 'high': { const cx = live ? b.x * 0.5 : 0, cz = live ? b.z * 0.5 - 50 : -90; camTo(_c1.set(cx, 300, cz + 140), _c2.set(cx, 0, cz), 46, 2.2, snap); break; }
    case 'ball': {
      const h = Math.hypot(R.bv.x, R.bv.z);
      if (live && h > 8) { const ux = R.bv.x / h, uz = R.bv.z / h; camTo(_c1.set(b.x - ux * 18, b.y + 5, b.z - uz * 18), _c2.set(b.x + ux * 10, b.y, b.z + uz * 10), 50, 6, snap); }
      else camTo(_c1.set(b.x * 0.9, b.y + 9, b.z + 26), live ? b : _c2.set(0, 3, -60), 44, 4, snap);
      break;
    }
    case 'orbit': {
      const f = live ? b : _c2.set(0, 3, -40), O = R.orb, cp = Math.cos(O.pitch);
      camTo(_c1.set(f.x + Math.sin(O.yaw) * cp * O.dist, Math.max(2, f.y + Math.sin(O.pitch) * O.dist), f.z + Math.cos(O.yaw) * cp * O.dist), f, 42, 10, snap); break;
    }
    default:
      if (R.t < R.ct) { cfCam(snap); break; }
      { const first = R.pre || snap; R.pre = false;
        if (R.style === 'low') camTo(_c1.set(b.x * 0.12, 4.5, 26), b, 40, 3.5, first);
        else camTo(_c1.set(118, 16, 34), b, 30, 3.5, first); }
  }
}
function endReplay() {
  const R = G.replay;
  if (!R) return;
  G.replay = null;
  restoreSnap(R.restore);
  document.body.classList.remove('letterbox'); $('replayTag').classList.add('hidden'); $('hud').classList.remove('replaying'); $('replayBar').classList.add('hidden');
  if (R.theater) { if (R.back) $(R.back).classList.remove('hidden'); openReplays(); return; }
  G.pt = Math.max(0, Math.min(G.pt, G.dur - 1.2));
}
// ---- replay controls (the bar along the bottom, and keys while a replay is up)
function replaySeek(t) { const R = G.replay; if (!R) return; R.t = clamp(t, R.C.t0, R.C.t1); R.k = 0; R.touched = true; }
function replayToggle() { const R = G.replay; if (!R) return; R.touched = true; if (R.paused && R.t >= R.C.t1 - 1e-3) R.t = R.C.t0; R.paused = !R.paused; replayBarSync(true); }
function replaySpeed(d) { const R = G.replay; if (!R) return; const i = RP_SPEEDS.indexOf(R.speed); R.speed = RP_SPEEDS[clamp((i < 0 ? 2 : i) + d, 0, RP_SPEEDS.length - 1)]; R.touched = true; replayBarSync(true); }
function replayCamSet(cam) { const R = G.replay; if (!R) return; R.cam = G.replayCam = cam; R.snap = true; R.pre = true; R.touched = true; replayBarSync(true); }
function replayStep(dir) { const R = G.replay; if (!R) return; R.paused = true; replaySeek(R.t + dir / 30); replayBarSync(true); }
// the next or previous clip on the list
function replayGo(d) {
  const R = G.replay; if (!R || !R.list) return;
  const li = R.li + d, c = R.list[li]; if (!c) return;
  openReplay({ C: c.C, t: c.C.t0, ct: c.ct, style: c.style, title: c.title, theater: true, list: R.list, li, reel: R.reel, back: R.back, restore: R.restore, speed: R.speed, cam: R.cam });
}
function replayKey(k, e) {
  const R = G.replay; if (!R || R.review) return false;
  const map = {
    ' ': replayToggle, k: replayToggle, v: () => replayCamSet(RP_CAMS[(RP_CAMS.findIndex((c) => c[0] === R.cam) + 1) % RP_CAMS.length][0]),
    arrowleft: () => (R.paused ? replayStep(-1) : replaySeek(R.t - 1)), arrowright: () => (R.paused ? replayStep(1) : replaySeek(R.t + 1)),
    ',': () => replayStep(-1), '.': () => replayStep(1), arrowup: () => replaySpeed(1), arrowdown: () => replaySpeed(-1),
    home: () => replaySeek(R.C.t0), ']': () => replayGo(1), '[': () => replayGo(-1), n: () => replayGo(1), p: () => replayGo(-1),
    escape: endReplay, enter: endReplay, r: endReplay, backspace: endReplay,
  };
  const f = map[k]; if (!f) return false;
  e.preventDefault(); f(); return true;
}
let rpSeeking = false;
function replayBarSync(force) {
  const R = G.replay; if (!R || R.review) return;
  const C = R.C, dur = C.t1 - C.t0, pos = R.t - C.t0;
  if (!rpSeeking) $('rpSeek').value = String(Math.round((pos / Math.max(dur, 1e-3)) * 1000));
  const tt = `${pos.toFixed(1)} / ${dur.toFixed(1)}s`; if ($('rpTime').textContent !== tt) $('rpTime').textContent = tt;
  if (!force) return;
  $('rpPlay').innerHTML = R.paused ? '&#9654;' : '&#10074;&#10074;';
  $('rpPlay').title = R.paused ? 'Play (Space)' : 'Pause (Space)';
  for (const b of $('rpSpeed').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.s === R.speed);
  $('rpCam').value = R.cam;
  const many = !!(R.list && R.list.length > 1);
  $('rpPrev').classList.toggle('hidden', !many); $('rpNext').classList.toggle('hidden', !many);
  $('rpPrev').disabled = !many || R.li <= 0; $('rpNext').disabled = !many || R.li >= R.list.length - 1;
  $('rpCount').textContent = many ? `${R.li + 1} / ${R.list.length}` : '';
}
// ---- the Replays list: every play this game, best ones starred
function openReplays() {
  const el = $('replaysScreen'), clips = G.clips || [];
  const row = (c, i) => `<button class="rp-row" data-clip="${i}"><span class="rp-inn">${c.half ? 'BOT' : 'TOP'} ${c.inning}</span><span class="rp-title">${c.star ? '<i class="rp-star">&#9733;</i>' : ''}${esc(c.title)}<small>${esc(c.desc)}</small></span><span class="rp-go">&#9654;</span></button>`;
  const stars = clips.filter((c) => c.star).length;
  $('rpListBody').innerHTML = clips.length
    ? `<div class="row-actions"><button class="cta" data-reel="1" ${stars ? '' : 'disabled'}>PLAY HIGHLIGHTS${stars ? ` (${stars})` : ''}</button><button class="ghost" data-reel="all">Play them all</button></div><div class="rp-list">${clips.map(row).reverse().join('')}</div>
       <p class="fr-note">Space pauses, &larr; &rarr; skip (frame by frame when paused), &uarr; &darr; change the speed, V changes the camera, [ ] go to the previous or next play, Esc closes.</p>`
    : '<p class="fr-note">Every ball in play, steal and pickoff this game shows up here once it happens.</p>';
  el.classList.remove('hidden');
}
function closeReplays() { $('replaysScreen').classList.add('hidden'); }
function playClips(list, li, reel) {
  const c = list[li]; if (!c) return;
  const back = !$('final').classList.contains('hidden') ? 'final' : !$('pause').classList.contains('hidden') ? 'pause' : null;
  closeReplays(); if (back) $(back).classList.add('hidden');
  openReplay({ C: c.C, t: c.C.t0, ct: c.ct, style: c.style, title: c.title, theater: true, list, li, reel, back });
}
function buildReplayUI() {
  $('rpPlay').addEventListener('click', replayToggle);
  $('rpRestart').addEventListener('click', () => { const R = G.replay; if (R) { replaySeek(R.C.t0); R.paused = false; replayBarSync(true); } });
  $('rpClose').addEventListener('click', endReplay);
  $('rpPrev').addEventListener('click', () => replayGo(-1));
  $('rpNext').addEventListener('click', () => replayGo(1));
  $('rpCam').innerHTML = RP_CAMS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('rpCam').addEventListener('change', (e) => { replayCamSet(e.target.value); e.target.blur(); });
  $('rpSpeed').innerHTML = RP_SPEEDS.map((v) => `<button data-s="${v}">${v === 0.1 ? '0.1' : v === 0.25 ? '&frac14;' : v === 0.5 ? '&frac12;' : v}&times;</button>`).join('');
  $('rpSpeed').addEventListener('click', (e) => { const b = e.target.closest('button'); const R = G.replay; if (b && R) { R.speed = +b.dataset.s; R.touched = true; replayBarSync(true); } });
  const seek = $('rpSeek');
  seek.addEventListener('input', () => { const R = G.replay; if (!R) return; rpSeeking = true; replaySeek(R.C.t0 + (+seek.value / 1000) * (R.C.t1 - R.C.t0)); replayBarSync(); });
  seek.addEventListener('change', () => { rpSeeking = false; seek.blur(); });
  for (const id of ['btnReplays', 'btnFinalReplays']) $(id).addEventListener('click', openReplays);
  $('rpListClose').addEventListener('click', closeReplays);
  $('rpListBody').addEventListener('click', (e) => {
    const r = e.target.closest('[data-clip]'), reel = e.target.closest('[data-reel]'), clips = G.clips || [];
    if (r) playClips(clips, +r.dataset.clip, false);
    else if (reel) { const list = reel.dataset.reel === 'all' ? clips : clips.filter((c) => c.star); playClips(list, 0, true); }
  });
}

// ------------------------------------------------------------------ input ----
const mouseNDC = new THREE.Vector2(0, -0.25);
let mouseMoved = false, lastPointer = 'mouse';
const raycaster = new THREE.Raycaster(), platePlane = new THREE.Plane(new V3(0, 0, 1), 0), _hit = new V3();
const keys = new Set();
function setMouse(e) { mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); mouseMoved = true; lastPointer = e.pointerType || 'mouse'; }
canvasEl.addEventListener('pointermove', (e) => {
  if (G.replay && G.replay.cam === 'orbit' && e.buttons) { const O = G.replay.orb; O.yaw -= (e.movementX || 0) * 0.006; O.pitch = clamp(O.pitch + (e.movementY || 0) * 0.005, 0.03, 1.45); return; }
  setMouse(e);
  mouseIn = e.pointerType === 'mouse';
  if (!fpvOn || G.paused) return;
  if (document.pointerLockElement === canvasEl) { lookDelta(e.movementX || 0, e.movementY || 0); return; }
  if (userPitches() || catcherAiming()) return;
  if (e.buttons) lookDelta(e.movementX || 0, e.movementY || 0);
  else if (e.pointerType === 'mouse') mouseLook(e.movementX || 0, e.movementY || 0);
});
canvasEl.addEventListener('pointerleave', () => { mouseIn = false; });
canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
canvasEl.addEventListener('wheel', (e) => { if (G.replay && G.replay.cam === 'orbit') { e.preventDefault(); const O = G.replay.orb; O.dist = clamp(O.dist * (e.deltaY > 0 ? 1.12 : 0.89), 12, 400); } }, { passive: false });
canvasEl.addEventListener('pointerdown', (e) => {
  SND.init();
  if (G.replay) { e.preventDefault(); if (!G.replay.review && G.replay.cam !== 'orbit') replayToggle(); return; }   // orbit: drag to look around
  setMouse(e);
  // running the bases during a play: a click picks the runner under it
  if (G.phase === 'live' && userRuns() && !G.lock && !trotOn() && !G.paused) { e.preventDefault(); pickRunnerAt(e.clientX, e.clientY); return; }
  // first person: grab the mouse for looking around; right-click re-centers on the play
  if (fpvOn && !userPitches()) {
    e.preventDefault();
    if (e.button === 2) { lookRecenter(); return; }
    if (e.pointerType === 'mouse' && document.pointerLockElement !== canvasEl) {
      try { const r = canvasEl.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* not supported */ }
      return;
    }
    if (G.phase === 'live') { if (trotOn()) primaryAction('normal'); return; }
    primaryAction('normal');
    return;
  }
  if (e.pointerType === 'touch') aimUpdate(0, true);
  primaryAction(e.button === 2 ? 'power' : e.button === 1 ? 'contact' : 'normal');
  e.preventDefault();
});
// field movement is relative to the camera: W runs where you're looking. When the
// third-person camera turns on its own, keep the direction you started running in
// until you let go, so a camera swing never flips your controls mid-sprint.
let moveYaw = null;
function fieldVec() {
  let ix = 0, iy = 0;
  if (keys.has('a')) ix -= 1; if (keys.has('d')) ix += 1; if (keys.has('w')) iy += 1; if (keys.has('s')) iy -= 1;
  if (G.stick) { ix += G.stick.x; iy += G.stick.y; }
  if (!ix && !iy) { moveYaw = null; return { x: 0, z: 0 }; }
  _fwd.copy(camRig.tl).sub(camRig.tp); _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
  if (fpvOn && G.view === 2 && FL.mode !== 'free') {
    if (moveYaw == null) moveYaw = TP.yaw;
    _fwd.set(Math.sin(moveYaw), 0, Math.cos(moveYaw));
  } else moveYaw = null;
  _fwd.normalize();
  let x = -_fwd.z * ix + _fwd.x * iy, z = _fwd.x * ix + _fwd.z * iy;
  const L = Math.hypot(x, z); if (L > 1) { x /= L; z /= L; }
  return { x, z };
}
function actThrow(b) { if (isGuest()) { netSend({ t: 'act', a: 'throw', base: b }); NET.pred.hold = G.now + 0.5; } else if (G.play) { const c = localCtl(G.play); if (c) G.play.userThrow(b, c); } }
function actDive() { if (isGuest()) { netSend({ t: 'act', a: 'dive' }); NET.pred.hold = G.now + 1.2; } else if (G.play) { const c = localCtl(G.play); if (c) G.play.userDive(c); } }
function actSwitch() { if (isGuest()) netSend({ t: 'act', a: 'switch' }); else if (G.play && !G.squad) G.play.userSwitch(); }
function actRun(kind, which = null) {
  if (G.squad) which = G.lock;   // a squad: you run only yourself
  if (isGuest()) { netSend({ t: 'act', a: 'run', kind, which }); return; }
  if (G.play) G.play.runCmd(kind, which, G.lock); else stealCmd(kind, which);
}
function actPick(base) { if (isGuest()) { netSend({ t: 'act', a: 'pick', base }); return; } startPickoff(base); }
const trotOn = () => (isGuest() ? !!(NET.snap && NET.snap.pl && NET.snap.pl.hr) : !!(G.play && (G.play.hr || G.play.awarded)));
window.addEventListener('keydown', (e) => {
  const raw = e.key.toLowerCase(), k = raw === 'escape' ? raw : keyAlias(raw);   // your key bindings (69-options.js)
  if (k === 'escape' && !$('friendsScreen').classList.contains('hidden')) { closeFriends(); return; }
  if (k === 'escape' && !$('teamScreen').classList.contains('hidden')) { closeTeam(); return; }
  if (k === 'escape' && !$('boxScreen').classList.contains('hidden')) { closeBox(); return; }
  if (k === 'escape' && !$('statsScreen').classList.contains('hidden')) { closeStats(); return; }
  if (k === 'escape' && !$('optionsScreen').classList.contains('hidden')) { closeOptions(); return; }
  if (G.replay && !(e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') && replayKey(raw, e)) return;
  if (k === 'escape' && !$('replaysScreen').classList.contains('hidden')) { closeReplays(); return; }
  if (!k) return;   // a key whose control moved to another key
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
  if (k === 'escape' || (k === 'p' && G.phase !== 'menu')) { togglePause(); return; }
  if (G.phase === 'menu' || G.phase === 'boot' || G.paused) return;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
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
      if (k === 'e') { runKey('go'); return; }
      if (k === 'q') { runKey('back'); return; }
      if (k in BASE_KEY) return;   // held to pick a runner for E / Q
    }
  }
  // pitching: Shift + 1/2/3 throws over to that base
  if (e.shiftKey && /^Digit[1-3]$/.test(e.code) && userPitches() && G.phase === 'prePitch') { actPick(+e.code.slice(5)); return; }
  // batting team, before or during the pitch: E steals (hold a base key for one runner), Q calls it off
  if (STEAL_PHASES.includes(G.phase) && userRuns() && !userPitches() && runnerList().length) {
    if (k === 'e') { runKey('go'); return; }
    if (k === 'q') { runKey('back'); return; }
  }
  if (k === ' ' || k === 'k') primaryAction('normal');
  else if (k === 'j') primaryAction('contact');
  else if (k === 'l') primaryAction('power');
  else if (k === 'b') primaryAction('bunt');
  else if (k >= '1' && k <= '5') selectPitch(+k - 1);
  else if (k === 'r') startReplay();
  else if (k === 'enter') { if (G.replay) endReplay(); else skip(); }
  else if (k === 'z') toggleZone();
  else if (k === 'm') toggleSound();
  else if (k === 'c') requestChallenge();
  else if (k === 't') lookRecenter();
  else if (k === 'tab') startSim();
  else if (k === 'v' && (G.mode === 'lock' || G.squad)) toggleView();
  else if (k === 'u') openTeam();
  else if (k === 'i') requestIBB();
});
// V cycles third person -> first person -> broadcast
function toggleView() {
  G.view = (G.view + 2) % 3; FL.mode = 'track';
  fpvHide(null); fpvOn = false; exitPointerLock();
  if (!G.view) restoreCam();
  setHint(VIEW_NAMES[G.view] + ' &middot; <kbd>V</kbd> to switch');
}
window.addEventListener('keyup', (e) => keys.delete(keyAlias(e.key.toLowerCase())));
window.addEventListener('blur', () => keys.clear());
$('pitchList').addEventListener('click', (e) => { const row = e.target.closest('.pitch-row'); if (row) selectPitch(+row.dataset.i); });
for (const b of $('throwPrompt').querySelectorAll('button')) b.addEventListener('pointerdown', (e) => { e.stopPropagation(); actThrow(+b.dataset.base); });
$('simBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); startSim(); });
$('pickHelp').addEventListener('pointerdown', (e) => { const b = e.target.closest('button[data-pick]'); if (!b) return; e.stopPropagation(); e.preventDefault(); actPick(+b.dataset.pick); });
$('runHelp').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  const b = e.target.closest('button[data-run]');
  if (b) { e.preventDefault(); actRun(b.dataset.run, b.dataset.id || null); return; }
  if (e.target.closest('[data-pickall]')) { e.preventDefault(); selectRunner(null); return; }
  const row = e.target.closest('[data-pickid]');
  if (row) { e.preventDefault(); selectRunner(row.dataset.pickid); }
});
$('runTags').addEventListener('pointerdown', (e) => { const t = e.target.closest('.run-tag'); if (!t || !t.dataset.id) return; e.preventDefault(); e.stopPropagation(); selectRunner(t.dataset.id); });

let gpPrev = [];
function pollGamepad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null; for (const x of list || []) if (x) { gp = x; break; }
  if (!gp) return null;
  const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed), edge = (i) => pressed(i) && !gpPrev[i];
  const dz = (v) => (Math.abs(v) > 0.18 ? v : 0);
  const stick = { x: dz(gp.axes[0] || 0), y: -dz(gp.axes[1] || 0) };
  const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
  if (fpvOn && (rx || ry)) lookDelta(rx * 14, ry * 10);
  if (edge(11)) lookRecenter();
  if (edge(9)) togglePause();
  if (G.mode === 'lock' && edge(8) && G.phase !== 'postPlay') startSim();
  if (!G.paused && G.phase !== 'menu') {
    if (gp.buttons.some((b, i) => edge(i))) SND.init();
    if (G.replay) { if (edge(0) || edge(1)) endReplay(); }
    else if (G.phase === 'live' && !trotOn() && (userFields() || userRuns())) {
      if (userFields()) { if (edge(1)) actThrow(1); if (edge(3)) actThrow(2); if (edge(2)) actThrow(3); if (edge(0)) actThrow(4); if (edge(7)) actDive(); if (edge(5)) actDive(); if (edge(4)) actSwitch(); }
      else {
        // hold the D-pad toward a runner's base (right = 1B, up = 2B, left = 3B, down = home) to run just him
        const pad = pressed(15) ? 1 : pressed(12) ? 2 : pressed(14) ? 3 : pressed(13) ? 4 : 0;
        if (edge(5)) runKey('go', pad); if (edge(4)) runKey('back', pad);
      }
    } else if (userPitches() && G.phase === 'prePitch' && pressed(6)) {
      // hold LT: B / Y / X throw over to first / second / third
      if (edge(1)) actPick(1); if (edge(3)) actPick(2); if (edge(2)) actPick(3);
    } else if (userPitches() && G.phase === 'prePitch') {
      const n = curPitcher().pitches.length;
      if (edge(4) || edge(14)) selectPitch((G.pitchUI.sel + n - 1) % n);
      if (edge(5) || edge(15)) selectPitch((G.pitchUI.sel + 1) % n);
      if (edge(0)) primaryAction('normal');
    } else if (G.phase === 'prePitch' && G.catchUI.state === 'call' && userCatches()) {
      const n = curPitcher().pitches.length;
      if (edge(4) || edge(14)) selectPitch((G.catchUI.sel + n - 1) % n);
      if (edge(5) || edge(15)) selectPitch((G.catchUI.sel + 1) % n);
      if (edge(0)) primaryAction('normal');
    } else if (G.phase === 'postPitch' && edge(3)) requestChallenge();
    else {
      if (edge(0)) primaryAction('normal'); if (edge(2)) primaryAction('power'); if (edge(1)) primaryAction('contact'); if (edge(3)) primaryAction('bunt');
      // batting team: RB steals (hold the D-pad toward one runner's base), LB calls it off
      if (STEAL_PHASES.includes(G.phase) && userRuns()) {
        const pad = pressed(15) ? 1 : pressed(12) ? 2 : pressed(14) ? 3 : pressed(13) ? 4 : 0;
        if (edge(5)) runKey('go', pad); if (edge(4)) runKey('back', pad);
      }
      if (edge(8)) startReplay();
    }
  }
  gpPrev = gp.buttons.map((b) => b.pressed);
  return stick;
}
function aimUpdate(dt, snap = false) {
  const ub = userBats() && ['prePitch', 'windup', 'pitch', 'halfIntro', 'wait'].includes(G.phase) && !G.swing;
  const up = userPitches() && G.phase === 'prePitch' && G.pitchUI.state === 'aim';
  const uc = !ub && !up && catcherAiming(), mittOn = uc && G.catchUI.state === 'called';
  if (!ub && !up && !uc) return;
  const tgt = ub ? G.pci : up ? G.pitchUI.aim : mittOn ? G.catchUI.glove : G.catchUI.aim;
  let vx = 0, vy = 0;
  if (keys.has('arrowleft') || keys.has('a')) vx -= 1; if (keys.has('arrowright') || keys.has('d')) vx += 1;
  if (keys.has('arrowup') || keys.has('w')) vy += 1; if (keys.has('arrowdown') || keys.has('s')) vy -= 1;
  if (G.stick) { vx += G.stick.x * 1.3; vy += G.stick.y * 1.3; }
  const kv = mittOn ? 7 : 3.2;   // the mitt has to get there in the time the pitch takes
  if (vx || vy) { tgt.x += vx * dt * kv; tgt.y += vy * dt * kv; mouseMoved = false; }
  else if (mouseMoved) {
    raycaster.setFromCamera(mouseNDC, camera);
    if (raycaster.ray.intersectPlane(platePlane, _hit)) {
      const k = snap ? 1 : 1 - Math.exp(-dt * 28);
      tgt.x = lerp(tgt.x, _hit.x, k); tgt.y = lerp(tgt.y, _hit.y, k);
    }
  }
  if (ub) { tgt.x = clamp(tgt.x, -1.7, 1.7); tgt.y = clamp(tgt.y, 0.8, 4.4); const d = pciDims('normal'); pci.position.set(tgt.x, tgt.y, 0); pci.scale.set(d.w, d.h, 1); }
  else if (mittOn) {
    tgt.x = clamp(tgt.x, -2.8, 2.8); tgt.y = clamp(tgt.y, 0.2, 5.2); mitt.position.set(tgt.x, tgt.y, 0);
    G.glove.lerp(_tmpA.set(tgt.x, clamp(tgt.y, 0.6, 4.6), 1.7), 1 - Math.exp(-dt * 20));   // the catcher's real mitt follows yours
  } else { tgt.x = clamp(tgt.x, -2.2, 2.2); tgt.y = clamp(tgt.y, 0.4, 4.8); reticle.position.set(tgt.x, tgt.y, 0); }
}
function primaryAction(kind) {
  if (G.paused) return;
  if (G.replay) { if (!G.replay.review) replayToggle(); return; }
  const ph = G.phase;
  if (ph === 'menu' || ph === 'boot' || ph === 'final' || ph === 'wait') return;
  if (ph === 'prePitch' || ph === 'windup' || ph === 'pitch') {
    if (userBats()) userSwing(kind);
    else if (userPitches() && ph === 'prePitch' && (kind === 'normal' || lastPointer === 'touch')) pitchPress();
    else if (ph === 'prePitch' && G.catchUI.state === 'call' && userCatches()) callPitch();
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
  // waiting on a challenge: only the side that can challenge can wave it off
  if (G.phase === 'reviewWait') { if (G.review && G.review.who === (force ? 'remote' : 'local')) G.pt = G.dur; return; }
  if (['postPitch', 'postPlay', 'postFoul', 'halfIntro', 'break', 'derbyResult'].includes(G.phase) && (force || G.pt > 0.3)) G.pt = G.dur;
}
function toggleZone() { settings.zone = !settings.zone; saveSettings(); zoneGroup.visible = settings.zone && (userBats() || userPitches() || userCatches()) && ['prePitch', 'windup', 'pitch'].includes(G.phase); $('btnZone').textContent = `Strike zone: ${settings.zone ? 'On' : 'Off'}`; }
function toggleSound() { SND.init(); SND.setOn(!settings.sound); muteIcon(); }
function muteIcon() { $('btnMute').style.opacity = settings.sound ? 1 : 0.45; }
function togglePause(force, remote) {
  if (['menu', 'boot', 'final', 'wait'].includes(G.phase)) return;
  if (!$('help').classList.contains('hidden')) { $('help').classList.add('hidden'); return; }
  const v = force ?? !G.paused;
  // a spectator, or a host waiting on a dropped opponent: just the menu, the game stays as it is
  if (G.mode === 'online' && !remote && (NET.role === 'spec' || NET.waiting)) { $('pause').classList.toggle('hidden', !(force ?? $('pause').classList.contains('hidden'))); return; }
  if (isGuest() && !remote) { netSend({ t: 'act', a: 'pause', v }); return; }
  G.paused = v;
  $('pause').classList.toggle('hidden', !G.paused);
  if (isHost()) netSend({ t: 'pause', v });
  const me = localSide();
  const teamOK = me >= 0 && G.mode !== 'lock' && !G.squad && G.mode !== 'derby' && !G.drill;
  $('btnTeam').classList.toggle('hidden', !teamOK);
  $('btnReplays').classList.toggle('hidden', G.mode === 'online' || G.mode === 'derby' || !!G.drill);
  try { if (G.paused) speechSynthesis.pause(); else speechSynthesis.resume(); } catch (e) { /* none */ }
}

// ------------------------------------------------------------------ menus ----
const menu = { mode: 'exhibition', away: 'NYY', home: 'LAD', park: '', side: 1, innings: 3, diff: 1, pdiff: 1, manual: 1, batter: 3, lockPick: 'h3', ump: 1, view: 2, lockField: 1, lockSkip: 1, netTeam: 'LAD', drill: 0, netMode: 0 };
try { Object.assign(menu, JSON.parse(localStorage.getItem('fullcount.menu') || '{}')); } catch (e) { /* ignore */ }
// teams used to be saved as an index into the built-in list
for (const k of ['away', 'home', 'netTeam']) if (typeof menu[k] === 'number') menu[k] = (TEAMS[menu[k]] || TEAMS[0]).key;
// a team the menu remembers may have been deleted since
function menuTeam(k) { const t = teamByKey(menu[k]); if (t) return t; menu[k] = (teamByKey(k === 'away' ? 'NYY' : 'LAD') || TEAMS[k === 'away' ? 0 : 1]).key; return teamByKey(menu[k]); }
// the arrows go club to club; a decade team stays in its decade when the next club has one
function cycleTeam(k, d, avoid) {
  const list = allTeams();
  const cur = CLASSIC.get(menu[k]), dec = cur ? cur[2] : 0;
  let i = list.findIndex((t) => t.key === (cur ? cur[1] : menu[k]));
  for (let n = 0; n < list.length; n++) {
    i = (i + d + list.length) % list.length;
    const ck = `${list[i].key}@${dec}`, key = dec && CLASSIC.has(ck) ? ck : list[i].key;
    if (key !== avoid) { menu[k] = key; return; }
  }
}
// a club's eras: today's roster and each decade
function eraSelect(t, key, mine) {
  const club = clubOf(t), list = club ? CLASSIC_BY_CLUB.get(club) || [] : [];
  if (!club || !list.length) return '';
  const opts = [[club, `${MLB_SEASON} roster`], ...list.slice().reverse().map((k) => [k, `${CLASSIC.get(k)[2]}s ${CLASSIC.get(k)[5]}`])];
  return `<select class="tp-era" data-k="${key}" aria-label="Era" ${mine ? '' : 'disabled'}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === t.key ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
// which team cards get a starting pitcher pick: practice only needs the side that pitches in the drill
function spShown(key) {
  const m = menu.mode;
  if (m === 'practice') { const d = ['bat', 'pitch', 'run', 'field'][menu.drill] || 'bat'; return d === 'pitch' ? key === 'home' : d !== 'field' && key === 'away'; }
  return ['exhibition', 'lock', 'online'].includes(m);
}
function starterSelect(t, key, sp, mine) {
  if (!t.rotation || !t.rotation.length || !spShown(key)) return '';
  const opts = t.rotation.map((p, i) => `<option value="${i}" ${i === sp ? 'selected' : ''}>${i + 1}. ${esc(p.name)} (${p.throws}HP) &middot; ${pitcherOvr(p)}</option>`).join('');
  return `<label class="tp-sp"><small>STARTING PITCHER</small><select class="tp-spsel" data-k="${key}" aria-label="Starting pitcher" ${mine ? '' : 'disabled'}>${opts}</select></label>`;
}
function teamPickHTML(label, t, key, mine = true, sp = 0) {
  if (!t) return `<div class="tp-label">${label}</div><div class="tp-row"><div class="badge wait">?</div></div><div class="team-name"><small>WAITING</small>Your friend picks</div>`;
  const tag = '';
  return `<div class="tp-label">${label}</div>
  <div class="tp-row"><button class="arrow" data-k="${key}" data-d="-1" aria-label="Previous team" ${mine ? '' : 'style="visibility:hidden"'}>&lsaquo;</button>
  <div class="badge" style="background:${t.c1};color:${t.c2};border-color:${t.c2}">${esc(t.id)}</div>
  <button class="arrow" data-k="${key}" data-d="1" aria-label="Next team" ${mine ? '' : 'style="visibility:hidden"'}>&rsaquo;</button></div>
  <div class="team-name"><small>${t.era ? `${t.era}s &middot; ` : ''}${esc(t.city.toUpperCase())}</small>${esc(t.name)}</div>${eraSelect(t, key, mine)}
  <div class="team-ovr"><span>BAT <b>${t.ovr.bat}</b></span><span>PIT <b>${t.ovr.pit}</b></span><span>DEF <b>${t.ovr.def}</b></span></div>${tag}${starterSelect(t, key, sp, mine)}`;
}
function lockOptions(team, sp) {
  return [...team.lineup.map((h, i) => [`h${i}`, `${h.name} · ${h.pos} · ${i + 1}${['st', 'nd', 'rd'][i] || 'th'} in the order`]), ['p0', `${starterOf(team, sp).name} · Starting pitcher`]];
}
// online: the two picks shown in the matchup, as [away, home] teams plus which one is mine to change
// (a squad: the host picks both, and nobody's side is the whole team)
function onlinePicks() {
  if (squadMode()) {
    if (NET.role === 'guest') { const t = ((NET.lobby && NET.lobby.teams) || []).map((x) => (x ? teamFromSpec(x) : null)); return { teams: [t[0] || null, t[1] || null], mySide: -1, squad: true }; }
    return { teams: [menuTeam('away'), menuTeam('home')], mySide: -1, squad: true };
  }
  if (NET.role === 'guest') {
    const L = NET.lobby, mySide = L ? 1 - L.side : 1, mine = menuTeam('netTeam'), theirs = L && L.hostSpec ? teamFromSpec(L.hostSpec) : null;
    const sp = [menuSP('netTeam'), spIndex(theirs, L && L.hostSp)];
    return { teams: mySide ? [theirs, mine] : [mine, theirs], mySide, sp: mySide ? sp.reverse() : sp };
  }
  const mySide = menu.side, mk = mySide ? 'home' : 'away', mine = menuTeam(mk), theirs = NET.guestSpec ? teamFromSpec(NET.guestSpec) : null;
  const sp = [menuSP(mk), spIndex(theirs, NET.guestSp)];
  return { teams: mySide ? [theirs, mine] : [mine, theirs], mySide, sp: mySide ? sp.reverse() : sp };
}
function renderMenu() {
  if (!['exhibition', 'lock', 'online', 'practice', 'derby'].includes(menu.mode)) menu.mode = 'exhibition';   // a mode that's gone
  const m = menu.mode, derby = m === 'derby', lock = m === 'lock', online = m === 'online', prac = m === 'practice';
  const guest = online && NET.role === 'guest', host = online && NET.role === 'host';
  const L = guest && NET.lobby ? NET.lobby : menu;
  const showTeams = !online || host || (guest && NET.open && NET.lobby);
  const squad = online && squadMode();
  $('netPanel').classList.toggle('hidden', !online);
  $('netTitle').textContent = squad ? 'ONLINE SQUAD' : 'ONLINE 1V1';
  $('optNetMode').classList.toggle('hidden', !online || NET.role === 'spec' || (guest && !(NET.open && NET.lobby)));
  $('netShare').classList.toggle('hidden', !(host && NET.code));
  $('netHostRow').classList.toggle('hidden', online && NET.open);
  $('netOr').classList.toggle('hidden', online && (NET.open || host));
  $('netJoinRow').classList.toggle('hidden', online && (NET.open || host));
  $('matchup').classList.toggle('hidden', !showTeams);
  const myElo = eloMine();
  $('netElo').innerHTML = online && !squad ? `YOUR RATING <b>${myElo.r}</b>${myElo.n ? ` &middot; ${myElo.w | 0}-${myElo.l | 0} online` : ' &middot; new player'}` : '';
  if (online && showTeams && squad) {
    const P = onlinePicks();
    $('pickA').innerHTML = teamPickHTML('AWAY', P.teams[0], 'away', host);
    $('pickH').innerHTML = teamPickHTML('HOME', P.teams[1], 'home', host);
  } else if (online && showTeams) {
    const P = onlinePicks(), sp = P.sp || [0, 0], you = `YOU · ${myElo.r}`, them = NET.oppElo != null ? `FRIEND · ${NET.oppElo}` : 'FRIEND';
    $('pickA').innerHTML = teamPickHTML(`AWAY · ${P.mySide === 0 ? you : them}`, P.teams[0], 'away', P.mySide === 0, sp[0]);
    $('pickH').innerHTML = teamPickHTML(`HOME · ${P.mySide === 1 ? you : them}`, P.teams[1], 'home', P.mySide === 1, sp[1]);
  } else if (showTeams) {
    $('pickA').innerHTML = teamPickHTML(derby ? 'BP PITCHER FROM' : prac ? 'OPPONENT' : 'AWAY', menuTeam('away'), 'away', true, menuSP('away'));
    $('pickH').innerHTML = teamPickHTML(derby || prac ? 'YOUR TEAM' : 'HOME', menuTeam('home'), 'home', true, menuSP('home'));
  }
  $('pickA').classList.toggle('hidden', derby); $('vsLabel').classList.toggle('hidden', derby);
  $('optSide').classList.toggle('hidden', derby || prac || squad || !showTeams);
  $('optDrill').classList.toggle('hidden', !prac);
  $('optSide').querySelector('span').textContent = lock ? 'YOUR TEAM' : 'YOU PLAY AS';
  $('optInn').classList.toggle('hidden', derby || prac || !showTeams);
  $('optDiff').classList.toggle('hidden', !showTeams);
  $('optPDiff').classList.toggle('hidden', derby || !showTeams);
  $('optThrow').classList.toggle('hidden', derby || online);
  $('optBatter').classList.toggle('hidden', !derby);
  $('optLock').classList.toggle('hidden', !lock);
  $('optView').classList.toggle('hidden', !lock && !(squad && showTeams));
  $('optLockField').classList.toggle('hidden', !lock);
  $('optLockSkip').classList.toggle('hidden', !lock);
  $('optUmp').classList.toggle('hidden', derby || !showTeams);
  $('optPark').classList.toggle('hidden', !showTeams);
  for (const el of ['optSide', 'optInn', 'optDiff', 'optPDiff', 'optUmp', 'optPark', 'optNetMode']) $(el).style.pointerEvents = guest ? 'none' : '';
  if (showTeams) {
    // the ballpark: the home team's, or any of the others
    const hk = online ? onlinePicks().teams[1] : menuTeam('home'), hp = (hk && PARKS[hk.park || hk.key]) || PARKS.FC;
    const pp = $('parkPick'), parks = Object.entries(PARKS).sort((x, y) => x[1].name.localeCompare(y[1].name));
    const opt = ([k, p]) => `<option value="${k}">${esc(p.name)}${k === 'FC' || p.classic ? '' : ' (' + k + ')'}</option>`;
    pp.innerHTML = `<option value="">Home team's park (${esc(hp.name)})</option><optgroup label="Today's ballparks">${parks.filter(([, p]) => !p.classic).map(opt).join('')}</optgroup>`
      + `<optgroup label="Classic ballparks">${parks.filter(([, p]) => p.classic).map(opt).join('')}</optgroup>`;
    pp.value = (guest ? L.park : menu.park) || '';
  }
  for (const b of $('modes').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === m);
  for (const seg of document.querySelectorAll('.seg[data-key]')) {
    let v = L[seg.dataset.key] ?? menu[seg.dataset.key];
    if (guest && seg.dataset.key === 'side') v = 1 - L.side;
    if (guest && seg.dataset.key === 'netMode') v = L.squad ? 1 : 0;
    if (seg.dataset.key === 'view') v = menu.view;   // your own camera
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === +v);
  }
  const sel = $('derbyBatter');
  sel.innerHTML = menuTeam('home').lineup.map((h, i) => `<option value="${i}">${esc(h.name)} · ${h.pos} · POW ${h.pow}</option>`).join('');
  sel.value = String(menu.batter);
  if (lock) {
    const k = menu.side === 1 ? 'home' : 'away', team = menuTeam(k);
    $('lockPick').innerHTML = lockOptions(team, menuSP(k)).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
    $('lockPick').value = menu.lockPick;
    if ($('lockPick').value !== menu.lockPick) { menu.lockPick = 'h3'; $('lockPick').value = 'h3'; }
  }
  const play = $('btnPlay');
  const block = host && NET.open ? onlineBlock() : '';
  play.classList.toggle('hidden', online && !host);
  play.disabled = (host && !NET.open) || !!block;
  play.title = block;
  play.textContent = derby ? 'START DERBY' : prac ? 'START PRACTICE' : lock ? 'PLAY AS ' + (lock ? lockName() : '') : online ? (NET.open ? (squad ? 'START SQUAD GAME' : 'START ONLINE GAME') : squad ? 'WAITING FOR FRIENDS' : 'WAITING FOR FRIEND') : 'PLAY BALL';
  if (host && NET.open && block !== (NET.blockShown || '')) { NET.blockShown = block; netStatus(block || 'Ready! Press Start when you are.', block ? 'bad' : 'good'); }
  try { localStorage.setItem('fullcount.menu', JSON.stringify(menu)); } catch (e) { /* ignore */ }
  renderResume();
  renderSquad();
  if (host && NET.open) netSendLobby();
  if (typeof renderAccount === 'function') renderAccount();
}
// why the host can't start the online game yet ('' when it's fine)
function onlineBlock() {
  const P = onlinePicks();
  if (P.squad) {
    const nobody = NET.room.find((r) => !r.pick);
    if (nobody) return nobody.sid === 0 ? 'Pick your player: click a spot on either team.' : `Waiting for ${nobody.name} to pick a player…`;
  } else if (!P.teams[1 - P.mySide]) return 'Waiting for your friend to pick a team…';
  return '';
}
function lockName() {
  const k = menu.side === 1 ? 'home' : 'away', team = menuTeam(k);
  const p = menu.lockPick[0] === 'p' ? starterOf(team, menuSP(k)) : team.lineup[+menu.lockPick.slice(1)] || team.lineup[3];
  return lastName(p.name).toUpperCase();
}
// the starting pitcher picked for a menu team, as his place in its rotation (menu.sp[k] = [team key, index]);
// a newly picked team starts its ace
function menuSP(k) { const t = menuTeam(k), s = menu.sp && menu.sp[k]; return Array.isArray(s) && s[0] === t.key && t.rotation && t.rotation[s[1]] ? s[1] : 0; }
const spIndex = (t, i) => (t && t.rotation && Number.isInteger(i) && t.rotation[i] ? i : 0);
function starterOf(t, i) { return t.rotation ? t.rotation[spIndex(t, i)] : t.pitchers[0]; }
function derbyBatterDefault() { const lu = menuTeam('home').lineup; menu.batter = lu.indexOf(lu.reduce((a, c) => (c.pow > a.pow ? c : a))); }
function buildMenu() {
  if (menu.home === menu.away) cycleTeam('away', 1, menu.home);
  $('matchup').addEventListener('click', (e) => {
    const b = e.target.closest('.arrow'); if (!b) return;
    const k = b.dataset.k, d = +b.dataset.d;
    if (menu.mode === 'online') {
      const P = onlinePicks();
      if (P.squad) { if (NET.role !== 'guest') cycleTeam(k, d, menu[k === 'away' ? 'home' : 'away']); renderMenu(); return; }
      if ((k === 'home' ? 1 : 0) !== P.mySide) return;
      if (NET.role === 'guest') { cycleTeam('netTeam', d); netSendPick(); }
      else cycleTeam(k, d);
      renderMenu(); return;
    }
    cycleTeam(k, d, menu.mode === 'derby' ? null : menu[k === 'away' ? 'home' : 'away']);
    if (k === 'home') derbyBatterDefault();
    renderMenu();
  });
  // pick a starting pitcher, or a decade
  $('matchup').addEventListener('change', (e) => {
    const sp = e.target.closest('.tp-spsel');
    if (sp) {
      let k = sp.dataset.k;
      if (menu.mode === 'online') {
        const P = onlinePicks();
        if ((k === 'home' ? 1 : 0) !== P.mySide) return;
        if (NET.role === 'guest') k = 'netTeam';
      }
      const t = menuTeam(k);
      menu.sp = { ...menu.sp, [k]: [t.key, spIndex(t, +sp.value)] };
      if (k === 'netTeam') netSendPick();
      renderMenu(); return;
    }
    const s = e.target.closest('.tp-era'); if (!s) return;
    const k = s.dataset.k, v = CLASSIC.has(s.value) || TEAMS.some((t) => t.key === s.value) ? s.value : null;
    if (!v) return;
    if (menu.mode === 'online') {
      const P = onlinePicks();
      if (P.squad) { if (NET.role !== 'guest' && v !== menu[k === 'away' ? 'home' : 'away']) menu[k] = v; }
      else if ((k === 'home' ? 1 : 0) !== P.mySide) return;
      else if (NET.role === 'guest') { menu.netTeam = v; netSendPick(); } else menu[k] = v;
    } else {
      const other = menu[k === 'away' ? 'home' : 'away'];
      if (v === other && menu.mode !== 'derby') return;
      menu[k] = v;
      if (k === 'home') derbyBatterDefault();
    }
    renderMenu();
  });
  $('modes').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (menu.mode === 'online' && b.dataset.mode !== 'online') { netClose(); netStatus(''); }
    menu.mode = b.dataset.mode;
    if (menu.mode === 'derby') derbyBatterDefault();
    renderMenu();
  });
  for (const seg of document.querySelectorAll('.seg[data-key]')) seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'), key = seg.dataset.key;
    if (!b || (NET.role === 'guest' && key !== 'view')) return;   // the camera is each player's own choice
    // a squad of more than two can't turn into a 1v1
    if (key === 'netMode' && +b.dataset.v === 0 && NET.links.length > 1) { netStatus('There are more than two of you in the room. A 1v1 needs just one friend.', 'bad'); return; }
    menu[key] = +b.dataset.v;
    renderMenu();
  });
  $('derbyBatter').addEventListener('change', (e) => { menu.batter = +e.target.value; renderMenu(); });
  $('lockPick').addEventListener('change', (e) => { menu.lockPick = e.target.value; renderMenu(); });
  $('parkPick').addEventListener('change', (e) => { menu.park = PARKS[e.target.value] ? e.target.value : ''; renderMenu(); });
  $('btnHost').addEventListener('click', () => { SND.init(); netHost(); });
  $('btnJoin').addEventListener('click', () => { SND.init(); netJoin($('joinCode').value); });
  $('btnWatch').addEventListener('click', () => { SND.init(); netJoin($('joinCode').value, true); });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { SND.init(); netJoin($('joinCode').value); } });
  $('btnCopyLink').addEventListener('click', () => {
    const link = inviteLink(NET.code || '');
    const done = () => netStatus('Invite link copied. Send it to your friend!', 'good');
    try { navigator.clipboard.writeText(link).then(done, () => netStatus('Copy failed. Share the code or the link shown above.', 'bad')); } catch (e) { netStatus('Share the code or the link shown above.'); }
  });
  $('btnPlay').addEventListener('click', () => {
    SND.init();
    if (menu.mode === 'online') { hostStartOnline(); return; }
    const teams = [teamSpec(menuTeam('away')), teamSpec(menuTeam('home'))];
    startGame({ mode: menu.mode, teams, starters: ['away', 'home'].map((k) => (spShown(k) ? menuSP(k) : 0)), drill: ['bat', 'pitch', 'run', 'field'][menu.drill] || 'bat', side: menu.side, innings: menu.innings, diff: menu.diff, pdiff: menu.pdiff, manual: menu.manual, batter: menu.batter, lockPick: menu.lockPick, ump: menu.ump, view: menu.view, lockField: menu.lockField, lockSkip: menu.lockSkip, park: menu.park || '' });
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
  if (G.mode === 'online' && NET.role !== 'spec' && G.phase !== 'final') eloApply(false, 'quit');   // quitting a game in progress is a loss
  if (G.mode === 'online') netClose();
  if (G.replay) endReplay();
  $('replayBar').classList.add('hidden'); closeReplays();
  G.mode = 'menu'; G.paused = false; G.replay = null; G.play = null; G.lock = null; G.squad = null; G.me = -1; G.skipping = false; G.ctrl = ['cpu', 'cpu']; G.localPitch = false;
  setPhase('menu');
  $('hud').classList.add('hidden'); $('pause').classList.add('hidden');
  document.body.classList.remove('letterbox');
  for (const m of MODELS) m.root.visible = false;
  ballMesh.visible = false; ballShadow.visible = false; trailReset();
  pci.visible = false; reticle.visible = false; mitt.visible = false; zoneGroup.visible = false; pitchMark.visible = false; pitchGuide.visible = false; ctrlRing.visible = false; landMark.visible = false;
  fpvHide(null); fpvOn = false; exitPointerLock(); $('absCard').classList.add('hidden'); $('simBtn').classList.add('hidden'); runnerHUD(false); $('throwPrompt').classList.add('hidden');
  showScreen('menu');
  renderMenu();
}

// -------------------------------------------------------------- main loop ----
const LIVE_BALL = new Set(['live', 'derbyFlight', 'postPlay', 'derbyResult']);
// shared per-frame dressing: occluder fading, ball shadow, ball trail
function dressFrame() {
  const ghost = G.prevCam === 'bat' && ['prePitch', 'windup', 'pitch', 'postPitch'].includes(G.phase) ? 0.14 : 1;
  const cm = G.fByRole.C ? G.fByRole.C.m : isGuest() ? MODELS.find((m) => m.root.visible && m.anim === 'catcher') : null;
  if (cm) setFade(cm, ghost);
  if (G.umps[0]) setFade(G.umps[0], tpUmpGhost ? 0.3 : ghost);
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
    case 'prePitch': {
      const pc = pitchCtrl();
      if (G.drill === 'field') { if (G.pt >= G.fungoAt) fungo(); break; }
      if (G.cpuIBB && G.pt >= 0.7) { intentionalWalk(1 - G.half); break; }
      if (G.cpuPick && G.pt >= G.cpuPick.at) { startPickoff(G.cpuPick.base); break; }
      if (pc === 'local') updatePitchUI(); else if (pc === 'cpu' && G.pt >= G.cpuPitchAt) startWindup(G.spec);
      // a squad can't all wait on one friend who walked away: after 30 seconds the CPU throws one for him
      else if (pc === 'remote' && G.squad && G.pt >= 30) { startWindup(cpuChoosePitch()); }
      break;
    }
    case 'windup': updateWindup(); updateStealers(dt); break;
    case 'pitch': updateStealers(dt); updatePitch(dt); break;
    case 'postPitch':
      if (G.challengeable && G.cpuChallengeAt && G.now >= G.cpuChallengeAt) { startChallenge(G.challengeable.side); break; }
      if (G.pt >= G.dur) endPostPitch();
      break;
    case 'absReview': if (G.pt >= G.dur) revealChallenge(); break;
    case 'reviewWait':
      if (G.review && G.review.who === 'cpu' && G.cpuChallengeAt && G.now >= G.cpuChallengeAt) { startReview(); break; }
      if (G.pt >= G.dur) { const pl = G.play; G.review = null; setHint(''); hudScore(); finishLive(pl, true); }
      break;
    case 'replayReview': if (G.pt >= G.dur) revealReview(); break;
    case 'reviewShow': if (G.pt >= G.dur) finishLive(G.play, true); break;
    case 'postFoul': if (G.pt >= G.dur) enterPrePitch(); break;
    case 'live': updateLive(dt); break;
    case 'postPlay': if (G.pt >= G.dur) { const next = G.postNext; G.postNext = null; if (next) next(); else afterAB(); } break;
    case 'break': if (G.pt >= G.dur) nextHalf(); break;
    case 'derbyFlight': updateDerbyFlight(); playCam(); break;
    case 'derbyResult': if (G.pt >= G.dur) endDerbyResult(); break;
    case 'final': menuCam(dt * 0.6); break;
  }
  dressFrame();
  for (const m of MODELS) updateModel(m, G.now);
  if (G.recOn) recFrame();
  updateThrowGuide();
  if (STEAL_PHASES.includes(G.phase)) runnerHUD(userRuns() && G.baseRunners.length > 0);
  else if (G.phase !== 'live') runnerHUD(false);
  pickoffHUD();
  fpvCam(dt);
}
// Player Lock: you only play when you're involved - at bat, on base, or when the ball is
// hit your way. Everything else is skipped behind the SIMULATING card
// (or, with skipping turned off, fast-forwarded on screen).
const SKIP_SPEED = 40;
function lockInvolved() {
  if (G.simAB) return false;
  const ph = G.phase, pl = G.play, live = (ph === 'live' || ph === 'postPlay') && !!pl;
  if (!live) return userBats() || userPitches() || userCatches() || (LOCK_PHASES.includes(ph) && (G.baseRunners || []).some((x) => x.pl.id === G.lock));
  if (pl.R.some((r) => r.pl.id === G.lock && (r.state === 'run' || r.state === 'base'))) return true;
  return G.lockInv && G.half === 1 - G.lockSide;
}
function lockFF() {
  G.skipping = false;
  if (G.squad && G.mode === 'online') return 1;   // a squad plays every pitch, in real time
  if (G.mode !== 'lock' || G.replay || G.phase === 'final') return 1;
  if (G.lockSkip) {
    if (!lockInvolved()) { G.skipping = true; return SKIP_SPEED; }
    // on base: watch the pitch, but don't wait around between pitches
    return !userBats() && !userPitches() && !userCatches() && (G.phase === 'postPitch' || G.phase === 'postFoul') ? 3 : 1;
  }
  if (G.simAB) return 6;
  if (userBats() || userPitches() || userCatches()) return 1;
  const ph = G.phase;
  if (ph === 'live') {
    const pl = G.play; if (!pl) return 1;
    // your player is always yours to steer now, so "steering" means you touched the controls lately
    if (pl.uf && (pl.uf === pl.chaser || pl.uf === pl.ball.holder || pl.prompt || G.lockInv || pl.t - pl.lastInput < 1.5 || pl.uf.task === 'cover')) return 1;
    if (pl.R.some((r) => r.pl.id === G.lock && (r.state === 'run' || r.state === 'base'))) return 1;
    return 3;
  }
  // in the field with a Player Lock camera, slow down so you can react to the hit
  if (G.view && !G.lockFieldSim && lockRole().role === 'field') return ph === 'prePitch' || ph === 'postPitch' || ph === 'postFoul' ? 2 : 1;
  if (['prePitch', 'windup', 'pitch', 'postPitch', 'postFoul'].includes(ph)) return 5;
  if (['postPlay', 'halfIntro', 'break'].includes(ph)) return 3;
  return 1;
}
function frame(ts) {
  requestAnimationFrame(frame);
  const raw = (ts - (frame.last || ts)) / 1000, dt = Math.min(0.05, Math.max(0, raw)); frame.last = ts;
  perfTick(raw);
  frameStep(dt);
  renderer.render(scene, camera);
}
function frameStep(dt) {
  G.stick = pollGamepad();
  if (G.replay && (G.replay.theater || G.paused)) updateReplay(dt);
  else if (!G.paused && !G.hold) {
    if (isGuest()) guestUpdate(dt);
    else if (G.beat > 0) G.beat -= dt;   // a beat to get your bearings when a skip lands you in a play
    else if (G.mode === 'lock' || G.squad) {
      const n = lockFF();
      // stop fast-forwarding the moment you become involved
      for (let i = 0; i < n; i++) { update(dt); if (i + 1 < n && lockFF() < n) break; }
    } else update(dt);
  }
  updateSkipUI();
  edgeTurn(dt);
  $('btnTeamHud').classList.toggle('hidden', !(G.teams && G.mode !== 'menu' && mySide() >= 0 && G.mode !== 'lock' && !G.squad && G.mode !== 'derby' && !G.drill && G.phase !== 'final'));
  netTick();
  camUpdate(dt);
  const d = camera.position.distanceTo(ballMesh.position);
  ballMesh.scale.setScalar(fpvOn ? clamp(d / 40, 1.5, 8) : clamp(d / 80, 1, 7));
  crowdU.uTime.value += dt;
  crowdU.uEx.value = lerp(crowdU.uEx.value, crowdExTarget, 1 - Math.exp(-dt * 3));
  updateFireworks(dt);
  drawMiniMap();
  squadTags();
  updateLockUI();
}
function boot() {
  makeUmps();
  netInstallHooks();
  buildTeamUI();
  buildRecordsUI();
  buildOptionsUI();
  buildMenu();
  buildReplayUI();
  buildCloudUI();
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
  G, TEAMS, settings, NET, keys, Play, Runner, BASES, simBatted, umpCallsStrike, inZone, eloApply, eloMine, V3, getModel, ballMesh, startPickoff, stealCmd, camTo, setPark, PARKS, fenceDist, fenceH, gameRecord, gamesList, loadSave, openLiveBox, openStats, toMenu, renderMenu, menu, teamToDef, cleanRoster, buildCustomTeam, Cloud, cloudRender, inviteToast,
  renderer, scene, camera, MODELS, setAnim, updateModel,
  step(sec, dt = 1 / 60) {
    const n = Math.round(sec / dt);
    for (let i = 0; i < n && !G.paused; i++) { if (isGuest()) guestUpdate(dt); else update(dt); netTick(); }
    camUpdate(dt); renderer.render(scene, camera);
  },
  render() { camUpdate(1 / 60); renderer.render(scene, camera); },
  // run the real per-frame loop (fast-forward, skipping, beats) for `sec` seconds of wall time
  run(sec, dt = 1 / 60) { for (let t = 0; t < sec && G.phase !== 'final'; t += dt) frameStep(dt); renderer.render(scene, camera); },
  cam: () => ({ pos: camRig.pos.toArray().map((v) => +v.toFixed(1)), look: camRig.look.toArray().map((v) => +v.toFixed(1)), fl: { ...FL }, fpvOn, tp: { ...TP } }),
  // what this device controls right now (online squad tests)
  ctl: () => ({ ub: userBats(), up: userPitches(), uf: userFields(), ur: userRuns(), fpvOn, view: G.view, lock: G.lock, me: G.me, role: G.teams && G.mode !== 'menu' ? lockRole().role : null }),
  claimSpot, hostStartOnline,
  tick(dt = 1 / 30) { if (isGuest()) guestUpdate(dt); else update(dt); netTick(); },
  setBases(list) { const lu = G.lu[G.half]; G.bases = [null, null, null, null]; for (const b of list) G.bases[b] = lu[(b + 4) % 9]; placeForPitch(); },
  // put a specific ball in play from the current pitch setup (for testing fielding / running)
  forceBall(ev, la, spray) {
    G.P = G.P || { type: 'FF', mph: 94 }; G.cross = G.cross || { x: 0, y: 2.5 };
    launch(ev, la, spray, new V3(0, 3, -0.5), 0.8, false);
  },
  start: (cfg) => startGame(Object.assign({ mode: 'cpu', away: 0, home: 3, side: 1, innings: 9, diff: 1, manual: 0, batter: 3 }, cfg)),   // a test harness: CPU against CPU
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
