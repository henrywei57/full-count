// ============================================================================
// Game flow: innings, at-bats, pitching & hitting (user + CPU), results
// ============================================================================

const G = {
  mode: 'menu', phase: 'boot', now: 0, pt: 0, dur: 0, paused: false, ff: 1,
  teams: null, user: -1, diff: DIFFS[1], innings: 3, cfg: null,
  inning: 1, half: 0, outs: 0, balls: 0, strikes: 0,
  score: [0, 0], line: [[], []], hits: [0, 0], errs: [0, 0],
  bases: [null, null, null, null], order: [0, 0], pitcher: [null, null], pen: [0, 0],
  stats: new Map(), pstats: new Map(),
  fielders: [], fByRole: {}, baseRunners: [], batter: null, batSide: 'R', batterModel: null, batPrm: null,
  umps: [], P: null, spec: null, swing: null, cpu: null, play: null, bb: null, cross: null,
  abPitches: [], pitchUI: { state: 'aim', sel: 0, aim: { x: 0, y: 2.5 }, meter: 0, power: 0, acc: 0, t0: 0 },
  pci: { x: 0, y: 2.5 }, glove: new V3(0, 2.4, 1.7), rec: [], recOn: false, replay: null, derby: null,
  abEnd: null, contactT: 0, menuAng: 0,
  ctrl: ['cpu', 'cpu'], lock: null, remoteIn: { x: 0, z: 0 }, remoteTake: false, camFocus: null, localPitch: false,
  ump: 1, challenges: [2, 2], challengeable: null, challenge: null, cpuChallengeAt: 0, view: 0, lockSide: 1, lockSkip: false, skipping: false, lockInv: false, beat: 0,
};
const battingTeam = () => G.teams[G.half];
const fieldingTeam = () => G.teams[1 - G.half];
const curPitcher = () => G.pitcher[1 - G.half];
// Who controls what: each side is 'local' (this device), 'remote' (online opponent) or 'cpu'.
// Player Lock narrows a side's control to one player.
// Player Lock "skip": the CPU plays your part until the next batter
const sideCtrl = (s) => (!G.ctrl ? 'cpu' : G.simAB && s === G.lockSide ? 'cpu' : G.ctrl[s]);
// Practice drills (G.drill) hand one job to you and give the rest to the CPU.
function batCtrl() {
  if (!G.teams || !G.batter || G.drill === 'run' || G.drill === 'field') return 'cpu';
  const c = sideCtrl(G.half);
  if (c === 'cpu' || (G.lock && G.batter.id !== G.lock)) return 'cpu';
  return c;
}
function pitchCtrl() {
  if (!G.teams || G.mode === 'derby' || G.drill === 'field' || G.drill === 'run' || G.drill === 'bat') return 'cpu';
  const c = sideCtrl(1 - G.half), p = curPitcher();
  if (c === 'cpu' || (G.lock && (!p || p.id !== G.lock))) return 'cpu';
  return c;
}
function fieldCtrl() {
  if (!G.teams || G.mode === 'derby' || G.drill === 'pitch' || G.drill === 'run' || G.drill === 'bat') return 'cpu';
  const c = sideCtrl(1 - G.half);
  if (c === 'cpu' || (G.lock && (G.lockFieldSim || !(G.fielders || []).some((f) => f.pl.id === G.lock)))) return 'cpu';
  return c;
}
function runCtrl() { if (!G.teams || G.mode === 'derby' || G.drill === 'pitch' || G.drill === 'field') return 'cpu'; return sideCtrl(G.half); }
const userBats = () => batCtrl() === 'local';
const userPitches = () => pitchCtrl() === 'local';
const userFields = () => fieldCtrl() === 'local';
const userRuns = () => runCtrl() === 'local';
const localSide = () => (G.ctrl ? G.ctrl.indexOf('local') : -1);
function setPhase(name, dur = 0) { G.phase = name; G.pt = 0; G.dur = dur; }
function bstat(pl) { if (!G.stats.has(pl.id)) G.stats.set(pl.id, { pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0, sb: 0, cs: 0 }); return G.stats.get(pl.id); }
function pstat(pl) { if (!G.pstats.has(pl.id)) G.pstats.set(pl.id, { outs: 0, h: 0, r: 0, bb: 0, k: 0, pc: 0, hr: 0 }); return G.pstats.get(pl.id); }
function pitchLimit(p) { return p.pos === 'SP' ? p.stam + 12 : p.stam * 0.75; }
function fatigue(p) { if (G.drill) return 0; const L = pitchLimit(p), pc = pstat(p).pc; return clamp((pc - 0.7 * L) / (0.5 * L), 0, 1); }

// ---------------------------------------------------------------- models ----
const modelOf = new Map();
function kitFor(team, home) {
  return home
    ? { jersey: '#f2f2ee', pants: '#ecebe6', trim: team.c1, cap: team.c1, sock: team.c1, numFill: team.c1, numStroke: '#f2f2ee' }
    : { jersey: team.c1, pants: '#a7acb5', trim: team.c1, cap: team.c1, sock: team.c1, numFill: team.c2, numStroke: team.c1 };
}
function getModel(pl, kind) {
  const home = G.teams[1] === pl.team;
  // a custom roster can change between games (new number, new look), so its version is part of the key
  const key = pl.id + (home ? 'H' : 'A') + (kind || '') + (pl.team.ver || '');
  if (modelOf.has(key)) return modelOf.get(key);
  const m = makePlayer({ ...kitFor(pl.team, home), skin: pl.skin, num: pl.num, lefty: pl.throws === 'L', kind });
  m.pl = pl; m.key = `${pl.id}|${home ? 'H' : 'A'}|${kind || ''}`;
  modelOf.set(key, m);
  return m;
}
function makeUmps() {
  const o = { jersey: '#1c2536', pants: '#5a606b', trim: '#1c2536', cap: '#101318', sock: '#111', skin: '#e3b08c', kind: 'ump' };
  G.umps = [makePlayer(o), makePlayer({ ...o, skin: '#a96c48' }), makePlayer({ ...o, skin: '#f1c7a5' })];
  G.umps.forEach((u, i) => (u.key = 'U' + i));
}

// ----------------------------------------------------------- field setup ----
function setupFielders() {
  const team = fieldingTeam();
  G.fielders = ROLES.map((role) => {
    const pl = role === 'P' ? curPitcher() : team.hitters.find((h) => h.pos === role);
    const f = new Fielder(pl, role, getModel(pl, role === 'C' ? 'catcher' : undefined));
    f.setHome(...ROLE_POS[role]);
    return f;
  });
  G.fByRole = Object.fromEntries(G.fielders.map((f) => [f.role, f]));
}
function applyAlignment() {
  const pull = G.batSide === 'R' ? -1 : 1;
  const infieldIn = G.bases[3] && G.outs < 2 && G.inning >= G.innings - 1 && Math.abs(G.score[0] - G.score[1]) <= 1;
  for (const f of G.fielders) {
    let [x, z] = ROLE_POS[f.role];
    if (f.isOF || f.role === 'SS' || f.role === '2B') {
      const r = Math.hypot(x, z), th = Math.atan2(x, -z) + pull * (f.isOF ? 6 : 4) * DEG;
      x = r * Math.sin(th); z = -r * Math.cos(th);
    }
    if (infieldIn && !f.isOF && f.role !== 'P' && f.role !== 'C') { const r = Math.hypot(x, z), k = (r - 22) / r; x *= k; z *= k; }
    if (G.bases[1] && f.role === '1B' && !G.bases[2]) { x = 60; z = -70; }
    f.setHome(x, z);
  }
}
function placeForPitch() {
  for (const m of MODELS) m.root.visible = false;
  const derby = G.mode === 'derby';
  for (const f of G.fielders) {
    f.snapHome();
    if (derby && f.role !== 'P' && f.role !== 'C') continue;
    f.m.root.visible = true; f.m.fielding = true;
    if (f.role === 'P') { f.yaw = 0; f.anim('set'); }
    else if (f.role === 'C') { f.face(0, MOUND_Z); f.anim('catcher', { glove: G.glove }); }
    else { f.face(0, -20); f.anim('ready'); }
    f.sync();
  }
  // umpires
  const side = G.batSide === 'R' ? -1 : 1;
  const [hu, u1, u3] = G.umps;
  hu.root.visible = true; hu.root.position.set(side * 1.6, 0, 6.6); hu.root.rotation.y = Math.PI; setAnim(hu, 'ump', {});
  if (!derby) {
    u1.root.visible = true; u1.root.position.set(80, 0, -50); u1.root.rotation.y = Math.atan2(-80, -10); setAnim(u1, 'ump', {});
    u3.root.visible = true; u3.root.position.set(-80, 0, -50); u3.root.rotation.y = Math.atan2(80, -10); setAnim(u3, 'ump', {});
  }
  // batter
  const bm = G.batterModel;
  bm.root.visible = true; bm.fielding = false; bm.batsL = G.batSide === 'L'; setHelmet(bm, true);
  bm.root.position.set(side * 3.0, 0, 0.2); bm.root.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  G.batPrm = { m: G.batSide === 'R' ? 1 : -1, swingT: null, dur: 0.36, hc: 3.2, hzc: 0.85, elc: -0.08, bunt: false };
  setAnim(bm, 'bat', G.batPrm);
  // runners take their leads
  G.baseRunners = [];
  for (let b = 1; b <= 3; b++) {
    const pl = G.bases[b]; if (!pl) continue;
    const m = getModel(pl); m.root.visible = true; m.fielding = false; m.batsL = pl.bats === 'L'; setHelmet(m, true);
    const r = new Runner(pl, m, b); G.baseRunners.push(r);
    setAnim(m, 'ready'); r.sync(new V3(0, 0, -60));
  }
}
function batGeom(x, y) {
  const m = G.batSide === 'R' ? 1 : -1;
  const elc = clamp((y - 2.6) * 0.35, -0.55, 0.2) - 0.08;
  return { elc, hc: clamp(y - Math.sin(elc) * 2.2, 2.3, 4.6), hzc: clamp(3.0 + m * x - 2.2 * Math.cos(elc), 0.3, 1.7) };
}

