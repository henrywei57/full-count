// ============================================================================
// Online squad: you and up to nine friends in one game, each playing one player
// (any spot in either batting order, or a starting pitcher), on the same team or
// against each other. The CPU plays everyone else and manages both clubs. Every
// device runs the Player Lock cameras (third person by default) on its own player.
//   G.squad: [{ sid, name, side, pid, col, cpu }]   cpu: he dropped; the CPU plays him until he's back
//   G.me:    your seat id (the host is 0, a spectator -1)
// The lobby (who's in the room, who plays whom) lives in NET.room, kept by the host.
// ============================================================================

const SQUAD_MAX = 10;
const SEAT_COLS = ['#ffc94a', '#5aa8ff', '#ff5a5f', '#3fd38a', '#c77dff', '#ff9f43', '#2ee6d6', '#ff6fb5', '#a3e635', '#e8edf5'];
const seatCol = (sid) => SEAT_COLS[Math.abs(sid | 0) % SEAT_COLS.length];
// a name someone typed: plain text, short
function cleanName(s, def = 'Player') { const t = String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16); return t || def; }
const PICK_RE = /^(h[0-8]|p0)$/;
// the player a pick stands for: 'h0'..'h8' a spot in the batting order, 'p0' the starting pitcher
function pickPlayer(team, pick, starter) {
  if (!team || !PICK_RE.test(pick || '')) return null;
  return pick === 'p0' ? starter || (team.rotation ? team.rotation[0] : team.pitchers[0]) : team.lineup[+pick.slice(1)] || null;
}
function squadInit(cfg) {
  G.me = cfg.spec ? -1 : cfg.guest ? cfg.me | 0 : 0;
  G.squad = cfg.squad.map((s) => {
    const side = s.side ? 1 : 0, pl = pickPlayer(G.teams[side], s.pick, G.pitcher[side]);
    return pl ? { sid: s.sid | 0, name: cleanName(s.name), side, pid: pl.id, col: seatCol(s.sid), cpu: !!s.cpu } : null;
  }).filter(Boolean);
  const me = mySeat();
  G.lock = me ? me.pid : null; G.lockSide = me ? me.side : 1;
  G.view = menu.view ?? 2;   // each device picks its own camera
  G.squadSkip = cfg.skip ?? 1;   // nobody's in the play: 1 skip ahead, 0 watch it fast, 2 real time
}
const mySeat = () => (G.squad ? G.squad.find((s) => s.sid === G.me) || null : null);
const seatBySid = (sid) => (G.squad ? G.squad.find((s) => s.sid === sid) || null : null);
// the person playing this player right now (nobody if he dropped: the CPU has him)
function seatOf(pid) { if (!G.squad || !pid) return null; for (const s of G.squad) if (s.pid === pid && !s.cpu) return s; return null; }
const squadIds = () => new Set(G.squad ? G.squad.filter((s) => !s.cpu).map((s) => s.pid) : []);
function squadCtrl(pid) { const s = seatOf(pid); return !s ? 'cpu' : s.sid === G.me ? 'local' : 'remote'; }
// is this player out in the field right now? (the guest goes by the game roster the host sends)
function fieldingNow(pid) {
  if (!pid || !G.teams) return false;
  if (!isGuest()) return (G.fielders || []).some((f) => f.pl.id === pid);
  const ti = 1 - G.half;
  return (!!G.pitcher[ti] && G.pitcher[ti].id === pid) || (G.lu[ti] || []).some((p) => p.id === pid && p.pos !== 'DH');
}
const squadFielders = () => (G.squad ? G.squad.filter((s) => !s.cpu && s.side === 1 - G.half && fieldingNow(s.pid)) : []);
const squadBatting = () => !!G.squad && G.squad.some((s) => !s.cpu && s.side === G.half);
// who steers whom in a new Play: everyone in the field locked to his own man, and each runner
// run by the person playing him
function playCtl() {
  if (G.squad) {
    const fs = squadFielders();
    return { field: fs.length ? { multi: fs.map((s) => ({ sid: s.sid, lock: s.pid })), manual: settings.manual } : null, run: squadBatting() ? { multi: true } : null };
  }
  const fc = fieldCtrl(), rc = runCtrl();
  return { field: fc === 'cpu' ? null : { lock: G.lock, manual: settings.manual }, run: rc === 'cpu' ? null : { lock: G.lock } };
}
// a reliever came in for someone's pitcher: he takes the mound with the new man
function squadTakeOver(oldId, np) {
  const s = G.squad && G.squad.find((x) => x.pid === oldId);
  if (!s) return;
  s.pid = np.id;
  if (s.sid === G.me) G.lock = np.id;
  NET.dirty = true;
  chatSys(`${s.name} takes over as ${np.name}.`);
}
// a Play involves one of you: on base, at bat, on the mound, or a ball hit your way
function squadInvolved() {
  const ph = G.phase, pl = G.play, live = (ph === 'live' || ph === 'postPlay') && !!pl, ids = squadIds();
  if (!ids.size) return false;
  if (!live) return batCtrl() !== 'cpu' || pitchCtrl() !== 'cpu' || (LOCK_PHASES.includes(ph) && (G.baseRunners || []).some((r) => ids.has(r.pl.id)));
  if (pl.R.some((r) => ids.has(r.pl.id) && (r.state === 'run' || r.state === 'base'))) return true;
  return !!G.lockInv;
}
// game steps per frame: nobody's in it, so skip ahead (or watch it fast)
function squadFF() {
  if (G.squadSkip === 2 || G.replay || G.phase === 'final' || squadInvolved()) return 1;
  if (G.squadSkip === 1) { G.skipping = true; return SKIP_SPEED; }
  return 4;
}
// what you see before a pitch when you're not batting, pitching or on base
function squadHint() {
  const me = mySeat();
  if (!me) return '';
  if (G.half !== me.side) return fieldingNow(me.pid) ? 'You are in the field &middot; get within the gold ring of the ball to field it' : 'Your team is in the field';
  const idx = (G.lu[me.side] || []).findIndex((p) => p.id === me.pid);
  if (idx < 0) return 'Your team is batting';
  const k = (idx - G.order[me.side] + 9) % 9;
  return k === 1 ? 'Your team is batting &middot; you are on deck' : `Your team is batting &middot; you're up ${k} batters from now`;
}
function squadSimText() {
  const me = mySeat();
  if (!me) return 'Skipping to the next play with one of you in it';
  return `${G.half === me.side ? 'Your team is batting' : 'Your team is in the field'} &middot; skipping to the next play with one of you in it`;
}

