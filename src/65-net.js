// ============================================================================
// Online 1v1 over WebRTC (PeerJS). The host runs the whole simulation and
// streams snapshots. The guest renders them, but times its own swings and
// pitches on its own clock (so lag never costs a hitter) and sends inputs back.
// ============================================================================

const NET = { role: null, peer: null, conn: null, code: null, open: false, dirty: false, lastSnap: 0, lastIn: 0, sentIn: '', lobby: null, snap: null, crackT: -9, mcache: new Map(), lastAbLen: 0, remoteInAt: 0 };
const PEER_PREFIX = 'fullcount26-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const isHost = () => NET.role === 'host' && NET.open && G.mode === 'online';
const isGuest = () => NET.role === 'guest' && G.mode === 'online';

// ------------------------------------------------------------ connection ----
function netStatus(text, cls = '') { const el = $('netStatus'); el.textContent = text; el.className = 'net-status ' + cls; }
function netReady() { return typeof window.Peer === 'function'; }
function inviteLink(code) { const u = new URL(location.href); u.search = '?join=' + code; u.hash = ''; return u.toString(); }
function netErrText(e) {
  const t = e && e.type;
  if (t === 'peer-unavailable') return 'No game with that code. Double-check it with your friend.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the matchmaking server. Check your connection and try again.';
  if (t === 'browser-incompatible') return 'This browser does not support online play. Try Chrome, Edge, Firefox or Safari.';
  return 'Connection problem' + (t ? ` (${t})` : '') + '. Try again.';
}
function netHost() {
  if (!netReady()) { netStatus('Online play did not load. Check your internet connection and refresh the page.', 'bad'); return; }
  netClose();
  NET.role = 'host';
  const code = Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  NET.code = code;
  netStatus('Opening a room…');
  const peer = (NET.peer = new Peer(PEER_PREFIX + code));
  peer.on('open', () => {
    $('netCode').textContent = code; $('netLink').textContent = inviteLink(code);
    netStatus('Room open. Waiting for your friend to join…');
    renderMenu();
  });
  peer.on('connection', (conn) => {
    if (NET.conn && NET.open) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 400); }); return; }
    netBind(conn);
  });
  peer.on('error', (e) => { if (e.type === 'unavailable-id' && NET.peer === peer) { netHost(); return; } netStatus(netErrText(e), 'bad'); });
  peer.on('disconnected', () => { if (NET.peer === peer) try { peer.reconnect(); } catch (err) { /* already gone */ } });
  renderMenu();
}
function netJoin(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) { netStatus('Room codes are 5 characters long.', 'bad'); return; }
  if (!netReady()) { netStatus('Online play did not load. Check your internet connection and refresh the page.', 'bad'); return; }
  netClose();
  NET.role = 'guest'; NET.code = code;
  netStatus(`Joining room ${code}…`);
  const peer = (NET.peer = new Peer());
  peer.on('open', () => {
    netBind(peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' }));
    setTimeout(() => { if (NET.peer === peer && !NET.open) netStatus('Could not reach that room. Check the code, and make sure your friend is still on the host screen.', 'bad'); }, 12000);
  });
  peer.on('error', (e) => { if (NET.peer === peer) netStatus(netErrText(e), 'bad'); });
  renderMenu();
}
function netBind(conn) {
  NET.conn = conn;
  conn.on('open', () => {
    NET.open = true;
    if (NET.role === 'host') { netStatus('Your friend is here! Pick the matchup and press Start.', 'good'); netSendLobby(); }
    else { conn.send({ t: 'hello' }); netStatus('Connected! Waiting for the host to start the game…', 'good'); }
    renderMenu();
  });
  conn.on('data', netOnMsg);
  conn.on('close', netLost);
  conn.on('error', netLost);
}
function netLost() {
  if (!NET.open) return;
  NET.open = false; NET.conn = null;
  if (G.mode === 'online') {
    G.paused = false; $('pause').classList.add('hidden');
    hudBanner('DISCONNECTED', 'Your opponent left the game', '');
    setTimeout(() => { if (G.mode === 'online') toMenu(); }, 3500);
  }
  netStatus('The connection closed. Host or join again to play.', 'bad');
  renderMenu();
}
function netClose() {
  const { conn, peer } = NET;
  Object.assign(NET, { role: null, peer: null, conn: null, open: false, code: null, lobby: null, snap: null });
  try { if (conn) conn.close(); } catch (e) { /* ignore */ }
  try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
}
function netSend(m) { if (NET.open && NET.conn) try { NET.conn.send(m); } catch (e) { /* channel closing */ } }
function netSendLobby() { if (NET.role === 'host' && NET.open) netSend({ t: 'lobby', away: menu.away, home: menu.home, side: menu.side, innings: menu.innings, diff: menu.diff, ump: menu.ump }); }
function hostStartOnline() {
  if (!(NET.role === 'host' && NET.open)) return;
  const cfg = { mode: 'online', away: menu.away, home: menu.home, side: menu.side, innings: menu.innings, diff: menu.diff, manual: 1, ump: menu.ump };
  netSend({ t: 'start', cfg });
  startGame(cfg);
}

