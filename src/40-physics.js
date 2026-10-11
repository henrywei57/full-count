// ============================================================================
// Physics: pitch trajectories and batted-ball flight (drag + Magnus lift)
// ============================================================================

const CONTACT_Z = -0.6;   // where bat meets ball on a well-timed swing
const CATCH_Z = 2.35;     // catcher's mitt

// Pitches use constant acceleration (gravity + spin break + drag), solved so the
// ball crosses the plate exactly at the intended (already error-adjusted) target.
function buildPitch(pitcher, pitch, target, power, scale, fatigue, rel) {
  const PT = PITCH_TYPES[pitch.type];
  const armX = pitcher.throws === 'L' ? 1 : -1;
  const mph = pitch.velo * (0.955 + 0.045 * power) - fatigue * 2.4;
  const dz = -rel.z;
  const vStart = mph * MPH / scale;
  const T = dz / (vStart * 0.96);
  const brk = pitch.brk * (0.88 + 0.16 * power) * (1 - fatigue * 0.12) * lerp(1, PARK.air || 1, 0.6);   // thin air: less break
  const hM = (PT.h * brk) / 12, vM = (PT.v * brk) / 12;
  const a = new V3((2 * hM * armX) / (T * T), -G_ACC / (scale * scale) + (2 * vM) / (T * T), (-0.08 * vStart) / T);
  const tgt = new V3(target.x, target.y, 0);
  const v0 = tgt.clone().sub(rel).addScaledVector(a, -0.5 * T * T).divideScalar(T);
  return { rel: rel.clone(), v0, a, T, mph, type: pitch.type, pitch, target: tgt, power, scale };
}
function pitchPos(P, t, out) { return out.copy(P.rel).addScaledVector(P.v0, t).addScaledVector(P.a, 0.5 * t * t); }
function pitchTimeAtZ(P, z) {
  const A = 0.5 * P.a.z, B = P.v0.z, C = P.rel.z - z;
  if (Math.abs(A) < 1e-9) return -C / B;
  const D = B * B - 4 * A * C;
  if (D < 0) return P.T * 1.1;
  const s = Math.sqrt(D), r1 = (-B + s) / (2 * A), r2 = (-B - s) / (2 * A);
  const c = [r1, r2].filter((x) => x > 0);
  return c.length ? Math.min(...c) : P.T;
}

