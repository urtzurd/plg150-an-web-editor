// PLG150-AN editor: UI wiring, state, librarian and performance controls.
(function () {
  'use strict';

  const { P } = AN;
  const $ = id => document.getElementById(id);
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- storage
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('plg150an.' + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('plg150an.' + key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
  };

  // ---------------------------------------------------------------- native parameter sets
  // Not part of the voice: sent immediately when changed (the board can't be
  // read back, so these are the editor's last sent values).
  const sgn = n => (n > 0 ? '+' + n : String(n));
  const NATIVE_PART = [
    { addr: 0x00, label: 'Unison', max: 2, def: 0, opts: ['Voice', 'Off', 'On'], title: 'Unison: as stored in the voice, or forced off/on' },
    { addr: 0x01, label: 'Arp/Seq Switch', max: 2, def: 0, opts: ['Voice', 'Off', 'On'], title: 'Arpeggio/Step Seq: as stored in the voice, or forced off/on' },
    { addr: 0x02, label: 'Tempo', size: 2, max: 240, def: 0, choices: [[0, 'Voice'], [39, 'MIDI'], ...range(201, i => [40 + i, String(40 + i)])], title: 'Tempo: voice tempo, MIDI clock, or 40-240 BPM' },
    ...[
      [0x04, 'LFO2 Speed'], [0x05, 'Sync Pitch'], [0x06, 'FM Depth'], [0x07, 'VCO Detune'],
      [0x08, 'VCO1 Edge'], [0x09, 'VCO1 PW'], [0x0A, 'VCO1 PWM Depth'], [0x0B, 'VCO2 Edge'],
      [0x0C, 'VCO2 PW'], [0x0D, 'VCO2 PWM Depth'], [0x0E, 'Mixer VCO1'], [0x0F, 'Mixer VCO2'],
      [0x10, 'Ring Mod Level'], [0x11, 'Noise Level'], [0x12, 'VCA Feedback'], [0x13, 'VCF Mod Depth'],
      [0x14, 'FEG Depth'], [0x15, 'FEG Attack'], [0x16, 'FEG Decay'], [0x17, 'FEG Sustain'],
      [0x18, 'FEG Release'], [0x19, 'VCA Mod Depth'], [0x1A, 'AEG Attack'], [0x1B, 'AEG Decay'],
      [0x1C, 'AEG Sustain'], [0x1D, 'AEG Release'], [0x1E, 'Distortion Gain'],
    ].map(([addr, label]) => ({ addr, label, def: 64, offset: 64, title: label + ' offset added to the voice (−64 to +63)' })),
    { addr: 0x20, label: 'AC1 Destination', max: 46, def: 0, opts: AN.MATRIX_PARAMS, title: 'Voice parameter controlled by AN AC1' },
    { addr: 0x21, label: 'AC1 Depth', def: 64, offset: 64, title: 'AN AC1 control depth' },
  ];
  const CC_OPTS = range(97, AN.ccName);
  const NATIVE_SYS = [
    { addr: 0x02, label: 'Velocity Curve', max: 5, def: 0, opts: ['Normal', 'Soft1', 'Soft2', 'Easy', 'Wide', 'Hard'], title: 'Velocity response curve of the PLG150-AN' },
    { addr: 0x08, label: 'AN AC1 CC', max: 96, def: 41, opts: CC_OPTS, title: 'Control change number of AN Assignable Controller 1' },
    { addr: 0x09, label: 'AN AC2 CC', max: 96, def: 42, opts: CC_OPTS, title: 'Control change number of AN Assignable Controller 2' },
    { addr: 0x0A, label: 'AN AC3 CC', max: 96, def: 43, opts: CC_OPTS, title: 'Control change number of AN Assignable Controller 3' },
    { addr: 0x0B, label: 'AN AC4 CC', max: 96, def: 44, opts: CC_OPTS, title: 'Control change number of AN Assignable Controller 4' },
    { addr: 0x04, label: 'Morph Ctrl', max: 96, def: 0, opts: CC_OPTS, title: 'Controller that morphs from the current voice to the target voice (Off = no morphing)' },
    { addr: 0x07, label: 'Morph Bank MSB', max: 100, def: 36, choices: [[36, '36 Custom'], [84, '84 XG-A'], [100, '100 XG-B']], title: 'Bank Select MSB of the morph target voice' },
    { addr: 0x06, label: 'Morph Bank LSB', max: 127, def: 0, title: 'Bank Select LSB of the morph target voice' },
    { addr: 0x05, label: 'Morph Program', max: 127, def: 0, offset: -1, title: 'Program number (1-128) of the morph target voice' },
  ];
  const AN1X_SYS = [
    [0x0D, 'Mod Wheel', 1], [0x0E, 'Foot Volume', 7], [0x0F, 'Foot Ctrl', 4], [0x10, 'Foot Switch', 64],
    [0x11, 'Ribbon X', 13], [0x12, 'Ribbon Z', 12], [0x0C, 'Scene Ctrl', 1],
    ...range(8, i => [0x13 + i, `Assign ${i + 1}`, 41 + i]),
  ].map(([addr, label, def]) => ({ addr, label, max: 96, def, opts: CC_OPTS, title: `Control change number of the ${label} control source` }));
  for (const d of NATIVE_PART) Object.assign(d, { src: 'npart', key: 'np' + d.addr });
  for (const d of NATIVE_SYS) Object.assign(d, { src: 'nsys', key: 'ns' + d.addr });
  for (const d of AN1X_SYS) Object.assign(d, { src: 'asys', key: 'as' + d.addr });
  for (const d of [...NATIVE_PART, ...NATIVE_SYS, ...AN1X_SYS]) {
    d.min = d.min || 0;
    if (d.max == null) d.max = 127;
    d.size = d.size || 1;
    d.fmt = 'num';
  }
  const defaults = ds => Object.fromEntries(ds.map(d => [d.addr, d.def]));

  // ---------------------------------------------------------------- settings & state
  const ROM_NAMES = Object.keys(window.AN_BANKS || {});
  const settings = Object.assign({
    out: '', device: 0, channel: 0, part: 0,
    liveSend: true, autoSend: true, storeToPlg: false,
    velocity: 100, octave: 0, bank: 'Preset 1', perfHidden: false, fegTrack: 0, gridExpanded: false,
  }, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);

  const state = {
    banks: {},          // name -> { voices: Uint8Array[128], rom: bool, modified: bool }
    bankName: null,
    index: 0,
    edit: AN.newVoice(),
    original: AN.newVoice(),
    edited: false,
    comparing: false,
    storeMode: false,
    lastParam: '',
    npart: Object.assign(defaults(NATIVE_PART), store.get('npart', {})),
    nsys: Object.assign(defaults(NATIVE_SYS), store.get('nsys', {})),
    asys: Object.assign(defaults(AN1X_SYS), store.get('asys', {})),
  };
  const romCache = {};
  const bank = () => state.banks[state.bankName];
  const shownVoice = () => (state.comparing ? state.original : state.edit);

  async function loadBanks() {
    for (const n of ROM_NAMES) {
      try {
        romCache[n] = AN.splitBank(await AN.gunzip(AN.base64ToBytes(window.AN_BANKS[n])));
      } catch (e) {
        romCache[n] = range(128, () => AN.newVoice());
        toast('Could not unpack the factory voices (this browser has no DecompressionStream)', true);
      }
      state.banks[n] = { voices: romCache[n].map(AN.cloneVoice), rom: true, modified: false };
    }
    const saved = store.get('banks', {});
    for (const n in saved) {
      try {
        const bytes = AN.base64ToBytes(saved[n]);
        if (bytes.length !== 128 * AN.VOICE_SIZE) continue;
        state.banks[n] = { voices: AN.splitBank(bytes), rom: ROM_NAMES.includes(n), modified: true };
      } catch { /* skip damaged entry */ }
    }
    if (!Object.keys(state.banks).length) state.banks.USER = { voices: range(128, () => AN.newVoice()), rom: false, modified: true };
  }
  function persistBanks() {
    const out = {};
    for (const n in state.banks) if (state.banks[n].modified) out[n] = AN.bytesToBase64(AN.joinBank(state.banks[n].voices));
    if (!store.set('banks', out)) toast('Browser storage is full: save your banks as .syx files', true);
  }
  const bankLabel = n => n;
  const bankShort = n => (n === 'Preset 1' ? 'PR1' : n === 'Preset 2' ? 'PR2' : n === 'User' ? 'USR' : n.slice(0, 3).toUpperCase());

  // ---------------------------------------------------------------- MIDI
  const midi = new Midi();
  const hex = bytes => Array.from(bytes, b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

  // Logs outgoing messages (the PLG150-AN never transmits, so there is no MIDI In).
  function log(bytes, label) {
    const isPerf = bytes[0] < 0xF0;
    if (isPerf && !$('logNotes').checked) return;
    const el = $('log');
    const shown = bytes.length > 48 ? hex(bytes.slice(0, 24)) + ` … (${bytes.length} bytes) … ` + hex(bytes.slice(-3)) : hex(bytes);
    el.textContent += `${new Date().toLocaleTimeString()} ${label ? '[' + label + '] ' : ''}${shown}\n`;
    if (el.textContent.length > 60000) el.textContent = el.textContent.slice(-40000);
    el.scrollTop = el.scrollHeight;
  }
  midi.onSend = (b, label) => log(b, label);

  function requireOutput() {
    if (midi.output) return true;
    toast('No MIDI output selected. Click "Enable MIDI" and choose the port.', true);
    return false;
  }

  function refreshPorts() {
    const sel = $('midiOut');
    const ports = midi.outputs();
    sel.innerHTML = '';
    sel.appendChild(new Option('— none —', ''));
    for (const p of ports) sel.appendChild(new Option(p.name, p.id));
    const match = ports.find(p => p.id === settings.out) || ports.find(p => p.name === settings.out);
    sel.value = match ? match.id : '';
    midi.selectOutput(sel.value);
    const st = $('midiStatus');
    st.textContent = midi.output ? 'Out: ' + midi.output.name : 'No output';
    st.className = 'status ' + (midi.output ? 'ok' : 'err');
  }

  async function enableMidi() {
    if (!midi.supported) {
      $('midiStatus').textContent = 'Web MIDI not supported (use Chrome or Edge)';
      $('midiStatus').className = 'status err';
      return;
    }
    try {
      await midi.init();
      midi.onStateChange = refreshPorts;
      refreshPorts();
      $('midiConnect').textContent = 'Rescan';
    } catch {
      $('midiStatus').textContent = 'MIDI access denied (SysEx permission needed)';
      $('midiStatus').className = 'status err';
    }
  }

  // Live parameter changes are coalesced so dragging a value sends at most
  // one message per parameter every 20 ms.
  const pending = new Map();
  let flushTimer = null;
  // Native settings are always sent; voice edits follow "Live edit".
  function queueSend(key, bytes, label, always) {
    if (!midi.output) return;
    if (!always && (!settings.liveSend || state.comparing)) return;
    pending.set(key, [bytes, label]);
    if (!flushTimer) flushTimer = setTimeout(flushPending, 20);
  }
  function flushPending() {
    flushTimer = null;
    for (const [bytes, label] of pending.values()) midi.send(bytes, label);
    pending.clear();
  }

  // Free EG data is only received as bulk, so edits resend the Common block.
  let commonTimer = null;
  function scheduleCommonBulk() {
    if (!midi.output || !settings.liveSend || state.comparing) return;
    clearTimeout(commonTimer);
    // busy for the wire time of the ~1650-byte bulk, like the other transfers
    commonTimer = setTimeout(() => {
      commonTimer = null;
      whileBusy(() => midi.sendSequence([[Sysex.commonBulk(settings.device, state.edit), 'Common bulk (Free EG)']], 0));
    }, 250);
  }

  // While a multi-message transfer runs, an overlay with a wait cursor blocks
  // clicks and a capture-phase listener blocks keys, so nothing changes under
  // it. Held notes are released first (the overlay would swallow note-offs).
  // Elements with .busy-exempt (the bank Stop button) stay clickable.
  let busyCount = 0;
  function setBusy() {
    const busy = busyCount > 0;
    document.body.classList.toggle('busy', busy);
    $('busyOverlay').hidden = !busy;
    $('midiStatus').classList.toggle('sending', busy);
    if (busy) {
      allOff();
      const a = document.activeElement;
      if (a && a !== document.body && !a.classList.contains('busy-exempt')) a.blur();
    }
  }
  async function whileBusy(fn) {
    busyCount++;
    setBusy();
    try { return await fn(); } finally { busyCount--; setBusy(); }
  }
  window.addEventListener('keydown', e => {
    if (!busyCount) return;
    if (e.key === 'Escape' && bankSending) bankStop = true;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  const voiceMessages = v => {
    const dev = settings.device;
    return [
      [Sysex.commonBulk(dev, v), 'Common bulk'],
      [Sysex.sceneBulk(dev, v), 'Scene bulk'],
      [Sysex.stepBulk(dev, v), 'Step Seq bulk'],
    ];
  };
  async function sendVoice(v = state.edit) {
    if (!requireOutput()) return;
    pending.clear();
    clearTimeout(commonTimer);
    await whileBusy(() => midi.sendSequence(voiceMessages(v), 40));
  }

  let bankSending = false, bankStop = false;
  async function sendBank() {
    if (bankSending) { bankStop = true; return; }
    if (!requireOutput()) return;
    if (!confirm(`Send all 128 voices of "${bankLabel(state.bankName)}" to the PLG150-AN user voices 1–128?\n\nThis replaces the user voices on the board and takes about two minutes over a MIDI cable.`)) return;
    const voices = bank().voices;
    const list = voices.map((v, i) => [Sysex.userVoiceBulk(settings.device, i, v), `User voice ${i + 1}`]);
    bankSending = true; bankStop = false;
    const btn = $('sendBank');
    btn.classList.add('on');
    btn.classList.add('busy-exempt');
    btn.title = 'Stop the bank transfer (Esc)';
    const ok = await whileBusy(() => midi.sendSequence(list, 100, {
      shouldStop: () => bankStop,
      onProgress: (i, n) => { btn.textContent = `Stop (${i}/${n})`; },
    }));
    btn.classList.remove('busy-exempt');
    btn.title = 'Send the 128 voices of this bank to the PLG150-AN user voices 1–128 (User Voice bulk dumps)';
    bankSending = false;
    btn.classList.remove('on');
    btn.textContent = 'Send Bank';
    toast(ok ? `Sent "${bankLabel(state.bankName)}" to PLG user voices 1–128` : 'Bank transfer stopped', !ok);
  }

  // ---------------------------------------------------------------- toast
  let toastTimer;
  function toast(msg, err) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
  }

  // ---------------------------------------------------------------- parameter access
  // A control is bound to a voice parameter (AN.P entries) or to a native
  // parameter (src npart / nsys / asys).
  const bound = [];
  const byKey = new Map();
  const nativeStore = { npart: 'npart', nsys: 'nsys', asys: 'asys' };

  function getRaw(d) {
    if (d.src) return state[d.src][d.addr];
    return AN.get(shownVoice(), d);
  }
  const fmtValue = (d, raw) => {
    if (d.choices) return (d.choices.find(c => c[0] === raw) || [raw, String(raw)])[1];
    if (d.src && !d.opts) return d.offset === 64 ? sgn(raw - 64) : String(raw - (d.offset || 0));
    return AN.format(d, raw, shownVoice());
  };
  const labelOf = d => AN.labelOf(d, shownVoice());
  const isVoiceParam = d => !d.src;

  function commit(d, raw) {
    raw = clamp(raw, d.min, d.max);
    const dev = settings.device;
    if (d.src) {
      state[d.src][d.addr] = raw;
      store.set(nativeStore[d.src], state[d.src]);
      const data = d.size === 2 ? [(raw >> 7) & 0x7F, raw & 0x7F] : [raw];
      const msg = d.src === 'npart' ? Sysex.nativePart(dev, settings.part, d.addr, data)
        : d.src === 'nsys' ? Sysex.nativeSystem(dev, d.addr, data) : Sysex.an1xSystem(dev, d.addr, data);
      queueSend(d.key, msg, 'Native ' + d.label, true);
      refreshKey(d.key);
      return;
    }
    if (state.comparing) return;
    AN.set(state.edit, d, raw);
    markEdited();
    queueSend('v' + d.abs, Sysex.voiceParam(dev, AN.paramBytes(d, raw)), d.key);
    afterParamChange(d, raw);
  }

  // Parameters that change how other parameters are shown
  const STRUCTURAL = new Set(['keyMode', 'syncMode', 'vco1Wave', 'vco2Wave', 'pgSelect', 'lfoAssign', 'category',
    'ssLength', 'pgOn']);
  function afterParamChange(d, raw) {
    state.lastParam = `${labelOf(d)} = ${valueWithTime(d, raw)}`;
    if (STRUCTURAL.has(d.key)) refreshAll(); else refreshKey(d.key);
    updateGraphics(d.key);
    updateLcd();
  }

  function register(c) {
    bound.push(c);
    const key = c.d.key;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
    c.refresh();
    return c;
  }
  const refreshKey = key => (byKey.get(key) || []).forEach(c => c.refresh());
  function refreshAll() {
    bound.forEach(c => c.refresh());
    updateGraphics();
    updateLcd();
  }

  // Compare: voice controls are read-only and show the original values;
  // unchanged ones are greyed out, changed ones blink.
  function compareState(d) {
    if (!state.comparing || !isVoiceParam(d)) return { cmp: false, changed: false };
    return { cmp: true, changed: AN.get(state.original, d) !== AN.get(state.edit, d) };
  }
  function applyCompare(wrap, d) {
    const { cmp, changed } = compareState(d);
    wrap.classList.toggle('cmp-same', cmp && !changed);
    wrap.classList.toggle('cmp-changed', changed);
    return cmp;
  }

  // ---------------------------------------------------------------- vertical drag
  // The full range is covered in about 250 px of travel (2–12 px per step);
  // hold Shift for single steps every 12 px. onClick runs for a press and
  // release without movement.
  let dragSession = null;
  function attachDrag(target, d, { isDisabled = () => false, onClick, threshold = 2, focus = false } = {}) {
    target.addEventListener('pointerdown', e => {
      if (e.button !== 0 || isDisabled()) return;
      if (e.target.tagName === 'INPUT' && e.target !== target) return;   // typing in a knob's value box
      if (dragSession) dragSession.end(false);
      e.preventDefault();
      const a = document.activeElement;
      if (a && a.tagName === 'INPUT' && a !== target) a.blur();
      if (focus) target.focus({ preventScroll: true });
      const startY = e.clientY, start = getRaw(d);
      const px = clamp(250 / (d.max - d.min + 1), 2, 12);
      let moved = false;
      const move = ev => {
        if (ev.pointerId !== e.pointerId) return;
        const dy = startY - ev.clientY;
        if (!moved) {
          if (Math.abs(dy) < threshold) return;
          moved = true;
          document.body.classList.add('dragging');
        }
        ev.preventDefault();
        const raw = clamp(start + Math.round(dy / (ev.shiftKey ? 12 : px)), d.min, d.max);
        if (raw !== getRaw(d)) commit(d, raw);
      };
      const end = clicked => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onCancel);
        document.body.classList.remove('dragging');
        dragSession = null;
        if (clicked && !moved && onClick) onClick(e);
      };
      const onUp = ev => { if (ev.pointerId === e.pointerId) end(true); };
      const onCancel = () => end(false);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onCancel);
      dragSession = { end };
    });
  }

  // keyboard stepping for focusable controls
  function attachKeys(target, d, isDisabled) {
    target.addEventListener('keydown', e => {
      if (isDisabled() || (e.target !== target && e.target.tagName === 'INPUT')) return;
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      let raw;
      if (step) raw = getRaw(d) + step;
      else if (e.key === 'Home') raw = d.min;
      else if (e.key === 'End') raw = d.max;
      else return;
      e.preventDefault();
      commit(d, clamp(raw, d.min, d.max));
    });
  }

  // ---------------------------------------------------------------- widgets
  // Knob: drag up/down, arrow keys when focused, double-click for the default.
  function makeKnob(parent, d, o = {}) {
    const wrap = h('div', 'knob' + (o.small ? ' small' : '') + (o.cls ? ' ' + o.cls : ''));
    wrap.tabIndex = 0;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('knob-svg');
    const k = Graphics.createKnob(svg);
    const val = h('span', 'knob-val');
    const lab = h('span', 'knob-lbl');
    wrap.append(svg, val, lab);
    place(parent, wrap, o, 1);
    const disabled = () => (state.comparing && isVoiceParam(d)) || wrap.classList.contains('inactive');
    // Click the value (without dragging) to type a new one, as in the DX editor.
    const startEdit = () => {
      if (disabled() || wrap.querySelector('.knob-edit')) return;
      const input = h('input', 'knob-edit');
      input.type = 'text';
      input.value = val.textContent;
      input.setAttribute('aria-label', labelOf(d));
      val.hidden = true;
      val.after(input);
      input.focus();
      input.select();
      let done = false;
      const finish = apply => {
        if (done) return;
        done = true;
        if (apply && input.value.trim() !== val.textContent) {
          const raw = parseValue(d, input.value);
          if (raw == null) toast(`"${input.value}" is not a valid ${labelOf(d)} value`, true);
          else if (raw !== getRaw(d)) commit(d, raw);
          else showParam(d);
        }
        input.remove();
        val.hidden = false;
        wrap.focus({ preventScroll: true });
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        e.stopPropagation();
      });
      input.addEventListener('blur', () => finish(true));
    };
    attachDrag(wrap, d, { isDisabled: disabled, focus: true, onClick: e => { if (e.target === val) startEdit(); } });
    attachKeys(wrap, d, disabled);
    wrap.addEventListener('dblclick', e => {
      if (e.target === val || e.target.tagName === 'INPUT') return;   // the value is click-to-type
      if (!disabled()) commit(d, d.def);
    });
    wrap.addEventListener('focus', () => showParam(d));
    return register({
      d, wrap,
      refresh() {
        const raw = getRaw(d), v = shownVoice();
        const center = d.center != null ? d.center : 64;
        const bip = isVoiceParam(d) ? AN.isBipolar(d, v) : d.offset === 64;
        const frac = (raw - d.min) / (d.max - d.min || 1);
        const from = bip ? (center - d.min) / (d.max - d.min) : 0;
        Graphics.updateKnob(k, frac, from);
        val.textContent = fmtValue(d, raw);
        const label = o.label != null ? (typeof o.label === 'function' ? o.label(v) : o.label) : labelOf(d);
        lab.textContent = label;
        wrap.title = `${o.title || labelOf(d)}: ${valueWithTime(d, raw)}\nDrag up/down (Shift = fine)\nDouble-click = default (${fmtValue(d, d.def)})`;
        const active = isVoiceParam(d) ? AN.isActive(d, v) : true;
        wrap.classList.toggle('inactive', !active);
        wrap.setAttribute('aria-label', `${label} ${val.textContent}`);
        applyCompare(wrap, d);
      },
    });
  }

  // Lamp list: a panel button that steps through the options, with one lamp
  // per option (click a lamp to pick it). labels may be a function (voice).
  // Lamp list: a panel button that steps through the values, with one lamp
  // per option (click a lamp to pick it). With o.groups, a lamp stands for a
  // group of values (e.g. the five LFO shapes for 21 waves): it lights for any
  // value of the group, shows that value's name (o.names), and clicking the lit
  // lamp steps through the group's values. A value in no group lights no lamp
  // (e.g. PWM source "Fixed"). groups, labels and cycle may be functions (voice).
  function makeLamps(parent, d, o = {}) {
    const wrap = h('div', 'lamps' + (o.cls ? ' ' + o.cls : ''));
    const btn = h('button', 'pbtn');
    btn.type = 'button';
    const list = h('ul', 'lamp-list');
    const lab = h('span', 'lamps-lbl', o.label || '');
    const col = h('div', 'lamps-btncol');
    col.append(btn, lab);
    wrap.append(col, list);
    place(parent, wrap, o, 2);
    let sig = '';
    // The list is as wide as its widest possible text (a hidden zero-height
    // "sizer" holds every label it can show), so it never changes width and
    // shifts the cell when the lit lamp shows a longer name (e.g. LFO2 PHASE).
    const sizer = h('li', 'lamp lamp-sizer');
    sizer.setAttribute('aria-hidden', 'true');
    const sized = new Set();
    const addSizes = texts => texts.forEach(t => {
      if (t == null || sized.has(t)) return;
      sized.add(t);
      sizer.appendChild(h('span', null, t));
    });
    addSizes([...(o.names || []), ...(o.sizes || [])]);
    const val = x => (typeof x === 'function' ? x(shownVoice()) : x);
    const groups = () => {
      if (o.groups) return val(o.groups);
      const ls = o.labels ? val(o.labels) : AN.optsOf(d, shownVoice());
      return ls.map((label, i) => ({ label, values: [d.min + i] }));
    };
    // values the button steps through
    const cycle = () => (o.cycle ? val(o.cycle) : groups().flatMap(g => g.values).sort((a, b) => a - b));
    const disabled = () => state.comparing && isVoiceParam(d);
    btn.addEventListener('click', () => {
      if (disabled()) return;
      const vs = cycle();
      const k = vs.indexOf(getRaw(d));
      commit(d, vs[(k + 1) % vs.length]);
    });
    btn.addEventListener('focus', () => showParam(d));
    return register({
      d, wrap,
      refresh() {
        const gs = groups();
        const s = gs.map(g => g.label + ':' + g.values.join(',')).join('|');
        if (s !== sig) {
          sig = s;
          list.innerHTML = '';
          addSizes(gs.map(g => g.label));
          list.appendChild(sizer);
          gs.forEach(g => {
            const li = h('li', 'lamp', g.label);
            li.addEventListener('click', () => {
              if (disabled()) return;
              const k = g.values.indexOf(getRaw(d));
              commit(d, g.values[k < 0 ? 0 : (k + 1) % g.values.length]);
            });
            list.appendChild(li);
          });
        }
        const raw = getRaw(d);
        // long lists (6+ lamps, e.g. VCO1 waves with sync) start one line higher,
        // in the free space beside the block title
        list.classList.toggle('long', gs.length > 5);
        [...list.children].slice(1).forEach((li, i) => {
          const on = gs[i].values.includes(raw);
          li.classList.toggle('on', on);
          li.textContent = on && o.names ? o.names[raw] : gs[i].label;
          li.title = gs[i].values.length > 1 ? `${gs[i].label}: click again for the variants` : gs[i].label;
        });
        btn.title = `${labelOf(d)}: ${fmtValue(d, raw)} (click to step)`;
        btn.disabled = disabled();
        wrap.classList.toggle('inactive', isVoiceParam(d) && !AN.isActive(d, shownVoice()));
        applyCompare(wrap, d);
      },
    });
  }


  // Panel push button with an LED (on/off parameter)
  function makeToggle(parent, d, o = {}) {
    const wrap = h('div', 'toggle' + (o.cls ? ' ' + o.cls : ''));
    const btn = h('button', 'pbtn');
    btn.type = 'button';
    const led = h('span', 'led-dot');
    btn.appendChild(led);
    const lab = h('span', 'toggle-lbl', o.label || labelOf(d));
    wrap.append(btn, lab);
    place(parent, wrap, o, 1);
    const disabled = () => state.comparing && isVoiceParam(d);
    const isOn = o.isOn || (() => getRaw(d) === (o.on ?? 1));
    btn.addEventListener('click', () => {
      if (disabled()) return;
      if (o.onClick) o.onClick(); else commit(d, isOn() ? (o.off ?? 0) : (o.on ?? 1));
    });
    btn.addEventListener('focus', () => showParam(d));
    return register({
      d, wrap,
      refresh() {
        const on = isOn();
        btn.classList.toggle('lit', on);
        btn.setAttribute('aria-pressed', String(on));
        btn.title = `${o.title || labelOf(d)}: ${on ? 'On' : 'Off'}`;
        btn.disabled = disabled();
        applyCompare(wrap, d);
      },
    });
  }

  // Dark LCD-style drop-down for long lists
  function makeLcdSelect(parent, d, o = {}) {
    const wrap = h('label', 'lcdsel' + (o.cls ? ' ' + o.cls : ''));
    const sel = h('select');
    const lab = h('span', 'lcdsel-lbl', o.label || '');
    wrap.append(sel, lab);
    place(parent, wrap, o, 2);
    let sig = '';
    sel.addEventListener('change', () => commit(d, +sel.value));
    sel.addEventListener('focus', () => showParam(d));
    return register({
      d, wrap,
      refresh() {
        const v = shownVoice();
        // o.labels: shorter option texts for narrow cells (the title shows the full one)
        const ls = o.labels || AN.optsOf(d, v) || range(d.max - d.min + 1, i => fmtValue(d, d.min + i));
        const s = ls.join('|');
        if (s !== sig) {
          sig = s;
          sel.innerHTML = '';
          ls.forEach((t, i) => sel.appendChild(new Option(t, d.min + i)));
        }
        const raw = getRaw(d);
        if (![...sel.options].some(op => +op.value === raw)) sel.appendChild(new Option(String(raw), raw));
        sel.value = raw;
        sel.title = o.labels ? `${labelOf(d)}: ${fmtValue(d, raw)}` : labelOf(d);
        sel.disabled = state.comparing && isVoiceParam(d);
        wrap.classList.toggle('inactive', isVoiceParam(d) && !AN.isActive(d, v));
        applyCompare(wrap, d);
      },
    });
  }

  // Form field (Detail / Matrix / Pattern / Native pages): a select for
  // lists and formatted values, a drag number box for plain numbers.
  const NUMERIC_OFFSET = { num: 0, s64: 64, s128: 128, p1: -1 };
  function makeField(parent, d, o = {}) {
    const wrap = h('div', 'field' + (o.wide ? ' wide' : ''));
    const lab = h('span');
    wrap.appendChild(lab);
    const offset = d.offset != null ? d.offset : NUMERIC_OFFSET[d.fmt];
    const numeric = !d.opts && !d.choices && !d.fmtFn && !d.fmtV && offset != null && !o.select;
    const disabled = () => state.comparing && isVoiceParam(d);
    let input, sig = '';
    if (!numeric) {
      input = h('select');
      input.addEventListener('change', () => commit(d, +input.value));
      wrap.appendChild(input);
    } else {
      input = h('input');
      input.type = 'number';
      wrap.classList.add('num');
      input.min = d.min - offset; input.max = d.max - offset; input.step = 1;
      input.addEventListener('input', () => {
        if (input.value === '' || isNaN(+input.value)) return;
        commit(d, clamp(Math.round(+input.value) + offset, d.min, d.max));
      });
      input.addEventListener('change', () => c.refresh());
      input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
      const box = h('div', 'numbox spin');
      box.appendChild(input);
      input.addEventListener('focus', () => box.classList.add('editing'));
      input.addEventListener('blur', () => box.classList.remove('editing'));
      for (const [cls, step, text] of [['spin-up', 1, '▲'], ['spin-down', -1, '▼']]) {
        const btn = h('button', 'spin-btn ' + cls, text);
        btn.type = 'button';
        btn.tabIndex = -1;
        btn.addEventListener('click', () => { if (!disabled()) commit(d, clamp(getRaw(d) + step, d.min, d.max)); });
        box.appendChild(btn);
      }
      const focusBox = () => { input.focus(); input.select(); };
      attachDrag(box, d, { isDisabled: disabled, onClick: () => { if (document.activeElement !== input) focusBox(); } });
      attachDrag(lab, d, { isDisabled: disabled });
      wrap.appendChild(box);
    }
    parent.appendChild(wrap);
    const c = register({
      d, wrap, input,
      refresh() {
        const v = shownVoice();
        const raw = getRaw(d);
        lab.textContent = o.label || labelOf(d);
        wrap.title = o.title || d.title || labelOf(d);
        if (!numeric) {
          const entries = d.choices ? d.choices
            : (AN.optsOf(d, v) || range(d.max - d.min + 1, i => fmtValue(d, d.min + i))).map((t, i) => [d.min + i, t]);
          const s = entries.map(e => e[1]).join('|');
          if (s !== sig) {
            sig = s;
            input.innerHTML = '';
            for (const [val, t] of entries) input.appendChild(new Option(t, val));
          }
          if (![...input.options].some(op => +op.value === raw)) input.appendChild(new Option(String(raw), raw));
          input.value = raw;
        } else if (document.activeElement !== input) {
          input.value = raw - offset;
        }
        input.disabled = disabled();
        wrap.classList.toggle('inactive', isVoiceParam(d) && !AN.isActive(d, v));
        applyCompare(wrap, d);
      },
    });
    return c;
  }

  // Typed knob value -> raw value. Values are typed as displayed: an exact
  // match of any displayed value (case/space-insensitive: "C#3", "Thru",
  // "D>W63", "Saw") wins; otherwise the number in the text ("-30", "+6 dB",
  // "80%", "5k", "5000") picks the raw value whose displayed number is
  // nearest, so out-of-range numbers snap to the ends. null if unreadable.
  const ZERO_WORDS = { thru: 0, direct: 0, rest: 0, real: 0, off: 0 };
  function numberIn(text) {
    const t = text.toLowerCase().replace(/\s+/g, '').replace('−', '-');
    if (t in ZERO_WORDS) return ZERO_WORDS[t];
    const m = t.match(/[-+]?\d*\.?\d+/);
    if (!m) return null;
    let n = parseFloat(m[0]);
    if (/\d(\.\d+)?k/.test(t)) n *= 1000;          // 5k, 5.0 kHz
    return n;
  }
  function parseValue(d, text) {
    const norm = x => x.toLowerCase().replace(/\s+/g, '').replace('−', '-');
    const want = norm(text);
    if (!want) return null;
    const entries = range(d.max - d.min + 1, i => [d.min + i, fmtValue(d, d.min + i)]);
    const exact = entries.find(([, f]) => norm(f) === want);
    if (exact) return exact[0];
    const n = numberIn(text);
    if (n == null) return null;
    let best = null, bestDist = Infinity;
    for (const [raw, f] of entries) {
      const fn = numberIn(f);
      if (fn == null) continue;
      const dist = Math.abs(fn - n);
      if (dist < bestDist) { best = raw; bestDist = dist; }
    }
    return best;
  }

  // value plus its measured time for the envelope rate parameters ("80 (1.33 s)")
  const valueWithTime = (d, raw) => {
    const t = isVoiceParam(d) ? Graphics.rateTime(d.key, raw) : null;
    return t ? `${fmtValue(d, raw)} (${t})` : fmtValue(d, raw);
  };
  function showParam(d) {
    state.lastParam = `${labelOf(d)} = ${valueWithTime(d, getRaw(d))}`;
    updateLcd();
  }

  // ---------------------------------------------------------------- voice page (main panel)
  // Like the AN Expert Editor, every control sits on one panel-wide grid of
  // 20 equal columns (left 1-5, middle 6-13, right 14-20), so controls line up
  // with the panels above, below and beside them. Blocks, their rows and
  // sub-sections are CSS subgrids; controls are placed by absolute column
  // ("at"), one cell for a knob or button, two for lamp lists and selectors.
  // Narrow windows fall back to wrapping rows (the placements are ignored).
  let curStart = 1;
  function place(parent, wrap, o, defSpan) {
    if (o.at) wrap.style.gridColumn = `${o.at - curStart + 1} / span ${o.span || defSpan}`;
    parent.appendChild(wrap);
  }
  const blocks = {};
  // col: first column, span: columns, row / rows: panel grid row(s)
  function block(id, title, o) {
    const b = h('section', 'blk' + (o.cls ? ' ' + o.cls : ''));
    b.style.gridColumn = `${o.col} / span ${o.span}`;
    b.style.gridRow = `${o.row} / span ${o.rows || 1}`;
    curStart = o.col;
    const head = h('div', 'blk-head');
    head.appendChild(h('h3', null, title));
    if (o.detail) {
      const btn = h('button', 'detail-btn', 'DETAIL');
      btn.type = 'button';
      btn.title = 'Show the detail parameters';
      btn.addEventListener('click', () => showTab(o.detail));
      head.appendChild(btn);
    }
    b.appendChild(head);
    $('synth').appendChild(b);
    blocks[id] = { b, head };
    return b;
  }
  const row = (parent, cls) => { const r = h('div', 'krow' + (cls ? ' ' + cls : '')); parent.appendChild(r); return r; };
  const sub = (parent, title) => {
    const s = h('div', 'subblk');
    s.appendChild(h('h4', null, title));
    parent.appendChild(s);
    return s;
  };
  const svgEl = (parent, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', cls);
    parent.appendChild(s);
    return s;
  };
  // a plain grid cell for custom content
  const cell = (parent, cls, at, span = 1) => {
    const c = h('div', cls);
    c.style.gridColumn = `${at - curStart + 1} / span ${span}`;
    parent.appendChild(c);
    return c;
  };

  // LFO waves (21) grouped by shape, as the five lamps of the original panel
  const LFO_GROUPS = [
    { label: 'SINE', values: [0, 1, 2, 3, 4] },
    { label: 'TRIANGLE', values: [5, 6, 7, 8, 9] },
    { label: 'SQUARE', values: [10, 11, 12] },
    { label: 'SAW', values: [13, 14, 15, 16] },
    { label: 'S/H', values: [17, 18, 19, 20] },
  ];
  const LFO_NAMES = ['SINE', 'SINE OF1', 'SINE OF2', 'SIN180 OF1', 'SIN180 OF2',
    'TRI', 'TRI OF1', 'TRI OF2', 'TRI180 OF1', 'TRI180 OF2',
    'SQUARE', 'SQU OF1', 'SQU180 OF1', 'SAW DN', 'SAW DN OF2', 'SAW UP', 'SAW UP OF2',
    'S/H', 'S/H OF2', 'S/H2', 'S/H2 OF2'];
  // PWM / X-Mod sources: Fixed lights no lamp, LFO2 Phase/Fast light LFO2
  const pwmGroups = other => v => {
    const xmod = other === 'VCO1' && AN.get(v, P.vco2Wave) >= 4;
    const gs = [{ label: 'PEG', values: [1] }, { label: 'FEG', values: [2] }, { label: 'LFO1', values: [3] }];
    if (xmod) return [...gs, { label: 'LFO2', values: [4] }];
    return [...gs, { label: 'LFO2', values: [4, 5, 6] }, { label: other, values: [7] }];
  };
  const pwmCycle = other => v => (other === 'VCO1' && AN.get(v, P.vco2Wave) >= 4 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6, 7]);
  const PWM_NAMES = ['FIXED', 'PEG', 'FEG', 'LFO1', 'LFO2', 'LFO2 PHASE', 'LFO2 FAST'];

  // category names short enough (12 characters) for a 2-column cell in the Common panel
  const CATEGORY_SHORT = ['-- None', 'Pf Piano', 'Cp Chromatic', 'Or Organ', 'Gt Guitar', 'Ba Bass',
    'St Strings', 'En Ensemble', 'Br Brass', 'Rd Reed', 'Pi Pipe', 'Ld Lead', 'Pd Pad', 'Fx Synth FX',
    'Et Ethnic', 'Pc Percuss.', 'Se Sound FX', 'Dr Drums', 'Sc Comp', 'Vo Vocal', 'Co Combo',
    'Wv Mat. Wave', 'Sq Sequence'];
  const lfoDests = [];   // { bit, knob, slots: [lfo1 slot, lfo2 slot], places: [placeholder, placeholder] }
  const graphics = {};

  function buildVoicePage() {
    // ---- row 1
    let b = block('peg', 'PEG', { col: 1, span: 5, row: 1 });
    let r = row(b);
    makeLamps(r, P.pegSwitch, { at: 1, label: 'DEST', labels: ['VCO1', 'VCO2', 'BOTH'] });
    makeKnob(r, P.pegAttack, { at: 3, label: 'ATTACK', title: 'PEG Attack: time for the pitch to move from the played pitch to the Depth offset' });
    makeKnob(r, P.pegDecay, { at: 4, label: 'DECAY', title: 'PEG Decay: time to return to the played pitch (127 = hold the Depth offset)' });
    makeKnob(r, P.pegDepth, { at: 5, label: 'DEPTH', title: 'PEG Depth: pitch offset in semitones' });
    graphics.peg = Graphics.createEnvelope(b);

    // Rows: header, octave/P.B. knobs, free space, Free EG header, Free EG selectors.
    // The matrix list spans the knob row and the free space (cols 10-13), so it shows
    // more routings; Free EG sits at the bottom of the block.
    b = block('top', 'CTRL MATRIX', { col: 6, span: 8, row: 1, detail: 'matrix', cls: 'blk-top' });
    r = row(b, 'top-knobs');
    const oct = cell(r, 'oct', 6, 2);
    const octLeds = h('div', 'oct-leds');
    for (let i = 0; i < 5; i++) octLeds.appendChild(h('span', 'led-dot'));
    const octBtns = h('div', 'oct-btns');
    const octDown = h('button', 'pbtn');
    const octUp = h('button', 'pbtn');
    octDown.type = octUp.type = 'button';
    octDown.title = 'Octave shift down'; octUp.title = 'Octave shift up';
    octBtns.append(octDown, octUp);
    oct.append(octLeds, octBtns, h('span', 'knob-lbl', '<<  OCT  >>'));
    register({
      d: P.octShift, wrap: oct,
      refresh() {
        const val = getRaw(P.octShift) - P.octShift.min;
        [...octLeds.children].forEach((l, i) => l.classList.toggle('lit', i === val));
        octDown.disabled = octUp.disabled = state.comparing;
        oct.title = `Octave Shift: ${fmtValue(P.octShift, getRaw(P.octShift))}`;
        applyCompare(oct, P.octShift);
      },
    });
    octDown.addEventListener('click', () => commit(P.octShift, getRaw(P.octShift) - 1));
    octUp.addEventListener('click', () => commit(P.octShift, getRaw(P.octShift) + 1));
    makeKnob(r, P.pbUp, { at: 8, label: 'P.B. UP', title: 'Pitch bend range up (semitones)' });
    makeKnob(r, P.pbDown, { at: 9, label: 'P.B. DOWN', title: 'Pitch bend range down (semitones)' });
    graphics.matrix = cell(b, 'mtx-summary', 10, 4);
    const fegHead = h('div', 'mini-head');
    fegHead.appendChild(h('h4', null, 'FREE EG'));
    const fegBtn = h('button', 'detail-btn', 'DETAIL');
    fegBtn.type = 'button';
    fegBtn.addEventListener('click', () => showTab('feg'));
    fegHead.appendChild(fegBtn);
    b.appendChild(fegHead);
    r = row(b, 'short');
    for (let t = 0; t < 4; t++) makeLcdSelect(r, P['fegParam' + t], { at: 6 + t * 2, label: `TRACK ${t + 1}`, cls: 'wide' });

    b = block('pg', 'PATTERN GEN.', { col: 14, span: 7, row: 1, detail: 'pattern' });
    r = row(b);
    makeKnob(r, P.tempo, { at: 14, label: 'TEMPO' });
    makeToggle(r, P.pgHold, { at: 15, label: 'HOLD', isOn: () => getRaw(P.pgHold) > 0, onClick: () => commit(P.pgHold, getRaw(P.pgHold) > 0 ? 0 : 1) });
    const pgButton = (sel, label, at) => makeToggle(r, P.pgOn, {
      at, label,
      title: sel === 0 ? 'Arpeggio on/off' : 'Step sequencer on/off',
      isOn: () => getRaw(P.pgOn) === 1 && getRaw(P.pgSelect) === sel,
      onClick: () => {
        if (getRaw(P.pgOn) === 1 && getRaw(P.pgSelect) === sel) commit(P.pgOn, 0);
        else { if (getRaw(P.pgSelect) !== sel) commit(P.pgSelect, sel); if (getRaw(P.pgOn) !== 1) commit(P.pgOn, 1); }
      },
    });
    pgButton(0, 'ARPEGGIO', 16);
    pgButton(1, 'SEQ', 17);
    makeLcdSelect(r, P.pgType, { at: 18, span: 3, label: 'TYPE / PATTERN', cls: 'wide' });

    // ---- row 2: LFOs and VCF (VCF + FEG span rows 2-3)
    // Each LFO depth has a cell in both LFO blocks: the knob sits in the LFO it
    // is assigned to, the other block shows a button to move it there.
    const lfoBlock = (id, title, col, waveP, speedP, delayP) => {
      const bb = block(id, title, { col, span: id === 'lfo1' ? 5 : 8, row: 2, detail: 'detail' });
      const r1 = row(bb);
      makeLamps(r1, waveP, { at: col, label: 'WAVE', groups: LFO_GROUPS, names: LFO_NAMES });
      makeKnob(r1, speedP, { at: col + 2, label: 'SPEED' });
      if (delayP) makeKnob(r1, delayP, { at: col + 3, label: 'DELAY' });
      return row(bb);
    };
    const lfo1Row = lfoBlock('lfo1', 'LFO 1', 1, P.lfo1Wave, P.lfo1Speed, P.lfo1Delay);
    const lfo2Row = lfoBlock('lfo2', 'LFO 2', 6, P.lfo2Wave, P.lfo2Speed, null);
    [['VCO1', 8, P.vco1Pmod, 'LFO pitch modulation depth of VCO1'], ['VCO2', 4, P.vco2Pmod, 'LFO pitch modulation depth of VCO2'],
      ['VCA', 2, P.vcaMod, 'LFO amplitude modulation depth (tremolo)'], ['VCF', 1, P.vcfMod, 'LFO filter modulation depth (wah)']]
      .forEach(([name, bit, d, title], k) => {
        curStart = 1;
        const s1 = cell(lfo1Row, 'slot', 2 + k);
        curStart = 6;
        const s2 = cell(lfo2Row, 'slot', 7 + k);
        const knob = makeKnob(s1, d, { label: name, title });
        const places = [s1, s2].map((slot, lfo) => {
          const ph = h('div', 'toggle placeholder');
          const btn = h('button', 'pbtn');
          btn.type = 'button';
          btn.appendChild(h('span', 'led-dot'));
          btn.title = `Modulate ${name} with LFO ${lfo + 1} (LFO Assign Group)`;
          btn.addEventListener('click', () => {
            if (state.comparing) return;
            const m = getRaw(P.lfoAssign);
            commit(P.lfoAssign, lfo ? m | bit : m & ~bit);
          });
          ph.append(btn, h('span', 'toggle-lbl', '→ ' + name));
          slot.appendChild(ph);
          return { ph, btn };
        });
        lfoDests.push({ bit, knob, slots: [s1, s2], places });
      });

    // VCF spans panel rows 2-3 and follows them (row subgrid): the VCF controls and a
    // tall FEG graph beside the LFOs, the FEG knobs level with the mixer knobs.
    b = block('vcf', 'VCF', { col: 14, span: 7, row: 2, rows: 2, cls: 'hot vcf-split' });
    const vcfTop = h('div', 'vcf-top'), vcfBottom = h('div', 'vcf-bottom');
    vcfTop.appendChild(blocks.vcf.head);
    b.append(vcfTop, vcfBottom);
    r = row(vcfTop);
    makeLamps(r, P.vcfType, { at: 14, label: 'TYPE' });
    makeKnob(r, P.cutoff, { at: 16, label: 'CUTOFF' });
    makeKnob(r, P.reso, { at: 17, label: 'RES.' });
    makeKnob(r, P.keyTrk, { at: 18, label: 'KEY TRK' });
    makeKnob(r, P.hpf, { at: 19, label: 'HPF', title: 'High pass filter cutoff (0 = thru)' });
    makeKnob(r, P.fegVel, { at: 20, label: 'VELOCITY', title: 'FEG velocity sensitivity' });
    let s = sub(vcfTop, 'FEG');
    graphics.feg = Graphics.createEnvelope(s);
    r = row(vcfBottom);
    makeKnob(r, P.fegDepth, { at: 16, label: 'DEPTH' });
    makeKnob(r, P.fegA, { at: 17, label: 'ATTACK' });
    makeKnob(r, P.fegD, { at: 18, label: 'DECAY' });
    makeKnob(r, P.fegS, { at: 19, label: 'SUSTAIN' });
    makeKnob(r, P.fegR, { at: 20, label: 'RELEASE' });

    // ---- row 3: sync, FM, mixer
    b = block('sync', 'SYNC', { col: 1, span: 5, row: 3, detail: 'detail' });
    r = row(b);
    makeLamps(r, P.syncMode, { at: 1, label: 'MODE', labels: ['OFF', 'VCO1 M>S', 'VCO2>1'] });
    makeLamps(r, P.syncSrc, { at: 3, label: 'SRC', labels: ['FIXED', 'PEG', 'FEG', 'LFO1', 'LFO2'] });
    makeKnob(r, P.syncDepth, { at: 5, label: 'DEPTH', title: 'Sync pitch modulation depth (from SRC)' });

    b = block('fm', 'FM', { col: 6, span: 3, row: 3, detail: 'detail' });
    r = row(b);
    makeLcdSelect(r, P.fmSrc2, { at: 6, label: 'MODULATOR', cls: 'wide' });
    makeKnob(r, P.fmDepth, { at: 8, label: 'DEPTH' });

    b = block('mix', 'MIXER', { col: 9, span: 5, row: 3, cls: 'hot' });
    r = row(b);
    makeKnob(r, P.mixVco1, { at: 9, label: 'VCO1' });
    makeKnob(r, P.mixVco2, { at: 10, label: 'VCO2' });
    makeKnob(r, P.mixNoise, { at: 11, label: 'NOISE' });
    makeKnob(r, P.mixRing, { at: 12, label: 'RING' });
    makeKnob(r, P.vcaFb, { at: 13, label: 'F.B.', title: 'VCA feedback level' });

    // ---- row 4: oscillators and VCA
    const vco = (id, title, col, p, extra) => {
      const bb = block(id, title, { col, span: id === 'vco1' ? 5 : 8, row: 4, cls: 'hot' });
      const r1 = row(bb);
      makeLamps(r1, p.wave, { at: col, label: 'WAVE', sizes: p.waveSizes });
      makeKnob(r1, p.pitch, { at: col + 2, label: 'PITCH' });
      makeKnob(r1, p.fine, { at: col + 3, label: 'FINE' });
      if (extra) extra(r1);
      const ss = sub(bb, p.subTitle);
      const r2 = row(ss);
      makeLamps(r2, p.src, { at: col, label: 'SRC', groups: pwmGroups(p.other), cycle: pwmCycle(p.other), names: [...PWM_NAMES, p.other] });
      makeKnob(r2, p.depth, { at: col + 2, label: p.depthLabel });
      makeKnob(r2, p.pw, { at: col + 3, label: p.pwLabel });
      makeKnob(r2, p.edge, { at: col + 4, label: 'EDGE' });
    };
    vco('vco1', 'VCO 1', 1, {
      wave: P.vco1Wave, pitch: P.vco1Pitch, fine: P.vco1Fine, subTitle: 'PWM', other: 'VCO2',
      // both wave lists (sync off / on), so the cell keeps its width when Sync changes
      waveSizes: ['Saw', 'Pulse', 'Saw2', 'Mix', 'Multi Saw', 'Inner1', 'Inner2', 'Inner3', 'Square', 'Noise'],
      src: P.vco1PwmSrc, depth: P.vco1Pwm, pw: P.vco1Pw, edge: P.vco1Edge,
      depthLabel: v => (vco1Multi(v) ? 'DETUNE' : 'DEPTH'), pwLabel: v => (vco1Multi(v) ? 'MIX' : 'PW'),
    }, r1 => makeKnob(r1, P.syncPitch, { at: 5, label: 'SYNC PITCH', title: 'Sync pitch (pitch of the synced oscillator)' }));
    vco('vco2', 'VCO 2', 6, {
      wave: P.vco2Wave, pitch: P.vco2Pitch, fine: P.vco2Fine, subTitle: 'PWM / X-MOD', other: 'VCO1',
      src: P.vco2PwmSrc, depth: P.vco2Pwm, pw: P.vco2Pw, edge: P.vco2Edge,
      depthLabel: v => (AN.get(v, P.vco2Wave) >= 4 ? 'X-MOD' : 'DEPTH'), pwLabel: 'PW',
    });

    b = block('vca', 'VCA', { col: 14, span: 7, row: 4, cls: 'hot' });
    r = row(b);
    makeKnob(r, P.volume, { at: 16, label: 'VOLUME' });
    makeKnob(r, P.aegVel, { at: 20, label: 'VELOCITY', title: 'AEG velocity sensitivity' });
    s = sub(b, 'AEG');
    graphics.aeg = Graphics.createEnvelope(s);
    r = row(s);
    makeKnob(r, P.aegA, { at: 17, label: 'ATTACK' });
    makeKnob(r, P.aegD, { at: 18, label: 'DECAY' });
    makeKnob(r, P.aegS, { at: 19, label: 'SUSTAIN' });
    makeKnob(r, P.aegR, { at: 20, label: 'RELEASE' });

    // ---- row 5: common and distortion
    b = block('com', 'COMMON / PORTAMENTO', { col: 1, span: 13, row: 5, detail: 'detail' });
    r = row(b);
    // category and name first (2 columns each, like the 2-column selectors above them)
    makeLcdSelect(r, P.category, { at: 1, label: 'CATEGORY', cls: 'wide', labels: CATEGORY_SHORT });
    const nameCell = cell(r, 'lcdsel wide name-cell', 3, 2);
    nameCell.append(makeNameInput(), h('span', 'lcdsel-lbl', 'VOICE NAME'));
    makeLamps(r, P.keyMode, { at: 5, label: 'KEY MODE', labels: ['POLY', 'MONO', 'LEGATO'] });
    makeToggle(r, P.unison, { at: 7, label: 'UNISON' });
    makeKnob(r, P.unisonDetune, { at: 8, label: 'DETUNE', title: 'Unison detune' });
    // MORPH: system-wide (Native System "Morph Ctrl", 00 08 04), not stored in the voice, as on
    // the AN Expert Editor. On = the last used morph controller (CC 1 the first time), off = Off.
    const morphD = NATIVE_SYS.find(d => d.addr === 0x04);
    makeToggle(r, morphD, {
      at: 9, label: 'MORPH',
      title: 'Morphing on/off (system setting, not stored in the voice). Controller and morph voice: PLG150-AN Native tab',
      isOn: () => getRaw(morphD) !== 0,
      onClick: () => {
        const cur = getRaw(morphD);
        if (cur) { settings.morphCc = cur; saveSettings(); commit(morphD, 0); }
        else commit(morphD, settings.morphCc || 1);
      },
    });
    makeToggle(r, P.portaSw, { at: 10, label: 'PORTA SW' });
    makeKnob(r, P.portaTime, { at: 11, label: 'TIME', title: 'Portamento time' });
    makeLcdSelect(r, P.portaMode, { at: 12, label: 'PORTA MODE', cls: 'wide' });

    b = block('dist', 'DIST / EQ', { col: 14, span: 7, row: 5, detail: 'detail' });
    r = row(b);
    makeLamps(r, P.ampType, { at: 14, label: 'AMP', labels: ['OFF', 'STACK', 'COMBO', 'TUBE'] });
    makeKnob(r, P.distDrive, { at: 16, label: 'DRIVE' });
    makeKnob(r, P.dryWet, { at: 17, label: 'DRY/WET' });
    makeKnob(r, P.eqLowG, { at: 18, label: 'LO' });
    makeKnob(r, P.eqMidG, { at: 19, label: 'MID' });
    makeKnob(r, P.eqHighG, { at: 20, label: 'HI' });
  }
  const vco1Multi = v => AN.get(v, P.syncMode) === 0 && AN.get(v, P.vco1Wave) === 4;

  // ---------------------------------------------------------------- detail page
  function panelBlock(parentId, title, cls) {
    const p = h('div', 'panel block' + (cls ? ' ' + cls : ''));
    p.appendChild(h('h3', null, title));
    const f = h('div', 'fields');
    p.appendChild(f);
    $(parentId).appendChild(p);
    return f;
  }

  // Voice name text box (Detail tab and the Common panel); all copies are kept
  // in sync by updateLcd(). Each character is sent as a Common parameter change.
  function makeNameInput() {
    const input = h('input', 'mono voice-name');
    input.type = 'text'; input.maxLength = 10;
    input.title = 'Voice name (10 characters)';
    input.addEventListener('input', () => {
      if (state.comparing) return;
      AN.setName(state.edit, input.value);
      markEdited();
      for (let i = 0; i < 10; i++) {
        queueSend('v' + i, Sysex.param(settings.device, 0x10, 0x00, i, [state.edit[i]]), 'Voice name');
      }
      updateLcd();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
    return input;
  }

  function buildDetailPage() {
    let f = panelBlock('detailRow', 'Common');
    const nameWrap = h('label', 'field wide');
    nameWrap.title = 'Voice name (10 characters)';
    nameWrap.appendChild(h('span', null, 'Voice Name'));
    nameWrap.appendChild(makeNameInput());
    f.appendChild(nameWrap);
    makeField(f, P.category, { wide: true });
    makeField(f, P.keyMode);
    makeField(f, P.unison);
    makeField(f, P.unisonDetune);
    makeField(f, P.portaSw);
    makeField(f, P.portaMode, { wide: true });
    makeField(f, P.portaTime);
    makeField(f, P.splitPoint, { title: 'Split point for the arpeggio/step seq keyboard modes' });
    makeField(f, P.octShift);
    makeField(f, P.outGain);

    f = panelBlock('detailRow', 'Pitch');
    makeField(f, P.pbUp, { label: 'Bend Up' });
    makeField(f, P.pbDown, { label: 'Bend Down' });
    makeField(f, P.pegAttack);
    makeField(f, P.pegDecay);
    makeField(f, P.pegDepth);
    makeField(f, P.pegSwitch);

    f = panelBlock('detailRow', 'LFO');
    makeField(f, P.lfo1Wave, { wide: true });
    makeField(f, P.lfo1Speed);
    makeField(f, P.lfo1Delay);
    makeField(f, P.lfo2Wave, { wide: true });
    makeField(f, P.lfo2Speed);
    makeField(f, P.lfoReset);
    makeField(f, P.lfoAssign, {
      wide: true, select: true, label: 'Assign Group (to LFO2)',
      title: 'Destinations modulated by LFO2; the others follow LFO1',
    });

    f = panelBlock('detailRow', 'Sync / FM');
    makeField(f, P.syncMode, { wide: true });
    makeField(f, P.syncSrc);
    makeField(f, P.syncPmod);
    makeField(f, P.syncPitch);
    makeField(f, P.syncDepth);
    makeField(f, P.fmAlgo, { title: 'FM Algorithm (only with Sync Mode "VCO1 Master>Slave")' });
    makeField(f, P.fmSrc1, { wide: true });
    makeField(f, P.fmSrc2, { wide: true });
    makeField(f, P.fmDepth);

    f = panelBlock('detailRow', 'Distortion');
    makeField(f, P.ampType);
    makeField(f, P.distDrive);
    makeField(f, P.distLpf);
    makeField(f, P.distLevel);
    makeField(f, P.dryWet);

    f = panelBlock('detailRow', 'EQ');
    makeField(f, P.eqLowF, { label: 'Low Freq' });
    makeField(f, P.eqLowG, { label: 'Low Gain' });
    makeField(f, P.eqMidF, { label: 'Mid Freq' });
    makeField(f, P.eqMidG, { label: 'Mid Gain' });
    makeField(f, P.eqMidQ, { label: 'Mid Q' });
    makeField(f, P.eqHighF, { label: 'High Freq' });
    makeField(f, P.eqHighG, { label: 'High Gain' });
  }
  // assign group shown as a readable list in the detail select
  P.lfoAssign.opts = range(16, m => {
    const names = [['VCO1', 8], ['VCO2', 4], ['VCA', 2], ['VCF', 1]].filter(([, b]) => m & b).map(([n]) => n);
    return names.length ? names.join(' + ') : 'None (LFO1 to all)';
  });

  // ---------------------------------------------------------------- control matrix page
  function buildMatrixPage() {
    const t = $('matrixTable');
    const head = h('div', 'mtx-row mtx-head');
    ['#', 'Source', 'Parameter', 'Depth'].forEach(s => head.appendChild(h('span', null, s)));
    t.appendChild(head);
    for (let i = 0; i < 15; i++) {
      const r = h('div', 'mtx-row');
      r.appendChild(h('span', 'mtx-num', String(i + 1)));
      makeField(r, P['mSrc' + i], { label: 'Source' });
      makeField(r, P['mPar' + i], { label: 'Parameter' });
      makeField(r, P['mDep' + i], { label: 'Depth', title: 'Control range of the source (Direct = the parameter follows the controller over its own range)' });
      t.appendChild(r);
    }
    const f = panelBlock('matrixSide', 'Pitch Bend Range');
    makeField(f, P.pbUp, { label: 'Up' });
    makeField(f, P.pbDown, { label: 'Down' });
    // the explanation goes below the panel, so the panel's top lines up with the matrix table
    const side = $('matrixSide');
    side.appendChild(side.querySelector('.note'));
  }

  // ---------------------------------------------------------------- free EG page
  const feg = { track: 0, tool: 'pencil', clip: null, canvas: null, last: null, lineStart: null, blinkTimer: null, blinkOn: true };

  function buildFegPage() {
    feg.track = clamp(settings.fegTrack | 0, 0, 3);
    const tracks = $('fegTracks');
    for (let t = 0; t < 4; t++) {
      const b = h('button', 'btn', 'Track ' + (t + 1));
      b.type = 'button';
      b.dataset.track = t;
      b.addEventListener('click', () => { feg.track = t; settings.fegTrack = t; saveSettings(); refreshFegTrack(); });
      tracks.appendChild(b);
    }
    // per-track parameter fields (all four, the selected one highlighted)
    const tf = panelBlock('fegSide', 'Track Parameters');
    for (let t = 0; t < 4; t++) {
      makeField(tf, P['fegParam' + t], { label: `Trk ${t + 1} Param`, wide: true });
      makeField(tf, P['fegScene' + t], { label: `Trk ${t + 1} Scene Sw`, wide: true, title: 'Scene switch (on: the track runs on Scene 1)' });
    }
    const cf = panelBlock('fegSide', 'Common');
    makeField(cf, P.fegLength, { wide: true });
    makeField(cf, P.fegTrigger, { wide: true });
    makeField(cf, P.fegLoop, { wide: true });
    makeField(cf, P.fegKeyTrk, { wide: true });
    makeField(cf, P.tempo, { wide: true, title: 'Tempo (used when the length is set in bars)' });

    const tools = $('fegTools');
    const toolBtn = (id, label, title) => {
      const b = h('button', 'btn small', label);
      b.type = 'button'; b.dataset.tool = id; b.title = title;
      b.addEventListener('click', () => { feg.tool = id; feg.lineStart = null; refreshFegTools(); });
      tools.appendChild(b);
    };
    toolBtn('pencil', 'Pencil', 'Draw freehand');
    toolBtn('line', 'Line', 'Click and drag to draw a straight line');
    const action = (label, title, fn, parent = tools, cls = 'btn small') => {
      const b = h('button', cls, label);
      b.type = 'button'; b.title = title;
      b.addEventListener('click', () => { if (!state.comparing) { fn(); fegChanged(); } });
      parent.appendChild(b);
      return b;
    };
    tools.appendChild(h('span', 'tool-sep'));
    const N = AN.FEG_POINTS;
    const setAll = f => { for (let i = 0; i < N; i++) AN.fegSet(state.edit, feg.track, i, clamp(f(i, AN.fegGet(state.edit, feg.track, i)), -128, 127)); };
    action('Flat', 'Set the whole track to 0', () => setAll(() => 0));
    action('Ramp ↗', 'Ramp from −127 to +127', () => setAll(i => -127 + 254 * i / (N - 1)));
    action('Ramp ↘', 'Ramp from +127 to −127', () => setAll(i => 127 - 254 * i / (N - 1)));
    action('Triangle', 'One triangle cycle', () => setAll(i => 127 - 254 * Math.abs(2 * i / (N - 1) - 1)));
    action('Sine', 'One sine cycle', () => setAll(i => 127 * Math.sin(2 * Math.PI * i / N)));
    action('Pulse', 'Square pulse: first half up, second half down', () => setAll(i => (i < N / 2 ? 100 : -100)));
    action('Random', 'Random steps (16)', () => { const steps = range(16, () => Math.round(Math.random() * 254 - 127)); setAll(i => steps[Math.floor(i * 16 / N)]); });
    action('Smooth', 'Smooth the curve', () => {
      const src = range(N, i => AN.fegGet(state.edit, feg.track, i));
      setAll(i => (src[Math.max(0, i - 2)] + src[Math.max(0, i - 1)] + src[i] + src[Math.min(N - 1, i + 1)] + src[Math.min(N - 1, i + 2)]) / 5);
    });
    action('Invert', 'Flip the curve around 0', () => setAll((i, v) => -v));
    action('Scale ½', 'Halve the curve depth', () => setAll((i, v) => v / 2));
    action('Scale ×2', 'Double the curve depth', () => setAll((i, v) => v * 2));
    // Copy / Paste: at the right end of the track selector row
    const clip = h('span', 'feg-clip');
    tracks.appendChild(clip);
    const copy = h('button', 'btn', 'Copy');
    copy.type = 'button'; copy.title = 'Copy the selected track';
    copy.addEventListener('click', () => { feg.clip = range(N, i => AN.fegGet(state.edit, feg.track, i)); toast(`Track ${feg.track + 1} copied`); });
    clip.appendChild(copy);
    action('Paste', 'Paste the copied track into the selected track', () => { if (feg.clip) setAll(i => feg.clip[i]); }, clip, 'btn feg-paste');

    const cv = $('fegCanvas');
    feg.canvas = cv;
    const pointAt = e => {
      const r = cv.getBoundingClientRect();
      const x = clamp(Math.floor((e.clientX - r.left) / r.width * N), 0, N - 1);
      const y = clamp(Math.round(127 - (e.clientY - r.top) / r.height * 255), -128, 127);
      return { x, y };
    };
    const drawSeg = (a, b2) => {
      const n = Math.abs(b2.x - a.x);
      for (let k = 0; k <= n; k++) {
        const x = n ? a.x + Math.sign(b2.x - a.x) * k : a.x;
        const y = n ? a.y + (b2.y - a.y) * k / n : b2.y;
        AN.fegSet(state.edit, feg.track, x, y);
      }
    };
    let snapshot = null;
    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0 || state.comparing || busyCount) return;
      // a new stroke cancels a pending resend; it is rescheduled on release
      clearTimeout(commonTimer);
      cv.setPointerCapture(e.pointerId);
      const p = pointAt(e);
      feg.last = p;
      if (feg.tool === 'line') { feg.lineStart = p; snapshot = AN.cloneVoice(state.edit); }
      else drawSeg(p, p);
      drawFeg(p);
    });
    cv.addEventListener('pointermove', e => {
      const p = pointAt(e);
      if (busyCount) return;   // pointer capture would bypass the busy overlay
      if (!cv.hasPointerCapture(e.pointerId)) { drawFeg(p); return; }
      if (feg.tool === 'line' && feg.lineStart) {
        state.edit.set(snapshot);
        drawSeg(feg.lineStart, p);
      } else {
        drawSeg(feg.last, p);
      }
      feg.last = p;
      drawFeg(p);
    });
    const end = e => {
      if (!cv.hasPointerCapture(e.pointerId)) return;
      cv.releasePointerCapture(e.pointerId);
      feg.lineStart = null; snapshot = null;
      fegChanged();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => drawFeg());
    new ResizeObserver(() => drawFeg()).observe(cv);
    refreshFegTools();
  }
  function refreshFegTools() {
    document.querySelectorAll('#fegTools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === feg.tool));
  }
  // true when a Free EG track's points differ between the edit buffer and the original voice
  function fegTrackChanged(t) {
    const o = AN.FEG_OFS + t * AN.FEG_POINTS * 2;
    for (let i = o; i < o + AN.FEG_POINTS * 2; i++) if (state.edit[i] !== state.original[i]) return true;
    return false;
  }
  // Track buttons follow Compare like the other controls: unchanged tracks are
  // greyed out, edited ones blink. They stay clickable to view each track.
  // The drawing tools are disabled while comparing.
  function refreshFegTrack() {
    document.querySelectorAll('#fegTracks [data-track]').forEach(b => {
      const t = +b.dataset.track;
      const changed = state.comparing && fegTrackChanged(t);
      b.classList.toggle('on', t === feg.track);
      b.classList.toggle('cmp-same', state.comparing && !changed);
      b.classList.toggle('cmp-changed', changed);
    });
    document.querySelectorAll('#fegTools button, .feg-paste').forEach(b => { b.disabled = state.comparing; });
    drawFeg();
  }
  // Blink timer for the compared curve: runs only while the shown track is edited,
  // Compare is on and the canvas is visible (drawFeg stops it otherwise).
  function setFegBlink(on) {
    if (on && !feg.blinkTimer) {
      feg.blinkOn = true;
      feg.blinkTimer = setInterval(() => {
        if (!feg.canvas.clientWidth) { setFegBlink(false); return; }
        feg.blinkOn = !feg.blinkOn;
        drawFeg();
      }, 400);
    } else if (!on && feg.blinkTimer) {
      clearInterval(feg.blinkTimer);
      feg.blinkTimer = null;
      feg.blinkOn = true;
    }
  }
  function fegChanged() {
    markEdited();
    scheduleCommonBulk();
    state.lastParam = `Free EG track ${feg.track + 1} edited`;
    updateLcd();
    drawFeg();
  }
  function drawFeg(cursor) {
    const cv = feg.canvas;
    if (!cv || !cv.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = '#05070f';
    g.fillRect(0, 0, W, H);
    const N = AN.FEG_POINTS;
    const yOf = v => (127 - v) / 255 * H;
    g.strokeStyle = '#26304d';
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    for (const v of [64, -64]) { g.beginPath(); g.moveTo(0, yOf(v)); g.lineTo(W, yOf(v)); g.stroke(); }
    for (let q = 1; q < 4; q++) { g.beginPath(); g.moveTo(W * q / 4, 0); g.lineTo(W * q / 4, H); g.stroke(); }
    g.setLineDash([]);
    g.strokeStyle = '#3a4670';
    g.beginPath(); g.moveTo(0, yOf(0)); g.lineTo(W, yOf(0)); g.stroke();
    g.fillStyle = '#5c6a99';
    g.font = '10px Helvetica, Arial, sans-serif';
    g.textBaseline = 'top'; g.fillText('+127', 4, 3);
    g.textBaseline = 'bottom'; g.fillText('0', 4, yOf(0) - 2); g.fillText('−128', 4, H - 3);
    const v = shownVoice();
    // other tracks faintly
    for (let t = 0; t < 4; t++) {
      if (t === feg.track) continue;
      g.strokeStyle = 'rgba(120, 140, 200, .25)';
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5) / N * W, y = yOf(AN.fegGet(v, t, i));
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    const curve = (voice, stroke, width, dash = []) => {
      g.strokeStyle = stroke; g.lineWidth = width; g.setLineDash(dash);
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5) / N * W, y = yOf(AN.fegGet(voice, feg.track, i));
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
    };
    const changed = state.comparing && fegTrackChanged(feg.track);
    setFegBlink(changed);
    const green = css.getPropertyValue('--feg-line').trim() || '#4dff6a';
    if (changed) {
      // Compare: the original (sounding) curve in orange, the edit dashed for reference
      curve(state.edit, 'rgba(77, 255, 106, .45)', 1.5, [5, 4]);
      // blinks like the other compared controls (cmp-blink: 0.8 s, dim to 20%)
      g.globalAlpha = feg.blinkOn ? 1 : 0.2;
      curve(v, css.getPropertyValue('--accent-3').trim() || '#ff8a3d', 2);
      g.globalAlpha = 1;
    } else {
      curve(v, state.comparing ? 'rgba(77, 255, 106, .35)' : green, 2);
    }
    const info = $('fegInfo');
    const label = `Track ${feg.track + 1}: ${AN.FEG_PARAMS[AN.get(v, P['fegParam' + feg.track])]}`;
    if (state.comparing) {
      info.textContent = `COMPARE  ${label}  ` + (changed ? '(edited: original in orange, edit dashed)' : '(unchanged)');
    } else if (cursor) {
      info.textContent = `Step ${cursor.x + 1}  Value ${AN.fegGet(v, feg.track, cursor.x)}  (pointer ${cursor.y})`;
    } else {
      info.textContent = label;
    }
  }

  // ---------------------------------------------------------------- pattern generator page
  const stepCols = [];
  function buildPatternPage() {
    let f = panelBlock('patternRow', 'Common');
    makeField(f, P.pgOn);
    makeField(f, P.pgSelect);
    makeField(f, P.tempo);
    makeField(f, P.splitPoint);
    makeField(f, P.pgHold);
    makeField(f, P.pgVelocity);
    makeField(f, P.swing, { title: 'Swing (step seq only)' });
    makeField(f, P.pgGate, { title: 'Gate time (step seq only)' });

    f = panelBlock('patternRow', 'Arpeggio / Step Seq Mode');
    makeField(f, P.pgType, { wide: true, title: 'Arpeggio type, or the user pattern selected in the PtnSel keyboard modes' });
    makeField(f, P.pgKbdMode, { wide: true });
    makeField(f, P.arpSubdivide, { title: 'Arpeggio subdivide (note length)' });

    f = panelBlock('patternRow', 'Step Seq Pattern');
    makeField(f, P.ssLength);
    makeField(f, P.ssBase);
    makeField(f, P.ssLoop);
    makeField(f, P.ssCc, { title: 'Control change sent by the CC row (Off = no control change)' });

    const grid = $('stepGrid');
    const rowNames = [['Note', 'ssNote'], ['Velocity', 'ssVel'], ['Gate', 'ssGate'], ['CC Value', 'ssCcv']];
    const labels = h('div', 'step-col step-labels');
    labels.appendChild(h('span', 'step-num', ''));
    rowNames.forEach(([n]) => labels.appendChild(h('span', 'step-rowlbl', n)));
    grid.appendChild(labels);
    for (let i = 0; i < 16; i++) {
      const col = h('div', 'step-col');
      col.appendChild(h('span', 'step-num', String(i + 1)));
      rowNames.forEach(([n, k]) => makeKnob(col, P[k + i], { small: true, label: '', title: `Step ${i + 1} ${n}` }));
      grid.appendChild(col);
      stepCols.push(col);
    }
  }
  function refreshSteps() {
    const len = AN.get(shownVoice(), P.ssLength);
    stepCols.forEach((c, i) => c.classList.toggle('beyond', i >= len));
  }

  // ---------------------------------------------------------------- native page
  function buildNativePage() {
    let f = panelBlock('nativeRow', 'PLG150-AN System');
    NATIVE_SYS.forEach(d => makeField(f, d, { wide: d.addr === 0x02 || d.addr === 0x07 }));
    f = panelBlock('nativeRow', 'Control Source CC Numbers (AN1x System)');
    AN1X_SYS.forEach(d => makeField(f, d));
    f = panelBlock('nativeRow', 'Native Part', 'wide-block');
    NATIVE_PART.forEach(d => makeField(f, d));
  }
  function sendNativeAll() {
    if (!requireOutput()) return;
    const dev = settings.device;
    const data = (d, raw) => (d.size === 2 ? [(raw >> 7) & 0x7F, raw & 0x7F] : [raw]);
    const list = [
      ...NATIVE_SYS.map(d => [Sysex.nativeSystem(dev, d.addr, data(d, state.nsys[d.addr])), 'Native system ' + d.label]),
      ...AN1X_SYS.map(d => [Sysex.an1xSystem(dev, d.addr, data(d, state.asys[d.addr])), 'AN1x system ' + d.label]),
      ...NATIVE_PART.map(d => [Sysex.nativePart(dev, settings.part, d.addr, data(d, state.npart[d.addr])), 'Native part ' + d.label]),
    ];
    whileBusy(() => midi.sendSequence(list, 15)).then(() => toast('Native settings sent'));
  }

  // ---------------------------------------------------------------- graphics & LCD
  function updateGraphics(key) {
    const v = shownVoice();
    const all = key == null;
    if (all || /^peg/.test(key)) Graphics.drawPeg(graphics.peg, AN.get(v, P.pegAttack), AN.get(v, P.pegDecay), AN.get(v, P.pegDepth) - 64);
    if (all || /^feg([ADSR]|Depth)$/.test(key)) Graphics.drawFeg(graphics.feg, AN.get(v, P.fegA), AN.get(v, P.fegD), AN.get(v, P.fegS), AN.get(v, P.fegR), AN.get(v, P.fegDepth) - 128);
    if (all || /^aeg[ADSR]$/.test(key)) Graphics.drawAeg(graphics.aeg, AN.get(v, P.aegA), AN.get(v, P.aegD), AN.get(v, P.aegS), AN.get(v, P.aegR));
    if (all || key === 'lfoAssign') {
      const m = AN.get(v, P.lfoAssign);
      for (const dst of lfoDests) {
        const lfo = (m & dst.bit) ? 1 : 0;
        if (dst.knob.wrap.parentElement !== dst.slots[lfo]) dst.slots[lfo].appendChild(dst.knob.wrap);
        dst.places.forEach((p, i) => { p.ph.hidden = i === lfo; p.btn.disabled = state.comparing; });
      }
    }
    if (all || /^m(Src|Par|Dep)|^pb/.test(key)) drawMatrixSummary();
    if (all || /^ss|^feg/.test(key)) { refreshSteps(); refreshFegTrack(); }
  }

  function drawMatrixSummary() {
    const v = shownVoice();
    const el = graphics.matrix;
    el.innerHTML = '';
    let n = 0;
    for (let i = 0; i < 15; i++) {
      const s = AN.get(v, P['mSrc' + i]), p = AN.get(v, P['mPar' + i]);
      if (!s || !p) continue;
      n++;
      const line = h('div', 'mtx-line');
      line.appendChild(h('span', 'mtx-src', AN.CTRL_SOURCES[s] || String(s)));
      line.appendChild(h('span', 'mtx-arrow', '→'));
      line.appendChild(h('span', 'mtx-par', AN.MATRIX_PARAMS[p] || String(p)));
      line.appendChild(h('span', 'mtx-dep', fmtValue(P['mDep' + i], AN.get(v, P['mDep' + i]))));
      el.appendChild(line);
    }
    if (!n) el.appendChild(h('div', 'mtx-more', 'No control matrix routings'));
  }

  // 21 characters: bank (3) + number (3) + category (3) + a 10-character name + 2 spaces
  const LCD_CHARS = 21;
  function updateLcd() {
    const num = String(state.index + 1).padStart(3, '0');
    const v = shownVoice();
    Graphics.drawSevenSegment($('ledSvg'), num, state.edited);
    $('led').setAttribute('aria-label', `Voice ${num}${state.edited ? ', edited' : ''}`);
    $('led').classList.toggle('blink', state.comparing);
    $('lcd1').textContent = `${bankShort(state.bankName)} ${num} ${AN.displayName(v)}`.slice(0, LCD_CHARS);
    $('lcd2').textContent = (state.comparing ? 'COMPARE' : state.storeMode ? 'STORE: SELECT SLOT' : state.lastParam || bankLabel(state.bankName)).slice(0, LCD_CHARS);
    const name = AN.getName(v).trimEnd();
    const nameChanged = AN.getName(state.original) !== AN.getName(state.edit);
    document.querySelectorAll('.voice-name').forEach(ni => {
      if (document.activeElement !== ni) ni.value = name;
      ni.disabled = state.comparing;
      ni.parentElement.classList.toggle('cmp-same', state.comparing && !nameChanged);
      ni.parentElement.classList.toggle('cmp-changed', state.comparing && nameChanged);
    });
  }

  // "Edited" means the edit buffer actually differs from the voice as selected.
  function markEdited() {
    state.edited = !AN.sameVoice(state.edit, state.original);
    updateLcd();
  }

  // ---------------------------------------------------------------- librarian
  function buildVoiceGrid() {
    const grid = $('voiceGrid');
    const keep = grid.scrollTop;
    grid.innerHTML = '';
    bank().voices.forEach((v, i) => {
      const b = h('button', 'voice-btn' + (i === state.index ? ' sel' : ''));
      b.type = 'button';
      b.dataset.cat = AN.categoryCode(v);
      b.appendChild(h('span', 'num', String(i + 1).padStart(3, '0') + ' ' + AN.categoryCode(v)));
      b.appendChild(h('span', 'name', AN.getName(v).trimEnd()));
      b.title = AN.displayName(v);
      b.addEventListener('click', () => onVoiceButton(i));
      grid.appendChild(b);
    });
    grid.classList.toggle('store-mode', state.storeMode);
    grid.scrollTop = keep;
    revealSelectedVoice();
  }

  // Collapsed grid (2 rows, scrolling): keep the selected voice's row in view.
  function revealSelectedVoice() {
    const grid = $('voiceGrid');
    const sel = grid.querySelector('.voice-btn.sel');
    if (!sel || !grid.classList.contains('collapsed')) return;
    const pad = parseFloat(getComputedStyle(grid).paddingTop) || 0;
    const top = sel.offsetTop - pad, bottom = sel.offsetTop + sel.offsetHeight + pad;
    if (top < grid.scrollTop) grid.scrollTop = top;
    else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
  }
  function setGridExpanded(expanded) {
    settings.gridExpanded = expanded; saveSettings();
    $('voiceGrid').classList.toggle('collapsed', !expanded);
    const t = $('gridToggle');
    t.textContent = expanded ? '▲ 2 rows' : '▼ All voices';
    t.title = expanded ? 'Show only two rows of voices (scrolling)' : 'Show all 128 voices';
    t.setAttribute('aria-expanded', String(expanded));
    revealSelectedVoice();
  }

  function onVoiceButton(i) {
    if (state.storeMode) {
      if (!confirm(`Store "${AN.displayName(state.edit)}" to ${bankLabel(state.bankName)} #${i + 1}, replacing "${AN.displayName(bank().voices[i])}"?`)) return;
      bank().voices[i] = AN.cloneVoice(state.edit);
      bank().modified = true;
      persistBanks();
      state.storeMode = false;
      state.index = i;
      state.original = AN.cloneVoice(state.edit);
      state.edited = false;
      buildVoiceGrid();
      buildBankSelect();
      updateLcd();
      if (settings.storeToPlg && midi.output) {
        midi.send(Sysex.userVoiceBulk(settings.device, i, state.edit), `User voice ${i + 1}`);
        toast(`Stored to ${bankLabel(state.bankName)} #${i + 1} and sent to PLG user voice ${i + 1}`);
      } else {
        toast(`Stored to ${bankLabel(state.bankName)} #${i + 1}. Use "Send Bank" to write the bank to the PLG.`);
      }
      return;
    }
    selectVoice(i);
  }

  function selectVoice(i, opts = {}) {
    if (state.edited && !opts.force && !confirm('The current voice has unsaved edits. Discard them?')) return;
    state.comparing = false;
    state.index = i;
    state.edit = AN.cloneVoice(bank().voices[i]);
    state.original = AN.cloneVoice(state.edit);
    state.edited = false;
    state.lastParam = '';
    $('compare').classList.remove('on');
    buildVoiceGrid();
    refreshAll();
    if (settings.autoSend && midi.output && !opts.noSend) sendVoice();
  }

  function buildBankSelect() {
    const sel = $('bankSelect');
    sel.innerHTML = '';
    for (const n in state.banks) {
      const c = state.banks[n];
      sel.appendChild(new Option(bankLabel(n) + (c.rom && c.modified ? ' (edited)' : ''), n));
    }
    sel.appendChild(new Option('＋ New bank', '__new'));
    const c = state.banks[state.bankName];
    if (c && (!c.rom || c.modified)) {
      sel.appendChild(new Option(c.rom ? '↺ Revert this bank' : '✕ Remove this bank', '__remove'));
    }
    sel.value = state.bankName;
  }

  function selectBank(name, opts = {}) {
    if (state.edited && !opts.force && !confirm('The current voice has unsaved edits. Discard them?')) {
      $('bankSelect').value = state.bankName;
      return;
    }
    state.bankName = name;
    settings.bank = name; saveSettings();
    state.storeMode = false;
    buildBankSelect();
    selectVoice(0, { force: true, noSend: opts.noSend });
  }

  function uniqueName(base) {
    const n = base.replace(/\.[^.]+$/, '').slice(0, 24) || 'USER';
    if (!state.banks[n]) return n;
    for (let i = 2; ; i++) if (!state.banks[`${n} (${i})`]) return `${n} (${i})`;
  }

  function onBankSelect() {
    const v = $('bankSelect').value;
    if (v === '__new') {
      const name = uniqueName('USER');
      state.banks[name] = { voices: range(128, () => AN.newVoice()), rom: false, modified: true };
      persistBanks();
      selectBank(name);
    } else if (v === '__remove') {
      const c = bank();
      if (!confirm(c.rom ? `Revert "${state.bankName}" to the factory voices?` : `Remove bank "${state.bankName}" from the editor?`)) {
        $('bankSelect').value = state.bankName;
        return;
      }
      if (c.rom) {
        state.banks[state.bankName] = { voices: romCache[state.bankName].map(AN.cloneVoice), rom: true, modified: false };
        persistBanks();
        selectBank(state.bankName, { force: true });
      } else {
        delete state.banks[state.bankName];
        persistBanks();
        selectBank(Object.keys(state.banks)[0], { force: true });
      }
    } else {
      selectBank(v);
    }
  }

  function importSysex(bytes, name) {
    const res = AN.parseSyxFile(bytes);
    res.warnings.forEach(w => toast(w, true));
    if (res.voices) {
      const n = uniqueName(name);
      state.banks[n] = { voices: res.voices, rom: false, modified: true };
      persistBanks();
      selectBank(n, { noSend: true });
      toast(`Loaded 128 voices into "${n}"`);
    } else if (res.single) {
      if (state.edited && !confirm('Replace the current edits with the voice from the file?')) return;
      state.edit = res.single;
      state.comparing = false;
      markEdited();
      refreshAll();
      toast(`Loaded voice "${AN.displayName(res.single)}" into the edit buffer`);
      if (settings.autoSend && midi.output) sendVoice();
    } else {
      toast('No PLG150-AN voice data (User Voice or Current Voice bulk dumps) found', true);
    }
  }

  function download(name, bytes) {
    const blob = new Blob([Uint8Array.from(bytes)], { type: 'application/octet-stream' });
    const a = h('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const fileSafe = s => s.trim().replace(/[^\w\-. ]+/g, '_') || 'voice';

  // ---------------------------------------------------------------- tabs
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    history.replaceState(null, '', name === 'voice' ? location.pathname + location.search : '#' + name);
    if (name === 'feg') drawFeg();
  }

  // ---------------------------------------------------------------- keyboard & wheels
  const KEY_COUNT = 61;
  const keyEls = new Map();
  const down = new Set();
  const baseNote = () => 36 + settings.octave * 12;   // 36 = C1 (Yamaha naming)

  function noteOn(note, vel) {
    if (note < 0 || note > 127 || down.has(note)) return;
    down.add(note);
    keyEls.get(note)?.classList.add('down');
    midi.send([0x90 | settings.channel, note, vel || settings.velocity]);
  }
  function noteOff(note) {
    if (!down.has(note)) return;
    down.delete(note);
    keyEls.get(note)?.classList.remove('down');
    midi.send([0x80 | settings.channel, note, 64]);
  }
  function allOff() { [...down].forEach(noteOff); }

  function buildKeyboard() {
    const kb = $('keyboard');
    kb.innerHTML = '';
    keyEls.clear();
    const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
    const base = baseNote();
    const whites = range(KEY_COUNT, i => base + i).filter(n => !isBlack(n)).length;
    const ww = 100 / whites;
    let wi = 0;
    for (let i = 0; i < KEY_COUNT; i++) {
      const note = base + i;
      const k = h('div', 'key ' + (isBlack(note) ? 'black' : 'white'));
      if (isBlack(note)) {
        k.style.left = `calc(${wi * ww}% - ${ww * 0.32}%)`;
        k.style.width = ww * 0.64 + '%';
      } else {
        k.style.left = wi * ww + '%';
        k.style.width = ww + '%';
        if (note % 12 === 0) k.appendChild(h('span', 'lbl', AN.noteName(note)));
        wi++;
      }
      k.dataset.note = note;
      keyEls.set(note, k);
      kb.appendChild(k);
    }
    $('octLabel').textContent = `${AN.noteName(base)}–${AN.noteName(base + KEY_COUNT - 1)}`;
  }

  function setupKeyboardPointer() {
    const kb = $('keyboard');
    const active = new Map();   // pointerId -> note
    const velFromEvent = (e, key) => {
      // lower on the key = louder, scaled around the velocity slider value
      const r = key.getBoundingClientRect();
      const y = clamp((e.clientY - r.top) / r.height, 0, 1);
      return clamp(Math.round(settings.velocity * (0.55 + 0.6 * y)), 1, 127);
    };
    const keyAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el && el.classList.contains('key') ? el : null;
    };
    kb.addEventListener('pointerdown', e => {
      const key = keyAt(e.clientX, e.clientY);
      if (!key) return;
      kb.setPointerCapture(e.pointerId);
      const note = +key.dataset.note;
      active.set(e.pointerId, note);
      noteOn(note, velFromEvent(e, key));
    });
    kb.addEventListener('pointermove', e => {
      if (!active.has(e.pointerId)) return;
      const key = keyAt(e.clientX, e.clientY);
      const note = key ? +key.dataset.note : null;
      if (note === active.get(e.pointerId)) return;
      noteOff(active.get(e.pointerId));
      if (note != null) { active.set(e.pointerId, note); noteOn(note, velFromEvent(e, key)); }
      else active.set(e.pointerId, null);
    });
    const end = e => {
      if (!active.has(e.pointerId)) return;
      const n = active.get(e.pointerId);
      if (n != null) noteOff(n);
      active.delete(e.pointerId);
    };
    kb.addEventListener('pointerup', end);
    kb.addEventListener('pointercancel', end);
  }

  // Computer keyboard: two rows like a tracker. Z = C of the lowest octave.
  const KEYMAP = {
    z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12,
    q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24,
  };
  function setupComputerKeys() {
    const typing = () => {
      const a = document.activeElement;
      return a && (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'range' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
    };
    const noteFor = k => baseNote() + 24 + KEYMAP[k];   // starts at C3
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.storeMode) { state.storeMode = false; buildVoiceGrid(); updateLcd(); return; }
      if (typing() || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k in KEYMAP) { noteOn(noteFor(k)); e.preventDefault(); }
    });
    document.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      if (k in KEYMAP) noteOff(noteFor(k));
    });
    window.addEventListener('blur', allOff);
  }

  // Generic vertical wheel. value is 0..1; springBack returns it to 0.5 on release.
  function setupWheel(el, initial, springBack, onChange) {
    const thumb = el.firstElementChild;
    let value = initial;
    const draw = () => {
      const r = el.clientHeight - thumb.offsetHeight - 4;
      thumb.style.top = (2 + (1 - value) * r) + 'px';
    };
    const setFromY = y => {
      const r = el.getBoundingClientRect();
      const t = thumb.offsetHeight;
      value = clamp(1 - (y - r.top - t / 2) / (r.height - t), 0, 1);
      draw();
      onChange(value);
    };
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); setFromY(e.clientY); });
    el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) setFromY(e.clientY); });
    const release = () => {
      if (!springBack) return;
      value = 0.5; draw(); onChange(value);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    new ResizeObserver(draw).observe(el);
    draw();
  }

  function setupPerformance() {
    let lastBend = -1, lastMod = -1;
    setupWheel($('pitchWheel'), 0.5, true, v => {
      const val = v === 0.5 ? 8192 : Math.round(v * 16383);
      if (val === lastBend) return;
      lastBend = val;
      midi.send([0xE0 | settings.channel, val & 0x7F, val >> 7]);
    });
    setupWheel($('modWheel'), 0, false, v => {
      const val = Math.round(v * 127);
      if (val === lastMod) return;
      lastMod = val;
      midi.send([0xB0 | settings.channel, 1, val]);
    });
    let sustain = false;
    $('sustain').addEventListener('click', () => {
      sustain = !sustain;
      $('sustain').classList.toggle('on', sustain);
      midi.send([0xB0 | settings.channel, 64, sustain ? 127 : 0]);
    });
    $('panic').addEventListener('click', () => {
      allOff();
      const ch = settings.channel;
      midi.send([0xB0 | ch, 120, 0]);
      midi.send([0xB0 | ch, 123, 0]);
      midi.send([0xB0 | ch, 121, 0]);
      sustain = false;
      $('sustain').classList.remove('on');
    });
    $('velocity').value = settings.velocity;
    $('velOut').textContent = settings.velocity;
    $('velocity').addEventListener('input', e => {
      settings.velocity = +e.target.value;
      $('velOut').textContent = settings.velocity;
      saveSettings();
    });
    const shift = d => {
      const o = clamp(settings.octave + d, -2, 2);
      if (o === settings.octave) return;
      allOff();
      settings.octave = o; saveSettings();
      buildKeyboard();
    };
    // Hiding the footer only frees screen space; the computer keys still play.
    const showPerf = hidden => {
      document.body.classList.toggle('perf-hidden', hidden);
      $('perfToggle').textContent = hidden ? '▲ Keyboard' : '▼ Keyboard';
      $('perfToggle').title = hidden ? 'Show the keyboard' : 'Hide the keyboard';
      $('perfToggle').setAttribute('aria-expanded', String(!hidden));
    };
    showPerf(settings.perfHidden);
    $('perfToggle').addEventListener('click', () => {
      settings.perfHidden = !settings.perfHidden; saveSettings();
      if (settings.perfHidden) allOff();
      showPerf(settings.perfHidden);
    });
    $('octDown').addEventListener('click', () => shift(-1));
    $('octUp').addEventListener('click', () => shift(1));
    buildKeyboard();
    setupKeyboardPointer();
    setupComputerKeys();
  }

  // ---------------------------------------------------------------- setup bar & buttons
  function setupControls() {
    const fill = (sel, n, f, val) => { for (let i = 0; i < n; i++) sel.appendChild(new Option(f(i), i)); sel.value = val; };
    fill($('deviceId'), 16, i => String(i + 1), settings.device);
    fill($('midiChannel'), 16, i => String(i + 1), settings.channel);
    fill($('plgPart'), 16, i => String(i + 1), settings.part);
    $('deviceId').addEventListener('change', e => { settings.device = +e.target.value; saveSettings(); });
    $('midiChannel').addEventListener('change', e => { allOff(); settings.channel = +e.target.value; saveSettings(); });
    $('plgPart').addEventListener('change', e => { settings.part = +e.target.value; saveSettings(); });
    $('midiOut').addEventListener('change', e => {
      allOff();
      midi.selectOutput(e.target.value);
      settings.out = midi.output ? midi.output.name : ''; saveSettings();
      refreshPorts();
    });
    $('midiConnect').addEventListener('click', enableMidi);

    const bindCheck = (id, key) => {
      $(id).checked = settings[key];
      $(id).addEventListener('change', e => { settings[key] = e.target.checked; saveSettings(); });
    };
    bindCheck('liveSend', 'liveSend');
    bindCheck('autoSend', 'autoSend');
    bindCheck('storeToPlg', 'storeToPlg');

    $('sendVoice').addEventListener('click', () => sendVoice(shownVoice()));
    $('sendBank').addEventListener('click', sendBank);
    $('compare').addEventListener('click', () => {
      if (!state.edited) { toast('Nothing to compare: no parameter differs from the original voice'); return; }
      state.comparing = !state.comparing;
      $('compare').classList.toggle('on', state.comparing);
      refreshAll();
      if (midi.output) sendVoice(shownVoice());
    });
    $('storeVoice').addEventListener('click', () => {
      if (state.comparing) return;
      state.storeMode = !state.storeMode;
      buildVoiceGrid();
      updateLcd();
      if (state.storeMode) toast('Click the destination voice button (Esc to cancel)');
    });
    $('initVoice').addEventListener('click', () => {
      if (state.comparing || !confirm('Initialize the edit buffer to Init Voice?')) return;
      state.edit = AN.newVoice();
      markEdited();
      refreshAll();
      if (midi.output) sendVoice();
    });
    $('exportVoice').addEventListener('click', () => {
      const v = state.edit;
      const bytes = [...Sysex.commonBulk(0, v), ...Sysex.sceneBulk(0, v), ...Sysex.stepBulk(0, v)];
      download(fileSafe(AN.getName(v)) + '.syx', bytes);
    });

    $('bankSelect').addEventListener('change', onBankSelect);
    $('gridToggle').addEventListener('click', () => setGridExpanded(!settings.gridExpanded));
    $('voiceGrid').classList.toggle('collapsed', !settings.gridExpanded);
    $('loadFile').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      importSysex(new Uint8Array(await f.arrayBuffer()), f.name);
    });
    $('saveBank').addEventListener('click', () => {
      const bytes = bank().voices.flatMap((v, i) => Sysex.userVoiceBulk(0, i, v));
      download(fileSafe(bankLabel(state.bankName)) + '.syx', bytes);
    });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

    $('sendNativeAll').addEventListener('click', sendNativeAll);
    $('resetNative').addEventListener('click', () => {
      if (!confirm('Reset the native settings to their defaults and send them?')) return;
      Object.assign(state.npart, defaults(NATIVE_PART));
      Object.assign(state.nsys, defaults(NATIVE_SYS));
      Object.assign(state.asys, defaults(AN1X_SYS));
      store.set('npart', state.npart); store.set('nsys', state.nsys); store.set('asys', state.asys);
      refreshAll();
      if (midi.output) sendNativeAll();
    });
    $('clearLog').addEventListener('click', () => { $('log').textContent = ''; });

    window.addEventListener('beforeunload', e => {
      if (state.edited) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    setupControls();
    setupPerformance();
    await loadBanks();
    state.bankName = state.banks[settings.bank] ? settings.bank : Object.keys(state.banks)[0];
    buildVoicePage();
    buildDetailPage();
    buildMatrixPage();
    buildFegPage();
    buildPatternPage();
    buildNativePage();
    buildBankSelect();
    selectVoice(0, { force: true, noSend: true });
    setGridExpanded(settings.gridExpanded);
    refreshFegTrack();
    document.body.classList.remove('loading');
    const hashTab = location.hash.slice(1);
    if (document.querySelector(`.tab[data-tab="${CSS.escape(hashTab)}"]`)) showTab(hashTab);
    // Re-open MIDI automatically if the permission was granted before.
    if (midi.supported && navigator.permissions) {
      navigator.permissions.query({ name: 'midi', sysex: true })
        .then(p => { if (p.state === 'granted') enableMidi(); })
        .catch(() => {});
    }
  }
  boot();
})();