// ------------------------------------------------------------- messages ----
function netOnMsg(m) {
  if (!m || typeof m !== 'object') return;
  if (NET.role === 'host') hostOnMsg(m); else guestOnMsg(m);
}
function hostOnMsg(m) {
  if (m.t === 'hello') { netSendLobby(); return; }
  if (m.t === 'in') { G.remoteIn.x = clamp(+m.x || 0, -1, 1); G.remoteIn.z = clamp(+m.z || 0, -1, 1); NET.remoteInAt = performance.now(); return; }
  if (m.t !== 'act' || G.mode !== 'online') return;
  const pl = G.play;
  switch (m.a) {
    case 'swing': remoteSwing(m); break;
    case 'take': if (G.phase === 'pitch' && batCtrl() === 'remote') G.remoteTake = true; break;
    case 'pitch': remotePitch(m); break;
    case 'throw': if (pl && fieldCtrl() === 'remote') pl.userThrow(clamp(m.base | 0, 1, 4)); break;
    case 'dive': if (pl && fieldCtrl() === 'remote') pl.userDive(); break;
    case 'switch': if (pl && fieldCtrl() === 'remote') pl.userSwitch(); break;
    case 'run': if (pl && runCtrl() === 'remote') pl.runCmd(m.kind === 'go' ? 'go' : 'back'); break;
    case 'skip': skip(true); break;
    case 'trot': if (pl && (pl.hr || pl.awarded) && pl.t > 2) pl.skipTrot(); break;
    case 'pause': togglePause(!!m.v, true); break;
    case 'pen': { const s = 1 - localSide(); if (s === 1 - G.half && G.phase === 'prePitch' && bringReliever(s)) enterPrePitch(); break; }
    case 'again': if (G.phase === 'final') hostRestart(); break;
    case 'challenge': if (G.challengeable && G.challengeable.who === 'remote') startChallenge(G.challengeable.side); break;
  }
}
function hostRestart() { netSend({ t: 'start', cfg: G.cfg }); showScreen(null); startGame(G.cfg); }
function guestOnMsg(m) {
  switch (m.t) {
    case 'lobby': NET.lobby = m; renderMenu(); break;
    case 'full': netStatus('That game already has two players.', 'bad'); netClose(); renderMenu(); break;
    case 'start': showScreen(null); startGame({ ...m.cfg, guest: true }); break;
    case 'gs': if (G.mode === 'online') netApplyGS(m); break;
    case 's': if (G.mode === 'online') netApplySnap(m); break;
    case 'pitch': if (G.mode === 'online') guestPitch(m); break;
    case 'ev': if (G.mode === 'online') guestEv(m.f, m.a || []); break;
    case 'screen': if (G.mode === 'online') guestScreen(m); break;
    case 'pause': G.paused = !!m.v; $('pause').classList.toggle('hidden', !G.paused); break;
  }
}

