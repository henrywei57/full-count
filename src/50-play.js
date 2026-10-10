// ============================================================================
// Live play engine: fielders chase / cover / throw, runners read the play.
// A human can drive one fielder (assisted until they touch the controls)
// and command runners; everything else is AI.
// ============================================================================

const ROLE_POS = { P: [0, MOUND_Z], C: [0, 3.4], '1B': [66, -84], '2B': [33, -148], SS: [-33, -148], '3B': [-66, -86], LF: [-138, -264], CF: [0, -318], RF: [138, -264] };
const ROLES = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const OF_ROLES = new Set(['LF', 'CF', 'RF']);
const ROLE_NAMES = { P: 'the pitcher', C: 'the catcher', '1B': 'first', '2B': 'second', '3B': 'third', SS: 'short', LF: 'left', CF: 'center', RF: 'right' };
const RUN_ACC = 16;
// time to cover d feet from speed v0 with constant acceleration a up to vmax
function runTime(d, vmax, a, v0 = 0) {
  if (d <= 0) return 0;
  const tA = Math.max(0, (vmax - v0) / a), dA = ((v0 + vmax) / 2) * tA;
  if (d <= dA) return (-v0 + Math.sqrt(v0 * v0 + 2 * a * d)) / a;
  return tA + (d - dA) / vmax;
}
// effective throw speed: long throws lose speed to arc and the cutoff
function throwSpeed(f, d) { return f.arm * (d > 150 ? 0.8 : d > 95 ? 0.92 : 0.96); }
const heading = (r) => (r.rev ? r.base : r.next);
// the fielder you control fields anything that comes within this many feet
const HUMAN_REACH = 7.5;

class Fielder {
  constructor(pl, role, model) {
    this.pl = pl; this.role = role; this.m = model;
    this.pos = new V3(); this.home = new V3(); this.yaw = Math.PI;
    this.speed = 20 + (pl.spd ?? 50) * 0.08;
    this.arm = 98 + (pl.arm ?? 60) * 0.42;
    this.fld = pl.fld ?? 60;
    this.isOF = OF_ROLES.has(role);
    this.baseReact = role === 'P' ? 0.45 : role === 'C' ? 0.35 : this.isOF ? 0.42 : 0.27;
    this.react = this.baseReact;
    this.acc = this.isOF ? 12.5 : role === 'P' || role === 'C' ? 15 : 21;
    this.reset();
  }
  reset() {
    this.v = 0; this.react = this.baseReact + Math.random() * (this.isOF ? 0.22 : 0.1);
    this.task = null; this.target = null; this.plan = null; this.decideAt = 0; this.throwing = false; this.runTo = null;
    this.holding = false; this.downUntil = 0; this.animHold = 0; this.promptStart = null; this.excluded = false; this.dive = null; this.touched = 0; this.readyAt = 0;
  }
  setHome(x, z) { this.home.set(x, groundY(x, z), z); }
  snapHome() { this.pos.copy(this.home); this.reset(); }
  face(x, z) { this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z); }
  sync() { this.m.root.position.copy(this.pos); this.m.root.position.y = groundY(this.pos.x, this.pos.z); this.m.root.rotation.y = this.yaw; }
  anim(name, prm) { setAnim(this.m, name, prm); }
}

class Runner {
  constructor(pl, model, base) {
    this.pl = pl; this.m = model; this.base = base; this.start = base; this.next = null; this.d = 0; this.v = 0;
    this.top = 23 + (pl.spd ?? 50) * 0.07; this.state = 'base'; this.forced = false; this.wait = false; this.autoRun = false;
    this.lead = base > 0 ? 12 : 0; this.leadVis = this.lead; this.isBatter = base === 0; this.delay = 0; this.target = null;
    // userTarget: the base a human told this runner to run to (null = the AI decides)
    this.rev = false; this.userTarget = null; this.leftEarly = false; this.aiRev = false;
    this.pos = new V3(); this.phase = Math.random() * 6;
  }
  eta() {
    if (this.state !== 'run') return Infinity;
    const rem = this.rev ? this.d : 90 - this.d, v = Math.max(this.v, 0.5);
    let t;
    if (v >= this.top) t = rem / this.top;
    else {
      const tA = (this.top - v) / RUN_ACC, dA = ((v + this.top) / 2) * tA;
      t = dA >= rem ? rem / ((v + this.top) / 2) : tA + (rem - dA) / this.top;
    }
    return t + Math.max(0, this.delay);
  }
  updatePos() {
    if (this.state === 'run') { this.pos.copy(this.base === 0 && this.from0 ? this.from0 : BASES[this.base]).lerp(BASES[this.next], this.d / 90); }
    else if (this.state === 'base' && this.base < 4) {
      const b = BASES[this.base], nb = BASES[Math.min(4, this.base + 1)];
      this.pos.copy(b);
      if (this.leadVis > 0.05 && this.base > 0) this.pos.add(_v1.copy(nb).sub(b).normalize().multiplyScalar(this.leadVis));
    }
  }
  sync(face) {
    this.updatePos();
    this.m.root.position.copy(this.pos);
    if (this.state === 'run') {
      const a = BASES[this.base], b = BASES[this.next];
      this.m.root.rotation.y = this.rev ? Math.atan2(a.x - b.x, a.z - b.z) : Math.atan2(b.x - a.x, b.z - a.z);
    } else if (face) this.m.root.rotation.y = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
    this.m.phase = this.phase;
  }
}