// ------------------------------------------------------------ game start ----
function startGame(cfg) {
  G.cfg = cfg;
  G.mode = cfg.mode; G.diff = DIFFS[cfg.diff ?? 1]; G.innings = cfg.innings || 3;
  // cfg.teams = [away, home] as team specs (built-in key or a whole custom roster)
  const specs = distinctSpecs(...(cfg.teams || [{ b: TEAMS[cfg.away || 0].key }, { b: TEAMS[cfg.home ?? 3].key }]));
  const away = teamFromSpec(specs[0]), home = teamFromSpec(specs[1]);
  G.teams = cfg.mode === 'derby' ? [home, away] : [away, home];
  // practice: your team is the home pick; it bats in the batting and baserunning drills
  G.drill = cfg.mode === 'practice' || cfg.mode === 'tutorial' ? (DRILLS[cfg.drill] ? cfg.drill : 'bat') : null;
  G.tutRunners = !!cfg.tutRunners;
  const youBat = G.drill === 'bat' || G.drill === 'run';
  if (G.drill && youBat) G.teams = [home, away];
  if (G.drill) G.innings = 99;
  // look players up by id (lock, online, HUD); a custom team's players are only registered for the game they play in
  for (const t of G.teams) for (const p of [...t.hitters, ...t.pitchers]) PBYID[p.id] = p;
  G.lock = null;
  if (cfg.mode === 'exhibition' || cfg.mode === 'lock') { G.ctrl = ['cpu', 'cpu']; G.ctrl[cfg.side] = 'local'; }
  else if (cfg.mode === 'derby') G.ctrl = ['local', 'cpu'];
  else if (cfg.mode === 'online') { G.ctrl = ['remote', 'remote']; G.ctrl[cfg.guest ? 1 - cfg.side : cfg.side] = 'local'; }
  else if (G.drill) G.ctrl = youBat ? ['local', 'cpu'] : ['cpu', 'local'];
  else G.ctrl = ['cpu', 'cpu'];
  if (cfg.mode === 'lock') {
    const team = G.teams[cfg.side], pick = cfg.lockPick || 'h3';
    G.lock = pick[0] === 'p' ? team.pitchers[0].id : team.lineup[+pick.slice(1)].id;
  }
  settings.manual = cfg.manual == null ? true : !!cfg.manual;
  G.ump = cfg.ump ?? 1; G.challenges = [2, 2]; G.challengeable = null; G.challenge = null; G.cpuChallengeAt = 0;
  G.view = cfg.mode === 'lock' ? cfg.view ?? 2 : 0; G.lockSide = cfg.side ?? 1; G.simAB = false; G.lockFieldSim = cfg.mode === 'lock' && cfg.lockField === 0;
  G.lockSkip = cfg.mode === 'lock' && cfg.lockSkip !== 0; G.skipping = false; G.lockInv = false; G.beat = 0;
  Object.assign(G, { remotePos: null, potg: null, inning: 1, half: 0, outs: 0, balls: 0, strikes: 0, score: [0, 0], line: [[], []], hits: [0, 0], errs: [0, 0], bases: [null, null, null, null], order: [0, 0], pen: [0, 0], ff: 1, paused: false, replay: null, play: null, abEnd: null, postNext: null, cpuPick: null, abPicks: 0 });
  G.prac = { pitches: 0, strikes: 0, swings: 0, contact: 0, evSum: 0, evN: 0, hits: 0, hr: 0, k: 0, bb: 0, sb: 0, cs: 0, runs: 0, picked: 0, chances: 0, outs: 0, errors: 0, allowed: 0 };
  G.stats = new Map(); G.pstats = new Map();
  G.pitcher = [G.teams[0].pitchers[0], G.teams[1].pitchers[0]];
  for (const m of MODELS) m.root.visible = false;
  setCrowdColors(G.teams[1], G.teams[0]);
  hudTeams();
  showScreen(null);
  $('hud').classList.remove('hidden');
  $('bug').classList.toggle('hidden', G.mode === 'derby');
  $('derbyHud').classList.toggle('hidden', G.mode !== 'derby');
  $('tracker').classList.toggle('hidden', G.mode === 'derby' || G.mode === 'tutorial');
  $('lockTag').classList.toggle('hidden', G.mode !== 'lock');
  $('pracHud').classList.toggle('hidden', !G.drill || G.mode === 'tutorial'); $('hud').classList.toggle('prac', !!G.drill && G.mode !== 'tutorial'); $('hud').classList.toggle('tut', G.mode === 'tutorial');
  hudPrac();
  SND.init();
  if (G.mode === 'online' && cfg.guest) { guestStart(); return; }
  if (G.mode === 'derby') {
    const team = G.teams[0];
    G.derby = { hr: 0, outs: 10, longest: 0, swings: 0, batter: team.lineup[cfg.batter] || team.lineup[3] };
    G.pitcher[1] = G.teams[1].pitchers[3];
    setupFielders();
    hudDerby();
    Caster.line(`Welcome to the Home Run Derby. ${G.derby.batter.name} steps in with ten outs to work with.`);
    SND.charge();
    newBatter();
    return;
  }
  if (G.mode === 'lock') {
    const me = PBYID[G.lock];
    Caster.line(`Player Lock: you are ${me.name}. The rest of the game sims until you are involved.`);
  } else if (G.drill) { if (G.mode !== 'tutorial') Caster.line(DRILLS[G.drill].intro, false); }
  else Caster.line(`Good evening and welcome to the ballpark. The ${G.teams[0].name} visit the ${G.teams[1].name} tonight.`);
  hudLock();
  startHalf();
}
function startHalf() {
  G.outs = 0; G.balls = 0; G.strikes = 0; G.bases = [null, null, null, null]; G.selRunner = null;
  while (G.line[G.half].length < G.inning) G.line[G.half].push(0);
  if (G.inning > G.innings) {
    const t = battingTeam(); G.bases[2] = t.lineup[(G.order[G.half] + 8) % 9];
  }
  setupFielders();
  hudScore(); hudCount();
  const title = G.mode === 'tutorial' ? 'TUTORIAL' : G.drill ? DRILLS[G.drill].name.toUpperCase() : `${G.half ? 'BOTTOM' : 'TOP'} OF THE ${ordinal(G.inning).toUpperCase()}`;
  hudBanner(title, G.drill ? 'Practice · quit from the pause menu' : `${battingTeam().city} ${battingTeam().name} batting`, '');
  if (G.inning > G.innings) Caster.line(`Extra innings. ${shortName(G.bases[2].name)} starts at second base.`, true, { queue: true });
  setPhase('halfIntro', G.mode === 'spectate' ? 1.8 : 2.6);
  G.batter = battingTeam().lineup[G.order[G.half] % 9];
  G.batSide = sideFor(G.batter);
  G.batterModel = getModel(G.batter);
  applyAlignment();
  placeForPitch();
  hudBatter(); hudPitcher();
  wideCam(true);
  drawBoards();
}
function sideFor(pl) { const p = curPitcher(); return pl.bats === 'S' ? (p.throws === 'R' ? 'L' : 'R') : pl.bats; }
function maybePitchingChange() {
  if (G.mode === 'derby') return false;
  const ti = 1 - G.half, p = curPitcher();
  if (fatigue(p) < 0.6 || G.pen[ti] >= 3) return false;
  if (G.lock === p.id && fatigue(p) < 0.97) return false;
  bringReliever(ti);
  return true;
}
function bringReliever(ti) {
  const team = G.teams[ti];
  if (G.pen[ti] >= 3) return false;
  G.pen[ti]++;
  const np = team.pitchers[G.pen[ti]];
  G.pitcher[ti] = np;
  if (ti === 1 - G.half) {
    const f = new Fielder(np, 'P', getModel(np)); f.setHome(...ROLE_POS.P);
    G.fielders[0] = f; G.fByRole.P = f;
  }
  hudBanner('PITCHING CHANGE', `${np.name} in from the bullpen`, '');
  Caster.line(`There's a pitching change. ${np.name} comes in from the bullpen for the ${team.name}.`);
  return true;
}
function newBatter() {
  const team = battingTeam();
  const pl = G.mode === 'derby' ? G.derby.batter : team.lineup[G.order[G.half] % 9];
  maybePitchingChange();
  G.batter = pl; G.balls = 0; G.strikes = 0; G.abPitches = []; G.abEnd = null; G.simAB = false; G.lockInv = false; G.abPicks = 0;
  G.batSide = sideFor(pl);
  G.batterModel = getModel(pl);
  applyAlignment();
  hudBatter(); hudPitcher(); hudCount(); drawTracker(); drawBoards();
  if (G.mode !== 'derby' && Math.random() < 0.8) SND.say(`Now batting, ${pl.pos === 'DH' ? 'the designated hitter' : ''} number ${pl.num}, ${pl.name}.`, { queue: true, rate: 1.0, pitch: 0.85 });
  enterPrePitch();
}