// ---------------------------------------------- host -> guest broadcasting ----
function netEv(f, a) { if (isHost()) netSend({ t: 'ev', f, a }); }
function netEvTo(f, a) { netEv(f, a); }
function netInstallHooks() {
  { const o = hudCall; hudCall = (...a) => { o(...a); netEv('call', a); }; }
  { const o = hudBanner; hudBanner = (...a) => { o(...a); netEv('banner', a); }; }
  { const o = fireworks; fireworks = (...a) => { o(...a); netEv('fw', a); }; }
  { const o = excite; excite = (...a) => { o(...a); netEv('excite', a); }; }
  { const o = updateFeedbackStats; updateFeedbackStats = (d) => { o(d); netEv('fbstats', [d]); }; }
  { const o = absShow; absShow = (...a) => { o(...a); netEv('absShow', a); }; }
  { const o = absReveal; absReveal = (...a) => { o(...a); netEv('absReveal', a); }; }
  { const o = hudPitchInfo; hudPitchInfo = (info) => { const i = info || (G.P && { mph: G.P.mph, type: G.P.type }); o(i); netEv('pinfo', [i]); }; }
  { const o = Caster.line.bind(Caster); Caster.line = (...a) => { o(...a); netEv('cast', a); }; }
  for (const k of ['crack', 'pop', 'thud', 'roar', 'charge', 'stretch', 'fanfare', 'say']) { const o = SND[k].bind(SND); SND[k] = (...a) => { o(...a); netEv('snd', [k, ...a]); }; }
  { const o = hudScore; hudScore = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = hudCount; hudCount = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = hudBatter; hudBatter = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = hudPitcher; hudPitcher = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = drawTracker; drawTracker = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = drawBoards; drawBoards = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = showScreen; showScreen = (id) => { o(id); if (isHost()) netSend({ t: 'screen', id, html: screenHTML(id) }); }; }
}
function screenHTML(id) {
  const ids = id === 'breakCard' ? ['breakTitle', 'breakLS', 'breakSub'] : id === 'final' ? ['finalTitle', 'finalLS', 'potg', 'finalSub'] : [];
  return Object.fromEntries(ids.map((k) => [k, $(k).innerHTML]));
}
function netGS() {
  return {
    t: 'gs', inning: G.inning, half: G.half, outs: G.outs, balls: G.balls, strikes: G.strikes,
    score: G.score, line: G.line, hits: G.hits, errs: G.errs, order: G.order, pen: G.pen,
    bases: G.bases.map((p) => (p ? p.id : null)), batter: G.batter ? G.batter.id : null, batSide: G.batSide,
    pitcher: G.pitcher.map((p) => (p ? p.id : null)), stats: [...G.stats], pstats: [...G.pstats],
    abPitches: G.abPitches, lastP: G.lastP || null,
    chal: G.challenges, ump: G.ump, chk: G.challengeable && G.challengeable.who === 'remote' ? G.challengeable.side : -1,
  };
}
function netSnapshot() {
  const m = [];
  for (const md of MODELS) {
    if (!md.root.visible || !md.key) continue;
    const p = md.root.position;
    let prm = md.prm;
    if (prm && prm.glove) prm = { glove: [r2(prm.glove.x), r2(prm.glove.y), r2(prm.glove.z)] };
    m.push([md.key, r2(p.x), r2(p.y), r2(p.z), r3(md.root.rotation.y), md.anim, r3(G.now - md.t0), prm, r2(md.phase), md.fielding ? 1 : 0, md.j.helmet.visible ? 1 : 0, md.batsL ? 1 : 0]);
  }
  const b = ballMesh.position, pl = G.play, remoteField = fieldCtrl() === 'remote';
  return {
    t: 's', ph: G.phase, dur: G.dur, b: [r2(b.x), r2(b.y), r2(b.z), ballMesh.visible ? 1 : 0], m,
    f: G.camFocus ? G.camFocus.map(r2) : null,
    pl: pl && G.phase === 'live' ? { prompt: pl.prompt && pl.userDef && remoteField ? 1 : 0, uf: remoteField && pl.uf ? pl.uf.m.key : null, land: remoteField ? pl.landingSpot() : null, hr: pl.hr || pl.awarded ? 1 : 0 } : null,
  };
}
function netPitchOut() {
  if (!isHost()) return;
  const P = G.P;
  netSend({ t: 'pitch', rel: [P.rel.x, P.rel.y, P.rel.z], v0: [P.v0.x, P.v0.y, P.v0.z], a: [P.a.x, P.a.y, P.a.z], T: P.T, mph: P.mph, type: P.type, tc: G.tc, tPlate: G.tPlate, tCatch: G.tCatch, cross: G.cross, isStrike: G.isStrike });
}
function netTick() {
  if (!isHost()) return;
  if (NET.dirty) { NET.dirty = false; netSend(netGS()); }
  const now = performance.now();
  if (now - NET.lastSnap >= 33) { NET.lastSnap = now; netSend(netSnapshot()); }
  if (now - NET.remoteInAt > 500) { G.remoteIn.x = 0; G.remoteIn.z = 0; }
}

