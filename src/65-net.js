// ============================================================================
// Online over WebRTC (PeerJS): a 1v1, or a squad of up to ten people who each play
// one player (64-squad.js). The host runs the whole simulation and every guest
// renders it. What keeps a guest's side feeling local:
//  - snapshots go 60 times a second over a second, unreliable and unordered
//    data channel, so a lost packet never holds up the ones behind it
//  - the guest syncs its clock to the host's and pushes every player forward
//    to "now" instead of drawing where he was half a round trip ago
//  - the batted ball and throws are simulated on the guest from their launch
//    numbers, so the ball flies smoothly at full frame rate
//  - the fielder the guest steers moves on the guest's screen right away; the
//    host takes the guest's position for him
//  - swings and pitches are timed on the guest's own clock, so lag never costs a hitter
// A dropped connection isn't the end: the guest reconnects on its own (proving it's the
// same player with its game token). In a 1v1 the host pauses and waits; in a squad the
// CPU plays his man until he's back. Up to six spectators can join a room with its code
// and watch everything live. The host keeps one link per guest (NET.links).
// ============================================================================

const NET = {
  role: null, peer: null, conn: null, fast: null, fastOK: false, hiT: 0, code: null, open: false, peerOpen: false, dirty: false,
  lastSnap: 0, seq: 0, lastSeq: -1, inSeq: 0, lastInSeq: -1, lastIn: 0, sentIn: '', lobby: null, lobbySent: '', snap: null, crackT: -9,
  mcache: new Map(), lastAbLen: 0, remoteInAt: 0, off: 0, rtt: 0, pings: [], pingT: 0, guestSpec: null,
  pid: 0, bb: null, ball: null, pclock: { pid: -1, t: 0 }, pred: { m: null, key: null, on: false, v: 0, lastIn: -9, hold: 0 },
  invited: null, pendingInvite: null,
  specs: [], specSnapT: 0, tok: null, waiting: 0, waitHint: 0, pausedForDrop: false, rejoin: null, bye: false, opp: null,
  // host: one link per friend in the room { conn, fast, fastOK, hiT, sid, opp, name, tok, q, inp, pos, inAt, pings, rtt, gone, bye, chatT }
  links: [],
  // who's in the room, kept by the host and sent to everyone: [{ sid, name, side, pick, peer, voice, on }]
  room: [], sid: 0, lastPl: null,
};
const SPEC_MSGS = new Set(['start', 'gs', 'ev', 'screen', 'pitch', 'bb', 'pause', 'bye', 'chat']);
const PEER_PREFIX = 'fullcount26-';
// how two devices find a way to each other: several public STUN servers, and PeerJS's TURN
// relays for networks that won't allow a direct connection
const PEER_OPTS = { config: { iceServers: [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
], sdpSemantics: 'unified-plan' } };
const VERSION_MSG = 'You and your friend have different versions of the game. Both of you refresh the page (Ctrl+F5 on a computer; close and reopen it on a phone), then try again.';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const FAST_CHANNEL_ID = 77;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const isHost = () => NET.role === 'host' && G.mode === 'online';
const isGuest = () => (NET.role === 'guest' || NET.role === 'spec') && G.mode === 'online';   // a spectator renders like a guest
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
  const peer = (NET.peer = new Peer(PEER_PREFIX + code, PEER_OPTS));
  NET.room = [{ sid: 0, name: myName(), side: menu.side ? 1 : 0, pick: '', peer: PEER_PREFIX + code, voice: VOICE.on, on: true }];
  peerHooks(peer);
  peer.on('open', () => {
    if (NET.peer !== peer) return;
    NET.peerOpen = true;
    $('netCode').textContent = code; $('netLink').textContent = inviteLink(code);
    netStatus('Room open. Waiting for your friend to join…');
    renderMenu(); cloudRender(); netRoomOpened();
  });
  peer.on('connection', hostIncoming);
  peer.on('error', (e) => { if (e.type === 'unavailable-id' && NET.peer === peer) { netHost(); return; } netStatus(netErrText(e), 'bad'); });
  renderMenu();
}
// every Peer we make: back to the matchmaking server after a blip, and voice calls from the room
function peerHooks(peer) {
  peer.on('disconnected', () => { if (NET.peer === peer && !peer.destroyed) try { peer.reconnect(); } catch (err) { /* already gone */ } });
  peer.on('call', (call) => { if (NET.peer === peer) voiceIncoming(call); else try { call.close(); } catch (e) { /* gone */ } });
}
// watch: join a room as a spectator
function netJoin(raw, watch = false) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) { netStatus('Room codes are 5 characters long.', 'bad'); return; }
  if (!netReady()) { netStatus('Online play did not load. Check your internet connection and refresh the page.', 'bad'); return; }
  netClose();
  NET.role = watch ? 'spec' : 'guest'; NET.code = code;
  netStatus(watch ? `Joining room ${code} to watch…` : `Joining room ${code}…`);
  const peer = (NET.peer = new Peer(PEER_OPTS));
  peerHooks(peer);
  peer.on('open', () => {
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    netBind(conn);
    setTimeout(() => {
      if (NET.peer !== peer || NET.open) return;
      // found the room but couldn't open a line to it: the network is in the way
      const ice = conn.peerConnection && conn.peerConnection.iceConnectionState;
      netStatus(ice === 'failed' || ice === 'disconnected' || ice === 'checking'
        ? 'Found the room, but your two devices could not connect. Some school, work and mobile networks block it: try both on the same Wi-Fi, or another network.'
        : 'Could not reach that room. Check the code, and make sure your friend is still on the host screen.', 'bad');
    }, 15000);
  });
  peer.on('error', (e) => { if (NET.peer === peer) netStatus(netErrText(e), 'bad'); });
  renderMenu();
}
// who you are, for the head-to-head record (only when you're signed in)
function meId() { return typeof Cloud !== 'undefined' && Cloud.profile ? { uid: Cloud.profile.uid, name: Cloud.profile.name } : null; }
// your name in the room and in chat: the one you typed, or your account's
// (raw: '' when you haven't got one, so the host can number you)
function myName(raw = false) { const n = settings.netName || (typeof Cloud !== 'undefined' && Cloud.profile ? Cloud.profile.name : ''); return raw ? cleanName(n, '') : cleanName(n, NET.role === 'host' ? 'Host' : 'Player'); }
function cleanOpp(x) { return x && typeof x.uid === 'string' && x.uid && x.uid.length <= 128 ? { uid: x.uid, name: String(x.name || 'Player').slice(0, 40) } : null; }
// the guest (or a spectator) connecting to the host
function netBind(conn) {
  NET.conn = conn;
  conn.on('open', () => {
    if (NET.conn !== conn) return;
    netAttach(conn);
    conn.send({ t: 'hello', ver: BUILD_ID, me: meId(), name: myName(true), vc: VOICE.on ? 1 : 0, tok: NET.tok || undefined, spec: NET.role === 'spec' ? 1 : undefined });
    if (NET.rejoin) { NET.rejoin = null; setHint(''); hudBanner('RECONNECTED', 'Back to the game', ''); }
    else netStatus(NET.role === 'spec' ? 'Connected. You\'ll see the game as soon as it starts.' : 'Connected! Pick your team. The host starts the game.', 'good');
    renderMenu(); cloudRender();
  });
  conn.on('data', netOnMsg);
  conn.on('close', () => { if (NET.conn === conn) netLost(); });
  conn.on('error', () => { if (NET.conn === conn) netLost(); });
}
function netAttach(conn) {
  NET.conn = conn; NET.open = true; NET.bye = false;
  NET.lastInSeq = -1; NET.lastSeq = -1; NET.pings = []; NET.rtt = 0; NET.lobbySent = '';
  if (NET.role !== 'spec') netFastOpen(conn, NET);
}
// Someone connected to our room. Their first message says who: a friend joining the room,
// a friend coming back after a dropped connection (with his game token), or a spectator.
function hostIncoming(conn) {
  let role = null, L = null;
  const drop = () => setTimeout(() => { try { conn.close(); } catch (e) { /* gone */ } }, 400);
  conn.on('open', () => setTimeout(() => { if (!role) try { conn.close(); } catch (e) { /* gone */ } }, 20000));
  conn.on('data', (m) => {
    if (!m || typeof m !== 'object') return;
    if (role === 'guest') { if (L && L.conn === conn) netOnMsg(m, L); return; }
    if (role === 'spec') {
      if (m.t === 'ping') try { conn.send({ t: 'pong', c: m.c, h: performance.now() }); } catch (e) { /* closing */ }
      else if (m.t === 'chat') chatIn(m, null, conn);
      return;
    }
    if (m.t !== 'hello' || NET.role !== 'host') return;
    if (m.ver !== BUILD_ID) { role = 'old'; conn.send({ t: 'ver' }); drop(); netStatus(VERSION_MSG, 'bad'); return; }
    if (m.spec) {
      if (NET.specs.length >= 6) { conn.send({ t: 'full', spec: 1 }); drop(); return; }
      role = 'spec'; NET.specs.push(conn); NET.dirty = true;
      conn.fcName = cleanName(m.name, 'Spectator'); conn.fcChat = [];
      conn.on('close', () => { NET.specs = NET.specs.filter((c) => c !== conn); NET.dirty = true; });
      if (G.mode === 'online') { conn.send({ t: 'start', cfg: { ...G.cfg, tok: undefined, me: -1 } }); conn.send(netGS()); }
      return;
    }
    const squad = G.mode === 'online' ? !!G.squad : menu.netMode === 1;
    // back after a dropped connection: his token says it's him
    const back = G.mode === 'online' && typeof m.tok === 'string' && m.tok ? NET.links.find((x) => x.gone && x.tok === m.tok) : null;
    const lobby = G.mode !== 'online' && (squad ? NET.links.length < SQUAD_MAX - 1 : !NET.links.length);
    if (!back && !lobby) { conn.send({ t: 'full', squad: squad ? 1 : 0, started: G.mode === 'online' ? 1 : 0 }); drop(); return; }
    role = 'guest';
    if (back) { L = back; L.conn = conn; linkOpen(L); const r = NET.room.find((x) => x.sid === L.sid); if (r) r.voice = !!m.vc; hostRejoined(L); return; }
    L = { conn, fast: null, fastOK: false, hiT: 0, sid: freeSid(), opp: cleanOpp(m.me), name: '', tok: null, q: -1, inp: { x: 0, z: 0 }, pos: null, inAt: 0, pings: [], rtt: 0, gone: 0, bye: false, chatT: [] };
    L.name = cleanName(m.name, `Player ${L.sid + 1}`);
    NET.links.push(L); linkOpen(L);
    NET.room.push({ sid: L.sid, name: L.name, side: menu.side ? 0 : 1, pick: '', peer: String(conn.peer || '').slice(0, 64), voice: !!m.vc, on: true });
    linkSend(L, { t: 'welcome', sid: L.sid });
    if (squad) netStatus(`${L.name} joined. ${NET.links.length + 1} in the room.`, 'good');
    else {
      NET.opp = L.opp;
      const rec = NET.opp ? h2hGet(NET.opp.uid) : null;
      netStatus(`${NET.opp ? NET.opp.name : L.name} is here!${rec ? ` You're ${rec.w}-${rec.l} against each other.` : ''} Pick your team and press Start.`, 'good');
    }
    chatSys(`${L.name} joined the room.`);
    NET.lobbySent = ''; netSendRoom(); cloudRender();
  });
  conn.on('close', () => { if (role === 'guest' && L && L.conn === conn) linkLost(L); });
  conn.on('error', () => { if (role === 'guest' && L && L.conn === conn) linkLost(L); });
}
// the lowest seat id nobody has (the host is 0)
function freeSid() { for (let i = 1; i < SQUAD_MAX; i++) if (!NET.links.some((L) => L.sid === i)) return i; return SQUAD_MAX; }
const linkBySid = (sid) => NET.links.find((L) => L.sid === sid && !L.gone) || null;
function linkOpen(L) {
  L.gone = 0; L.bye = false; L.q = -1; L.pings = []; L.rtt = 0; L.fast = null; L.fastOK = false;
  NET.open = true; NET.bye = false;
  netFastOpen(L.conn, L);
}
function linkSend(L, m) { if (L && L.conn && !L.gone) try { L.conn.send(m); } catch (e) { /* channel closing */ } }
function linkSendFast(L, m, str) {
  const dc = L.fast;
  if (L.fastOK && dc && dc.readyState === 'open' && dc.bufferedAmount < 65536) { try { dc.send(str || JSON.stringify(m)); return; } catch (e) { /* fall back */ } }
  linkSend(L, m);
}
// a friend is back: the game as it stands, and play on
function hostRejoined(L) {
  const r = NET.room.find((x) => x.sid === L.sid);
  if (r) { r.on = true; r.peer = String(L.conn.peer || '').slice(0, 64); }
  const seat = seatBySid(L.sid);
  if (seat) { seat.cpu = false; NET.dirty = true; }
  netSendStart(G.cfg, L);
  linkSend(L, netGS());
  netSendRoom();
  if (G.squad) { chatSys(`${L.name} is back.`); return; }
  NET.waiting = 0;
  hudBanner('RECONNECTED', 'Back to the game', '');
  setHint('');
  if (NET.pausedForDrop) { NET.pausedForDrop = false; G.paused = false; $('pause').classList.add('hidden'); netSend({ t: 'pause', v: false }); }
}
// the guest lost the host: keep trying for a minute
function netRejoinTick() {
  const R = NET.rejoin, now = Date.now();
  if (!R || NET.open) return;
  if (G.mode !== 'online') { NET.rejoin = null; return; }
  if (now > R.until) {
    NET.rejoin = null;
    hudBanner('DISCONNECTED', 'Could not get back to the game', ''); setHint('');
    setTimeout(() => { if (G.mode === 'online' && !NET.open) toMenu(); }, 3000);
    return;
  }
  if (now < R.next) return;
  R.next = now + 4000;
  try { if (NET.peer) NET.peer.destroy(); } catch (e) { /* gone */ }
  const peer = (NET.peer = new Peer(PEER_OPTS));
  peerHooks(peer);
  peer.on('open', () => { if (NET.peer === peer && !NET.open) netBind(peer.connect(PEER_PREFIX + NET.code, { reliable: true, serialization: 'json' })); });
  peer.on('error', () => { /* try again on the next tick */ });
}
// the host of a 1v1, waiting for a dropped opponent: a minute and a half, then it's over
function netWaitTick() {
  if (!NET.waiting || NET.role !== 'host') return;
  const left = Math.ceil(90 - (Date.now() - NET.waiting) / 1000);
  if (left <= 0) {
    NET.waiting = 0; G.paused = false; NET.pausedForDrop = false;
    NET.links = NET.links.filter((L) => !L.gone);
    hudBanner('DISCONNECTED', 'Your opponent did not come back', ''); setHint('');
    setTimeout(() => { if (G.mode === 'online' && !NET.open) toMenu(); }, 3000);
  } else if (left !== NET.waitHint) { NET.waitHint = left; setHint(`Your opponent lost their connection. Waiting for them to come back&hellip; ${left}s`); }
}
// A second channel for snapshots and inputs: unordered with no retransmits, so it
// behaves like UDP. Both sides create it with the same id (no renegotiation needed).
// Until a message arrives on it, everything still goes over the reliable channel.
// at: NET (the guest's line to the host) or the host's link to one guest
function netFastOpen(conn, at) {
  at.fast = null; at.fastOK = false;
  try {
    const dc = conn.peerConnection.createDataChannel('fc-fast', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
    dc.onmessage = (e) => {
      if (at.fast !== dc) return;
      at.fastOK = true;
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (at === NET) netOnMsg(m); else if (!at.gone) netOnMsg(m, at);
    };
    at.fast = dc;
  } catch (e) { at.fast = null; }
}
// the guest (or a spectator) lost the host
function netLost() {
  if (!NET.open) return;
  NET.open = false; NET.conn = null; NET.fast = null; NET.fastOK = false;
  voiceStop(true);
  // mid-game and nobody quit on purpose: go back to the host
  const mid = G.mode === 'online' && G.phase !== 'final' && !NET.bye;
  if (mid && (NET.role === 'spec' || (G.cfg && G.cfg.tok))) {
    NET.rejoin = { until: Date.now() + 60000, next: Date.now() + 1500 };
    hudBanner('CONNECTION LOST', 'Reconnecting…', '');
    setHint('Connection lost. Reconnecting to the host&hellip;');
    return;
  }
  if (G.mode === 'online') {
    G.paused = false; $('pause').classList.add('hidden');
    hudBanner('DISCONNECTED', G.squad ? 'The host left the game' : 'Your opponent left the game', '');
    setTimeout(() => { if (G.mode === 'online') toMenu(); }, 3500);
  }
  netStatus('The connection closed. Host or join again to play.', 'bad');
  NET.room = []; NET.lobby = null;
  renderMenu(); cloudRender();
}
// the host lost one guest
function linkLost(L) {
  if (L.gone || !NET.links.includes(L)) return;
  const fast = L.fast;
  L.conn = null; L.fast = null; L.fastOK = false; L.inp.x = 0; L.inp.z = 0; L.pos = null;
  try { if (fast) fast.close(); } catch (e) { /* gone */ }
  NET.open = NET.links.some((x) => x !== L && !x.gone);
  voiceDrop(L.sid);
  const mid = G.mode === 'online' && G.phase !== 'final' && !L.bye, r = NET.room.find((x) => x.sid === L.sid), seat = seatBySid(L.sid);
  if (mid) {
    // keep his spot: he can come back with his token
    L.gone = Date.now();
    if (r) r.on = false;
    if (G.squad) {
      if (seat) seat.cpu = true;
      NET.dirty = true; netSendRoom();
      chatSys(`${L.name} lost the connection. The CPU plays for them until they're back.`);
      return;
    }
    NET.waiting = Date.now(); NET.waitHint = 0; NET.pausedForDrop = !G.paused; G.paused = true;
    hudBanner('CONNECTION LOST', 'Waiting for your opponent to reconnect', '');
    netWaitTick();
    return;
  }
  // gone for good: he left the room, quit on purpose, or the game is over
  NET.links = NET.links.filter((x) => x !== L);
  NET.room = NET.room.filter((x) => x.sid !== L.sid);
  if (G.mode === 'online' && G.squad) {
    if (seat) seat.cpu = true;
    NET.dirty = true; netSendRoom();
    if (G.phase !== 'final') chatSys(`${L.name} left the game. The CPU plays for them.`);
    return;
  }
  chatSys(`${L.name} left.`);
  if (G.mode === 'online') {
    G.paused = false; $('pause').classList.add('hidden');
    hudBanner('DISCONNECTED', 'Your opponent left the game', '');
    setTimeout(() => { if (G.mode === 'online' && NET.role === 'host' && !NET.open) toMenu(); }, 3500);
  }
  if (!NET.links.some((x) => !x.gone)) { NET.guestSpec = null; NET.opp = null; }
  netStatus(NET.links.length ? `${L.name} left. ${NET.links.length + 1} in the room.` : `${L.name} left. Waiting for someone to join…`, NET.links.length ? 'good' : '');
  NET.lobbySent = ''; netSendRoom(); renderMenu(); cloudRender();
}
function netClose() {
  const { conn, peer, fast, specs, open, links } = NET;
  voiceStop(false); chatClear();
  // say goodbye first, so the other side knows it wasn't a dropped connection
  if (open && conn) try { conn.send({ t: 'bye' }); } catch (e) { /* closing */ }
  for (const L of links) linkSend(L, { t: 'bye' });
  for (const c of specs) try { c.send({ t: 'bye' }); } catch (e) { /* closing */ }
  Object.assign(NET, { role: null, peer: null, conn: null, fast: null, fastOK: false, open: false, peerOpen: false, code: null, lobby: null, lobbySent: '', blockShown: '', snap: null, guestSpec: null, bb: null, ball: null, invited: null, pendingInvite: null, specs: [], tok: null, waiting: 0, rejoin: null, bye: false, opp: null, pausedForDrop: false, links: [], room: [], sid: 0, lastPl: null });
  setTimeout(() => {
    try { if (fast) fast.close(); } catch (e) { /* ignore */ }
    try { if (conn) conn.close(); } catch (e) { /* ignore */ }
    for (const L of links) { try { if (L.fast) L.fast.close(); } catch (e) { /* ignore */ } try { if (L.conn) L.conn.close(); } catch (e) { /* ignore */ } }
    for (const c of specs) try { c.close(); } catch (e) { /* ignore */ }
    try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
  }, open || specs.length || links.length ? 300 : 0);
}
function netSend(m) {
  if (NET.role === 'spec' && m.t !== 'hello' && m.t !== 'ping' && m.t !== 'chat') return;   // spectators only watch (and chat)
  if (NET.role === 'host') { for (const L of NET.links) linkSend(L, m); }
  else if (NET.open && NET.conn) try { NET.conn.send(m); } catch (e) { /* channel closing */ }
  if (NET.role === 'host' && NET.specs.length && SPEC_MSGS.has(m.t) && !(m.t === 'chat' && m.team)) {
    const out = m.t === 'start' ? { ...m, cfg: { ...m.cfg, tok: undefined, me: -1 } } : m;   // tokens stay with the players
    for (const c of NET.specs) try { c.send(out); } catch (e) { /* closing */ }
  }
}
// latest-wins traffic (snapshots, stick input, pings): the fast channel when it works
function netSendFast(m) {
  if (NET.role === 'host') {
    // spectators get snapshots over the reliable channel, 20 a second
    if (m.t === 's' && NET.specs.length && performance.now() - NET.specSnapT >= 48) {
      NET.specSnapT = performance.now();
      for (const c of NET.specs) try { c.send(m); } catch (e) { /* closing */ }
    }
    let str = null;
    for (const L of NET.links) if (!L.gone) linkSendFast(L, m, str || (str = JSON.stringify(m)));
    return;
  }
  if (NET.role === 'spec' && m.t !== 'ping') return;
  const dc = NET.fast;
  if (NET.fastOK && dc && dc.readyState === 'open' && dc.bufferedAmount < 65536) { try { dc.send(JSON.stringify(m)); return; } catch (e) { /* fall back */ } }
  netSend(m);
}
// the game's start, to each friend with his own token and seat (and to the spectators)
function netSendStart(cfg, only = null) {
  for (const L of NET.links) if (!L.gone && (!only || L === only)) linkSend(L, { t: 'start', cfg: { ...cfg, tok: L.tok || undefined, me: L.sid }, rejoin: only ? 1 : undefined });
  if (!only) for (const c of NET.specs) try { c.send({ t: 'start', cfg: { ...cfg, tok: undefined, me: -1 } }); } catch (e) { /* closing */ }
}
// who's in the room: names, picks, voice (the host keeps it)
function netSendRoom() { if (NET.role === 'host') { netSend({ t: 'room', room: NET.room }); voiceSync(); renderMenu(); } }
function roomOK(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, SQUAD_MAX).filter((r) => r && typeof r === 'object').map((r) => ({
    sid: clamp(r.sid | 0, 0, SQUAD_MAX - 1), name: cleanName(r.name), side: r.side ? 1 : 0, pick: PICK_RE.test(r.pick || '') ? r.pick : '',
    peer: typeof r.peer === 'string' ? r.peer.slice(0, 64) : '', voice: !!r.voice, on: r.on !== false,
  }));
}
// ---------------------------------------------------------------- lobby ----
// A 1v1: each player picks his own team (built-in or one of his custom rosters). A squad:
// the host picks both teams and everyone picks a player (64-squad.js).
// Custom rosters travel as data, so your friend doesn't need them saved.
function netSendLobby() {
  if (NET.role !== 'host' || !NET.open) return;
  const sq = menu.netMode === 1;
  const m = { t: 'lobby', ver: BUILD_ID, me: meId(), squad: sq ? 1 : 0, netMode: sq ? 1 : 0, side: menu.side, innings: menu.innings, diff: menu.diff, pdiff: menu.pdiff, ump: menu.ump, park: menu.park || '', squadSkip: menu.squadSkip ?? 1,
    hostSpec: sq ? null : teamSpec(menuTeam(menu.side ? 'home' : 'away')), teams: sq ? [teamSpec(menuTeam('away')), teamSpec(menuTeam('home'))] : null };
  const s = JSON.stringify(m);
  if (s !== NET.lobbySent) { NET.lobbySent = s; netSend(m); }
}
function netSendPick() { if (NET.role === 'guest' && NET.open && !squadMode()) netSend({ t: 'pick', spec: teamSpec(menuTeam('netTeam')) }); }
function specOK(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.c) { const c = cleanRoster(s.c); return c ? { c } : null; }
  return TEAMS.some((t) => t.key === s.b) || isClassic(s.b) ? { b: s.b } : null;
}
function hostStartOnline() {
  if (!(NET.role === 'host' && NET.open) || onlineBlock()) return;
  const P = onlinePicks();
  const cfg = { mode: 'online', teams: distinctSpecs(teamSpec(P.teams[0]), teamSpec(P.teams[1])), side: menu.side, innings: menu.innings, diff: menu.diff, pdiff: menu.pdiff, manual: 1, ump: menu.ump, park: menu.park || '' };
  if (P.squad) { cfg.squad = NET.room.filter((r) => r.pick).map((r) => ({ sid: r.sid, name: r.name, side: r.side, pick: r.pick })); cfg.skip = menu.squadSkip ?? 1; }
  for (const L of NET.links) L.tok = Math.random().toString(36).slice(2, 12);
  netSendStart(cfg);
  startGame(cfg);
}