// ------------------------------------------------------------- pitching ----
function enterPrePitch() {
  setPhase('prePitch');
  G.P = null; G.swing = null; G.cpu = null; G.play = null; G.bb = null; G.call = null; G.remoteTake = false; G.challengeable = null; G.cpuPick = null;
  if ((G.drill === 'run' || G.tutRunners) && !G.abPitches.length && !G.bases[1] && !G.bases[2] && !G.bases[3]) practiceRunners();
  placeForPitch();
  ballMesh.visible = false; ballShadow.visible = false; trailReset(); pitchGuide.visible = false;
  hideFeedback();
  G.spec = null;
  if (pitchCtrl() === 'cpu') {
    G.spec = G.mode === 'derby' ? derbyPitch() : cpuChoosePitch();
    G.cpuPitchAt = G.mode === 'spectate' ? rand(0.6, 1.0) : G.mode === 'derby' ? rand(0.9, 1.3) : rand(1.0, 1.7);
    G.glove.set(G.spec.aim.x * 0.6, clamp(G.spec.aim.y, 1.6, 3.2), 1.7);
    if (G.drill !== 'field') cpuPickoff();
  }
  cpuSteals();
  if (G.drill === 'field') G.fungoAt = rand(1.0, 1.6);
  prePitchUI();
  G.rec = []; G.recOn = true;
}
// per-device presentation for a new pitch (also used by an online guest)
function prePitchUI() {
  const up = userPitches(), ub = userBats();
  FL.mode = 'track';
  zoneGroup.visible = settings.zone && (ub || up);
  zoneGroup.getObjectByName('grid').visible = up;
  pci.visible = ub; reticle.visible = up; pitchGuide.visible = false;
  pitchMark.visible = pitchMark.visible && ub;
  $('meter').classList.toggle('hidden', !up);
  $('throwPrompt').classList.add('hidden'); runnerHUD(false);
  ctrlRing.visible = false; landMark.visible = false;
  if (up) {
    const U = G.pitchUI, n = curPitcher().pitches.length;
    U.state = 'aim'; U.meter = 0; U.power = 0; U.sel = Math.min(U.sel, n - 1);
    reticleMat.color.set(PITCH_TYPES[curPitcher().pitches[U.sel].type].col);
    meterDraw();
    const on = G.bases.some(Boolean) && G.mode !== 'derby';
    setHint('<kbd>1</kbd>–<kbd>' + n + '</kbd> pitch &middot; aim with the mouse &middot; <kbd>Click</kbd> to start the meter' + (on ? ' &middot; <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>3</kbd> pickoff' : ''));
  } else if (ub) setHint('Aim the PCI &middot; <kbd>Click</kbd> swing &middot; <kbd>Right-click</kbd> power &middot; <kbd>J</kbd> contact &middot; <kbd>B</kbd> bunt' + (G.bases.some(Boolean) && userRuns() && G.mode !== 'derby' ? ' &middot; <kbd>E</kbd> steal' : ''));
  else if (userRuns() && G.bases.some(Boolean)) setHint('You run the bases &middot; <kbd>E</kbd> steal &middot; <kbd>Q</kbd> call it off &middot; click a runner\'s tag to pick just him');
  else if (G.drill === 'field') setHint('Fielding practice &middot; <kbd>WASD</kbd> move &middot; <kbd>1</kbd>&ndash;<kbd>4</kbd> throw');
  else if (G.mode === 'online') setHint('Waiting for your opponent&hellip;');
  else if (G.mode === 'lock' && G.half === 1 - G.lockSide && G.fielders.some((f) => f.pl.id === G.lock)) setHint('You are in the field &middot; get within the gold ring of the ball to field it');
  else setHint(G.mode === 'lock' ? (G.simAB ? 'Skipping to the next batter&hellip;' : 'Simulating until you are up&hellip;') : '');
  if (up) pitchCam(G.prevCam !== 'pitch'); else if (ub) batCam(G.prevCam !== 'bat'); else cfCam(G.prevCam !== 'cf');
  hudPitcher();
}
function cpuChoosePitch() {
  const p = curPitcher(), b = G.balls, s = G.strikes, ars = p.pitches;
  const w = ars.map((pt) => {
    let x;
    if (FASTBALLS.has(pt.type)) x = 1.6 + (b - s) * 0.35 + (b === 3 ? 1.2 : 0);
    else if (BREAKING.has(pt.type)) x = 0.95 + (s === 2 ? 0.7 : 0) - (b === 3 ? 0.4 : 0);
    else x = 0.8 + (s === 2 ? 0.45 : 0);
    if (G.abPitches.length && G.abPitches[G.abPitches.length - 1].type === pt.type) x *= 0.7;
    return Math.max(0.1, x);
  });
  let r = Math.random() * w.reduce((a, c) => a + c, 0), idx = 0;
  for (; idx < w.length - 1; idx++) { r -= w[idx]; if (r <= 0) break; }
  const pitch = ars[idx], fast = FASTBALLS.has(pitch.type);
  const zoneP = clamp(0.42 + (b - s) * 0.06 + (b === 3 ? 0.1 : 0) - (s === 2 && b < 2 ? 0.12 : 0), 0.22, 0.8);
  const away = G.batSide === 'R' ? 1 : -1;
  let x, y;
  if (Math.random() < zoneP) {
    x = rand(-0.6, 0.6); y = fast ? rand(1.9, 3.2) : rand(1.75, 2.7);
    if (Math.random() < 0.55) x = away * rand(0.3, 0.68) * (Math.random() < 0.7 ? 1 : -1);
  } else if (fast) {
    if (Math.random() < 0.5) { y = rand(3.6, 4.1); x = rand(-0.7, 0.7); }
    else { x = away * rand(0.95, 1.3) * (Math.random() < 0.7 ? 1 : -1); y = rand(1.8, 3.2); }
  } else { y = rand(0.95, 1.45); x = away * rand(0.3, 1.15) * (Math.random() < 0.75 ? 1 : -1); }
  if (G.mode === 'tutorial') { const a = { x, y }; tutPitchAim(a); x = a.x; y = a.y; }
  const sig = (0.15 + ((100 - p.ctl) / 100) * 0.42) * (batCtrl() !== 'cpu' ? G.diff.cpuCtl : 1) * (1 + fatigue(p) * 0.9);
  return { pitch, aim: { x, y }, target: { x: x + randn() * sig, y: y + randn() * sig * 0.85 }, power: rand(0.86, 1), q: rand(0.45, 0.9) };
}
function derbyPitch() {
  const p = curPitcher();
  const pitch = { type: 'FF', velo: 74 + Math.round(rand(-2, 2)), brk: 0.5 };
  const aim = { x: rand(-0.45, 0.45), y: rand(2.0, 3.0) };
  return { pitch, aim, target: { x: aim.x + randn() * 0.08, y: aim.y + randn() * 0.08 }, power: 0.9, q: 0.2, derby: true };
}
const ACC_LINE = 0.1;
function selectPitch(i) {
  if (!userPitches() || G.phase !== 'prePitch' || G.pitchUI.state !== 'aim') return;
  if (i < 0 || i >= curPitcher().pitches.length) return;
  G.pitchUI.sel = i; hudPitcher(); SND.tick();
  reticleMat.color.set(PITCH_TYPES[curPitcher().pitches[i].type].col);
}
function pitchPress() {
  const U = G.pitchUI;
  if (U.state === 'aim') { U.state = 'up'; U.t0 = G.now; U.meter = 0; SND.tick(); setHint('Click near the top for <b>power</b>'); }
  else if (U.state === 'up') { U.power = U.meter; U.state = 'down'; U.t0 = G.now; SND.tick(); setHint('Stop it on the <b>gold line</b>'); }
  else if (U.state === 'down') { U.acc = Math.abs(U.meter - ACC_LINE); finishUserPitch(); }
}
function updatePitchUI() {
  const U = G.pitchUI;
  if (U.state === 'up') {
    U.meter = (G.now - U.t0) * 1.25 * G.diff.meter;
    if (U.meter >= 1) { U.meter = 1; U.power = 1; U.state = 'down'; U.t0 = G.now; setHint('Stop it on the <b>gold line</b>'); }
  } else if (U.state === 'down') {
    U.meter = U.power - (G.now - U.t0) * 1.4 * G.diff.meter;
    if (U.meter < -0.16) { U.acc = 0.45; finishUserPitch(); }
  }
  reticle.position.set(U.aim.x, U.aim.y, 0);
  if (U.state === 'aim') G.glove.lerp(_tmpA.set(U.aim.x * 0.8, clamp(U.aim.y, 1.4, 3.6), 1.7), 0.15);
  meterDraw();
}
const _tmpA = new V3(), _tmpB = new V3();
function userPitchSpec(sel, aim, power, acc) {
  const p = curPitcher(), pitch = p.pitches[clamp(sel | 0, 0, p.pitches.length - 1)];
  const ctlF = (1.35 - (p.ctl / 100) * 0.6) * (1 + fatigue(p) * 0.8);
  const sig = (0.05 + acc * 2.2 + (power > 0.97 ? 0.07 : 0)) * ctlF;
  const target = { x: aim.x + randn() * sig, y: aim.y + randn() * sig * 0.9 };
  const q = clamp(1 - acc / 0.14, 0, 1) * (0.55 + 0.45 * clamp(power, 0, 1));
  return { pitch, aim: { x: aim.x, y: aim.y }, target, power: clamp(power, 0.3, 1), q };
}
function finishUserPitch() {
  const U = G.pitchUI; U.state = 'done';
  meterGrade(U.acc < 0.015 ? 'PERFECT' : U.acc < 0.04 ? 'GOOD' : U.acc < 0.09 ? 'OK' : 'POOR');
  setHint('');
  tutNote('pitch');
  if (NET.role === 'guest') { netSend({ t: 'act', a: 'pitch', sel: U.sel, aim: { ...U.aim }, power: U.power, acc: U.acc }); reticle.visible = false; return; }
  startWindup(userPitchSpec(U.sel, U.aim, U.power, U.acc));
}
function remotePitch(m) {
  if (G.phase !== 'prePitch' || pitchCtrl() !== 'remote') return;
  startWindup(userPitchSpec(m.sel, m.aim, m.power, m.acc));
}
function startWindup(spec) {
  G.spec = spec;
  setPhase('windup');
  const pm = G.fByRole.P.m;
  setAnim(pm, 'pitch', null);
  G.releaseAt = G.now + RELEASE_T;
  ballMesh.visible = true; pitchMark.visible = false;
  reticle.visible = false;
  for (const r of G.baseRunners) { r.leadVis = 12; }
  // anyone stealing goes on the pitcher's first move
  for (const r of [...G.baseRunners].sort((a, b) => b.base - a.base)) if (r.steal && !r.steal.went) { if (canSteal(r)) stealBreak(r, stealJump(r)); else r.steal = null; }
}
function updateWindup() {
  const pm = G.fByRole.P.m;
  handWorld(pm, pm.lefty ? 'L' : 'R', ballMesh.position);
  if (G.now >= G.releaseAt) releasePitch();
}
function releasePitch() {
  const pm = G.fByRole.P.m, p = curPitcher();
  applyPose(pm, 'pitch', RELEASE_T, null, 0);
  const rel = handWorld(pm, pm.lefty ? 'L' : 'R', new V3());
  rel.y = clamp(rel.y, 5.0, 6.9); rel.z = Math.min(rel.z, -53);
  const scale = G.mode === 'spectate' ? 1.05 : batCtrl() !== 'cpu' ? G.diff.pitchScale : 1.12;
  G.P = buildPitch(p, G.spec.pitch, G.spec.target, G.spec.power, scale, fatigue(p), rel);
  G.lastP = { mph: G.P.mph, type: G.P.type };
  G.pitchT0 = G.now;
  setPhase('pitch');
  G.tc = pitchTimeAtZ(G.P, CONTACT_Z); G.tPlate = pitchTimeAtZ(G.P, 0); G.tCatch = pitchTimeAtZ(G.P, CATCH_Z);
  const c = pitchPos(G.P, G.tPlate, new V3());
  G.cross = { x: c.x, y: c.y }; G.isStrike = inZone(c.x, c.y);
  const bx = G.batSide === 'R' ? -1 : 1;
  G.hbp = c.x * bx > 1.95 && c.x * bx < 4.3 && c.y > 0.7 && c.y < 5.4 && G.mode !== 'derby';
  pstat(p).pc++;
  if (batCtrl() === 'cpu') cpuDecideSwing();
  else if (G.swing && !G.swing.calc) G.swing.calc = calcUserContact(G.swing);
  trailReset();
  netPitchOut();
}
// easier hitting: a ring shows where the pitch will cross once it is part-way in
function updateGuide(t) {
  const g = G.diff.guide;
  pitchGuide.visible = !!(g && settings.guide && userBats() && G.cross && t >= G.tPlate * g && t < G.tCatch + 0.3);
  if (pitchGuide.visible) pitchGuide.position.set(G.cross.x, G.cross.y, 0.05);
}
function updatePitch(dt) {
  const t = G.now - G.pitchT0;
  pitchPos(G.P, Math.min(t, G.tCatch), ballMesh.position);
  G.glove.lerp(_tmpA.set(G.cross.x, clamp(G.cross.y - 0.05, 0.6, 4.6), 1.7), 1 - Math.exp(-dt * 9));
  updateGuide(t);
  const sw = G.swing;
  if (sw && !sw.done && sw.calc && !sw.calc.miss) {
    const at = clamp(sw.tContact, G.tc - 0.03, G.tc + 0.025);
    if (t >= at) { sw.done = true; contactUser(sw.calc, at); return; }
  }
  const cs = G.cpu;
  if (cs && cs.swing && cs.contact && !cs.done && t >= G.tc + cs.err) { cs.done = true; launch(cs.ev, cs.la, cs.spray, pitchPos(G.P, t, new V3()), cs.q, false); return; }
  if (t >= G.tCatch) {
    // an online batter decides on their own device; hold the ball until we hear back
    if (batCtrl() === 'remote' && !G.swing && !G.remoteTake && t < G.tCatch + 1.6) return;
    catchPitch();
  }
}