// ------------------------------------------------------------- name tags ----
// The Show style: a colored tag over every player a person is playing, with his name
// (YOU over your own) and a speaker when he's talking on voice chat.
const sqTagEls = new Map(), _sqV = new V3();
function squadTags() {
  const box = $('squadTags');
  const on = !!G.squad && G.mode === 'online' && !G.replay && !G.skipping && !G.paused && LOCK_PHASES.concat(['halfIntro']).includes(G.phase);
  const seen = new Set();
  if (on) {
    const W = window.innerWidth, H = window.innerHeight;
    for (const s of G.squad) {
      let m = null;
      for (const x of MODELS) if (x.root.visible && x.pl && x.pl.id === s.pid && x !== fpvHidden) { m = x; break; }
      if (!m || (s.sid === G.me && fpvOn)) continue;   // the camera's already on you
      _sqV.copy(m.root.position); _sqV.y += 8.6; _sqV.project(camera);
      if (_sqV.z > 1 || Math.abs(_sqV.x) > 1.05 || Math.abs(_sqV.y) > 1.05) continue;
      let el = sqTagEls.get(s.sid);
      if (!el) { el = document.createElement('div'); box.appendChild(el); sqTagEls.set(s.sid, el); }
      const me = s.sid === G.me, talk = voiceTalking(s.sid), sig = `${s.name}|${me}|${talk}|${s.cpu}|${s.col}`;
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.className = `sq-tag${me ? ' me' : ''}${talk ? ' talk' : ''}${s.cpu ? ' cpu' : ''}`;
        el.style.setProperty('--sc', s.col);
        el.innerHTML = `${talk ? '<i class="sq-spk"></i>' : ''}<b>${me ? 'YOU' : esc(s.name)}</b>${s.cpu ? '<small>CPU</small>' : ''}`;
      }
      el.style.left = ((_sqV.x + 1) / 2) * W + 'px'; el.style.top = ((1 - _sqV.y) / 2) * H + 'px';
      seen.add(s.sid);
    }
  }
  for (const [sid, el] of sqTagEls) if (!seen.has(sid)) { el.remove(); sqTagEls.delete(sid); }
}

