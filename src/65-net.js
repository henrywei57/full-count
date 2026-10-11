// ============================================================================
// Online 1v1 over WebRTC (PeerJS). The host runs the whole simulation and the
// guest renders it. What keeps the guest's side feeling local:
//  - snapshots go 60 times a second over a second, unreliable and unordered
//    data channel, so a lost packet never holds up the ones behind it
//  - the guest syncs its clock to the host's and pushes every player forward
//    to "now" instead of drawing where he was half a round trip ago
//  - the batted ball and throws are simulated on the guest from their launch
//    numbers, so the ball flies smoothly at full frame rate
//  - the fielder the guest steers moves on the guest's screen right away; the
//    host takes the guest's position for him
//  - swings and pitches are timed on the guest's own clock, so lag never costs a hitter
// ============================================================================

const NET = {
  role: null, peer: null, conn: null, fast: null, fastOK: false, hiT: 0, code: null, open: false, peerOpen: false, dirty: false,
  lastSnap: 0, seq: 0, lastSeq: -1, inSeq: 0, lastInSeq: -1, lastIn: 0, sentIn: '', lobby: null, lobbySent: '', snap: null, crackT: -9,
  mcache: new Map(), lastAbLen: 0, remoteInAt: 0, off: 0, rtt: 0, pings: [], pingT: 0, guestSpec: null,
  pid: 0, bb: null, ball: null, pclock: { pid: -1, t: 0 }, pred: { m: null, key: null, on: false, v: 0, lastIn: -9, hold: 0 },
  invited: null, pendingInvite: null,
};
const PEER_PREFIX = 'fullcount26-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const FAST_CHANNEL_ID = 77;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const isHost = () => NET.role === 'host' && NET.open && G.mode === 'online';
const isGuest = () => NET.role === 'guest' && G.mode === 'online';
// the host's performance.now(), as best the guest can tell
const hostNow = () => performance.now() + NET.off;

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
  const pending = NET.pendingInvite;
  netClose();
  NET.role = 'host'; NET.pendingInvite = pending;
  const code = Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  NET.code = code;
  netStatus('Opening a room…');
  const peer = (NET.peer = new Peer(PEER_PREFIX + code));
  peer.on('open', () => {
    if (NET.peer !== peer) return;
    NET.peerOpen = true;
    $('netCode').textContent = code; $('netLink').textContent = inviteLink(code);
    netStatus('Room open. Waiting for your friend to join…');
    renderMenu(); cloudRender(); netRoomOpened();
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
    if (NET.conn !== conn) return;
    NET.open = true; NET.lastInSeq = -1; NET.lastSeq = -1; NET.pings = []; NET.rtt = 0; NET.lobbySent = '';
    netFastOpen(conn);
    if (NET.role === 'host') { netStatus('Your friend is here! Pick your team and press Start.', 'good'); netSendLobby(); }
    else { conn.send({ t: 'hello' }); netStatus('Connected! Pick your team. The host starts the game.', 'good'); }
    renderMenu(); cloudRender();
  });
  conn.on('data', netOnMsg);
  conn.on('close', netLost);
  conn.on('error', netLost);
}
// A second channel for snapshots and inputs: unordered with no retransmits, so it
// behaves like UDP. Both sides create it with the same id (no renegotiation needed).
// Until a message arrives on it, everything still goes over the reliable channel.
function netFastOpen(conn) {
  NET.fast = null; NET.fastOK = false;
  try {
    const dc = conn.peerConnection.createDataChannel('fc-fast', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
    dc.onmessage = (e) => {
      if (NET.fast !== dc) return;
      NET.fastOK = true;
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      netOnMsg(m);
    };
    NET.fast = dc;
  } catch (e) { NET.fast = null; }
}
function netLost() {
  if (!NET.open) return;
  NET.open = false; NET.conn = null; NET.fast = null; NET.fastOK = false;
  if (G.mode === 'online') {
    G.paused = false; $('pause').classList.add('hidden');
    hudBanner('DISCONNECTED', 'Your opponent left the game', '');
    setTimeout(() => { if (G.mode === 'online') toMenu(); }, 3500);
  }
  netStatus('The connection closed. Host or join again to play.', 'bad');
  renderMenu(); cloudRender();
}
function netClose() {
  const { conn, peer, fast } = NET;
  Object.assign(NET, { role: null, peer: null, conn: null, fast: null, fastOK: false, open: false, peerOpen: false, code: null, lobby: null, lobbySent: '', blockShown: '', snap: null, guestSpec: null, bb: null, ball: null, invited: null, pendingInvite: null });
  try { if (fast) fast.close(); } catch (e) { /* ignore */ }
  try { if (conn) conn.close(); } catch (e) { /* ignore */ }
  try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
}
function netSend(m) { if (NET.open && NET.conn) try { NET.conn.send(m); } catch (e) { /* channel closing */ } }
// latest-wins traffic (snapshots, stick input, pings): the fast channel when it works
function netSendFast(m) {
  const dc = NET.fast;
  if (NET.fastOK && dc && dc.readyState === 'open' && dc.bufferedAmount < 65536) { try { dc.send(JSON.stringify(m)); return; } catch (e) { /* fall back */ } }
  netSend(m);
}
// ---------------------------------------------------------------- lobby ----
// Each player picks his own team (built-in or one of his custom rosters).
// Custom rosters travel as data, so your friend doesn't need them saved.
function netSendLobby() {
  if (NET.role !== 'host' || !NET.open) return;
  const m = { t: 'lobby', side: menu.side, innings: menu.innings, diff: menu.diff, ump: menu.ump, hostSpec: teamSpec(menuTeam(menu.side ? 'home' : 'away')) };
  const s = JSON.stringify(m);
  if (s !== NET.lobbySent) { NET.lobbySent = s; netSend(m); }
}
function netSendPick() { if (NET.role === 'guest' && NET.open) netSend({ t: 'pick', spec: teamSpec(menuTeam('netTeam')) }); }
function specOK(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.c) { const c = cleanRoster(s.c); return c ? { c } : null; }
  return TEAMS.some((t) => t.key === s.b) ? { b: s.b } : null;
}
function hostStartOnline() {
  if (!(NET.role === 'host' && NET.open) || onlineBlock()) return;
  const P = onlinePicks();
  const cfg = { mode: 'online', teams: distinctSpecs(teamSpec(P.teams[0]), teamSpec(P.teams[1])), side: menu.side, innings: menu.innings, diff: menu.diff, manual: 1, ump: menu.ump };
  netSend({ t: 'start', cfg });
  startGame(cfg);
}