// ---------------------------------------------------------------- hitting ----
const SWING_DELAY = { contact: 0.135, normal: 0.15, power: 0.165, bunt: 0.12 };
function pciDims(type) {
  const b = G.batter, D = G.diff;
  const k = D.pci * (0.88 + (b.con / 100) * 0.24) * (type === 'contact' ? 1.15 : type === 'power' ? 0.82 : type === 'bunt' ? 1.3 : 1);
  return { w: 0.6 * k, h: 0.45 * k };
}
function userSwing(type) {
  if (!userBats() || G.swing) return;
  if (NET.role === 'guest') { if (!G.localPitch) return; }
  else {
    if (G.phase === 'windup' && G.releaseAt - G.now > 0.12) return;
    if (G.phase !== 'windup' && G.phase !== 'pitch') return;
  }
  if (G.mode === 'derby' && type === 'bunt') return;
  const tNow = G.phase === 'pitch' || G.localPitch ? G.now - G.pitchT0 : -(G.releaseAt - G.now);
  const delay = SWING_DELAY[type];
  if (type === 'power') tutNote('powerSwing');
  G.swing = { type, tPress: tNow, tContact: tNow + delay, pci: { x: G.pci.x, y: G.pci.y }, dims: pciDims(type), done: false };
  if (NET.role === 'guest') guestPrepSwing();
  const m = G.batterModel, prm = G.batPrm;
  Object.assign(prm, batGeom(G.pci.x, G.pci.y));
  if (type === 'bunt') { prm.bunt = true; prm.hc = G.pci.y; } else { prm.dur = delay / SWING_CONTACT; prm.swingT = G.now - m.t0; }
  if (G.P) G.swing.calc = calcUserContact(G.swing);
  if (NET.role === 'guest') netSend({ t: 'act', a: 'swing', type, tPress: tNow, pci: { ...G.swing.pci } });
}
function remoteSwing(m) {
  if (batCtrl() !== 'remote' || G.swing || !G.P || G.phase !== 'pitch') return;
  const delay = SWING_DELAY[m.type] || 0.15;
  G.swing = { type: m.type, tPress: m.tPress, tContact: m.tPress + delay, pci: m.pci, dims: pciDims(m.type), done: false, remote: true };
  const prm = G.batPrm;
  Object.assign(prm, batGeom(m.pci.x, m.pci.y));
  if (m.type === 'bunt') { prm.bunt = true; prm.hc = m.pci.y; } else { prm.dur = delay / SWING_CONTACT; prm.swingT = G.pitchT0 + m.tPress - G.batterModel.t0; }
  G.swing.calc = calcUserContact(G.swing);
}
function calcUserContact(sw) {
  const D = G.diff, b = G.batter;
  const ball = pitchPos(G.P, G.tc, new V3());
  const { w, h } = sw.dims;
  // swing assist: the barrel drifts toward a pitch that is close to the PCI
  let px = sw.pci.x, py = sw.pci.y;
  const A = D.assist || 0;
  if (A > 0 && Math.hypot((ball.x - px) / (w * 2), (ball.y - py) / (h * 2)) < 1) { px += (ball.x - px) * A; py += (ball.y - py) * A; }
  const dxr = ball.x - px, dyr = ball.y - py;
  const dn = Math.hypot(dxr / w, dyr / h);
  const e = sw.tContact - G.tc;
  const wmul = sw.type === 'power' ? 0.85 : sw.type === 'contact' ? 1.15 : 1;
  const [wp, wg, wo] = D.win.map((x) => x * wmul);
  const ae = Math.abs(e);
  const timing = ae <= wp ? 'PERFECT' : ae <= wg ? 'GOOD' : ae <= wo ? (e < 0 ? 'EARLY' : 'LATE') : e < 0 ? 'VERY EARLY' : 'VERY LATE';
  const res = { e, wo, timing, dn, ball, type: sw.type };
  if (sw.type === 'bunt') {
    if (dn > 1) return { ...res, miss: true, contact: 'MISSED' };
    const foul = Math.random() < 0.22 + dn * 0.3;
    return { ...res, timing: 'BUNT', miss: false, contact: 'BUNT', Q: 0.1, ev: rand(18, 32), la: rand(-28, 4), spray: foul ? (Math.random() < 0.5 ? -1 : 1) * rand(48, 75) : rand(-30, 30) };
  }
  if (dn > 1.12 || ae > wo * 1.3) return { ...res, miss: true, contact: dn > 1.12 ? 'MISSED' : 'WHIFF' };
  const tq = 1 - Math.pow(clamp(ae / (wo * 1.3), 0, 1), 1.4);
  const pq = 1 - Math.pow(clamp(dn, 0, 1), 1.7);
  const Q = clamp(tq * (0.32 + 0.68 * pq), 0, 1);
  const contact = Q > 0.82 ? 'SQUARED UP' : Q > 0.62 ? 'SOLID' : Q > 0.42 ? 'DECENT' : Q > 0.22 ? 'WEAK' : 'TIPPED';
  const pull = G.batSide === 'R' ? -1 : 1;
  const evMax = 95 + b.pow * 0.18 + (sw.type === 'power' ? 5 : sw.type === 'contact' ? -6 : 0) + (G.P.mph - 90) * 0.1;
  let ev = 45 + (evMax - 45) * (0.22 + 0.78 * Q) + randn() * 2.5;
  let la = 14 + (dyr / h) * 32 + (sw.type === 'power' ? 5 : sw.type === 'contact' ? -3 : 0) + randn() * 9 + (1 - pq) * randn() * 6;
  let spray = pull * (-e / wo) * 36 + ball.x * 9 + randn() * 6;
  if (G.mode === 'derby') { ev += 2; }
  if (Q < 0.18) { ev = rand(50, 72); la = rand(10, 45); spray = rand(150, 210); }
  return { ...res, miss: false, contact, Q, ev: clamp(ev, 35, 120), la: clamp(la, -45, 80), spray };
}
function cpuDecideSwing() {
  const b = G.batter, c = G.cross, q = G.spec.q ?? 0.6, vsUser = pitchCtrl() !== 'cpu', D = G.diff;
  const inZ = G.isStrike;
  const dx = Math.max(0, Math.abs(c.x) - ZONE.halfW), dy = Math.max(0, ZONE.bot - c.y, c.y - ZONE.top);
  const dOut = Math.hypot(dx, dy);
  const edgeIn = Math.min(ZONE.halfW - Math.abs(c.x), c.y - ZONE.bot, ZONE.top - c.y);
  const eye = b.eye * (vsUser ? D.cpuEye : 1);
  const PT = PITCH_TYPES[G.P.type];
  const moveMag = Math.hypot(PT.h, PT.v - 10) / 20;
  let ps;
  if (inZ) ps = edgeIn > 0.3 ? 0.74 : 0.58;
  else ps = Math.max(0, 0.64 - dOut * 0.55) * (1.35 - eye / 100) * (0.75 + q * 0.45) * (0.8 + moveMag * 0.3);
  if (G.strikes === 2) ps = inZ ? Math.min(0.95, ps + 0.2) : ps * 1.6;
  if (G.balls === 3 && G.strikes < 2) ps *= inZ ? 0.85 : 0.5;
  if (G.balls === 3 && G.strikes === 0) ps *= 0.2;
  if (G.balls === 0 && G.strikes === 0) ps *= 0.85;
  if (G.hbp) ps *= 0.1;
  const C = G.cnt; if (C) { C.n++; if (inZ) C.z++; if (inZ) C.zs += ps; else C.os += ps; }
  if (G.drill === 'run') ps = Math.min(0.95, ps * 1.5 + 0.12);   // baserunning drill: put the ball in play
  if (Math.random() >= ps) { G.cpu = { swing: false }; return; }
  let pc = 0.5 + (b.con / 100) * 0.38 - (inZ ? 0 : 0.2 + dOut * 0.35) - (G.P.mph - 92) * 0.012 - moveMag * 0.06 - q * 0.1 + (vsUser ? D.cpuBat : 0);
  if (edgeIn > 0.35) pc += 0.08;
  pc = clamp(pc + (G.drill === 'run' ? 0.15 : 0), 0.12, 0.95);
  const contact = Math.random() < pc;
  const delay = 0.15;
  const err = contact ? randn() * 0.006 : (Math.random() < 0.5 ? -1 : 1) * rand(0.05, 0.1);
  const yAim = contact ? c.y : c.y + (Math.random() < 0.5 ? -1 : 1) * rand(0.25, 0.6);
  G.cpu = { swing: true, contact, err: contact ? 0 : err };
  const prm = G.batPrm;
  Object.assign(prm, batGeom(c.x, yAim));
  prm.dur = delay / SWING_CONTACT;
  prm.swingT = G.pitchT0 + G.tc - delay + err - G.batterModel.t0;
  if (!contact) return;
  const pull = G.batSide === 'R' ? -1 : 1;
  const foulP = clamp(0.38 + (inZ ? 0 : 0.14) + (G.strikes === 2 ? 0.08 : 0) - (b.con / 100) * 0.12 + q * 0.08, 0.2, 0.62);
  if (Math.random() < foulP) {
    const k = Math.random(), sgn = Math.random() < 0.5 ? -1 : 1;
    if (k < 0.45) Object.assign(G.cpu, { ev: rand(55, 85), la: rand(-10, 35), spray: sgn * rand(48, 80) });
    else if (k < 0.8) Object.assign(G.cpu, { ev: rand(50, 75), la: rand(15, 60), spray: rand(150, 210) });
    else Object.assign(G.cpu, { ev: rand(45, 70), la: rand(55, 78), spray: sgn * rand(48, 95) });
    G.cpu.q = 0.3;
    return;
  }
  const heart = edgeIn > 0.3 ? 0.08 : 0;
  const Qc = clamp(0.58 + randn() * 0.23 + (b.con / 100) * 0.1 - q * 0.1 - (inZ ? 0 : 0.15) + heart + (vsUser ? D.cpuBat * 0.6 : 0), 0, 1);
  const evMax = 94.7 + b.pow * 0.17;
  const ev = clamp(evMax - (1 - Qc) * 46 + randn() * 4, 38, 119);
  const la = clamp(8 + Qc * 7 + (c.y - 2.5) * 8 + randn() * 22 + (b.pow - 65) * 0.15, -45, 78);
  const spray = clamp(pull * (8 + randn() * 17) + c.x * 8, -44, 44);
  Object.assign(G.cpu, { ev, la, spray, q: Qc });
}
function contactUser(c, at) {
  const origin = pitchPos(G.P, at, new V3());
  fbShow(c);
  launch(c.ev, c.la, c.spray, origin, c.Q, true);
}
// hitting feedback goes to whoever is batting: this screen or the online opponent's
function fbShow(c) { const bc = batCtrl(); if (bc === 'local') showFeedback(c); else if (bc === 'remote') netEvTo('showFeedback', [c]); }
function fbData() { const bb = G.bb; return bb ? { ev: bb.ev, la: bb.la, dist: bb.dist, showDist: !!(bb.hr || (bb.la > 8 && bb.landPos)) } : null; }