// ----------------------------------------------------------------- lobby ----
// Each person in the room picks a player by clicking his spot (click it again to give it up).
// The host picks both teams. NET.room: [{ sid, name, side, pick, peer, voice, on }]
const squadMode = () => (NET.role === 'guest' || NET.role === 'spec' ? !!(NET.lobby && NET.lobby.squad) : menu.netMode === 1);
const mySid = () => (NET.role === 'host' ? 0 : NET.sid);
function claimSpot(side, pick) {
  const me = (NET.room || []).find((r) => r.sid === mySid());
  const off = me && me.side === side && me.pick === pick;   // your own spot again: give it up
  if (NET.role === 'host') hostClaim(0, side, off ? '' : pick);
  else if (NET.role === 'guest' && NET.open) netSend({ t: 'claim', side, pick: off ? '' : pick });
  SND.init(); if (SND.ctx) SND.tick();
}
// the host takes (or refuses) a claim: one spot each, nobody else's
function hostClaim(sid, side, pick) {
  const r = NET.room.find((x) => x.sid === sid);
  if (!r || G.mode === 'online') return;
  side = side ? 1 : 0; pick = String(pick || '');
  if (pick && (!PICK_RE.test(pick) || NET.room.some((x) => x !== r && x.side === side && x.pick === pick))) return;
  r.side = side; r.pick = pick;
  netSendRoom();
}
function renderSquad() {
  const el = $('squadPanel'), show = menu.mode === 'online' && squadMode() && ((NET.role === 'host' && NET.peerOpen) || (NET.role === 'guest' && NET.open && NET.lobby));
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const P = onlinePicks(), room = NET.room || [], me = mySid();
  const col = (side) => {
    const t = P.teams[side];
    if (!t) return '<div class="sq-col"></div>';
    const spots = t.lineup.map((h, i) => [`h${i}`, h.pos, h.name, `${i + 1}`]).concat([['p0', 'SP', pickPlayer(t, 'p0').name, '']]);
    return `<div class="sq-col"><div class="sq-team" style="background:${t.c1};color:${t.c2}">${side ? 'HOME' : 'AWAY'} &middot; ${esc(t.id)}</div>` + spots.map(([pick, pos, name, ord]) => {
      const who = room.find((r) => r.side === side && r.pick === pick), mine = who && who.sid === me;
      return `<button class="sq-spot${who ? ' taken' : ''}${mine ? ' mine' : ''}" data-side="${side}" data-pick="${pick}" ${who && !mine ? 'disabled' : ''} title="${who ? (mine ? 'Click to give up this spot' : esc(who.name) + ' plays him') : 'Click to play him'}">`
        + `<span class="sq-ord">${ord}</span><b>${pos}</b><span class="sq-pl">${esc(name)}</span>${who ? `<span class="sq-who" style="--sc:${seatCol(who.sid)}">${mine ? 'YOU' : esc(who.name)}</span>` : '<span class="sq-free">PLAY</span>'}</button>`;
    }).join('') + '</div>';
  };
  const people = room.map((r) => {
    const pl = r.pick && P.teams[r.side] ? pickPlayer(P.teams[r.side], r.pick) : null;
    return `<span class="sq-person${r.sid === me ? ' me' : ''}" style="--sc:${seatCol(r.sid)}"><i></i><b>${esc(r.name)}${r.sid === 0 ? ' <small>HOST</small>' : ''}</b>`
      + `<small>${pl ? `${r.side ? 'HOME' : 'AWAY'} ${esc(pl.pos === 'SP' || r.pick === 'p0' ? 'SP' : pl.pos)} &middot; ${esc(lastName(pl.name))}` : 'picking&hellip;'}</small>${voicePersonHTML(r)}</span>`;
  }).join('');
  el.innerHTML = `<div class="sq-head">PICK YOUR PLAYER<small>Click a spot to play him: the same team as your friends or the other one. The CPU plays everyone nobody picks.</small></div>
    <div class="sq-cols">${col(0)}${col(1)}</div>
    <div class="sq-room"><span class="sq-room-h">IN THE ROOM ${room.length}/${SQUAD_MAX}</span>${people}</div>`;
}