// ------------------------------------------------------------- messages ----
function netOnMsg(m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hi') return;
  if (m.t === 'ping') { netSendFast({ t: 'pong', c: m.c, h: performance.now() }); return; }
  if (m.t === 'pong') { netPong(m); return; }
  if (NET.role === 'host') hostOnMsg(m); else guestOnMsg(m);
}
// round trip time, and (for the guest) the offset from our clock to the host's
function netPong(m) {
  const now = performance.now(), rtt = now - m.c;
  if (!(rtt >= 0 && rtt < 5000) || !Number.isFinite(+m.h)) return;
  NET.pings.push({ rtt, off: +m.h + rtt / 2 - now });
  if (NET.pings.length > 12) NET.pings.shift();
  NET.off = NET.pings.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;   // the fastest exchange is the most trustworthy
  NET.rtt = NET.rtt ? NET.rtt * 0.8 + rtt * 0.2 : rtt;
}
function hostOnMsg(m) {
  if (m.t === 'hello') { NET.lobbySent = ''; netSendLobby(); return; }
  if (m.t === 'pick') { NET.guestSpec = specOK(m.spec); renderMenu(); return; }
  if (m.t === 'in') {
    if (typeof m.q === 'number') { if (m.q <= NET.lastInSeq) return; NET.lastInSeq = m.q; }
    G.remoteIn.x = clamp(+m.x || 0, -1, 1); G.remoteIn.z = clamp(+m.z || 0, -1, 1); NET.remoteInAt = performance.now();
    G.remotePos = typeof m.k === 'string' && Number.isFinite(+m.px) && Number.isFinite(+m.pz)
      ? { key: m.k, x: +m.px, z: +m.pz, ry: +m.ry || 0, v: clamp(+m.v || 0, 0, 40), at: performance.now() } : null;
    return;
  }
  if (m.t !== 'act' || G.mode !== 'online') return;
  const pl = G.play;
  switch (m.a) {
    case 'swing': remoteSwing(m); break;
    case 'take': if (G.phase === 'pitch' && batCtrl() === 'remote') G.remoteTake = true; break;
    case 'pitch': remotePitch(m); break;
    case 'throw': if (pl && fieldCtrl() === 'remote') pl.userThrow(clamp(m.base | 0, 1, 4)); break;
    case 'dive': if (pl && fieldCtrl() === 'remote') pl.userDive(); break;
    case 'switch': if (pl && fieldCtrl() === 'remote') pl.userSwitch(); break;
    case 'run': if (runCtrl() === 'remote') { const kind = m.kind === 'go' ? 'go' : 'back', which = typeof m.which === 'string' ? m.which : null; if (pl) pl.runCmd(kind, which); else stealCmd(kind, which); } break;
    case 'pick': if (pitchCtrl() === 'remote') startPickoff(clamp(m.base | 0, 1, 3)); break;
    case 'skip': skip(true); break;
    case 'trot': if (pl && (pl.hr || pl.awarded) && pl.t > 2) pl.skipTrot(); break;
    case 'pause': togglePause(!!m.v, true); break;
    case 'pen': { const s = 1 - localSide(); if (s === 1 - G.half && G.phase === 'prePitch' && bringReliever(s)) enterPrePitch(); break; }
    case 'again': if (G.phase === 'final') hostRestart(); break;
    case 'challenge': if (G.challengeable && G.challengeable.who === 'remote') startChallenge(G.challengeable.side); break;
  }
}
function hostRestart() { netSend({ t: 'start', cfg: G.cfg }); showScreen(null); startGame(G.cfg); }
const NET_SOUNDS = new Set(['crack', 'pop', 'thud', 'roar', 'charge', 'stretch', 'fanfare', 'say']);
function guestOnMsg(m) {
  switch (m.t) {
    case 'lobby': { const first = !NET.lobby; NET.lobby = { ...m, hostSpec: specOK(m.hostSpec) }; if (first) netSendPick(); renderMenu(); break; }
    case 'full': netStatus('That game already has two players.', 'bad'); netClose(); renderMenu(); break;
    case 'start': if (m.cfg && typeof m.cfg === 'object') { showScreen(null); startGame({ ...m.cfg, teams: (m.cfg.teams || []).map((s) => specOK(s) || { b: TEAMS[0].key }), guest: true }); } break;
    case 'gs': if (G.mode === 'online') netApplyGS(m); break;
    case 's': if (G.mode === 'online') netApplySnap(m); break;
    case 'pitch': if (G.mode === 'online') guestPitch(m); break;
    case 'bb': if (G.mode === 'online') guestBB(m); break;
    case 'ev': if (G.mode === 'online') guestEv(m.f, Array.isArray(m.a) ? m.a : []); break;
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
  for (const k of NET_SOUNDS) { const o = SND[k].bind(SND); SND[k] = (...a) => { o(...a); netEv('snd', [k, ...a]); }; }
  { const o = hudScore; hudScore = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = hudCount; hudCount = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = hudBatter; hudBatter = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = hudPitcher; hudPitcher = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = drawTracker; drawTracker = (...a) => { o(...a); NET.dirty = true; }; }
  { const o = drawBoards; drawBoards = (...a) => { o(...a); NET.dirty = true; }; }
  // break and final cards: send the words, the guest builds the cards itself (never raw HTML)
  { const o = showScreen; showScreen = (id) => { o(id); if (isHost()) { netSend(netGS()); NET.dirty = false; netSend({ t: 'screen', id, d: screenData(id) }); } }; }
}
function screenData(id) {
  if (id === 'breakCard') return { title: $('breakTitle').textContent, sub: $('breakSub').textContent };
  if (id === 'final') return { title: $('finalTitle').textContent, sub: $('finalSub').textContent, potg: G.potg || null };
  return null;
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
    m.push([md.key, r2(p.x), r2(p.y), r2(p.z), r3(md.root.rotation.y), md.anim, r3(G.now - md.t0), prm, md.fielding ? 1 : 0, md.j.helmet.visible ? 1 : 0, md.batsL ? 1 : 0]);
  }
  const b = ballMesh.position, pl = G.play, remoteField = fieldCtrl() === 'remote';
  const s = { t: 's', q: ++NET.seq, ts: r2(performance.now()), ph: G.phase, dur: G.dur, b: [r2(b.x), r2(b.y), r2(b.z), ballMesh.visible ? 1 : 0], m, f: G.camFocus ? G.camFocus.map(r2) : null };
  if (pl && G.phase === 'live') {
    const B = pl.ball, th = B.thr;
    s.pl = {
      pid: NET.pid, pt: r3(pl.t), prompt: pl.prompt && pl.userDef && remoteField ? 1 : 0, uf: remoteField && pl.uf ? pl.uf.m.key : null,
      land: remoteField ? pl.landingSpot() : null, hr: pl.hr || pl.awarded ? 1 : 0,
      // where the ball is, as something the guest can compute for itself every frame
      bm: B.mode === 'flight' ? 'f' : B.mode === 'held' && B.holder ? ['h', B.holder.m.key]
        : B.mode === 'throw' && th ? ['t', th.from.toArray().map(r2), th.to.toArray().map(r2), r3(th.t0), r3(th.T), r2(th.arc)] : null,
    };
  }
  // the guest's runners, during a play or before the pitch (for steals)
  const ri = runCtrl() !== 'remote' ? null : pl && G.phase === 'live' ? pl.runnerInfo() : STEAL_PHASES.includes(G.phase) ? stealInfo() : null;
  s.run = ri ? ri.map((r) => [r.id, r.key, r.to, r.from, r.run ? 1 : 0, r.rev ? 1 : 0, r.user ? 1 : 0, r.m.key, r.steal ? 1 : 0]) : null;
  return s;
}
function netPitchOut() {
  if (!isHost()) return;
  const P = G.P;
  netSend({ t: 'pitch', rel: [P.rel.x, P.rel.y, P.rel.z], v0: [P.v0.x, P.v0.y, P.v0.z], a: [P.a.x, P.a.y, P.a.z], T: P.T, mph: P.mph, type: P.type, tc: G.tc, tPlate: G.tPlate, tCatch: G.tCatch, cross: G.cross, isStrike: G.isStrike });
}
// a ball was put in play: the guest runs the same flight model, so only the launch travels
// a steal or pickoff started: a new play id so the guest restarts its play clock
function netPlayOut() { if (isHost()) NET.pid++; }
function netBBOut(origin, ev, la, spray) {
  if (!isHost()) return;
  NET.pid++;
  netSend({ t: 'bb', pid: NET.pid, o: [origin.x, origin.y, origin.z], ev, la, spray });
}
function netTick() {
  if (!NET.open) return;
  const now = performance.now();
  // say hi on the fast channel until the other side hears us
  if (NET.fast && !NET.fastOK && NET.fast.readyState === 'open' && now - NET.hiT > 250) { NET.hiT = now; try { NET.fast.send('{"t":"hi"}'); } catch (e) { /* not ready */ } }
  if (now - NET.pingT > (NET.pings.length < 6 ? 250 : 2000)) { NET.pingT = now; netSendFast({ t: 'ping', c: now }); }
  pingHUD();
  if (!isHost()) return;
  if (NET.dirty) { NET.dirty = false; netSend(netGS()); }
  const busy = G.phase === 'live' || G.phase === 'pitch' || G.phase === 'windup' || G.phase === 'postPlay';
  if (now - NET.lastSnap >= (busy ? 14 : 50)) { NET.lastSnap = now; netSendFast(netSnapshot()); }
  if (now - NET.remoteInAt > 500) { G.remoteIn.x = 0; G.remoteIn.z = 0; G.remotePos = null; }
}
function pingHUD() {
  const el = $('netPing'), show = G.mode === 'online' && NET.open && NET.rtt > 0;
  el.classList.toggle('hidden', !show);
  if (!show || performance.now() - (pingHUD.t || 0) < 1000) return;
  pingHUD.t = performance.now();
  const ms = Math.round(NET.rtt);
  el.textContent = `${ms} ms`;
  el.className = ms < 80 ? 'good' : ms < 160 ? 'ok' : 'bad';
  el.title = `Round trip to your opponent${NET.fastOK ? '' : ' (fast channel not available, using the reliable one)'}`;
}

