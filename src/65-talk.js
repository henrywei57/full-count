// ============================================================================
// Talking online: text chat (to everyone, or just your team) and voice chat.
// Chat goes through the host, who passes it on. Voice is a direct WebRTC call
// between every two people who joined it. In a squad game it's proximity voice:
// you hear a friend louder the closer his player is to yours on the field, and
// teammates sitting in the dugout together hear each other fine.
// ============================================================================

// ------------------------------------------------------------------- chat ----
const CHAT = { open: false, team: false, log: [], chatT: [], fadeT: 0 };
const CHAT_LEN = 160, CHAT_FADE = 12000;
function cleanText(s) { return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_LEN); }
// in the online lobby, or in an online game (spectators too)
const chatHere = () => (G.mode === 'online' && G.phase !== 'boot') || (G.mode === 'menu' && menu.mode === 'online' && (NET.open || (NET.role === 'host' && NET.peerOpen)));
// a team channel: a squad game with a teammate in it
function teamChatOK() { const me = mySeat(); return G.mode === 'online' && !!me && G.squad.some((s) => s.sid !== me.sid && s.side === me.side); }
// the side someone plays for in this game (-1: none, or nobody's playing yet)
function sideOfSid(sid) {
  if (G.mode !== 'online' || sid < 0) return -1;
  if (G.squad) { const s = seatBySid(sid); return s ? s.side : -1; }
  const host = G.cfg ? G.cfg.side | 0 : 1;
  return sid === 0 ? host : 1 - host;
}
function chatSend(text) {
  text = cleanText(text);
  if (!text) return;
  const m = { t: 'chat', text, team: CHAT.team && teamChatOK() ? 1 : 0 };
  if (NET.role === 'host') chatIn(m, null, null, true); else netSend(m);
}
// the host gets a message: from a friend (L), a spectator (spec), or himself
function chatIn(m, L, spec = null, self = false) {
  const text = cleanText(m.text), who = self ? CHAT : L || spec;
  if (!text || !who) return;
  const now = Date.now();
  who.chatT = (who.chatT || []).filter((t) => now - t < 5000);
  if (who.chatT.length >= 5) return;   // five messages in five seconds is plenty
  who.chatT.push(now);
  const sid = self ? 0 : L ? L.sid : -1, side = sideOfSid(sid), team = !!m.team && side >= 0 && !!G.squad;
  const out = { t: 'chat', sid, name: self ? myName() : L ? L.name : spec.fcName || 'Spectator', text, team: team ? 1 : 0, side };
  if (team) {
    for (const x of NET.links) if (!x.gone && sideOfSid(x.sid) === side) linkSend(x, out);
    if (sideOfSid(0) === side) chatShow(out);
  } else { netSend(out); chatShow(out); }
}
// a line from the room itself (joins, drops, takeovers): the host tells everyone
function chatSys(text) {
  const out = { t: 'chat', sys: 1, text: cleanText(text) };
  if (NET.role === 'host') netSend(out);
  chatShow(out);
}
function chatShow(m) {
  if (!m || typeof m !== 'object') return;
  const e = { sys: !!m.sys, sid: m.sys ? -1 : clamp(m.sid | 0, -1, SQUAD_MAX - 1), name: cleanName(m.name, 'Player'), text: cleanText(m.text), team: !!m.team, at: Date.now() };
  if (!e.text) return;
  CHAT.log.push(e);
  if (CHAT.log.length > 60) CHAT.log.shift();
  const el = document.createElement('div');
  el.className = `cm${e.sys ? ' sys' : ''}${e.team ? ' team' : ''}`;
  el.dataset.at = e.at;
  el.innerHTML = e.sys ? esc(e.text) : `${e.team ? '<span class="cm-to">TEAM</span>' : ''}<b style="color:${e.sid >= 0 ? seatCol(e.sid) : 'var(--dust)'}">${esc(e.name)}${e.sid < 0 ? ' <small>(watching)</small>' : ''}</b> ${esc(e.text)}`;
  const log = $('chatLog');
  log.appendChild(el);
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  chatRender();
  if (!e.sys && SND.ctx && e.sid !== mySid()) SND.tick();
}
function chatRender() {
  const here = chatHere(), menuSide = G.mode === 'menu', box = menuSide ? $('netPanel') : document.body, el = $('chat');
  if (el.parentElement !== box) box.appendChild(el);   // in the lobby it sits in the online panel
  $('chat').classList.toggle('hidden', !here);
  $('chat').classList.toggle('lobby', menuSide);
  $('chat').classList.toggle('open', here && (CHAT.open || menuSide));
  $('btnChat').classList.toggle('hidden', !(G.mode === 'online'));
  const team = CHAT.team && teamChatOK();
  $('chatTo').textContent = team ? 'TEAM' : 'ALL';
  $('chatTo').classList.toggle('team', team);
  $('chatTo').disabled = !teamChatOK();
  $('chatTo').title = teamChatOK() ? 'Tab: everyone or just your team' : 'Everyone in the room';
  if (!here && CHAT.open) closeChat();
}
function openChat() {
  if (!chatHere()) return;
  CHAT.open = true; keys.clear(); exitPointerLock();
  chatRender();
  const i = $('chatIn'); i.focus();
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
}
function chatClear() { CHAT.log = []; CHAT.open = false; CHAT.team = false; $('chatLog').innerHTML = ''; }
function closeChat() { CHAT.open = false; const i = $('chatIn'); if (document.activeElement === i) i.blur(); chatRender(); }
// old lines fade out of the way when the chat isn't open
function chatFade() {
  const now = Date.now(), all = CHAT.open || G.mode === 'menu';
  for (const el of $('chatLog').children) el.classList.toggle('old', !all && now - +el.dataset.at > CHAT_FADE);
}