class Play {
  // o.field: null for a CPU defense, else { lock: playerId|null, manual: bool } for a human defense
  // o.run:   null for CPU baserunning, else { lock: playerId|null } (AI still assists unless told otherwise)
  constructor(o) {
    this.bb = o.bb; this.F = o.fielders; this.R = o.runners;
    this.outs = o.outs; this.startOuts = o.outs;
    this.hf = o.field || null; this.hrun = o.run || null;
    this.userDef = !!(this.hf && this.hf.manual);
    this.t = 0; this.done = false; this.endAt = null;
    this.ball = { mode: 'flight', pos: new V3(), holder: null, thr: null, si: 0 };
    this.runs = []; this.outEvents = []; this.error = false; this.caught = false; this.firstFielder = null; this.firstAir = false;
    this.fairKnown = false; this.foul = false; this.hr = !!o.bb.hr; this.awarded = false; this.thirdOutForce = false;
    this.queuedThrow = null; this.prompt = false; this.events = []; this.chaser = null; this.dove = false; this.wallCatch = false;
    this.uf = null; this.ufManual = false; this.lastInput = -9; this.inp = { x: 0, z: 0 };
    // ballBase: a fielder standing on a bag with the ball, ready to tag whoever arrives
    this.ballBase = null; this.remotePos = null;
    for (const f of this.F) f.reset();
    // force situation at contact
    const occ = [true, false, false, false];
    for (const r of this.R) if (!r.isBatter) occ[r.base] = true;
    for (const r of this.R) {
      if (r.isBatter) { r.forced = true; r.state = 'run'; r.next = 1; r.d = 0; r.v = 0; r.delay = 0.3; continue; }
      let f = true; for (let b = 1; b < r.base; b++) if (!occ[b]) f = false;
      r.forced = f;
    }
    if (this.hf && this.hf.lock) this.uf = this.F.find((f) => f.pl.id === this.hf.lock) || null;
    if (this.hr) { this.setupTrot(); this.planFielders(0); return; }
    this.planFielders(0);
    const fly = this.chaser && this.chaser.plan && this.chaser.plan.air;
    for (const r of this.R) {
      if (r.isBatter) continue;
      r.wait = this.outs < 2 && fly;
      r.autoRun = this.outs === 2;
      if (r.wait) r.lead = 0;
    }
  }
  setupTrot() {
    for (const r of this.R) { r.target = 4; r.state = 'run'; r.next = r.base + 1; r.d = r.isBatter ? 0 : r.lead; r.lead = 0; r.leadVis = 0; r.v = 4; r.delay = r.isBatter ? 0.9 : 0.25; }
  }
  // ---------------------------------------------------------- planning ----
  planFielders(fromT) {
    const S = this.bb.S;
    const i0 = Math.min(S.length - 1, Math.floor(fromT / BB_DT));
    let best = null;
    for (const f of this.F) {
      f.plan = null;
      // a fielder the human is steering isn't counted on; the AI plays the ball behind him
      if (f.excluded || (f.downUntil && f.downUntil > fromT + 0.4) || (f === this.uf && this.ufManual)) continue;
      const react = fromT === 0 ? f.react : 0.08;
      const start = f.downUntil > fromT ? f.downUntil : fromT;
      let plan = null, divePlan = null;
      for (let i = i0; i < S.length; i += 2) {
        const s = S[i];
        if (s.dead || s.hr) break;
        const dtAvail = s.t - start - react;
        if (dtAvail < 0) continue;
        const r = Math.hypot(s.x, s.z);
        if (f.role === 'C' && r > 48) continue;
        if (f.role === 'P' && r > 115) continue;
        if (!f.isOF && r > 205 && s.b) continue;
        if (!inPoly(s.x, s.z) && Math.abs(sprayOf(s.x, s.z)) > 45.4) continue;
        const air = !s.b && s.y <= 8.6 && s.t > 0.12, grd = s.b && s.y <= 2.6;
        if (!air && !grd) continue;
        const dist = Math.hypot(s.x - f.pos.x, s.z - f.pos.z);
        const v0 = fromT === 0 ? 0 : f.v;
        // infielders give ground slowly when they have to go back on a ball
        const back = !f.isOF && Math.hypot(s.x, s.z) > Math.hypot(f.pos.x, f.pos.z) + 6;
        const vmax = back ? f.speed * 0.78 : f.speed;
        if (runTime(dist - 3.4, vmax, f.acc, v0) <= dtAvail) { plan = { t: s.t, i, x: s.x, z: s.z, air, dive: false }; break; }
        if (!divePlan && air && s.y < 6 && runTime(dist - 8.2, vmax, f.acc, v0) <= dtAvail) divePlan = { t: s.t, i, x: s.x, z: s.z, air, dive: true };
        if (!divePlan && !air && !f.isOF && runTime(dist - 5.2, vmax, f.acc, v0) <= dtAvail) divePlan = { t: s.t, i, x: s.x, z: s.z, air, dive: true, gdive: true };
      }
      if (divePlan && (!plan || (divePlan.air && !plan.air) || (divePlan.gdive && plan.t - divePlan.t > 0.6))) plan = divePlan;
      if (!plan) {
        const last = S[S.length - 1];
        if (last.dead || last.hr) continue;
        const d = Math.hypot(last.x - f.pos.x, last.z - f.pos.z);
        plan = { t: Math.max(last.t, start + react + runTime(d - 3, f.speed, f.acc)), i: S.length - 1, x: last.x, z: last.z, air: false, dive: false };
      }
      f.plan = plan;
      let score = plan.t + (plan.dive ? 0.25 : 0);
      if (plan.air && f.isOF) score -= 0.35; // outfielders call off infielders on flies
      if (!best || score < best.score) best = { f, score };
    }
    this.chaser = best ? best.f : null;
    this.assignTasks();
    if (this.hf && !this.hf.lock && !this.ufManual && this.chaser) this.uf = this.chaser;
  }
  assignTasks() {
    const ch = this.chaser, by = (r) => this.F.find((f) => f.role === r);
    const used = new Set(ch ? [ch] : []);
    const pickFree = (prefs) => { for (const r of prefs) { const f = by(r); if (f && !used.has(f)) { used.add(f); return f; } } return null; };
    const leftSide = ch && (ch.role === 'SS' || ch.role === '3B' || ch.role === 'LF' || (ch.role === 'CF' && ch.plan && ch.plan.x < 0));
    this.cover = {
      1: pickFree(['1B', 'P', '2B']),
      2: pickFree(leftSide ? ['2B', 'SS'] : ['SS', '2B']),
      3: pickFree(['3B', 'SS', 'P']),
      4: pickFree(['C', 'P']),
    };
    for (const f of this.F) {
      if (f === ch) { f.task = 'chase'; continue; }
      const b = [1, 2, 3, 4].find((k) => this.cover[k] === f);
      if (b) { f.task = 'cover'; f.coverBase = b; continue; }
      f.task = f.isOF ? 'backup' : 'hold';
    }
  }
  replan() { this.planFielders(this.t); }
  // ------------------------------------------------------- human input ----
  setInput(x, z) {
    this.inp.x = x; this.inp.z = z;
    if (!this.hf || !this.uf) return;
    const was = this.ufManual;
    if (Math.hypot(x, z) > 0.2) { this.ufManual = true; this.lastInput = this.t; }
    else if (this.ufManual && this.t - this.lastInput > 0.9 && this.ball.holder !== this.uf) this.ufManual = false;
    if (was !== this.ufManual && this.ball.mode === 'flight' && !this.hr && !this.dead) this.replan();
  }
  userSwitch() {
    if (!this.hf || this.hf.lock || this.done) return;
    const bp = this.ball.mode === 'flight' && this.chaser && this.chaser.plan ? new V3(this.chaser.plan.x, 0, this.chaser.plan.z) : this.ball.pos;
    let best = null, bd = 1e9;
    for (const f of this.F) { if (f === this.uf) continue; const d = Math.hypot(f.pos.x - bp.x, f.pos.z - bp.z); if (d < bd) { bd = d; best = f; } }
    if (best) { this.uf = best; this.ufManual = false; }
  }
  userDive() {
    const f = this.uf;
    if (!f || this.done || f === this.ball.holder || f.throwing || (f.downUntil && this.t < f.downUntil)) return;
    let dx = this.inp.x, dz = this.inp.z;
    if (Math.hypot(dx, dz) < 0.2) { dx = this.ball.pos.x - f.pos.x; dz = this.ball.pos.z - f.pos.z; }
    const L = Math.hypot(dx, dz) || 1;
    f.dive = { t0: this.t, dx: dx / L, dz: dz / L, tried: false };
    f.yaw = Math.atan2(dx, dz); f.anim('dive'); f.downUntil = this.t + 1.1;
    this.ufManual = true; this.lastInput = this.t;
  }
  userThrow(base) {
    if (!this.hf || this.done) return;
    this.queuedThrow = base;
  }
  // kind: 'go' | 'back'; which: one runner's player id, or null for every runner.
  // Each 'go' sends the runner one base further than he's committed to; each 'back'
  // takes a base away (stop at the next bag, then turn around and go back).
  runCmd(kind, which = null) {
    if (!this.hrun || this.done || this.hr || this.awarded) return;
    for (const r of this.R) {
      if (r.state !== 'run' && r.state !== 'base') continue;
      if (this.hrun.lock && r.pl.id !== this.hrun.lock) continue;
      if (which != null && r.pl.id !== which) continue;
      if (kind === 'go') this.runnerGo(r); else this.runnerBack(r);
    }
  }
  runnerGo(r) {
    if (r.state === 'run' && r.rev) { r.rev = false; r.v = Math.min(r.v, 6); r.userTarget = r.next; return; }
    const cur = r.state === 'run' ? r.next : r.base;
    r.userTarget = Math.min(4, Math.max(r.userTarget ?? cur, cur) + 1);
  }
  runnerBack(r) {
    if (r.state === 'base') { r.userTarget = r.base; return; }
    if (r.rev) { r.userTarget = r.base; return; }
    const t = r.userTarget ?? (r.d > 63 ? r.next + 1 : r.next);
    if (t > r.next) r.userTarget = Math.max(r.next, t - 1);
    else if (r.isBatter && r.base === 0) r.userTarget = 1;   // the batter can't go back home
    else { r.rev = true; r.v = Math.min(r.v, 6); r.userTarget = r.base; }
  }
  // where each runner is headed right now, for the baserunning HUD
  runnerInfo() {
    const out = [];
    for (const r of this.R) {
      if (r.state !== 'run' && r.state !== 'base') continue;
      const forcedOff = r.forced && r.state === 'base' && r.base === r.start && !this.caught;
      let to = r.userTarget;
      if (to == null || forcedOff) to = r.state === 'base' ? (forcedOff ? r.base + 1 : r.base) : heading(r);
      // key: the base he's running to, or standing on (a runner about to leave already counts as going)
      const key = r.state === 'base' ? (to > r.base ? Math.min(4, r.base + 1) : r.base) : heading(r);
      out.push({ id: r.pl.id, key, to, from: r.state === 'base' ? r.base : r.rev ? r.next : r.base, run: r.state === 'run', rev: r.rev, user: r.userTarget != null, forced: r.forced && !this.caught, bat: r.isBatter, m: r.m });
    }
    return out;
  }
  humanHolder(f) { return this.hf && (this.hf.lock ? f.pl.id === this.hf.lock : true); }
  // ------------------------------------------------------------ update ----
  update(dt) {
    this.t += dt;
    this.updateBall();
    this.updateFielders(dt);
    this.trackBallBase();
    this.updateRunners(dt);
    this.checkEnd();
  }
  trackBallBase() {
    const b = this.ball, f = b.mode === 'held' ? b.holder : null;
    let base = 0;
    if (f && !f.throwing) for (let k = 1; k <= 4; k++) if (Math.hypot(BASES[k].x - f.pos.x, BASES[k].z - f.pos.z) < 4.5) { base = k; break; }
    if (!base) this.ballBase = null;
    else if (!this.ballBase || this.ballBase.base !== base || this.ballBase.f !== f) this.ballBase = { base, f, ready: Math.max(this.t + 0.12, f.readyAt || 0) };
  }
  sample() { const S = this.bb.S; return S[Math.min(S.length - 1, Math.floor(this.t / BB_DT))]; }
  landingSpot() {
    if (this.ball.mode !== 'flight' || this.caught || this.hr || this.dead) return null;
    const s = this.sample();
    if (s.b || !this.bb.landPos) return null;
    return [this.bb.landPos.x, this.bb.landPos.z];
  }
  updateBall() {
    const b = this.ball;
    if (b.mode === 'flight') {
      const S = this.bb.S, i = Math.min(S.length - 1, Math.floor(this.t / BB_DT)), s = S[i];
      b.si = i; b.pos.set(s.x, s.y, s.z);
      if (!this.fairKnown && this.t >= this.bb.ffT) {
        this.fairKnown = true; this.foul = this.bb.foul;
        if (this.foul) this.deadBall('foul');
      }
      if (this.bb.gr && s.hr && !this.awarded) this.awardBases(2);
      if (this.hr && s.hr && !this.hrCalled) { this.hrCalled = true; this.events.push('hrGone'); }
      if (s.b && !this.landedSaid) { this.landedSaid = true; this.events.push('land'); }
    } else if (b.mode === 'held') {
      handWorld(b.holder.m, b.holder.m.lefty ? 'R' : 'L', b.pos);
    } else if (b.mode === 'throw') {
      const th = b.thr, u = clamp((this.t - th.t0) / th.T, 0, 1);
      b.pos.lerpVectors(th.from, th.to, u); b.pos.y += Math.sin(u * Math.PI) * th.arc;
      if (u >= 1) this.throwArrived();
    }
  }
  deadBall(kind) {
    this.dead = kind;
    for (const f of this.F) if (f.task === 'chase') f.task = 'hold';
    this.finishSoon(kind === 'foul' ? 1.0 : 1.2);
  }
  awardBases(n) {
    this.awarded = true; this.dead = 'gr';
    for (const r of this.R) {
      if (r.state === 'out' || r.state === 'scored') continue;
      r.rev = false; r.target = Math.min(4, r.start + n);
      if (r.state === 'base' && r.base < r.target) { r.state = 'run'; r.next = r.base + 1; r.d = 0; r.v = 6; }
      else if (r.state === 'run' && r.next > r.target) { r.next = r.target; }
    }
    for (const f of this.F) f.task = 'hold';
    this.events.push('gr');
  }
  // ---------------------------------------------------------- fielders ----
  updateFielders(dt) {
    const t = this.t, b = this.ball;
    for (const f of this.F) {
      if (f.downUntil && t < f.downUntil) { this.diveTick(f, dt); f.sync(); continue; }
      if (f.throwing) { this.throwRelease(f); f.sync(); continue; }
      if (f === b.holder) { this.holderLogic(f, dt); f.sync(); continue; }
      if (t < f.animHold) { f.sync(); continue; }
      if (f === this.uf && this.ufManual && !this.hr && !this.dead) {
        this.manualMove(f, dt); this.tryHumanCatch(f); f.sync();
        // the ball got past you: hand control to the fielder now playing it
        if (b.mode === 'flight' && !this.hf.lock && this.chaser && this.chaser !== f && this.chaser.plan && Math.hypot(this.chaser.pos.x - b.pos.x, this.chaser.pos.z - b.pos.z) < Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z) - 15) {
          this.uf = this.chaser; this.ufManual = false; this.replan();
        }
        continue;
      }
      let tx = f.pos.x, tz = f.pos.z, hurry = true;
      if (this.hr || this.dead) {
        if (f.task === 'chase' && this.hr) { const s = this.sample(); const r = Math.hypot(s.x, s.z), th = sprayOf(s.x, s.z), fd = fenceDist(clamp(th, -45, 45)) - 6; tx = Math.sin(th * DEG) * Math.min(r, fd); tz = -Math.cos(th * DEG) * Math.min(r, fd); }
        hurry = false;
      } else if (f.task === 'chase' && f.plan && b.mode === 'flight') {
        tx = f.plan.x; tz = f.plan.z;
        this.tryField(f);
        if (b.holder === f) { f.sync(); continue; }
      } else if (f.task === 'cover') {
        const bp = BASES[f.coverBase];
        const off = f.coverBase === 4 ? [0, 2.5] : f.coverBase === 1 ? [1.5, 0.5] : [0, 0];
        tx = bp.x + off[0]; tz = bp.z + off[1];
        if (f.coverBase === 4 && f.role === 'C') { tx = 0; tz = 2.5; }
      } else if (f.task === 'backup' && this.chaser && this.chaser.plan) {
        const p = this.chaser.plan, r = Math.hypot(p.x, p.z) || 1;
        tx = p.x + (p.x / r) * 18; tz = p.z + (p.z / r) * 18;
      } else if (f.task === 'hold') {
        tx = f.home.x + (b.pos.x - f.home.x) * 0.08; tz = f.home.z + (b.pos.z - f.home.z) * 0.08; hurry = false;
      }
      this.moveF(f, tx, tz, dt, hurry);
      if (f === this.uf && b.mode === 'flight') this.tryHumanCatch(f);
      f.sync();
    }
  }
  moveF(f, tx, tz, dt, hurry = true) {
    const t = this.t;
    if (t < f.react && !this.hr) { f.anim('ready'); return; }
    const dx = tx - f.pos.x, dz = tz - f.pos.z, d = Math.hypot(dx, dz);
    const back = !f.isOF && Math.hypot(tx, tz) > Math.hypot(f.pos.x, f.pos.z) + 6;
    const sp = f.speed * (hurry ? 1 : 0.55) * (back ? 0.78 : 1);
    if (d > 0.8) {
      f.v = Math.min(sp, f.v + f.acc * dt);
      const step = Math.min(d, f.v * dt);
      f.pos.x += (dx / d) * step; f.pos.z += (dz / d) * step;
      const want = Math.atan2(dx, dz); f.yaw += angDiff(f.yaw, want) * Math.min(1, dt * 12);
      f.m.phase += step * 0.42; f.anim(f.v > 9 ? 'run' : 'jog');
    } else {
      f.v = 0;
      const bp = this.ball.pos; const want = Math.atan2(bp.x - f.pos.x, bp.z - f.pos.z);
      f.yaw += angDiff(f.yaw, want) * Math.min(1, dt * 8);
      const s = this.ball.mode === 'flight' ? this.sample() : null;
      f.anim(s && f.task === 'chase' && !s.b && s.y > 3 ? 'catchHigh' : 'ready');
    }
  }
  // human-steered movement: the stick sets direction and effort, the field edges hold you in
  manualMove(f, dt, withBall = false) {
    const rp = this.remotePos;
    if (rp && f.m.key === rp.key) { this.followRemote(f, rp); return; }
    const mag = Math.min(1, Math.hypot(this.inp.x, this.inp.z));
    if (mag > 0.15) {
      const dx = this.inp.x / mag, dz = this.inp.z / mag;
      f.v = Math.min(f.speed * mag, f.v + f.acc * 1.5 * dt);
      const nx = f.pos.x + dx * f.v * dt, nz = f.pos.z + dz * f.v * dt;
      if (inPoly(nx, nz) || Math.hypot(nx, nz) < Math.hypot(f.pos.x, f.pos.z)) { f.pos.x = nx; f.pos.z = nz; } else f.v *= 0.5;
      f.yaw += angDiff(f.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 14);
      f.m.phase += f.v * dt * 0.42; f.anim(f.v > 9 ? 'run' : 'jog');
    } else {
      f.v = Math.max(0, f.v - 45 * dt);
      if (!withBall) {
        const bp = this.ball.pos; f.yaw += angDiff(f.yaw, Math.atan2(bp.x - f.pos.x, bp.z - f.pos.z)) * Math.min(1, dt * 8);
        const s = this.ball.mode === 'flight' ? this.sample() : null;
        f.anim(s && !s.b && s.y > 3 && Math.hypot(s.x - f.pos.x, s.z - f.pos.z) < 30 ? 'catchHigh' : 'ready');
      } else f.anim('ready');
    }
  }
  // an online guest steers this fielder on their own screen: take their position (within reason)
  followRemote(f, rp) {
    let dx = rp.x - f.pos.x, dz = rp.z - f.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 30) { dx *= 30 / d; dz *= 30 / d; }
    const nx = f.pos.x + dx, nz = f.pos.z + dz;
    if (inPoly(nx, nz) || Math.hypot(nx, nz) < Math.hypot(f.pos.x, f.pos.z)) { f.pos.x = nx; f.pos.z = nz; }
    f.yaw = rp.ry; f.v = rp.v;
    f.m.phase += Math.hypot(dx, dz) * 0.42;
    f.anim(rp.v > 9 ? 'run' : rp.v > 0.5 ? 'jog' : 'ready');
  }
  tryHumanCatch(f) {
    if (this.ball.mode !== 'flight' || this.dead) return;
    const s = this.sample(); if (s.dead || s.hr) return;
    const dist = Math.hypot(s.x - f.pos.x, s.z - f.pos.z);
    const air = !s.b, okH = air ? s.y <= 11 && s.t > 0.12 : s.y <= 4.5;
    if (!okH || dist > HUMAN_REACH) return;
    const errP = Math.max(0.003, (air ? 0.006 : 0.013) + (78 - f.fld) * (air ? 0.0003 : 0.0005));
    if (Math.random() < errP) { this.error = true; this.events.push('error'); this.secure(f, false, 1.25, false); return; }
    if (air && f.isOF && Math.hypot(s.x, s.z) > fenceDist(clamp(sprayOf(s.x, s.z), -45, 45)) - 6) this.wallCatch = true;
    this.secure(f, air, 0, false);
  }
  diveTick(f, dt) {
    const dv = f.dive; if (!dv) return;
    const k = this.t - dv.t0;
    if (k < 0.4) { const nx = f.pos.x + dv.dx * 14 * dt, nz = f.pos.z + dv.dz * 14 * dt; if (inPoly(nx, nz)) { f.pos.x = nx; f.pos.z = nz; } }
    if (dv.tried || this.ball.mode !== 'flight' || k > 0.55) return;
    const s = this.sample(); if (s.dead || s.hr) return;
    const air = !s.b, okH = air ? s.y <= 11 : s.y <= 4.5;
    const dist = Math.hypot(s.x - f.pos.x, s.z - f.pos.z);
    if (!okH || dist > HUMAN_REACH + 3.5) return;
    dv.tried = true; this.dove = true;
    const p = (air ? 0.6 : 0.7) + (f.fld - 60) / 200;
    if (Math.random() < p) this.secure(f, air, 0, true);
    else this.events.push('diveMiss');
  }
  tryField(f) {
    const pl = f.plan, t = this.t, s = this.sample();
    if (!pl || t < pl.t - 0.06) return;
    const dist = Math.hypot(s.x - f.pos.x, s.z - f.pos.z);
    const air = !s.b, okH = air ? s.y <= 9.5 : s.y <= 3.2;
    const reach = pl.dive ? (air ? 9 : 6.5) : 4.2;
    if (okH && dist <= reach && !s.dead && !s.hr) {
      if (pl.dive) {
        this.dove = true;
        f.anim('dive'); f.downUntil = t + 1.25; f.yaw = Math.atan2(s.x - f.pos.x, s.z - f.pos.z);
        const p = (air ? 0.5 : 0.62) + (f.fld - 60) / 180;
        if (Math.random() > p) { this.events.push('diveMiss'); f.excluded = true; this.replan(); f.excluded = false; f.task = 'hold'; return; }
        this.secure(f, air, 0, true);
        return;
      }
      const errP = Math.max(0.003, (air ? 0.006 : 0.013) + (78 - f.fld) * (air ? 0.0003 : 0.0005));
      if (Math.random() < errP) { this.error = true; this.events.push('error'); this.secure(f, false, 1.25, false); return; }
      if (air && f.isOF && Math.hypot(s.x, s.z) > fenceDist(clamp(sprayOf(s.x, s.z), -45, 45)) - 6) this.wallCatch = true;
      this.secure(f, air, 0, false);
    } else if (t > pl.t + 0.4) {
      this.replan();
    }
  }
  secure(f, air, bobble, dove) {
    const b = this.ball;
    b.mode = 'held'; b.holder = f; f.holding = false; f.touched = 0; f.readyAt = this.t + bobble + 0.12;
    if (!this.firstFielder) { this.firstFielder = f; this.firstAir = air; }
    if (!dove) { f.anim(air ? 'catchHigh' : 'fieldLow'); f.animHold = this.t + 0.3; }
    if (this.hf && !this.hf.lock) { if (this.uf !== f) this.ufManual = false; this.uf = f; }
    if (!this.fairKnown && !air) {
      const r = Math.hypot(b.pos.x, b.pos.z);
      if (r < 95) { this.fairKnown = true; this.foul = !isFairAngle(sprayOf(f.pos.x, f.pos.z)); if (this.foul) { this.deadBall('foul'); return; } }
    }
    if (air && !bobble) {
      this.caught = true; this.fairKnown = true; this.foul = false;
      const batter = this.R.find((r) => r.isBatter);
      this.recordOut(batter, 'catch', 0);
      for (const r of this.R) {
        r.forced = false; r.wait = false;
        if (r.isBatter || r.state === 'out' || r.state === 'scored') continue;
        // anyone off his base has to get back and tag up before he can advance
        if (r.state === 'run' || r.base !== r.start) {
          r.leftEarly = true; r.userTarget = null;
          if (r.state === 'run' && !r.rev) { r.rev = true; r.v = Math.min(r.v, 6); }
          else if (r.state === 'base') { r.state = 'run'; r.rev = true; r.next = r.base; r.base--; r.d = 90; r.v = 0; }
        }
      }
      SND.pop(0.7);
      this.events.push('catch');
    } else SND.thud(0.4);
    f.decideAt = this.t + bobble + (dove ? 0.9 : 0) + (air ? (f.isOF ? 0.7 : 0.35) : f.isOF ? 1.0 : 0.5);
    f.promptStart = null;
  }
  recordOut(r, how, base) {
    if (r.state === 'out') return;
    const force = how === 'force';
    r.state = 'out'; r.outT = this.t; this.outs++;
    this.outEvents.push({ r, how, base, t: this.t });
    for (const o of this.R) if (o.start > r.start) o.forced = false;
    if (this.outs >= 3) { this.thirdOutForce = force || r.isBatter; this.finishSoon(1.0); }
    this.events.push('out');
  }
  // --------------------------------------------------- holding & throws ----
  holderLogic(f, dt) {
    const t = this.t;
    if (f.throwing) return;
    if (this.done || this.outs >= 3 || this.dead) { f.anim('ready'); return; }
    if (f.runTo) {
      const bp = BASES[f.runTo], dx = bp.x - f.pos.x, dz = bp.z - f.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.4) { this.ballAtBase(f.runTo, f); f.touched = f.runTo; f.runTo = null; f.decideAt = t + 0.3; f.promptStart = null; f.anim('ready'); return; }
      const step = Math.min(d, f.speed * dt); f.pos.x += (dx / d) * step; f.pos.z += (dz / d) * step; f.yaw = Math.atan2(dx, dz); f.m.phase += step * 0.42; f.anim('run');
      return;
    }
    if (t < f.animHold) return;
    const human = this.humanHolder(f) && f === this.uf;
    // a human carrying the ball: step on bags and tag runners on the way
    if (human && this.queuedThrow == null && Math.hypot(this.inp.x, this.inp.z) > 0.15) {
      this.manualMove(f, dt, true);
      for (let b = 1; b <= 4; b++) {
        const bp = BASES[b];
        if (Math.hypot(bp.x - f.pos.x, bp.z - f.pos.z) < 2.2) { if (f.touched !== b) { f.touched = b; this.ballAtBase(b, f); } }
        else if (f.touched === b) f.touched = 0;
      }
      for (const r of this.R) {
        if (r.state === 'run' && r.delay <= 0 && Math.hypot(r.pos.x - f.pos.x, r.pos.z - f.pos.z) < 3.2) { this.recordOut(r, 'tag', heading(r)); this.umpCall = { base: heading(r), call: 'out' }; }
      }
      f.promptStart = t; this.prompt = this.userDef; f.holding = false;
      return;
    }
    if (!f.holding) f.anim('ready');
    if (t < f.decideAt) return;
    if (this.hf && this.humanHolder(f)) {
      if (this.queuedThrow != null) { const base = this.queuedThrow; this.queuedThrow = null; this.prompt = false; f.holding = false; this.execThrow(f, base); return; }
      if (this.userDef) {
        const anyRunning = this.R.some((r) => r.state === 'run');
        if (anyRunning || !f.holding) {
          if (f.promptStart == null) f.promptStart = t;
          this.prompt = true;
          if (t - f.promptStart < (this.firstThrowDone ? 0.9 : 1.4)) return;
        }
      }
    }
    this.prompt = false;
    const c = this.chooseThrow(f);
    if (c.type === 'throw') { f.holding = false; this.execThrow(f, c.base); }
    else if (c.type === 'run') { f.holding = false; f.runTo = c.base; }
    else if (c.type === 'wait') { f.holding = false; f.decideAt = t + 0.1; f.anim('ready'); }
    else { f.holding = true; f.decideAt = t + 0.2; }
  }
  chooseThrow(f) {
    const opts = [];
    for (let base = 4; base >= 1; base--) {
      const runner = this.R.find((r) => r.state === 'run' && heading(r) === base);
      if (!runner) continue;
      const bp = BASES[base], d = Math.hypot(bp.x - f.pos.x, bp.z - f.pos.z);
      const eta = runner.eta();
      const force = this.forcedTo(runner, base);
      let tb, type;
      // already on the bag with the ball: stand there and put the tag on him
      if (d < 4.5 && !force) { opts.push({ base, type: 'wait', margin: eta, runner }); continue; }
      if (d < 24 && d / f.speed < eta - 0.15) { tb = d / f.speed; type = 'run'; }
      else { tb = 0.22 + d / throwSpeed(f, d) + (force ? 0.03 : 0.15); type = 'throw'; }
      opts.push({ base, type, margin: eta - tb, runner });
    }
    const good = opts.filter((o) => o.margin > 0.1);
    if (good.length) {
      good.sort((a, b) => b.base - a.base);
      let c = good[0];
      const sure = good.find((o) => o.margin > 0.5);
      if (c.margin < 0.3 && sure) c = sure;
      return c;
    }
    const moving = this.R.filter((r) => r.state === 'run');
    if (moving.length) {
      const lead = moving.reduce((a, b) => (heading(b) > heading(a) ? b : a));
      const bp = BASES[heading(lead)], d = Math.hypot(bp.x - f.pos.x, bp.z - f.pos.z);
      if (d > 10) return { type: 'throw', base: heading(lead) };
    }
    return { type: 'hold' };
  }
  execThrow(f, base) {
    const bp = BASES[base], d = Math.hypot(bp.x - f.pos.x, bp.z - f.pos.z);
    if (d < 7) { f.runTo = base; return; }
    f.yaw = Math.atan2(bp.x - f.pos.x, bp.z - f.pos.z);
    f.anim('throw'); f.throwing = true; f.throwBase = base; f.releaseAt = this.t + 0.24;
    this.firstThrowDone = true;
    this.lastThrow = { from: f.role, base };
  }
  throwRelease(f) {
    if (this.t < f.releaseAt) return;
    f.throwing = false;
    const base = f.throwBase, bp = BASES[base];
    const from = handWorld(f.m, f.m.lefty ? 'L' : 'R', new V3());
    const d = Math.hypot(bp.x - from.x, bp.z - from.z);
    const speed = throwSpeed(f, d) * rand(0.95, 1.03);
    const errP = 0.008 + (75 - (f.pl.arm ?? 60)) * 0.0002 + (d > 200 ? 0.01 : 0);
    this.ball.mode = 'throw'; this.ball.holder = null;
    this.ball.thr = { from, to: new V3(bp.x, 4.2, bp.z), t0: this.t, T: Math.max(0.15, d / speed), arc: d * 0.02 + (d > 150 ? d * 0.03 : 0), base, err: Math.random() < errP, by: f };
    f.task = 'hold';
    f.anim('throw');
    f.animHold = this.t + 0.35;
  }
  receiverFor(base, exclude) {
    const c = this.cover && this.cover[base];
    if (c && c !== exclude) return c;
    let best = null, bd = 1e9;
    for (const f of this.F) { if (f === exclude) continue; const d = f.pos.distanceTo(BASES[base]); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  throwArrived() {
    const th = this.ball.thr, base = th.base;
    const recv = this.receiverFor(base, th.by);
    this.ball.mode = 'held'; this.ball.holder = recv; recv.holding = false; recv.touched = base;
    const bp = BASES[base];
    if (recv.pos.distanceTo(bp) > 3) recv.pos.set(bp.x + (base === 4 ? 0 : 0.8), 0, bp.z + (base === 4 ? 2 : 0.8));
    recv.anim('catchHigh'); recv.animHold = this.t + 0.22; recv.promptStart = null; recv.readyAt = this.t + (th.err ? 1.1 : 0.1);
    if (this.hf && !this.hf.lock) { this.uf = recv; this.ufManual = false; }
    SND.pop(0.55);
    if (th.err) { this.error = true; this.events.push('throwError'); recv.decideAt = this.t + 1.1; return; }
    this.ballAtBase(base, recv);
    recv.decideAt = this.t + (base === 2 ? 0.58 : 0.45);
  }
  // The ball reached a bag. Only a force (or doubling a runner off after a catch) is an
  // out on the spot; anyone else has to be tagged when he gets there (see updateRunners).
  ballAtBase(base, f) {
    for (const r of this.R) {
      if (r.state !== 'run') continue;
      const forcedHere = r.forced && !r.rev && r.next === base && r.next === r.start + 1;
      const appeal = this.caught && r.rev && r.leftEarly && r.base === base && base === r.start;
      if (heading(r) === base && (forcedHere || appeal)) {
        if (r.eta() > 0) { this.recordOut(r, forcedHere ? 'force' : 'appeal', base); this.umpCall = { base, call: 'out' }; }
        else this.umpCall = { base, call: 'safe' };
      } else if (r.forced && r.rev && r.next === base && r.next === r.start + 1) { this.recordOut(r, 'force', base); this.umpCall = { base, call: 'out' }; }
      else if (heading(r) === base && r.eta() <= 0.12) this.umpCall = { base, call: 'safe' };
    }
  }
  // is this runner forced to the base he's running to?
  forcedTo(r, base) { return r.forced && !r.rev && r.next === base && base === r.start + 1; }
  // ----------------------------------------------------------- runners ----
  baseFree(b, me) {
    if (b >= 4) return true;
    return !this.R.some((r) => r !== me && ((r.state === 'base' && r.base === b) || (r.state === 'run' && heading(r) === b)));
  }
  ballETA(base) {
    const bp = BASES[base], b = this.ball;
    if (this.dead || this.hr) return Infinity;
    if (b.mode === 'held') {
      const f = b.holder, rem = Math.max(0, f.decideAt - this.t) + (this.userDef ? 0.35 : 0) + 0.22;
      const d = Math.hypot(bp.x - f.pos.x, bp.z - f.pos.z);
      return rem + (d < 10 ? d / f.speed : d / throwSpeed(f, d));
    }
    if (b.mode === 'throw') {
      const th = b.thr, rem = Math.max(0, th.t0 + th.T - this.t);
      if (th.base === base) return rem + (th.err ? 1.2 : 0);
      const bb = BASES[th.base];
      return rem + 0.45 + Math.hypot(bp.x - bb.x, bp.z - bb.z) / 120;
    }
    const f = this.chaser;
    if (!f || !f.plan) return 12;
    const rem = Math.max(0, f.plan.t - this.t) + (f.plan.air ? 0.7 : f.isOF ? 1.0 : 0.5);
    const d = Math.hypot(bp.x - f.plan.x, bp.z - f.plan.z);
    return rem + d / throwSpeed(f, d);
  }
  shouldAdvance(r, rounding) {
    const nb = r.base + 1;
    if (nb > 4 || !this.baseFree(nb, r)) return false;
    if (r.forced && r.base === r.start && !this.caught) return true;
    if (this.ball.mode === 'flight' && !this.caught && r.wait) return false;
    const tRun = 90 / r.top + (rounding ? 0.12 : 0.5);
    const tBall = this.ballETA(nb);
    let margin = this.outs === 2 ? 0.1 : 0.4;
    if (nb === 4) margin -= 0.12;
    if (nb === 3 && this.outs === 0) margin += 0.25;
    if (r.isBatter && nb === 2) margin += this.outs < 2 ? 0.3 : 0.15;
    return tRun + margin < tBall;
  }
  sendRunner(r) {
    r.state = 'run'; r.next = r.base + 1; r.rev = false;
    r.d = r.lead > 0 && !this.caught ? r.lead : 0; r.lead = 0; r.leadVis = 0;
    r.v = r.d > 0 ? r.top * 0.45 : 0;
  }
  updateRunners(dt) {
    const t = this.t;
    const live = this.R.filter((r) => r.state === 'run' || r.state === 'base');
    live.sort((a, b) => b.base + (b.state === 'run' ? 0.5 : 0) - (a.base + (a.state === 'run' ? 0.5 : 0)));
    for (const r of live) {
      if (r.state === 'base') {
        if (r.wait && r.leadVis > 0) r.leadVis = Math.max(0, r.leadVis - dt * 16);
        if (this.outs >= 3 || this.dead) continue;
        const forcedOff = r.forced && r.base === r.start && !this.caught;
        if (r.userTarget != null && !forcedOff) {
          // a human is running this guy: go only where he was told
          if (r.userTarget > r.base && r.base < 4 && this.baseFree(r.base + 1, r)) {
            if (r.wait && this.ball.mode === 'flight' && !this.caught) r.leftEarly = true;
            r.wait = false; this.sendRunner(r);
          }
          continue;
        }
        if (r.wait) {
          const s = this.sample();
          if (this.caught || this.ball.mode !== 'flight' || s.b) r.wait = false; else continue;
        }
        if (forcedOff) { this.sendRunner(r); continue; }
        if (r.autoRun && r.base === r.start && !this.caught && this.baseFree(r.base + 1, r)) { this.sendRunner(r); continue; }
        if (this.shouldAdvance(r, false)) this.sendRunner(r);
        continue;
      }
      // running
      if (r.delay > 0) { r.delay -= dt; continue; }
      // a fielder waiting on the bag with the ball tags him as he arrives
      const bb = this.ballBase, hb = heading(r);
      if (bb && bb.base === hb && !this.dead && this.outs < 3 && !this.hr && !this.awarded) {
        const rem = r.rev ? r.d : 90 - r.d;
        if (rem <= 2.2) {
          if (t >= bb.ready) { this.recordOut(r, 'tag', hb); this.umpCall = { base: hb, call: 'out' }; continue; }
          if (r.safeAt !== hb) { r.safeAt = hb; this.umpCall = { base: hb, call: 'safe' }; }
        } else if (!r.rev && !r.aiRev && r.userTarget == null && !this.forcedTo(r, hb) && rem > 20 && r.d < 65 && r.base > 0 && this.baseFree(r.base, r)) {
          // the ball beat him there: the AI runner pulls up and heads back
          r.rev = true; r.aiRev = true; r.v = Math.min(r.v, 6);
        }
      }
      const top = this.hr || this.awarded ? r.top * 0.68 : r.top;
      r.v = Math.min(top, r.v + RUN_ACC * dt);
      r.phase += r.v * dt * 0.42;
      if (r.rev) {
        r.d -= r.v * dt;
        if (r.d <= 0) {
          // runners going back to tag up after a catch retrace every base they passed
          if (r.leftEarly && r.base > r.start) { r.next = r.base; r.base--; r.d = 90; continue; }
          r.d = 0; r.rev = false; r.state = 'base'; r.v = 0; r.next = null; r.leftEarly = false;
          if (r.userTarget != null && r.userTarget < r.base) r.userTarget = r.base;
        }
        continue;
      }
      r.d += r.v * dt;
      if (r.d >= 90) {
        r.base = r.next; r.d = 0; r.next = null;
        if (r.base === 4) {
          r.state = 'scored';
          if (this.outs < 3) { this.runs.push({ r, t }); this.events.push('run'); }
          continue;
        }
        if (this.hr || this.awarded) {
          if (r.base < r.target) r.next = r.base + 1; else { r.state = 'base'; r.v = 0; }
          continue;
        }
        if (r.userTarget != null) {
          if (r.userTarget > r.base && this.baseFree(r.base + 1, r)) r.next = r.base + 1;
          else { r.state = 'base'; r.v = 0; }
          continue;
        }
        if (this.outs < 3 && this.shouldAdvance(r, true)) r.next = r.base + 1;
        else { r.state = 'base'; r.v = 0; }
      }
    }
  }
  // ------------------------------------------------------------- finish ----
  checkEnd() {
    if (this.done) return;
    const moving = this.R.some((r) => r.state === 'run');
    // a runner took off again while the play was winding down: keep it going
    if (this.endAt != null && this.endSoft && moving) { this.endAt = null; this.endSoft = false; }
    if (this.endAt != null) { if (this.t >= this.endAt) this.done = true; return; }
    if (this.outs >= 3) { this.finishSoon(0.9); return; }
    if (this.hr || this.awarded) { if (!moving) this.finishSoon(0.8); return; }
    const b = this.ball;
    if (!moving && b.mode === 'held' && b.holder && b.holder.holding && !b.holder.runTo && !this.prompt) {
      const wants = (r) => (r.userTarget != null ? r.userTarget > r.base && this.baseFree(r.base + 1, r) : this.shouldAdvance(r, false));
      if (!this.R.some((r) => r.state === 'base' && !r.wait && wants(r))) { this.finishSoon(this.hrun ? 1.0 : 0.7); this.endSoft = true; }
    }
    if (this.t > 45) this.done = true;
  }
  finishSoon(d) { if (this.endAt == null) { this.endAt = this.t + d; this.endSoft = false; } }
  skipTrot() {
    for (const r of this.R) {
      if (r.state !== 'run') continue;
      const tgt = r.target ?? 4;
      if (tgt >= 4) { r.state = 'scored'; r.base = 4; if (this.outs < 3) this.runs.push({ r, t: this.t }); }
      else { r.state = 'base'; r.base = tgt; r.d = 0; r.v = 0; }
    }
    this.done = true;
  }
  summary() {
    const batter = this.R.find((r) => r.isBatter);
    let runs = this.runs;
    if (this.outs >= 3 && this.thirdOutForce) runs = [];
    for (const r of this.R) {
      if (r.state !== 'run') continue;
      if (r.rev) r.base = r.d < 45 ? r.base : r.next; else r.base = r.d > 45 ? r.next : r.base;
      r.state = r.base >= 4 ? 'scored' : 'base';
      if (r.state === 'scored' && this.outs < 3) runs.push({ r, t: this.t });
    }
    // two runners can never share a bag after a messy play: push the trailing one back
    const taken = new Set();
    for (const r of [...this.R].filter((x) => x.state === 'base').sort((a, b) => b.base - a.base)) {
      while (taken.has(r.base) && r.base > 1) r.base--;
      taken.add(r.base);
    }
    const forceOutOther = this.outEvents.some((e) => e.r !== batter && e.how === 'force');
    return {
      foul: this.foul && !this.caught, hr: this.hr, gr: this.awarded, caught: this.caught,
      outsMade: this.outs - this.startOuts, outs: Math.min(3, this.outs),
      runs: runs.length, scorers: runs.map((x) => x.r.pl), error: this.error,
      batterOut: batter.state === 'out', batterBase: batter.state === 'out' ? 0 : batter.state === 'scored' ? 4 : batter.base,
      fc: batter.state !== 'out' && forceOutOther, dp: this.outs - this.startOuts >= 2,
      first: this.firstFielder ? this.firstFielder.role : null, firstAir: this.firstAir, dove: this.dove, wallCatch: this.wallCatch,
      bases: [null, ...[1, 2, 3].map((b) => { const r = this.R.find((x) => x.state === 'base' && x.base === b); return r ? r.pl : null; })],
      outEvents: this.outEvents,
    };
  }
}