// ------------------------------------------------------------ guest side ----
function guestStart() {
  setPhase('wait');
  G.fielders = []; G.fByRole = {}; G.swing = null; G.P = null; G.localPitch = false; G.lastP = null; G.batter = null;
  Object.assign(NET, { lastAbLen: 0, snap: null, lastSeq: -1, bb: null, ball: null, pclock: { pid: -1, t: 0 } });
  NET.pred = { m: null, key: null, on: false, v: 0, lastIn: -9, hold: 0 };
  NET.mcache.clear();
  for (const m of MODELS) { m.root.visible = false; m.net = null; }
  wideCam(true);
  setHint('Joining the game&hellip;');
  drawBoards();
}
function modelByKey(key) {
  if (typeof key !== 'string') return null;
  if (/^U\d$/.test(key)) return G.umps[+key[1]] || null;
  if (NET.mcache.has(key)) return NET.mcache.get(key);
  const [id, , kind] = key.split('|');
  const pl = PBYID[id]; if (!pl || !G.teams || !G.teams.includes(pl.team)) return null;
  const m = getModel(pl, kind === 'catcher' ? 'catcher' : undefined);
  NET.mcache.set(key, m);
  return m;
}
function netPrm(m, prm) {
  if (prm && Array.isArray(prm.glove)) { m.gv = m.gv || new V3(); m.gv.set(+prm.glove[0] || 0, +prm.glove[1] || 0, +prm.glove[2] || 0); return { glove: m.gv }; }
  return prm && typeof prm === 'object' ? prm : null;
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
  if (typeof s.q === 'number') { if (s.q <= NET.lastSeq) return; NET.lastSeq = s.q; }   // late and out of order: a newer one already arrived
  const ts = +s.ts || hostNow(), age = clamp((hostNow() - ts) / 1000, 0, 0.25);
  NET.snap = s;
  if (s.ph !== G.phase) guestPhase(s.ph);
  G.dur = s.dur; G.camFocus = s.f;
  const seen = new Set(), P = NET.pred;
  const freezeBatter = !!G.swing && (G.localPitch || G.phase === 'pitch' || G.phase === 'windup');
  for (const e of s.m) {
    const m = modelByKey(e[0]); if (!m) continue;
    seen.add(m);
    let n = m.net;
    if (!n || !m.root.visible) n = m.net = { x: e[1], y: e[2], z: e[3], vx: 0, vz: 0, ry: e[4], ts, snap: true };
    else {
      const dts = (ts - n.ts) / 1000, dx = e[1] - n.x, dz = e[3] - n.z;
      if (Math.hypot(dx, dz) > 14) { n.vx = 0; n.vz = 0; n.snap = true; }   // teleported: new batter, new pitch
      else if (dts > 0.004 && dts < 0.3) {
        let vx = dx / dts, vz = dz / dts; const sp = Math.hypot(vx, vz);
        if (sp > 40) { vx *= 40 / sp; vz *= 40 / sp; }
        n.vx = lerp(n.vx, vx, 0.6); n.vz = lerp(n.vz, vz, 0.6);
      }
      n.x = e[1]; n.y = e[2]; n.z = e[3]; n.ry = e[4]; n.ts = ts;
    }
    n.anim = e[5];
    m.root.visible = true;
    const mine = (freezeBatter && m === G.batterModel) || (P.on && m === P.m);
    if (!mine) {
      // animation clock: where the host's is now, not when this was sent
      const at = e[6] + age;
      if (m.anim !== e[5] || Math.abs(G.now - m.t0 - at) > 0.08) { if (m.anim !== e[5]) animBlend(m, e[5]); m.anim = e[5]; m.t0 = G.now - at; }
      m.prm = netPrm(m, e[7]);
    }
    m.fielding = !!e[8]; m.batsL = !!e[10];
    if (m.kind === 'player') setHelmet(m, !!e[9]);
  }
  for (const m of MODELS) if (m.root.visible && !seen.has(m)) { m.root.visible = false; m.net = null; }
  // the ball outside of live play: where the host had it, with a velocity to push it to "now"
  const b = s.b, nb = NET.ball;
  if (nb && Math.hypot(b[0] - nb.x, b[1] - nb.y, b[2] - nb.z) < 20 && ts > nb.ts) {
    const dts = Math.max(0.005, (ts - nb.ts) / 1000);
    NET.ball = { x: b[0], y: b[1], z: b[2], vx: (b[0] - nb.x) / dts, vy: (b[1] - nb.y) / dts, vz: (b[2] - nb.z) / dts, ts, vis: !!b[3] };
  } else NET.ball = { x: b[0], y: b[1], z: b[2], vx: 0, vy: 0, vz: 0, ts, vis: !!b[3] };
  // the play clock: the host's time into the current play
  if (s.pl) {
    const est = s.pl.pt + age, C = NET.pclock;
    if (C.pid !== s.pl.pid || Math.abs(C.t - est) > 0.25) { C.pid = s.pl.pid; C.t = est; } else C.t += (est - C.t) * 0.15;
  }
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
      G.contactT = G.now; G.bb = NET.bb ? NET.bb.bb : { hr: false, la: 20 };
      setHint(liveHint());
      break;
    case 'postPitch': case 'postFoul': G.recOn = false; break;
    case 'postPlay': G.recOn = false; setHint(''); $('throwPrompt').classList.add('hidden'); runnerHUD(false); ctrlRing.visible = false; landMark.visible = false; break;
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
function guestBB(m) {
  if (!Array.isArray(m.o) || m.o.length !== 3) return;
  const ev = clamp(+m.ev || 0, 0, 130), la = clamp(+m.la || 0, -90, 90), sp = clamp(+m.spray || 0, -360, 360);
  NET.bb = { pid: m.pid, bb: simBatted(new V3(+m.o[0] || 0, +m.o[1] || 0, +m.o[2] || 0), ev, la, sp) };
  G.bb = NET.bb.bb;
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
    case 'snd': { const [k, ...r] = a; if (k === 'crack' && G.now - NET.crackT < 1.5) return; if (NET_SOUNDS.has(k)) SND[k](...r); break; }
    case 'showFeedback': showFeedback(...a); break;
    case 'fbstats': updateFeedbackStats(...a); break;
    case 'pinfo': if (a[0] && PITCH_TYPES[a[0].type]) hudPitchInfo(...a); break;
    case 'absShow': absShow(...a); break;
    case 'absReveal': absReveal(...a); break;
  }
}
function guestScreen(m) {
  const d = m.d || {};
  if (m.id === 'breakCard') { $('breakTitle').textContent = String(d.title || ''); $('breakSub').textContent = String(d.sub || ''); $('breakLS').innerHTML = linescoreHTML(); }
  if (m.id === 'final') {
    setPhase('final');
    $('finalTitle').textContent = String(d.title || 'FINAL'); $('finalSub').textContent = String(d.sub || '');
    $('finalLS').innerHTML = linescoreHTML(); $('potg').innerHTML = d.potg ? potgHTML(d.potg) : '';
  }
  if ([null, 'breakCard', 'final'].includes(m.id)) showScreen(m.id);
}
// the fielder you steer moves on your screen right away (the same running model the
// host uses); the host takes this position for him
const fieldRole = (pl) => (pl.pos === 'SP' || pl.pos === 'RP' ? 'P' : pl.pos);
function guestPredict(dt) {
  const P = NET.pred, pl = NET.snap && NET.snap.pl;
  const key = G.phase === 'live' && pl && pl.uf && userFields() && !pl.hr && !trotOn() ? pl.uf : null;
  const m = key ? modelByKey(key) : null;
  if (m !== P.m) Object.assign(P, { m, key, on: false, v: 0 });
  if (!m || !m.net) return null;
  const v = fieldVec(), mag = Math.min(1, Math.hypot(v.x, v.z));
  if (m.net.anim === 'dive' || m.net.anim === 'throw' || G.now < P.hold) { P.on = false; return null; }
  if (mag > 0.15) { P.on = true; P.lastIn = G.now; } else if (P.on && G.now - P.lastIn > 0.6) P.on = false;
  if (!P.on) return null;
  const who = m.pl, role = fieldRole(who), isOF = role === 'LF' || role === 'CF' || role === 'RF';
  const speed = 20 + (who.spd ?? 50) * 0.08, acc = (isOF ? 12.5 : role === 'P' || role === 'C' ? 15 : 21) * 1.5;
  const p = m.root.position;
  if (mag > 0.15) {
    const dx = v.x / mag, dz = v.z / mag;
    P.v = Math.min(speed * mag, P.v + acc * dt);
    const nx = p.x + dx * P.v * dt, nz = p.z + dz * P.v * dt;
    if (inPoly(nx, nz) || Math.hypot(nx, nz) < Math.hypot(p.x, p.z)) { p.x = nx; p.z = nz; } else P.v *= 0.5;
    m.root.rotation.y += angDiff(m.root.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 14);
    m.phase += P.v * dt * 0.42;
    setAnim(m, P.v > 9 ? 'run' : 'jog');
  } else { P.v = Math.max(0, P.v - 45 * dt); setAnim(m, 'ready'); }
  p.y = groundY(p.x, p.z);
  return m;
}
// ball on the guest: computed here every frame whenever we can, so it never stutters
function guestBall() {
  if (G.localPitch) return;
  const s = NET.snap; if (!s) return;
  const pl = G.phase === 'live' ? s.pl : null, t = NET.pclock.t;
  if (pl && pl.bm) {
    const bm = pl.bm;
    if (bm === 'f' && NET.bb && NET.bb.pid === pl.pid) {
      const S = NET.bb.bb.S, k = S[clamp(Math.floor(t / BB_DT), 0, S.length - 1)];
      ballMesh.position.set(k.x, k.y, k.z); ballMesh.visible = true; return;
    }
    if (bm[0] === 'h') { const hm = modelByKey(bm[1]); if (hm && hm.root.visible) { handWorld(hm, hm.lefty ? 'R' : 'L', ballMesh.position); ballMesh.visible = true; return; } }
    if (bm[0] === 't' && Array.isArray(bm[1]) && Array.isArray(bm[2])) {
      const [, f, to, t0, T, arc] = bm, u = clamp((t - t0) / Math.max(0.05, T), 0, 1);
      ballMesh.position.set(lerp(f[0], to[0], u), lerp(f[1], to[1], u) + Math.sin(u * Math.PI) * arc, lerp(f[2], to[2], u));
      ballMesh.visible = true; return;
    }
  }
  const nb = NET.ball; if (!nb) return;
  const age = clamp((hostNow() - nb.ts) / 1000, 0, 0.1);
  ballMesh.position.set(nb.x + nb.vx * age, nb.y + nb.vy * age, nb.z + nb.vz * age); ballMesh.visible = nb.vis;
}
function guestUpdate(dt) {
  G.now += dt; G.pt += dt; NET.pclock.t += dt;
  if (G.replay) { updateReplay(dt); return; }
  aimUpdate(dt);
  if (G.phase === 'prePitch' && userPitches() && G.pitchUI.state !== 'done') updatePitchUI();
  if (G.localPitch && G.P) guestPitchTick();
  const pm = guestPredict(dt), hn = hostNow(), kp = 1 - Math.exp(-dt * 25), kr = 1 - Math.exp(-dt * 20);
  for (const m of MODELS) {
    if (!m.root.visible || !m.net || m === pm) continue;
    const n = m.net, age = clamp((hn - n.ts) / 1000, 0, 0.12), p = m.root.position;
    const tx = n.x + n.vx * age, tz = n.z + n.vz * age, ox = p.x, oz = p.z;
    if (n.snap) { p.set(tx, n.y, tz); m.root.rotation.y = n.ry; n.snap = false; continue; }
    p.x += (tx - ox) * kp; p.z += (tz - oz) * kp; p.y = n.y;
    m.root.rotation.y += angDiff(m.root.rotation.y, n.ry) * kr;
    m.phase += Math.hypot(p.x - ox, p.z - oz) * 0.42;   // legs cycle with how far he moved on screen
  }
  if (G.phase === 'live' || G.phase === 'postPlay') playCam();
  else if (G.phase === 'final') menuCam(dt * 0.6);
  if (G.phase === 'live' && userFields()) {
    const v = fieldVec(), now = performance.now(), msg = { t: 'in', q: ++NET.inSeq, x: r3(v.x), z: r3(v.z) };
    if (pm) Object.assign(msg, { k: NET.pred.key, px: r2(pm.root.position.x), pz: r2(pm.root.position.z), ry: r3(pm.root.rotation.y), v: r2(NET.pred.v) });
    const key = msg.x + ',' + msg.z + (pm ? ',' + msg.px + ',' + msg.pz : '');
    if ((pm && now - NET.lastIn > 14) || (key !== NET.sentIn && now - NET.lastIn > 30) || now - NET.lastIn > 250) { NET.sentIn = key; NET.lastIn = now; netSendFast(msg); }
    else NET.inSeq--;
  }
  const pl = G.phase === 'live' && NET.snap ? NET.snap.pl : null;
  const ufm = pl && pl.uf ? modelByKey(pl.uf) : null;
  ctrlRing.visible = !!ufm;
  if (ufm) ctrlRing.position.set(ufm.root.position.x, groundY(ufm.root.position.x, ufm.root.position.z) + 0.12, ufm.root.position.z);
  landMark.visible = !!(pl && pl.land && landingAssist());
  if (landMark.visible) landMark.position.set(pl.land[0], 0.1, pl.land[1]);
  $('throwPrompt').classList.toggle('hidden', !(pl && pl.prompt));
  runnerHUD(userRuns() && ((!!pl && !pl.hr) || (STEAL_PHASES.includes(G.phase) && !!(NET.snap && NET.snap.run && NET.snap.run.length))));
  pickoffHUD();
  for (const m of MODELS) updateModel(m, G.now);
  guestBall();
  dressFrame();
  if (G.recOn) recFrame();
}