// ------------------------------------------------------------------ voice ----
const VOICE = { on: false, joining: false, stream: null, mic: false, muted: false, ptt: false, calls: new Map(), retry: new Map(), block: new Set(), myLvl: 0, an: null, buf: null, syncT: 0, lvlT: 0, note: '' };
// where a player's voice comes from: his man on the field, or his team's dugout
const DUGOUT = [new V3(-115, 0, -41), new V3(115, 0, -41)];   // away (third-base side), home
const VOICE_NEAR = 35, VOICE_FAR = 250;
async function voiceJoin() {
  if (VOICE.on || VOICE.joining || !(NET.role === 'host' || NET.role === 'guest')) return;
  VOICE.joining = true; VOICE.note = 'Asking for your microphone…'; voiceRender();
  SND.init();
  let stream = null;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch (e) { stream = null; }
  VOICE.joining = false;
  if (!(NET.role === 'host' || NET.role === 'guest')) { if (stream) for (const t of stream.getTracks()) t.stop(); voiceRender(); return; }
  VOICE.mic = !!stream;
  // no microphone (or no permission): you can still listen, on a silent line
  if (!stream && SND.ctx) stream = SND.ctx.createMediaStreamDestination().stream;
  if (!stream) { VOICE.note = 'Voice chat is not available in this browser.'; voiceRender(); return; }
  VOICE.stream = stream; VOICE.on = true; VOICE.muted = false;
  VOICE.note = VOICE.mic ? '' : 'No microphone: you can listen, but nobody can hear you.';
  if (VOICE.mic && SND.ctx) {
    try { const src = SND.ctx.createMediaStreamSource(stream); VOICE.an = SND.ctx.createAnalyser(); VOICE.an.fftSize = 512; VOICE.buf = new Float32Array(VOICE.an.fftSize); src.connect(VOICE.an); } catch (e) { VOICE.an = null; }
  }
  voiceMicApply();
  voiceAnnounce();
}
function voiceLeave() {
  if (!VOICE.on) return;
  voiceStop(false);
  voiceAnnounce();
}
// everyone needs to know who's on voice (the host keeps it in the room list)
function voiceAnnounce() {
  if (NET.role === 'host') { const r = NET.room.find((x) => x.sid === 0); if (r) r.voice = VOICE.on; netSendRoom(); }
  else if (NET.role === 'guest') netSend({ t: 'vc', on: VOICE.on ? 1 : 0 });
  voiceSync(); voiceRender();
}
// hang up everything; keep: still on voice (a dropped connection we'll get back), just no calls for now
function voiceStop(keep) {
  for (const sid of [...VOICE.calls.keys()]) voiceDrop(sid);
  if (keep && VOICE.on) return;
  if (VOICE.stream) for (const t of VOICE.stream.getTracks()) t.stop();
  Object.assign(VOICE, { on: false, joining: false, stream: null, mic: false, muted: false, ptt: false, an: null, buf: null, myLvl: 0, note: '' });
  VOICE.retry.clear(); VOICE.block.clear();
  voiceRender();
}
// your microphone on or off: muted, or (push to talk) only while you hold the key
function voiceMicApply() {
  const live = VOICE.on && VOICE.mic && !VOICE.muted && (!settings.vcPTT || VOICE.ptt);
  if (VOICE.stream) for (const t of VOICE.stream.getAudioTracks()) t.enabled = live;
  voiceRender();
}
function voiceKey(down) {
  if (!VOICE.on) return;
  if (settings.vcPTT) { if (VOICE.ptt !== down) { VOICE.ptt = down; voiceMicApply(); } }
  else if (down) { VOICE.muted = !VOICE.muted; voiceMicApply(); }
}
const voiceLive = () => VOICE.on && VOICE.mic && !VOICE.muted && (!settings.vcPTT || VOICE.ptt);
// call everyone on voice we aren't talking to yet (the lower seat calls, the other answers)
function voiceSync() {
  const me = mySid(), want = new Map(), now = Date.now();
  if (VOICE.on && NET.peer && (NET.role === 'host' || (NET.role === 'guest' && NET.open))) {
    for (const r of NET.room || []) if (r.sid !== me && r.voice && r.on && r.peer) want.set(r.sid, r.peer);
  }
  for (const [sid, v] of VOICE.calls) if (want.get(sid) !== v.peer) voiceDrop(sid);
  for (const [sid, peer] of want) {
    if (VOICE.calls.has(sid) || me > sid || (VOICE.retry.get(sid) || 0) > now) continue;
    try { voiceAttach(sid, peer, NET.peer.call(peer, VOICE.stream, { metadata: { sid: me } })); } catch (e) { VOICE.retry.set(sid, now + 5000); }
  }
}
function voiceIncoming(call) {
  const sid = call.metadata && Number.isInteger(call.metadata.sid) ? call.metadata.sid : -1;
  const r = (NET.room || []).find((x) => x.sid === sid && x.peer === call.peer);
  if (!VOICE.on || !r || sid === mySid()) { try { call.close(); } catch (e) { /* gone */ } return; }
  if (VOICE.calls.has(sid)) voiceDrop(sid);
  try { call.answer(VOICE.stream); } catch (e) { return; }
  voiceAttach(sid, call.peer, call);
}
function voiceAttach(sid, peer, call) {
  if (!call) return;
  const v = { call, peer, el: null, lvl: 0, vol: 0 };
  VOICE.calls.set(sid, v);
  call.on('stream', (st) => {
    if (VOICE.calls.get(sid) !== v || v.el) return;
    // a plain audio element keeps the browser's echo cancelling working; its volume is the proximity
    const el = new Audio(); el.autoplay = true; el.srcObject = st; el.volume = 0;
    el.play().catch(() => {});
    v.el = el;
  });
  const end = () => { if (VOICE.calls.get(sid) === v) { voiceDrop(sid); VOICE.retry.set(sid, Date.now() + 4000); } };
  call.on('close', end); call.on('error', end);
}
function voiceDrop(sid) {
  const v = VOICE.calls.get(sid);
  if (!v) return;
  VOICE.calls.delete(sid);
  try { v.call.close(); } catch (e) { /* gone */ }
  if (v.el) { try { v.el.pause(); } catch (e) { /* gone */ } v.el.srcObject = null; }
}
// where his voice comes from in the ballpark (null: no place, e.g. a spectator)
function voicePos(sid) {
  const s = seatBySid(sid);
  if (!s) return null;
  for (const m of MODELS) if (m.root.visible && m.pl && m.pl.id === s.pid && m.kind !== 'ump') return m.root.position;
  if (fpvHidden && fpvHidden.pl && fpvHidden.pl.id === s.pid) return fpvHidden.root.position;
  return DUGOUT[s.side];
}
// how loud he is to you: full up close, fading out across the field (the whole room when it's off)
function voiceGain(sid) {
  if (VOICE.block.has(sid)) return 0;
  if (!settings.vcNear || G.mode !== 'online' || !G.squad || ['final', 'wait'].includes(G.phase)) return 1;
  const a = voicePos(G.me), b = voicePos(sid);
  if (!a || !b) return 1;
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  return d <= VOICE_NEAR ? 1 : Math.pow(Math.max(0, 1 - (d - VOICE_NEAR) / (VOICE_FAR - VOICE_NEAR)), 1.6);
}
function voiceTalking(sid) {
  if (!VOICE.on) return false;
  if (sid === mySid()) return voiceLive() && VOICE.myLvl > 0.025;
  const v = VOICE.calls.get(sid);
  return !!v && v.lvl > 0.03 && v.vol > 0.02;
}
// how loud each of them is talking right now (for the speaker icons)
function voiceLevels() {
  if (VOICE.an && VOICE.buf) {
    VOICE.an.getFloatTimeDomainData(VOICE.buf);
    let s = 0; for (const x of VOICE.buf) s += x * x;
    VOICE.myLvl = voiceLive() ? Math.sqrt(s / VOICE.buf.length) : 0;
  }
  for (const v of VOICE.calls.values()) {
    try {
      const rc = v.call.peerConnection && v.call.peerConnection.getReceivers().find((x) => x.track && x.track.kind === 'audio');
      const src = rc && rc.getSynchronizationSources ? rc.getSynchronizationSources()[0] : null;
      v.lvl = src && performance.now() - src.timestamp < 500 ? src.audioLevel || 0 : 0;
    } catch (e) { v.lvl = 0; }
  }
}
function voiceRender() {
  const online = menu.mode === 'online' && (NET.role === 'host' || NET.role === 'guest'), ingame = G.mode === 'online' && NET.role !== 'spec';
  $('netVoiceRow').classList.toggle('hidden', !online || G.mode === 'online');
  $('btnVoiceJoin').textContent = VOICE.on ? 'Leave voice chat' : VOICE.joining ? 'Joining…' : 'Join voice chat';
  $('btnVoiceMic').classList.toggle('hidden', !VOICE.on || !VOICE.mic);
  $('btnVoiceMic').textContent = settings.vcPTT ? `Push to talk: hold ${voiceKeyName()}` : VOICE.muted ? 'Mic muted' : 'Mic on';
  $('btnVoiceMic').classList.toggle('muted', VOICE.muted);
  $('voiceNote').textContent = VOICE.note || (VOICE.on ? `${VOICE.calls.size} connected${settings.vcNear ? ' · proximity in squad games' : ''}` : 'Talk to everyone in the room');
  const b = $('btnMic');
  b.classList.toggle('hidden', !ingame);
  const st = !VOICE.on ? 'off' : !VOICE.mic ? 'listen' : VOICE.muted ? 'muted' : settings.vcPTT && !VOICE.ptt ? 'ptt' : 'live';
  b.dataset.st = st;
  b.title = { off: 'Join voice chat', listen: 'Voice chat: listening (no microphone)', muted: `Mic muted (${voiceKeyName()} or click to unmute)`, ptt: `Push to talk: hold ${voiceKeyName()} (click to mute)`, live: `Mic on (${voiceKeyName()} or click to mute)` }[st];
}
function voiceKeyName() { const p = boundKey('g'); return p ? keyLabel(p) : 'G'; }
// a person in the room list: on voice or not, talking, and a button to mute him for yourself
function voicePersonHTML(r) {
  if (!r.voice) return '';
  const me = r.sid === mySid(), blocked = VOICE.block.has(r.sid);
  return `<span class="sq-mic${voiceTalking(r.sid) ? ' talk' : ''}${blocked ? ' blocked' : ''}" ${me ? 'title="You are on voice chat"' : `data-vblock="${r.sid}" title="${blocked ? 'Unmute' : 'Mute'} ${esc(r.name)} for you"`}></span>`;
}