// ------------------------------------------------------------ outcomes ----
function catchPitch() {
  ballMesh.position.copy(G.glove);
  SND.pop(clamp(G.P.mph / 95, 0.6, 1.1));
  const sw = G.swing, cs = G.cpu;
  const swung = (sw && (!sw.calc || sw.calc.miss)) || (cs && cs.swing && !cs.contact);
  let call;
  if (swung) call = sw && sw.type === 'bunt' ? 'buntMiss' : 'swinging';
  else if (G.hbp) call = 'hbp';
  else call = umpCallsStrike() ? 'called' : 'ball';
  G.preCall = { balls: G.balls, strikes: G.strikes };
  if (sw && sw.calc && sw.calc.miss) fbShow(sw.calc);
  if (call === 'ball' && userBats()) tutNote('takeBall');
  if (G.mode === 'derby') { derbyPitchDone(swung ? 'whiff' : 'take'); return; }
  recordPitch(call === 'ball' ? 'Ball' : call === 'hbp' ? 'HBP' : call === 'called' ? 'Called K' : 'Swinging K');
  G.recOn = false;
  applyCall(call);
  if (G.baseRunners.some((r) => r.steal && r.steal.went) && stealAfterPitch()) return;
  setupChallenge(call);
}

// ---------------------------------------------------- steals & pickoffs ----
// A steal is called before or during the pitch. The runner breaks on the pitcher's
// first move (late if you call it once he's delivering). If the ball isn't put in
// play the catcher has to throw him out: a Play in 'steal' mode, tag at the bag.
// If it is put in play, the runner already has his jump (hit-and-run).
const STEAL_PHASES = ['prePitch', 'windup', 'pitch'];
const BASE_WORD = ['home', 'first', 'second', 'third', 'home'];
function runnerIsHuman(r) { return runCtrl() !== 'cpu' && (!G.lock || r.pl.id === G.lock); }
// he can go only if the bag ahead is empty, or its runner is going too
function canSteal(r) {
  if (r.state !== 'base' || r.base >= 4) return false;
  const ahead = G.baseRunners.find((x) => x !== r && x.base === r.base + 1 && x.state === 'base');
  return !ahead || !!ahead.steal;
}
// his jump: fast runners read the pitcher better
const stealJump = (r) => clamp(rand(0, 0.15) + (75 - (r.pl.spd ?? 60)) * 0.004, 0, 0.35);
function stealBreak(r, delay) {
  r.steal.went = true;
  r.state = 'run'; r.next = r.base + 1; r.rev = false; r.d = r.lead || 10; r.v = r.top * 0.25; r.delay = delay; r.leadVis = 0;
  setAnim(r.m, 'run');
}
// kind 'go' calls a steal (all runners, or just `which`); 'back' calls it off before he breaks
function stealCmd(kind, which = null) {
  if (!STEAL_PHASES.includes(G.phase) || G.mode === 'derby' || G.play) return;
  for (const r of [...G.baseRunners].sort((a, b) => b.base - a.base)) {
    if (!runnerIsHuman(r) || (which != null && r.pl.id !== which)) continue;
    if (kind === 'go') {
      if (r.steal) continue;
      if (!canSteal(r)) { if (which != null && runCtrl() === 'local') setHint(`${BASE_ABBR[r.base + 1]} is taken: the runner ahead has to go too`); continue; }
      r.steal = { user: true };
      if (runCtrl() === 'local') tutNote('stealTry');
      if (G.phase !== 'prePitch') stealBreak(r, stealJump(r) + 0.15);   // the pitcher is already going: a late jump
      SND.tick();
    } else if (r.steal && !r.steal.went) r.steal = null;
  }
}
// the runners break during the windup and the pitch, before any Play exists; once the
// pitch is on its way the fielder covering the bag breaks for it too
function updateStealers(dt) {
  if (G.phase === 'pitch') {
    for (const r of G.baseRunners) {
      if (!r.steal || !r.steal.went || r.state !== 'run' || (r.next !== 2 && r.next !== 3)) continue;
      const f = G.fByRole[r.next === 2 ? 'SS' : '3B'], bp = BASES[r.next];
      if (!f) continue;
      const dx = bp.x - f.pos.x, dz = bp.z - f.pos.z, d = Math.hypot(dx, dz);
      if (d < 3) continue;
      f.v = Math.min(f.speed * 0.85, f.v + f.acc * dt);
      const step = Math.min(d - 3, f.v * dt);
      f.pos.x += (dx / d) * step; f.pos.z += (dz / d) * step; f.yaw = Math.atan2(dx, dz); f.m.phase += step * 0.42; f.anim('run'); f.sync();
    }
  }
  for (const r of G.baseRunners) {
    if (!r.steal || !r.steal.went || r.state !== 'run') continue;
    if (r.delay > 0) { r.delay -= dt; continue; }
    r.v = Math.min(r.top, r.v + RUN_ACC * dt); r.d += r.v * dt; r.phase += r.v * dt * 0.42;
    if (r.d >= 90) { r.base = r.next; r.next = null; r.d = 0; r.v = 0; r.state = 'base'; r.lead = 0; setAnim(r.m, 'ready'); }
    r.sync(BASES[0]);
  }
}
function cancelSteals() {
  for (const r of G.baseRunners) {
    if (!r.steal) continue;
    r.steal = null;
    if (r.state === 'run') { r.state = 'base'; r.d = 0; r.v = 0; r.next = null; setAnim(r.m, 'ready'); r.sync(BASES[0]); }
  }
}
// the pitch got to the catcher with runners going
function stealAfterPitch() {
  const k = G.abEnd;
  if (k === 'walk' || k === 'hbp') { cancelSteals(); return false; }   // the walk moves them; no throw
  if (k === 'kLook' || k === 'kSwing') { settleAB(k); G.abEnd = 'settled'; }   // strike 'em out...
  if (G.outs >= 3) { cancelSteals(); return false; }
  const fc = fieldCtrl(), rc = runCtrl();
  const pl = (G.play = new Play({ kind: 'steal', fielders: G.fielders, runners: G.baseRunners, outs: G.outs, field: fc === 'cpu' ? null : { lock: G.lock, manual: settings.manual }, run: rc === 'cpu' ? null : { lock: G.lock } }));
  lockPlayFor(pl);
  netPlayOut();
  setPhase('live');
  setHint(liveHint());
  return true;
}
// Player Lock: are you in this steal or pickoff? If not, it sims like any other play.
function lockPlayFor(pl) {
  if (G.mode !== 'lock') return;
  G.lockInv = pl.R.some((r) => r.pl.id === G.lock) || pl.F.some((f) => f.pl.id === G.lock && (f.role === 'C' || f.role === 'P' || f.task === 'cover'));
  if (G.lockSkip && pl.hf && !G.lockInv) { pl.hf = null; pl.userDef = false; pl.uf = null; }
}
function finishStealPlay() {
  const pl = G.play, res = pl.summary(), ps = pstat(curPitcher());
  const outsMade = res.outs - G.outs;
  G.outs = res.outs; ps.outs += outsMade;
  scoreRuns(res.runs, res.scorers);
  if (res.error) G.errs[1 - G.half]++;
  const sb = [], cs = [];
  for (const r of pl.R) {
    if (!r.steal || !r.steal.went) continue;
    if (r.state === 'out') { cs.push(r); bstat(r.pl).cs++; }
    else if (r.state === 'scored' || r.base > r.start) { sb.push(r); bstat(r.pl).sb++; }
  }
  G.prac.sb += sb.length; G.prac.cs += cs.length;
  G.bases = res.outs >= 3 ? [null, null, null, null] : res.bases;
  const nm = (r) => lastName(r.pl.name);
  if (cs.length) {
    const r = cs[0], dp = G.abEnd === 'settled' && outsMade >= 1;
    hudCall(dp ? 'DOUBLE PLAY' : 'CAUGHT STEALING', 'out');
    Caster.line(dp ? `Strike him out, throw him out! ${nm(r)} is gunned down at ${BASE_WORD[r.next || r.start + 1]}.` : pick([`Here's the throw... ${nm(r)} is out! Caught stealing.`, `${nm(r)} goes, and ${lastName(G.fByRole.C.pl.name)} throws him out!`]));
    if (G.half === 0) excite(0.5, 2);
  } else if (sb.length) {
    const r = sb[0], to = r.state === 'scored' ? 4 : r.base;
    hudCall(sb.length > 1 ? 'DOUBLE STEAL' : to === 4 ? 'STEAL OF HOME' : 'STOLEN BASE', 'play');
    Caster.line(to === 4 ? `${nm(r)} steals home! Unbelievable!` : sb.length > 1 ? 'A double steal, and they both make it!' : pick([`${nm(r)} takes off... and he's in there! Stolen base.`, `${nm(r)} swipes ${BASE_WORD[to]} with a great jump.`]) + (res.error ? ' The throw gets away!' : ''));
    if (G.half === 1) excite(0.5, 2);
    SND.roar(G.half === 1 ? 0.35 : 0.15, 0.6, 1.5);
  }
  hudScore(); hudCount(); drawBoards();
  G.postNext = () => (G.abEnd === 'settled' ? afterAB() : afterBasesPlay());
  setPhase('postPlay', G.mode === 'spectate' ? 1.2 : 1.8);
}
// after a steal or pickoff that didn't end the at-bat: same count, same batter
function afterBasesPlay() {
  if (G.half === 1 && G.inning >= G.innings && G.score[1] > G.score[0]) { endGame(true); return; }
  if (G.outs >= 3) { halfOver(); return; }
  enterPrePitch();
}

