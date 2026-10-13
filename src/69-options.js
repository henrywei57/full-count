// ============================================================================
// Options: remappable keys, game and commentary volume, colorblind-friendly
// colors and the on-screen guides. Everything is saved on this device.
// ============================================================================

// ------------------------------------------------------------- key bindings ----
// Each control has a default key and can move to any other. Your key does everything the
// default key does (Space is the swing, the pitch meter and the dive), and the hints on
// screen show your keys. [default key, label, what it does]
const CONTROLS = [
  [' ', 'Space', 'Swing, pitch meter, dive'], ['k', 'K', 'Swing'], ['j', 'J', 'Contact swing'], ['l', 'L', 'Power swing'], ['b', 'B', 'Bunt'],
  ['e', 'E', 'Steal, send runners'], ['q', 'Q', 'Call it off, runners back, switch fielder'],
  ['w', 'W', 'Fielder up'], ['a', 'A', 'Fielder left'], ['s', 'S', 'Fielder down'], ['d', 'D', 'Fielder right'],
  ['1', '1', 'First base (throw, pick a runner, pitch 1)'], ['2', '2', 'Second base (pitch 2)'], ['3', '3', 'Third base (pitch 3)'], ['4', '4', 'Home plate (pitch 4)'],
  ['c', 'C', 'Challenge a call'], ['u', 'U', 'Team panel'], ['i', 'I', 'Intentional walk'], ['r', 'R', 'Replay'], ['enter', 'Enter', 'Skip ahead'],
  ['z', 'Z', 'Strike zone on/off'], ['m', 'M', 'Sound on/off'], ['p', 'P', 'Pause'],
  ['t', 'T', 'Re-center the camera (Player Lock)'], ['v', 'V', 'Camera view (Player Lock)'], ['tab', 'Tab', 'Skip the at-bat (Player Lock)'], ['f', 'F', 'Fast-forward (CPU vs CPU)'],

];
const NO_BIND = new Set(['escape', 'shift', 'control', 'alt', 'meta', 'capslock', 'contextmenu', 'os']);
let KEYMAP = new Map(), KEYTAKEN = new Set();
function buildKeymap() {
  KEYMAP = new Map(); KEYTAKEN = new Set();
  const known = new Set(CONTROLS.map(([v]) => v));
  for (const [v, p] of Object.entries(settings.keys || {})) if (known.has(v) && typeof p === 'string' && p && p !== v) { KEYMAP.set(p, v); KEYTAKEN.add(v); }
}
// the key you pressed, as the control it stands for ('' when that key's control moved elsewhere)
function keyAlias(k) { if (KEYMAP.has(k)) return KEYMAP.get(k); if (KEYTAKEN.has(k)) return ''; return k; }
function keyLabel(p) { return p === ' ' ? 'Space' : p.startsWith('arrow') ? { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' }[p] : p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1); }
// the key that does this control now ('' if none)
function boundKey(v) { const p = settings.keys && settings.keys[v]; if (p) return p; return KEYMAP.has(v) ? '' : v; }
// hints are written with the default keys: show yours instead
const LABEL_TO_V = new Map(CONTROLS.map(([v, l]) => [l, v]));
function relabelKeys(html) {
  if (!KEYTAKEN.size || !html) return html;
  return html.replace(/<kbd>([^<]+)<\/kbd>/g, (m, l) => { const v = LABEL_TO_V.get(l); if (!v || !KEYTAKEN.has(v) && !KEYMAP.has(v)) return m; const p = boundKey(v); return `<kbd>${p ? esc(keyLabel(p)) : '&ndash;'}</kbd>`; });
}

// ------------------------------------------------------------------ colors ----
// Okabe-Ito colors read clearly with red-green colorblindness; the defaults use red and green.
const PITCH_COL0 = Object.fromEntries(Object.entries(PITCH_TYPES).map(([k, t]) => [k, t.col]));
const PITCH_COL_CB = { FF: '#E69F00', SI: '#D55E00', FC: '#F0E442', SL: '#56B4E9', SW: '#3D7FD0', CU: '#009E73', KC: '#9ADBC5', CH: '#CC79A7', FS: '#FFFFFF' };
const RESULT_COL0 = { ball: '#3fd38a', foul: '#ffc94a', play: '#5aa8ff', strike: '#ff5a5f' };
const RESULT_COL_CB = { ball: '#56B4E9', foul: '#F0E442', play: '#FFFFFF', strike: '#E69F00' };
let RESULT_COL = RESULT_COL0;
function resultCol(r) { return r === 'Ball' || r === 'HBP' ? RESULT_COL.ball : r === 'Foul' ? RESULT_COL.foul : r === 'In play' ? RESULT_COL.play : RESULT_COL.strike; }
function applyPalette() {
  const cb = !!settings.cb;
  for (const k in PITCH_TYPES) PITCH_TYPES[k].col = cb ? PITCH_COL_CB[k] || PITCH_COL0[k] : PITCH_COL0[k];
  RESULT_COL = cb ? RESULT_COL_CB : RESULT_COL0;
  document.body.classList.toggle('cb', cb);
}

// ------------------------------------------------------------------ volume ----
function gameVolume() { return settings.volume ?? 0.8; }
function applyVolume() { if (SND.master) SND.master.gain.value = settings.sound && !(typeof updateSkipUI !== 'undefined' && updateSkipUI.on) ? gameVolume() : 0; }

// ---------------------------------------------------------------- the panel ----
const OPT = { capture: null };
function openOptions() { OPT.capture = null; $('optionsScreen').classList.remove('hidden'); renderOptions(); }
function closeOptions() { OPT.capture = null; $('optionsScreen').classList.add('hidden'); }
function renderOptions() {
  if ($('optionsScreen').classList.contains('hidden')) return;
  const pct = (x) => Math.round(x * 100);
  const chips = Object.entries(PITCH_TYPES).map(([, t]) => `<span class="chip on" style="--pc:${t.col}">${t.short}</span>`).join('');
  const rows = CONTROLS.map(([v, l, what]) => {
    const p = boundKey(v), cap = OPT.capture === v, moved = settings.keys && settings.keys[v];
    return `<tr class="${cap ? 'sel' : ''}"><td class="who">${esc(what)}</td><td><button class="ghost op-key ${moved ? 'moved' : ''}" data-bind="${esc(v)}">${cap ? 'Press a key&hellip;' : p ? esc(keyLabel(p)) : '<i>none</i>'}</button></td><td class="op-def">${moved ? `default ${esc(l)}` : ''}</td></tr>`;
  }).join('');
  $('opBody').innerHTML = `
    <h3>SOUND</h3>
    <div class="op-row"><label for="opVol">Game sound</label><input type="range" id="opVol" min="0" max="100" step="5" value="${pct(gameVolume())}"><span>${settings.sound ? pct(gameVolume()) + '%' : 'Muted (M)'}</span></div>
    <div class="op-row"><label for="opVoice">Commentary voice</label><input type="range" id="opVoice" min="0" max="100" step="5" value="${pct(settings.voiceVol ?? 1)}"><span>${settings.voice ? pct(settings.voiceVol ?? 1) + '%' : 'Off'}</span></div>
    <div class="op-row"><label><input type="checkbox" id="opVoiceOn" ${settings.voice ? 'checked' : ''}> Play-by-play voice</label></div>
    <h3>DISPLAY</h3>
    <div class="op-row"><label><input type="checkbox" id="opCb" ${settings.cb ? 'checked' : ''}> Colorblind-friendly colors</label><span class="op-chips">${chips}</span></div>
    <p class="fr-note">Pitch types, and balls and strikes on the pitch tracker, use colors that stay distinct with red-green colorblindness.</p>
    <div class="op-row"><label><input type="checkbox" id="opZone" ${settings.zone ? 'checked' : ''}> Strike zone overlay (Z)</label></div>
    <div class="op-row"><label><input type="checkbox" id="opGuide" ${settings.guide ? 'checked' : ''}> Hitting guide and fly-ball landing spot (easier difficulties)</label></div>
    <h3>KEYS <small>click one, then press the key you want</small></h3>
    <div class="rs-scroll"><table class="rs-table op-table"><tbody>${rows}</tbody></table></div>
    <div class="row-actions"><button class="ghost" data-op="reset">Reset all keys</button></div>
    <p class="fr-note">Mouse buttons, arrow keys, Esc and the gamepad stay as they are. A key you give to one control is taken from whatever used it before.</p>`;
}
function buildOptionsUI() {
  buildKeymap(); applyPalette();
  for (const id of ['btnOptions', 'btnOptions2']) $(id).addEventListener('click', openOptions);
  $('opClose').addEventListener('click', closeOptions);
  const body = $('opBody');
  body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'opVol') { settings.volume = +t.value / 100; if (!settings.sound && settings.volume > 0) SND.setOn(true); applyVolume(); }
    else if (t.id === 'opVoice') settings.voiceVol = +t.value / 100;
    else return;
    saveSettings();
    const span = t.parentElement.querySelector('span');
    if (span) span.textContent = `${t.value}%`;
  });
  body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'opVoiceOn') { settings.voice = t.checked; if (!t.checked) try { speechSynthesis.cancel(); } catch (err) { /* none */ } $('btnVoice').textContent = `Commentary voice: ${settings.voice ? 'On' : 'Off'}`; }
    else if (t.id === 'opCb') { settings.cb = t.checked; applyPalette(); if (G.teams) { hudPitcher(); drawTracker(); } }
    else if (t.id === 'opZone') { if (!!settings.zone !== t.checked) toggleZone(); }
    else if (t.id === 'opGuide') settings.guide = t.checked;
    else return;
    saveSettings(); renderOptions();
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bind],[data-op]'); if (!b) return;
    if (b.dataset.op === 'reset') { settings.keys = {}; saveSettings(); buildKeymap(); OPT.capture = null; renderOptions(); return; }
    OPT.capture = OPT.capture === b.dataset.bind ? null : b.dataset.bind; renderOptions();
  });
  // waiting for a key: it goes to the control being set, before the game sees it
  window.addEventListener('keydown', (e) => {
    if (!OPT.capture || $('optionsScreen').classList.contains('hidden')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const k = e.key.toLowerCase(), v = OPT.capture;
    OPT.capture = null;
    if (k !== 'escape' && !NO_BIND.has(k)) {
      const keys = { ...(settings.keys || {}) };
      for (const [x, p] of Object.entries(keys)) if (p === k && x !== v) delete keys[x];   // a key does one control
      if (k === v) delete keys[v]; else keys[v] = k;
      settings.keys = keys; saveSettings(); buildKeymap();
    }
    renderOptions();
  }, true);
}