// ------------------------------------------------------------- every frame ----
function talkTick(dt) {
  const now = performance.now();
  if (VOICE.on) {
    for (const [sid, v] of VOICE.calls) {
      if (!v.el) continue;
      const want = voiceGain(sid) * (settings.vcVol ?? 1);
      v.vol += (want - v.vol) * (1 - Math.exp(-dt * 6));
      const vol = clamp(v.vol, 0, 1);
      if (Math.abs(v.el.volume - vol) > 0.005) v.el.volume = vol;
    }
    if (now - VOICE.lvlT > 120) { VOICE.lvlT = now; voiceLevels(); }
    if (now - VOICE.syncT > 2500) { VOICE.syncT = now; voiceSync(); }
  }
  if (now - CHAT.fadeT > 500) {
    CHAT.fadeT = now;
    chatFade();
    if (chatHere() !== !$('chat').classList.contains('hidden')) chatRender();
    if ((G.mode === 'online' && NET.role !== 'spec') === $('btnMic').classList.contains('hidden')) voiceRender();
    if (VOICE.on && G.mode === 'menu' && !$('squadPanel').classList.contains('hidden')) renderSquadMics();
  }
}
// just the speaker icons in the lobby (no need to rebuild the whole panel)
function renderSquadMics() { for (const el of document.querySelectorAll('#squadPanel .sq-mic')) { const sid = el.dataset.vblock != null ? +el.dataset.vblock : mySid(); el.classList.toggle('talk', voiceTalking(sid)); } }

