// PLG150-AN voice model: parameter map, value formatting and SysEx file parsing.
//
// A voice is the 1832-byte User Voice block of the PLG150-AN Owner's Manual,
// table <2-8> (MIDI Data Format), made of three parts that are also the
// three "Current Voice" buffers of table <2-1>:
//
//   part    offset  size   current voice address  table
//   Common  0x000   0x668  10 00 00               <2-5>  (incl. Free EG data)
//   Scene   0x668   0x07A  10 10 00               <2-6>
//   StepSeq 0x6E2   0x046  10 0E 00               <2-7>
//
// Two-byte parameters are stored and sent as MSB, LSB (7 bits each).
(function () {
  'use strict';

  const COMMON_SIZE = 0x668, SCENE_SIZE = 0x7A, STEP_SIZE = 0x46;
  const VOICE_SIZE = COMMON_SIZE + SCENE_SIZE + STEP_SIZE;    // 0x728 = 1832
  const BLOCKS = {
    C: { ofs: 0, size: COMMON_SIZE, mid: 0x00, name: 'Common' },
    S: { ofs: COMMON_SIZE, size: SCENE_SIZE, mid: 0x10, name: 'Scene' },
    T: { ofs: COMMON_SIZE + SCENE_SIZE, size: STEP_SIZE, mid: 0x0E, name: 'Step Seq' },
  };

  // Free EG: 4 tracks of 192 points, 2 bytes each (MSB 0-1, LSB 0-127; 128 = 0).
  const FEG_OFS = 0x68, FEG_POINTS = 192, FEG_TRACK_BYTES = FEG_POINTS * 2;

  // ------------------------------------------------------------------ lists
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);   // 0 = C-2, 60 = C3

  const CATEGORIES = ['--', 'Pf', 'Cp', 'Or', 'Gt', 'Ba', 'St', 'En', 'Br', 'Rd', 'Pi', 'Ld',
    'Pd', 'Fx', 'Et', 'Pc', 'Se', 'Dr', 'Sc', 'Vo', 'Co', 'Wv', 'Sq'];
  const CATEGORY_NAMES = ['No category', 'Piano', 'Chromatic Percussion', 'Organ', 'Guitar', 'Bass',
    'Strings/Orchestral', 'Ensemble', 'Brass', 'Reed', 'Pipe', 'Synth Lead', 'Synth Pad',
    'Synth Effect', 'Ethnic', 'Percussive', 'Sound Effect', 'Drums', 'Synth Comp', 'Vocal',
    'Combination', 'Material Wave', 'Sequence'];

  const LFO_WAVES = ['Sine', 'Sine Ofst1', 'Sine Ofst2', 'Sin180 Ofst1', 'Sin180 Ofst2',
    'Triangle', 'Tri Ofst1', 'Tri Ofst2', 'Tri180 Ofst1', 'Tri180 Ofst2',
    'Square', 'Squ Ofst1', 'Squ180 Ofst1', 'Saw Down', 'Saw Dn Ofst2', 'Saw Up', 'Saw Up Ofst2',
    'S/H', 'S/H Ofst2', 'S/H2', 'S/H2 Ofst2'];

  // XG EQ frequency table (index -> Hz)
  const EQ_FREQ = [20, 22, 25, 28, 32, 36, 40, 45, 50, 56, 63, 70, 80, 90, 100, 110, 125, 140, 160,
    180, 200, 225, 250, 280, 315, 355, 400, 450, 500, 560, 630, 700, 800, 900, 1000, 1100, 1200,
    1400, 1600, 1800, 2000, 2200, 2500, 2800, 3200, 3600, 4000, 4500, 5000, 5600, 6300, 7000, 8000,
    9000, 10000, 11000, 12000, 14000, 16000, 18000, 20000];
  const hz = f => (f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : f + ' Hz');

  const SUBDIVIDE = ['3/8', '1/4', '3/16', '1/6', '1/8', '3/32', '1/12', '1/16', '1/24', '1/32'];
  const ARP_TYPES = ['Up Oct1', 'Up Oct2', 'Up Oct4', 'Dwn Oct1', 'Dwn Oct2', 'Dwn Oct4',
    'UpDwn A Oct1', 'UpDwn A Oct2', 'UpDwn A Oct4', 'UpDwn B Oct1', 'UpDwn B Oct2', 'UpDwn B Oct4',
    'Randm Oct1', 'Randm Oct2', 'Randm Oct4', 'Techno A', 'Techno B', 'Techno C', 'Techno D',
    'DA House', 'Syncopa A', 'Syncopa B', 'SyncoEcho', 'TekkEcho A', 'TekkEcho B', 'PulseLine',
    'BassLine A', 'BassLine B', 'BassLine C', 'BassLine D'];

  const MOD_SRC = ['Fixed', 'PEG', 'FEG', 'LFO1', 'LFO2'];

  // Control Matrix sources (scene 44h + 3n): off, CC 1-95, then named sources
  const CTRL_SOURCES = ['Off'];
  for (let i = 1; i <= 95; i++) CTRL_SOURCES.push('CC ' + i);
  CTRL_SOURCES.push('After Touch', 'Pitch Bend', 'Key Track', 'Velocity', 'Key Random', 'Mod Wheel',
    'Foot Vol', 'Foot Ctrl', 'Foot Sw', 'Ribbon X', 'Ribbon Z');
  for (let i = 1; i <= 8; i++) CTRL_SOURCES.push('AN AC' + i);

  // Control Matrix parameters (Owner's Manual p.49, "Ctrl Matrix: Parameter")
  const MATRIX_PARAMS = ['Off', 'Total Tune', 'Pitch Up', 'Pitch Down', 'PEG Decay', 'PEG Depth',
    'Portmnt Time', 'LFO1 Speed', 'LFO1 Delay', 'LFO2 Speed', 'Sync Pitch', 'SyncPit Dp', 'FM Depth',
    'VCO1 Pitch', 'VCO1 Fine', 'VCO1 Edge', 'PW1/Mix', 'PWM1/Detune', 'VCO1 Pmod Dp', 'VCO2 Pitch',
    'VCO2 Fine', 'VCO2 Edge', 'PW2', 'PWM2/Xmod Dp', 'VCO2 Pmod Dp', 'VCO1 Lvl', 'VCO2 Lvl',
    'Ring Mod Lvl', 'Noise Lvl', 'FEG Attack', 'FEG Decay', 'FEG Sustain', 'FEG Release',
    'HPF Cutoff', 'VCF Cutoff', 'Resonance', 'FEG Depth', 'VCF FMod Dp', 'AEG Attack', 'AEG Decay',
    'AEG Sustain', 'AEG Release', 'VCA F.B.', 'VCA Volume', 'VCA Mod Dp', 'Dry/Wet', 'PEG Attack'];

  // Free EG track parameters (Owner's Manual p.49, "Free EG: Trk Param")
  const FEG_PARAMS = ['Off', 'PEG Decay', 'PEG Depth', 'PEG Switch', 'Portmnt Time', 'LFO1 Wave',
    'LFO1 Speed', 'LFO1 Delay', 'LFO2 Speed', 'Sync Mode', 'Sync Pitch', 'SyncPit Dp',
    'Sync Pitch Src', 'Sync Pmod Sw', 'FM Depth', 'FM Source1', 'FM Source2', 'VCO1 Wave',
    'VCO1 Pitch', 'VCO1 Fine', 'VCO1 Edge', 'PW1/Mix', 'PWM1/Detune', 'PWM1 Src', 'VCO1 Pmod Dp',
    'VCO2 Wave', 'VCO2 Pitch', 'VCO2 Fine', 'VCO2 Edge', 'PW2', 'PWM2/Xmod Dp', 'PWM2/Xmod Src',
    'VCO2 Pmod Dp', 'VCO1 Lvl', 'VCO2 Lvl', 'Ring Mod Lvl', 'Noise Lvl', 'FEG Attack', 'FEG Decay',
    'FEG Sustain', 'FEG Release', 'HPF Cutoff', 'VCF Type', 'VCF Cutoff', 'Resonance', 'FEG Depth',
    'FEG Vel Sens', 'VCF Key Trk', 'VCF FMod Dp', 'AEG Attack', 'AEG Decay', 'AEG Sustain',
    'AEG Release', 'VCA F.B.', 'VCA Volume', 'AEG Vel Sns', 'VCA Mod Dp', 'PEG Attack', 'LFO2 Wave',
    'FM Algorithm'];

  // "off(0), 1...95, AT(96)" controller number lists (native and AN1x system)
  const ccName = v => (v === 0 ? 'Off' : v === 96 ? 'AT' : 'CC ' + v);

  // ------------------------------------------------------------------ formatting
  const sign = n => (n > 0 ? '+' + n : String(n));
  const FMT = {
    num: r => String(r),
    s64: r => sign(r - 64),
    s128: r => sign(r - 128),
    p1: r => String(r + 1),
    note: r => noteName(r),
    eqf: r => hz(EQ_FREQ[r] || 0),
    eqg: r => sign(r - 64) + ' dB',
    pw: r => Math.round(r * 99 / 127) + '%',
    gate: r => Math.max(1, Math.round(r * 100 / 64)) + '%',
    pct: r => r + '%',
    cc: ccName,
  };

  // ------------------------------------------------------------------ parameter map
  // Each parameter: { key, blk, off, size, min, max, def, label, fmt, opts, ... }
  // opts: array of labels indexed by (raw - min), or a function (voice) -> array
  // for parameters whose meaning depends on other parameters.
  const P = {};
  const list = [];
  function def(key, blk, off, o) {
    const d = Object.assign({ key, blk, off, size: 1, min: 0, max: 127, def: 0, fmt: 'num' }, o);
    d.abs = BLOCKS[blk].ofs + off;
    P[key] = d;
    list.push(d);
    return d;
  }

  // --- Common (10 00 xx)
  def('category', 'C', 0x0A, { label: 'Category', max: 22, def: 0, opts: CATEGORIES.map((c, i) => `${c} ${CATEGORY_NAMES[i]}`) });
  def('unison', 'C', 0x0C, { label: 'Unison', max: 1, opts: ['Off', 'On'] });
  def('unisonDetune', 'C', 0x0F, { label: 'Unison Detune', min: 1, max: 32, def: 6 });
  def('tempo', 'C', 0x10, { label: 'Tempo', size: 2, min: 39, max: 240, def: 140, fmtFn: r => (r === 39 ? 'MIDI' : String(r)) });
  def('splitPoint', 'C', 0x12, { label: 'Split Point', def: 60, fmt: 'note' });
  def('portaSw', 'C', 0x13, { label: 'Portamento Sw', max: 1, opts: ['Off', 'On'] });
  def('outGain', 'C', 0x1B, { label: 'Output Gain', max: 2, opts: ['+0 dB', '+6 dB', '+12 dB'] });
  def('distDrive', 'C', 0x1C, { label: 'Dist Drive', size: 2, max: 100, def: 100 });
  def('ampType', 'C', 0x1E, { label: 'Guitar Amp Type', size: 2, max: 3, def: 1, opts: ['Off', 'Stack', 'Combo', 'Tube'] });
  def('distLpf', 'C', 0x20, { label: 'Dist LPF', size: 2, min: 0x22, max: 0x3C, def: 0x30, fmtFn: r => (r >= 0x3C ? 'Thru' : FMT.eqf(r)) });
  def('distLevel', 'C', 0x22, { label: 'Dist Out Level', size: 2, max: 100, def: 60 });
  def('eqLowF', 'C', 0x28, { label: 'EQ Low Freq', min: 0x04, max: 0x28, def: 0x11, fmt: 'eqf' });
  def('eqLowG', 'C', 0x29, { label: 'EQ Low Gain', min: 0x34, max: 0x4C, def: 64, fmt: 'eqg', bipolar: true });
  def('eqMidF', 'C', 0x2A, { label: 'EQ Mid Freq', min: 0x0E, max: 0x36, def: 0x28, fmt: 'eqf' });
  def('eqMidG', 'C', 0x2B, { label: 'EQ Mid Gain', min: 0x34, max: 0x4C, def: 64, fmt: 'eqg', bipolar: true });
  def('eqMidQ', 'C', 0x2C, { label: 'EQ Mid Q', min: 10, max: 120, def: 10, fmtFn: r => (r / 10).toFixed(1) });
  def('eqHighF', 'C', 0x2D, { label: 'EQ High Freq', min: 0x1C, max: 0x3A, def: 0x34, fmt: 'eqf' });
  def('eqHighG', 'C', 0x2E, { label: 'EQ High Gain', min: 0x34, max: 0x4C, def: 64, fmt: 'eqg', bipolar: true });

  const isSeq = v => get(v, P.pgSelect) === 1;
  def('pgOn', 'C', 0x50, { label: 'Arp/Seq On', max: 1, opts: ['Off', 'On'] });
  def('pgSelect', 'C', 0x51, { label: 'Arp/Seq Select', max: 1, opts: ['Arpeggio', 'Step Seq'] });
  def('pgType', 'C', 0x52, {
    label: 'Type / Pattern', max: 127,
    opts: v => (isSeq(v) ? Array.from({ length: 128 }, (_, i) => 'User ' + String(i + 1).padStart(3, '0')) : ARP_TYPES),
  });
  def('pgKbdMode', 'C', 0x53, {
    label: 'Kbd Mode', max: 3,
    opts: v => (isSeq(v) ? ['Normal', 'NoteShift & Normal', 'PtnSel & Normal', 'PtnSel & NoteShift'] : ['Chord', 'Chord & Normal']),
  });
  def('pgHold', 'C', 0x54, { label: 'Hold', max: 2, opts: v => (isSeq(v) ? ['Off', 'Mode 1', 'Mode 2'] : ['Off', 'On']) });
  def('arpSubdivide', 'C', 0x56, { label: 'Subdivide', max: 9, def: 4, opts: SUBDIVIDE });
  def('swing', 'C', 0x57, { label: 'Swing', min: 50, max: 83, def: 50, fmt: 'pct' });
  def('pgVelocity', 'C', 0x58, { label: 'Velocity', size: 2, max: 200, def: 100, fmtFn: r => (r === 0 ? 'Real' : r + '%') });
  def('pgGate', 'C', 0x5A, { label: 'Gate Time', size: 2, min: 1, max: 200, def: 100, fmt: 'pct' });

  def('fegTrigger', 'C', 0x5C, { label: 'Trigger', max: 2, def: 1, opts: ['Free', 'MIDI In Notes', 'All Notes'] });
  def('fegLoop', 'C', 0x5D, { label: 'Loop Type', max: 4, def: 4, opts: ['Off', 'Forward', 'Forward Half', 'Alternate', 'Alternate Half'] });
  const FEG_LENGTH = r => (r <= 9 ? ['', '', '1/2 bar', '1 bar', '3/2 bars', '2 bars', '3 bars', '4 bars', '6 bars', '8 bars'][r]
    : r <= 80 ? (r / 10).toFixed(1) + ' sec' : (8 + (r - 80) / 2).toFixed(1) + ' sec');
  def('fegLength', 'C', 0x5E, { label: 'Length', min: 2, max: 96, def: 40, fmtFn: FEG_LENGTH });
  def('fegKeyTrk', 'C', 0x5F, { label: 'Key Track', def: 64, fmt: 's64', bipolar: true });
  for (let t = 0; t < 4; t++) {
    def('fegParam' + t, 'C', 0x60 + t * 2, { label: `Track ${t + 1} Param`, max: 59, opts: FEG_PARAMS });
    def('fegScene' + t, 'C', 0x61 + t * 2, { label: `Track ${t + 1} Scene Sw`, max: 1, opts: ['Off', 'On'] });
  }

  // --- Scene (10 10 xx)
  const keyPoly = v => get(v, P.keyMode) === 0;
  const syncOn = v => get(v, P.syncMode) !== 0;
  const vco1Multi = v => !syncOn(v) && get(v, P.vco1Wave) === 4;
  const vco2TriSine = v => get(v, P.vco2Wave) >= 4;
  def('keyMode', 'S', 0x00, { label: 'Key Mode', max: 2, opts: ['Poly', 'Mono', 'Legato'] });
  def('pbUp', 'S', 0x01, { label: 'Pitch Bend Up', min: 0x28, max: 0x58, def: 0x42, fmt: 's64', bipolar: true });
  def('pbDown', 'S', 0x02, { label: 'Pitch Bend Down', min: 0x28, max: 0x58, def: 0x3E, fmt: 's64', bipolar: true });
  def('pegDecay', 'S', 0x03, { label: 'PEG Decay' });
  def('pegDepth', 'S', 0x04, { label: 'PEG Depth', def: 64, fmt: 's64', bipolar: true });
  def('pegSwitch', 'S', 0x05, { label: 'PEG Switch', min: 1, max: 3, def: 3, opts: ['VCO1', 'VCO2', 'Both'] });
  def('portaMode', 'S', 0x06, { label: 'Portamento Mode', max: 1, opts: v => (keyPoly(v) ? ['Normal', 'Sustain Key'] : ['Full Time', 'Fingered']) });
  def('portaTime', 'S', 0x07, { label: 'Portamento Time', def: 44 });
  def('lfoReset', 'S', 0x08, { label: 'Key On Reset', max: 1, opts: ['Off', 'Key On'] });
  def('lfo1Wave', 'S', 0x09, { label: 'LFO1 Wave', max: 20, opts: LFO_WAVES });
  def('lfo1Speed', 'S', 0x0A, { label: 'LFO1 Speed', size: 2, max: 255, def: 83, fmt: 'p1' });
  def('lfo1Delay', 'S', 0x0C, { label: 'LFO1 Delay' });
  def('lfo2Speed', 'S', 0x0D, { label: 'LFO2 Speed', size: 2, max: 255, def: 31, fmt: 'p1' });
  def('syncMode', 'S', 0x0F, { label: 'Sync Mode', max: 2, opts: ['Off', 'VCO1 Master>Slave', 'VCO2>VCO1'] });
  def('syncPitch', 'S', 0x10, { label: 'Sync Pitch', def: 64, fmt: 's64', bipolar: true });
  def('syncDepth', 'S', 0x11, { label: 'Sync Pitch Depth', def: 64, fmt: 's64', bipolar: true });
  def('syncSrc', 'S', 0x12, { label: 'Sync Pitch Source', max: 4, opts: MOD_SRC });
  def('syncPmod', 'S', 0x13, { label: 'Sync Pmod Switch', min: 1, max: 3, def: 3, opts: ['Master', 'Slave', 'Both'], active: v => get(v, P.syncMode) === 1 });
  def('fmDepth', 'S', 0x14, { label: 'FM Depth', def: 64, fmt: 's64', bipolar: true });
  def('fmSrc1', 'S', 0x15, { label: 'FM Depth Ctrl (Src1)', max: 4, opts: MOD_SRC });
  def('fmSrc2', 'S', 0x16, { label: 'FM Modulator (Src2)', max: 7, opts: ['VCO2 Freq', 'VCO1', 'VCO1 Sub', 'PEG', 'FEG', 'LFO1', 'LFO2', 'VCO2 Out'] });
  def('vco1Wave', 'S', 0x17, {
    label: 'VCO1 Wave', max: 6,
    opts: v => (syncOn(v) ? ['Saw', 'Pulse', 'Inner1', 'Inner2', 'Inner3', 'Square', 'Noise'] : ['Saw', 'Pulse', 'Saw2', 'Mix', 'Multi Saw']),
  });
  def('vco1Pitch', 'S', 0x18, { label: 'VCO1 Pitch', def: 64, fmt: 's64', bipolar: true });
  def('vco1Fine', 'S', 0x19, { label: 'VCO1 Fine', min: 0x0E, max: 0x72, def: 64, fmt: 's64', bipolar: true });
  def('vco1Edge', 'S', 0x1A, { label: 'VCO1 Edge', def: 100 });
  def('vco1Pw', 'S', 0x1B, { label: v => (vco1Multi(v) ? 'VCO1 Mix' : 'VCO1 Pulse Width'), def: 64, fmtV: (r, v) => (vco1Multi(v) ? String(r) : FMT.pw(r)) });
  def('vco1Pwm', 'S', 0x1C, { label: v => (vco1Multi(v) ? 'VCO1 Detune' : 'VCO1 PWM Depth'), def: 64, fmtV: (r, v) => (vco1Multi(v) ? String(r) : FMT.s64(r)), bipolarV: v => !vco1Multi(v) });
  def('vco1PwmSrc', 'S', 0x1D, { label: 'VCO1 PWM Source', max: 7, def: 4, opts: ['Fixed', 'PEG', 'FEG', 'LFO1', 'LFO2', 'LFO2 Phase', 'LFO2 Fast', 'VCO2'], active: v => !vco1Multi(v) });
  def('vco1Pmod', 'S', 0x1E, { label: 'LFO > VCO1 Pitch', size: 2, min: 1, max: 255, def: 128, fmt: 's128', bipolar: true, center: 128 });
  def('vco2Wave', 'S', 0x20, { label: 'VCO2 Wave', max: 5, opts: ['Saw', 'Pulse', 'Saw2', 'Mix', 'Triangle', 'Sine'] });
  def('vco2Pitch', 'S', 0x21, { label: 'VCO2 Pitch', def: 64, fmt: 's64', bipolar: true });
  def('vco2Fine', 'S', 0x22, { label: 'VCO2 Fine', min: 0x0E, max: 0x72, def: 64, fmt: 's64', bipolar: true });
  def('vco2Edge', 'S', 0x23, { label: 'VCO2 Edge', def: 127, active: v => !vco2TriSine(v) });
  def('vco2Pw', 'S', 0x24, { label: 'VCO2 Pulse Width', def: 64, fmt: 'pw', active: v => !vco2TriSine(v) });
  def('vco2Pwm', 'S', 0x25, { label: v => (vco2TriSine(v) ? 'VCO2 X-Mod Depth' : 'VCO2 PWM Depth'), def: 64, fmt: 's64', bipolar: true });
  def('vco2PwmSrc', 'S', 0x26, {
    label: v => (vco2TriSine(v) ? 'VCO2 X-Mod Source' : 'VCO2 PWM Source'), max: 7, def: 4,
    opts: v => (vco2TriSine(v) ? MOD_SRC : ['Fixed', 'PEG', 'FEG', 'LFO1', 'LFO2', 'LFO2 Phase', 'LFO2 Fast', 'VCO1']),
  });
  def('vco2Pmod', 'S', 0x27, { label: 'LFO > VCO2 Pitch', size: 2, min: 1, max: 255, def: 128, fmt: 's128', bipolar: true, center: 128 });
  def('mixVco1', 'S', 0x29, { label: 'Mixer VCO1', def: 127 });
  def('mixVco2', 'S', 0x2A, { label: 'Mixer VCO2' });
  def('mixRing', 'S', 0x2B, { label: 'Ring Mod Level' });
  def('mixNoise', 'S', 0x2C, { label: 'Noise Level' });
  def('fegA', 'S', 0x2D, { label: 'FEG Attack' });
  def('fegD', 'S', 0x2E, { label: 'FEG Decay', def: 64 });
  def('fegS', 'S', 0x2F, { label: 'FEG Sustain', def: 127 });
  def('fegR', 'S', 0x30, { label: 'FEG Release', def: 85 });
  def('hpf', 'S', 0x31, { label: 'HPF Cutoff', fmtFn: r => (r === 0 ? 'Thru' : String(r)) });
  def('vcfType', 'S', 0x32, { label: 'VCF Type', max: 5, opts: ['LPF24', 'LPF18', 'LPF12', 'BPF', 'HPF12', 'BEF'] });
  def('cutoff', 'S', 0x33, { label: 'VCF Cutoff', def: 100 });
  def('reso', 'S', 0x34, { label: 'Resonance', min: 0x0D, max: 0x7F, def: 0x19, fmtFn: r => sign(r - 25), bipolar: true, center: 25 });
  def('fegDepth', 'S', 0x35, { label: 'FEG Depth', size: 2, max: 255, def: 160, fmt: 's128', bipolar: true, center: 128 });
  def('fegVel', 'S', 0x37, { label: 'FEG Velocity Sens', def: 64, fmt: 's64', bipolar: true });
  def('keyTrk', 'S', 0x38, { label: 'VCF Key Track', min: 0x20, def: 64, fmt: 's64', bipolar: true });
  def('vcfMod', 'S', 0x39, { label: 'LFO > VCF', def: 64, fmt: 's64', bipolar: true });
  def('aegA', 'S', 0x3A, { label: 'AEG Attack' });
  def('aegD', 'S', 0x3B, { label: 'AEG Decay', def: 64 });
  def('aegS', 'S', 0x3C, { label: 'AEG Sustain', def: 127 });
  def('aegR', 'S', 0x3D, { label: 'AEG Release', def: 36 });
  def('vcaFb', 'S', 0x3E, { label: 'VCA Feedback' });
  def('volume', 'S', 0x3F, { label: 'VCA Volume', def: 105 });
  def('aegVel', 'S', 0x40, { label: 'AEG Velocity Sens', def: 64, fmt: 's64', bipolar: true });
  def('vcaMod', 'S', 0x41, { label: 'LFO > VCA', def: 64, fmt: 's64', bipolar: true });
  def('dryWet', 'S', 0x42, {
    label: 'Dist Dry/Wet', min: 1, def: 1, bipolar: true,
    fmtFn: r => (r === 64 ? 'D=W' : r < 64 ? `D>W${64 - r}` : `D<W${r - 64}`),
  });
  for (let i = 0; i < 15; i++) {
    def('mSrc' + i, 'S', 0x44 + i * 3, { label: `Matrix ${i + 1} Source`, max: 114, opts: CTRL_SOURCES });
    def('mPar' + i, 'S', 0x45 + i * 3, { label: `Matrix ${i + 1} Param`, max: 46, opts: MATRIX_PARAMS });
    def('mDep' + i, 'S', 0x46 + i * 3, { label: `Matrix ${i + 1} Depth`, def: 64, fmtFn: r => (r === 64 ? 'Direct' : sign(r - 64)), bipolar: true });
  }
  def('octShift', 'S', 0x75, { label: 'Octave Shift', min: 0x3E, max: 0x42, def: 64, fmt: 's64' });
  def('pegAttack', 'S', 0x76, { label: 'PEG Attack' });
  def('lfo2Wave', 'S', 0x77, { label: 'LFO2 Wave', max: 20, def: 5, opts: LFO_WAVES });
  def('lfoAssign', 'S', 0x78, { label: 'LFO Assign Group', max: 15 });
  def('fmAlgo', 'S', 0x79, { label: 'FM Algorithm', min: 1, max: 3, def: 3, opts: ['Both', 'Master', 'Slave'], active: v => get(v, P.syncMode) === 1 });

  // --- Step Seq (10 0E xx)
  def('ssBase', 'T', 0x00, { label: 'Base Unit', max: 9, def: 4, opts: SUBDIVIDE });
  def('ssLength', 'T', 0x01, { label: 'Step Length', min: 1, max: 16, def: 8, fmtFn: r => r + (r === 1 ? ' step' : ' steps') });
  def('ssLoop', 'T', 0x02, { label: 'Loop Type', max: 3, opts: ['Forward', 'Backward', 'Alternate A', 'Alternate B'] });
  def('ssCc', 'T', 0x03, { label: 'Ctrl Change No', max: 96, fmt: 'cc' });
  for (let i = 0; i < 16; i++) {
    def('ssNote' + i, 'T', 0x06 + i, { label: `Step ${i + 1} Note`, def: 60, fmt: 'note' });
    def('ssVel' + i, 'T', 0x16 + i, { label: `Step ${i + 1} Velocity`, def: 100, fmtFn: r => (r === 0 ? 'Rest' : String(r)) });
    def('ssGate' + i, 'T', 0x26 + i, { label: `Step ${i + 1} Gate`, def: 60, fmt: 'gate' });
    def('ssCcv' + i, 'T', 0x36 + i, { label: `Step ${i + 1} CC Value` });
  }

  // ------------------------------------------------------------------ access
  function get(v, d) {
    return d.size === 2 ? (v[d.abs] << 7) | v[d.abs + 1] : v[d.abs];
  }
  function set(v, d, raw) {
    if (d.size === 2) { v[d.abs] = (raw >> 7) & 0x7F; v[d.abs + 1] = raw & 0x7F; }
    else v[d.abs] = raw & 0x7F;
  }
  // bytes of a parameter change message: [address high, mid, low, ...data]
  function paramBytes(d, raw) {
    const data = d.size === 2 ? [(raw >> 7) & 0x7F, raw & 0x7F] : [raw & 0x7F];
    return [0x10, BLOCKS[d.blk].mid, d.off, ...data];
  }
  const labelOf = (d, v) => (typeof d.label === 'function' ? d.label(v) : d.label);
  const optsOf = (d, v) => (typeof d.opts === 'function' ? d.opts(v) : d.opts);
  const isActive = (d, v) => (d.active ? d.active(v) : true);
  const isBipolar = (d, v) => (d.bipolarV ? d.bipolarV(v) : !!d.bipolar);
  function format(d, raw, v) {
    if (d.opts) {
      const o = optsOf(d, v);
      const s = o && o[raw - d.min];
      return s != null ? s : String(raw);
    }
    if (d.fmtV) return d.fmtV(raw, v);
    if (d.fmtFn) return d.fmtFn(raw);
    return FMT[d.fmt](raw);
  }

  function getName(v) {
    let s = '';
    for (let i = 0; i < 10; i++) {
      const c = v[i];
      s += c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : ' ';
    }
    return s;
  }
  function setName(v, name) {
    const s = (name || '').padEnd(10, ' ').slice(0, 10);
    for (let i = 0; i < 10; i++) {
      const c = s.charCodeAt(i);
      v[i] = c >= 0x20 && c < 0x7F ? c : 0x20;
    }
  }
  const categoryCode = v => CATEGORIES[v[0x0A]] || '--';
  const displayName = v => `${categoryCode(v)}:${getName(v).trimEnd()}`;

  // Free EG points: -128..+127 (stored as 0..255 with 128 = 0)
  function fegGet(v, track, i) {
    const o = FEG_OFS + track * FEG_TRACK_BYTES + i * 2;
    return ((v[o] & 1) << 7 | v[o + 1]) - 128;
  }
  function fegSet(v, track, i, val) {
    const raw = Math.max(0, Math.min(255, Math.round(val) + 128));
    const o = FEG_OFS + track * FEG_TRACK_BYTES + i * 2;
    v[o] = raw >> 7; v[o + 1] = raw & 0x7F;
  }

  function newVoice() {
    const v = new Uint8Array(VOICE_SIZE);
    setName(v, 'Init Voice');
    v[0x0B] = 1;      // scene select: fixed to Scene 1
    v[0x1A] = 0x0D;   // variation effect type: fixed to Guitar Amp Simulator
    for (const d of list) set(v, d, d.def);
    for (let t = 0; t < 4; t++) for (let i = 0; i < FEG_POINTS; i++) fegSet(v, t, i, 0);
    return v;
  }
  const cloneVoice = v => new Uint8Array(v);
  const sameVoice = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  const blockData = (v, blk) => v.slice(BLOCKS[blk].ofs, BLOCKS[blk].ofs + BLOCKS[blk].size);

  // ------------------------------------------------------------------ files
  function splitSysex(bytes) {
    const out = [];
    let start = -1;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0xF0) start = i;
      else if (bytes[i] === 0xF7 && start >= 0) { out.push(bytes.subarray(start, i + 1)); start = -1; }
    }
    return out;
  }

  // Parses native PLG150-AN bulk dumps (model 5C): User Voice blocks (20 mm 00)
  // and Current Voice blocks (10 00 00 / 10 10 00 / 10 0E 00).
  // Returns { voices: Uint8Array[128] | null, single: Uint8Array | null, warnings }.
  function parseSyxFile(bytes) {
    const warnings = [];
    const bank = new Array(128).fill(null);
    let found = 0, badSum = 0, an1x = 0;
    const cur = {};
    for (const m of splitSysex(bytes)) {
      if (m.length < 12 || m[1] !== 0x43 || (m[2] & 0xF0) !== 0x00 || m[3] !== 0x5C) continue;
      const count = (m[4] << 7) | m[5];
      const [ah, am, al] = [m[6], m[7], m[8]];
      const data = m.subarray(9, m.length - 2);
      if (data.length !== count) continue;
      let sum = 0;
      for (let i = 4; i < m.length - 1; i++) sum += m[i];
      if (sum & 0x7F) badSum++;
      if (ah === 0x20 && al === 0 && count === VOICE_SIZE) {
        bank[am] = new Uint8Array(data);
        found++;
      } else if (ah === 0x10 && al === 0) {
        if (am === 0x00 && count === COMMON_SIZE) cur.C = data;
        else if (am === 0x10 && count === SCENE_SIZE) cur.S = data;
        else if (am === 0x0E && count === STEP_SIZE) cur.T = data;
      } else if (ah === 0x11) {
        an1x++;
      }
    }
    if (badSum) warnings.push(`${badSum} message(s) with a wrong checksum (loaded anyway)`);
    if (an1x && !found) warnings.push('AN1x voice data is not supported, only PLG150-AN native dumps');
    let single = null;
    if (cur.C || cur.S || cur.T) {
      single = newVoice();
      for (const k of ['C', 'S', 'T']) if (cur[k]) single.set(cur[k], BLOCKS[k].ofs);
      if (!(cur.C && cur.S && cur.T)) warnings.push('Incomplete current voice dump: missing parts were initialized');
    }
    let voices = null;
    if (found) {
      voices = bank.map(v => v || newVoice());
      if (found < 128) warnings.push(`File has ${found} user voice(s); the other slots are Init Voice`);
    }
    return { voices, single, warnings };
  }

  function base64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function gunzip(bytes) {
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  // bank bytes (128 * 1832) -> array of voices
  function splitBank(bytes) {
    return Array.from({ length: 128 }, (_, i) => bytes.slice(i * VOICE_SIZE, (i + 1) * VOICE_SIZE));
  }
  function joinBank(voices) {
    const out = new Uint8Array(128 * VOICE_SIZE);
    voices.forEach((v, i) => out.set(v, i * VOICE_SIZE));
    return out;
  }

  window.AN = {
    VOICE_SIZE, COMMON_SIZE, SCENE_SIZE, STEP_SIZE, BLOCKS, FEG_OFS, FEG_POINTS,
    P, list, get, set, paramBytes, labelOf, optsOf, isActive, isBipolar, format, FMT,
    getName, setName, categoryCode, displayName, fegGet, fegSet,
    newVoice, cloneVoice, sameVoice, blockData,
    splitSysex, parseSyxFile, base64ToBytes, bytesToBase64, gunzip, splitBank, joinBank,
    noteName, ccName, CATEGORIES, LFO_WAVES, MATRIX_PARAMS, FEG_PARAMS, CTRL_SOURCES, SUBDIVIDE,
  };
})();
