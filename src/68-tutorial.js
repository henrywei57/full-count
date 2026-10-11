// ============================================================================
// Tutorial: short hands-on lessons built on the practice drills. Each step asks
// you to actually do the thing (make contact, throw a strike, make a throw...)
// and moves on by itself once you have. Game code reports what happened through
// tutNote(event); everything else lives here.
// ============================================================================

const LESSONS = [
  {
    id: 'hit', title: 'Hitting', drill: 'bat',
    intro: "You're at the plate against slow, hittable pitches. Learn to aim, time your swing, and lay off bad pitches.",
    steps: [
      { ev: 'contact', n: 2, goal: 'Make contact', text: 'Move the mouse to aim the <b>PCI</b>, the circle over the plate. <kbd>Click</kbd> (or <kbd>Space</kbd>) to swing as the pitch arrives.', tip: 'The orange ring shows where the pitch will cross: put the PCI on it. Gamepad: left stick aims, A swings.' },
      { ev: 'powerSwing', n: 1, goal: 'Take a power swing', text: '<kbd>Right-click</kbd> (or <kbd>L</kbd>) is a <b>power swing</b>: a smaller PCI, but the ball jumps off the bat. <kbd>J</kbd> is a contact swing with a bigger PCI.', tip: 'Feedback under the zone shows your timing and contact after each swing.' },
      { ev: 'takeBall', n: 1, goal: 'Take a ball', text: "Pitches outside the box are <b>balls</b>. Four of them is a walk. Let one go by without swinging.", tip: 'The strike zone box is drawn over the plate. Toggle it with Z.' },
    ],
  },
  {
    id: 'pitch', title: 'Pitching', drill: 'pitch',
    intro: "You're on the mound. Pitching is three clicks on the meter: start, power, accuracy.",
    steps: [
      { ev: 'pitch', n: 3, goal: 'Throw pitches', text: 'Pick a pitch with <kbd>1</kbd>&ndash;<kbd>5</kbd> and aim with the mouse. Then <kbd>Click</kbd> three times: to start the meter, near the top for <b>power</b>, and on the <b>gold line</b> for accuracy.', tip: 'The pitch list on the right shows each pitch and its speed. Gamepad: LB / RB pick, A clicks.' },
      { ev: 'strike', n: 2, goal: 'Throw strikes', text: 'Now throw <b>strikes</b>: aim inside the zone and stop the meter right on the gold line. Missing the line pulls the pitch off target.', tip: 'Fouls and balls in play count too: the batter offered at it.' },
    ],
  },
  {
    id: 'field', title: 'Fielding', drill: 'field',
    intro: 'Balls come off the bat every few seconds. You control the fielder playing the ball.',
    steps: [
      { ev: 'move', n: 2, goal: 'Run your fielder', text: 'The fielder with the <b>gold ring</b> is yours. <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> runs him. The AI helps until you touch the keys. A blue ring marks where a fly ball will land.', tip: 'Space dives. Q switches to the fielder closest to the ball. Gamepad: left stick runs, RB dives.' },
      { ev: 'throw', n: 2, goal: 'Make throws', text: 'Once you have the ball, throw with <kbd>1</kbd> first, <kbd>2</kbd> second, <kbd>3</kbd> third or <kbd>4</kbd> home. The best throw is ringed in <b>green</b>.', tip: 'Arrow keys throw too (→ first, ↑ second, ← third, ↓ home). Wait too long and the AI throws for you.' },
    ],
  },
  {
    id: 'run', title: 'Baserunning', drill: 'run',
    intro: "You're on base and the CPU is batting. You decide when your runners go.",
    steps: [
      { ev: 'runCmd', n: 2, goal: 'Give running orders', text: 'When the ball is hit, <kbd>E</kbd> sends every runner one more base and <kbd>Q</kbd> takes a base back. <b>Click a runner</b> first (on the field, his tag, or the mini diamond) to run just him.', tip: 'The runner panel and the tags over each runner show where everyone is headed. Only force plays are outs on the bag; everyone else has to be tagged.' },
      { ev: 'stealTry', n: 1, goal: 'Call a steal', text: 'Steal: before the pitch, press <kbd>E</kbd> (or hold <kbd>1</kbd> + <kbd>E</kbd>) and your runner goes on the pitcher\'s first move. <kbd>Q</kbd> calls it off.', tip: "Fast runners get better jumps; a strong-armed catcher throws more of them out." },
    ],
  },
  {
    id: 'pick', title: 'Pickoffs', drill: 'pitch', runners: true,
    intro: 'Back on the mound, now with a runner on. Keep him close.',
    steps: [
      { ev: 'pick', n: 1, goal: 'Throw over', text: 'Before you start the meter, <kbd>Shift</kbd> + the base number (<kbd>1</kbd>, <kbd>2</kbd> or <kbd>3</kbd>) throws over, or click the <b>PICKOFF</b> buttons.', tip: "The runner usually dives back, but one who was going on that pitch gets caught leaning. Gamepad: hold LT + B / Y / X." },
    ],
  },
];
const TUT = { on: false, only: false, lesson: 0, step: 0, count: 0, state: 'off', teams: null, doneT: 0 };
const tutStepDef = () => (TUT.on ? LESSONS[TUT.lesson].steps[TUT.step] : null);
// game code reports what the player just did
function tutNote(ev, k = 1) {
  const s = tutStepDef();
  if (!s || TUT.state !== 'step' || s.ev !== ev) return;
  TUT.count = Math.min(s.n, TUT.count + k);
  tutRender();
  if (TUT.count >= s.n) {
    TUT.state = 'done'; tutRender();
    SND.init(); if (SND.ctx) SND.fanfare();
    clearTimeout(TUT.doneT); TUT.doneT = setTimeout(tutNext, 1600);
  }
}
// what the tutorial pitcher throws: mostly hittable strikes while you learn to swing, clear balls for the take
function tutPitchAim(aim) {
  const s = tutStepDef();
  if (!s || G.drill !== 'bat') return;
  if (s.ev === 'takeBall' && Math.random() < 0.6) { aim.x = (Math.random() < 0.5 ? -1 : 1) * rand(1.3, 1.6); aim.y = rand(2.0, 3.0); }
  else if (s.ev !== 'takeBall' && Math.random() < 0.8) { aim.x = rand(-0.35, 0.35); aim.y = rand(2.1, 2.9); }
}
function tutStart(only) {
  TUT.on = true; TUT.only = only != null; TUT.lesson = only ?? 0;
  TUT.teams = [teamSpec(menuTeam('away')), teamSpec(menuTeam('home'))];
  try { localStorage.setItem('fullcount.tutSeen', '1'); } catch (e) { /* ignore */ }
  tutLesson();
}
function tutLesson() {
  const L = LESSONS[TUT.lesson];
  TUT.step = 0; TUT.count = 0; TUT.state = 'intro';
  startGame({ mode: 'tutorial', drill: L.drill, teams: TUT.teams, diff: 0, ump: 2, manual: 1, tutRunners: !!L.runners });
  G.hold = true;   // wait on the lesson card
  tutRender();
}
function tutGo() { if (TUT.state !== 'intro') return; TUT.state = 'step'; G.hold = false; SND.init(); tutRender(); }
function tutNext() {
  if (!TUT.on) return;
  clearTimeout(TUT.doneT);
  const L = LESSONS[TUT.lesson];
  if (TUT.step + 1 < L.steps.length) { TUT.step++; TUT.count = 0; TUT.state = 'step'; tutRender(); return; }
  if (!TUT.only && TUT.lesson + 1 < LESSONS.length) { TUT.lesson++; tutLesson(); return; }
  TUT.state = 'finish'; G.hold = true; tutRender();
}
function tutEnd() { TUT.on = false; TUT.state = 'off'; clearTimeout(TUT.doneT); G.hold = false; tutRender(); }
function tutRender() {
  const el = $('tutCard');
  if (!TUT.on || TUT.state === 'off') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const L = LESSONS[TUT.lesson], s = L.steps[TUT.step];
  const lessonNo = `LESSON ${TUT.lesson + 1} OF ${LESSONS.length}`;
  el.classList.toggle('big', TUT.state === 'intro' || TUT.state === 'finish');
  if (TUT.state === 'intro') {
    el.innerHTML = `<div class="tut-head"><span>TUTORIAL</span><span>${TUT.only ? '' : lessonNo}</span></div><h2>${L.title}</h2><p class="tut-text">${L.intro}</p>`
      + `<ol class="tut-list">${L.steps.map((x) => `<li>${x.goal}</li>`).join('')}</ol>`
      + `<div class="tut-actions"><button class="cta" data-tut="go">START</button><button class="ghost" data-tut="skipLesson">Skip lesson</button><button class="ghost" data-tut="exit">Exit tutorial</button></div>`;
    return;
  }
  if (TUT.state === 'finish') {
    el.innerHTML = `<div class="tut-head"><span>TUTORIAL</span><span>COMPLETE</span></div><h2>${TUT.only ? `${L.title} done` : "You're ready"}</h2>`
      + `<p class="tut-text">${TUT.only ? 'Nice work. Pick another lesson from the menu, or jump into a game.' : 'That covers hitting, pitching, fielding and running the bases. Play Ball for a full game, Practice to drill any one skill, or Online 1v1 to take on a friend.'}</p>`
      + `<p class="tut-text dim">Press Esc in a game for the full controls list.</p>`
      + `<div class="tut-actions"><button class="cta" data-tut="menu">MAIN MENU</button></div>`;
    return;
  }
  const done = TUT.state === 'done';
  el.innerHTML = `<div class="tut-head"><span>${L.title.toUpperCase()}</span><span>STEP ${TUT.step + 1} OF ${L.steps.length}</span></div>`
    + `<p class="tut-text">${s.text}</p>${s.tip ? `<p class="tut-text dim">${s.tip}</p>` : ''}`
    + `<div class="tut-goal ${done ? 'done' : ''}"><span>${done ? 'Nice!' : s.goal}</span><b>${TUT.count} / ${s.n}</b></div>`
    + `<div class="tut-bar"><i style="width:${(TUT.count / s.n) * 100}%"></i></div>`
    + `<div class="tut-actions"><button class="ghost" data-tut="skip">Skip step</button><button class="ghost" data-tut="exit">Exit</button></div>`;
}
function buildTutorialUI() {
  $('tutCard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tut]'); if (!b) return;
    const a = b.dataset.tut;
    if (a === 'go') tutGo();
    else if (a === 'skip') tutNext();
    else if (a === 'skipLesson') { TUT.step = LESSONS[TUT.lesson].steps.length - 1; G.hold = false; tutNext(); }
    else if (a === 'exit' || a === 'menu') { tutEnd(); toMenu(); }
  });
}