// ------------------------------------------------------------------ input ----
// Y opens the chat, G is push to talk (or mutes); typing in the box never moves your player
window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const k = keyAlias(e.key.toLowerCase());
  if (k === 'y' && chatHere()) { e.preventDefault(); e.stopImmediatePropagation(); openChat(); return; }
  if (k === 'g' && VOICE.on) { e.preventDefault(); voiceKey(true); }
});
window.addEventListener('keyup', (e) => { if (keyAlias(e.key.toLowerCase()) === 'g') voiceKey(false); });
window.addEventListener('blur', () => { if (VOICE.ptt) voiceKey(false); });
function buildTalkUI() {
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const i = $('chatIn');
    chatSend(i.value); i.value = '';
    if (G.mode !== 'menu') closeChat();
  });
  $('chatIn').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); $('chatIn').value = ''; if (G.mode === 'menu') $('chatIn').blur(); else closeChat(); }
    else if (e.key === 'Tab') { e.preventDefault(); if (teamChatOK()) { CHAT.team = !CHAT.team; chatRender(); } }
  });
  $('chatIn').addEventListener('focus', () => { keys.clear(); if (G.mode !== 'menu' && !CHAT.open) { CHAT.open = true; chatRender(); } });
  $('chatIn').addEventListener('blur', () => { if (CHAT.open && G.mode !== 'menu') setTimeout(() => { if (document.activeElement !== $('chatIn')) closeChat(); }, 120); });
  $('chatTo').addEventListener('pointerdown', (e) => { e.preventDefault(); if (teamChatOK()) { CHAT.team = !CHAT.team; chatRender(); } });
  $('chat').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('btnChat').addEventListener('click', () => (CHAT.open ? closeChat() : openChat()));
  $('btnMic').addEventListener('click', () => { if (!VOICE.on) voiceJoin(); else if (VOICE.mic) { VOICE.muted = !VOICE.muted; voiceMicApply(); } });
  $('btnVoiceJoin').addEventListener('click', () => (VOICE.on ? voiceLeave() : voiceJoin()));
  $('btnVoiceMic').addEventListener('click', () => { if (settings.vcPTT) return; VOICE.muted = !VOICE.muted; voiceMicApply(); });
  $('squadPanel').addEventListener('click', (e) => {
    const vb = e.target.closest('[data-vblock]');
    if (vb) { const sid = +vb.dataset.vblock; if (VOICE.block.has(sid)) VOICE.block.delete(sid); else VOICE.block.add(sid); renderMenu(); return; }
    const b = e.target.closest('.sq-spot'); if (b && !b.disabled) claimSpot(+b.dataset.side, b.dataset.pick);
  });
  $('netName').value = settings.netName || '';
  $('netName').addEventListener('change', () => {
    settings.netName = cleanName($('netName').value, ''); $('netName').value = settings.netName; saveSettings();
    if (NET.role === 'guest' && NET.open && settings.netName) netSend({ t: 'name', name: myName() });
    else if (NET.role === 'host') { const r = NET.room.find((x) => x.sid === 0); if (r && G.mode !== 'online') { r.name = myName(); netSendRoom(); } }
  });
  voiceRender(); chatRender();
}