// The pitcher steps off and throws over; the runner dives back. A runner who was
// leaning (a steal called for this pitch) is a step slow, or caught going.
function canPickoff(base) {
  return G.phase === 'prePitch' && !G.play && G.mode !== 'derby' && G.baseRunners.some((r) => r.base === base && r.state === 'base')
    && (pitchCtrl() !== 'local' || G.pitchUI.state === 'aim');
}
function startPickoff(base) {
  if (!canPickoff(base)) return;
  G.abPicks++; G.cpuPick = null;
  pci.visible = false; reticle.visible = false; zoneGroup.visible = false; $('meter').classList.add('hidden');
  const fc = fieldCtrl(), rc = runCtrl();
  const pl = (G.play = new Play({ kind: 'pick', pickBase: base, fielders: G.fielders, runners: G.baseRunners, outs: G.outs, field: fc === 'cpu' ? null : { lock: G.lock, manual: settings.manual }, run: rc === 'cpu' ? null : { lock: G.lock } }));
  lockPlayFor(pl);
  netPlayOut();
  ballMesh.visible = true;
  setPhase('live');
  setHint('');
  Caster.line(pick(['Throw over to ' + BASE_WORD[base] + '...', 'He steps off and throws to ' + BASE_WORD[base] + '.', 'Pickoff attempt at ' + BASE_WORD[base] + '.']), false);
}
function finishPickPlay() {
  const pl = G.play, res = pl.summary(), ps = pstat(curPitcher());
  const outsMade = res.outs - G.outs;
  G.outs = res.outs; ps.outs += outsMade;
  scoreRuns(res.runs, res.scorers);
  if (res.error) G.errs[1 - G.half]++;
  G.bases = res.outs >= 3 ? [null, null, null, null] : res.bases;
  const out = pl.outEvents[0];
  if (out) {
    G.prac.picked++;
    hudCall('PICKED OFF', 'out');
    Caster.line(pick([`Got him! ${lastName(out.r.pl.name)} is picked off ${BASE_WORD[out.base]}.`, `He's caught leaning... and he's out! A pickoff at ${BASE_WORD[out.base]}.`]));
    excite(0.4, 1.5);
  } else if (res.error) { hudCall('THROWING ERROR', 'play'); Caster.line('The pickoff throw gets away! The runners move up.'); }
  else if (Math.random() < 0.5) Caster.line(pick(['Back in safely.', 'He dives back in time.', 'Safe at the bag.']), false);
  hudScore(); hudCount(); drawBoards();
  G.postNext = afterBasesPlay;
  setPhase('postPlay', out || res.error ? 1.6 : 0.6);
}
// CPU steal calls: speed against the catcher's arm, the count and the score
function cpuSteals() {
  if (G.mode === 'derby' || G.mode === 'tutorial' || !G.fByRole.C || G.drill === 'bat') return;
  const arm = G.fByRole.C.pl.arm ?? 60, full = G.outs === 2 && G.balls === 3 && G.strikes === 2;
  for (const r of [...G.baseRunners].sort((a, b) => b.base - a.base)) {
    if (runnerIsHuman(r) || r.state !== 'base') continue;
    // two outs, full count: the forced runners go on the pitch
    const forced = [1, 2, 3].slice(0, r.base).every((b) => G.bases[b]);
    if (full && forced && r.base < 4) { r.steal = { user: false }; continue; }
    if (r.base >= 3 || !canSteal(r)) continue;
    const edge = (r.pl.spd - 65) / 30 - (arm - 65) / 70;
    let p = clamp(0.012 + edge * 0.07, 0, 0.12);
    if (r.base === 2) p *= G.outs === 1 ? 0.45 : 0.15;   // third base: really only with one out
    if (Math.abs(G.score[0] - G.score[1]) >= 5) p *= 0.3;
    if (G.drill === 'pitch' || G.drill === 'field') p *= 1.6;   // give the defense something to practice
    if (Math.random() < p) r.steal = { user: false };
  }
}
// CPU pitchers throw over now and then, more to fast runners, less each time this at-bat
function cpuPickoff() {
  if (G.mode === 'derby' || G.mode === 'tutorial' || G.drill === 'bat') return;
  for (const r of G.baseRunners) {
    if (r.base > 2 || G.bases[r.base + 1]) continue;
    let p = (0.05 + Math.max(0, r.pl.spd - 70) * 0.004) * Math.pow(0.45, G.abPicks);
    if (r.base === 2) p *= 0.4;
    if (G.drill === 'run') p *= 1.8;
    if (Math.random() < p) { G.cpuPick = { base: r.base, at: G.cpuPitchAt * rand(0.35, 0.8) }; return; }
  }
}

// --------------------------------------------------------------- practice ----
const DRILLS = {
  bat: { name: 'Batting practice', intro: 'Batting practice. Live pitching, as many at-bats as you want.' },
  pitch: { name: 'Pitching practice', intro: 'Pitching practice. Work the zone against a full lineup.' },
  run: { name: 'Baserunning practice', intro: "Baserunning practice. You're on base: steal, take the extra base, or hold." },
  field: { name: 'Fielding practice', intro: 'Fielding practice. Balls come off the bat every few seconds. Make the play.' },
};
// three outs in a drill: clear the bases and keep going instead of changing sides
function halfOver() {
  if (!G.drill) { endHalf(); return; }
  G.outs = 0; G.bases = [null, null, null, null];
  hudCount(); hudBanner('THREE OUTS', 'Bases cleared · keep going', '');
  newBatter();
}
// baserunning drill: put runners on so there's something to do
function practiceRunners() {
  const lu = battingTeam().lineup, bi = G.order[G.half] % 9, guy = (k) => lu[(bi + 9 - k) % 9], x = Math.random();
  if (x < 0.6) G.bases[1] = guy(1);
  else if (x < 0.82) G.bases[2] = guy(1);
  else { G.bases[1] = guy(1); G.bases[2] = guy(2); }
  hudCount();
}
// fielding drill: a fungo off the bat; grounders, liners and flies all over the field
function fungo() {
  const x = Math.random();
  let ev, la, sp;
  if (x < 0.45) { ev = rand(68, 102); la = rand(-12, 7); sp = rand(-42, 42); }
  else if (x < 0.68) { ev = rand(82, 100); la = rand(8, 19); sp = rand(-40, 40); }
  else { ev = rand(80, 97); la = rand(22, 44); sp = rand(-44, 44); }
  const m = G.batterModel, prm = G.batPrm;
  Object.assign(prm, batGeom(0, 2.6)); prm.dur = 0.15 / SWING_CONTACT; prm.swingT = G.now - m.t0 - 0.15;
  G.P = { type: 'FF', mph: 0 }; G.cross = { x: 0, y: 2.6 };
  launch(ev, la, sp, new V3(G.batSide === 'R' ? -0.6 : 0.6, 3, -0.5), 0.6, false);
}

// ------------------------------------------------------------ lock skip ----
// is this ball hit to the outfield or your way?
function lockFieldInvolved(pl) {
  const me = pl.uf;
  if (!me || pl.hr) return false;
  if (pl.chaser === me) return true;
  if (pl.bb.foul) return false;
  if (pl.chaser && pl.chaser.isOF) return true;
  for (const s of pl.bb.S) {
    if (s.t > 2.5) break;
    if (s.y < 9 && Math.hypot(s.x - me.pos.x, s.z - me.pos.z) < 30) return true;
  }
  return false;
}
// hand your player to the CPU for the rest of this at-bat and fast-forward
function startSim() {
  if (G.mode !== 'lock' || G.simAB || ['menu', 'final', 'break'].includes(G.phase)) return;
  G.simAB = true;
  if (G.phase === 'prePitch' && !G.spec) { G.spec = cpuChoosePitch(); G.cpuPitchAt = G.pt + 0.3; }
  const pl = G.play;
  if (pl && G.phase === 'live') {
    pl.hf = null; pl.hrun = null; pl.userDef = false; pl.ufManual = false; pl.prompt = false; pl.queuedThrow = null; pl.uf = null;
    if (pl.ball.mode === 'flight' && !pl.hr && !pl.dead) pl.replan();
  }
  pci.visible = false; reticle.visible = false; zoneGroup.visible = false; pitchGuide.visible = false;
  $('meter').classList.add('hidden'); $('throwPrompt').classList.add('hidden'); runnerHUD(false);
  ctrlRing.visible = false; landMark.visible = false; baseMark.visible = false;
  setHint('Skipping to the next batter&hellip;');
  if (document.pointerLockElement) try { document.exitPointerLock(); } catch (e) { /* not locked */ }
}

