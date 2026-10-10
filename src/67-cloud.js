// ============================================================================
// Google sign-in, cloud rosters and friends (Firebase Auth + Firestore).
// All optional: with no config in firebase-config.js the game plays the same
// and rosters stay on this device. Setup steps are in the README.
//
// Firestore layout (rules in firestore.rules):
//   users/{uid}                 public profile: name, photo, friend code, lastSeen
//   users/{uid}/rosters/{id}    your rosters (only you can read them)
//   users/{uid}/friends/{uid}   your friends list
//   users/{uid}/inbox/{fromUid} friend requests and game invites sent to you
//   codes/{code}                friend code -> uid
// ============================================================================

const FB_VER = '10.12.2';
const INVITE_TTL = 15 * 60 * 1000;
const Cloud = {
  state: 'loading',   // 'loading' | 'off' (not set up) | 'ready' | 'error'
  user: null, profile: null, friends: [], fprof: new Map(), fwatch: new Map(), inbox: [], unsub: [], beat: 0, err: '',
  A: null, F: null, auth: null, db: null,
  async init() {
    let cfg = null;
    try { cfg = (await import('./firebase-config.js')).default; } catch (e) { /* no config next to the page */ }
    if (!cfg || !cfg.apiKey || !cfg.projectId) { this.state = 'off'; cloudRender(); return; }
    try {
      const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
      const [app, A, F] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
      const fa = app.initializeApp(cfg);
      Object.assign(this, { A, F, auth: A.getAuth(fa), db: F.getFirestore(fa), state: 'ready' });
      A.onAuthStateChanged(this.auth, (u) => this.onUser(u).catch((e) => this.fail(e)));
      A.getRedirectResult(this.auth).catch((e) => this.fail(e));
    } catch (e) { console.warn(e); this.state = 'error'; this.err = 'Could not load Google sign-in. Check your connection and refresh.'; }
    cloudRender();
  },
  fail(e) { console.warn('[cloud]', e); this.err = cloudErrText(e); cloudRender(); },
  async signIn() {
    if (this.state !== 'ready') return;
    const p = new this.A.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    this.err = '';
    try { await this.A.signInWithPopup(this.auth, p); } catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) this.A.signInWithRedirect(this.auth, p).catch((e2) => this.fail(e2));
      else if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) this.fail(e);
    }
  },
  signOut() { if (this.auth) this.A.signOut(this.auth).catch((e) => this.fail(e)); },
  stopWatching() {
    for (const f of this.unsub) try { f(); } catch (e) { /* already gone */ }
    for (const f of this.fwatch.values()) try { f(); } catch (e) { /* already gone */ }
    this.unsub = []; this.fwatch.clear(); this.fprof.clear(); clearInterval(this.beat);
  },
  async onUser(u) {
    this.stopWatching();
    Object.assign(this, { user: u, profile: null, friends: [], inbox: [], err: '' });
    cloudRender();
    if (!u) return;
    const { F, db } = this, me = F.doc(db, 'users', u.uid);
    const snap = await F.getDoc(me);
    const code = (snap.exists() && snap.data().code) || (await this.claimCode(u.uid));
    const name = String(u.displayName || 'Player').slice(0, 40), photo = String(u.photoURL || '').slice(0, 500);
    await F.setDoc(me, { name, photo, code, lastSeen: F.serverTimestamp() }, { merge: true });
    if (this.user !== u) return;
    this.profile = { uid: u.uid, name, photo, code };
    this.beat = setInterval(() => F.setDoc(me, { lastSeen: F.serverTimestamp() }, { merge: true }).catch(() => {}), 60000);
    // rosters: keep the newest copy of each between this device and the account
    const rs = await F.getDocs(F.collection(db, 'users', u.uid, 'rosters'));
    const list = [];
    rs.forEach((d) => { try { list.push(JSON.parse(d.data().json)); } catch (e) { /* skip a broken one */ } });
    for (const r of mergeRosters(list)) this.saveRoster(r);
    this.unsub.push(F.onSnapshot(F.collection(db, 'users', u.uid, 'friends'), (qs) => {
      this.friends = qs.docs.map((d) => ({ uid: d.id, ...d.data() }));
      this.watchFriends(); cloudRender();
    }, (e) => this.fail(e)));
    this.unsub.push(F.onSnapshot(F.collection(db, 'users', u.uid, 'inbox'), (qs) => {
      const seen = new Set(this.inbox.map(msgKey));
      this.inbox = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      for (const m of this.inbox) if (!seen.has(msgKey(m)) && m.type === 'invite' && inviteFresh(m)) inviteToast(m);
      cloudRender();
    }, (e) => this.fail(e)));
    cloudRender();
  },
  // each friend's profile, live: name, picture and when they were last on
  watchFriends() {
    const { F, db } = this, want = new Set(this.friends.map((f) => f.uid));
    for (const [uid, stop] of this.fwatch) if (!want.has(uid)) { stop(); this.fwatch.delete(uid); this.fprof.delete(uid); }
    for (const uid of want) {
      if (this.fwatch.has(uid) || this.fwatch.size >= 50) continue;
      this.fwatch.set(uid, F.onSnapshot(F.doc(db, 'users', uid), (d) => { if (d.exists()) this.fprof.set(uid, d.data()); cloudRender(); }, () => {}));
    }
  },
  async claimCode(uid) {
    const { F, db } = this;
    for (let i = 0; i < 12; i++) {
      const code = Array.from({ length: 6 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
      try { await F.setDoc(F.doc(db, 'codes', code), { uid }); return code; } catch (e) { /* taken: the rules won't let anyone overwrite a code */ }
    }
    throw new Error('Could not make a friend code. Try again.');
  },
  saveRoster(d) {
    if (!this.user) return;
    const { F, db } = this;
    F.setDoc(F.doc(db, 'users', this.user.uid, 'rosters', d.id), { json: JSON.stringify(d), updated: d.updated }).catch((e) => this.fail(e));
  },
  deleteRoster(id) {
    if (!this.user) return;
    const { F, db } = this;
    F.deleteDoc(F.doc(db, 'users', this.user.uid, 'rosters', id)).catch((e) => this.fail(e));
  },
  async addFriend(raw) {
    const { F, db } = this, code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!this.profile) throw new Error('Sign in first.');
    if (code.length !== 6) throw new Error('Friend codes are 6 characters.');
    if (code === this.profile.code) throw new Error("That's your own code.");
    const c = await F.getDoc(F.doc(db, 'codes', code));
    if (!c.exists()) throw new Error('No player has that code. Double-check it.');
    const uid = c.data().uid, p = await F.getDoc(F.doc(db, 'users', uid)), d = p.exists() ? p.data() : {};
    await this.befriend(uid, d);
    await this.send(uid, { type: 'friend' });
    return d.name || 'your friend';
  },
  befriend(uid, d) {
    const { F, db } = this;
    return F.setDoc(F.doc(db, 'users', this.user.uid, 'friends', uid), { name: String(d.name || 'Player').slice(0, 40), photo: String(d.photo || '').slice(0, 500), code: String(d.code || '').slice(0, 8), since: F.serverTimestamp() });
  },
  removeFriend(uid) { const { F, db } = this; return F.deleteDoc(F.doc(db, 'users', this.user.uid, 'friends', uid)); },
  // one inbox slot per sender: a newer request or invite replaces the last one
  send(uid, extra) {
    const { F, db } = this, p = this.profile;
    return F.setDoc(F.doc(db, 'users', uid, 'inbox', p.uid), { from: p.uid, name: p.name, photo: p.photo, code: p.code, room: '', ts: F.serverTimestamp(), ...extra });
  },
  dismiss(m) { const { F, db } = this; return F.deleteDoc(F.doc(db, 'users', this.user.uid, 'inbox', m.id)).catch((e) => this.fail(e)); },
};
const msgKey = (m) => `${m.from}|${m.type}|${m.room || ''}`;
const tsMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
function inviteFresh(m) { const t = tsMs(m.ts); return !t || Date.now() - t < INVITE_TTL; }
function friendOnline(uid) { const p = Cloud.fprof.get(uid); return !!p && Date.now() - tsMs(p.lastSeen) < 150000; }
function safeImg(u) { return /^https:\/\/[^\s"'<>]+$/.test(u || '') ? u : ''; }
function avatar(u, cls = 'fr-av') { const s = safeImg(u); return s ? `<img class="${cls}" src="${esc(s)}" alt="" referrerpolicy="no-referrer">` : `<span class="${cls}"></span>`; }
function ago(ms) {
  if (!ms) return 'Not seen yet';
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? `Last on ${Math.max(1, m)} min ago` : m < 1440 ? `Last on ${Math.round(m / 60)} h ago` : `Last on ${Math.round(m / 1440)} d ago`;
}
function cloudErrText(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/unauthorized-domain') return "This site isn't on the Firebase authorized domains list yet (see the README).";
  if (c === 'auth/network-request-failed' || c === 'unavailable') return 'Network problem. Check your connection.';
  if (c === 'permission-denied' || c === 'firestore/permission-denied') return 'The server refused that. Make sure the Firestore rules from firestore.rules are published.';
  return (e && e.message) || 'Something went wrong.';
}

// ------------------------------------------------------------------- UI ----
const G_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.2z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6C6.6 42.6 14.6 48 24 48z"/></svg>';
const signInBtn = (label = 'Sign in with Google') => `<button class="gbtn" data-act="signin">${G_LOGO}${label}</button>`;
function renderAccount() {
  const el = $('acct'); if (!el) return;
  const C = Cloud;
  if (C.state === 'ready' && C.user) el.innerHTML = `${avatar(C.user.photoURL)}<span class="who">${esc(C.user.displayName || 'Signed in')}</span><button class="ghost fr-mini" data-act="signout">Sign out</button>`;
  else if (C.state === 'ready') el.innerHTML = signInBtn();
  else el.innerHTML = '';
  const n = C.inbox.filter((m) => m.type !== 'invite' || inviteFresh(m)).length;
  $('frBadge').innerHTML = n ? `<span class="dot">${n}</span>` : '';
  const on = C.friends.filter((f) => friendOnline(f.uid)).length;
  $('frSub').textContent = C.state === 'off' ? 'Accounts not set up yet' : C.state !== 'ready' ? (C.state === 'loading' ? 'Loading…' : 'Unavailable') : !C.user ? 'Sign in to add friends' : C.friends.length ? `${on} of ${C.friends.length} online` : 'Add friends with a code';
}
function renderFriends() {
  if ($('friendsScreen').classList.contains('hidden')) return;
  // don't rebuild the panel under someone typing a code; catch up when they leave the box
  if (document.activeElement && document.activeElement.id === 'frAddCode') { renderFriends.later = true; return; }
  renderFriends.later = false;
  const C = Cloud, body = $('frBody');
  const err = C.err ? `<p class="fr-note bad">${esc(C.err)}</p>` : '';
  if (C.state === 'off') {
    body.innerHTML = `<p class="fr-note">Google sign-in isn't set up for this copy of the game yet, so friends and cloud saves are off. Your rosters are still saved on this device.</p><p class="fr-note">Running your own copy? Add your Firebase config to <b>firebase-config.js</b>; the README walks through it in about five minutes.</p>`;
    return;
  }
  if (C.state !== 'ready') { body.innerHTML = `<p class="fr-note">${C.state === 'loading' ? 'Loading…' : esc(C.err || 'Sign-in is unavailable right now.')}</p>`; return; }
  if (!C.user) { body.innerHTML = `${err}<p class="fr-note">Sign in with Google to save your rosters to your account, add friends, and invite them to a 1v1.</p><div>${signInBtn()}</div>`; return; }
  if (!C.profile) { body.innerHTML = `${err}<p class="fr-note">Setting up your account…</p>`; return; }
  const inbox = C.inbox.filter((m) => m.type !== 'invite' || inviteFresh(m));
  const isFriend = (uid) => C.friends.some((f) => f.uid === uid);
  const reqs = inbox.map((m) => `<div class="fr-row">${avatar(m.photo)}<span class="nm">${esc(m.name || 'A player')}<small>${m.type === 'invite' ? 'invited you to a 1v1' : 'added you as a friend'}</small></span>`
    + (m.type === 'invite' ? `<button class="cta fr-mini" data-act="join" data-id="${esc(m.id)}">JOIN</button>` : isFriend(m.from) ? '' : `<button class="ghost fr-mini" data-act="accept" data-id="${esc(m.id)}">Add back</button>`)
    + `<button class="ghost fr-mini" data-act="dismiss" data-id="${esc(m.id)}">Dismiss</button></div>`).join('');
  const sorted = [...C.friends].sort((a, b) => friendOnline(b.uid) - friendOnline(a.uid) || String(a.name).localeCompare(String(b.name)));
  const friends = sorted.map((f) => {
    const p = C.fprof.get(f.uid) || f, live = friendOnline(f.uid);
    return `<div class="fr-row"><i class="fr-on ${live ? 'live' : ''}"></i>${avatar(p.photo)}<span class="nm">${esc(p.name || 'Player')}<small>${live ? 'Online now' : ago(tsMs(p.lastSeen))}</small></span>`
      + `<button class="cta fr-mini" data-act="invite" data-uid="${esc(f.uid)}">INVITE TO 1V1</button><button class="ghost fr-mini" data-act="remove" data-uid="${esc(f.uid)}" title="Remove friend">&times;</button></div>`;
  }).join('');
  const add = $('frAddCode') ? $('frAddCode').value : '';
  body.innerHTML = `${err}
    <div class="fr-sec"><h3>YOUR FRIEND CODE</h3><div class="fr-row"><span class="fr-code">${esc(C.profile.code)}</span><button class="ghost fr-mini" data-act="copy">Copy</button></div><p class="fr-note">Give this to a friend so they can add you.</p></div>
    <div class="fr-sec"><h3>ADD A FRIEND</h3><div class="fr-row"><input id="frAddCode" maxlength="6" placeholder="CODE" autocomplete="off" spellcheck="false" aria-label="Friend code" value="${esc(add)}"><button class="ghost" data-act="add">Add</button></div><p class="fr-note" id="frAddMsg"></p></div>
    ${reqs ? `<div class="fr-sec"><h3>REQUESTS &amp; INVITES</h3>${reqs}</div>` : ''}
    <div class="fr-sec"><h3>FRIENDS (${C.friends.length})</h3>${friends || '<p class="fr-note">No friends yet. Add one with their code.</p>'}</div>`;
}
// invite list in the online lobby while you're hosting
function renderNetFriends() {
  const el = $('netFriends'); if (!el) return;
  const C = Cloud, show = NET.role === 'host' && !NET.open && NET.code && C.user && C.friends.length;
  if (!show) { el.innerHTML = ''; return; }
  const list = [...C.friends].sort((a, b) => friendOnline(b.uid) - friendOnline(a.uid)).slice(0, 8);
  el.innerHTML = '<div class="net-or">or invite a friend</div>' + list.map((f) => {
    const p = C.fprof.get(f.uid) || f, sent = NET.invited && NET.invited.has(f.uid);
    return `<div class="fr-row"><i class="fr-on ${friendOnline(f.uid) ? 'live' : ''}"></i><span class="nm">${esc(p.name || 'Player')}</span><button class="ghost fr-mini" data-act="invite" data-uid="${esc(f.uid)}" ${sent ? 'disabled' : ''}>${sent ? 'Invited' : 'Invite'}</button></div>`;
  }).join('');
}
function cloudRender() { renderAccount(); renderFriends(); renderNetFriends(); }
function openFriends() { $('friendsScreen').classList.remove('hidden'); renderFriends(); }
function closeFriends() { $('friendsScreen').classList.add('hidden'); }
// invite a friend: host a room first if you aren't already, then send them the code
async function inviteFriend(uid) {
  if (!Cloud.user || !uid) return;
  if (!(NET.role === 'host' && NET.code && NET.peerOpen)) {
    closeFriends();
    if (G.mode !== 'menu') toMenu();
    menu.mode = 'online'; NET.pendingInvite = uid;
    if (NET.role !== 'host') netHost(); else renderMenu();
    return;
  }
  try {
    await Cloud.send(uid, { type: 'invite', room: NET.code });
    (NET.invited = NET.invited || new Set()).add(uid);
    const f = Cloud.friends.find((x) => x.uid === uid);
    netStatus(`Invite sent to ${(f && f.name) || 'your friend'}. Waiting for them to join…`, 'good');
  } catch (e) { Cloud.fail(e); }
  cloudRender();
}
// the room opened (60-net): send an invite that was waiting on it
function netRoomOpened() { if (NET.pendingInvite) { const uid = NET.pendingInvite; NET.pendingInvite = null; inviteFriend(uid); } }
function joinInvite(m) {
  hideToast(); closeFriends();
  if (!m || !m.room) return;
  if (Cloud.user) Cloud.dismiss(m);
  if (G.mode !== 'menu') toMenu();
  menu.mode = 'online'; $('joinCode').value = m.room; renderMenu();
  netJoin(m.room);
}
let toastT = 0;
function inviteToast(m) {
  const el = $('toast');
  el.innerHTML = `${avatar(m.photo)}<span class="t-msg"><b>${esc(m.name || 'A friend')}</b> invited you to a 1v1</span><button class="cta fr-mini" data-act="join" data-id="${esc(m.id)}">JOIN</button><button class="ghost fr-mini" data-act="later">Later</button>`;
  el.classList.remove('hidden');
  SND.init(); if (SND.ctx) SND.tick();
  clearTimeout(toastT); toastT = setTimeout(hideToast, 30000);
}
function hideToast() { $('toast').classList.add('hidden'); }
function buildCloudUI() {
  $('btnFriends').addEventListener('click', openFriends);
  $('frClose').addEventListener('click', closeFriends);
  const onAct = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, C = Cloud, msg = () => C.inbox.find((m) => m.id === b.dataset.id);
    if (act === 'signin') C.signIn();
    else if (act === 'signout') C.signOut();
    else if (act === 'later') hideToast();
    else if (act === 'join') joinInvite(msg());
    else if (act === 'dismiss') { const m = msg(); if (m) C.dismiss(m); }
    else if (act === 'accept') { const m = msg(); if (m) { try { await C.befriend(m.from, m); await C.dismiss(m); } catch (err) { C.fail(err); } } }
    else if (act === 'invite') inviteFriend(b.dataset.uid);
    else if (act === 'remove') {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Remove?'; setTimeout(() => { b.dataset.sure = ''; b.innerHTML = '&times;'; }, 3000); return; }
      C.removeFriend(b.dataset.uid).catch((err) => C.fail(err));
    } else if (act === 'copy') {
      try { await navigator.clipboard.writeText(C.profile.code); b.textContent = 'Copied'; } catch (err) { b.textContent = 'Copy failed'; }
    } else if (act === 'add') {
      const out = $('frAddMsg');
      out.className = 'fr-note'; out.textContent = 'Looking…';
      try { const name = await C.addFriend($('frAddCode').value); $('frAddCode').value = ''; renderFriends(); const o = $('frAddMsg'); o.className = 'fr-note good'; o.textContent = `Added ${name}. They'll get a request to add you back.`; }
      catch (err) { out.className = 'fr-note bad'; out.textContent = err.code ? cloudErrText(err) : err.message; }
    }
  };
  for (const id of ['frBody', 'acct', 'toast', 'netFriends']) $(id).addEventListener('click', onAct);
  $('frBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'frAddCode') $('frBody').querySelector('[data-act="add"]').click(); });
  $('frBody').addEventListener('focusout', () => setTimeout(() => { if (renderFriends.later) renderFriends(); }, 300));
  setInterval(() => { if (Cloud.user) cloudRender(); }, 30000);   // presence dots age out
  Cloud.init();
}