// ------------------------------------------------------------ guest side ----
function guestStart() {
  setPhase('wait');
  G.fielders = []; G.fByRole = {}; G.swing = null; G.P = null; G.localPitch = false; G.lastP = null; G.batter = null;
  NET.lastAbLen = 0; NET.snap = null;
  for (const m of MODELS) { m.root.visible = false; m.net = null; }
  wideCam(true);
  setHint('Joining the game&hellip;');
  drawBoards();
}
function modelByKey(key) {
  if (/^U\d$/.test(key)) return G.umps[+key[1]];
  if (NET.mcache.has(key)) return NET.mcache.get(key);
  const [id, , kind] = key.split('|');
  const pl = PBYID[id]; if (!pl) return null;
  const m = getModel(pl, kind || undefined);
  NET.mcache.set(key, m);
  return m;
}
function netPrm(m, prm) {
  if (prm && Array.isArray(prm.glove)) { m.gv = m.gv || new V3(); m.gv.set(prm.glove[0], prm.glove[1], prm.glove[2]); return { glove: m.gv }; }
  return prm;
}
function netApplyGS(s) {
  Object.assign(G, { inning: s.inning, half: s.half, outs: s.outs, balls: s.balls, strikes: s.strikes, score: s.score, line: s.line, hits: s.hits, errs: s.errs, order: s.order, pen: s.pen, batSide: s.batSide, abPitches: s.abPitches || [], lastP: s.lastP });
  G.bases = s.bases.map((id) => (id ? PBYID[id] : null));
  G.pitcher = s.pitcher.map((id) => (id ? PBYID[id] : null));
  G.batter = s.batter ? PBYID[s.batter] : null;
  if (G.batter) G.batterModel = getModel(G.batter);
  G.stats = new Map(s.stats); G.pstats = new Map(s.pstats);
  G.challenges = s.chal || [0, 0]; G.ump = s.ump ?? G.ump;
  const canChallenge = s.chk >= 0 && s.chk === localSide();
  if (canChallenge && G.chkSide !== s.chk) setHint(`<kbd>C</kbd> challenge the call &middot; ${G.challenges[s.chk]} left`);
  else if (!canChallenge && G.chkSide >= 0 && G.chkSide === localSide()) setHint('');
  G.chkSide = s.chk;
  hudScore(); hudCount(); if (G.batter) hudBatter(); hudPitcher(); drawTracker(); drawBoards();
  const n = G.abPitches.length, last = G.abPitches[n - 1];
  if (n !== NET.lastAbLen) {
    NET.lastAbLen = n;
    if (last) {
      pitchMark.position.set(last.x, last.y, 0);
      pitchMark.material.color.set(last.res === 'Ball' || last.res === 'HBP' ? '#3fd38a' : last.res === 'Foul' ? '#ffc94a' : last.res === 'In play' ? '#5aa8ff' : '#ff5a5f');
      pitchMark.visible = userBats() && settings.zone && G.phase !== 'live';
    }
  }
}
function netApplySnap(s) {
  NET.snap = s;
  if (s.ph !== G.phase) guestPhase(s.ph);
  G.dur = s.dur; G.camFocus = s.f;
  const seen = new Set();
  const freezeBatter = !!G.swing && (G.localPitch || G.phase === 'pitch' || G.phase === 'windup');
  for (const e of s.m) {
    const m = modelByKey(e[0]); if (!m) continue;
    seen.add(m);
    if (!m.root.visible || !m.net) { m.net = m.net || { p: new V3(), ry: 0 }; m.netSnap = true; }
    m.root.visible = true;
    m.net.p.set(e[1], e[2], e[3]); m.net.ry = e[4];
    if (!(freezeBatter && m === G.batterModel)) { m.anim = e[5]; m.t0 = G.now - e[6]; m.prm = netPrm(m, e[7]); m.phase = e[8]; }
    m.fielding = !!e[9]; m.batsL = !!e[11];
    if (m.kind === 'player') setHelmet(m, !!e[10]);
  }
  for (const m of MODELS) if (m.root.visible && !seen.has(m)) m.root.visible = false;
  if (!G.localPitch) { ballMesh.position.set(s.b[0], s.b[1], s.b[2]); ballMesh.visible = !!s.b[3]; }
}
function guestPhase(ph) {
  G.phase = ph; G.pt = 0;
  if (ph !== 'pitch') G.localPitch = false;
  switch (ph) {
    case 'prePitch':
      G.swing = null; G.P = null; pitchGuide.visible = false; trailReset(); hideFeedback();
      prePitchUI(); G.rec = []; G.recOn = true; G.bb = null;
      break;
    case 'windup': reticle.visible = false; break;
    case 'live':
      pci.visible = false; zoneGroup.visible = false; pitchGuide.visible = false; pitchMark.visible = false; $('meter').classList.add('hidden');
      G.contactT = G.now; G.bb = { hr: false, la: 20 };
      setHint(liveHint());
      break;
    case 'postPitch': case 'postFoul': G.recOn = false; break;
    case 'postPlay': G.recOn = false; setHint(''); $('throwPrompt').classList.add('hidden'); $('runHelp').classList.add('hidden'); ctrlRing.visible = false; landMark.visible = false; break;
    case 'halfIntro': case 'break':
      pci.visible = false; zoneGroup.visible = false; reticle.visible = false; pitchGuide.visible = false; $('meter').classList.add('hidden'); setHint('');
      wideCam(true);
      break;
  }
}
function guestPitch(m) {
  G.P = { rel: new V3(...m.rel), v0: new V3(...m.v0), a: new V3(...m.a), T: m.T, mph: m.mph, type: m.type };
  Object.assign(G, { tc: m.tc, tPlate: m.tPlate, tCatch: m.tCatch, cross: m.cross, isStrike: m.isStrike, lastP: { mph: m.mph, type: m.type } });
  G.pitchT0 = G.now; G.localPitch = true; G.tookSent = false;
  ballMesh.visible = true; reticle.visible = false; pitchMark.visible = false; trailReset();
  if (G.swing && !G.swing.calc) G.swing.calc = calcUserContact(G.swing);
}
function guestPitchTick() {
  const t = G.now - G.pitchT0, sw = G.swing;
  let tt = Math.min(t, G.tCatch);
  if (sw && sw.calc && !sw.calc.miss) {
    const at = clamp(sw.tContact, G.tc - 0.03, G.tc + 0.025);
    if (t >= at) { tt = at; if (!sw.done) { sw.done = true; SND.crack(clamp(sw.calc.Q || 0.5, 0.15, 1)); NET.crackT = G.now; } }
  }
  pitchPos(G.P, tt, ballMesh.position);
  updateGuide(t);
  if (userBats() && !G.swing && !G.tookSent && t >= G.tCatch + 0.05) { G.tookSent = true; netSend({ t: 'act', a: 'take' }); }
}
// before a guest swing, take ownership of the batter's pose so the swing shows instantly
function guestPrepSwing() {
  const m = G.batterModel; if (!m) return;
  G.batPrm = { m: G.batSide === 'R' ? 1 : -1, swingT: null, dur: 0.36, hc: 3.2, hzc: 0.85, elc: -0.08, bunt: false, ...(m.prm && m.anim === 'bat' ? m.prm : {}) };
  G.batPrm.swingT = null; G.batPrm.bunt = false;
  if (m.anim !== 'bat') { m.anim = 'bat'; m.t0 = G.now; }
  m.prm = G.batPrm;
}
function guestEv(f, a) {
  switch (f) {
    case 'call': hudCall(...a); break;
    case 'banner': hudBanner(...a); break;
    case 'cast': Caster.line(...a); break;
    case 'fw': fireworks(...a); break;
    case 'excite': excite(...a); break;
    case 'snd': { const [k, ...r] = a; if (k === 'crack' && G.now - NET.crackT < 1.5) return; if (typeof SND[k] === 'function') SND[k](...r); break; }
    case 'showFeedback': showFeedback(...a); break;
    case 'fbstats': updateFeedbackStats(...a); break;
    case 'pinfo': hudPitchInfo(...a); break;
    case 'absShow': absShow(...a); break;
    case 'absReveal': absReveal(...a); break;
  }
}
function guestScreen(m) {
  for (const [k, v] of Object.entries(m.html || {})) { const el = $(k); if (el) el.innerHTML = v; }
  if (m.id === 'final') setPhase('final');
  showScreen(m.id);
}
function guestUpdate(dt) {
  G.now += dt; G.pt += dt;
  if (G.replay) { updateReplay(dt); return; }
  aimUpdate(dt);
  if (G.phase === 'prePitch' && userPitches() && G.pitchUI.state !== 'done') updatePitchUI();
  if (G.localPitch && G.P) guestPitchTick();
  const k = 1 - Math.exp(-dt * 16);
  for (const m of MODELS) {
    if (!m.root.visible || !m.net) continue;
    if (m.netSnap) { m.root.position.copy(m.net.p); m.root.rotation.y = m.net.ry; m.netSnap = false; }
    else { m.root.position.lerp(m.net.p, k); m.root.rotation.y += angDiff(m.root.rotation.y, m.net.ry) * k; }
  }
  if (G.phase === 'live' || G.phase === 'postPlay') playCam();
  else if (G.phase === 'final') menuCam(dt * 0.6);
  if (G.phase === 'live' && userFields()) {
    const v = fieldVec(), key = v.x.toFixed(2) + ',' + v.z.toFixed(2), now = performance.now();
    if ((key !== NET.sentIn && now - NET.lastIn > 45) || now - NET.lastIn > 250) { NET.sentIn = key; NET.lastIn = now; netSend({ t: 'in', x: v.x, z: v.z }); }
  }
  const pl = G.phase === 'live' && NET.snap ? NET.snap.pl : null;
  const ufm = pl && pl.uf ? modelByKey(pl.uf) : null;
  ctrlRing.visible = !!ufm;
  if (ufm) ctrlRing.position.set(ufm.root.position.x, groundY(ufm.root.position.x, ufm.root.position.z) + 0.12, ufm.root.position.z);
  landMark.visible = !!(pl && pl.land && landingAssist());
  if (landMark.visible) landMark.position.set(pl.land[0], 0.1, pl.land[1]);
  $('throwPrompt').classList.toggle('hidden', !(pl && pl.prompt));
  $('runHelp').classList.toggle('hidden', !(pl && userRuns() && !pl.hr));
  dressFrame();
  for (const m of MODELS) updateModel(m, G.now);
  if (G.recOn) recFrame();
}