// ---------------------------------------------------------- umpire & ABS ----
const UMP_S = 0.1;
// distance from the pitch to the edge of the zone in feet: positive inside, negative outside
function zoneEdgeDist(x, y) {
  const hw = ZONE.halfW + BALL_R, top = ZONE.top + BALL_R, bot = ZONE.bot - BALL_R;
  const dx = hw - Math.abs(x), dyt = top - y, dyb = y - bot;
  if (dx >= 0 && dyt >= 0 && dyb >= 0) return Math.min(dx, dyt, dyb);
  return -Math.hypot(Math.max(0, -dx), Math.max(0, -dyt, -dyb));
}
// a human umpire misses some borderline pitches (about 92% right overall); the robot never does
function umpCallsStrike() {
  const truth = G.isStrike;
  const pMiss = G.ump === 2 ? 0 : 0.5 * Math.exp(-Math.abs(zoneEdgeDist(G.cross.x, G.cross.y)) / UMP_S);
  const strike = Math.random() < pMiss ? !truth : truth;
  if (G.umpLog) { G.umpLog.n++; if (strike === truth) G.umpLog.ok++; }
  return strike;
}
// ABS challenge system: the side hurt by a called ball/strike gets a short window to challenge
function setupChallenge(call) {
  G.challengeable = null; G.cpuChallengeAt = 0;
  if (G.ump !== 1 || (call !== 'called' && call !== 'ball') || G.mode === 'derby') return;
  const side = call === 'called' ? G.half : 1 - G.half;
  if (G.challenges[side] <= 0) return;
  G.challengeable = { side, call, truth: G.isStrike ? 'called' : 'ball', x: G.cross.x, y: G.cross.y, pre: { ...G.preCall } };
  let c = sideCtrl(side);
  // like MLB, only the batter, pitcher or catcher may challenge; in Player Lock that has to be you
  if (G.lock && side === G.lockSide) {
    const catcher = G.fByRole.C && G.fByRole.C.pl;
    const mine = call === 'called' ? G.batter.id === G.lock : curPitcher().id === G.lock || (catcher && catcher.id === G.lock);
    if (!mine) c = 'cpu';
  }
  G.challengeable.who = c;
  if (c === 'cpu') {
    const wrong = (call === 'called') !== G.isStrike;
    const big = call === 'called' ? G.preCall.strikes === 2 : G.preCall.balls === 3;
    if (Math.random() < (wrong ? (big ? 0.8 : 0.3) : 0.015)) G.cpuChallengeAt = G.now + 0.7; else G.challengeable = null;
  } else {
    G.dur = Math.max(G.dur, 2.8);
    if (c === 'local') setHint(`<kbd>C</kbd> challenge the call &middot; ${G.challenges[side]} left`);
  }
  hudScore();
}
function startChallenge(side) {
  const c = G.challengeable;
  if (!c || c.side !== side || G.phase !== 'postPitch') return;
  G.challengeable = null; G.cpuChallengeAt = 0;
  G.challenge = c;
  const team = G.teams[side];
  absShow(team.id, c.x, c.y, c.call === 'called' ? 'STRIKE' : 'BALL');
  Caster.line(`The ${team.name} challenge the call. Let's go to the ABS.`);
  setHint('');
  setPhase('absReview', 1.9);
  hudScore();
}
function revealChallenge() {
  const ch = G.challenge; G.challenge = null;
  const overturn = ch.call !== ch.truth, word = ch.truth === 'called' ? 'STRIKE' : 'BALL';
  absReveal(overturn, word);
  if (overturn) {
    G.balls = ch.pre.balls; G.strikes = ch.pre.strikes; G.abEnd = null;
    const last = G.abPitches[G.abPitches.length - 1];
    if (last) last.res = ch.truth === 'called' ? 'Called K' : 'Ball';
    Caster.line(`The call is overturned. That's a ${word.toLowerCase()}.`);
    applyCall(ch.truth, true);
    drawTracker();
  } else {
    G.challenges[ch.side]--;
    Caster.line(`The call stands. The ${G.teams[ch.side].name} lose a challenge.`);
    setPhase('postPitch', 1.4);
  }
  hudScore(); hudCount();
}
function recordPitch(res) {
  const P = G.P;
  G.abPitches.push({ x: G.cross.x, y: G.cross.y, type: P.type, mph: Math.round(P.mph), res });
  const pr = G.prac;
  pr.pitches++;
  if (res !== 'Ball' && res !== 'HBP') pr.strikes++;
  if (res === 'Swinging K' || res === 'Foul' || res === 'In play') pr.swings++;
  if (res === 'Foul' || res === 'In play') pr.contact++;
  if (res !== 'Ball' && res !== 'HBP' && userPitches()) tutNote('strike');
  pitchMark.position.set(G.cross.x, G.cross.y, 0);
  pitchMark.material.color.set(res === 'Ball' || res === 'HBP' ? '#3fd38a' : res === 'Foul' ? '#ffc94a' : res === 'In play' ? '#5aa8ff' : '#ff5a5f');
  pitchMark.visible = userBats() && settings.zone;
  drawTracker(); hudPitchInfo(); drawBoards();
  hudPitcher();
}
function applyCall(call, quiet) {
  const p = curPitcher(), ps = pstat(p), bs = bstat(G.batter), hu = G.umps[0];
  let dur = 1.0;
  if (call === 'ball') {
    G.balls++;
    if (G.balls >= 4) { G.abEnd = 'walk'; hudCall('BALL FOUR', 'ballc'); dur = 1.8; }
    else hudCall(`BALL ${G.balls}`, 'ballc');
  } else if (call === 'hbp') {
    G.abEnd = 'hbp'; hudCall('HIT BY PITCH', 'ballc'); dur = 1.8;
    Caster.line(`${lastName(G.batter.name)} is hit by the pitch and takes first.`);
  } else {
    G.strikes++;
    if (call === 'called' && !quiet) setAnim(hu, 'ump', { callT: 0.12, call: 'strike' });
    if (G.strikes >= 3) {
      G.abEnd = call === 'called' ? 'kLook' : 'kSwing';
      hudCall(call === 'called' ? 'STRIKE THREE' : 'STRIKEOUT', 'strike'); dur = 1.9;
      if (call === 'called' && !quiet) SND.say('Strike three!', { pitch: 0.6, rate: 0.95 });
    } else {
      hudCall(call === 'called' ? 'STRIKE' : 'SWINGING STRIKE', 'strike');
      if (call === 'called' && !quiet) SND.say('Strike!', { pitch: 0.6, rate: 0.95 });
    }
  }
  hudCount(); drawBoards();
  setPhase('postPitch', G.mode === 'spectate' ? dur * 0.7 : dur);
}
function endPostPitch() {
  G.challengeable = null; G.cpuChallengeAt = 0;
  const k = G.abEnd;
  if (!k) { enterPrePitch(); return; }
  if (k !== 'settled') settleAB(k);   // 'settled': already booked (a strikeout on a steal)
  afterAB();
}
// book a walk, hit batter or strikeout: stats, runners forced along, the out
function settleAB(k) {
  const p = curPitcher(), ps = pstat(p), bs = bstat(G.batter);
  bs.pa++;
  if (k === 'walk' || k === 'hbp') {
    bs.bb++; ps.bb++; G.prac.bb++;
    const b = G.bases;
    let scored = null;
    if (b[1]) { if (b[2]) { if (b[3]) scored = b[3]; b[3] = b[2]; } b[2] = b[1]; }
    b[1] = G.batter;
    if (scored) { scoreRuns(1, [scored]); bs.rbi++; }
    if (k === 'walk') Caster.line(pick([`Ball four. ${lastName(G.batter.name)} draws the walk.`, `${lastName(G.batter.name)} works a walk.`, `That's ball four, and ${lastName(G.batter.name)} trots to first.`]) + (scored ? ' A run is forced home!' : ''));
  } else {
    bs.ab++; bs.k++; ps.k++; ps.outs++; G.outs++; G.prac.k++;
    const nm = lastName(G.batter.name);
    Caster.line(k === 'kLook' ? pick([`Called strike three! ${nm} is caught looking.`, `Strike three, right on the black. ${nm} goes down looking.`]) : pick([`Swing and a miss, strike three! ${nm} goes down swinging.`, `Got 'em! ${nm} strikes out swinging.`, `Struck out swinging. ${curPitcher().name.split(' ')[1]} with the punchout.`]));
    if (G.outs < 3) excite(0.25, 1.2);
  }
  hudPrac();
}
function scoreRuns(n, scorers) {
  if (!n) return;
  const bi = G.half;
  G.score[bi] += n; G.line[bi][G.inning - 1] += n; G.prac.runs += n;
  pstat(curPitcher()).r += n;
  for (const s of scorers) bstat(s).r++;
  hudScore(); drawBoards();
}
function afterAB() {
  G.order[G.half] = (G.order[G.half] + 1) % 9;
  hudCount(); hudScore();
  if (G.half === 1 && G.inning >= G.innings && G.score[1] > G.score[0]) { endGame(true); return; }
  if (G.outs >= 3) { halfOver(); return; }
  newBatter();
}
function launch(ev, la, spray, origin, q, byUser) {
  SND.crack(clamp(q, 0.15, 1));
  if (q > 0.85 && ev > 100) camRig.shake = 0.5;
  pci.visible = false; zoneGroup.visible = false; pitchMark.visible = false; pitchGuide.visible = false; reticle.visible = false;
  $('meter').classList.add('hidden');
  const bb = simBatted(origin, ev, la, spray);
  netBBOut(origin, ev, la, spray);
  if (byUser) { G.prac.evSum += ev; G.prac.evN++; tutNote('contact'); }
  G.bb = bb; G.contactT = G.now; G.byUser = byUser; FL.mode = 'track';
  ballMesh.visible = true;
  hudPitchInfo();
  if (G.mode === 'derby') { setPhase('derbyFlight'); G.derby.t0 = G.now; return; }
  const br = new Runner(G.batter, G.batterModel, 0);
  br.from0 = G.batterModel.root.position.clone();
  const runners = [br, ...G.baseRunners];
  const fc = fieldCtrl(), rc = runCtrl();
  G.play = new Play({
    bb, fielders: G.fielders, runners, outs: G.outs,
    field: fc === 'cpu' ? null : { lock: G.lock, manual: settings.manual },
    run: rc === 'cpu' ? null : { lock: G.lock },
  });
  // Player Lock: you field balls hit to the outfield or your way; the CPU plays the rest
  if (G.mode === 'lock' && G.lockSkip && G.play.hf) {
    const pl = G.play;
    G.lockInv = lockFieldInvolved(pl);
    if (!G.lockInv) { pl.hf = null; pl.userDef = false; pl.uf = null; pl.planFielders(0); }
    else if (G.skipping) { G.beat = 0.6; hudCall('YOUR PLAY', 'play'); }
  }
  if (bb.hr) { excite(1, 6); SND.roar(0.55, 2.5, 4); }
  else if (ev > 95 && la > 15 && la < 45) { SND.roar(0.3, 1.2, 2.5); }
  setPhase('live');
  setHint(liveHint());
}
function finishPlay() {
  const pl = G.play, res = pl.summary(), bi = G.half;
  G.lastResult = res; G.postNext = null;
  $('throwPrompt').classList.add('hidden');
  if (res.foul) {
    recordPitch('Foul');
    if (G.strikes < 2) G.strikes++;
    hudCall('FOUL BALL', 'foul'); hudCount();
    G.recOn = false;
    setPhase('postFoul', G.mode === 'spectate' ? 0.7 : 1.0);
    return;
  }
  recordPitch('In play');
  G.recOn = false;
  const p = curPitcher(), ps = pstat(p), bs = bstat(G.batter);
  const outsMade = res.outs - G.outs;
  G.outs = res.outs; ps.outs += outsMade;
  scoreRuns(res.runs, res.scorers);
  let hit = null;
  if (res.hr) hit = 4;
  else if (res.gr) hit = 2;
  else if (!res.batterOut && !res.error && !res.fc) hit = clamp(res.batterBase, 1, 4);
  if (hit) { G.hits[bi]++; bs.h++; ps.h++; if (hit === 2) bs.d++; if (hit === 3) bs.t++; if (hit === 4) { bs.hr++; ps.hr++; } }
  if (res.error) G.errs[1 - bi]++;
  const sacFly = res.caught && res.runs > 0 && !res.dp;
  bs.pa++; if (!sacFly) bs.ab++;
  if (!res.error && !(res.dp && !hit)) bs.rbi += res.runs;
  G.bases = res.outs >= 3 ? [null, null, null, null] : res.bases;
  G.abEnd = 'play';
  const pr = G.prac;
  pr.chances++; pr.outs += outsMade; if (res.error) pr.errors++;
  if (hit) { pr.hits++; if (hit === 4) pr.hr++; }
  pr.picked += res.outEvents.filter((e) => !e.r.isBatter).length;   // runners thrown out on the bases
  hudPrac();
  if (G.bbLog) G.bbLog.push({ ev: Math.round(G.bb.ev), la: Math.round(G.bb.la), sp: Math.round(G.bb.spray), dist: Math.round(G.bb.dist), hr: res.hr, caught: res.caught, hit, outs: outsMade, runs: res.runs, bb: res.batterBase, first: res.first, err: res.error, air: res.firstAir, startBases: G.baseRunners.map((r) => r.start).join('') });
  describePlay(res, hit, sacFly);
  hudScore(); hudCount(); drawBoards();
  G.replayable = true;
  setPhase('postPlay', G.mode === 'spectate' ? (res.hr ? 3.2 : 1.6) : res.hr ? 4.5 : hit ? 2.8 : 2.2);
}
function dirName(bb) {
  const s = bb.landPos || bb.S[bb.S.length - 1], th = sprayOf(s.x, s.z), r = Math.hypot(s.x, s.z);
  const deep = r > 300 ? 'deep ' : r < 170 && r > 110 ? 'shallow ' : '';
  if (th < -36) return deep + 'left field, down the line';
  if (th < -16) return deep + 'left field';
  if (th < -6) return deep + 'left-center';
  if (th <= 6) return deep + 'center field';
  if (th <= 16) return deep + 'right-center';
  if (th <= 36) return deep + 'right field';
  return deep + 'right field, down the line';
}
function describePlay(res, hit, sacFly) {
  const nm = lastName(G.batter.name), bb = G.bb, fld = ROLE_NAMES[res.first] || 'the defense';
  const fielderName = res.first ? lastName(G.fByRole[res.first].pl.name) : '';
  const runs = res.runs, runTxt = runs === 1 ? ' One run scores!' : runs > 1 ? ` ${runs} runs score!` : '';
  const ev = Math.round(bb.ev), dist = Math.round(bb.dist);
  const battingHome = G.half === 1;
  if (res.hr) {
    const slam = runs === 4;
    hudBanner(slam ? 'GRAND SLAM' : 'HOME RUN', `${dist} FT · ${ev} MPH · ${Math.round(bb.la)}°`, 'hr');
    Caster.line(pick([
      `${nm} crushes one to ${dirName(bb)}... and that ball is gone! ${dist} feet!`,
      `Back, back, back... gone! ${nm} with a ${dist}-foot blast!`,
      `Swung on and drilled... see ya! ${nm} goes yard to ${dirName(bb)}.`,
    ]) + (slam ? ' A grand slam!' : runs > 1 ? ` That's ${runs} runs.` : ''));
    SND.roar(battingHome ? 0.6 : 0.2, 2.5, 4); if (battingHome) { excite(1, 6); SND.fanfare(); }
    return;
  }
  if (res.gr) { hudCall('GROUND RULE DOUBLE', 'play'); Caster.line(`${nm} hits one on a bounce over the wall. Ground rule double.` + runTxt); return; }
  if (res.error) { hudCall('ERROR', 'play'); Caster.line(pick([`${nm} reaches on an error by ${fielderName}.`, `It's misplayed by ${fielderName}, and ${nm} is aboard on the error.`]) + runTxt); excite(0.3, 1.5); return; }
  if (hit === 1) { hudCall('SINGLE', 'play'); Caster.line(pick([`${nm} lines a base hit into ${dirName(bb)}.`, `${nm} slaps a single to ${dirName(bb)}.`, `Base hit for ${nm}, into ${dirName(bb)}.`]) + runTxt); if (battingHome) excite(0.4, 1.5); return; }
  if (hit === 2) { hudBanner('DOUBLE', `${ev} MPH OFF THE BAT`, ''); Caster.line(pick([`${nm} rips one into ${dirName(bb)}... that'll be a double!`, `Into the gap! ${nm} cruises into second with a double.`]) + runTxt); if (battingHome) excite(0.7, 2.5); SND.roar(battingHome ? 0.4 : 0.15, 1, 2); return; }
  if (hit === 3) { hudBanner('TRIPLE', `${ev} MPH OFF THE BAT`, ''); Caster.line(`Into ${dirName(bb)}, it's rolling to the wall! ${nm} is digging for third... triple!` + runTxt); if (battingHome) excite(0.8, 3); SND.roar(0.45, 1.5, 2.5); return; }
  if (hit === 4) { hudBanner('INSIDE THE PARK', 'HOME RUN', 'hr'); Caster.line(`${nm} is rounding third, here comes the throw... safe! An inside-the-park home run!`); SND.roar(0.6, 2, 3); return; }
  if (res.fc) { hudCall("FIELDER'S CHOICE", 'out'); Caster.line(`Fielder's choice. They get the lead runner, but ${nm} is safe at first.` + runTxt); return; }
  if (res.dp) { hudBanner('DOUBLE PLAY', res.outEvents.map((e) => e.base || '').join(' · ') ? 'TWO FOR THE PRICE OF ONE' : '', ''); Caster.line(pick([`Ground ball to ${fld}... over to second, on to first... double play!`, `They turn two! A slick double play.`])); if (!battingHome) excite(0.6, 2); return; }
  if (res.dove && res.caught) { hudCall('WHAT A CATCH', 'out'); Caster.line(`${nm} hits a sinking liner... diving catch by ${fielderName}! What a play!`); excite(battingHome ? 0 : 0.7, 2); SND.roar(0.4, 1, 2); return; }
  if (res.wallCatch) { hudCall('ROBBED', 'out'); Caster.line(`${nm} drives one deep... at the wall... and ${fielderName} hauls it in!`); SND.roar(0.4, 1, 2); return; }
  if (sacFly) { hudCall('SAC FLY', 'out'); Caster.line(`Fly ball to ${fld}, deep enough. The runner tags and scores on the sacrifice fly.`); return; }
  hudCall('OUT', 'out');
  const la = bb.la;
  if (res.caught) {
    if (la > 50) Caster.line(pick([`${nm} pops it up. ${fielderName} squeezes it.`, `Popped up, and ${fielderName} makes the catch.`]));
    else if (la < 18) Caster.line(pick([`${nm} lines out to ${fld}.`, `Hard-hit liner, but right at ${fielderName}.`]));
    else Caster.line(pick([`${nm} lifts a fly ball to ${fld}... caught.`, `Fly ball to ${dirName(bb)}, ${fielderName} settles under it for the out.`]));
  } else Caster.line(pick([`${nm} grounds out to ${fld}.`, `Routine ground ball to ${fld}, and ${nm} is retired.`, `${nm} chops one to ${fld}, thrown out at first.`]) + runTxt);
}