// ------------------------------------------------------------- messages ----
// L: on the host, the link it came in on
function netOnMsg(m, L = null) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hi') return;
  if (m.t === 'bye') { if (L) L.bye = true; else NET.bye = true; return; }
  if (m.t === 'ping') { const pong = { t: 'pong', c: m.c, h: performance.now() }; if (L) linkSendFast(L, pong); else netSendFast(pong); return; }
  if (m.t === 'pong') { netPong(m, L); return; }
  if (NET.role === 'host') { if (L) hostOnMsg(m, L); } else guestOnMsg(m);
}
// round trip time, and (for the guest) the offset from our clock to the host's
function netPong(m, L) {
  const now = performance.now(), rtt = now - m.c, at = L || NET;
  if (!(rtt >= 0 && rtt < 5000) || !Number.isFinite(+m.h)) return;
  at.pings.push({ rtt, off: +m.h + rtt / 2 - now });
  if (at.pings.length > 12) at.pings.shift();
  if (!L) NET.off = NET.pings.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;   // the fastest exchange is the most trustworthy
  at.rtt = at.rtt ? at.rtt * 0.8 + rtt * 0.2 : rtt;
}
function hostOnMsg(m, L) {
  if (m.t === 'hello') { NET.lobbySent = ''; netSendLobby(); netSendRoom(); return; }
  if (m.t === 'pick') { if (menu.netMode !== 1) { NET.guestSpec = specOK(m.spec); renderMenu(); } return; }
  if (m.t === 'claim') { if (menu.netMode === 1) hostClaim(L.sid, m.side ? 1 : 0, typeof m.pick === 'string' ? m.pick : ''); return; }
  if (m.t === 'name') {
    const nm = cleanName(m.name, L.name), r = NET.room.find((x) => x.sid === L.sid);
    if (nm !== L.name && G.mode !== 'online') { chatSys(`${L.name} is now ${nm}.`); L.name = nm; if (r) r.name = nm; netSendRoom(); }
    return;
  }
  if (m.t === 'chat') { chatIn(m, L); return; }
  if (m.t === 'vc') { const r = NET.room.find((x) => x.sid === L.sid); if (r && r.voice !== !!m.on) { r.voice = !!m.on; netSendRoom(); } return; }
  if (m.t === 'in') {
    if (typeof m.q === 'number') { if (m.q <= L.q) return; L.q = m.q; }
    L.inp.x = clamp(+m.x || 0, -1, 1); L.inp.z = clamp(+m.z || 0, -1, 1); L.inAt = performance.now();
    L.pos = typeof m.k === 'string' && Number.isFinite(+m.px) && Number.isFinite(+m.pz)
      ? { key: m.k, x: +m.px, z: +m.pz, ry: +m.ry || 0, v: clamp(+m.v || 0, 0, 40), at: performance.now() } : null;
    if (!G.squad) { G.remoteIn.x = L.inp.x; G.remoteIn.z = L.inp.z; NET.remoteInAt = L.inAt; G.remotePos = L.pos; }
    return;
  }
  if (m.t !== 'act' || G.mode !== 'online') return;
  if (G.squad) { squadAct(m, L); return; }
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
    case 'sub': { const s = G.ctrl.indexOf('remote'); if (s >= 0 && ['ph', 'pr', 'def', 'pen', 'ibb'].includes(m.kind)) doSub(s, m.kind, m.target == null ? null : String(m.target), String(m.inId || '')); break; }
    case 'again': if (G.phase === 'final') hostRestart(); break;
    case 'challenge':
      if (G.phase === 'reviewWait' && G.review && G.review.who === 'remote') startReview();
      else if (G.challengeable && G.challengeable.who === 'remote') startChallenge(G.challengeable.side);
      break;
  }
}
// a squad: each person can only do things with his own player
function squadAct(m, L) {
  const s = seatBySid(L.sid), pl = G.play;
  if (!s || s.cpu) return;
  const mine = (p) => !!p && p.id === s.pid, c = pl ? pl.ctl.find((x) => x.sid === s.sid) : null;
  switch (m.a) {
    case 'swing': if (mine(G.batter)) remoteSwing(m); break;
    case 'take': if (G.phase === 'pitch' && mine(G.batter)) G.remoteTake = true; break;
    case 'pitch': if (mine(curPitcher())) remotePitch(m); break;
    case 'throw': if (c) pl.userThrow(clamp(m.base | 0, 1, 4), c); break;
    case 'dive': if (c) pl.userDive(c); break;
    case 'run': if (s.side === G.half) { const kind = m.kind === 'go' ? 'go' : 'back'; if (pl) pl.runCmd(kind, s.pid, s.pid); else stealCmd(kind, s.pid); } break;
    case 'pick': if (mine(curPitcher())) startPickoff(clamp(m.base | 0, 1, 3)); break;
    case 'skip': skip(true); break;
    case 'trot': if (pl && (pl.hr || pl.awarded) && pl.t > 2) pl.skipTrot(); break;
    case 'pause': togglePause(!!m.v, true); break;
    case 'again': if (G.phase === 'final') hostRestart(); break;
    case 'challenge': if (G.challengeable && G.challengeable.who === 'squad' && G.challengeable.sids.includes(s.sid)) startChallenge(G.challengeable.side); break;
  }
}
// a rematch: the same teams and spots (anyone who left is out)
function hostRestart() {
  const cfg = { ...G.cfg };
  if (Array.isArray(cfg.squad)) cfg.squad = cfg.squad.filter((s) => s.sid === 0 || NET.links.some((L) => L.sid === s.sid && !L.gone));
  netSendStart(cfg); showScreen(null); startGame(cfg);
}
const NET_SOUNDS = new Set(['crack', 'pop', 'thud', 'roar', 'charge', 'stretch', 'fanfare', 'say']);
function guestOnMsg(m) {
  switch (m.t) {
    case 'ver': netStatus(VERSION_MSG, 'bad'); netClose(); renderMenu(); break;
    case 'welcome': NET.sid = clamp(m.sid | 0, 0, SQUAD_MAX - 1); renderMenu(); break;
    case 'room': NET.room = roomOK(m.room); voiceSync(); renderMenu(); break;
    case 'chat': chatShow(m); break;
    case 'lobby': {
      if (m.ver !== BUILD_ID) { netStatus(VERSION_MSG, 'bad'); netClose(); renderMenu(); break; }
      const first = !NET.lobby, wasSquad = !!(NET.lobby && NET.lobby.squad);
      NET.lobby = { ...m, hostSpec: specOK(m.hostSpec), teams: Array.isArray(m.teams) ? m.teams.slice(0, 2).map(specOK) : null };
      NET.opp = m.squad ? null : cleanOpp(m.me);
      if (!first && wasSquad && !m.squad) netSendPick();   // back to a 1v1: your team pick again
      if (first) {
        netSendPick();
        const rec = NET.opp ? h2hGet(NET.opp.uid) : null, host = (NET.room.find((r) => r.sid === 0) || {}).name;
        if (m.squad) netStatus(`Connected to ${host ? host + "'s" : 'the'} squad. Pick your player. The host starts the game.`, 'good');
        else if (NET.opp) netStatus(`Connected to ${NET.opp.name}'s game.${rec ? ` You're ${rec.w}-${rec.l} against each other.` : ''} Pick your team. The host starts the game.`, 'good');
      }
      renderMenu(); break;
    }
    case 'full': netStatus(m.spec ? 'That game already has the most spectators it can take.' : m.squad && m.started ? 'That game has already started. Press Watch to spectate it instead.' : m.squad ? `That room is full (${SQUAD_MAX} players). Press Watch to spectate it instead.` : 'That game already has two players. Press Watch to spectate it instead.', 'bad'); netClose(); renderMenu(); break;
    case 'start':
      if (m.cfg && typeof m.cfg === 'object') {
        if (NET.role === 'guest' && typeof m.cfg.tok === 'string') NET.tok = m.cfg.tok.slice(0, 20);
        if (NET.role === 'guest') NET.sid = clamp(m.cfg.me | 0, 0, SQUAD_MAX - 1);
        showScreen(null); closeBox(); closeChat();
        const squad = Array.isArray(m.cfg.squad) ? m.cfg.squad.slice(0, SQUAD_MAX) : null;
        startGame({ ...m.cfg, squad, teams: (m.cfg.teams || []).map((s) => specOK(s) || { b: TEAMS[0].key }), guest: true, spec: NET.role === 'spec', me: NET.role === 'spec' ? -1 : NET.sid });
      }
      break;
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
// skipping ahead (a play none of a squad is in) the sounds and the commentary stay quiet
function netEv(f, a) { if (isHost() && !(G.skipping && (f === 'snd' || f === 'cast'))) netSend({ t: 'ev', f, a }); }
// just to the person it's for (a squad), or to everyone
function netEvTo(f, a, sid = null) { if (sid == null || !G.squad) netEv(f, a); else if (isHost()) linkSend(linkBySid(sid), { t: 'ev', f, a }); }
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
    // each side's game roster, so the guest's Team panel shows the real thing
    ros: [0, 1].map((ti) => ({ lu: G.lu[ti].map((p) => [p.id, p.pos]), bench: G.bench[ti].map((p) => p.id), pen: G.bullpen[ti].map((p) => p.id),
      // for the box score
      pl: G.played[ti].map((x) => [x.pl.id, x.pos, x.for ? 1 : 0]), pi: G.pitched[ti].map((p) => p.id) })),
    dec: G.phase === 'final' ? decisions() : null,
    chal: G.challenges, ump: G.ump, specs: NET.specs.length,
    chk: G.challengeable && (G.challengeable.who === 'remote' || G.challengeable.who === 'squad') ? G.challengeable.side : G.phase === 'reviewWait' && G.review && G.review.who === 'remote' ? G.review.side : -1,
    rv: G.phase === 'reviewWait' && G.review && G.review.who === 'remote' ? G.review.c.base : 0,
    // a squad: who's playing whom (a reliever takes over for his pitcher), who dropped, who can challenge
    sq: G.squad ? G.squad.map((x) => [x.sid, x.pid, x.cpu ? 1 : 0]) : null,
    chs: G.challengeable && G.challengeable.who === 'squad' ? G.challengeable.sids : null,
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
  const b = ballMesh.position, pl = G.play, remoteField = G.squad ? squadFielders().length > 0 : fieldCtrl() === 'remote';
  const s = { t: 's', q: ++NET.seq, ts: r2(performance.now()), ph: G.phase, dur: G.dur, b: [r2(b.x), r2(b.y), r2(b.z), ballMesh.visible ? 1 : 0], m, f: G.camFocus ? G.camFocus.map(r2) : null, sk: G.skipping ? 1 : 0 };
  if (pl && G.phase === 'live') {
    const B = pl.ball, th = B.thr;
    s.pl = {
      pid: NET.pid, pt: r3(pl.t), prompt: pl.prompt && pl.userDef && remoteField ? 1 : 0, uf: remoteField && pl.uf ? pl.uf.m.key : null,
      pr: G.squad && pl.userDef ? pl.ctl.filter((c) => c.prompt).map((c) => c.sid) : null,   // a squad: who's being asked to throw
      land: remoteField ? pl.landingSpot() : null, hr: pl.hr || pl.awarded ? 1 : 0,
      // where the ball is, as something the guest can compute for itself every frame
      bm: B.mode === 'flight' ? (pl.kind === 'hit' ? 'f' : null) : B.mode === 'held' && B.holder ? ['h', B.holder.m.key]
        : B.mode === 'throw' && th ? ['t', th.from.toArray().map(r2), th.to.toArray().map(r2), r3(th.t0), r3(th.T), r2(th.arc)] : null,
    };
  }
  // the guest's runners, during a play or before the pitch (for steals)
  const ri = !(G.squad ? squadBatting() : runCtrl() === 'remote') ? null : pl && G.phase === 'live' ? pl.runnerInfo() : STEAL_PHASES.includes(G.phase) ? stealInfo() : null;
  s.run = ri ? ri.map((r) => [r.id, r.key, r.to, r.from, r.run ? 1 : 0, r.rev ? 1 : 0, r.user ? 1 : 0, r.m.key, r.steal ? 1 : 0, r.bat ? 1 : 0]) : null;
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
  netRejoinTick(); netWaitTick();
  const now = performance.now();
  if (NET.role === 'host') {
    const live = NET.links.filter((L) => !L.gone);
    for (const L of live) {
      // say hi on the fast channel until the other side hears us
      if (L.fast && !L.fastOK && L.fast.readyState === 'open' && now - L.hiT > 250) { L.hiT = now; try { L.fast.send('{"t":"hi"}'); } catch (e) { /* not ready */ } }
      if (now - L.inAt > 500) { L.inp.x = 0; L.inp.z = 0; L.pos = null; }
    }
    if (live.length && now - NET.pingT > (live.some((L) => L.pings.length < 6) ? 250 : 2000)) { NET.pingT = now; netSendFast({ t: 'ping', c: now }); }
    NET.rtt = live.reduce((a, L) => Math.max(a, L.rtt), 0);   // the slowest friend
    pingHUD();
    if (G.mode !== 'online') return;
    if (NET.dirty) { NET.dirty = false; netSend(netGS()); }
    // the more friends, the fewer snapshots each (the guests fill in the frames in between)
    const busy = G.phase === 'live' || G.phase === 'pitch' || G.phase === 'windup' || G.phase === 'postPlay';
    const every = !busy ? 50 : live.length <= 1 ? 14 : live.length <= 3 ? 22 : 32;
    if (now - NET.lastSnap >= every) { NET.lastSnap = now; netSendFast(netSnapshot()); }
    if (now - NET.remoteInAt > 500) { G.remoteIn.x = 0; G.remoteIn.z = 0; G.remotePos = null; }
    return;
  }
  if (!NET.open) return;
  // say hi on the fast channel until the other side hears us
  if (NET.fast && !NET.fastOK && NET.fast.readyState === 'open' && now - NET.hiT > 250) { NET.hiT = now; try { NET.fast.send('{"t":"hi"}'); } catch (e) { /* not ready */ } }
  if (now - NET.pingT > (NET.pings.length < 6 ? 250 : 2000)) { NET.pingT = now; netSendFast({ t: 'ping', c: now }); }
  pingHUD();
}
function pingHUD() {
  const el = $('netPing'), show = G.mode === 'online' && NET.open && NET.rtt > 0;
  el.classList.toggle('hidden', !show);
  if (!show || performance.now() - (pingHUD.t || 0) < 1000) return;
  pingHUD.t = performance.now();
  const ms = Math.round(NET.rtt), n = NET.role === 'host' ? NET.specs.length : NET.specCount | 0;
  el.textContent = `${ms} ms` + (NET.role === 'spec' ? ' · watching' : n ? ` · ${n} watching` : '');
  el.className = ms < 80 ? 'good' : ms < 160 ? 'ok' : 'bad';
  el.title = NET.role === 'host' && NET.links.length > 1 ? 'Round trip to your slowest friend' : `Round trip to ${G.squad ? 'the host' : 'your opponent'}${NET.role === 'host' || NET.fastOK ? '' : ' (fast channel not available, using the reliable one)'}`;
}

// ------------------------------------------------------------ guest side ----
function guestStart() {
  setPhase('wait');
  G.lu = [[], []]; G.pos = [{}, {}]; G.bench = [[], []]; G.bullpen = [[], []]; G.played = [[], []]; G.pitched = [[], []];
  G.fielders = []; G.fByRole = {}; G.swing = null; G.P = null; G.localPitch = false; G.lastP = null; G.batter = null; G.chkMine = false; G.skipping = false;
  Object.assign(NET, { lastAbLen: 0, snap: null, lastSeq: -1, bb: null, ball: null, pclock: { pid: -1, t: 0 }, lastPl: null });
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
  if (Array.isArray(s.ros)) s.ros.forEach((r, ti) => {
    G.lu[ti] = (r.lu || []).map(([id, pos]) => gamePlayer(PBYID[id], pos)).filter(Boolean);
    G.pos[ti] = Object.fromEntries(G.lu[ti].map((p) => [p.pos, p]));
    G.bench[ti] = (r.bench || []).map((id) => PBYID[id]).filter(Boolean);
    G.bullpen[ti] = (r.pen || []).map((id) => PBYID[id]).filter(Boolean);
    if (Array.isArray(r.pl)) G.played[ti] = r.pl.map(([id, pos, f]) => ({ pl: gamePlayer(PBYID[id], pos), pos, for: f ? 1 : 0 })).filter((x) => x.pl);
    if (Array.isArray(r.pi)) G.pitched[ti] = r.pi.map((id) => PBYID[id]).filter(Boolean);
  });
  if (s.dec && typeof s.dec === 'object') G.decIds = Object.fromEntries(Object.entries(s.dec).filter(([, v]) => ['W', 'L', 'S'].includes(v)));
  renderTeam();
  G.challenges = s.chal || [0, 0]; G.ump = s.ump ?? G.ump; NET.specCount = s.specs | 0;
  if (G.squad && Array.isArray(s.sq)) {
    for (const [sid, pid, cpu] of s.sq) { const x = seatBySid(sid); if (x) { if (PBYID[pid]) x.pid = pid; x.cpu = !!cpu; } }
    const me = mySeat(); if (me && G.lock !== me.pid) { G.lock = me.pid; hudLock(); }
  }
  const canChallenge = G.squad ? Array.isArray(s.chs) && s.chs.includes(G.me) : s.chk >= 0 && s.chk === localSide();
  if (canChallenge && !G.chkMine) setHint(s.rv >= 1 && s.rv <= 4 ? `Close play at ${BASE_WORD[s.rv]} &middot; <kbd>C</kbd> challenge it` : `<kbd>C</kbd> challenge the call &middot; ${G.challenges[s.chk]} left`);
  else if (!canChallenge && G.chkMine) setHint('');
  G.chkSide = s.chk; G.chkMine = canChallenge;
  hudScore(); hudCount(); if (G.batter) hudBatter(); hudPitcher(); drawTracker(); drawBoards();
  const n = G.abPitches.length, last = G.abPitches[n - 1];
  if (n !== NET.lastAbLen) {
    NET.lastAbLen = n;
    if (last) {
      pitchMark.position.set(last.x, last.y, 0);
      pitchMark.material.color.set(resultCol(last.res));
      pitchMark.visible = userBats() && settings.zone && G.phase !== 'live';
    }
  }
}
function netApplySnap(s) {
  if (typeof s.q === 'number') { if (s.q <= NET.lastSeq) return; NET.lastSeq = s.q; }   // late and out of order: a newer one already arrived
  const ts = +s.ts || hostNow(), age = clamp((hostNow() - ts) / 1000, 0, 0.25);
  NET.snap = s;
  if (s.pl) NET.lastPl = s.pl; else if (s.ph !== 'postPlay') NET.lastPl = null;
  G.skipping = !!s.sk;
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
    if (NET.role === 'guest') { recordGame(); h2hResult(); }
    $('finalTitle').textContent = String(d.title || 'FINAL'); $('finalSub').textContent = String(d.sub || '');
    $('finalLS').innerHTML = linescoreHTML(); $('potg').innerHTML = d.potg ? potgHTML(d.potg) : '';
  }
  if ([null, 'breakCard', 'final'].includes(m.id)) showScreen(m.id);
}
// the fielder you steer moves on your screen right away (the same running model the
// host uses); the host takes this position for him
const fieldRole = (pl) => (pl.pos === 'SP' || pl.pos === 'RP' ? 'P' : pl.pos);
function guestPredict(dt) {
  const P = NET.pred, pl = NET.snap && NET.snap.pl, uf = guestUF(pl);
  const key = G.phase === 'live' && pl && uf && userFields() && !pl.hr && !trotOn() ? uf : null;
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
// the fielder you steer (a squad: your own man, when he's in the field)
function guestUF(pl) {
  if (!G.squad) return pl ? pl.uf : null;
  const m = myModel();
  return pl && m && m.fielding && userFields() ? m.key : null;
}
// your player's model, wherever he is on the field (a squad, or Player Lock)
function myModel() { if (!G.lock) return null; for (const m of MODELS) if (m.root.visible && m.pl && m.pl.id === G.lock && m.kind !== 'ump') return m; return fpvHidden && fpvHidden.pl && fpvHidden.pl.id === G.lock ? fpvHidden : null; }
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
  if ((G.phase === 'live' || G.phase === 'postPlay') && !fpvOn) playCam();
  else if (G.phase === 'final') menuCam(dt * 0.6);
  if (G.phase === 'live' && userFields()) {
    const v = fieldVec(), now = performance.now(), msg = { t: 'in', q: ++NET.inSeq, x: r3(v.x), z: r3(v.z) };
    if (pm) Object.assign(msg, { k: NET.pred.key, px: r2(pm.root.position.x), pz: r2(pm.root.position.z), ry: r3(pm.root.rotation.y), v: r2(NET.pred.v) });
    const key = msg.x + ',' + msg.z + (pm ? ',' + msg.px + ',' + msg.pz : '');
    if ((pm && now - NET.lastIn > 14) || (key !== NET.sentIn && now - NET.lastIn > 30) || now - NET.lastIn > 250) { NET.sentIn = key; NET.lastIn = now; netSendFast(msg); }
    else NET.inSeq--;
  }
  const pl = G.phase === 'live' && NET.snap && NET.role !== 'spec' ? NET.snap.pl : null;   // a spectator doesn't steer anyone
  const uf = guestUF(pl), ufm = uf && !pl.hr ? modelByKey(uf) : null;
  ctrlRing.visible = !!ufm;
  if (ufm) ctrlRing.position.set(ufm.root.position.x, groundY(ufm.root.position.x, ufm.root.position.z) + 0.12, ufm.root.position.z);
  landMark.visible = !!(pl && pl.land && landingAssist() && (!G.squad || userFields()));
  if (landMark.visible) landMark.position.set(pl.land[0], 0.1, pl.land[1]);
  $('throwPrompt').classList.toggle('hidden', !(pl && (G.squad ? Array.isArray(pl.pr) && pl.pr.includes(G.me) : pl.prompt)));
  runnerHUD(userRuns() && ((!!pl && !pl.hr) || (STEAL_PHASES.includes(G.phase) && !!(NET.snap && NET.snap.run && NET.snap.run.length))));
  pickoffHUD();
  for (const m of MODELS) updateModel(m, G.now);
  guestBall();
  dressFrame();
  if (G.recOn) recFrame();
  if (G.squad) fpvCam(dt);
}