// Batted ball: integrate with drag & lift. Records samples at 120 Hz and flags
// landings, wall caroms, home runs, and balls leaving the field of play.
const BB_K = 0.0019, BB_KL = 0.0008, BB_DT = 1 / 120;
function simBatted(origin, ev, la, spray, opts = {}) {
  const v = ev * MPH, L = la * DEG, S = spray * DEG;
  const vel = new V3(Math.cos(L) * Math.sin(S), Math.sin(L), -Math.cos(L) * Math.cos(S)).multiplyScalar(v);
  const pos = origin.clone();
  let spin = clamp((la + 5) / 30, 0, 1);
  if (la > 40) spin *= clamp(1 - (la - 40) / 30, 0.2, 1);
  if (la < -4) spin = -0.35;
  const out = [];
  let t = 0, bounced = false, rolling = false, hr = false, gr = false, dead = false, wall = false;
  let landT = null, landPos = null, hrT = null, deadT = null, maxH = pos.y;
  const acc = new V3(), Ld = new V3(), air = PARK.air || 1, K = BB_K * air, KL = BB_KL * air;   // thin air: less drag and lift
  for (let n = 0; n < 120 * 16; n++) {
    if (!rolling) {
      const sp = vel.length();
      acc.set(0, -G_ACC, 0).addScaledVector(vel, -K * sp);
      if (spin !== 0 && sp > 1) {
        const h = Math.hypot(vel.x, vel.z) || 1e-6;
        Ld.set((-vel.x * vel.y) / h, h, (-vel.z * vel.y) / h);
        const ln = Ld.length();
        if (ln > 1e-6) acc.addScaledVector(Ld, (KL * spin * sp * sp) / ln);
      }
      vel.addScaledVector(acc, BB_DT); pos.addScaledVector(vel, BB_DT);
      if (pos.y > maxH) maxH = pos.y;
      const floor = dead ? -50 : BALL_R;
      if (pos.y <= floor && vel.y < 0) {
        if (opts.noWalls) { out.push({ t, x: pos.x, y: pos.y, z: pos.z }); break; }
        pos.y = BALL_R;
        if (!bounced) { landT = t; landPos = pos.clone(); }
        bounced = true;
        const dirt = isDirt(pos.x, pos.z);
        if (-vel.y > 4.5) {
          // shallow impacts skid and keep most of their pace; steep ones die in the grass
          const steep = clamp(-vel.y / (vel.length() || 1), 0, 1);
          vel.y = -vel.y * (dirt ? 0.46 : 0.4);
          const f = lerp(dirt ? 0.9 : 0.86, dirt ? 0.62 : 0.55, steep); vel.x *= f; vel.z *= f; spin = 0;
        } else { rolling = true; vel.y = 0; }
      }
    } else {
      const h = Math.hypot(vel.x, vel.z), dec = (isDirt(pos.x, pos.z) ? 6.5 : 8.5) * BB_DT, nh = Math.max(0, h - dec);
      if (h > 0) { vel.x *= nh / h; vel.z *= nh / h; }
      pos.x += vel.x * BB_DT; pos.z += vel.z * BB_DT;
    }
    if (!opts.noWalls && !hr && !gr && !dead) {
      const r = Math.hypot(pos.x, pos.z), th = Math.atan2(pos.x, -pos.z) / DEG;
      if (Math.abs(th) <= 45.4) {
        const fd = fenceDist(th);
        if (r >= fd - 0.35) {
          if (pos.y > fenceH(th)) {
            if (!bounced) { hr = true; hrT = t; } else { gr = true; hrT = t; }
          } else {
            const nx = pos.x / r, nz = pos.z / r, vr = vel.x * nx + vel.z * nz;
            if (vr > 0) {
              vel.x -= 1.32 * vr * nx; vel.z -= 1.32 * vr * nz; vel.x *= 0.82; vel.z *= 0.82; vel.y *= 0.8;
              pos.x = nx * (fd - 0.45); pos.z = nz * (fd - 0.45); wall = true;
            }
          }
        }
      } else if (!inPoly(pos.x, pos.z)) { dead = true; deadT = t; rolling = false; }
    }
    out.push({ t, x: pos.x, y: pos.y, z: pos.z, b: bounced, g: pos.y <= BALL_R + 0.03, hr: hr || gr, dead });
    t += BB_DT;
    if (rolling && Math.hypot(vel.x, vel.z) < 0.35) break;
    if ((hr || gr) && t - hrT > 2.2) break;
    if (dead && t - deadT > 1.4) break;
  }
  const res = { S: out, ev, la, spray, hr, gr, dead, wall, landT, landPos, maxH, hrT, deadT };
  if (opts.noWalls) return res;
  // fair / foul: decided where the ball first touches ground past the bags, leaves the park, or comes to rest
  let foul = false, ffT = null, decided = false;
  for (const s of out) {
    const r = Math.hypot(s.x, s.z), th = sprayOf(s.x, s.z);
    if (s.hr) { decided = true; foul = false; ffT = s.t; break; }
    if (s.dead) { decided = true; foul = true; ffT = s.t; break; }
    if (s.g && r >= 95) { decided = true; foul = !isFairAngle(th); ffT = s.t; break; }
  }
  if (!decided) { const s = out[out.length - 1]; foul = !isFairAngle(sprayOf(s.x, s.z)) || s.z > 0.8; ffT = s.t; }
  res.foul = foul; res.ffT = ffT;
  res.dist = landPos ? Math.hypot(landPos.x, landPos.z) : 0;
  if (hr) {
    const proj = simBatted(origin, ev, la, spray, { noWalls: true });
    const e = proj.S[proj.S.length - 1];
    res.dist = Math.hypot(e.x, e.z);
  }
  return res;
}