// ---------------------------------------------------------- half & game ----
function endHalf() {
  const last = G.inning >= G.innings;
  if (G.half === 0 && last && G.score[1] > G.score[0]) { endGame(false); return; }
  if (G.half === 1 && last && G.score[0] !== G.score[1]) { endGame(false); return; }
  const title = G.half === 0 ? `MIDDLE OF THE ${ordinal(G.inning).toUpperCase()}` : `END OF THE ${ordinal(G.inning).toUpperCase()}`;
  $('breakTitle').textContent = title;
  $('breakLS').innerHTML = linescoreHTML();
  const a = G.teams[0], h = G.teams[1], d = G.score[1] - G.score[0];
  $('breakSub').textContent = d === 0 ? `All tied at ${G.score[0]}.` : `${(d > 0 ? h : a).name} lead ${Math.max(...G.score)}–${Math.min(...G.score)}.`;
  showScreen('breakCard');
  Caster.line(`${title.charAt(0) + title.slice(1).toLowerCase()}. ` + $('breakSub').textContent);
  if (G.half === 0 && G.inning === 7 && G.innings >= 7) SND.stretch(); else SND.charge();
  setPhase('break', G.mode === 'spectate' ? 2.6 : 3.6);
  wideCam(false);
  hideFeedback(); pci.visible = false; reticle.visible = false; zoneGroup.visible = false; $('meter').classList.add('hidden');
}
function nextHalf() {
  showScreen(null);
  if (G.half === 0) G.half = 1; else { G.half = 0; G.inning++; }
  startHalf();
}
function endGame(walkoff) {
  G.recOn = false;
  const a = G.teams[0], h = G.teams[1], winner = G.score[1] > G.score[0] ? h : a;
  if (walkoff) { hudBanner('WALK-OFF', `${h.name} win it!`, 'hr'); SND.roar(0.7, 3, 4); excite(1, 8); SND.fanfare(); }
  $('finalTitle').textContent = walkoff ? 'WALK-OFF WIN' : 'FINAL';
  $('finalLS').innerHTML = linescoreHTML();
  const extra = G.inning > G.innings ? ` in ${G.inning} innings` : '';
  $('finalSub').textContent = `${winner.city} ${winner.name} win ${Math.max(...G.score)}–${Math.min(...G.score)}${extra}.`;
  // player of the game
  let best = null, bestScore = -1;
  for (const pl of [...winner.hitters, ...winner.pitchers]) {
    const s = G.stats.get(pl.id), p = G.pstats.get(pl.id);
    let sc = 0, line = '';
    if (s) { sc = s.h + s.d + 2 * s.t + 3 * s.hr + s.rbi * 1.2 + s.bb * 0.5 + s.r * 0.6; line = `${s.h}-for-${s.ab}` + (s.hr ? `, ${s.hr} HR` : '') + (s.rbi ? `, ${s.rbi} RBI` : ''); }
    if (p && p.outs) { const ps = p.outs / 3 + p.k * 0.6 - p.r * 1.5 - p.h * 0.3; if (ps > sc) { sc = ps; line = `${Math.floor(p.outs / 3)}.${p.outs % 3} IP, ${p.k} K, ${p.r} R`; } }
    if (sc > bestScore) { bestScore = sc; best = { pl, line }; }
  }
  G.potg = best ? { name: best.pl.name, line: best.line } : null;
  $('potg').innerHTML = G.potg ? potgHTML(G.potg) : '';
  Caster.line(walkoff ? `And the ${h.name} walk it off! What a finish!` : `That's the ballgame. ${$('finalSub').textContent}`);
  setPhase('final');
  setTimeout(() => { if (G.phase === 'final') showScreen('final'); }, walkoff ? 3200 : 1500);
}
function potgHTML(b) { return `<div><span>PLAYER OF THE GAME</span><br><b>${esc(b.name)}</b><br><span>${esc(b.line)}</span></div>`; }
function linescoreHTML() {
  const n = Math.max(G.innings, G.inning);
  let h = '<tr><th></th>';
  for (let i = 1; i <= n; i++) h += `<th>${i}</th>`;
  h += '<th>R</th><th>H</th><th>E</th></tr>';
  for (let t = 0; t < 2; t++) {
    h += `<tr><td>${esc(G.teams[t].id)}</td>`;
    for (let i = 0; i < n; i++) {
      const v = G.line[t][i];
      const blank = v == null && (t === 1 && i === n - 1 && (G.phase === 'final' || G.score[1] > G.score[0]) ? 'x' : '');
      h += `<td>${v ?? blank}</td>`;
    }
    h += `<td class="rhe">${G.score[t]}</td><td class="rhe">${G.hits[t]}</td><td class="rhe">${G.errs[t]}</td></tr>`;
  }
  return h;
}

// ------------------------------------------------------------------ derby ----
function derbyPitchDone(kind) {
  G.recOn = false;
  const D = G.derby;
  if (kind === 'whiff') { D.outs--; hudCall('MISS', 'strike'); }
  else hudCall('TAKE', 'ballc');
  hudDerby();
  setPhase('derbyResult', 1.0);
}
function updateDerbyFlight() {
  const bb = G.bb, t = G.now - G.derby.t0, S = bb.S, s = S[Math.min(S.length - 1, Math.floor(t / BB_DT))];
  ballMesh.position.set(s.x, s.y, s.z);
  const D = G.derby;
  const done = bb.hr ? t > bb.hrT + 1.4 : bb.foul ? t > bb.ffT + 0.6 : (bb.landT != null && t > bb.landT + 0.9) || t > S[S.length - 1].t;
  if (!D.called && bb.hr && t > bb.hrT) { D.called = true; SND.roar(0.55, 1.5, 3); excite(1, 3); }
  if (!done) return;
  D.called = false;
  if (bb.hr) {
    D.hr++; D.longest = Math.max(D.longest, Math.round(bb.dist));
    hudBanner(`${Math.round(bb.dist)} FT`, `HOME RUN #${D.hr} · ${Math.round(bb.ev)} MPH`, 'hr');
    if (bb.dist > 450) Caster.line(pick([`That one is a moonshot! ${Math.round(bb.dist)} feet!`, `Absolutely demolished. ${Math.round(bb.dist)} feet!`]));
  } else {
    D.outs--;
    hudCall(bb.foul ? 'FOUL · OUT' : 'OUT', 'out');
  }
  updateFeedbackStats(fbData());
  hudDerby();
  setPhase('derbyResult', bb.hr ? 2.2 : 1.4);
}
function endDerbyResult() {
  const D = G.derby;
  if (D.outs <= 0) {
    $('finalTitle').textContent = 'DERBY COMPLETE';
    $('finalLS').innerHTML = `<tr><th>HOME RUNS</th><th>LONGEST</th><th>BATTER</th></tr><tr><td style="text-align:center">${D.hr}</td><td>${D.longest ? D.longest + ' FT' : '–'}</td><td>${esc(D.batter.name)}</td></tr>`;
    $('potg').innerHTML = `<div><span>FINAL TALLY</span><br><b>${D.hr} home run${D.hr === 1 ? '' : 's'}</b></div>`;
    $('finalSub').textContent = D.hr >= 10 ? 'An all-time round. The crowd is on its feet.' : D.hr >= 5 ? 'A strong showing at the plate.' : 'Tough round. Try timing the pitch a touch earlier.';
    Caster.line(`That's the round. ${D.batter.name} finishes with ${D.hr} home run${D.hr === 1 ? '' : 's'}.`);
    setPhase('final');
    showScreen('final');
    return;
  }
  enterPrePitch();
}
